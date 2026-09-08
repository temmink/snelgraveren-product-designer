<?php
namespace Snelgraveren\ProductDesigner\API;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Database\DesignRepository;
use Snelgraveren\ProductDesigner\Database\TemplateRepository;
use Snelgraveren\ProductDesigner\Security\CapabilityChecker;

class RestDesigns {

    private DesignRepository $repo;
    private TemplateRepository $template_repo;

    public function __construct() {
        $this->repo          = new DesignRepository();
        $this->template_repo = new TemplateRepository();
    }

    /**
     * Strip internal sequential IDs and heavy export payloads before sending
     * design data back to non-admin users. Also keeps autosave responses lean —
     * the export_svg column can be several MB per view.
     */
    private function sanitize_for_customer(array $design): array {
        unset($design['id'], $design['template_id'], $design['customer_id'], $design['session_id']);
        if (!empty($design['views'])) {
            $design['views'] = array_map(function ($view) {
                unset($view['id'], $view['design_id'], $view['export_svg'], $view['export_vector'], $view['export_vector_embed'], $view['export_lbrn']);
                return $view;
            }, $design['views']);
        }
        return $design;
    }

    /**
     * Sanitize a client-submitted export blob. Accepts either a PNG data URL
     * (passed through as-is after base64 validation) or SVG markup (run through
     * enshrined/svg-sanitize to strip scripts, event handlers, external refs).
     * Returns '' if the payload is malformed or too large.
     */
    /**
     * Sanitize one export blob, or return '' when it cannot be trusted.
     *
     * Every rejection is logged. Silence here cost a full release: Fabric
     * emitted malformed XML (a missing space between two tspan attributes), the
     * sanitizer refused to load it, this returned '', `upsert_view()` skips
     * empty columns so the old value stayed, and the SVG export fell back to
     * wrapping the raster PNG. The design saved, no error surfaced anywhere, and
     * the merchant only found out when the engraving file held a single bitmap.
     *
     * @param string $blob  The client-sent markup or data URL.
     * @param string $field Which column it is destined for, for the log line.
     */
    private function sanitize_export_blob(string $blob, string $field = 'export'): string {
        $trimmed = trim($blob);
        if ($trimmed === '') return '';

        // Cap at ~10 MB to prevent memory exhaustion during PDF/PNG render.
        // Multiplier:3 PNGs on large canvases can exceed the thumbnail cap.
        if (strlen($trimmed) > 10 * 1024 * 1024) {
            $this->log_export_rejection($field, sprintf('larger than 10 MB (%d bytes)', strlen($trimmed)));
            return '';
        }

        if (str_starts_with($trimmed, 'data:image/png;base64,')) {
            $b64 = substr($trimmed, strlen('data:image/png;base64,'));
            $decoded = base64_decode($b64, true);
            if ($decoded === false || strlen($decoded) < 8 || substr($decoded, 0, 8) !== "\x89PNG\r\n\x1a\n") {
                $this->log_export_rejection($field, 'not a valid PNG data URL');
                return '';
            }
            return $trimmed;
        }

        if (str_starts_with($trimmed, '<')) {
            if (!class_exists(\enshrined\svgSanitize\Sanitizer::class)) {
                $this->log_export_rejection($field, 'SVG sanitizer class missing (vendor/ incomplete)');
                return '';
            }
            $sanitizer = new \enshrined\svgSanitize\Sanitizer();
            $clean = $sanitizer->sanitize($trimmed);
            if ($clean === false) {
                $this->log_export_rejection($field, 'SVG could not be parsed (malformed XML)');
                return '';
            }
            return $clean;
        }

        $this->log_export_rejection($field, 'unrecognised payload (neither SVG markup nor a PNG data URL)');
        return '';
    }


    /**
     * Sanitize a client-sent LightBurn project (.lbrn2, plain XML).
     *
     * This blob is never rendered by a browser — it is stored and later
     * streamed as a file download for the laser operator — so the risk model is
     * XML parsing, not markup injection: refuse anything that is not
     * well-formed, refuse DOCTYPE (XXE), require the LightBurnProject root.
     * Rejections are logged for the same reason sanitize_export_blob logs them:
     * a silently dropped export blob cost a full release to find.
     */
    private function sanitize_lbrn_blob(string $blob): string {
        $trimmed = trim($blob);
        if ($trimmed === '') return '';

        if (strlen($trimmed) > 10 * 1024 * 1024) {
            $this->log_export_rejection('export_lbrn', sprintf('larger than 10 MB (%d bytes)', strlen($trimmed)));
            return '';
        }
        if (stripos($trimmed, '<!DOCTYPE') !== false || stripos($trimmed, '<!ENTITY') !== false) {
            $this->log_export_rejection('export_lbrn', 'DOCTYPE/ENTITY not allowed');
            return '';
        }

        $prev = libxml_use_internal_errors(true);
        $doc  = new \DOMDocument();
        $ok   = $doc->loadXML($trimmed, LIBXML_NONET); // no network access; entities already refused above
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        if (!$ok || !$doc->documentElement || $doc->documentElement->nodeName !== 'LightBurnProject') {
            $this->log_export_rejection('export_lbrn', 'not a well-formed LightBurnProject document');
            return '';
        }
        return $trimmed;
    }

    /**
     * Record why an export blob was dropped. Goes to the PHP error log rather
     * than an admin notice: this runs during a customer's save, where there is
     * no screen to show it on.
     */
    private function log_export_rejection(string $field, string $reason): void {
        if (defined('WP_DEBUG') && WP_DEBUG) {
            // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
            error_log(sprintf('[snelgraveren-product-designer] dropped %s: %s', $field, $reason));
        }
    }

    /**
     * Verify the WP REST nonce is present and valid.
     * This prevents CSRF on write operations.
     */
    public function verify_nonce(\WP_REST_Request $request): bool {
        return (bool) wp_verify_nonce(
            $request->get_header('x-wp-nonce') ?? '',
            'wp_rest'
        );
    }

    public function register_routes(): void {
        $ns = 'pf/v1';

        register_rest_route($ns, '/designs', [
            ['methods' => 'POST', 'callback' => [$this, 'create_design'], 'permission_callback' => [$this, 'verify_nonce']],
        ]);

        register_rest_route($ns, '/designs/(?P<hash>[a-f0-9]{32})', [
            ['methods' => 'GET',    'callback' => [$this, 'get_design'],    'permission_callback' => '__return_true'],
            ['methods' => 'PUT',    'callback' => [$this, 'update_design'],  'permission_callback' => [$this, 'verify_nonce']],
            ['methods' => 'DELETE', 'callback' => [$this, 'delete_design'],  'permission_callback' => [$this, 'verify_nonce']],
        ]);

        register_rest_route($ns, '/designs/(?P<hash>[a-f0-9]{32})/views', [
            ['methods' => 'POST', 'callback' => [$this, 'upsert_view'], 'permission_callback' => [$this, 'verify_nonce']],
        ]);

        // Admin-only: list all designs
        register_rest_route($ns, '/admin/designs', [
            ['methods' => 'GET', 'callback' => [$this, 'admin_list'], 'permission_callback' => [$this, 'admin_permission']],
        ]);

        register_rest_route($ns, '/admin/designs/(?P<hash>[a-f0-9]{32})/status', [
            ['methods' => 'PUT', 'callback' => [$this, 'admin_update_status'], 'permission_callback' => [$this, 'admin_permission']],
        ]);
    }

    public function admin_permission(): bool {
        return current_user_can('edit_sgpd_templates');
    }

    /**
     * Mirrored in Frontend::owns_design(), with ONE deliberate difference: the
     * frontend also accepts a design whose proof was approved in this
     * WooCommerce session (`is_proof_only_owner()` there). That clause is NOT
     * here, and it does not need to be: `ProofPage::add_design_to_cart()`
     * hands the hash straight to `WC_Cart::add_to_cart()` as
     * `$cart_item_data`, so approving a proof never goes through this REST
     * route or through `Frontend::add_cart_item_data()` at all — the approve
     * path carries the hash itself. What the frontend clause buys is
     * elsewhere: it lets a proof-only visitor (no account, no matching guest
     * session) be recognised as an owner by other server-rendered frontend
     * code — the gallery thumbnail override, the proof-vs-`?pf_design=`
     * permalink choice — none of which this API route is involved in. The
     * proof page itself renders server-side and never calls this API, so
     * widening it would buy nothing and cost the strictness this route has.
     */
    private function owns_design(array $design): bool {
        $user_id    = get_current_user_id();
        $session_id = CapabilityChecker::current_session_id();

        if ($user_id && (int) $design['customer_id'] === $user_id) return true;
        if (!empty($session_id) && $design['session_id'] === $session_id) return true;
        if (current_user_can('edit_sgpd_templates')) return true;
        return false;
    }

    public function create_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $body = $request->get_json_params();
        if (empty($body['template_id'])) {
            return new \WP_Error('missing_template', 'template_id is required.', ['status' => 400]);
        }

        $template = $this->template_repo->get((int) $body['template_id']);
        if (!$template || ($template['status'] ?? '') !== 'published') {
            return new \WP_Error('invalid_template', 'Template not found or not published.', ['status' => 400]);
        }

        $body['customer_id'] = get_current_user_id();
        $body['session_id']  = CapabilityChecker::current_session_id();

        $id = $this->repo->create($body);
        return new \WP_REST_Response($this->sanitize_for_customer($this->repo->get($id)), 201);
    }

    public function get_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) {
            return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        }
        if (!$this->owns_design($design)) {
            return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);
        }
        return rest_ensure_response($this->sanitize_for_customer($design));
    }

    public function update_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        if (!$this->owns_design($design)) return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);

        $body = $request->get_json_params();
        if (!empty($body['status'])) {
            // Only reflect the new status back when it actually persisted —
            // update_status() rejects values outside its whitelist.
            if (!$this->repo->update_status((int) $design['id'], (string) $body['status'])) {
                return new \WP_Error('invalid_status', 'Invalid status value.', ['status' => 400]);
            }
            $design['status'] = $body['status'];
        }
        return rest_ensure_response($this->sanitize_for_customer($design));
    }

    public function delete_design(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        if (!$this->owns_design($design)) return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);

        $this->repo->delete((int) $design['id']);
        return new \WP_REST_Response(null, 204);
    }

    public function upsert_view(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);
        if (!$this->owns_design($design)) return new \WP_Error('forbidden', 'Access denied.', ['status' => 403]);

        // Two payload shapes. Since 1.12.5 the designer sends multipart/form-data
        // with every blob as a FILE part: cPanel hosts run ModSecurity with
        // SecRequestBodyNoFilesLimit at 1 MiB, which counts every non-file byte,
        // so one JSON body carrying the 3x export PNG as base64 was bounced as
        // soon as a design held a photo — and WordPress answered the server's
        // fallback GET with rest_no_route (le-denhelder.nl, 2026-09-08). File
        // parts fall under the far larger SecRequestBodyLimit. The JSON body is
        // still accepted for bundles cached from before the change. Either way
        // the values are normalised to the strings the pipeline below always took.
        $files = $request->get_file_params();
        if (!empty($files)) {
            $view_id             = (int) $request->get_param('view_id');
            $json_raw            = $this->read_view_part($files['canvas_json'] ?? null);
            $json                = $json_raw !== '' ? json_decode($json_raw, true) : [];
            $thumb               = $this->png_part_to_data_url($this->read_view_part($files['thumbnail'] ?? null));
            $export_svg          = $this->png_part_to_data_url($this->read_view_part($files['export_svg'] ?? null));
            $export_vector       = $this->read_view_part($files['export_vector'] ?? null);
            $export_vector_embed = $this->read_view_part($files['export_vector_embed'] ?? null);
            $export_lbrn         = $this->read_view_part($files['export_lbrn'] ?? null);
        } else {
            $body = $request->get_json_params();
            if (empty($body)) {
                // PHP drops BOTH $_POST and $_FILES when post_max_size is exceeded,
                // and a JSON body can arrive empty the same way. Refuse rather
                // than upsert "view 0" with an empty canvas over a real design.
                return new \WP_Error(
                    'sgpd_empty_view_payload',
                    __('The design did not reach the server in full, usually because it exceeds the server’s upload limits. Please try a smaller image, or contact the shop.', 'snelgraveren-product-designer'),
                    ['status' => 400]
                );
            }
            $view_id             = (int) ($body['view_id'] ?? 0);
            $json                = $body['canvas_json'] ?? [];
            $thumb               = $body['thumbnail'] ?? '';
            $export_svg          = $body['export_svg'] ?? '';
            $export_vector       = $body['export_vector'] ?? '';
            $export_vector_embed = $body['export_vector_embed'] ?? '';
            $export_lbrn         = $body['export_lbrn'] ?? '';
        }
        if (!is_array($json)) {
            $json = [];
        }
        if ($view_id <= 0) {
            return new \WP_Error('sgpd_missing_view_id', 'view_id is required.', ['status' => 400]);
        }

        // Save base64 thumbnail as a file
        $thumb_url = '';
        if (!empty($thumb) && str_starts_with($thumb, 'data:image/png;base64,')) {
            $thumb_url = $this->save_thumbnail_file($request['hash'], $view_id, $thumb);
        }

        // Sanitize export blob — SVG markup goes through enshrined/svg-sanitize,
        // PNG data URLs are validated for magic bytes. Anything else is dropped.
        $export_svg = !empty($export_svg) ? $this->sanitize_export_blob($export_svg, 'export_svg') : '';

        // The real vector output (canvas.toSVG()) is always SVG markup — the same
        // sanitizer strips scripts/handlers/external refs before it is stored.
        // Both the outlined default and the font-embedded variant run through it.
        $export_vector       = !empty($export_vector) ? $this->sanitize_export_blob($export_vector, 'export_vector') : '';
        $export_vector_embed = !empty($export_vector_embed) ? $this->sanitize_export_blob($export_vector_embed, 'export_vector_embed') : '';
        $export_lbrn         = !empty($export_lbrn) ? $this->sanitize_lbrn_blob($export_lbrn) : '';

        $this->repo->upsert_view((int) $design['id'], $view_id, $json, $thumb_url, $export_svg, $export_vector, $export_vector_embed, $export_lbrn);
        $this->repo->invalidate_cache($request['hash']);
        return new \WP_REST_Response($this->sanitize_for_customer($this->repo->get_by_hash($request['hash'])), 200);
    }

    /**
     * Contents of one multipart file part of a view save, or '' when absent,
     * failed, or over the cap. The cap (7.5 MB raw) keeps a PNG under the
     * 10 MB data-URL limit that sanitize_export_blob() enforces once it is
     * base64-encoded; SVG/XML/JSON parts share the same ceiling for simplicity.
     */
    private function read_view_part(?array $file): string {
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return '';
        }
        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_file($tmp)) {
            return '';
        }
        $size = (int) ($file['size'] ?? filesize($tmp));
        if ($size <= 0 || $size > 7_500_000) {
            error_log(sprintf('[sgpd] view part "%s" rejected: %d bytes', (string) ($file['name'] ?? '?'), $size));
            return '';
        }
        $contents = file_get_contents($tmp);
        return $contents === false ? '' : $contents;
    }

    /**
     * Re-shape raw PNG bytes from a file part into the `data:image/png;base64,`
     * string the JSON path always delivered, so storage, sanitising and every
     * consumer (thumbnail file, PDF/PNG export, proof page) stay unchanged.
     * Anything that is not a PNG by magic bytes is dropped — the declared MIME
     * type of an upload is never trusted.
     */
    private function png_part_to_data_url(string $bytes): string {
        if ($bytes === '' || strlen($bytes) < 8 || substr($bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") {
            return '';
        }
        return 'data:image/png;base64,' . base64_encode($bytes);
    }

    private function save_thumbnail_file(string $hash, int $view_id, string $data_url): string {
        $upload_dir = wp_upload_dir();
        $pf_dir     = $upload_dir['basedir'] . '/pf-thumbnails';

        // Create directory if needed (wp_mkdir_p is safe to call if it already exists)
        wp_mkdir_p($pf_dir);

        // Protect directory from browsing
        if (!file_exists($pf_dir . '/index.php')) {
            file_put_contents($pf_dir . '/index.php', '<?php // Silence is golden.');
        }
        if (!file_exists($pf_dir . '/.htaccess')) {
            file_put_contents($pf_dir . '/.htaccess', 'Options -Indexes');
        }

        $base64  = str_replace('data:image/png;base64,', '', $data_url);

        // Cap base64 payload at ~5 MB decoded (≈6.67 MB base64) to prevent memory exhaustion
        if (strlen($base64) > 7_000_000) {
            return '';
        }

        $decoded = base64_decode($base64, true);
        if (!$decoded) {
            return '';
        }

        // Validate PNG magic bytes: \x89PNG\r\n\x1a\n
        if (strlen($decoded) < 8 || substr($decoded, 0, 8) !== "\x89PNG\r\n\x1a\n") {
            return '';
        }

        $filename = $hash . '-view-' . $view_id . '.png';
        $filepath = $pf_dir . '/' . $filename;

        if (file_put_contents($filepath, $decoded) === false) {
            return '';
        }

        return $upload_dir['baseurl'] . '/pf-thumbnails/' . $filename;
    }

    public function admin_list(\WP_REST_Request $request): \WP_REST_Response {
        $per_page = (int) ($request['per_page'] ?? 20);
        $page     = (int) ($request['page'] ?? 1);

        $rows  = $this->repo->list($per_page, $page);
        $total = $this->repo->count();

        $response = rest_ensure_response($rows);
        $response->header('X-WP-Total', $total);
        return $response;
    }

    public function admin_update_status(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $design = $this->repo->get_by_hash($request['hash']);
        if (!$design) return new \WP_Error('not_found', 'Design not found.', ['status' => 404]);

        $body = $request->get_json_params();
        $new_status = $body['status'] ?? 'draft';
        $allowed_statuses = ['draft', 'final', 'ordered', 'archived'];
        if (!in_array($new_status, $allowed_statuses, true)) {
            return new \WP_Error('invalid_status', 'Invalid status. Allowed: ' . implode(', ', $allowed_statuses), ['status' => 400]);
        }
        $this->repo->update_status((int) $design['id'], $new_status);
        $design['status'] = $new_status;
        return rest_ensure_response($design);
    }
}

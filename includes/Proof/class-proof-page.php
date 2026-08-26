<?php
namespace Snelgraveren\ProductDesigner\Proof;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Database\DesignRepository;

/**
 * The customer-facing proof page.
 *
 * A QUERY PARAMETER, not a rewrite endpoint, on purpose: add_rewrite_endpoint()
 * needs a flush_rewrite_rules(), and a flush at the wrong moment has already
 * 404'd this shop's category pages once (CLAUDE.md -> Deployment). A query var
 * needs no rules and so can break nothing.
 *
 * Renders the STORED render — the file production gets — not a fresh Fabric
 * canvas. A re-render in the customer's browser is not guaranteed to match:
 * 1.3.5 was exactly that, a Google font that failed to load on live and text
 * that came out skewed. A proof that re-renders lets the customer approve
 * something other than what is made.
 */
class ProofPage {

    // The `sgpd_proof` name is reused, unrelated, by Admin\DesignsPage's own
    // `sgpd_proof` GET filter (the proof-state dropdown on the Designs list).
    // No live collision: `template_redirect` — where this class reads it as a
    // customer-facing token — never fires in wp-admin, and DesignsPage reads
    // it only from its own admin screen. Do not "fix" one into the other.
    public const QUERY_VAR = 'sgpd_proof';

    public const ACTION_APPROVE = 'approve';

    public const ACTION_CHANGES = 'changes';

    /** Change requests allowed per token per hour. */
    public const RATE_LIMIT = 5;

    public function init(): void {
        // Priority 5, and maybe_render() exits: a matched token bypasses everything
        // else on this hook, including WooCommerce's coming-soon gating. That is
        // deliberate — a proof link must work even before the shop has launched.
        add_action('template_redirect', [$this, 'maybe_render'], 5);
    }

    public static function url(string $token): string {
        return add_query_arg(self::QUERY_VAR, $token, home_url('/'));
    }

    /** The token from the URL, or '' when it is absent or malformed. */
    public static function token_from_request(): string {
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only navigation param; the token IS the credential
        $raw = isset($_GET[self::QUERY_VAR]) ? wp_unslash($_GET[self::QUERY_VAR]) : '';
        if (!is_string($raw) || !preg_match('/^[0-9a-f]{32}$/', $raw)) {
            return '';
        }
        return $raw;
    }

    public function maybe_render(): void {
        $token = self::token_from_request();
        if ($token === '') {
            return;
        }

        // Same reasoning as the designer page: this page is per-visitor, and a
        // publicly cached copy would show one customer another's design.
        if (!defined('DONOTCACHEPAGE')) {
            define('DONOTCACHEPAGE', true);
        }
        do_action('litespeed_control_set_nocache', 'ProductForge proof page (per-customer design)');

        $design = (new DesignRepository())->get_by_proof_token($token);

        if ($design && ($_POST['sgpd_action'] ?? '') === self::ACTION_APPROVE) {
            $this->handle_approve($token, $design['proof_status']);
        }

        $notice = '';
        if ($design && ($_POST['sgpd_action'] ?? '') === self::ACTION_CHANGES) {
            $notice = $this->handle_changes($design, $token);
            $design = (new DesignRepository())->get_by_proof_token($token);
        }

        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only view selector; the token is the credential
        if ($design && isset($_GET['sgpd_view'])) {
            $this->stream_view($design, (int) $_GET['sgpd_view']);
        }

        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only status flag set by our own redirect; the token is the credential
        $cart_failed = ($_GET['sgpd_msg'] ?? '') === 'cart_failed';

        status_header($design ? 200 : 410);
        nocache_headers();

        include SGPD_PLUGIN_DIR . 'templates/proof/proof-page.php';
        exit;
    }

    /**
     * Same shape as UploadValidator's limiter. The proof page is reachable
     * without logging in, so this form must not be usable as a spam channel.
     * Counts, then reports — the caller decides what to show.
     */
    public static function rate_limited(string $token): bool {
        $key   = 'sgpd_proof_note_' . md5($token);
        $count = (int) get_transient($key);
        if ($count >= self::RATE_LIMIT) {
            return true;
        }
        set_transient($key, $count + 1, HOUR_IN_SECONDS);
        return false;
    }

    /**
     * Handle a change-request POST. Returns a user-facing notice string, or
     * '' on success (the caller re-fetches $design to feed the template the
     * new state).
     */
    private function handle_changes(array $design, string $token): string {
        if (self::rate_limited($token)) {
            return __('Too many requests. Please try again later.', 'snelgraveren-product-designer');
        }

        $note = isset($_POST['sgpd_note']) ? (string) wp_unslash($_POST['sgpd_note']) : '';
        if (trim($note) === '') {
            return __('Please describe what you would like changed.', 'snelgraveren-product-designer');
        }

        try {
            (new ProofWorkflow())->request_changes($token, $note);
        } catch (\RuntimeException $e) {
            return __('This proof can no longer be changed.', 'snelgraveren-product-designer');
        }

        do_action('sgpd_proof_changes_requested_notification', (new DesignRepository())->get_by_proof_token($token), $token);

        return '';
    }

    /**
     * Approve, then put the design in the cart and send the customer to
     * checkout.
     *
     * No nonce: the token IS the credential and the page is reachable without
     * a session, so a nonce would only break the link for anyone whose page
     * sat open. The action is not destructive — approving twice is a no-op —
     * and it is confined to the one design the token names.
     *
     * @param string $status_before proof_status as it was BEFORE this POST,
     *                              from the row maybe_render() already fetched.
     *                              ProofWorkflow::approve() itself early-returns
     *                              (no-ops) when already approved, so it alone
     *                              cannot tell a real transition from a replay —
     *                              the back button, F5, or the cart_failed "Try
     *                              again" button all re-POST the same approve
     *                              action, and without this comparison each one
     *                              re-mailed the merchant a fresh "customer
     *                              approved" notification.
     */
    private function handle_approve(string $token, string $status_before): void {
        try {
            $design = (new ProofWorkflow())->approve($token);
        } catch (\RuntimeException $e) {
            return; // Fall through to the page, which shows the current state.
        }

        ProofSession::mark_approved((string) $design['design_hash']);

        if ($status_before !== 'approved') {
            do_action('sgpd_proof_approved_notification', $design, $token);
        }

        if (function_exists('WC') && WC()->cart) {
            if (!$this->add_design_to_cart($design)) {
                // Approval is already spent (the state machine above is
                // correct and stays that way — this is a cart-layer failure:
                // a trashed/unpublished/out-of-stock product, or another
                // plugin's woocommerce_add_to_cart_validation veto). Land the
                // customer back on the proof page with something to act on
                // instead of an empty cart and no explanation — the retry
                // there is safe because add_design_to_cart() below is
                // idempotent.
                wp_safe_redirect(add_query_arg('sgpd_msg', 'cart_failed', self::url($token)));
                exit;
            }

            wp_safe_redirect(wc_get_checkout_url());
            exit;
        }

        wp_safe_redirect(self::url($token));
        exit;
    }

    /**
     * Put the design in the cart, unless it is there already.
     *
     * Guards a replayed approve POST — double-click, F5 "resend", the back
     * button, or the very old-open-tab case the no-nonce design deliberately
     * allows — from adding the SAME design a second time. Without this,
     * add_to_cart() resolves to the same WooCommerce cart id (same product +
     * same pf_design_hash) and WooCommerce bumps the quantity instead of
     * refusing, so a replay charges the customer for two.
     *
     * @return bool Whether the cart holds this design afterward (true = safe
     *              to send the customer to checkout).
     */
    private function add_design_to_cart(array $design): bool {
        $cart = WC()->cart;
        $hash = (string) $design['design_hash'];

        foreach ($cart->get_cart() as $item) {
            if (($item['pf_design_hash'] ?? '') === $hash) {
                return true;
            }
        }

        return $cart->add_to_cart(
            (int) $design['product_id'],
            1,
            0,
            [],
            ['pf_design_hash' => $hash]
        ) !== false;
    }

    /**
     * Turn a stored export blob into bytes we may stream.
     *
     * Accepts exactly what RestDesigns::sanitize_export_blob() accepts on the
     * way in: a base64 PNG data URL, or SVG markup. Anything else is refused —
     * this method hands bytes to a browser with a content-type attached, so
     * "probably an image" is not good enough.
     *
     * The write path already sanitises SVG markup before it is stored, but
     * this endpoint does not lean on that as its only barrier — it hands a
     * browser a content-type of its own, so it re-sanitises on the way out
     * too, and refuses the branch entirely when the sanitiser class is not
     * available (mirroring RestDesigns::sanitize_export_blob()'s fail-closed
     * behaviour). Remote references are stripped here specifically: the
     * vendored sanitiser has removeRemoteReferences() off by default, so a
     * stored SVG may legitimately contain `<image href="https://…">`, and
     * rendered as a top-level document that fires a request that leaks the
     * proof URL — the credential itself — in the Referer header.
     *
     * @return array{mime: string, bytes: string}|null
     */
    public static function decode_export_blob(string $blob): ?array {
        $blob = trim($blob);
        if ($blob === '') {
            return null;
        }

        // Same cap as the write path (RestDesigns::sanitize_export_blob) — a
        // stored blob was already checked against this on the way in, but this
        // method must stand on its own, not on trust in the write path.
        if (strlen($blob) > 10 * 1024 * 1024) {
            return null;
        }

        if (str_starts_with($blob, 'data:image/png;base64,')) {
            $bytes = base64_decode(substr($blob, strlen('data:image/png;base64,')), true);
            if ($bytes === false || strlen($bytes) < 8 || substr($bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") {
                return null;
            }
            return ['mime' => 'image/png', 'bytes' => $bytes];
        }

        if (str_starts_with($blob, '<')) {
            if (!class_exists(\enshrined\svgSanitize\Sanitizer::class)) {
                return null;
            }
            $sanitizer = new \enshrined\svgSanitize\Sanitizer();
            $sanitizer->removeRemoteReferences(true);
            $clean = $sanitizer->sanitize($blob);
            return $clean === false ? null : ['mime' => 'image/svg+xml', 'bytes' => $clean];
        }

        return null;
    }

    /**
     * Stream one view's full-size render.
     *
     * Always inline, never an attachment: this is a proof to look at, not the
     * production file to hand out.
     */
    private function stream_view(array $design, int $index): void {
        $view = $design['views'][$index] ?? null;
        $out  = $view ? self::decode_export_blob((string) ($view['export_svg'] ?? '')) : null;

        if (!$out) {
            status_header(404);
            exit;
        }

        status_header(200);
        nocache_headers();
        header('Content-Type: ' . $out['mime']);
        header('Content-Length: ' . strlen($out['bytes']));
        header('Content-Disposition: inline');
        header('X-Content-Type-Options: nosniff');
        // Belt-and-braces alongside the re-sanitisation above: even if a byte
        // slipped through, a document-level 'none' CSP + sandbox stops it from
        // fetching, scripting, or navigating anywhere.
        header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox");
        echo $out['bytes']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- binary image payload
        exit;
    }
}

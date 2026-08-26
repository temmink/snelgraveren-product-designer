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

    public const QUERY_VAR = 'sgpd_proof';

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

        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only view selector; the token is the credential
        if ($design && isset($_GET['sgpd_view'])) {
            $this->stream_view($design, (int) $_GET['sgpd_view']);
        }

        status_header($design ? 200 : 410);
        nocache_headers();

        include SGPD_PLUGIN_DIR . 'templates/proof/proof-page.php';
        exit;
    }

    /**
     * Turn a stored export blob into bytes we may stream.
     *
     * Accepts exactly what RestDesigns::sanitize_export_blob() accepts on the
     * way in: a base64 PNG data URL, or SVG markup. Anything else is refused —
     * this method hands bytes to a browser with a content-type attached, so
     * "probably an image" is not good enough.
     *
     * @return array{mime: string, bytes: string}|null
     */
    public static function decode_export_blob(string $blob): ?array {
        $blob = trim($blob);
        if ($blob === '') {
            return null;
        }

        if (str_starts_with($blob, 'data:image/png;base64,')) {
            $bytes = base64_decode(substr($blob, strlen('data:image/png;base64,')), true);
            if ($bytes === false || substr($bytes, 0, 4) !== "\x89PNG") {
                return null;
            }
            return ['mime' => 'image/png', 'bytes' => $bytes];
        }

        if (str_starts_with($blob, '<')) {
            return ['mime' => 'image/svg+xml', 'bytes' => $blob];
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

        nocache_headers();
        header('Content-Type: ' . $out['mime']);
        header('Content-Length: ' . strlen($out['bytes']));
        header('Content-Disposition: inline');
        header('X-Content-Type-Options: nosniff');
        echo $out['bytes']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- binary image payload
        exit;
    }
}

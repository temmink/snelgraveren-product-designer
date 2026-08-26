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

        status_header($design ? 200 : 410);
        nocache_headers();

        include SGPD_PLUGIN_DIR . 'templates/proof/proof-page.php';
        exit;
    }
}

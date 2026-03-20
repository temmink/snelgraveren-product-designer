<?php
namespace ProductDesigner\Security;

defined( 'ABSPATH' ) || exit;

class CapabilityChecker {

    public static function can_manage_templates(): bool {
        return current_user_can( 'edit_pd_templates' ) || current_user_can( 'manage_woocommerce' );
    }

    /**
     * Get or create the guest session ID from a cookie.
     *
     * Reads the pd_session_id cookie. If absent, generates a new 32-char hex
     * ID, sets the cookie for 30 days, and returns it. Returns empty string in
     * CLI/cron contexts where headers can't be sent.
     */
    public static function current_session_id(): string {
        if ( isset( $_COOKIE['pd_session_id'] ) ) {
            $raw = sanitize_text_field( wp_unslash( $_COOKIE['pd_session_id'] ) );
            // Validate format: exactly 32 hex chars.
            if ( preg_match( '/^[0-9a-f]{32}$/', $raw ) ) {
                return $raw;
            }
        }

        // Generate a new session ID if we can still set cookies.
        if ( headers_sent() ) {
            return '';
        }

        $session_id = bin2hex( random_bytes( 16 ) );
        setcookie(
            'pd_session_id',
            $session_id,
            array(
                'expires'  => time() + ( 30 * DAY_IN_SECONDS ),
                'path'     => COOKIEPATH,
                'domain'   => COOKIE_DOMAIN,
                'secure'   => is_ssl(),
                'httponly' => true,
                'samesite' => 'Lax',
            )
        );

        // Write back to $_COOKIE so subsequent calls within the same request
        // return the same session ID instead of generating a new one.
        $_COOKIE['pd_session_id'] = $session_id;

        return $session_id;
    }
}

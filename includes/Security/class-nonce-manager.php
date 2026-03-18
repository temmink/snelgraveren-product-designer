<?php
namespace ProductDesigner\Security;

defined('ABSPATH') || exit;

class NonceManager {

    public static function create(string $action = 'pd-rest'): string {
        return wp_create_nonce($action);
    }

    public static function verify(string $nonce, string $action = 'pd-rest'): bool {
        return (bool) wp_verify_nonce($nonce, $action);
    }

    /**
     * Check the nonce sent via X-WP-Nonce header or _wpnonce body param.
     * Returns true if valid, false otherwise.
     */
    public static function check_request(): bool {
        $nonce = $_SERVER['HTTP_X_WP_NONCE'] ?? '';
        if (empty($nonce)) {
            $nonce = $_REQUEST['_wpnonce'] ?? '';
        }
        return self::verify(sanitize_text_field(wp_unslash($nonce)));
    }
}

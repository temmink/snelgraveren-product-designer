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

}

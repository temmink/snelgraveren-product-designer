<?php
namespace ProductForge;

defined('ABSPATH') || exit;

class Deactivator {

    public static function deactivate(): void {
        wp_clear_scheduled_hook(\ProductForge\Cleanup::HOOK);
        flush_rewrite_rules();
    }
}

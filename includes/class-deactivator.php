<?php
namespace Snelgraveren\ProductDesigner;

defined('ABSPATH') || exit;

class Deactivator {

    public static function deactivate(): void {
        wp_clear_scheduled_hook(\Snelgraveren\ProductDesigner\Cleanup::HOOK);
        flush_rewrite_rules();
    }
}

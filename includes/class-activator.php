<?php
namespace ProductDesigner;

defined('ABSPATH') || exit;

class Activator {

    public static function activate(): void {
        Database\DbManager::run_migrations();
        flush_rewrite_rules();
    }
}

<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

/**
 * Migration 300: Add background_transform column to template_views.
 * Stores JSON {scaleX, scaleY, left, top} for background image positioning.
 */
class Migration300 {

    public function up(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pf_template_views';

        $col = $wpdb->get_results("SHOW COLUMNS FROM `{$table}` LIKE 'background_transform'");
        if (empty($col)) {
            $wpdb->query("ALTER TABLE `{$table}` ADD COLUMN `background_transform` TEXT NOT NULL DEFAULT '{}' AFTER `background_url`");
        }
    }
}

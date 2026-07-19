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

        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal ($wpdb->prefix . static string), no user input
        $col = $wpdb->get_results("SHOW COLUMNS FROM `{$table}` LIKE 'background_transform'");
        if (empty($col)) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal, static DDL
            $wpdb->query("ALTER TABLE `{$table}` ADD COLUMN `background_transform` TEXT NOT NULL DEFAULT '{}' AFTER `background_url`");
        }
    }
}

<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class Migration1000 {

    public function up(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pf_design_views';

        // Add export_vector_embed: the font-embedded SVG variant (text kept
        // editable, fonts inlined as base64 @font-face). The outlined variant
        // lives in export_vector and is the default SVG export.
        $col = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = 'export_vector_embed'",
                DB_NAME, $table
            )
        );

        if (!$col) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal
            $wpdb->query("ALTER TABLE `{$table}` ADD COLUMN `export_vector_embed` LONGTEXT NOT NULL DEFAULT '' AFTER `export_vector`");
        }
    }
}

<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class Migration700 {

    public function up(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pf_design_views';

        // Add export_svg column for storing Fabric.js canvas.toSVG() output
        $col = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = 'export_svg'",
                DB_NAME, $table
            )
        );

        if (!$col) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal
            $wpdb->query("ALTER TABLE `{$table}` ADD COLUMN `export_svg` LONGTEXT NOT NULL DEFAULT '' AFTER `thumbnail`");
        }
    }
}

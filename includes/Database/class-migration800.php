<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class Migration800 {

    public function up(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pf_design_views';

        // Add export_vector column for storing the real Fabric.js canvas.toSVG()
        // vector output, separate from export_svg (which holds the raster PNG used
        // for PDF/PNG fidelity). The SVG export pipeline prefers this column.
        $col = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = 'export_vector'",
                DB_NAME, $table
            )
        );

        if (!$col) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal
            $wpdb->query("ALTER TABLE `{$table}` ADD COLUMN `export_vector` LONGTEXT NOT NULL DEFAULT '' AFTER `export_svg`");
        }
    }
}

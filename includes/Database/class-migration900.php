<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

class Migration900 {

    public function up(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pf_template_views';

        // Add width_mm: the real-world physical width of the design area in
        // millimetres. 0 = unset (export falls back to the 96-DPI pixel
        // assumption). The physical height is derived from the canvas aspect
        // ratio on export, so no separate height_mm column is needed.
        $col = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = 'width_mm'",
                DB_NAME, $table
            )
        );

        if (!$col) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal
            $wpdb->query("ALTER TABLE `{$table}` ADD COLUMN `width_mm` DECIMAL(7,2) NOT NULL DEFAULT 0 AFTER `canvas_height`");
        }
    }
}

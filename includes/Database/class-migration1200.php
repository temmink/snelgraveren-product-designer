<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

/**
 * Migration 1200: native LightBurn project data per design view.
 *
 * `export_lbrn` holds a browser-generated .lbrn2 document (plain XML): texts as
 * native LightBurn Text shapes — string, font, bend — so the laser operator
 * gets a file that is fully EDITABLE in LightBurn, and vector art as Path
 * shapes in millimetres. Generated at save time like `export_vector`, because
 * only the browser has the live Fabric objects (curve presets, ink widths)
 * the writer reads its numbers from.
 */
class Migration1200 {

    public function up(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pf_design_views';

        $column = $wpdb->get_var($wpdb->prepare(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = 'export_lbrn'",
            DB_NAME,
            $table
        ));
        if (!$column) {
            $wpdb->query("ALTER TABLE `{$table}` ADD COLUMN `export_lbrn` LONGTEXT NOT NULL DEFAULT '' AFTER `export_vector_embed`");
        }
    }
}

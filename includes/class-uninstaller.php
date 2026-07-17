<?php
namespace ProductForge;

defined('ABSPATH') || exit;

/**
 * Uninstall cleanup. Invoked via Freemius' after_uninstall hook (see
 * freemius-init.php) or, on installs without the Freemius SDK, via
 * register_uninstall_hook in productforge.php. There is deliberately NO
 * uninstall.php — Freemius deployment rejects it.
 *
 * Only deletes data when the user explicitly opted in via the plugin
 * settings (pf_delete_data_on_uninstall). This prevents accidental data
 * loss when reinstalling or updating the plugin.
 */
class Uninstaller {

    public static function uninstall(): void {
        $delete_data = get_option('pf_delete_data_on_uninstall', false);

        if (!$delete_data) {
            return;
        }

        global $wpdb;

        $tables = [
            'pf_clipart_items',
            'pf_clipart_collections',
            'pf_design_template_views',
            'pf_design_templates',
            'pf_price_log',
            'pf_exports',
            'pf_design_views',
            'pf_designs',
            'pf_template_views',
            'pf_templates',
            'pf_fonts',
        ];

        foreach ($tables as $table) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table names from a constant list
            $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}{$table}");
        }

        delete_option('pf_db_version');
        delete_option('pf_delete_data_on_uninstall');
    }
}

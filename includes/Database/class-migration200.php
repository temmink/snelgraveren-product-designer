<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

/**
 * Migration 200: Rename tables from pd_ prefix to pf_ prefix.
 *
 * This handles the rename from "Product Designer" to "ProductForge".
 * Safe to run even if the old tables don't exist (e.g. fresh install).
 */
class Migration200 {

    public function up(): void {
        global $wpdb;

        $renames = [
            'pd_templates'      => 'pf_templates',
            'pd_template_views' => 'pf_template_views',
            'pd_designs'        => 'pf_designs',
            'pd_design_views'   => 'pf_design_views',
            'pd_exports'        => 'pf_exports',
            'pd_price_log'      => 'pf_price_log',
        ];

        foreach ($renames as $old => $new) {
            $old_table = $wpdb->prefix . $old;
            $new_table = $wpdb->prefix . $new;

            // Only rename if the old table exists and new one doesn't.
            $old_exists = $wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $old_table));
            $new_exists = $wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $new_table));

            if ($old_exists && !$new_exists) {
                $wpdb->query("RENAME TABLE `{$old_table}` TO `{$new_table}`");
            }
        }

        // Migrate the old option key if it exists.
        $old_version = get_option('pd_db_version');
        if ($old_version !== false) {
            delete_option('pd_db_version');
        }

        // Migrate post meta keys.
        $meta_renames = [
            '_pd_designer_enabled' => '_pf_designer_enabled',
            '_pd_template_id'      => '_pf_template_id',
            '_pd_display_mode'     => '_pf_display_mode',
        ];

        foreach ($meta_renames as $old_key => $new_key) {
            $wpdb->update(
                $wpdb->postmeta,
                ['meta_key' => $new_key],
                ['meta_key' => $old_key],
                ['%s'],
                ['%s']
            );
        }

        // Migrate transients (just delete old ones — they'll be rebuilt).
        $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_pd_template_%' OR option_name LIKE '_transient_timeout_pd_template_%'");
    }
}

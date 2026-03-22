<?php
namespace ProductForge;

defined('WP_UNINSTALL_PLUGIN') || exit;

// Only delete data if the user has explicitly opted in via the plugin settings.
// This prevents accidental data loss when reinstalling or updating the plugin.
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
    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}{$table}");
}

delete_option('pf_db_version');
delete_option('pf_delete_data_on_uninstall');

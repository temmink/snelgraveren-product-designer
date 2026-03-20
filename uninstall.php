<?php
namespace ProductForge;

defined('WP_UNINSTALL_PLUGIN') || exit;

global $wpdb;

$tables = [
    'pf_price_log',
    'pf_exports',
    'pf_design_views',
    'pf_designs',
    'pf_template_views',
    'pf_templates',
];

foreach ($tables as $table) {
    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}{$table}");
}

delete_option('pf_db_version');

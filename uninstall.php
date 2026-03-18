<?php
namespace ProductDesigner;

defined('WP_UNINSTALL_PLUGIN') || exit;

global $wpdb;

$tables = [
    'pd_price_log',
    'pd_exports',
    'pd_design_views',
    'pd_designs',
    'pd_template_views',
    'pd_templates',
];

foreach ($tables as $table) {
    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}{$table}");
}

delete_option('pd_db_version');

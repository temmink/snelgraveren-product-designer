<?php
/**
 * PHPUnit bootstrap — loads WordPress and activates the plugin.
 * Run from Docker: docker compose exec wordpress bash -c "cd wp-content/plugins/productforge && phpunit"
 */

// Load WordPress
require_once '/var/www/html/wp-load.php';

// Activate plugin if not already active
if (!is_plugin_active('productforge/snelgraveren-product-designer.php')) {
    activate_plugin('productforge/snelgraveren-product-designer.php');
}

// Ensure our tables exist
Snelgraveren\ProductDesigner\Database\DbManager::run_migrations();

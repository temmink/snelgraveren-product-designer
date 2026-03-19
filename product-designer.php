<?php
/**
 * Plugin Name: Product Designer for WooCommerce
 * Plugin URI:  https://example.com/product-designer
 * Description: Let customers personalise products with text, images, and SVGs using a drag-and-drop editor.
 * Version:     1.0.0
 * Author:      Martin Temmink
 * License:     GPL-2.0-or-later
 * Text Domain: product-designer
 * Domain Path: /languages
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * WC requires at least: 8.0
 * WC tested up to:      9.9
 */

namespace ProductDesigner;

defined('ABSPATH') || exit;

define('PD_VERSION',    '1.0.0');
define('PD_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('PD_PLUGIN_URL', plugin_dir_url(__FILE__));
define('PD_PLUGIN_FILE', __FILE__);

// PSR-4 autoloader
require_once PD_PLUGIN_DIR . 'includes/class-autoloader.php';
Autoloader::register();

// Composer autoloader (vendor/)
if (file_exists(PD_PLUGIN_DIR . 'vendor/autoload.php')) {
    require_once PD_PLUGIN_DIR . 'vendor/autoload.php';
}

// HPOS compatibility declaration
add_action('before_woocommerce_init', function () {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});

// Prevent WordPress.org from offering updates for this custom plugin.
// The slug 'product-designer' exists on the public repo; without this filter
// WordPress would overwrite this codebase with someone else's plugin.
add_filter('site_transient_update_plugins', function ($transient) {
    $basename = plugin_basename(__FILE__);
    if (isset($transient->response[$basename])) {
        unset($transient->response[$basename]);
    }
    return $transient;
});

// Load plugin text domain for translations
add_action('init', function () {
    load_plugin_textdomain('product-designer', false, dirname(plugin_basename(__FILE__)) . '/languages');
});

// Boot plugin
add_action('plugins_loaded', function () {
    ProductDesigner::instance();
});

// Activation / deactivation hooks
register_activation_hook(__FILE__, [Activator::class, 'activate']);
register_deactivation_hook(__FILE__, [Deactivator::class, 'deactivate']);

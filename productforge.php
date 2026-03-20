<?php
/**
 * Plugin Name: ProductForge
 * Plugin URI:  https://example.com/productforge
 * Description: Let customers personalise products with text, images, and SVGs using a drag-and-drop editor.
 * Version:     1.0.0
 * Author:      Martin Temmink
 * License:     GPL-2.0-or-later
 * Text Domain: productforge
 * Domain Path: /languages
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * WC requires at least: 8.0
 * WC tested up to:      9.9
 */

namespace ProductForge;

defined('ABSPATH') || exit;

define('PF_VERSION',    '1.0.0');
define('PF_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('PF_PLUGIN_URL', plugin_dir_url(__FILE__));
define('PF_PLUGIN_FILE', __FILE__);

// PSR-4 autoloader
require_once PF_PLUGIN_DIR . 'includes/class-autoloader.php';
Autoloader::register();

// Composer autoloader (vendor/)
if (file_exists(PF_PLUGIN_DIR . 'vendor/autoload.php')) {
    require_once PF_PLUGIN_DIR . 'vendor/autoload.php';
}

// HPOS compatibility declaration
add_action('before_woocommerce_init', function () {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});

// Prevent WordPress.org from offering updates for this custom plugin.
// The file slug 'product-designer' may match an unrelated public plugin.
add_filter('site_transient_update_plugins', function ($transient) {
    $basename = plugin_basename(__FILE__);
    if (isset($transient->response[$basename])) {
        unset($transient->response[$basename]);
    }
    return $transient;
});

// Also block the API check itself so WP never even queries for this slug.
add_filter('http_request_args', function ($args, $url) {
    if (strpos($url, 'api.wordpress.org/plugins/update-check') === false) {
        return $args;
    }
    if (isset($args['body']['plugins'])) {
        $plugins = json_decode($args['body']['plugins'], true);
        $basename = plugin_basename(PF_PLUGIN_FILE);
        unset($plugins['plugins'][$basename], $plugins['active'][array_search($basename, $plugins['active'] ?? [])]);
        $args['body']['plugins'] = wp_json_encode($plugins);
    }
    return $args;
}, 10, 2);

// Load plugin text domain before booting so translated strings in plugins_loaded work
add_action('plugins_loaded', function () {
    load_plugin_textdomain('productforge', false, dirname(plugin_basename(__FILE__)) . '/languages');
}, 1);

// Boot plugin
add_action('plugins_loaded', function () {
    ProductForge::instance();
});

// Activation / deactivation hooks
register_activation_hook(__FILE__, [Activator::class, 'activate']);
register_deactivation_hook(__FILE__, [Deactivator::class, 'deactivate']);

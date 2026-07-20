<?php
/**
 * Plugin Name: Snelgraveren Product Designer for WooCommerce
 * Plugin URI:  https://github.com/temmink/snelgraveren-product-designer
 * Description: Let customers personalise products with text, images, and SVGs using a drag-and-drop editor.
 * Version:     1.2.1
 * Author:      Martin Temmink
 * License:     GPL-2.0-or-later
 * Text Domain: snelgraveren-product-designer
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Requires Plugins:  woocommerce
 * WC requires at least: 8.0
 * WC tested up to:      9.9
 *
 * @fs_premium_only /includes/Export/class-premium-exports.php, /includes/Pricing/, /includes/API/class-rest-pricing.php, /includes/API/class-rest-palettes.php, /includes/API/class-rest-fonts-admin.php, /includes/API/class-rest-clipart-admin.php, /vendor/tecnickcom/
 */

namespace ProductForge;

defined('ABSPATH') || exit;

define('SGPD_VERSION',    '1.2.1');
define('SGPD_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('SGPD_PLUGIN_URL', plugin_dir_url(__FILE__));
define('SGPD_PLUGIN_FILE', __FILE__);

// PSR-4 autoloader
require_once SGPD_PLUGIN_DIR . 'includes/class-autoloader.php';
Autoloader::register();

// Composer autoloader (vendor/)
if (file_exists(SGPD_PLUGIN_DIR . 'vendor/autoload.php')) {
    require_once SGPD_PLUGIN_DIR . 'vendor/autoload.php';
}

// Freemius SDK (non-namespaced file so sgpd_fs() is global)
if (file_exists(SGPD_PLUGIN_DIR . 'freemius-init.php')) {
    require_once SGPD_PLUGIN_DIR . 'freemius-init.php';
}

// HPOS compatibility declaration
add_action('before_woocommerce_init', function () {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});

// Boot plugin. Hard requirement: WooCommerce. The "Requires Plugins" header
// enforces this on WP 6.5+, but a runtime guard is still needed for older
// WordPress versions and manual/FTP installs — without it every frontend
// pageview fatals on WooCommerce functions (is_product() etc.).
add_action('plugins_loaded', function () {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', function () {
            echo '<div class="notice notice-error"><p>'
                . esc_html__('Snelgraveren Product Designer for WooCommerce requires WooCommerce to be installed and active. The plugin is idle until WooCommerce is activated.', 'snelgraveren-product-designer')
                . '</p></div>';
        });
        return;
    }
    ProductForge::instance();
});

// Activation / deactivation hooks
register_activation_hook(__FILE__, [Activator::class, 'activate']);
register_deactivation_hook(__FILE__, [Deactivator::class, 'deactivate']);

// Uninstall cleanup. With the Freemius SDK present, its after_uninstall hook
// (wired in freemius-init.php) handles this; the WP-native hook is only the
// fallback for installs without Freemius.
if (!function_exists('sgpd_fs')) {
    register_uninstall_hook(__FILE__, [Uninstaller::class, 'uninstall']);
}

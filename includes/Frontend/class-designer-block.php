<?php
namespace ProductForge\Frontend;

defined('ABSPATH') || exit;

/**
 * Gutenberg block "snelgraveren/product-designer" — the block-theme equivalent of the
 * [productforge] shortcode. WooCommerce's blockified single-product template
 * never fires woocommerce_before_add_to_cart_button, so the hook-based
 * auto-render silently does nothing there; this block gives merchants an
 * explicit placement that works in any template.
 *
 * Dynamic block: the editor shows a placeholder (blocks/designer/editor.js),
 * the frontend render delegates to the shortcode pipeline so every check
 * (is_product, designer enabled, duplicate-render prevention, display mode)
 * lives in exactly one place: Frontend::shortcode().
 */
class DesignerBlock {

    public function init(): void {
        add_action('init', [$this, 'register']);
    }

    public function register(): void {
        if (!function_exists('register_block_type')) {
            return;
        }

        register_block_type(PF_PLUGIN_DIR . 'blocks/designer', [
            'render_callback' => [$this, 'render'],
        ]);

        // Handle is derived by WP from block.json (name + "editor-script").
        wp_set_script_translations('snelgraveren-product-designer-editor-script', 'snelgraveren-product-designer', PF_PLUGIN_DIR . 'languages');
    }

    /**
     * Frontend render. The shortcode only exists when Frontend booted (non-
     * admin context); everywhere else this renders nothing rather than the
     * literal shortcode text.
     */
    public function render(): string {
        if (!shortcode_exists('productforge')) {
            return '';
        }
        return do_shortcode('[productforge]');
    }
}

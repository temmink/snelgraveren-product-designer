<?php
namespace ProductDesigner\Frontend;

defined('ABSPATH') || exit;

class Frontend {

    public function init(): void {
        add_action('wp_enqueue_scripts', [$this, 'enqueue_assets']);
        add_action('woocommerce_before_add_to_cart_button', [$this, 'render_designer']);
        add_filter('woocommerce_add_cart_item_data', [$this, 'add_cart_item_data'], 10, 2);
    }

    /**
     * Stub for Phase 4 — attach design_hash to cart item data.
     */
    public function add_cart_item_data(array $cart_item_data, int $product_id): array {
        return $cart_item_data;
    }

    public function enqueue_assets(): void {
        if (!is_product()) {
            return;
        }

        global $post;
        $product_id = $post->ID;

        if (!get_post_meta($product_id, '_pd_designer_enabled', true)) {
            return;
        }

        $template_id = (int) get_post_meta($product_id, '_pd_template_id', true);
        if (!$template_id) {
            return;
        }

        $dist_path = PD_PLUGIN_DIR . 'dist/';
        $dist_url  = PD_PLUGIN_URL . 'dist/';

        // Enqueue JS
        $js_file = 'frontend-designer.js';
        if (file_exists($dist_path . $js_file)) {
            wp_enqueue_script(
                'pd-frontend-designer',
                $dist_url . $js_file,
                [],
                PD_VERSION,
                true
            );

            wp_localize_script('pd-frontend-designer', 'pdDesigner', [
                'template_id'     => $template_id,
                'product_id'      => $product_id,
                'display_mode'    => get_post_meta($product_id, '_pd_display_mode', true) ?: 'embedded',
                'nonce'           => wp_create_nonce('wp_rest'),
                'api_base'        => rest_url('pd/v1'),
                'currency_symbol' => function_exists('get_woocommerce_currency_symbol')
                    ? get_woocommerce_currency_symbol()
                    : '€',
            ]);
        }

        // Enqueue CSS if present
        $css_file = 'frontend-designer.css';
        if (file_exists($dist_path . $css_file)) {
            wp_enqueue_style(
                'pd-frontend-designer',
                $dist_url . $css_file,
                [],
                PD_VERSION
            );
        }
    }

    public function render_designer(): void {
        if (!is_product()) {
            return;
        }

        global $post;
        if (!get_post_meta($post->ID, '_pd_designer_enabled', true)) {
            return;
        }

        $mode = get_post_meta($post->ID, '_pd_display_mode', true) ?: 'embedded';
        echo '<div id="pd-designer-root" data-mode="' . esc_attr($mode) . '"></div>';

        if ($mode === 'modal') {
            echo '<button type="button" class="pd-open-designer button">Customize Product</button>';
        }
    }
}

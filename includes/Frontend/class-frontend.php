<?php
namespace ProductDesigner\Frontend;

defined('ABSPATH') || exit;

class Frontend {

    public function init(): void {
        add_action('wp_enqueue_scripts', [$this, 'enqueue_assets']);
        add_action('woocommerce_before_add_to_cart_button', [$this, 'render_designer']);
        add_filter('woocommerce_add_cart_item_data', [$this, 'add_cart_item_data'], 10, 2);
        add_filter('woocommerce_cart_item_thumbnail', [$this, 'cart_item_thumbnail'], 10, 3);
        add_filter('woocommerce_get_item_data', [$this, 'display_cart_item_data'], 10, 2);
        // Block cart: override thumbnail via Store API
        add_filter('woocommerce_store_api_cart_item_images', [$this, 'store_api_cart_item_images'], 10, 3);
        // Append design hash to cart item permalink so designer can reload saved design
        add_filter('woocommerce_cart_item_permalink', [$this, 'cart_item_permalink'], 10, 3);
        // Replace product gallery image with design thumbnail when returning from cart
        add_filter('woocommerce_single_product_image_thumbnail_html', [$this, 'override_gallery_thumbnail_html'], 10, 2);
    }

    /**
     * Attach design_hash to cart item data when adding to cart.
     */
    public function add_cart_item_data(array $cart_item_data, int $product_id): array {
        // phpcs:disable WordPress.Security.NonceVerification
        if (!empty($_POST['pd_design_hash'])) {
            $hash = sanitize_text_field(wp_unslash($_POST['pd_design_hash']));
            if (preg_match('/^[0-9a-f]{32}$/', $hash)) {
                $cart_item_data['pd_design_hash'] = $hash;
            }
        }
        // phpcs:enable
        return $cart_item_data;
    }

    /**
     * Get the thumbnail URL for a design hash.
     */
    private function get_design_thumbnail_url(string $hash): string {
        $repo   = new \ProductDesigner\Database\DesignRepository();
        $design = $repo->get_by_hash($hash);
        if (!$design || empty($design['views'])) {
            return '';
        }

        $thumb_url = $design['views'][0]['thumbnail'] ?? '';
        if (!empty($thumb_url) && filter_var($thumb_url, FILTER_VALIDATE_URL)) {
            return $thumb_url;
        }

        return '';
    }

    /**
     * Show design thumbnail in classic cart.
     */
    public function cart_item_thumbnail(string $thumbnail, array $cart_item, string $cart_item_key): string {
        if (empty($cart_item['pd_design_hash'])) {
            return $thumbnail;
        }

        $thumb_url = $this->get_design_thumbnail_url($cart_item['pd_design_hash']);
        if (!empty($thumb_url)) {
            return '<img src="' . esc_url($thumb_url) . '" alt="' . esc_attr__('Custom design', 'product-designer') . '" style="max-width:100px;max-height:100px;" />';
        }

        return $thumbnail;
    }

    /**
     * Show design thumbnail in block-based cart (Store API).
     */
    public function store_api_cart_item_images(array $images, array $cart_item, string $cart_item_key): array {
        if (empty($cart_item['pd_design_hash'])) {
            return $images;
        }

        $thumb_url = $this->get_design_thumbnail_url($cart_item['pd_design_hash']);
        if (empty($thumb_url)) {
            return $images;
        }

        return [
            (object) [
                'id'        => 0,
                'src'       => $thumb_url,
                'thumbnail' => $thumb_url,
                'srcset'    => '',
                'sizes'     => '',
                'name'      => __('Custom Design', 'product-designer'),
                'alt'       => __('Your custom product design', 'product-designer'),
            ],
        ];
    }

    /**
     * Display "Customized" label in cart item data.
     */
    public function display_cart_item_data(array $item_data, array $cart_item): array {
        if (!empty($cart_item['pd_design_hash'])) {
            $item_data[] = [
                'key'   => __('Design', 'product-designer'),
                'value' => __('Customized', 'product-designer'),
            ];
        }
        return $item_data;
    }

    /**
     * Append design hash to cart item permalink so the designer can reload saved designs.
     */
    public function cart_item_permalink(string $permalink, array $cart_item, string $cart_item_key): string {
        if (!empty($cart_item['pd_design_hash']) && !empty($permalink)) {
            $permalink = add_query_arg('pd_design', $cart_item['pd_design_hash'], $permalink);
        }
        return $permalink;
    }

    /**
     * Get the existing design hash from the URL query parameter, if valid.
     */
    private function get_design_hash_from_url(): string {
        // phpcs:disable WordPress.Security.NonceVerification
        if (!empty($_GET['pd_design']) && preg_match('/^[0-9a-f]{32}$/', $_GET['pd_design'])) {
            return sanitize_text_field(wp_unslash($_GET['pd_design']));
        }
        // phpcs:enable
        return '';
    }

    /**
     * Replace the product gallery image with the design thumbnail when returning from cart.
     */
    public function override_gallery_thumbnail_html(string $html, int $attachment_id): string {
        $hash = $this->get_design_hash_from_url();
        if (empty($hash)) {
            return $html;
        }

        $thumb_url = $this->get_design_thumbnail_url($hash);
        if (!empty($thumb_url)) {
            return '<div data-thumb="' . esc_url($thumb_url) . '" class="woocommerce-product-gallery__image">'
                . '<img src="' . esc_url($thumb_url) . '" alt="' . esc_attr__('Your custom design', 'product-designer') . '" class="wp-post-image" />'
                . '</div>';
        }

        return $html;
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

            $js_config = [
                'template_id'     => $template_id,
                'product_id'      => $product_id,
                'display_mode'    => get_post_meta($product_id, '_pd_display_mode', true) ?: 'embedded',
                'nonce'           => wp_create_nonce('wp_rest'),
                'api_base'        => rest_url('pd/v1'),
                'currency_symbol' => function_exists('get_woocommerce_currency_symbol')
                    ? get_woocommerce_currency_symbol()
                    : '€',
            ];

            // If returning from cart with an existing design, pass the hash and auto-open
            $existing_hash = $this->get_design_hash_from_url();
            if (!empty($existing_hash)) {
                $js_config['existing_design_hash'] = $existing_hash;
                $js_config['auto_open'] = true;
            }

            wp_localize_script('pd-frontend-designer', 'pdDesigner', $js_config);
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

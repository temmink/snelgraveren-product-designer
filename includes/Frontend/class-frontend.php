<?php
namespace ProductForge\Frontend;

defined('ABSPATH') || exit;

class Frontend {

    private ?\ProductForge\Database\DesignRepository $design_repo = null;

    private function design_repo(): \ProductForge\Database\DesignRepository {
        if (!$this->design_repo) {
            $this->design_repo = new \ProductForge\Database\DesignRepository();
        }
        return $this->design_repo;
    }

    public function init(): void {
        add_action('wp_enqueue_scripts', [$this, 'enqueue_assets']);
        add_action('woocommerce_before_add_to_cart_button', [$this, 'render_designer']);

        // Exclude our frontend JS from LiteSpeed Cache JS combining/minification.
        // Our IIFE bundle includes React internally and breaks when concatenated.
        add_filter('litespeed_optimize_js_excludes', function ($excludes) {
            $excludes[] = 'frontend-designer.js';
            return $excludes;
        });
        add_shortcode('productforge', [$this, 'shortcode']);
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
        if (!empty($_POST['pf_design_hash'])) {
            $hash = sanitize_text_field(wp_unslash($_POST['pf_design_hash']));
            if (preg_match('/^[0-9a-f]{32}$/', $hash)) {
                $cart_item_data['pf_design_hash'] = $hash;
            }
        }
        // phpcs:enable
        return $cart_item_data;
    }

    /**
     * Get all thumbnail URLs for a design hash.
     *
     * @return string[] Valid thumbnail URLs, one per view.
     */
    private function get_design_thumbnail_urls(string $hash): array {
        $design = $this->design_repo()->get_by_hash($hash);
        if (!$design || empty($design['views'])) {
            return [];
        }

        $urls = [];
        foreach ($design['views'] as $view) {
            $thumb_url = $view['thumbnail'] ?? '';
            if (!empty($thumb_url) && filter_var($thumb_url, FILTER_VALIDATE_URL)) {
                $urls[] = $thumb_url;
            }
        }
        return $urls;
    }

    /**
     * Show design thumbnails in classic cart.
     */
    public function cart_item_thumbnail(string $thumbnail, array $cart_item, string $cart_item_key): string {
        if (empty($cart_item['pf_design_hash'])) {
            return $thumbnail;
        }

        $urls = $this->get_design_thumbnail_urls($cart_item['pf_design_hash']);
        if (empty($urls)) {
            return $thumbnail;
        }

        $html = '<div style="display:flex;gap:4px;">';
        foreach ($urls as $url) {
            $html .= '<img src="' . esc_url($url) . '" alt="' . esc_attr__('Custom design', 'productforge') . '" style="max-width:80px;max-height:80px;border-radius:3px;" />';
        }
        $html .= '</div>';
        return $html;
    }

    /**
     * Show design thumbnails in block-based cart (Store API).
     */
    public function store_api_cart_item_images(array $images, array $cart_item, string $cart_item_key): array {
        if (empty($cart_item['pf_design_hash'])) {
            return $images;
        }

        $urls = $this->get_design_thumbnail_urls($cart_item['pf_design_hash']);
        if (empty($urls)) {
            return $images;
        }

        $result = [];
        foreach ($urls as $i => $url) {
            $result[] = (object) [
                'id'        => 0,
                'src'       => $url,
                'thumbnail' => $url,
                'srcset'    => '',
                'sizes'     => '',
                'name'      => sprintf(__('Custom Design – View %d', 'productforge'), $i + 1),
                'alt'       => sprintf(__('Your custom product design – view %d', 'productforge'), $i + 1),
            ];
        }
        return $result;
    }

    /**
     * Display "Customized" label in cart item data.
     */
    public function display_cart_item_data(array $item_data, array $cart_item): array {
        if (!empty($cart_item['pf_design_hash'])) {
            $item_data[] = [
                'key'   => __('Design', 'productforge'),
                'value' => __('Customized', 'productforge'),
            ];
        }
        return $item_data;
    }

    /**
     * Append design hash to cart item permalink so the designer can reload saved designs.
     */
    public function cart_item_permalink(string $permalink, array $cart_item, string $cart_item_key): string {
        if (!empty($cart_item['pf_design_hash']) && !empty($permalink)) {
            // Use the canonical product permalink to avoid SEO plugin redirects
            // stripping query parameters during URL normalization.
            $product = wc_get_product($cart_item['product_id'] ?? 0);
            $base = $product ? $product->get_permalink() : $permalink;
            $permalink = add_query_arg('pf_design', $cart_item['pf_design_hash'], $base);
        }
        return $permalink;
    }

    /**
     * Get the existing design hash from the URL query parameter, if valid.
     */
    private function get_design_hash_from_url(): string {
        // phpcs:disable WordPress.Security.NonceVerification
        if (!empty($_GET['pf_design']) && preg_match('/^[0-9a-f]{32}$/', $_GET['pf_design'])) {
            return sanitize_text_field(wp_unslash($_GET['pf_design']));
        }
        // phpcs:enable
        return '';
    }

    /**
     * Replace the product gallery image with the design thumbnail when returning from cart.
     */
    public function override_gallery_thumbnail_html(string $html, $attachment_id): string {
        $hash = $this->get_design_hash_from_url();
        if (empty($hash)) {
            return $html;
        }

        $urls = $this->get_design_thumbnail_urls($hash);
        $thumb_url = $urls[0] ?? '';
        if (!empty($thumb_url)) {
            return '<div data-thumb="' . esc_url($thumb_url) . '" class="woocommerce-product-gallery__image">'
                . '<img src="' . esc_url($thumb_url) . '" alt="' . esc_attr__('Your custom design', 'productforge') . '" class="wp-post-image" />'
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

        if (!get_post_meta($product_id, '_pf_designer_enabled', true)) {
            return;
        }

        $template_id = (int) get_post_meta($product_id, '_pf_template_id', true);
        if (!$template_id) {
            return;
        }

        $dist_path = PF_PLUGIN_DIR . 'dist/';
        $dist_url  = PF_PLUGIN_URL . 'dist/';

        // Enqueue JS
        $js_file = 'frontend-designer.js';
        if (file_exists($dist_path . $js_file)) {
            $js_version = substr(md5_file($dist_path . $js_file), 0, 8);
            wp_enqueue_script(
                'pf-frontend-designer',
                $dist_url . $js_file,
                ['wp-i18n'],
                $js_version,
                true
            );

            // Exclude from JS combining/minification by caching plugins.
            // Our IIFE bundle includes React internally and breaks when concatenated.
            // data-no-optimize: Autoptimize, data-no-minify: general, excluded by LiteSpeed filter below.
            wp_script_add_data('pf-frontend-designer', 'data-no-optimize', '1');
            wp_script_add_data('pf-frontend-designer', 'data-no-minify', '1');

            // Load translations inline to work with JS-combining caches (LiteSpeed, etc.)
            // wp_set_script_translations breaks when caching plugins rewrite the JS URL,
            // because WordPress can't match the hash to find the JSON file.
            $this->inline_script_translations('pf-frontend-designer', 'productforge', 'dist/frontend-designer.js');

            $js_config = [
                'template_id'     => $template_id,
                'product_id'      => $product_id,
                'display_mode'    => $this->has_shortcode_in_content() ? 'embedded' : (get_post_meta($product_id, '_pf_display_mode', true) ?: 'embedded'),
                'nonce'           => wp_create_nonce('wp_rest'),
                'api_base'        => rest_url('pf/v1'),
                'currency_symbol' => function_exists('get_woocommerce_currency_symbol')
                    ? get_woocommerce_currency_symbol()
                    : '€',
                'isPremium'       => \ProductForge\ProductForge::is_premium(),
            ];

            // If returning from cart with an existing design, pass the hash and auto-open
            $existing_hash = $this->get_design_hash_from_url();
            if (!empty($existing_hash)) {
                $js_config['existing_design_hash'] = $existing_hash;
                $js_config['auto_open'] = true;
            }

            wp_localize_script('pf-frontend-designer', 'pfDesigner', $js_config);

            // Prevent pinch-to-zoom interference when designer is open on mobile
            wp_add_inline_script('pf-frontend-designer', '
  document.addEventListener("pf:designer-open", function() {
    var meta = document.querySelector("meta[name=viewport]");
    if (meta) {
      meta._pfOriginal = meta.getAttribute("content");
      meta.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no");
    }
  });
  document.addEventListener("pf:designer-close", function() {
    var meta = document.querySelector("meta[name=viewport]");
    if (meta && meta._pfOriginal) {
      meta.setAttribute("content", meta._pfOriginal);
    }
  });
', 'after');
        }

        // Enqueue CSS if present
        $css_file = 'frontend-designer.css';
        if (file_exists($dist_path . $css_file)) {
            wp_enqueue_style(
                'pf-frontend-designer',
                $dist_url . $css_file,
                [],
                file_exists($dist_path . $css_file) ? substr(md5_file($dist_path . $css_file), 0, 8) : PF_VERSION
            );
        }
    }

    private bool $designer_rendered = false;

    /**
     * Check if the current product's content contains the [productforge] shortcode.
     */
    private function has_shortcode_in_content(): bool {
        global $post;
        if (!$post) {
            return false;
        }
        return has_shortcode($post->post_content, 'productforge');
    }

    public function render_designer(): void {
        if ($this->designer_rendered || !is_product()) {
            return;
        }

        // If the shortcode is placed in the content, let it handle rendering instead.
        if ($this->has_shortcode_in_content()) {
            return;
        }

        global $post;
        if (!get_post_meta($post->ID, '_pf_designer_enabled', true)) {
            return;
        }

        $mode = get_post_meta($post->ID, '_pf_display_mode', true) ?: 'embedded';
        echo '<div id="pf-designer-root" data-mode="' . esc_attr($mode) . '"></div>';

        if ($mode === 'modal') {
            echo '<button type="button" class="pf-open-designer button">' . esc_html__('Customize Product', 'productforge') . '</button>';
        }

        $this->designer_rendered = true;
    }

    /**
     * [productforge] shortcode — renders the designer inline.
     * Auto-detects product context on product pages.
     */
    public function shortcode(array $atts = []): string {
        if (!is_product()) {
            return '';
        }

        global $post;
        $product_id = $post->ID;

        if (!get_post_meta($product_id, '_pf_designer_enabled', true)) {
            return '';
        }

        // Allow the shortcode to render on every the_content call.
        // Plugins/themes (Rank Math, Astra) may call the_content before
        // WooCommerce renders the description tab — their output is
        // discarded or stripped. Only the tab render produces visible HTML.
        $this->designer_rendered = true;

        return '<div id="pf-designer-root" data-mode="embedded"></div>';
    }

    /**
     * Inline script translations to work with JS-combining caches (LiteSpeed, WP Rocket, etc.).
     *
     * wp_set_script_translations relies on matching the JS file path to a JSON hash,
     * which breaks when caching plugins rewrite or combine the JS URL.
     * This loads the JSON directly and inlines it via wp_add_inline_script.
     */
    private function inline_script_translations(string $handle, string $domain, string $relative_path): void {
        $lang = determine_locale();
        $hash = md5($domain . $relative_path);
        $json_file = PF_PLUGIN_DIR . "languages/{$domain}-{$lang}-{$hash}.json";

        if (!file_exists($json_file)) {
            // Fall back to base language (nl_NL from nl_NL_formal, etc.)
            $base_lang = substr($lang, 0, 5);
            $json_file = PF_PLUGIN_DIR . "languages/{$domain}-{$base_lang}-{$hash}.json";
        }

        if (!file_exists($json_file)) {
            return;
        }

        $json = file_get_contents($json_file);
        if (!$json) {
            return;
        }

        $script = <<<JS
(function(domain, translations) {
    var localeData = translations.locale_data.messages || translations.locale_data[domain];
    if (localeData) {
        localeData[""].domain = domain;
        wp.i18n.setLocaleData(localeData, domain);
    }
})("{$domain}", {$json});
JS;

        wp_add_inline_script($handle, $script, 'before');
    }
}

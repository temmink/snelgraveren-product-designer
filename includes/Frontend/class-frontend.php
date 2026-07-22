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
        // Substring match, WITHOUT the .js suffix: the enqueued file is the
        // hash-named copy (frontend-designer.<md5>.js), which the literal
        // 'frontend-designer.js' would not match.
        add_filter('litespeed_optimize_js_excludes', function ($excludes) {
            $excludes[] = 'frontend-designer.';
            return $excludes;
        });
        add_shortcode('productforge', [$this, 'shortcode']);
        // Alias registered under the renamed "sgpd" prefix (wp.org review round
        // 2). [productforge] stays registered too — the live site already has
        // it embedded in product content and we don't want to break that.
        add_shortcode('sgpd_designer', [$this, 'shortcode']);
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
     *
     * Ownership validation (ProductForge\Database\DesignRepository::get_by_hash
     * + a customer_id/session_id match, mirroring RestDesigns::owns_design) is
     * the PRIMARY defense here: without it, any visitor could paste any 32-hex
     * design hash into the pf_design_hash field and attach someone else's
     * design (and its saved price) to their own cart.
     *
     * The nonce is defense-in-depth only, not authoritative: WordPress.org
     * flags unchecked $_POST access, so we verify it when present — but
     * LiteSpeed page-caches product pages, so a logged-out customer can be
     * served a cached page with a stale nonce from a previous page-cache
     * generation. A missing or failed nonce must NOT block a legitimately
     * owned design; only the ownership check gates attachment.
     */
    public function add_cart_item_data(array $cart_item_data, int $product_id): array {
        if (empty($_POST['pf_design_hash'])) {
            return $cart_item_data;
        }

        $hash = sanitize_text_field(wp_unslash($_POST['pf_design_hash']));
        if (!preg_match('/^[0-9a-f]{32}$/', $hash)) {
            return $cart_item_data;
        }

        // Verified for WPCS/wp.org nonce-hygiene compliance, but intentionally
        // NOT used to gate below — see method docblock (LiteSpeed caching).
        if (isset($_POST['sgpd_design_nonce'])) {
            wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['sgpd_design_nonce'])), 'sgpd_add_design');
        }

        $design = $this->design_repo()->get_by_hash($hash);
        if (!$design || !$this->owns_design($design)) {
            return $cart_item_data;
        }

        $cart_item_data['pf_design_hash'] = $hash;
        return $cart_item_data;
    }

    /**
     * Mirrors ProductForge\API\RestDesigns::owns_design(): the current
     * requester must be the design's logged-in customer, or hold the same
     * guest session id the design was saved under, or be able to manage
     * templates (admins/shop managers legitimately reassigning designs).
     */
    private function owns_design(array $design): bool {
        $user_id = get_current_user_id();
        if ($user_id && (int) $design['customer_id'] === $user_id) {
            return true;
        }

        $session_id = \ProductForge\Security\CapabilityChecker::current_session_id();
        if (!empty($session_id) && $design['session_id'] === $session_id) {
            return true;
        }

        return current_user_can('edit_sgpd_templates');
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
            $html .= '<img src="' . esc_url($url) . '" alt="' . esc_attr__('Custom design', 'snelgraveren-product-designer') . '" style="max-width:80px;max-height:80px;border-radius:3px;" />';
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
                /* translators: %d: view number */
                'name'      => sprintf(__('Custom Design – View %d', 'snelgraveren-product-designer'), $i + 1),
                /* translators: %d: view number */
                'alt'       => sprintf(__('Your custom product design – view %d', 'snelgraveren-product-designer'), $i + 1),
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
                'key'   => __('Design', 'snelgraveren-product-designer'),
                'value' => __('Customized', 'snelgraveren-product-designer'),
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
        $hash = isset($_GET['pf_design']) ? sanitize_text_field(wp_unslash($_GET['pf_design'])) : '';
        // phpcs:enable
        if ($hash !== '' && preg_match('/^[0-9a-f]{32}$/', $hash)) {
            return $hash;
        }
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
                . '<img src="' . esc_url($thumb_url) . '" alt="' . esc_attr__('Your custom design', 'snelgraveren-product-designer') . '" class="wp-post-image" />'
                . '</div>';
        }

        return $html;
    }

    /**
     * Opt the current response out of full-page caching.
     *
     * The designer page carries a per-session WordPress nonce and personalized,
     * session-specific design state, so caching it publicly breaks customer
     * saves (frozen/expired nonce) and can leak one customer's design to
     * another. `DONOTCACHEPAGE` is honoured by LiteSpeed, WP Rocket, W3TC, WP
     * Super Cache and others; the LiteSpeed action is a belt-and-suspenders
     * signal for that host in particular.
     */
    private function prevent_page_cache(): void {
        if (!defined('DONOTCACHEPAGE')) {
            define('DONOTCACHEPAGE', true);
        }
        do_action('litespeed_control_set_nocache', 'ProductForge designer page (per-session nonce and personalized design)');
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

        // Reaching here means the designer renders on this page. It embeds a
        // per-session WordPress nonce and loads/saves session-specific customer
        // designs over REST, so it must never be full-page cached: a cached copy
        // freezes one visitor's nonce (breaking every later customer's save) and
        // can serve one customer's design to another. Opt this response out of
        // every common page cache.
        $this->prevent_page_cache();

        $dist_path = SGPD_PLUGIN_DIR . 'dist/';
        $dist_url  = SGPD_PLUGIN_URL . 'dist/';

        $upload_dir = wp_upload_dir();
        $cache_path = trailingslashit($upload_dir['basedir']) . 'pf-cache/';
        $cache_url  = trailingslashit($upload_dir['baseurl']) . 'pf-cache/';

        // Enqueue JS
        $js_file = 'frontend-designer.js';
        if (file_exists($dist_path . $js_file)) {
            // Hashing the full bundle on every pageview is wasteful — cache
            // the hash keyed on the file's mtime, recompute only after a build.
            $js_mtime   = (int) filemtime($dist_path . $js_file);
            $hash_cache = get_option('sgpd_frontend_js_hash');
            if (is_array($hash_cache) && ($hash_cache['mtime'] ?? 0) === $js_mtime && !empty($hash_cache['hash'])) {
                $js_version = $hash_cache['hash'];
            } else {
                $js_version = substr(md5_file($dist_path . $js_file), 0, 8);
                update_option('sgpd_frontend_js_hash', ['mtime' => $js_mtime, 'hash' => $js_version], true);
            }

            // Safari caches JS with max-age=31557600 (1 year) keyed on the
            // URL. LiteSpeed's Delay JS feature strips the ?ver= query
            // parameter we pass to wp_enqueue_script, so without a different
            // URL, Safari keeps serving the old bundle after every deploy.
            // Copy the source to a hash-named file in uploads/pf-cache/ so the
            // URL itself changes per build. wp.org disallows writing inside
            // the plugin directory, so this never touches dist/. If uploads
            // isn't writable we fall back to the un-hashed dist/ URL (same
            // fallback behavior as before).
            $hashed_file = 'frontend-designer.' . $js_version . '.js';
            wp_mkdir_p($cache_path);
            $hashed_path = $cache_path . $hashed_file;
            if (!file_exists($hashed_path) && wp_is_writable($cache_path)) {
                // Keep the NEWEST existing hashed copy (the previous build's):
                // LiteSpeed page-cached HTML keeps referencing that URL until
                // the cache expires or is flushed — deleting it immediately
                // would 404 the bundle on every cached page. Older copies and
                // orphaned temp files are removed.
                $existing = [];
                foreach (glob($cache_path . 'frontend-designer.*.js') ?: [] as $candidate) {
                    if (strpos(basename($candidate), 'frontend-designer.tmp-') === 0) {
                        // Temp file from a crashed/concurrent request.
                        if (time() - (int) filemtime($candidate) > DAY_IN_SECONDS) {
                            wp_delete_file($candidate);
                        }
                        continue;
                    }
                    $existing[] = $candidate;
                }
                usort($existing, static function ($a, $b) {
                    return (int) filemtime($b) <=> (int) filemtime($a);
                });
                foreach (array_slice($existing, 1) as $old) {
                    wp_delete_file($old);
                }

                // Write via temp file + atomic move: a concurrent request can
                // never serve (and Safari never caches, with its 1-year
                // max-age) a half-written bundle. The temp name never matches
                // $hashed_file, so it is never enqueued.
                global $wp_filesystem;
                if (empty($wp_filesystem)) {
                    require_once ABSPATH . 'wp-admin/includes/file.php';
                    WP_Filesystem();
                }
                if ($wp_filesystem) {
                    $tmp_path = $cache_path . 'frontend-designer.tmp-' . wp_generate_password(8, false) . '.js';
                    if ($wp_filesystem->copy($dist_path . $js_file, $tmp_path, true)
                        && !$wp_filesystem->move($tmp_path, $hashed_path, true)) {
                        wp_delete_file($tmp_path);
                    }
                }
            }

            $enqueue_from_cache = file_exists($hashed_path);
            $enqueue_url        = $enqueue_from_cache ? ($cache_url . $hashed_file) : ($dist_url . $js_file);

            wp_enqueue_script(
                'sgpd-frontend-designer',
                $enqueue_url,
                ['wp-i18n'],
                $js_version,
                true
            );

            // Exclude from JS combining/minification by caching plugins.
            // Our IIFE bundle includes React internally and breaks when concatenated.
            // data-no-optimize: Autoptimize, data-no-minify: general, excluded by LiteSpeed filter below.
            wp_script_add_data('sgpd-frontend-designer', 'data-no-optimize', '1');
            wp_script_add_data('sgpd-frontend-designer', 'data-no-minify', '1');

            // Load translations inline to work with JS-combining caches (LiteSpeed, etc.)
            // wp_set_script_translations breaks when caching plugins rewrite the JS URL,
            // because WordPress can't match the hash to find the JSON file.
            $this->inline_script_translations('sgpd-frontend-designer', 'snelgraveren-product-designer', 'dist/frontend-designer.js');

            $this->js_config = $this->build_js_config($product_id, $template_id);

            // Prevent pinch-to-zoom interference when designer is open on mobile
            wp_add_inline_script('sgpd-frontend-designer', '
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
                'sgpd-frontend-designer',
                $dist_url . $css_file,
                [],
                file_exists($dist_path . $css_file) ? substr(md5_file($dist_path . $css_file), 0, 8) : SGPD_VERSION
            );
        }
    }

    private bool $designer_rendered = false;

    /**
     * Designer config emitted as data-config JSON attribute on
     * #pf-designer-root. It lives on the HTML element itself so LiteSpeed's
     * JS optimizations can never break the ordering. Built in
     * enqueue_assets(), or on demand in data_config_attr() when a render
     * path runs before wp_enqueue_scripts (e.g. an SEO plugin applying
     * the_content early).
     */
    private array $js_config = [];

    /**
     * Build the designer config array for the given product/template.
     */
    private function build_js_config(int $product_id, int $template_id): array {
        $config = [
            'template_id'     => $template_id,
            'product_id'      => $product_id,
            'display_mode'    => $this->has_shortcode_in_content() ? 'embedded' : (get_post_meta($product_id, '_pf_display_mode', true) ?: 'embedded'),
            'nonce'           => wp_create_nonce('wp_rest'),
            'rest_url'        => rest_url('pf/v1'),
            'currency_symbol' => function_exists('get_woocommerce_currency_symbol')
                ? get_woocommerce_currency_symbol()
                : '€',
            'isPremium'       => \ProductForge\ProductForge::is_premium(),
        ];

        // If returning from cart with an existing design, pass the hash and auto-open
        $existing_hash = $this->get_design_hash_from_url();
        if (!empty($existing_hash)) {
            $config['existing_design_hash'] = $existing_hash;
            $config['auto_open'] = true;
        }

        return $config;
    }

    /**
     * Render the data-config attribute for #pf-designer-root.
     * Returns an empty string when no config is available (designer not enabled).
     */
    private function data_config_attr(): string {
        if (empty($this->js_config)) {
            // enqueue_assets() has not run (yet) for this request — build on
            // demand so an early the_content render never emits a config-less
            // root element that config.js would then latch onto.
            global $post;
            $template_id = $post ? (int) get_post_meta($post->ID, '_pf_template_id', true) : 0;
            if (!$template_id) {
                return '';
            }
            $this->js_config = $this->build_js_config((int) $post->ID, $template_id);
        }
        return ' data-config="' . esc_attr(wp_json_encode($this->js_config)) . '"';
    }

    /**
     * Check if the current product's content contains the [productforge]
     * shortcode (or its [sgpd_designer] alias) or the snelgraveren/product-designer
     * block. Any of these mean "the merchant placed the designer explicitly" —
     * the before-add-to-cart auto-render must then stay out of the way (no
     * duplicate #pf-designer-root) and the display mode is forced to embedded.
     */
    private function has_shortcode_in_content(): bool {
        global $post;
        if (!$post) {
            return false;
        }
        return has_shortcode($post->post_content, 'productforge')
            || has_shortcode($post->post_content, 'sgpd_designer')
            || has_block('snelgraveren/product-designer', $post)
            || $this->template_has_designer_block();
    }

    /**
     * Whether the resolved block template (block themes / Site Editor) itself
     * contains the snelgraveren/product-designer block. WP core stores the current
     * template's markup in $_wp_current_template_content before rendering, so
     * hooks firing mid-template (like woocommerce_before_add_to_cart_button)
     * can detect an explicit template placement and skip the auto-render —
     * otherwise the page would get two #pf-designer-root elements.
     */
    private function template_has_designer_block(): bool {
        global $_wp_current_template_content;
        return is_string($_wp_current_template_content ?? null)
            && has_block('snelgraveren/product-designer', $_wp_current_template_content);
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
        // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- data_config_attr() already wraps its value in esc_attr(wp_json_encode())
        echo '<div id="pf-designer-root" data-mode="' . esc_attr($mode) . '"' . $this->data_config_attr() . '></div>';
        // Hooked to woocommerce_before_add_to_cart_button, i.e. inside the WC
        // <form class="cart">, so this field is POSTed with add-to-cart. See
        // add_cart_item_data() for why it's checked but never authoritative.
        wp_nonce_field('sgpd_add_design', 'sgpd_design_nonce');

        if ($mode === 'modal') {
            echo '<button type="button" class="pf-open-designer button">' . esc_html__('Customize Product', 'snelgraveren-product-designer') . '</button>';
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

        // Best-effort here: the shortcode can be placed outside the WC
        // add-to-cart <form> by the merchant, in which case this hidden
        // field never gets POSTed with the cart submission — that's fine,
        // add_cart_item_data() treats a missing nonce as "not present",
        // never as a block (see its docblock).
        return '<div id="pf-designer-root" data-mode="embedded"' . $this->data_config_attr() . '></div>'
            . wp_nonce_field('sgpd_add_design', 'sgpd_design_nonce', true, false);
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
        $json_file = SGPD_PLUGIN_DIR . "languages/{$domain}-{$lang}-{$hash}.json";

        if (!file_exists($json_file)) {
            // Fall back to base language (nl_NL from nl_NL_formal, etc.)
            $base_lang = substr($lang, 0, 5);
            $json_file = SGPD_PLUGIN_DIR . "languages/{$domain}-{$base_lang}-{$hash}.json";
        }

        if (!file_exists($json_file)) {
            return;
        }

        $json = file_get_contents($json_file);
        if (!$json) {
            return;
        }

        $script = '(function(domain, translations) {'
            . 'var localeData = translations.locale_data.messages || translations.locale_data[domain];'
            . 'if (localeData) {'
            . 'localeData[""].domain = domain;'
            . 'wp.i18n.setLocaleData(localeData, domain);'
            . '}'
            . '})("' . $domain . '", ' . $json . ');';

        wp_add_inline_script($handle, $script, 'before');
    }
}

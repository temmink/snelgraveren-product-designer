<?php
namespace ProductForge;

defined('ABSPATH') || exit;

class ProductForge {

    private static ?ProductForge $instance = null;

    public static function instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
            self::$instance->init();
        }
        return self::$instance;
    }

    private function init(): void {
        // Run pending migrations only when the plugin version changes,
        // not on every admin page load.
        if (is_admin() && get_option('pf_plugin_version') !== PF_VERSION) {
            Database\DbManager::run_migrations();
            update_option('pf_plugin_version', PF_VERSION);
        }

        add_filter('user_has_cap', [$this, 'grant_template_cap'], 10, 4);

        if (is_admin()) {
            $this->init_admin();
        } else {
            $this->init_frontend();
        }
        $this->init_api();
        $this->init_order_hooks();
        $this->init_pricing();
        $this->init_exports();
        (new Cleanup())->init();
    }

    /**
     * Dynamically grant edit_pf_templates to users who can manage_woocommerce or manage_options.
     * Registered here (not in Admin) so it applies in REST API context too.
     */
    public function grant_template_cap(array $allcaps, array $caps, array $args, \WP_User $user): array {
        if (in_array('edit_pf_templates', $caps, true)) {
            if (!empty($allcaps['manage_woocommerce']) || !empty($allcaps['manage_options'])) {
                $allcaps['edit_pf_templates'] = true;
            }
        }
        return $allcaps;
    }

    /**
     * Check if the Pro license is active.
     */
    public static function is_premium(): bool {
        if ( defined( 'PF_LICENSE_KEY' ) && PF_LICENSE_KEY === self::dev_hash() ) {
            return true;
        }

        return function_exists( 'pf_fs' ) && pf_fs()->is_paying();
    }

    /**
     * Developer license hash — not a secret, but not publicly documented.
     */
    private static function dev_hash(): string {
        return hash( 'sha256', 'productforge-dev-' . AUTH_SALT );
    }

    /**
     * Check if a specific premium feature is available.
     *
     * Unknown features are always available (fail-open for core features).
     */
    public static function has_feature( string $feature ): bool {
        static $premium_features = [
            'unlimited_templates',
            'multi_view',
            'svg_boundaries',
            'product_colors',
            'color_palettes',
            'custom_fonts',
            'clipart',
            'pdf_export',
            'svg_export',
            'pricing',
            'permissions',
            'solid_color',
            'upload_restrictions',
            'auto_export',
        ];

        if ( ! in_array( $feature, $premium_features, true ) ) {
            return true;
        }

        return self::is_premium();
    }

    /**
     * Create a WP_Error for premium-required responses.
     */
    public static function premium_error( string $feature, string $message = '' ): \WP_Error {
        if ( ! $message ) {
            $message = __( 'This feature requires ProductForge Pro.', 'productforge' );
        }
        return new \WP_Error(
            'pf_premium_required',
            $message,
            [ 'status' => 403, 'feature' => $feature ]
        );
    }

    private function init_admin(): void {
        new Admin\Admin();
    }

    private function init_frontend(): void {
        $frontend = new Frontend\Frontend();
        $frontend->init();
    }

    /**
     * Register order-related hooks that must fire in both admin and frontend contexts.
     */
    private function init_order_hooks(): void {
        $order = new Frontend\OrderIntegration();
        $order->init();
    }

    private function init_pricing(): void {
        $surcharge = new Pricing\CartSurcharge();
        $surcharge->init();
    }

    private function init_exports(): void {
        $exports = new Export\ExportManager();
        $exports->init();
    }

    private function init_api(): void {
        add_action('rest_api_init', function () {
            (new API\RestTemplates())->register_routes();
            (new API\RestDesigns())->register_routes();
            (new API\RestUploads())->register_routes();
            (new API\RestFonts())->register_routes();
            (new API\RestPalettes())->register_routes();
            (new API\RestExports())->register_routes();
            (new API\RestClipart())->register_routes();
            (new API\RestDesignTemplates())->register_routes();
            (new API\RestPricing())->register_routes();
        });
    }
}

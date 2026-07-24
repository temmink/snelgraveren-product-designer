<?php
namespace Snelgraveren\ProductDesigner;

defined('ABSPATH') || exit;

class Plugin {

    private static ?Plugin $instance = null;

    public static function instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
            self::$instance->init();
        }
        return self::$instance;
    }

    private function init(): void {
        // One-time pf_* -> sgpd_* option/transient/cron migration (wp.org
        // review round 2 prefix rename). Must run before anything below
        // reads a migrated option — including in non-admin contexts, since
        // Cleanup's cron handler and Frontend::enqueue_assets() both read
        // migrated options and can run before any admin page loads again.
        LegacyMigration::maybe_migrate();

        // Run pending migrations only when the plugin version changes,
        // not on every admin page load.
        if (is_admin() && get_option('sgpd_plugin_version') !== SGPD_VERSION) {
            Database\DbManager::run_migrations();
            update_option('sgpd_plugin_version', SGPD_VERSION);
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
        (new Frontend\AccountDesigns())->init();
        // Both contexts: the editor (admin) needs the block registered for the
        // inserter; the frontend needs the render callback.
        (new Frontend\DesignerBlock())->init();
    }

    /**
     * Dynamically grant edit_sgpd_templates to users who can manage_woocommerce or manage_options.
     * Registered here (not in Admin) so it applies in REST API context too.
     */
    public function grant_template_cap(array $allcaps, array $caps, array $args, \WP_User $user): array {
        if (in_array('edit_sgpd_templates', $caps, true)) {
            if (!empty($allcaps['manage_woocommerce']) || !empty($allcaps['manage_options'])) {
                $allcaps['edit_sgpd_templates'] = true;
            }
        }
        return $allcaps;
    }

    /**
     * Check if the Pro license is active.
     */
    public static function is_premium(): bool {
        if ( defined( 'SGPD_LICENSE_KEY' ) && SGPD_LICENSE_KEY === self::dev_hash() ) {
            return true;
        }

        return function_exists( 'sgpd_fs' ) && sgpd_fs()->is_paying();
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
        // NOTE: template/view *counts* are intentionally NOT premium-gated.
        // wp.org guideline 5 forbids code-level quotas in the free build;
        // multi-view and other builder features are Pro-gated in the admin UI
        // (isPremium flag) and their server code is stripped via @fs_premium_only.
        static $premium_features = [
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
            $message = __( 'This feature requires Snelgraveren Product Designer Pro.', 'snelgraveren-product-designer' );
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
        // The pricing engine is premium-only and stripped from the free build
        // (@fs_premium_only in snelgraveren-product-designer.php) — guard so free degrades cleanly.
        if (class_exists(Pricing\CartSurcharge::class)) {
            $surcharge = new Pricing\CartSurcharge();
            $surcharge->init();
        }
    }

    private function init_exports(): void {
        $exports = new Export\ExportManager();
        $exports->init();
    }

    private function init_api(): void {
        add_action('rest_api_init', function () {
            (new API\RestTemplates())->register_routes();
            (new API\RestTemplateTransfer())->register_routes();
            (new API\RestDesigns())->register_routes();
            (new API\RestUploads())->register_routes();
            (new API\RestFonts())->register_routes();
            (new API\RestExports())->register_routes();
            (new API\RestClipart())->register_routes();
            (new API\RestDesignTemplates())->register_routes();
            (new Admin\StarterTemplates())->register_routes();

            // Premium-only controllers — stripped from the free build via
            // @fs_premium_only in snelgraveren-product-designer.php, hence the guards. The
            // admin UI for these features is Pro-gated client-side, so the
            // free build never calls the missing routes.
            if (class_exists(API\RestPalettes::class)) {
                (new API\RestPalettes())->register_routes();
            }
            if (class_exists(API\RestPricing::class)) {
                (new API\RestPricing())->register_routes();
            }
            if (class_exists(API\RestFontsAdmin::class)) {
                (new API\RestFontsAdmin())->register_routes();
            }
            if (class_exists(API\RestClipartAdmin::class)) {
                (new API\RestClipartAdmin())->register_routes();
            }
        });
    }
}

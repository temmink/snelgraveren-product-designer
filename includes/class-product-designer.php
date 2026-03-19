<?php
namespace ProductDesigner;

defined('ABSPATH') || exit;

class ProductDesigner {

    private static ?ProductDesigner $instance = null;

    public static function instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
            self::$instance->init();
        }
        return self::$instance;
    }

    private function init(): void {
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
    }

    /**
     * Dynamically grant edit_pd_templates to users who can manage_woocommerce or manage_options.
     * Registered here (not in Admin) so it applies in REST API context too.
     */
    public function grant_template_cap(array $allcaps, array $caps, array $args, \WP_User $user): array {
        if (in_array('edit_pd_templates', $caps, true)) {
            if (!empty($allcaps['manage_woocommerce']) || !empty($allcaps['manage_options'])) {
                $allcaps['edit_pd_templates'] = true;
            }
        }
        return $allcaps;
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
            (new API\RestExports())->register_routes();
        });
    }
}

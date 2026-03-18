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
        if (is_admin()) {
            $this->init_admin();
        }
        $this->init_api();
    }

    private function init_admin(): void {
        new Admin\Admin();
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

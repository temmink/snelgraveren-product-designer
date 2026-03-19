<?php
namespace ProductDesigner\Admin;

defined('ABSPATH') || exit;

class Admin {

    public function __construct() {
        add_action('admin_menu',           [$this, 'register_menus']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_filter('user_has_cap',         [$this, 'grant_template_cap'], 10, 4);
        add_filter('upload_mimes',         [$this, 'allow_svg_upload']);
        add_filter('wp_check_filetype_and_ext', [$this, 'fix_svg_filetype'], 10, 5);

        new ProductIntegration();
    }

    public function register_menus(): void {
        add_menu_page(
            __('Product Designer', 'product-designer'),
            __('Product Designer', 'product-designer'),
            'edit_pd_templates',
            'product-designer',
            [$this, 'render_list_page'],
            'dashicons-edit',
            56
        );

        add_submenu_page(
            'product-designer',
            __('Templates', 'product-designer'),
            __('Templates', 'product-designer'),
            'edit_pd_templates',
            'product-designer',
            [$this, 'render_list_page']
        );

        add_submenu_page(
            'product-designer',
            __('Template Builder', 'product-designer'),
            __('Add New', 'product-designer'),
            'edit_pd_templates',
            'pd-template-builder',
            [$this, 'render_builder_page']
        );
    }

    public function render_list_page(): void {
        $list_table = new TemplateListTable();
        $list_table->prepare_items();
        include PD_PLUGIN_DIR . 'includes/Admin/views/template-list.php';
    }

    public function render_builder_page(): void {
        $builder = new TemplateBuilder();
        $builder->render();
    }

    public function enqueue_scripts(string $hook): void {
        if (!in_array($hook, ['toplevel_page_product-designer', 'product-designer_page_pd-template-builder'], true)) {
            return;
        }

        $asset_file = PD_PLUGIN_DIR . 'dist/admin-template-builder.asset.php';
        $version    = PD_VERSION;
        $deps       = ['react', 'react-dom', 'wp-i18n'];

        if (file_exists($asset_file)) {
            $asset   = include $asset_file;
            $version = $asset['version'] ?? PD_VERSION;
            $deps    = array_unique(array_merge($asset['dependencies'] ?? [], ['wp-i18n']));
        }

        wp_enqueue_media();

        wp_enqueue_script(
            'pd-template-builder',
            PD_PLUGIN_URL . 'dist/admin-template-builder.js',
            $deps,
            $version,
            true
        );

        wp_set_script_translations('pd-template-builder', 'product-designer', PD_PLUGIN_DIR . 'languages');

        $css_file = PD_PLUGIN_DIR . 'dist/admin-template-builder.css';
        if (file_exists($css_file)) {
            wp_enqueue_style(
                'pd-template-builder',
                PD_PLUGIN_URL . 'dist/admin-template-builder.css',
                [],
                $version
            );
        }

        $template_id = (int) ($_GET['template_id'] ?? 0);

        wp_localize_script('pd-template-builder', 'pdTemplateBuilder', [
            'restUrl'         => esc_url_raw(rest_url()),
            'nonce'           => wp_create_nonce('wp_rest'),
            'templateId'      => $template_id,
            'pluginUrl'       => PD_PLUGIN_URL,
            'currency_symbol' => get_woocommerce_currency_symbol(),
        ]);
    }

    public function allow_svg_upload(array $mimes): array {
        $mimes['svg']  = 'image/svg+xml';
        $mimes['svgz'] = 'image/svg+xml';
        return $mimes;
    }

    public function fix_svg_filetype(array $data, string $file, string $filename, ?array $mimes, string|false $real_mime): array {
        if (!empty($data['ext']) && !empty($data['type'])) {
            return $data;
        }
        $ext = pathinfo($filename, PATHINFO_EXTENSION);
        if ($ext === 'svg' || $ext === 'svgz') {
            $data['ext']  = $ext;
            $data['type'] = 'image/svg+xml';
        }
        return $data;
    }

    /**
     * Dynamically grant edit_pd_templates to users who can manage_woocommerce.
     * Required because add_menu_page() only accepts a single capability string.
     */
    public function grant_template_cap(array $allcaps, array $caps, array $args, \WP_User $user): array {
        if (in_array('edit_pd_templates', $caps, true)) {
            if (!empty($allcaps['manage_woocommerce']) || !empty($allcaps['manage_options'])) {
                $allcaps['edit_pd_templates'] = true;
            }
        }
        return $allcaps;
    }
}

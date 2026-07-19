<?php
namespace ProductForge\Admin;

defined('ABSPATH') || exit;

use ProductForge\Database\TemplateRepository;

class ProductIntegration {

    public function __construct() {
        add_filter('woocommerce_product_data_tabs',   [$this, 'add_product_tab']);
        add_action('woocommerce_product_data_panels',  [$this, 'render_product_panel']);
        add_action('woocommerce_process_product_meta', [$this, 'save_product_meta']);
    }

    public function add_product_tab(array $tabs): array {
        $tabs['sgpd_designer'] = [
            'label'    => __('Product Designer', 'snelgraveren-product-designer'),
            'target'   => 'sgpd_designer_data',
            'class'    => [],
            'priority' => 80,
        ];
        return $tabs;
    }

    public function render_product_panel(): void {
        global $post;
        $product_id = $post->ID;

        $enabled      = get_post_meta($product_id, '_pf_designer_enabled', true);
        $template_id  = (int) get_post_meta($product_id, '_pf_template_id', true);
        $display_mode = get_post_meta($product_id, '_pf_display_mode', true) ?: 'embedded';

        $repo      = new TemplateRepository();
        $templates = $repo->list(100, 1);
        ?>
        <div id="sgpd_designer_data" class="panel woocommerce_options_panel hidden">
            <div class="options_group">
                <?php
                woocommerce_wp_checkbox([
                    'id'          => '_pf_designer_enabled',
                    'label'       => __('Enable Designer', 'snelgraveren-product-designer'),
                    'description' => __('Allow customers to personalise this product.', 'snelgraveren-product-designer'),
                    'value'       => $enabled ? 'yes' : '',
                ]);

                $template_options = ['' => __('— Select template —', 'snelgraveren-product-designer')];
                foreach ($templates as $tpl) {
                    $template_options[$tpl['id']] = esc_html($tpl['title']);
                }

                woocommerce_wp_select([
                    'id'      => '_pf_template_id',
                    'label'   => __('Template', 'snelgraveren-product-designer'),
                    'options' => $template_options,
                    'value'   => $template_id ?: '',
                ]);

                woocommerce_wp_select([
                    'id'      => '_pf_display_mode',
                    'label'   => __('Display Mode', 'snelgraveren-product-designer'),
                    'options' => [
                        'embedded' => __('Embedded on product page', 'snelgraveren-product-designer'),
                        'modal'    => __('Open in modal popup', 'snelgraveren-product-designer'),
                    ],
                    'value'   => $display_mode,
                ]);
                ?>
            </div>
        </div>
        <?php
    }

    public function save_product_meta(int $product_id): void {
        // phpcs:disable WordPress.Security.NonceVerification -- WooCommerce handles nonce
        $enabled = isset($_POST['_pf_designer_enabled']) ? 'yes' : '';
        update_post_meta($product_id, '_pf_designer_enabled', sanitize_text_field($enabled));

        $template_id = isset($_POST['_pf_template_id']) ? absint($_POST['_pf_template_id']) : 0;
        update_post_meta($product_id, '_pf_template_id', $template_id);

        $display_mode = isset($_POST['_pf_display_mode']) ? sanitize_text_field(wp_unslash($_POST['_pf_display_mode'])) : 'embedded';
        if (!in_array($display_mode, ['embedded', 'modal'], true)) {
            $display_mode = 'embedded';
        }
        update_post_meta($product_id, '_pf_display_mode', $display_mode);
        // phpcs:enable
    }
}

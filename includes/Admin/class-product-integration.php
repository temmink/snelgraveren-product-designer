<?php
namespace Snelgraveren\ProductDesigner\Admin;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Database\TemplateRepository;

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
        $templates = $repo->list(500, 1);
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

                // Only templates customers can load are offered. A template that
                // is Draft or Archived cannot be opened by the designer, so
                // choosing one gave the product a designer that only said
                // "Template not found." The template this product ALREADY uses
                // stays in the list whatever its status — silently dropping it
                // would blank the field on the next save — but it is labelled.
                $template_options = ['' => __('— Select template —', 'snelgraveren-product-designer')];
                $assigned_unusable = '';
                foreach ($templates as $tpl) {
                    $published = ($tpl['status'] ?? '') === 'published';
                    if (!$published && (int) $tpl['id'] !== $template_id) {
                        continue;
                    }
                    $label = esc_html($tpl['title']);
                    if (!$published) {
                        /* translators: %s: template title */
                        $label = sprintf(__('%s (not published — customers cannot use it)', 'snelgraveren-product-designer'), $label);
                        $assigned_unusable = $tpl['title'];
                    }
                    $template_options[$tpl['id']] = $label;
                }

                woocommerce_wp_select([
                    'id'      => '_pf_template_id',
                    'label'   => __('Template', 'snelgraveren-product-designer'),
                    'options' => $template_options,
                    'value'   => $template_id ?: '',
                    'desc_tip'    => false,
                    'description' => $assigned_unusable !== ''
                        ? '<br /><strong style="color:#b32d2e;">' . esc_html__('This template is not published, so the designer is hidden on the product page. Publish the template or choose another one.', 'snelgraveren-product-designer') . '</strong>'
                        : __('Only published templates are listed.', 'snelgraveren-product-designer'),
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

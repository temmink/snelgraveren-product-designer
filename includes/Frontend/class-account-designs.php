<?php
namespace ProductForge\Frontend;

defined('ABSPATH') || exit;

use ProductForge\Database\DesignRepository;

/**
 * "My designs" tab on the WooCommerce My Account page. Lists the logged-in
 * customer's saved designs with a reopen link (?pf_design=HASH on the
 * product page — the designer auto-loads it).
 */
class AccountDesigns {

    private const ENDPOINT = 'pf-designs';

    public function init(): void {
        add_action('init', static function () {
            add_rewrite_endpoint(self::ENDPOINT, EP_ROOT | EP_PAGES);

            // Self-heals the rewrite rules on activation AND on plugin
            // updates (ZIP uploads never re-run activation hooks).
            if (get_option('pf_endpoint_registered') !== PF_VERSION) {
                update_option('pf_endpoint_registered', PF_VERSION, false);
                flush_rewrite_rules();
            }
        });
        add_filter('woocommerce_account_menu_items', [$this, 'menu_item']);
        add_action('woocommerce_account_' . self::ENDPOINT . '_endpoint', [$this, 'render']);
        add_filter('woocommerce_endpoint_' . self::ENDPOINT . '_title', static function () {
            return __('My designs', 'productforge');
        });
    }

    public function menu_item(array $items): array {
        $logout = $items['customer-logout'] ?? null;
        unset($items['customer-logout']);
        $items[self::ENDPOINT] = __('My designs', 'productforge');
        if ($logout !== null) {
            $items['customer-logout'] = $logout;
        }
        return $items;
    }

    public function render(): void {
        $user_id = get_current_user_id();
        if ($user_id <= 0) {
            return;
        }

        $designs = (new DesignRepository())->list_by_customer($user_id);
        if (empty($designs)) {
            echo '<p>' . esc_html__('You have no saved designs yet. Start designing on any customizable product!', 'productforge') . '</p>';
            return;
        }

        echo '<table class="woocommerce-orders-table shop_table shop_table_responsive"><thead><tr>';
        echo '<th>' . esc_html__('Design', 'productforge') . '</th>';
        echo '<th>' . esc_html__('Product', 'productforge') . '</th>';
        echo '<th>' . esc_html__('Last edited', 'productforge') . '</th>';
        echo '<th></th></tr></thead><tbody>';

        foreach ($designs as $design) {
            $product = wc_get_product((int) $design['product_id']);
            if (!$product) {
                continue;
            }
            $reopen = add_query_arg('pf_design', $design['design_hash'], $product->get_permalink());
            echo '<tr>';
            echo '<td>';
            if (!empty($design['thumbnail']) && filter_var($design['thumbnail'], FILTER_VALIDATE_URL)) {
                echo '<img src="' . esc_url($design['thumbnail']) . '" alt="" style="max-width:64px;max-height:64px;border-radius:4px;" />';
            }
            echo '</td>';
            echo '<td><a href="' . esc_url($product->get_permalink()) . '">' . esc_html($product->get_name()) . '</a></td>';
            echo '<td>' . esc_html(date_i18n(get_option('date_format'), strtotime($design['updated_at']))) . '</td>';
            echo '<td><a class="woocommerce-button button" href="' . esc_url($reopen) . '">' . esc_html__('Open in designer', 'productforge') . '</a></td>';
            echo '</tr>';
        }
        echo '</tbody></table>';
    }
}

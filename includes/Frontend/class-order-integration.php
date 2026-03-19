<?php
namespace ProductDesigner\Frontend;

defined('ABSPATH') || exit;

/**
 * Handles WooCommerce order integration for custom designs.
 * Registered in both admin and frontend contexts so design thumbnails
 * and meta labels appear everywhere (order edit, confirmation, emails).
 */
class OrderIntegration {

    public function init(): void {
        // Save design hash to order item meta on checkout (classic + block draft creation)
        add_action('woocommerce_checkout_create_order_line_item', [$this, 'save_order_item_meta'], 10, 4);
        // Block checkout: ensure design hash is saved when order is finalized
        add_action('woocommerce_store_api_checkout_update_order_meta', [$this, 'store_api_save_design_meta'], 10, 1);
        // Show design thumbnail in order confirmation, emails, and invoices
        add_filter('woocommerce_order_item_thumbnail', [$this, 'order_item_thumbnail'], 10, 2);
        // Show design thumbnail in admin order view
        add_filter('woocommerce_admin_order_item_thumbnail', [$this, 'admin_order_item_thumbnail'], 10, 3);
        // Show "Design: Customized" label in order item details (expose hidden meta)
        add_filter('woocommerce_order_item_get_formatted_meta_data', [$this, 'order_item_formatted_meta'], 10, 2);
    }

    /**
     * Get the thumbnail URL for a design hash.
     */
    private function get_design_thumbnail_url(string $hash): string {
        $repo   = new \ProductDesigner\Database\DesignRepository();
        $design = $repo->get_by_hash($hash);
        if (!$design || empty($design['views'])) {
            return '';
        }

        $thumb_url = $design['views'][0]['thumbnail'] ?? '';
        if (!empty($thumb_url) && filter_var($thumb_url, FILTER_VALIDATE_URL)) {
            return $thumb_url;
        }

        return '';
    }

    /**
     * Save design hash from cart item to order item meta during checkout.
     */
    public function save_order_item_meta(\WC_Order_Item_Product $item, string $cart_item_key, array $values, \WC_Order $order): void {
        if (!empty($values['pd_design_hash'])) {
            $item->add_meta_data('_pd_design_hash', $values['pd_design_hash'], true);
        }
    }

    /**
     * Block checkout: iterate cart items and ensure design hash is saved to order items.
     * This fires when the Store API finalizes the order, covering cases where
     * woocommerce_checkout_create_order_line_item didn't fire (draft reuse).
     */
    public function store_api_save_design_meta(\WC_Order $order): void {
        $cart = WC()->cart;
        if (!$cart) {
            return;
        }

        foreach ($order->get_items() as $item) {
            if (!($item instanceof \WC_Order_Item_Product)) {
                continue;
            }
            if ($item->get_meta('_pd_design_hash')) {
                continue;
            }

            $product_id = $item->get_product_id();
            foreach ($cart->get_cart() as $cart_item) {
                if (!empty($cart_item['pd_design_hash']) && (int) $cart_item['product_id'] === $product_id) {
                    $item->add_meta_data('_pd_design_hash', $cart_item['pd_design_hash'], true);
                    $item->save();
                    break;
                }
            }
        }
    }

    /**
     * Replace product thumbnail in order confirmation page and emails.
     */
    public function order_item_thumbnail(string $thumbnail, \WC_Order_Item $item): string {
        $hash = $item->get_meta('_pd_design_hash');
        if (empty($hash)) {
            return $thumbnail;
        }

        $thumb_url = $this->get_design_thumbnail_url($hash);
        if (!empty($thumb_url)) {
            return '<img src="' . esc_url($thumb_url) . '" alt="' . esc_attr__('Custom design', 'product-designer') . '" style="max-width:100px;max-height:100px;" />';
        }

        return $thumbnail;
    }

    /**
     * Replace product thumbnail in admin order view.
     *
     * @param string $image      The product image HTML.
     * @param int    $item_id    The order item ID.
     * @param \WC_Order_Item $item The order item object.
     */
    public function admin_order_item_thumbnail(string $image, int $item_id, \WC_Order_Item $item): string {
        $hash = $item->get_meta('_pd_design_hash');
        if (empty($hash)) {
            return $image;
        }

        $thumb_url = $this->get_design_thumbnail_url($hash);
        if (!empty($thumb_url)) {
            return '<img src="' . esc_url($thumb_url) . '" alt="' . esc_attr__('Custom design', 'product-designer') . '" class="wc-order-item-thumbnail" width="38" height="38" />';
        }

        return $image;
    }

    /**
     * Expose the hidden _pd_design_hash meta as "Design: Customized" in order details.
     */
    public function order_item_formatted_meta(array $formatted_meta, \WC_Order_Item $item): array {
        $hash = $item->get_meta('_pd_design_hash');
        if (empty($hash)) {
            return $formatted_meta;
        }

        $formatted_meta['pd_design'] = (object) [
            'key'           => '_pd_design_hash',
            'value'         => $hash,
            'display_key'   => __('Design', 'product-designer'),
            'display_value' => __('Customized', 'product-designer'),
        ];

        return $formatted_meta;
    }
}

<?php
namespace ProductDesigner\Pricing;

defined('ABSPATH') || exit;

/**
 * Applies design surcharges to WooCommerce cart items.
 * Registered in both admin and frontend contexts.
 */
class CartSurcharge {

    private ?PriceCalculator $calculator = null;

    public function init(): void {
        add_action('woocommerce_before_calculate_totals', [$this, 'apply_surcharges'], 20, 1);
        // Show surcharge breakdown in cart item data
        add_filter('woocommerce_get_item_data', [$this, 'display_surcharge'], 20, 2);
    }

    private function calculator(): PriceCalculator {
        if ($this->calculator === null) {
            $this->calculator = new PriceCalculator();
        }
        return $this->calculator;
    }

    /**
     * Recalculate and apply design surcharges to cart item prices.
     */
    public function apply_surcharges(\WC_Cart $cart): void {
        if (is_admin() && !defined('DOING_AJAX')) {
            return;
        }

        // Prevent re-entrant calls during the same calculate_totals cycle
        static $running = false;
        if ($running) {
            return;
        }
        $running = true;

        try {
            foreach ($cart->get_cart() as $cart_item_key => $cart_item) {
                if (empty($cart_item['pd_design_hash'])) {
                    continue;
                }

                $surcharge = $this->calculator()->calculate($cart_item['pd_design_hash']);
                if ($surcharge <= 0) {
                    continue;
                }

                // Store surcharge in cart item for display
                $cart->cart_contents[$cart_item_key]['pd_surcharge'] = $surcharge;

                // Add surcharge to the product price
                $product = $cart_item['data'];
                if ($product instanceof \WC_Product) {
                    $base_price = (float) $product->get_price();
                    $product->set_price($base_price + $surcharge);
                }
            }
        } finally {
            $running = false;
        }
    }

    /**
     * Display surcharge amount in cart item data (below "Design: Customized").
     */
    public function display_surcharge(array $item_data, array $cart_item): array {
        if (!empty($cart_item['pd_surcharge']) && $cart_item['pd_surcharge'] > 0) {
            $item_data[] = [
                'key'   => __('Design surcharge', 'product-designer'),
                'value' => wc_price($cart_item['pd_surcharge']),
            ];
        }
        return $item_data;
    }
}

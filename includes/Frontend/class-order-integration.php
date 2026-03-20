<?php
namespace ProductForge\Frontend;

defined('ABSPATH') || exit;

/**
 * Handles WooCommerce order integration for custom designs.
 * Registered in both admin and frontend contexts so design thumbnails
 * and meta labels appear everywhere (order edit, confirmation, emails).
 */
class OrderIntegration {

    private ?\ProductForge\Database\DesignRepository $design_repo = null;

    private function design_repo(): \ProductForge\Database\DesignRepository {
        if (!$this->design_repo) {
            $this->design_repo = new \ProductForge\Database\DesignRepository();
        }
        return $this->design_repo;
    }

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
        // Add export action buttons in admin order view
        add_action('woocommerce_after_order_itemmeta', [$this, 'render_export_actions'], 10, 3);
    }

    /**
     * Get the thumbnail URL for a design hash.
     */
    private function get_design_thumbnail_url(string $hash): string {
        $design = $this->design_repo()->get_by_hash($hash);
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
        if (!empty($values['pf_design_hash'])) {
            $item->add_meta_data('_pf_design_hash', $values['pf_design_hash'], true);
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

        // Pre-populate with hashes already written by save_order_item_meta
        // to prevent double-assignment when 3+ items share the same product.
        $assigned_hashes = [];
        foreach ($order->get_items() as $item) {
            if ($item instanceof \WC_Order_Item_Product) {
                $existing = $item->get_meta('_pf_design_hash');
                if (!empty($existing)) {
                    $assigned_hashes[] = $existing;
                }
            }
        }

        foreach ($order->get_items() as $item) {
            if (!($item instanceof \WC_Order_Item_Product)) {
                continue;
            }
            if ($item->get_meta('_pf_design_hash')) {
                continue;
            }

            $product_id = $item->get_product_id();
            foreach ($cart->get_cart() as $cart_item) {
                if (empty($cart_item['pf_design_hash'])) {
                    continue;
                }
                $hash = $cart_item['pf_design_hash'];
                if ((int) $cart_item['product_id'] === $product_id && !in_array($hash, $assigned_hashes, true)) {
                    $item->add_meta_data('_pf_design_hash', $hash, true);
                    $item->save();
                    $assigned_hashes[] = $hash;
                    break;
                }
            }
        }
    }

    /**
     * Replace product thumbnail in order confirmation page and emails.
     */
    public function order_item_thumbnail(string $thumbnail, \WC_Order_Item $item): string {
        $hash = $item->get_meta('_pf_design_hash');
        if (empty($hash)) {
            return $thumbnail;
        }

        $thumb_url = $this->get_design_thumbnail_url($hash);
        if (!empty($thumb_url)) {
            return '<img src="' . esc_url($thumb_url) . '" alt="' . esc_attr__('Custom design', 'productforge') . '" style="max-width:100px;max-height:100px;" />';
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
        $hash = $item->get_meta('_pf_design_hash');
        if (empty($hash)) {
            return $image;
        }

        $thumb_url = $this->get_design_thumbnail_url($hash);
        if (!empty($thumb_url)) {
            return '<img src="' . esc_url($thumb_url) . '" alt="' . esc_attr__('Custom design', 'productforge') . '" class="wc-order-item-thumbnail" width="38" height="38" />';
        }

        return $image;
    }

    /**
     * Expose the hidden _pf_design_hash meta as "Design: Customized" in order details.
     */
    public function order_item_formatted_meta(array $formatted_meta, \WC_Order_Item $item): array {
        $hash = $item->get_meta('_pf_design_hash');
        if (empty($hash)) {
            return $formatted_meta;
        }

        $formatted_meta['pf_design'] = (object) [
            'key'           => '_pf_design_hash',
            'value'         => $hash,
            'display_key'   => __('Design', 'productforge'),
            'display_value' => __('Customized', 'productforge'),
        ];

        return $formatted_meta;
    }

    /**
     * Render export action buttons below order item meta in admin.
     */
    public function render_export_actions(int $item_id, \WC_Order_Item $item, ?\WC_Product $product): void {
        if (!is_admin() || !current_user_can('edit_pf_templates')) {
            return;
        }

        $hash = $item->get_meta('_pf_design_hash');
        if (empty($hash)) {
            return;
        }

        $api_base = rest_url('pf/v1');
        $nonce    = wp_create_nonce('wp_rest');

        // Check for existing exports
        $design = $this->design_repo()->get_by_hash($hash);
        $design_id = $design ? (int) $design['id'] : 0;

        $export_repo = new \ProductForge\Database\ExportRepository();
        $existing = $design_id ? $export_repo->get_by_design($design_id) : [];

        echo '<div class="pf-export-actions" style="margin-top:8px;">';
        echo '<strong style="display:block;margin-bottom:4px;">' . esc_html__('Export Design:', 'productforge') . '</strong>';

        // Export buttons
        foreach (['pdf', 'png', 'svg'] as $format) {
            $label = strtoupper($format);
            echo '<button type="button" class="button button-small pf-export-btn" '
                . 'data-hash="' . esc_attr($hash) . '" '
                . 'data-format="' . esc_attr($format) . '" '
                . 'data-api="' . esc_url($api_base) . '" '
                . 'data-nonce="' . esc_attr($nonce) . '" '
                . 'style="margin-right:4px;">'
                . esc_html($label)
                . '</button>';
        }

        // Show existing exports with download links (latest per format only)
        if (!empty($existing)) {
            $latest_by_format = [];
            foreach ($existing as $export) {
                if ($export['status'] !== 'done') {
                    continue;
                }
                $fmt = $export['format'];
                if (!isset($latest_by_format[$fmt]) || (int) $export['id'] > (int) $latest_by_format[$fmt]['id']) {
                    $latest_by_format[$fmt] = $export;
                }
            }
            if (!empty($latest_by_format)) {
                echo '<div class="pf-existing-exports" style="margin-top:6px;">';
                foreach ($latest_by_format as $export) {
                    $download_url = $api_base . '/exports/' . (int) $export['id'] . '/download?_wpnonce=' . $nonce;
                    $label = strtoupper($export['format']);
                    $date  = wp_date(get_option('date_format') . ' ' . get_option('time_format'), strtotime($export['created_at']));
                    echo '<a href="' . esc_url($download_url) . '" class="button button-small" style="margin-right:4px;margin-top:2px;" title="' . esc_attr($date) . '">'
                        . '⬇ ' . esc_html($label)
                        . '</a>';
                }
                echo '</div>';
            }
        }

        echo '</div>';

        // Inline JS for export buttons (only output once)
        static $script_output = false;
        if (!$script_output) {
            $script_output = true;
            ?>
            <script>
            document.addEventListener('click', function(e) {
                var btn = e.target.closest('.pf-export-btn');
                if (!btn) return;
                e.preventDefault();
                var hash = btn.dataset.hash;
                var format = btn.dataset.format;
                var api = btn.dataset.api;
                var nonce = btn.dataset.nonce;
                btn.disabled = true;
                btn.textContent = format.toUpperCase() + '...';
                fetch(api + '/exports/' + hash, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-WP-Nonce': nonce
                    },
                    body: JSON.stringify({ format: format })
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.export_id) {
                        btn.textContent = '✓ ' + format.toUpperCase();
                        // Auto-download
                        window.location.href = api + '/exports/' + data.export_id + '/download?_wpnonce=' + nonce;
                    } else {
                        btn.textContent = '✗ ' + format.toUpperCase();
                        alert('Export failed: ' + (data.error || 'Unknown error'));
                    }
                })
                .catch(function() {
                    btn.textContent = '✗ ' + format.toUpperCase();
                })
                .finally(function() {
                    setTimeout(function() {
                        btn.disabled = false;
                        btn.textContent = format.toUpperCase();
                    }, 3000);
                });
            });
            </script>
            <?php
        }
    }
}

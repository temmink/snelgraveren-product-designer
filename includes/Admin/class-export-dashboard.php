<?php
namespace ProductForge\Admin;

defined('ABSPATH') || exit;

use ProductForge\Database\DesignRepository;
use ProductForge\Database\ExportRepository;
use ProductForge\Export\DesignInspector;
use ProductForge\Export\ExportManager;

/**
 * Production dashboard: all recent orders containing designs, with a
 * one-click "download everything as ZIP" for a production run. ZIP entries
 * are named order-{number}/{product}-... so a day's engraving work sorts
 * by order.
 */
class ExportDashboard {

    private const PAGE_SLUG = 'pf-export-dashboard';

    public function init(): void {
        add_action('admin_post_pf_bulk_export', [$this, 'handle_bulk_download']);
    }

    public function register_menu(): void {
        add_submenu_page(
            'productforge',
            __('Production', 'snelgraveren-product-designer'),
            __('Production', 'snelgraveren-product-designer'),
            'edit_pf_templates',
            self::PAGE_SLUG,
            [$this, 'render']
        );
    }

    /**
     * @return array[] Each: order (WC_Order), items: [{item, hash, raster}]
     */
    private function find_design_orders(string $status, int $days): array {
        $orders = wc_get_orders([
            'limit'        => 100,
            'status'       => $status,
            'date_created' => '>' . (time() - $days * DAY_IN_SECONDS),
            'orderby'      => 'date',
            'order'        => 'DESC',
        ]);

        $repo   = new DesignRepository();
        $result = [];
        foreach ($orders as $order) {
            $items = [];
            foreach ($order->get_items() as $item) {
                $hash = $item->get_meta('_pf_design_hash');
                if (!$hash) {
                    continue;
                }
                $design  = $repo->get_by_hash($hash);
                $items[] = [
                    'item'   => $item,
                    'hash'   => $hash,
                    'raster' => $design ? DesignInspector::contains_raster($design['views'] ?? []) : false,
                ];
            }
            if ($items) {
                $result[] = ['order' => $order, 'items' => $items];
            }
        }
        return $result;
    }

    public function render(): void {
        if (!current_user_can('edit_pf_templates')) {
            wp_die(esc_html__('You do not have permission to access this page.', 'snelgraveren-product-designer'));
        }

        // phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only filters
        $status = sanitize_key($_GET['pf_status'] ?? 'processing');
        $days   = max(1, min(90, (int) ($_GET['pf_days'] ?? 7)));
        // phpcs:enable
        $rows     = $this->find_design_orders($status, $days);
        $statuses = wc_get_order_statuses();
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Production — design exports', 'snelgraveren-product-designer'); ?></h1>
            <form method="get" style="margin:12px 0;">
                <input type="hidden" name="page" value="<?php echo esc_attr(self::PAGE_SLUG); ?>" />
                <select name="pf_status">
                    <?php foreach ($statuses as $key => $label) :
                        $s = preg_replace('/^wc-/', '', $key); ?>
                        <option value="<?php echo esc_attr($s); ?>" <?php selected($status, $s); ?>><?php echo esc_html($label); ?></option>
                    <?php endforeach; ?>
                </select>
                <label>
                    <?php esc_html_e('Last', 'snelgraveren-product-designer'); ?>
                    <input type="number" name="pf_days" value="<?php echo esc_attr($days); ?>" min="1" max="90" class="small-text" />
                    <?php esc_html_e('days', 'snelgraveren-product-designer'); ?>
                </label>
                <button class="button"><?php esc_html_e('Filter', 'snelgraveren-product-designer'); ?></button>
            </form>

            <?php if (!$rows) : ?>
                <p><?php esc_html_e('No orders with designs found for this filter.', 'snelgraveren-product-designer'); ?></p>
            <?php else : ?>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                    <input type="hidden" name="action" value="pf_bulk_export" />
                    <?php wp_nonce_field('pf_bulk_export'); ?>
                    <table class="widefat striped">
                        <thead><tr>
                            <th style="width:24px;"><input type="checkbox" onclick="document.querySelectorAll('.pf-bulk-cb').forEach(c=>c.checked=this.checked)" /></th>
                            <th><?php esc_html_e('Order', 'snelgraveren-product-designer'); ?></th>
                            <th><?php esc_html_e('Product', 'snelgraveren-product-designer'); ?></th>
                            <th><?php esc_html_e('Notes', 'snelgraveren-product-designer'); ?></th>
                        </tr></thead>
                        <tbody>
                        <?php foreach ($rows as $row) :
                            $order = $row['order'];
                            foreach ($row['items'] as $entry) : ?>
                            <tr>
                                <td><input class="pf-bulk-cb" type="checkbox" name="entries[]"
                                           value="<?php echo esc_attr($order->get_id() . ':' . $entry['hash']); ?>" checked /></td>
                                <td><a href="<?php echo esc_url($order->get_edit_order_url()); ?>">#<?php echo esc_html($order->get_order_number()); ?></a>
                                    — <?php echo esc_html($order->get_formatted_billing_full_name()); ?></td>
                                <td><?php echo esc_html($entry['item']->get_name()); ?></td>
                                <td><?php echo $entry['raster'] ? '<span style="color:#b32d2e;">⚠ ' . esc_html__('contains raster images', 'snelgraveren-product-designer') . '</span>' : ''; ?></td>
                            </tr>
                            <?php endforeach;
                        endforeach; ?>
                        </tbody>
                    </table>
                    <p><button class="button button-primary"><?php esc_html_e('Download selection as ZIP', 'snelgraveren-product-designer'); ?></button></p>
                </form>
            <?php endif; ?>
        </div>
        <?php
    }

    public function handle_bulk_download(): void {
        if (!current_user_can('edit_pf_templates')) {
            wp_die(esc_html__('You do not have permission to access this page.', 'snelgraveren-product-designer'));
        }
        check_admin_referer('pf_bulk_export');

        $entries = array_map('sanitize_text_field', wp_unslash((array) ($_POST['entries'] ?? [])));
        if (!$entries) {
            wp_safe_redirect(admin_url('admin.php?page=' . self::PAGE_SLUG));
            exit;
        }

        $format = get_option('pf_export_default_format', 'pdf');
        // PDF/SVG generation is premium-only; the free build falls back to PNG.
        if (!class_exists('ProductForge\\Export\\PremiumExports') && $format !== 'png') {
            $format = 'png';
        }
        $manager = new ExportManager();
        $repo    = new ExportRepository();
        $designs = new DesignRepository();

        $zip_path = wp_tempnam('pf-bulk-export.zip');
        $zip      = new \ZipArchive();
        if ($zip->open($zip_path, \ZipArchive::OVERWRITE) !== true) {
            wp_delete_file($zip_path);
            wp_die(esc_html__('Could not create the export ZIP file.', 'snelgraveren-product-designer'));
        }
        $added = 0;

        foreach ($entries as $entry) {
            if (!preg_match('/^(\d+):([a-f0-9]{32})$/', $entry, $m)) {
                continue;
            }
            [, $order_id, $hash] = $m;
            $order_id = (int) $order_id;

            // Reuse an existing done export of the default format, else generate.
            $design    = $designs->get_by_hash($hash);
            $export_id = 0;
            if ($design) {
                foreach ($repo->get_by_design((int) $design['id']) as $export) {
                    if ($export['format'] === $format && $export['status'] === 'done') {
                        $export_id = (int) $export['id'];
                        break;
                    }
                }
            }
            if (!$export_id) {
                $result    = $manager->generate_export($hash, $format, $order_id);
                $export_id = (int) ($result['export_id'] ?? 0);
                if (!$export_id || ($result['status'] ?? '') !== 'done') {
                    continue;
                }
            }

            $order  = wc_get_order($order_id);
            $prefix = 'order-' . ($order ? $order->get_order_number() : $order_id) . '/';
            foreach ($manager->get_download_paths($export_id) as $path) {
                if ($zip->addFile($path, $prefix . basename($path))) {
                    $added++;
                }
            }
        }
        $zip->close();

        if (!$added) {
            wp_delete_file($zip_path);
            wp_die(esc_html__('No export files could be generated for the selection.', 'snelgraveren-product-designer'));
        }

        nocache_headers();
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="productforge-exports-' . gmdate('Y-m-d') . '.zip"');
        header('Content-Length: ' . filesize($zip_path));
        header('X-Content-Type-Options: nosniff');
        // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- streaming large export files; WP_Filesystem would load them fully into memory
        readfile($zip_path);
        wp_delete_file($zip_path);
        exit;
    }
}

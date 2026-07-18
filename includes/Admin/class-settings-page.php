<?php
namespace ProductForge\Admin;

defined('ABSPATH') || exit;

/**
 * ProductForge → Settings: export options, data-retention toggle, and the
 * system status checks (SystemStatus).
 */
class SettingsPage {

    private const PAGE_SLUG    = 'pf-settings';
    private const OPTION_GROUP = 'pf_settings';

    public function init(): void {
        add_action('admin_init', [$this, 'register_settings']);
        // options.php requires manage_options unless we lower it for this group.
        add_filter('option_page_capability_' . self::OPTION_GROUP, static function () {
            return 'manage_woocommerce';
        });
    }

    public function register_menu(): void {
        add_submenu_page(
            'productforge',
            __('Settings', 'snelgraveren-product-designer'),
            __('Settings', 'snelgraveren-product-designer'),
            'manage_woocommerce',
            self::PAGE_SLUG,
            [$this, 'render']
        );
    }

    public function register_settings(): void {
        register_setting(self::OPTION_GROUP, 'pf_export_trigger_status', [
            'type'              => 'string',
            'default'           => 'completed',
            'sanitize_callback' => [$this, 'sanitize_order_status'],
        ]);
        register_setting(self::OPTION_GROUP, 'pf_export_default_format', [
            'type'              => 'string',
            'default'           => 'pdf',
            'sanitize_callback' => static function ($value) {
                return in_array($value, ['pdf', 'png', 'svg'], true) ? $value : 'pdf';
            },
        ]);
        register_setting(self::OPTION_GROUP, 'pf_delete_data_on_uninstall', [
            'type'              => 'boolean',
            'default'           => false,
            'sanitize_callback' => 'rest_sanitize_boolean',
        ]);
        register_setting(self::OPTION_GROUP, 'pf_guest_design_retention_days', [
            'type'              => 'integer',
            'default'           => 30,
            'sanitize_callback' => static function ($value) {
                return max(0, min(3650, (int) $value));
            },
        ]);
        register_setting(self::OPTION_GROUP, 'pf_health_email_alerts', [
            'type'              => 'boolean',
            'default'           => true,
            'sanitize_callback' => 'rest_sanitize_boolean',
        ]);
    }

    /**
     * Order statuses are stored without the "wc-" prefix (the export hook is
     * "woocommerce_order_status_{status}").
     */
    public function sanitize_order_status($value): string {
        $value    = sanitize_key((string) $value);
        $statuses = array_map(
            static function ($key) {
                return preg_replace('/^wc-/', '', $key);
            },
            array_keys(function_exists('wc_get_order_statuses') ? wc_get_order_statuses() : [])
        );
        return in_array($value, $statuses, true) ? $value : 'completed';
    }

    public function render(): void {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html__('You do not have permission to access this page.', 'snelgraveren-product-designer'));
        }

        // This page always runs fresh checks (and refreshes the notice cache).
        SystemStatus::flush_cache();
        $checks = SystemStatus::run_checks();

        // Auto-export + PDF/SVG formats are premium-only (PremiumExports is
        // stripped from the free build) — hide the settings that have no effect.
        $has_premium_exports = class_exists('ProductForge\\Export\\PremiumExports');

        $trigger_status  = get_option('pf_export_trigger_status', 'completed');
        $default_format  = get_option('pf_export_default_format', 'pdf');
        $format_options  = $has_premium_exports
            ? ['pdf' => 'PDF', 'png' => 'PNG', 'svg' => 'SVG']
            : ['png' => 'PNG'];
        if (!isset($format_options[$default_format])) {
            $default_format = 'png';
        }
        $delete_data     = (bool) get_option('pf_delete_data_on_uninstall', false);
        $retention_days  = (int) get_option('pf_guest_design_retention_days', 30);
        $health_alerts   = (bool) get_option('pf_health_email_alerts', true);
        $statuses        = function_exists('wc_get_order_statuses') ? wc_get_order_statuses() : [];
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('ProductForge Settings', 'snelgraveren-product-designer'); ?></h1>

            <form method="post" action="options.php">
                <?php settings_fields(self::OPTION_GROUP); ?>
                <table class="form-table" role="presentation">
                    <?php if ($has_premium_exports) : ?>
                    <tr>
                        <th scope="row">
                            <label for="pf_export_trigger_status"><?php esc_html_e('Auto-export on order status', 'snelgraveren-product-designer'); ?></label>
                        </th>
                        <td>
                            <select name="pf_export_trigger_status" id="pf_export_trigger_status">
                                <?php foreach ($statuses as $key => $label) :
                                    $status = preg_replace('/^wc-/', '', $key); ?>
                                    <option value="<?php echo esc_attr($status); ?>" <?php selected($trigger_status, $status); ?>>
                                        <?php echo esc_html($label); ?>
                                    </option>
                                <?php endforeach; ?>
                            </select>
                            <p class="description"><?php esc_html_e('Design exports are generated automatically when an order reaches this status.', 'snelgraveren-product-designer'); ?></p>
                        </td>
                    </tr>
                    <?php endif; ?>
                    <tr>
                        <th scope="row">
                            <label for="pf_export_default_format"><?php esc_html_e('Default export format', 'snelgraveren-product-designer'); ?></label>
                        </th>
                        <td>
                            <select name="pf_export_default_format" id="pf_export_default_format">
                                <?php foreach ($format_options as $value => $label) : ?>
                                    <option value="<?php echo esc_attr($value); ?>" <?php selected($default_format, $value); ?>><?php echo esc_html($label); ?></option>
                                <?php endforeach; ?>
                            </select>
                            <?php if (!$has_premium_exports) : ?>
                                <p class="description"><?php esc_html_e('PDF and SVG export are available in ProductForge Pro.', 'snelgraveren-product-designer'); ?></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="pf_guest_design_retention_days"><?php esc_html_e('Guest design retention (days)', 'snelgraveren-product-designer'); ?></label>
                        </th>
                        <td>
                            <input type="number" min="0" max="3650" name="pf_guest_design_retention_days" id="pf_guest_design_retention_days"
                                   value="<?php echo esc_attr($retention_days); ?>" class="small-text" />
                            <p class="description"><?php esc_html_e('Abandoned guest designs (never ordered) are deleted after this many days. 0 disables cleanup. Ordered designs and designs of logged-in customers are never deleted.', 'snelgraveren-product-designer'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Delete data on uninstall', 'snelgraveren-product-designer'); ?></th>
                        <td>
                            <label for="pf_delete_data_on_uninstall">
                                <input type="checkbox" name="pf_delete_data_on_uninstall" id="pf_delete_data_on_uninstall" value="1" <?php checked($delete_data); ?> />
                                <?php esc_html_e('Permanently delete ALL templates, customer designs, and exports when the plugin is deleted.', 'snelgraveren-product-designer'); ?>
                            </label>
                            <p class="description" style="color:#b32d2e;">
                                <?php esc_html_e('Leave this off unless you are permanently removing the plugin. With this off, your templates and designs survive a delete + reinstall.', 'snelgraveren-product-designer'); ?>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('E-mail alerts', 'snelgraveren-product-designer'); ?></th>
                        <td>
                            <label for="pf_health_email_alerts">
                                <input type="checkbox" name="pf_health_email_alerts" id="pf_health_email_alerts" value="1" <?php checked($health_alerts); ?> />
                                <?php esc_html_e('E-mail the site admin when a critical system check starts failing (checked daily).', 'snelgraveren-product-designer'); ?>
                            </label>
                        </td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>

            <hr />
            <h2><?php esc_html_e('Design statistics (last 30 days)', 'snelgraveren-product-designer'); ?></h2>
            <?php $stats = (new \ProductForge\Database\DesignRepository())->funnel_stats(30); ?>
            <table class="widefat striped" style="max-width:640px;">
                <tbody>
                    <tr><td><?php esc_html_e('Designs saved', 'snelgraveren-product-designer'); ?></td><td><strong><?php echo esc_html($stats['saved']); ?></strong></td></tr>
                    <tr><td><?php esc_html_e('Designs ordered', 'snelgraveren-product-designer'); ?></td><td><strong><?php echo esc_html($stats['ordered']); ?></strong></td></tr>
                    <tr><td><?php esc_html_e('Conversion', 'snelgraveren-product-designer'); ?></td>
                        <td><strong><?php echo esc_html($stats['saved'] > 0 ? round(100 * $stats['ordered'] / $stats['saved']) . '%' : '—'); ?></strong></td></tr>
                    <?php foreach ($stats['top_products'] as $i => $row) :
                        $product = wc_get_product((int) $row['product_id']);
                        if (!$product) { continue; } ?>
                    <tr><td><?php
                        /* translators: %d: product rank */
                        echo esc_html(sprintf(__('Top product #%d', 'snelgraveren-product-designer'), $i + 1));
                    ?></td>
                        <td><?php echo esc_html($product->get_name()); ?> (<?php echo esc_html($row['cnt']); ?>)</td></tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <p class="description"><?php esc_html_e('"Ordered" counts designs saved after this feature was installed — older orders are not back-filled.', 'snelgraveren-product-designer'); ?></p>

            <hr />

            <h2><?php esc_html_e('System status', 'snelgraveren-product-designer'); ?></h2>
            <p class="description"><?php esc_html_e('Environment checks for everything the plugin needs at runtime. Reload this page to re-run them.', 'snelgraveren-product-designer'); ?></p>
            <table class="widefat striped" style="max-width:960px;margin-top:8px;">
                <thead>
                    <tr>
                        <th style="width:32px;"></th>
                        <th><?php esc_html_e('Check', 'snelgraveren-product-designer'); ?></th>
                        <th><?php esc_html_e('Result', 'snelgraveren-product-designer'); ?></th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($checks as $check) : ?>
                    <tr>
                        <td><?php echo wp_kses_post(self::status_icon($check['status'])); ?></td>
                        <td><strong><?php echo esc_html($check['label']); ?></strong></td>
                        <td>
                            <?php echo esc_html($check['message']); ?>
                            <?php if (!empty($check['fix'])) : ?>
                                <p class="description" style="margin:4px 0 0;"><?php echo esc_html($check['fix']); ?></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    private static function status_icon(string $status): string {
        switch ($status) {
            case 'ok':
                return '<span class="dashicons dashicons-yes-alt" style="color:#00a32a;" aria-label="OK"></span>';
            case 'warning':
                return '<span class="dashicons dashicons-warning" style="color:#dba617;" aria-label="Warning"></span>';
            case 'error':
                return '<span class="dashicons dashicons-dismiss" style="color:#b32d2e;" aria-label="Error"></span>';
            default:
                return '<span class="dashicons dashicons-info" style="color:#72aee6;" aria-label="Info"></span>';
        }
    }

    /**
     * Admin notice on every ProductForge screen when a critical check fails.
     * Cheap: reads the SystemStatus transient, full checks run at most once
     * per five minutes.
     */
    public static function maybe_show_critical_notice(): void {
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if (!$screen) {
            return;
        }

        $is_pf_screen = $screen->id === 'toplevel_page_productforge'
            || str_starts_with($screen->id, 'productforge_page_');
        // The settings page already shows full details — no notice needed there.
        if (!$is_pf_screen || str_ends_with($screen->id, self::PAGE_SLUG)) {
            return;
        }

        $failures = SystemStatus::get_critical_failures();
        if (empty($failures)) {
            return;
        }

        $labels = implode(', ', array_map(static function ($f) {
            return $f['label'];
        }, $failures));
        ?>
        <div class="notice notice-error">
            <p>
                <strong><?php esc_html_e('ProductForge: server configuration problem.', 'snelgraveren-product-designer'); ?></strong>
                <?php echo esc_html(sprintf(
                    /* translators: %s: comma-separated list of failed checks */
                    __('Failed checks: %s.', 'snelgraveren-product-designer'),
                    $labels
                )); ?>
                <a href="<?php echo esc_url(admin_url('admin.php?page=' . self::PAGE_SLUG)); ?>">
                    <?php esc_html_e('View details and fixes', 'snelgraveren-product-designer'); ?>
                </a>
            </p>
        </div>
        <?php
    }
}

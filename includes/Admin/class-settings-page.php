<?php
namespace Snelgraveren\ProductDesigner\Admin;

defined('ABSPATH') || exit;

/**
 * ProductForge → Settings: export options, data-retention toggle, and the
 * system status checks (SystemStatus).
 */
class SettingsPage {

    private const PAGE_SLUG    = 'sgpd-settings';
    private const OPTION_GROUP = 'sgpd_settings';

    /**
     * The guides live in the plugin's public repository, not in the ZIP: a
     * Markdown file in a plugin folder is read by nobody, and a guide that
     * ships inside a version cannot be corrected without a release.
     */
    public const GUIDE_ADMIN    = 'https://github.com/temmink/snelgraveren-product-designer/blob/master/docs/admin-guide.md';
    public const GUIDE_CUSTOMER = 'https://github.com/temmink/snelgraveren-product-designer/blob/master/docs/user-guide.md';

    public function init(): void {
        add_action('admin_init', [$this, 'register_settings']);
        add_filter('plugin_row_meta', [$this, 'plugin_row_guide_link'], 10, 2);
        // options.php requires manage_options unless we lower it for this group.
        add_filter('option_page_capability_' . self::OPTION_GROUP, static function () {
            return 'manage_woocommerce';
        });
    }

    public function register_menu(): void {
        add_submenu_page(
            'sgpd-templates',
            __('Settings', 'snelgraveren-product-designer'),
            __('Settings', 'snelgraveren-product-designer'),
            'manage_woocommerce',
            self::PAGE_SLUG,
            [$this, 'render']
        );
    }

    public function register_settings(): void {
        register_setting(self::OPTION_GROUP, 'sgpd_export_trigger_status', [
            'type'              => 'string',
            'default'           => 'completed',
            'sanitize_callback' => [$this, 'sanitize_order_status'],
        ]);
        register_setting(self::OPTION_GROUP, 'sgpd_export_default_format', [
            'type'              => 'string',
            'default'           => 'pdf',
            'sanitize_callback' => static function ($value) {
                return in_array($value, ['pdf', 'png', 'svg'], true) ? $value : 'pdf';
            },
        ]);
        register_setting(self::OPTION_GROUP, 'sgpd_delete_data_on_uninstall', [
            'type'              => 'boolean',
            'default'           => false,
            'sanitize_callback' => 'rest_sanitize_boolean',
        ]);
        register_setting(self::OPTION_GROUP, 'sgpd_guest_design_retention_days', [
            'type'              => 'integer',
            'default'           => 30,
            'sanitize_callback' => static function ($value) {
                return max(0, min(3650, (int) $value));
            },
        ]);
        register_setting(self::OPTION_GROUP, \Snelgraveren\ProductDesigner\ColorNames::OPTION, [
            'type'              => 'array',
            'sanitize_callback' => [\Snelgraveren\ProductDesigner\ColorNames::class, 'sanitize'],
        ]);
        register_setting(self::OPTION_GROUP, 'sgpd_health_email_alerts', [
            'type'              => 'boolean',
            'default'           => true,
            'sanitize_callback' => 'rest_sanitize_boolean',
        ]);
    }

    /**
     * "Guide" next to "View details" in the plugin list — where people look
     * for documentation first.
     */
    public function plugin_row_guide_link($links, $file) {
        if (!defined('SGPD_PLUGIN_FILE') || $file !== plugin_basename(SGPD_PLUGIN_FILE)) {
            return $links;
        }
        $links[] = sprintf(
            '<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>',
            esc_url(self::GUIDE_ADMIN),
            esc_html__('Guide', 'snelgraveren-product-designer')
        );
        return $links;
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

    /**
     * The shop-wide colour-name list (see ColorNames). Plain inputs plus a few
     * lines of script for adding and removing rows — no build step, and it
     * saves with the rest of this form.
     */
    private function render_color_names(): void {
        $option  = \Snelgraveren\ProductDesigner\ColorNames::OPTION;
        $rows    = \Snelgraveren\ProductDesigner\ColorNames::all();
        $missing = \Snelgraveren\ProductDesigner\ColorNames::unmapped_in_use();
        ?>
        <p class="description" style="max-width:640px;margin-bottom:8px;">
            <?php esc_html_e('When a product has a colour option, the designer shows the product in the colour the customer chose. It finds the tint by the option\'s name in this list, so "Rood" here covers every product with an option called Rood.', 'snelgraveren-product-designer'); ?>
        </p>
        <?php if ($missing) : ?>
            <p style="max-width:640px;padding:8px 12px;background:#fff8e5;border-left:4px solid #dba617;">
                <?php
                printf(
                    /* translators: %s: comma-separated colour option names */
                    esc_html__('No tint set yet for: %s. Until you add them, the preview keeps its current colour for these options.', 'snelgraveren-product-designer'),
                    '<strong>' . esc_html(implode(', ', $missing)) . '</strong>'
                );
                ?>
            </p>
        <?php endif; ?>
        <div id="sgpd-color-names" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px;max-width:820px;">
            <?php foreach ($rows as $row) : ?>
                <div class="sgpd-color-name" style="display:flex;gap:6px;align-items:center;">
                    <input type="color" name="<?php echo esc_attr($option); ?>[hex][]" value="<?php echo esc_attr($row['hex']); ?>" aria-label="<?php esc_attr_e('Tint', 'snelgraveren-product-designer'); ?>" />
                    <input type="text" name="<?php echo esc_attr($option); ?>[names][]" value="<?php echo esc_attr($row['name']); ?>" aria-label="<?php esc_attr_e('Colour name', 'snelgraveren-product-designer'); ?>" style="flex:1;min-width:0;" />
                    <button type="button" class="button-link sgpd-color-name__remove" aria-label="<?php esc_attr_e('Remove this colour', 'snelgraveren-product-designer'); ?>" style="color:#b32d2e;text-decoration:none;font-size:18px;line-height:1;">&times;</button>
                </div>
            <?php endforeach; ?>
        </div>
        <p>
            <button type="button" class="button" id="sgpd-color-names-add"><?php esc_html_e('Add colour', 'snelgraveren-product-designer'); ?></button>
            <?php foreach ($missing as $name) : ?>
                <button type="button" class="button sgpd-color-names-add-named" data-name="<?php echo esc_attr($name); ?>">+ <?php echo esc_html($name); ?></button>
            <?php endforeach; ?>
        </p>
        <template id="sgpd-color-name-row">
            <div class="sgpd-color-name" style="display:flex;gap:6px;align-items:center;">
                <input type="color" name="<?php echo esc_attr($option); ?>[hex][]" value="#888888" aria-label="<?php esc_attr_e('Tint', 'snelgraveren-product-designer'); ?>" />
                <input type="text" name="<?php echo esc_attr($option); ?>[names][]" value="" aria-label="<?php esc_attr_e('Colour name', 'snelgraveren-product-designer'); ?>" style="flex:1;min-width:0;" />
                <button type="button" class="button-link sgpd-color-name__remove" aria-label="<?php esc_attr_e('Remove this colour', 'snelgraveren-product-designer'); ?>" style="color:#b32d2e;text-decoration:none;font-size:18px;line-height:1;">&times;</button>
            </div>
        </template>
        <?php
        wp_register_script('sgpd-color-names', false, [], SGPD_VERSION, true);
        wp_enqueue_script('sgpd-color-names');
        wp_add_inline_script('sgpd-color-names', "(function(){var list=document.getElementById('sgpd-color-names');var tpl=document.getElementById('sgpd-color-name-row');if(!list||!tpl)return;function add(name){var row=tpl.content.firstElementChild.cloneNode(true);var input=row.querySelector('input[type=text]');input.value=name||'';list.appendChild(row);(name?row.querySelector('input[type=color]'):input).focus();}document.getElementById('sgpd-color-names-add').addEventListener('click',function(){add('');});document.querySelectorAll('.sgpd-color-names-add-named').forEach(function(b){b.addEventListener('click',function(){add(b.dataset.name);b.remove();});});list.addEventListener('click',function(e){var b=e.target.closest('.sgpd-color-name__remove');if(b)b.closest('.sgpd-color-name').remove();});})();");
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
        $has_premium_exports = class_exists('Snelgraveren\\ProductDesigner\\Export\\PremiumExports');

        $trigger_status  = get_option('sgpd_export_trigger_status', 'completed');
        $default_format  = get_option('sgpd_export_default_format', 'pdf');
        $format_options  = $has_premium_exports
            ? ['pdf' => 'PDF', 'png' => 'PNG', 'svg' => 'SVG']
            : ['png' => 'PNG'];
        if (!isset($format_options[$default_format])) {
            $default_format = 'png';
        }
        $delete_data     = (bool) get_option('sgpd_delete_data_on_uninstall', false);
        $retention_days  = (int) get_option('sgpd_guest_design_retention_days', 30);
        $health_alerts   = (bool) get_option('sgpd_health_email_alerts', true);
        $statuses        = function_exists('wc_get_order_statuses') ? wc_get_order_statuses() : [];
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Product Designer Settings', 'snelgraveren-product-designer'); ?></h1>

            <div style="max-width:820px;margin:12px 0 4px;padding:12px 16px;background:#fff;border:1px solid #c3c4c7;border-left:4px solid #2271b1;">
                <strong><?php esc_html_e('Guides', 'snelgraveren-product-designer'); ?></strong>
                <p style="margin:6px 0 0;">
                    <a href="<?php echo esc_url(self::GUIDE_ADMIN); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e('Guide for shop owners', 'snelgraveren-product-designer'); ?></a>
                    — <?php esc_html_e('templates, zones, permissions, pricing, exports and settings.', 'snelgraveren-product-designer'); ?>
                    <br />
                    <a href="<?php echo esc_url(self::GUIDE_CUSTOMER); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e('Guide for customers', 'snelgraveren-product-designer'); ?></a>
                    — <?php esc_html_e('how the designer on the product page works; share the link or use it for your own help page.', 'snelgraveren-product-designer'); ?>
                </p>
                <p class="description" style="margin:6px 0 0;"><?php esc_html_e('The guides open on GitHub and are written in English.', 'snelgraveren-product-designer'); ?></p>
            </div>

            <form method="post" action="options.php">
                <?php settings_fields(self::OPTION_GROUP); ?>
                <table class="form-table" role="presentation">
                    <?php if ($has_premium_exports) : ?>
                    <tr>
                        <th scope="row">
                            <label for="sgpd_export_trigger_status"><?php esc_html_e('Auto-export on order status', 'snelgraveren-product-designer'); ?></label>
                        </th>
                        <td>
                            <select name="sgpd_export_trigger_status" id="sgpd_export_trigger_status">
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
                            <label for="sgpd_export_default_format"><?php esc_html_e('Default export format', 'snelgraveren-product-designer'); ?></label>
                        </th>
                        <td>
                            <select name="sgpd_export_default_format" id="sgpd_export_default_format">
                                <?php foreach ($format_options as $value => $label) : ?>
                                    <option value="<?php echo esc_attr($value); ?>" <?php selected($default_format, $value); ?>><?php echo esc_html($label); ?></option>
                                <?php endforeach; ?>
                            </select>
                            <?php if (!$has_premium_exports) : ?>
                                <p class="description"><?php esc_html_e('PDF and SVG export are available in Snelgraveren Product Designer Pro.', 'snelgraveren-product-designer'); ?></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="sgpd_guest_design_retention_days"><?php esc_html_e('Guest design retention (days)', 'snelgraveren-product-designer'); ?></label>
                        </th>
                        <td>
                            <input type="number" min="0" max="3650" name="sgpd_guest_design_retention_days" id="sgpd_guest_design_retention_days"
                                   value="<?php echo esc_attr($retention_days); ?>" class="small-text" />
                            <p class="description"><?php esc_html_e('Abandoned guest designs (never ordered) are deleted after this many days. 0 disables cleanup. Ordered designs and designs of logged-in customers are never deleted.', 'snelgraveren-product-designer'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Delete data on uninstall', 'snelgraveren-product-designer'); ?></th>
                        <td>
                            <label for="sgpd_delete_data_on_uninstall">
                                <input type="checkbox" name="sgpd_delete_data_on_uninstall" id="sgpd_delete_data_on_uninstall" value="1" <?php checked($delete_data); ?> />
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
                            <label for="sgpd_health_email_alerts">
                                <input type="checkbox" name="sgpd_health_email_alerts" id="sgpd_health_email_alerts" value="1" <?php checked($health_alerts); ?> />
                                <?php esc_html_e('E-mail the site admin when a critical system check starts failing (checked daily).', 'snelgraveren-product-designer'); ?>
                            </label>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Colour names', 'snelgraveren-product-designer'); ?></th>
                        <td><?php $this->render_color_names(); ?></td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>

            <hr />
            <h2><?php esc_html_e('Design statistics (last 30 days)', 'snelgraveren-product-designer'); ?></h2>
            <?php $stats = (new \Snelgraveren\ProductDesigner\Database\DesignRepository())->funnel_stats(30); ?>
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

        // Submenu screen ids are prefixed with the parent menu TITLE
        // (e.g. 'product-designer_page_sgpd-settings'), not its slug, so match on
        // the '_page_sgpd-' segment instead of a hardcoded menu-title prefix.
        $is_pf_screen = $screen->id === 'toplevel_page_sgpd-templates'
            || str_contains($screen->id, '_page_sgpd-');
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
                <strong><?php esc_html_e('Snelgraveren Product Designer: server configuration problem.', 'snelgraveren-product-designer'); ?></strong>
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

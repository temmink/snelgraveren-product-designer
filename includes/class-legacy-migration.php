<?php
namespace ProductForge;

defined('ABSPATH') || exit;

/**
 * One-time upgrade routine for the wp.org review round-2 prefix rename
 * (pf_* -> sgpd_*, see CLAUDE.md "Prefix rename migration map"). Without
 * this, every existing install (including the live shop) would silently
 * lose its export settings, retention days, health-alert state, DB
 * migration bookkeeping, and color palettes on upgrade, because the
 * renamed code reads sgpd_* option names that don't exist yet.
 *
 * Gated by a dedicated flag option (not a version comparison) so it runs
 * exactly once regardless of how many times the plugin version changes
 * afterwards, and runs unconditionally (not only in is_admin()) because
 * cron (Cleanup) and the frontend (enqueue_assets) both read migrated
 * options before any admin page is ever loaded again.
 */
class LegacyMigration {

    private const MIGRATED_FLAG = 'sgpd_migrated_from_pf';

    /**
     * Old option name => new option name. Every pf_* option/transient that
     * existed before the round-2 rename must be listed here.
     */
    private const OPTION_MAP = [
        'pf_plugin_version'              => 'sgpd_plugin_version',
        'pf_frontend_js_hash'            => 'sgpd_frontend_js_hash',
        'pf_endpoint_registered'         => 'sgpd_endpoint_registered',
        'pf_export_trigger_status'       => 'sgpd_export_trigger_status',
        'pf_export_default_format'       => 'sgpd_export_default_format',
        'pf_delete_data_on_uninstall'    => 'sgpd_delete_data_on_uninstall',
        'pf_guest_design_retention_days' => 'sgpd_guest_design_retention_days',
        'pf_health_email_alerts'         => 'sgpd_health_email_alerts',
        'pf_health_last_alert_hash'      => 'sgpd_health_last_alert_hash',
        'pf_ordered_backfill_done'       => 'sgpd_ordered_backfill_done',
        'pf_db_version'                  => 'sgpd_db_version',
        'pf_color_palettes'              => 'sgpd_color_palettes',
    ];

    private const TRANSIENT_MAP = [
        'pf_system_status_critical' => 'sgpd_system_status_critical',
    ];

    private const OLD_CRON_HOOK = 'pf_daily_maintenance';

    /**
     * Run the migration if it hasn't run yet on this install. Safe to call
     * on every request — after the first successful run it's a single
     * get_option() call.
     */
    public static function maybe_migrate(): void {
        if (get_option(self::MIGRATED_FLAG)) {
            return;
        }

        self::migrate_options();
        self::migrate_transients();

        // The cron was scheduled under the old hook name on any site that
        // installed before this rename; the new hook (Cleanup::HOOK) gets
        // its own schedule via the normal self-heal check on 'init', but
        // the OLD schedule must be cleared explicitly or it keeps firing
        // forever with no handler attached.
        wp_clear_scheduled_hook(self::OLD_CRON_HOOK);

        update_option(self::MIGRATED_FLAG, 1, false);
    }

    private static function migrate_options(): void {
        $missing = "\0sgpd-missing\0";

        foreach (self::OPTION_MAP as $old => $new) {
            $old_value = get_option($old, $missing);
            if ($old_value === $missing) {
                continue; // Nothing to migrate (fresh install, or already gone).
            }

            $new_value = get_option($new, $missing);
            if ($new_value === $missing) {
                update_option($new, $old_value);
            }

            delete_option($old);
        }
    }

    private static function migrate_transients(): void {
        foreach (self::TRANSIENT_MAP as $old => $new) {
            $old_value = get_transient($old);
            if ($old_value !== false && get_transient($new) === false) {
                // 5 minutes matches SystemStatus's own cache lifetime.
                set_transient($new, $old_value, 5 * MINUTE_IN_SECONDS);
            }
            delete_transient($old);
        }
    }
}

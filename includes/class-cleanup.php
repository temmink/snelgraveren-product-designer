<?php
namespace ProductForge;

defined('ABSPATH') || exit;

use ProductForge\Database\DesignRepository;
use ProductForge\Export\FileUtils;

/**
 * Daily maintenance: prune abandoned guest designs (and their thumbnail
 * files) after the configured retention period. The schedule self-heals on
 * init because plugin updates via ZIP upload never re-run activation.
 */
class Cleanup {

    public const HOOK = 'pf_daily_maintenance';

    public function init(): void {
        add_action(self::HOOK, [$this, 'run']);
        add_action('init', static function () {
            if (!wp_next_scheduled(self::HOOK)) {
                wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::HOOK);
            }
        });
    }

    /**
     * @return array{deleted:int}
     */
    public function run(): array {
        $repo = new DesignRepository();

        // One-time back-fill: designs referenced by existing order items were
        // saved before checkout started flipping status to 'ordered'. Without
        // this, the cleanup below would treat them as abandoned drafts and
        // delete designs belonging to real historical orders.
        if (!get_option('pf_ordered_backfill_done')) {
            $repo->backfill_ordered_from_order_meta();
            update_option('pf_ordered_backfill_done', 1, false);
        }

        $days = (int) get_option('pf_guest_design_retention_days', 30);
        if ($days < 1) {
            return ['deleted' => 0];
        }

        $deleted = 0;

        foreach ($repo->find_stale_guest_drafts($days) as $row) {
            $design = $repo->get((int) $row['id']);

            if (!$repo->delete((int) $row['id'])) {
                error_log('ProductForge cleanup: could not delete design ' . $row['id']);
                continue;
            }

            foreach ($design['views'] ?? [] as $view) {
                $thumb = $view['thumbnail'] ?? '';
                if ($thumb) {
                    $path = FileUtils::url_to_local_path($thumb);
                    if ($path && strpos($path, 'pf-thumbnails') !== false && file_exists($path)) {
                        wp_delete_file($path);
                    }
                }
            }

            $deleted++;
        }

        $this->maybe_send_health_alert();

        return ['deleted' => $deleted];
    }

    /**
     * E-mail the admin when critical system checks fail. Sends at most once
     * per unique failure set: the hash of failing check ids is stored and
     * compared, so a persistent failure doesn't mail daily but a NEW failure
     * does. Recovery resets the stored hash.
     */
    private function maybe_send_health_alert(): void {
        if (!get_option('pf_health_email_alerts', 1)) {
            return;
        }

        $failures = array_values(array_filter(
            \ProductForge\Admin\SystemStatus::run_checks(),
            static fn($c) => $c['status'] === 'error'
        ));

        $hash = $failures ? md5(implode('|', array_column($failures, 'id'))) : '';
        if ($hash === get_option('pf_health_last_alert_hash', '')) {
            return;
        }
        update_option('pf_health_last_alert_hash', $hash, false);

        if (!$failures) {
            return; // recovered — reset only
        }

        $lines = array_map(
            static fn($c) => sprintf("- %s: %s %s", $c['label'], $c['message'], $c['fix']),
            $failures
        );
        wp_mail(
            get_option('admin_email'),
            /* translators: %s: site hostname */
            sprintf(__('[%s] ProductForge: server configuration problem', 'snelgraveren-product-designer'), wp_parse_url(home_url(), PHP_URL_HOST)),
            sprintf(
                /* translators: 1: failure list, 2: settings page URL */
                __("The following ProductForge system checks are failing:\n\n%1\$s\n\nDetails and fixes: %2\$s", 'snelgraveren-product-designer'),
                implode("\n", $lines),
                admin_url('admin.php?page=pf-settings')
            )
        );
    }
}

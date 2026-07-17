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
        $days = (int) get_option('pf_guest_design_retention_days', 30);
        if ($days < 1) {
            return ['deleted' => 0];
        }

        $repo    = new DesignRepository();
        $deleted = 0;

        foreach ($repo->find_stale_guest_drafts($days) as $row) {
            $design = $repo->get((int) $row['id']);
            foreach ($design['views'] ?? [] as $view) {
                $thumb = $view['thumbnail'] ?? '';
                if ($thumb) {
                    $path = FileUtils::url_to_local_path($thumb);
                    if ($path && strpos($path, 'pf-thumbnails') !== false && file_exists($path)) {
                        @unlink($path);
                    }
                }
            }
            if ($repo->delete((int) $row['id'])) {
                $deleted++;
            }
        }

        return ['deleted' => $deleted];
    }
}

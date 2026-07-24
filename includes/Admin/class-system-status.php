<?php
namespace Snelgraveren\ProductDesigner\Admin;

defined('ABSPATH') || exit;

/**
 * Runs environment checks the plugin depends on at runtime and caches the
 * result. Shown on the ProductForge Settings page; critical failures also
 * surface as an admin notice on every ProductForge admin screen.
 */
class SystemStatus {

    /** Cached critical-failure summary so the admin notice doesn't hit the
     *  filesystem on every admin pageview. */
    private const TRANSIENT = 'sgpd_system_status_critical';
    private const CACHE_TTL = 5 * MINUTE_IN_SECONDS;

    /** All wp_pf_* tables the migrations create. */
    private const TABLES = [
        'pf_templates',
        'pf_template_views',
        'pf_designs',
        'pf_design_views',
        'pf_design_templates',
        'pf_design_template_views',
        'pf_exports',
        'pf_price_log',
        'pf_fonts',
        'pf_clipart_collections',
        'pf_clipart',
    ];

    /** Upload subdirectories the plugin writes to at runtime. */
    private const UPLOAD_DIRS = [
        'pf-thumbnails' => 'cart/order design thumbnails',
        'pf-exports'    => 'order export files (PDF/PNG/SVG)',
        'pf-fonts'      => 'custom font uploads',
        'pf-clipart'    => 'clipart uploads',
    ];

    /**
     * Run all checks.
     *
     * @return array[] Each check: id, label, status (ok|warning|error|info),
     *                 message, fix (optional instruction shown on failure).
     */
    public static function run_checks(): array {
        $checks = [];

        // PHP version — plugin uses 8.1 syntax (readonly-style promoted props, enums-free but union types).
        $php_ok = version_compare(PHP_VERSION, '8.1', '>=');
        $checks[] = [
            'id'      => 'php_version',
            'label'   => __('PHP version', 'snelgraveren-product-designer'),
            'status'  => $php_ok ? 'ok' : 'error',
            /* translators: %s: detected PHP version */
            'message' => sprintf(__('PHP %s detected. Minimum required: 8.1.', 'snelgraveren-product-designer'), PHP_VERSION),
            'fix'     => $php_ok ? '' : __('Ask your host to upgrade PHP to 8.1 or newer.', 'snelgraveren-product-designer'),
        ];

        // finfo — MIME validation for every customer/admin upload (security critical).
        $finfo_ok = function_exists('finfo_file');
        $checks[] = [
            'id'      => 'finfo',
            'label'   => __('PHP fileinfo extension', 'snelgraveren-product-designer'),
            'status'  => $finfo_ok ? 'ok' : 'error',
            'message' => $finfo_ok
                ? __('Available. Uploaded files are MIME-validated.', 'snelgraveren-product-designer')
                : __('Missing. Upload validation cannot run, so all uploads are rejected.', 'snelgraveren-product-designer'),
            'fix'     => $finfo_ok ? '' : __('Enable the "fileinfo" PHP extension (php.ini or ask your host).', 'snelgraveren-product-designer'),
        ];

        // SVG→PNG converter — mirrors ExportManager::svg_to_png() detection order.
        $checks[] = self::check_svg_converter();

        // Writable upload directories.
        $uploads  = wp_upload_dir();
        $base_dir = trailingslashit($uploads['basedir']);
        foreach (self::UPLOAD_DIRS as $dir => $purpose) {
            $path = $base_dir . $dir;
            if (!is_dir($path)) {
                wp_mkdir_p($path);
            }
            $writable = is_dir($path) && wp_is_writable($path);
            $checks[] = [
                'id'      => 'dir_' . $dir,
                /* translators: %s: directory path relative to ABSPATH */
                'label'   => sprintf(__('Writable: %s', 'snelgraveren-product-designer'), str_replace(ABSPATH, '', $path)),
                'status'  => $writable ? 'ok' : 'error',
                'message' => $writable
                    ? __('Writable.', 'snelgraveren-product-designer')
                    /* translators: %s: what the directory is used for */
                    : sprintf(__('Not writable — used for %s.', 'snelgraveren-product-designer'), $purpose),
                'fix'     => $writable ? '' : sprintf(
                    /* translators: %s: directory path */
                    __('Make the directory writable for the web server, e.g. via your hosting file manager or: chmod 755 %s (owner must be the web server user).', 'snelgraveren-product-designer'),
                    $path
                ),
            ];
        }

        // Writable uploads/pf-cache/ — needed for hash-named JS cache busting.
        // Not critical: enqueue falls back to the un-hashed dist/ URL, but
        // Safari + LiteSpeed cache invalidation degrades after deploys.
        // Never the plugin's own dist/ directory — wp.org disallows writing there.
        $cache_dir_path = $base_dir . 'pf-cache';
        if (!is_dir($cache_dir_path)) {
            wp_mkdir_p($cache_dir_path);
        }
        $cache_dir_writable = is_dir($cache_dir_path) && wp_is_writable($cache_dir_path);
        $checks[] = [
            'id'      => 'dir_pf_cache',
            'label'   => __('Writable: uploads/pf-cache/ directory', 'snelgraveren-product-designer'),
            'status'  => $cache_dir_writable ? 'ok' : 'warning',
            'message' => $cache_dir_writable
                ? __('Writable. Hash-named JS copies are created for reliable cache busting.', 'snelgraveren-product-designer')
                : __('Not writable. The designer still works, but browsers may serve a stale JS bundle after plugin updates (Safari caches JS for a year).', 'snelgraveren-product-designer'),
            'fix'     => $cache_dir_writable ? '' : sprintf(
                /* translators: %s: directory path */
                __('Make %s writable for the web server to enable hash-named cache busting.', 'snelgraveren-product-designer'),
                $cache_dir_path
            ),
        ];

        // Database tables.
        $checks[] = self::check_tables();

        // LiteSpeed — informational: confirm the JS-optimization exclude is active.
        if (defined('LSCWP_V')) {
            $checks[] = [
                'id'      => 'litespeed',
                'label'   => __('LiteSpeed Cache', 'snelgraveren-product-designer'),
                'status'  => 'info',
                'message' => __('Detected. The designer bundle is excluded from JS combining/minification automatically. Remember to purge the cache after plugin updates.', 'snelgraveren-product-designer'),
                'fix'     => '',
            ];
        }

        self::cache_critical_summary($checks);

        return $checks;
    }

    /**
     * SVG→PNG conversion capability, in the same order the export pipeline
     * tries them: rsvg-convert binary first, then Imagick with SVG support.
     */
    private static function check_svg_converter(): array {
        $exec_available = function_exists('exec') && !in_array('exec', array_map('trim', explode(',', (string) ini_get('disable_functions'))), true);
        $rsvg           = $exec_available && file_exists('/usr/bin/rsvg-convert');

        $imagick_svg = false;
        if (extension_loaded('imagick') && class_exists('\Imagick')) {
            try {
                $imagick_svg = !empty(\Imagick::queryFormats('SVG'));
            } catch (\Throwable $e) {
                $imagick_svg = false;
            }
        }

        if ($rsvg) {
            $message = __('rsvg-convert found (preferred converter).', 'snelgraveren-product-designer');
        } elseif ($imagick_svg) {
            $message = __('Imagick with SVG support found.', 'snelgraveren-product-designer');
        } else {
            $message = __('Neither rsvg-convert nor Imagick with SVG support found. Exports of designs saved with older plugin versions (SVG data) will fail; current browser-rendered PNG exports still work.', 'snelgraveren-product-designer');
        }

        return [
            'id'      => 'svg_converter',
            'label'   => __('SVG to PNG converter', 'snelgraveren-product-designer'),
            'status'  => ($rsvg || $imagick_svg) ? 'ok' : 'warning',
            'message' => $message,
            'fix'     => ($rsvg || $imagick_svg) ? '' : __('Install librsvg2-bin (provides /usr/bin/rsvg-convert) or enable the Imagick PHP extension with SVG delegate support.', 'snelgraveren-product-designer'),
        ];
    }

    private static function check_tables(): array {
        global $wpdb;

        $missing = [];
        foreach (self::TABLES as $table) {
            $full = $wpdb->prefix . $table;
            // phpcs:ignore WordPress.DB.PreparedSQL -- table name built from a constant list
            if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $full)) !== $full) {
                $missing[] = $full;
            }
        }

        return [
            'id'      => 'db_tables',
            'label'   => __('Database tables', 'snelgraveren-product-designer'),
            'status'  => empty($missing) ? 'ok' : 'error',
            'message' => empty($missing)
                /* translators: %d: number of database tables found */
                ? sprintf(__('All %d tables present.', 'snelgraveren-product-designer'), count(self::TABLES))
                /* translators: %s: comma-separated list of missing table names */
                : sprintf(__('Missing tables: %s', 'snelgraveren-product-designer'), implode(', ', $missing)),
            'fix'     => empty($missing) ? '' : __('Deactivate and re-activate the plugin to re-run the database migrations.', 'snelgraveren-product-designer'),
        ];
    }

    /**
     * Store the critical failures in a transient so has_critical_failures()
     * stays cheap on regular admin pageviews.
     */
    private static function cache_critical_summary(array $checks): void {
        $critical = array_values(array_filter($checks, static function ($c) {
            return $c['status'] === 'error';
        }));
        set_transient(self::TRANSIENT, ['failures' => $critical], self::CACHE_TTL);
    }

    /**
     * Critical failures (status "error") from cache; runs the checks when the
     * cache is cold.
     *
     * @return array[] Failed critical checks (empty array = healthy).
     */
    public static function get_critical_failures(): array {
        $cached = get_transient(self::TRANSIENT);
        if (!is_array($cached)) {
            self::run_checks();
            $cached = get_transient(self::TRANSIENT);
        }
        return is_array($cached) ? ($cached['failures'] ?? []) : [];
    }

    /** Force fresh results on the next check (e.g. after saving settings). */
    public static function flush_cache(): void {
        delete_transient(self::TRANSIENT);
    }
}

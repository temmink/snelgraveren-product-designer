<?php
namespace ProductDesigner\Export;

defined('ABSPATH') || exit;

class FileUtils {

    /**
     * Convert a URL to a local file path if it's on this server.
     */
    public static function url_to_local_path(string $url): string {
        $upload_dir = wp_upload_dir();
        $base_url = $upload_dir['baseurl'];
        $base_dir = $upload_dir['basedir'];

        if (str_starts_with($url, $base_url)) {
            return str_replace($base_url, $base_dir, $url);
        }

        $site_url = site_url();
        $abspath  = ABSPATH;
        if (str_starts_with($url, $site_url)) {
            $relative = str_replace($site_url, '', $url);
            $path = $abspath . ltrim($relative, '/');
            if (file_exists($path)) {
                return $path;
            }
        }

        return '';
    }
}

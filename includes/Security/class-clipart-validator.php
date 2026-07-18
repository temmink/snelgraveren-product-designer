<?php
namespace ProductForge\Security;

defined('ABSPATH') || exit;

class ClipartValidator {

    private const MAX_FILE_SIZE = 512 * 1024; // 512 KB
    private const RATE_LIMIT    = 20;          // per minute (admin-only, higher than customer limit)

    public static function validate_and_store(array $file): array {
        self::check_rate_limit();
        self::check_size($file);
        self::check_mime($file['tmp_name']);
        self::sanitize_svg($file['tmp_name']);

        return self::move_file($file);
    }

    private static function check_rate_limit(): void {
        $key   = 'pf_clipart_upload_' . get_current_user_id();
        $count = (int) get_transient($key);
        if ($count >= self::RATE_LIMIT) {
            throw new \RuntimeException('Upload rate limit exceeded. Please wait a minute.', 429);
        }
        set_transient($key, $count + 1, MINUTE_IN_SECONDS);
    }

    private static function check_size(array $file): void {
        if ($file['size'] > self::MAX_FILE_SIZE) {
            throw new \RuntimeException('Clip art file exceeds maximum size of 512 KB.', 400);
        }
    }

    private static function check_mime(string $tmp): void {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime  = finfo_file($finfo, $tmp);
        finfo_close($finfo);

        if ($mime !== 'image/svg+xml') {
            throw new \RuntimeException(esc_html(sprintf("File type '%s' is not allowed. Only SVG files are accepted.", $mime)), 400);
        }
    }

    private static function sanitize_svg(string $tmp): void {
        if (!class_exists(\enshrined\svgSanitize\Sanitizer::class)) {
            throw new \RuntimeException('SVG sanitizer not available.', 500);
        }
        $sanitizer = new \enshrined\svgSanitize\Sanitizer();
        $dirty     = file_get_contents($tmp);
        $clean     = $sanitizer->sanitize($dirty);
        if ($clean === false) {
            throw new \RuntimeException('SVG file could not be sanitized.', 400);
        }
        file_put_contents($tmp, $clean);
    }

    private static function move_file(array $file): array {
        require_once ABSPATH . 'wp-admin/includes/file.php';

        // MIME is already verified above via finfo, and the SVG content is
        // already sanitized; skip wp_handle_upload()'s own
        // wp_check_filetype_and_ext() re-check — it can't fingerprint SVG via
        // getimagesize() and is known to false-reject valid SVG uploads.
        $uploaded = wp_handle_upload($file, [
            'test_form' => false,
            'test_type' => false,
        ]);
        if (!empty($uploaded['error'])) {
            throw new \RuntimeException(esc_html($uploaded['error']), 500);
        }

        // wp_handle_upload() places the file in the default uploads/Y/m dir;
        // relocate it into our dedicated subdirectory with a random filename.
        $upload_dir = wp_upload_dir();
        $dir        = $upload_dir['basedir'] . '/pf-clipart';
        wp_mkdir_p($dir);

        $filename = bin2hex(random_bytes(8)) . '.svg';
        $dest     = $dir . '/' . $filename;

        global $wp_filesystem;
        if (empty($wp_filesystem)) {
            WP_Filesystem();
        }
        if (!$wp_filesystem || !$wp_filesystem->move($uploaded['file'], $dest, true)) {
            throw new \RuntimeException('Failed to move uploaded clip art file.', 500);
        }

        return [
            'svg_url' => $upload_dir['baseurl'] . '/pf-clipart/' . $filename,
        ];
    }
}

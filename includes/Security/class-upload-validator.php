<?php
namespace ProductDesigner\Security;

defined('ABSPATH') || exit;

class UploadValidator {

    private const ALLOWED_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/svg+xml',
    ];

    private const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    private const RATE_LIMIT    = 10; // per minute per session

    /**
     * Validate an uploaded file. Returns ['url' => '...'] on success,
     * throws \RuntimeException on failure.
     */
    public static function validate_and_store(array $file, string $session_id): array {
        self::check_rate_limit($session_id);
        self::check_size($file);
        $mime = self::detect_mime($file['tmp_name']);
        self::check_mime($mime);

        if ($mime === 'image/svg+xml') {
            self::sanitize_svg($file['tmp_name']);
        }

        return self::move_file($file, $mime);
    }

    private static function check_rate_limit(string $session_id): void {
        $key   = 'pd_upload_count_' . md5($session_id);
        $count = (int) get_transient($key);
        if ($count >= self::RATE_LIMIT) {
            throw new \RuntimeException('Upload rate limit exceeded. Please wait a minute.', 429);
        }
        set_transient($key, $count + 1, MINUTE_IN_SECONDS);
    }

    private static function check_size(array $file): void {
        if ($file['size'] > self::MAX_FILE_SIZE) {
            throw new \RuntimeException('File exceeds maximum size of 10 MB.', 400);
        }
    }

    private static function detect_mime(string $tmp): string {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime  = finfo_file($finfo, $tmp);
        finfo_close($finfo);
        return (string) $mime;
    }

    private static function check_mime(string $mime): void {
        if (!in_array($mime, self::ALLOWED_MIME_TYPES, true)) {
            throw new \RuntimeException("File type '{$mime}' is not allowed.", 400);
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

    private static function move_file(array $file, string $mime): array {
        $upload_dir = wp_upload_dir();
        $subdir     = '/product-designer/' . date('Y/m');
        $dir        = $upload_dir['basedir'] . $subdir;
        wp_mkdir_p($dir);

        $ext      = self::ext_for_mime($mime);
        $filename = bin2hex(random_bytes(8)) . '.' . $ext;
        $dest     = $dir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            throw new \RuntimeException('Failed to move uploaded file.', 500);
        }

        return ['url' => $upload_dir['baseurl'] . $subdir . '/' . $filename];
    }

    private static function ext_for_mime(string $mime): string {
        return match ($mime) {
            'image/jpeg'   => 'jpg',
            'image/png'    => 'png',
            'image/webp'   => 'webp',
            'image/svg+xml' => 'svg',
            default        => 'bin',
        };
    }
}

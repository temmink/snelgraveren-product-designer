<?php
namespace ProductForge\Security;

defined('ABSPATH') || exit;

class FontValidator {

    private const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

    private const MAGIC_BYTES = [
        'woff2'    => 'wOF2',
        'woff'     => 'wOFF',
        'truetype' => "\x00\x01\x00\x00",
    ];

    private const MIME_MAP = [
        'font/woff2'                => 'woff2',
        'font/woff'                 => 'woff',
        'application/font-woff'     => 'woff',
        'font/ttf'                  => 'truetype',
        'font/sfnt'                 => 'truetype',
        'application/x-font-ttf'   => 'truetype',
        'application/font-sfnt'    => 'truetype',
        'application/octet-stream' => null,
    ];

    private const EXT_MAP = [
        'woff2' => 'woff2',
        'woff'  => 'woff',
        'ttf'   => 'truetype',
    ];

    public static function validate_and_store(array $file): array {
        self::check_size($file);
        $format = self::detect_format($file);

        return self::move_file($file, $format);
    }

    private static function check_size(array $file): void {
        if ($file['size'] > self::MAX_FILE_SIZE) {
            throw new \RuntimeException('Font file exceeds maximum size of 5 MB.', 400);
        }
    }

    private static function detect_format(array $file): string {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime  = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);

        if (isset(self::MIME_MAP[$mime]) && self::MIME_MAP[$mime] !== null) {
            return self::MIME_MAP[$mime];
        }

        if (isset(self::MIME_MAP[$mime])) {
            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            if (isset(self::EXT_MAP[$ext])) {
                $format = self::EXT_MAP[$ext];
                // Verify magic bytes to prevent arbitrary files with font extensions
                if (isset(self::MAGIC_BYTES[$format])) {
                    $header = file_get_contents($file['tmp_name'], false, null, 0, 4);
                    if ($header !== self::MAGIC_BYTES[$format]) {
                        throw new \RuntimeException("Font file content does not match expected format.", 400);
                    }
                }
                return $format;
            }
        }

        throw new \RuntimeException("Font file type '{$mime}' is not allowed. Use .woff2, .woff, or .ttf files.", 400);
    }

    private static function move_file(array $file, string $format): array {
        $upload_dir = wp_upload_dir();
        $dir        = $upload_dir['basedir'] . '/pf-fonts';
        wp_mkdir_p($dir);

        $ext_map  = ['woff2' => 'woff2', 'woff' => 'woff', 'truetype' => 'ttf'];
        $ext      = $ext_map[$format] ?? 'bin';
        $filename = bin2hex(random_bytes(8)) . '.' . $ext;
        $dest     = $dir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            throw new \RuntimeException('Failed to move uploaded font file.', 500);
        }

        return [
            'file_url' => $upload_dir['baseurl'] . '/pf-fonts/' . $filename,
            'format'   => $format,
        ];
    }
}

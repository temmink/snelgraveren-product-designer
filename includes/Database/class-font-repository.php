<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

class FontRepository {

    private static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_fonts';
    }

    public static function all(): array {
        global $wpdb;
        $table = self::table();

        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- no user input, table name only
        $rows = $wpdb->get_results(
            "SELECT id, family, file_url, format, created_at FROM `{$table}` ORDER BY family, id",
            ARRAY_A
        );

        $grouped = [];
        foreach ($rows as $row) {
            $family = $row['family'];
            if (!isset($grouped[$family])) {
                $grouped[$family] = ['family' => $family, 'files' => []];
            }
            $grouped[$family]['files'][] = [
                'id'       => (int) $row['id'],
                'file_url' => $row['file_url'],
                'format'   => $row['format'],
            ];
        }

        return array_values($grouped);
    }

    public static function insert(string $family, string $file_url, string $format): int {
        global $wpdb;

        $wpdb->insert(self::table(), [
            'family'   => $family,
            'file_url' => $file_url,
            'format'   => $format,
        ], ['%s', '%s', '%s']);

        return (int) $wpdb->insert_id;
    }

    public static function delete(int $id): ?array {
        global $wpdb;
        $table = self::table();

        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT id, family, file_url, format FROM `{$table}` WHERE id = %d", $id),
            ARRAY_A
        );

        if (!$row) {
            return null;
        }

        $wpdb->delete($table, ['id' => $id], ['%d']);

        return $row;
    }

    public static function delete_family(string $family): array {
        global $wpdb;
        $table = self::table();

        $rows = $wpdb->get_results(
            $wpdb->prepare("SELECT id, file_url FROM `{$table}` WHERE family = %s", $family),
            ARRAY_A
        );

        if (!empty($rows)) {
            $wpdb->delete($table, ['family' => $family], ['%s']);
        }

        return $rows;
    }
}

<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class ClipartRepository {

    private static function collections_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_clipart_collections';
    }

    private static function items_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_clipart';
    }

    public static function list_collections(): array {
        global $wpdb;
        $ct = self::collections_table();
        $it = self::items_table();

        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- no user input, table names only
        return $wpdb->get_results(
            "SELECT c.id, c.name, c.created_at, COUNT(i.id) AS item_count
             FROM `{$ct}` c
             LEFT JOIN `{$it}` i ON i.collection_id = c.id
             GROUP BY c.id
             ORDER BY c.name",
            ARRAY_A
        );
    }

    public static function get_collection(int $id): ?array {
        global $wpdb;
        $ct = self::collections_table();
        $it = self::items_table();

        $collection = $wpdb->get_row(
            $wpdb->prepare("SELECT id, name, created_at FROM `{$ct}` WHERE id = %d", $id),
            ARRAY_A
        );

        if (!$collection) {
            return null;
        }

        $collection['items'] = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT id, name, svg_url, created_at FROM `{$it}` WHERE collection_id = %d ORDER BY name",
                $id
            ),
            ARRAY_A
        );

        return $collection;
    }

    public static function create_collection(string $name): int {
        global $wpdb;

        $wpdb->insert(self::collections_table(), [
            'name' => $name,
        ], ['%s']);

        return (int) $wpdb->insert_id;
    }

    public static function collection_exists(int $id): bool {
        global $wpdb;
        $ct = self::collections_table();

        return (bool) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM `{$ct}` WHERE id = %d", $id)
        );
    }

    public static function rename_collection(int $id, string $name): bool {
        global $wpdb;

        if (!self::collection_exists($id)) {
            return false;
        }

        $wpdb->update(
            self::collections_table(),
            ['name' => $name],
            ['id' => $id],
            ['%s'],
            ['%d']
        );

        return true;
    }

    public static function delete_collection(int $id): ?array {
        global $wpdb;
        $it = self::items_table();

        if (!self::collection_exists($id)) {
            return null;
        }

        // Get all item URLs for file cleanup
        $items = $wpdb->get_results(
            $wpdb->prepare("SELECT id, svg_url FROM `{$it}` WHERE collection_id = %d", $id),
            ARRAY_A
        );

        // CASCADE will delete items, but we delete collection explicitly
        $wpdb->delete(self::collections_table(), ['id' => $id], ['%d']);

        return $items;
    }

    public static function create_item(int $collection_id, string $name, string $svg_url): int {
        global $wpdb;

        $wpdb->insert(self::items_table(), [
            'collection_id' => $collection_id,
            'name'          => $name,
            'svg_url'       => $svg_url,
        ], ['%d', '%s', '%s']);

        return (int) $wpdb->insert_id;
    }

    public static function get_item(int $id): ?array {
        global $wpdb;
        $it = self::items_table();

        return $wpdb->get_row(
            $wpdb->prepare(
                "SELECT id, collection_id, name, svg_url FROM `{$it}` WHERE id = %d",
                $id
            ),
            ARRAY_A
        );
    }

    public static function delete_item(int $id): ?array {
        global $wpdb;
        $it = self::items_table();

        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT id, svg_url FROM `{$it}` WHERE id = %d", $id),
            ARRAY_A
        );

        if (!$row) {
            return null;
        }

        $wpdb->delete($it, ['id' => $id], ['%d']);

        return $row;
    }
}

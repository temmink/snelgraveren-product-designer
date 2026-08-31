<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

/**
 * Font groups: named sets of font-family strings. Templates store group IDS
 * in global_config.allowed_font_groups and the server expands them to family
 * names at read time (RestTemplates::get_public_template), so a font added to
 * a group later shows up in every template using that group — including
 * templates saved before the change.
 */
class FontGroupRepository {

    private static function groups_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_font_groups';
    }

    private static function members_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_font_group_members';
    }

    /** All groups with their member families: [{id, name, families: [..]}]. */
    public static function list_groups(): array {
        global $wpdb;
        $gt = self::groups_table();
        $mt = self::members_table();

        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- no user input, table names only
        $groups = $wpdb->get_results(
            "SELECT id, name, created_at FROM `{$gt}` ORDER BY name",
            ARRAY_A
        );

        if (empty($groups)) {
            return [];
        }

        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- no user input, table names only
        $members = $wpdb->get_results(
            "SELECT group_id, family FROM `{$mt}` ORDER BY family",
            ARRAY_A
        );

        $by_group = [];
        foreach ($members as $m) {
            $by_group[(int) $m['group_id']][] = $m['family'];
        }

        foreach ($groups as &$group) {
            $group['id']       = (int) $group['id'];
            $group['families'] = $by_group[$group['id']] ?? [];
        }

        return $groups;
    }

    public static function get_group(int $id): ?array {
        global $wpdb;
        $gt = self::groups_table();
        $mt = self::members_table();

        $group = $wpdb->get_row(
            $wpdb->prepare("SELECT id, name, created_at FROM `{$gt}` WHERE id = %d", $id),
            ARRAY_A
        );

        if (!$group) {
            return null;
        }

        $group['id']       = (int) $group['id'];
        $group['families'] = $wpdb->get_col(
            $wpdb->prepare("SELECT family FROM `{$mt}` WHERE group_id = %d ORDER BY family", $id)
        );

        return $group;
    }

    public static function group_exists(int $id): bool {
        global $wpdb;
        $gt = self::groups_table();

        return (bool) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM `{$gt}` WHERE id = %d", $id)
        );
    }

    public static function create_group(string $name): int {
        global $wpdb;

        $wpdb->insert(self::groups_table(), [
            'name' => $name,
        ], ['%s']);

        return (int) $wpdb->insert_id;
    }

    public static function rename_group(int $id, string $name): bool {
        global $wpdb;

        if (!self::group_exists($id)) {
            return false;
        }

        $wpdb->update(
            self::groups_table(),
            ['name' => $name],
            ['id' => $id],
            ['%s'],
            ['%d']
        );

        return true;
    }

    public static function delete_group(int $id): bool {
        global $wpdb;

        if (!self::group_exists($id)) {
            return false;
        }

        // FK cascade removes the member rows.
        $wpdb->delete(self::groups_table(), ['id' => $id], ['%d']);

        return true;
    }

    /** Replace a group's whole member list with $families (deduplicated). */
    public static function set_members(int $id, array $families): bool {
        global $wpdb;
        $mt = self::members_table();

        if (!self::group_exists($id)) {
            return false;
        }

        $wpdb->delete($mt, ['group_id' => $id], ['%d']);

        foreach (array_unique($families) as $family) {
            if (!is_string($family) || trim($family) === '') {
                continue;
            }
            $wpdb->insert($mt, [
                'group_id' => $id,
                'family'   => trim($family),
            ], ['%d', '%s']);
        }

        return true;
    }

    /** Remove a family from every group (cleanup when a custom font family is deleted). */
    public static function remove_family(string $family): void {
        global $wpdb;

        $wpdb->delete(self::members_table(), ['family' => $family], ['%s']);
    }

    /**
     * Expand group ids to a flat, deduplicated list of family names.
     * Unknown/deleted ids are silently skipped — a template referencing a
     * removed group must keep working with whatever remains.
     */
    public static function resolve_families(array $group_ids): array {
        global $wpdb;
        $mt = self::members_table();

        $ids = array_values(array_filter(array_map('intval', $group_ids), fn($id) => $id > 0));
        if (empty($ids)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- placeholders built from a counted list, values go through prepare()
        $families = $wpdb->get_col(
            // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
            $wpdb->prepare("SELECT DISTINCT family FROM `{$mt}` WHERE group_id IN ({$placeholders}) ORDER BY family", $ids)
        );

        return array_values($families);
    }
}

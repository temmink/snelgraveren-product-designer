<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class DesignTemplateRepository {

    private static function templates_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_design_templates';
    }

    private static function views_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_design_template_views';
    }

    /**
     * List design templates with optional filters.
     *
     * @param string|null $status   Filter by status (e.g. 'active').
     * @param int|null    $template_id Filter by associated product template.
     * @param int[]|null  $ids      Filter to specific IDs.
     */
    public static function list(
        ?string $status = null,
        ?int $template_id = null,
        ?array $ids = null
    ): array {
        global $wpdb;
        $tt = self::templates_table();

        $where  = [];
        $values = [];

        if ($status !== null) {
            $where[]  = 'status = %s';
            $values[] = $status;
        }

        if ($template_id !== null) {
            $where[]  = '(template_id IS NULL OR template_id = %d)';
            $values[] = $template_id;
        }

        if ($ids !== null && count($ids) > 0) {
            $placeholders = implode(',', array_fill(0, count($ids), '%d'));
            $where[]      = "id IN ({$placeholders})";
            $values       = array_merge($values, $ids);
        }

        $where_sql = count($where) > 0 ? 'WHERE ' . implode(' AND ', $where) : '';

        if (count($values) > 0) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT id, name, category, thumbnail_url, template_id, status, created_at, updated_at
                     FROM `{$tt}` {$where_sql}
                     ORDER BY name",
                    ...$values
                ),
                ARRAY_A
            );
        } else {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- no user input
            $rows = $wpdb->get_results(
                "SELECT id, name, category, thumbnail_url, template_id, status, created_at, updated_at
                 FROM `{$tt}`
                 ORDER BY name",
                ARRAY_A
            );
        }

        return $rows ?: [];
    }

    /**
     * Get a single design template with its views.
     */
    public static function get(int $id): ?array {
        global $wpdb;
        $tt = self::templates_table();

        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT id, name, category, thumbnail_url, template_id, status, created_at, updated_at
                 FROM `{$tt}` WHERE id = %d",
                $id
            ),
            ARRAY_A
        );

        if (!$row) {
            return null;
        }

        $row['views'] = self::get_views((int) $row['id']);

        return $row;
    }

    /**
     * Get views for a design template.
     */
    public static function get_views(int $design_template_id): array {
        global $wpdb;
        $vt = self::views_table();

        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT id, design_template_id, view_index, canvas_json
                 FROM `{$vt}` WHERE design_template_id = %d ORDER BY view_index",
                $design_template_id
            ),
            ARRAY_A
        );

        if (!$rows) {
            return [];
        }

        foreach ($rows as &$view) {
            $view['canvas_json'] = json_decode($view['canvas_json'], true);
        }

        return $rows;
    }

    /**
     * Create a design template with optional views.
     *
     * @param array $data Keys: name, category, thumbnail_url, template_id, status, views.
     */
    public static function create(array $data): int {
        global $wpdb;

        $wpdb->insert(self::templates_table(), [
            'name'          => $data['name'],
            'category'      => $data['category'] ?? '',
            'thumbnail_url' => $data['thumbnail_url'] ?? '',
            'template_id'   => $data['template_id'] ?? null,
            'status'        => $data['status'] ?? 'active',
        ], ['%s', '%s', '%s', '%d', '%s']);

        $id = (int) $wpdb->insert_id;

        if (!empty($data['views']) && is_array($data['views'])) {
            self::insert_views($id, $data['views']);
        }

        return $id;
    }

    /**
     * Update an existing design template.
     */
    public static function update(int $id, array $data): bool {
        global $wpdb;

        if (!self::exists($id)) {
            return false;
        }

        $fields  = [];
        $formats = [];

        foreach (['name', 'category', 'thumbnail_url', 'status'] as $key) {
            if (array_key_exists($key, $data)) {
                $fields[$key] = $data[$key];
                $formats[]    = '%s';
            }
        }

        if (array_key_exists('template_id', $data)) {
            $fields['template_id'] = $data['template_id'];
            $formats[]             = '%d';
        }

        if (count($fields) > 0) {
            $wpdb->update(self::templates_table(), $fields, ['id' => $id], $formats, ['%d']);
        }

        // Replace views if provided
        if (isset($data['views']) && is_array($data['views'])) {
            $vt = self::views_table();
            $wpdb->delete($vt, ['design_template_id' => $id], ['%d']);
            self::insert_views($id, $data['views']);
        }

        return true;
    }

    /**
     * Delete a design template. CASCADE handles views.
     */
    public static function delete(int $id): bool {
        global $wpdb;

        if (!self::exists($id)) {
            return false;
        }

        $wpdb->delete(self::templates_table(), ['id' => $id], ['%d']);

        return true;
    }

    /**
     * Check if a design template exists.
     */
    public static function exists(int $id): bool {
        global $wpdb;
        $tt = self::templates_table();

        return (bool) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM `{$tt}` WHERE id = %d", $id)
        );
    }

    /**
     * Insert views for a design template.
     */
    private static function insert_views(int $design_template_id, array $views): void {
        global $wpdb;
        $vt = self::views_table();

        foreach ($views as $index => $view) {
            $canvas_json = $view['canvas_json'] ?? $view;
            if (is_array($canvas_json)) {
                $canvas_json = wp_json_encode($canvas_json);
            }

            $wpdb->insert($vt, [
                'design_template_id' => $design_template_id,
                'view_index'         => $view['view_index'] ?? $index,
                'canvas_json'        => $canvas_json,
            ], ['%d', '%d', '%s']);
        }
    }
}

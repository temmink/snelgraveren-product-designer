<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class TemplateRepository {

    private string $table;
    private string $views_table;

    public function __construct() {
        global $wpdb;
        $this->table       = $wpdb->prefix . 'pf_templates';
        $this->views_table = $wpdb->prefix . 'pf_template_views';
    }

    public function list(int $per_page = 20, int $page = 1, string $status = ''): array {
        global $wpdb;
        $offset = ($page - 1) * $per_page;

        if ($status !== '') {
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT * FROM {$this->table} WHERE status = %s ORDER BY created_at DESC LIMIT %d OFFSET %d",
                    $status, $per_page, $offset
                ),
                ARRAY_A
            );
        } else {
            // "All" excludes trashed templates.
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT * FROM {$this->table} WHERE status != 'trashed' ORDER BY created_at DESC LIMIT %d OFFSET %d",
                    $per_page, $offset
                ),
                ARRAY_A
            );
        }

        return $rows ?: [];
    }

    public function count(string $status = ''): int {
        global $wpdb;
        if ($status !== '') {
            return (int) $wpdb->get_var(
                $wpdb->prepare("SELECT COUNT(*) FROM {$this->table} WHERE status = %s", $status)
            );
        }
        // "All" excludes trashed.
        return (int) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM {$this->table} WHERE status != %s", 'trashed')
        );
    }

    public function get_status_counts(): array {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal, no user input
        $rows = $wpdb->get_results(
            "SELECT status, COUNT(*) as cnt FROM {$this->table} GROUP BY status",
            ARRAY_A
        );
        $counts = ['draft' => 0, 'published' => 0, 'archived' => 0, 'trashed' => 0];
        foreach ($rows as $row) {
            $counts[$row['status']] = (int) $row['cnt'];
        }
        return $counts;
    }

    public function get(int $id): ?array {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE id = %d", $id),
            ARRAY_A
        );
        if (!$row) return null;

        $row['global_config'] = json_decode($row['global_config'], true) ?: [];
        $row['views']         = $this->get_views($id);

        return $row;
    }

    /**
     * Look up a template by slug (any status). Used by StarterTemplates to detect
     * whether a starter (slug `starter-{id}`) has already been imported.
     */
    public function get_by_slug(string $slug): ?array {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE slug = %s ORDER BY id DESC LIMIT 1", $slug),
            ARRAY_A
        );
        if (!$row) return null;

        $row['global_config'] = json_decode($row['global_config'], true) ?: [];
        $row['views']         = $this->get_views((int) $row['id']);

        return $row;
    }

    public function create(array $data): int {
        global $wpdb;
        $wpdb->insert($this->table, [
            'title'         => sanitize_text_field($data['title'] ?? ''),
            'slug'          => sanitize_title($data['slug'] ?? $data['title'] ?? ''),
            'status'        => in_array($data['status'] ?? 'draft', ['draft', 'published', 'archived'], true)
                                ? $data['status'] : 'draft',
            'global_config' => wp_json_encode($data['global_config'] ?? []),
        ], ['%s', '%s', '%s', '%s']);
        return (int) $wpdb->insert_id;
    }

    public function update(int $id, array $data): bool {
        global $wpdb;
        $update = [];
        if (isset($data['title']))         $update['title']         = sanitize_text_field($data['title']);
        if (isset($data['slug']))          $update['slug']          = sanitize_title($data['slug']);
        if (isset($data['status']))        $update['status']        = in_array($data['status'], ['draft', 'published', 'archived', 'trashed'], true) ? $data['status'] : 'draft';
        if (isset($data['global_config'])) $update['global_config'] = wp_json_encode($data['global_config']);

        if (empty($update)) return true;

        $format = array_map(fn() => '%s', $update);
        $result = $wpdb->update($this->table, $update, ['id' => $id], $format, ['%d']);

        return $result !== false;
    }

    public function trash(int $id): bool {
        return $this->update($id, ['status' => 'trashed']);
    }

    public function restore(int $id): bool {
        return $this->update($id, ['status' => 'draft']);
    }

    public function delete(int $id): bool {
        global $wpdb;
        // Delete views first, then the template.
        $wpdb->delete($this->views_table, ['template_id' => $id], ['%d']);
        return (bool) $wpdb->delete($this->table, ['id' => $id], ['%d']);
    }

    public function duplicate(int $id): ?int {
        global $wpdb;
        $original = $this->get($id);
        if (!$original) return null;

        $new_id = $this->create([
            'title'         => $original['title'] . ' (Copy)',
            'slug'          => $original['slug'] . '-copy-' . time(),
            'status'        => 'draft',
            'global_config' => $original['global_config'],
        ]);

        foreach ($original['views'] as $view) {
            unset($view['id']);
            $view['template_id'] = $new_id;
            $this->create_view($new_id, $view);
        }

        return $new_id;
    }

    public function count_views(int $id): int {
        global $wpdb;
        return (int) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM {$this->views_table} WHERE template_id = %d", $id)
        );
    }

    public function count_products(int $id): int {
        global $wpdb;
        return (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(DISTINCT post_id) FROM {$wpdb->postmeta} WHERE meta_key = '_pf_template_id' AND meta_value = %s",
                (string) $id
            )
        );
    }

    /**
     * Count views for multiple templates in a single query.
     * @return array<int, int> [template_id => count]
     */
    public function count_views_batch(array $template_ids): array {
        global $wpdb;
        if (empty($template_ids)) {
            return [];
        }
        $ids          = array_map('intval', $template_ids);
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        $results      = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT template_id, COUNT(*) as cnt FROM {$this->views_table} WHERE template_id IN ($placeholders) GROUP BY template_id",
                ...$ids
            ),
            ARRAY_A
        );
        $counts = [];
        foreach ($results as $row) {
            $counts[(int) $row['template_id']] = (int) $row['cnt'];
        }
        return $counts;
    }

    /**
     * Count products using each template in a single query.
     * @return array<int, int> [template_id => count]
     */
    public function count_products_batch(array $template_ids): array {
        global $wpdb;
        if (empty($template_ids)) {
            return [];
        }
        $ids          = array_map('intval', $template_ids);
        $placeholders = implode(',', array_fill(0, count($ids), '%s'));
        $results      = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT meta_value as template_id, COUNT(*) as cnt FROM {$wpdb->postmeta} WHERE meta_key = '_pf_template_id' AND meta_value IN ($placeholders) GROUP BY meta_value",
                ...array_map('strval', $ids)
            ),
            ARRAY_A
        );
        $counts = [];
        foreach ($results as $row) {
            $counts[(int) $row['template_id']] = (int) $row['cnt'];
        }
        return $counts;
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    public function get_views(int $template_id): array {
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->views_table} WHERE template_id = %d ORDER BY sort_order ASC",
                $template_id
            ),
            ARRAY_A
        );
        return array_map([$this, 'decode_view'], $rows ?: []);
    }

    public function get_view(int $template_id, int $view_id): ?array {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$this->views_table} WHERE id = %d AND template_id = %d",
                $view_id, $template_id
            ),
            ARRAY_A
        );
        return $row ? $this->decode_view($row) : null;
    }

    public function create_view(int $template_id, array $data): int {
        global $wpdb;
        $wpdb->insert($this->views_table, [
            'template_id'      => $template_id,
            'name'             => sanitize_text_field($data['name'] ?? ''),
            'sort_order'       => (int) ($data['sort_order'] ?? 0),
            'canvas_width'     => max(1, (int) ($data['canvas_width'] ?? 800)),
            'canvas_height'    => max(1, (int) ($data['canvas_height'] ?? 600)),
            'width_mm'         => max(0, (float) ($data['width_mm'] ?? 0)),
            'background_url'   => esc_url_raw($data['background_url'] ?? ''),
            'background_transform' => wp_json_encode($data['background_transform'] ?? new \stdClass()),
            'zones_config'     => wp_json_encode($data['zones_config'] ?? []),
            'layers_config'    => wp_json_encode($data['layers_config'] ?? []),
            'permissions'      => wp_json_encode($data['permissions'] ?? []),
        ], ['%d', '%s', '%d', '%d', '%d', '%f', '%s', '%s', '%s', '%s', '%s']);

        return (int) $wpdb->insert_id;
    }

    public function update_view(int $template_id, int $view_id, array $data): bool {
        global $wpdb;
        $update = [];
        if (isset($data['name']))             $update['name']             = sanitize_text_field($data['name']);
        if (isset($data['sort_order']))       $update['sort_order']       = (int) $data['sort_order'];
        if (isset($data['canvas_width']))     $update['canvas_width']     = max(1, (int) $data['canvas_width']);
        if (isset($data['canvas_height']))    $update['canvas_height']    = max(1, (int) $data['canvas_height']);
        if (isset($data['width_mm']))         $update['width_mm']         = max(0, (float) $data['width_mm']);
        if (isset($data['background_url']))       $update['background_url']       = esc_url_raw($data['background_url']);
        if (isset($data['background_transform'])) $update['background_transform'] = wp_json_encode($data['background_transform']);
        if (isset($data['zones_config']))     $update['zones_config']       = wp_json_encode($data['zones_config']);
        if (isset($data['layers_config']))    $update['layers_config']      = wp_json_encode($data['layers_config']);
        if (isset($data['permissions']))      $update['permissions']        = wp_json_encode($data['permissions']);

        if (empty($update)) return true;

        // Build format array matching the dynamic update columns
        $format_map = [
            'name' => '%s', 'sort_order' => '%d', 'canvas_width' => '%d',
            'canvas_height' => '%d', 'width_mm' => '%f', 'background_url' => '%s', 'background_transform' => '%s',
            'zones_config' => '%s', 'layers_config' => '%s', 'permissions' => '%s',
        ];
        $format = array_map(fn($k) => $format_map[$k] ?? '%s', array_keys($update));

        $result = $wpdb->update(
            $this->views_table,
            $update,
            ['id' => $view_id, 'template_id' => $template_id],
            $format,
            ['%d', '%d']
        );

        // $wpdb->update returns false on error, 0 if no rows changed (data identical).
        return $result !== false;
    }

    public function delete_view(int $template_id, int $view_id): bool {
        global $wpdb;
        $result = (bool) $wpdb->delete(
            $this->views_table,
            ['id' => $view_id, 'template_id' => $template_id],
            ['%d', '%d']
        );

        return $result;
    }

    private function decode_view(array $row): array {
        $row['width_mm']              = (float) ($row['width_mm'] ?? 0);
        $row['zones_config']          = json_decode($row['zones_config'] ?? '', true)  ?: [];
        $row['layers_config']         = json_decode($row['layers_config'] ?? '', true) ?: [];
        $row['permissions']           = json_decode($row['permissions'] ?? '', true)   ?: [];
        $row['background_transform']  = json_decode($row['background_transform'] ?? '', true) ?: new \stdClass();

        // Migrate: if zones don't have nested layers but layers_config exists, merge them.
        if (!empty($row['layers_config']) && is_array($row['layers_config'])) {
            $hasNested = false;
            foreach ($row['zones_config'] as $zone) {
                if (isset($zone['layers'])) { $hasNested = true; break; }
            }
            if (!$hasNested && !empty($row['zones_config'])) {
                foreach ($row['layers_config'] as $layer) {
                    $cx = ($layer['left'] ?? 0) + (($layer['width'] ?? 0) / 2);
                    $cy = ($layer['top'] ?? 0) + (($layer['height'] ?? 0) / 2);
                    $bestIdx = 0;
                    $bestArea = PHP_INT_MAX;
                    foreach ($row['zones_config'] as $i => $z) {
                        if ($cx >= $z['x'] && $cx <= $z['x'] + $z['width'] &&
                            $cy >= $z['y'] && $cy <= $z['y'] + $z['height']) {
                            $area = $z['width'] * $z['height'];
                            if ($area < $bestArea) { $bestIdx = $i; $bestArea = $area; }
                        }
                    }
                    $row['zones_config'][$bestIdx]['layers'][] = $layer;
                }
            }
            unset($row['layers_config']);
        }

        return $row;
    }
}

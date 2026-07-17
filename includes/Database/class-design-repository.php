<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class DesignRepository {

    private string $table;
    private string $views_table;

    /** @var array<string, ?array> Request-level cache keyed by design hash. */
    private static array $hash_cache = [];

    public function __construct() {
        global $wpdb;
        $this->table       = $wpdb->prefix . 'pf_designs';
        $this->views_table = $wpdb->prefix . 'pf_design_views';
    }

    public function list(int $per_page = 20, int $page = 1): array {
        global $wpdb;
        $offset = ($page - 1) * $per_page;
        return $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->table} ORDER BY created_at DESC LIMIT %d OFFSET %d",
                $per_page, $offset
            ),
            ARRAY_A
        ) ?: [];
    }

    public function count(): int {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal
        return (int) $wpdb->get_var("SELECT COUNT(*) FROM {$this->table}");
    }

    public function get(int $id): ?array {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE id = %d", $id),
            ARRAY_A
        );
        if (!$row) return null;
        $row['views'] = $this->get_views($id);
        return $row;
    }

    public function get_by_hash(string $hash): ?array {
        if (array_key_exists($hash, self::$hash_cache)) {
            return self::$hash_cache[$hash];
        }

        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE design_hash = %s", $hash),
            ARRAY_A
        );
        if (!$row) {
            self::$hash_cache[$hash] = null;
            return null;
        }
        $row['views'] = $this->get_views((int) $row['id']);
        self::$hash_cache[$hash] = $row;
        return $row;
    }

    /**
     * Invalidate the request-level cache for a given hash (call after mutations).
     */
    public function invalidate_cache(string $hash): void {
        unset(self::$hash_cache[$hash]);
    }

    public function create(array $data): int {
        global $wpdb;
        $hash = bin2hex(random_bytes(16));
        $wpdb->insert($this->table, [
            'design_hash' => $hash,
            'template_id' => (int) ($data['template_id'] ?? 0),
            'product_id'  => (int) ($data['product_id'] ?? 0),
            'customer_id' => (int) ($data['customer_id'] ?? 0),
            'session_id'  => sanitize_text_field($data['session_id'] ?? ''),
            'status'      => 'draft',
            'total_price' => 0.00,
        ], ['%s', '%d', '%d', '%d', '%s', '%s', '%f']);
        return (int) $wpdb->insert_id;
    }

    public function update_status(int $id, string $status): bool {
        global $wpdb;
        $allowed = ['draft', 'final', 'ordered', 'archived'];
        if (!in_array($status, $allowed, true)) return false;
        return (bool) $wpdb->update($this->table, ['status' => $status], ['id' => $id], ['%s'], ['%d']);
    }

    /**
     * Mark a design as ordered (called at checkout). Idempotent.
     */
    public function mark_ordered_by_hash(string $hash): bool {
        global $wpdb;
        $result = $wpdb->update(
            $this->table,
            ['status' => 'ordered'],
            ['design_hash' => $hash],
            ['%s'],
            ['%s']
        );
        $this->invalidate_cache($hash);
        return $result !== false;
    }

    public function update_price(int $id, float $price): bool {
        global $wpdb;
        return (bool) $wpdb->update($this->table, ['total_price' => $price], ['id' => $id], ['%f'], ['%d']);
    }

    public function delete(int $id): bool {
        global $wpdb;
        return (bool) $wpdb->delete($this->table, ['id' => $id], ['%d']);
    }

    /**
     * Guest drafts untouched for $days days. Ordered designs are excluded by
     * status; registered customers' designs are kept for their account page.
     */
    public function find_stale_guest_drafts(int $days, int $limit = 200): array {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is a class property
        return $wpdb->get_results($wpdb->prepare(
            "SELECT id, design_hash FROM {$this->table}
             WHERE customer_id = 0 AND status = 'draft'
               AND updated_at < DATE_SUB(NOW(), INTERVAL %d DAY)
             ORDER BY updated_at ASC LIMIT %d",
            $days,
            $limit
        ), ARRAY_A) ?: [];
    }

    public function get_views(int $design_id): array {
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->views_table} WHERE design_id = %d",
                $design_id
            ),
            ARRAY_A
        );
        return array_map(function ($row) {
            $row['canvas_json'] = json_decode($row['canvas_json'], true) ?: [];
            return $row;
        }, $rows ?: []);
    }

    public function upsert_view(int $design_id, int $view_id, array $canvas_json, string $thumbnail = '', string $export_svg = ''): bool {
        global $wpdb;
        $existing = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT id FROM {$this->views_table} WHERE design_id = %d AND view_id = %d",
                $design_id, $view_id
            )
        );

        $json_str = wp_json_encode($canvas_json);

        if ($existing) {
            $data   = ['canvas_json' => $json_str];
            $format = ['%s'];
            if (!empty($thumbnail)) {
                $data['thumbnail'] = $thumbnail;
                $format[]          = '%s';
            }
            if (!empty($export_svg)) {
                $data['export_svg'] = $export_svg;
                $format[]           = '%s';
            }
            return (bool) $wpdb->update(
                $this->views_table,
                $data,
                ['id' => (int) $existing],
                $format,
                ['%d']
            );
        }

        $wpdb->insert($this->views_table, [
            'design_id'   => $design_id,
            'view_id'     => $view_id,
            'canvas_json' => $json_str,
            'thumbnail'   => $thumbnail,
            'export_svg'  => $export_svg,
        ], ['%d', '%d', '%s', '%s', '%s']);
        return (bool) $wpdb->insert_id;
    }
}

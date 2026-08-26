<?php
namespace Snelgraveren\ProductDesigner\Database;

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
        // wpdb->update() returns the number of affected rows or false on error;
        // 0 (status already had this value) is a success, so only a hard false
        // may be reported as failure.
        return false !== $wpdb->update($this->table, ['status' => $status], ['id' => $id], ['%s'], ['%d']);
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

    /**
     * Put a design on a customer's name. This is what makes "design it for the
     * customer, then hand it over" work at all: ownership decides whether the
     * design shows up under My Designs, whether the reopen link resolves, and
     * whether add-to-cart keeps the hash (Frontend::add_cart_item_data drops it
     * SILENTLY when it does not, so the product lands in the cart with no
     * design and no error).
     *
     * session_id is cleared, deliberately. Ownership is "customer_id matches OR
     * session_id matches" (RestDesigns::owns_design, mirrored in Frontend), so
     * leaving the guest session behind would keep the design reachable by
     * whoever still holds that cookie — including the browser it was drawn in.
     * One design, one owner.
     */
    public function assign_customer(int $id, int $customer_id): bool {
        global $wpdb;
        $hash = $wpdb->get_var($wpdb->prepare("SELECT design_hash FROM {$this->table} WHERE id = %d", $id));
        if (!$hash) {
            return false;
        }
        $result = $wpdb->update(
            $this->table,
            ['customer_id' => $customer_id, 'session_id' => ''],
            ['id' => $id],
            ['%d', '%s'],
            ['%d']
        );
        $this->invalidate_cache((string) $hash);
        // 0 affected rows means the design already had this owner — a success.
        return $result !== false;
    }

    /** Fields update_proof() may write. Nothing else, ever. */
    private const PROOF_FIELDS = ['proof_status', 'proof_token', 'proof_sent_at', 'proof_note', 'proof_email'];

    /**
     * Write proof fields on a design.
     *
     * The whitelist is the point: proof state and the design's production
     * `status` are separate axes, and a caller reaching for one must not be
     * able to move the other by passing an extra key.
     */
    public function update_proof(int $id, array $fields): bool {
        global $wpdb;

        $data    = [];
        $formats = [];
        foreach (self::PROOF_FIELDS as $field) {
            if (!array_key_exists($field, $fields)) {
                continue;
            }
            $data[$field]  = $fields[$field] === null ? null : (string) $fields[$field];
            $formats[]     = '%s';
        }
        if (!$data) {
            return false;
        }

        $hash = $wpdb->get_var($wpdb->prepare("SELECT design_hash FROM {$this->table} WHERE id = %d", $id));
        if (!$hash) {
            return false;
        }

        $result = $wpdb->update($this->table, $data, ['id' => $id], $formats, ['%d']);
        $this->invalidate_cache((string) $hash);
        return $result !== false;
    }

    /**
     * Look a design up by its proof token.
     *
     * An empty token matches nothing: every design without a proof carries
     * proof_token = '', so an empty needle would otherwise hand out an
     * arbitrary design to anyone who trims the parameter off the URL.
     */
    public function get_by_proof_token(string $token): ?array {
        if (!preg_match('/^[0-9a-f]{32}$/', $token)) {
            return null;
        }

        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE proof_token = %s", $token),
            ARRAY_A
        );
        if (!$row) {
            return null;
        }
        $row['views'] = $this->get_views((int) $row['id']);
        return $row;
    }

    /**
     * WHERE clause + bind values shared by list_for_admin/count_for_admin, so
     * the two can never disagree about what the filter means.
     *
     * @return array{0: string, 1: array}
     */
    private function admin_filter_sql(array $filters): array {
        global $wpdb;
        $where  = ['1=1'];
        $params = [];

        if (isset($filters['status']) && $filters['status'] !== '') {
            $where[]  = 'status = %s';
            $params[] = (string) $filters['status'];
        }
        if (!empty($filters['customer_id'])) {
            $where[]  = 'customer_id = %d';
            $params[] = (int) $filters['customer_id'];
        }
        if (isset($filters['search']) && $filters['search'] !== '') {
            // Hash prefix search: the admin has just made a design and knows the
            // first few characters from the reopen link.
            $where[]  = 'design_hash LIKE %s';
            $params[] = $wpdb->esc_like((string) $filters['search']) . '%';
        }

        return [implode(' AND ', $where), $params];
    }

    /**
     * Designs for the admin overview: newest first, with the first view's
     * thumbnail so the list is scannable by picture rather than by hash.
     */
    public function list_for_admin(int $per_page = 20, int $page = 1, array $filters = []): array {
        global $wpdb;
        [$where, $params] = $this->admin_filter_sql($filters);
        $params[] = max(1, $per_page);
        $params[] = (max(1, $page) - 1) * max(1, $per_page);

        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table names are class properties; $where is built from literals only
        return $wpdb->get_results($wpdb->prepare(
            "SELECT d.*,
                    (SELECT v.thumbnail FROM {$this->views_table} v WHERE v.design_id = d.id ORDER BY v.id ASC LIMIT 1) AS thumbnail
             FROM {$this->table} d
             WHERE {$where}
             ORDER BY d.updated_at DESC
             LIMIT %d OFFSET %d",
            $params
        ), ARRAY_A) ?: [];
    }

    public function count_for_admin(array $filters = []): int {
        global $wpdb;
        [$where, $params] = $this->admin_filter_sql($filters);
        if (!$params) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal, $where is literal
            return (int) $wpdb->get_var("SELECT COUNT(*) FROM {$this->table} WHERE {$where}");
        }
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal; $where is built from literals only
        return (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$this->table} WHERE {$where}", $params));
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
     * Design funnel for the stats panel. "Saved" = design rows created in
     * the window (a row only exists once a customer saves); "ordered" =
     * those that reached checkout (status flip since v1.0.0+checkout-hook).
     */
    public function funnel_stats(int $days = 30): array {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is a class property
        $saved = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$this->table} WHERE created_at >= DATE_SUB(NOW(), INTERVAL %d DAY)",
            $days
        ));
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $ordered = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$this->table} WHERE status = 'ordered' AND created_at >= DATE_SUB(NOW(), INTERVAL %d DAY)",
            $days
        ));
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $top = $wpdb->get_results($wpdb->prepare(
            "SELECT product_id, COUNT(*) AS cnt FROM {$this->table}
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL %d DAY) AND product_id > 0
             GROUP BY product_id ORDER BY cnt DESC LIMIT 5",
            $days
        ), ARRAY_A) ?: [];

        return ['saved' => $saved, 'ordered' => $ordered, 'top_products' => $top];
    }

    /**
     * Guest drafts untouched for $days days. Ordered designs are excluded by
     * status; registered customers' designs are kept for their account page.
     * Defensively re-excludes anything referenced by an order item or that
     * already has an export record, in case status somehow lagged behind
     * (belt-and-braces alongside the 'ordered' status backfill/flip).
     *
     * Designs with a proof are excluded regardless of age: a proof sent to
     * someone WITHOUT an account is exactly a customer_id = 0 guest draft, and
     * deleting it would kill the link still sitting in their mailbox.
     */
    public function find_stale_guest_drafts(int $days, int $limit = 200): array {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is a class property
        return $wpdb->get_results($wpdb->prepare(
            "SELECT d.id, d.design_hash FROM {$this->table} d
             WHERE d.customer_id = 0 AND d.status = 'draft'
               AND d.proof_status = 'none'
               AND d.updated_at < DATE_SUB(NOW(), INTERVAL %d DAY)
               AND NOT EXISTS (
                   SELECT 1 FROM {$wpdb->prefix}woocommerce_order_itemmeta m
                   WHERE m.meta_key = '_pf_design_hash' AND m.meta_value = d.design_hash
               )
               AND NOT EXISTS (
                   SELECT 1 FROM {$wpdb->prefix}pf_exports e WHERE e.design_id = d.id
               )
             ORDER BY d.updated_at ASC LIMIT %d",
            $days,
            $limit
        ), ARRAY_A) ?: [];
    }

    /**
     * One-time back-fill: designs referenced by existing order items were
     * saved before checkout started flipping status to 'ordered'. Without
     * this, the stale-guest-draft cleanup would treat them as abandoned
     * drafts and delete designs belonging to real historical orders.
     *
     * @return int Number of rows updated.
     */
    public function backfill_ordered_from_order_meta(): int {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table names are class properties/internal, no user input
        $result = $wpdb->query(
            "UPDATE {$this->table} d
             JOIN {$wpdb->prefix}woocommerce_order_itemmeta m
               ON m.meta_key = '_pf_design_hash' AND m.meta_value = d.design_hash
             SET d.status = 'ordered'
             WHERE d.status = 'draft'"
        );
        return $result === false ? 0 : (int) $result;
    }

    /**
     * Designs for the account page: newest first, with the first view's
     * thumbnail joined in (no full canvas_json payloads).
     */
    public function list_by_customer(int $customer_id, int $limit = 50): array {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table names are class properties
        return $wpdb->get_results($wpdb->prepare(
            "SELECT d.id, d.design_hash, d.product_id, d.status, d.total_price, d.created_at, d.updated_at,
                    (SELECT v.thumbnail FROM {$this->views_table} v WHERE v.design_id = d.id ORDER BY v.id ASC LIMIT 1) AS thumbnail
             FROM {$this->table} d
             WHERE d.customer_id = %d
             ORDER BY d.updated_at DESC
             LIMIT %d",
            $customer_id,
            $limit
        ), ARRAY_A) ?: [];
    }

    public function get_views(int $design_id): array {
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->views_table} WHERE design_id = %d ORDER BY id ASC",
                $design_id
            ),
            ARRAY_A
        );
        return array_map(function ($row) {
            $row['canvas_json'] = json_decode($row['canvas_json'], true) ?: [];
            return $row;
        }, $rows ?: []);
    }

    public function upsert_view(int $design_id, int $view_id, array $canvas_json, string $thumbnail = '', string $export_svg = '', string $export_vector = '', string $export_vector_embed = ''): bool {
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
            if (!empty($export_vector)) {
                $data['export_vector'] = $export_vector;
                $format[]              = '%s';
            }
            if (!empty($export_vector_embed)) {
                $data['export_vector_embed'] = $export_vector_embed;
                $format[]                    = '%s';
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
            'design_id'           => $design_id,
            'view_id'             => $view_id,
            'canvas_json'         => $json_str,
            'thumbnail'           => $thumbnail,
            'export_svg'          => $export_svg,
            'export_vector'       => $export_vector,
            'export_vector_embed' => $export_vector_embed,
        ], ['%d', '%d', '%s', '%s', '%s', '%s', '%s']);
        return (bool) $wpdb->insert_id;
    }
}

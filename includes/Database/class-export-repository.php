<?php
namespace ProductDesigner\Database;

defined('ABSPATH') || exit;

class ExportRepository {

    private string $table;

    public function __construct() {
        global $wpdb;
        $this->table = $wpdb->prefix . 'pd_exports';
    }

    public function create(int $design_id, int $order_id, string $format): int {
        global $wpdb;
        $allowed = ['pdf', 'png', 'svg'];
        $format  = in_array($format, $allowed, true) ? $format : 'pdf';
        $wpdb->insert($this->table, [
            'design_id' => $design_id,
            'order_id'  => $order_id,
            'format'    => $format,
            'status'    => 'pending',
        ], ['%d', '%d', '%s', '%s']);
        return (int) $wpdb->insert_id;
    }

    public function update_status(int $id, string $status, string $file_path = ''): bool {
        global $wpdb;
        $allowed = ['pending', 'processing', 'done', 'failed'];
        if (!in_array($status, $allowed, true)) return false;
        $data = ['status' => $status];
        if ($file_path !== '') $data['file_path'] = $file_path;
        $format_arr = ['%s'];
        if ($file_path !== '') $format_arr[] = '%s';
        return (bool) $wpdb->update($this->table, $data, ['id' => $id], $format_arr, ['%d']);
    }

    public function get_by_order(int $order_id): array {
        global $wpdb;
        return $wpdb->get_results(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE order_id = %d", $order_id),
            ARRAY_A
        ) ?: [];
    }

    public function get_by_id(int $id): ?array {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE id = %d", $id),
            ARRAY_A
        );
        return $row ?: null;
    }

    public function get_by_design(int $design_id): array {
        global $wpdb;
        return $wpdb->get_results(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE design_id = %d ORDER BY created_at DESC", $design_id),
            ARRAY_A
        ) ?: [];
    }

    public function delete(int $id): bool {
        global $wpdb;
        return (bool) $wpdb->delete($this->table, ['id' => $id], ['%d']);
    }
}

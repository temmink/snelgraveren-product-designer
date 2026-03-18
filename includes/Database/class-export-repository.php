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
        ]);
        return (int) $wpdb->insert_id;
    }

    public function update_status(int $id, string $status, string $file_path = ''): bool {
        global $wpdb;
        $allowed = ['pending', 'processing', 'done', 'failed'];
        if (!in_array($status, $allowed, true)) return false;
        $data = ['status' => $status];
        if ($file_path !== '') $data['file_path'] = $file_path;
        return (bool) $wpdb->update($this->table, $data, ['id' => $id]);
    }

    public function get_by_order(int $order_id): array {
        global $wpdb;
        return $wpdb->get_results(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE order_id = %d", $order_id),
            ARRAY_A
        ) ?: [];
    }
}

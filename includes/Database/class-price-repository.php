<?php
namespace ProductDesigner\Database;

defined('ABSPATH') || exit;

class PriceRepository {

    private string $table;

    public function __construct() {
        global $wpdb;
        $this->table = $wpdb->prefix . 'pd_price_log';
    }

    public function log(int $design_id, string $element_type, string $element_id, float $price): int {
        global $wpdb;
        $allowed = ['text', 'image', 'svg'];
        $type    = in_array($element_type, $allowed, true) ? $element_type : 'text';
        $wpdb->insert($this->table, [
            'design_id'    => $design_id,
            'element_type' => $type,
            'element_id'   => sanitize_text_field($element_id),
            'price'        => $price,
        ]);
        return (int) $wpdb->insert_id;
    }

    public function get_for_design(int $design_id): array {
        global $wpdb;
        return $wpdb->get_results(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE design_id = %d", $design_id),
            ARRAY_A
        ) ?: [];
    }
}

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
        ], ['%d', '%s', '%s', '%f']);
        return (int) $wpdb->insert_id;
    }

    /**
     * Batch insert multiple price log entries in a single query.
     *
     * @param array $entries Each entry: ['design_id' => int, 'element_type' => string, 'element_id' => string, 'price' => float]
     */
    public function log_batch(array $entries): void {
        if (empty($entries)) {
            return;
        }
        global $wpdb;
        $allowed = ['text', 'image', 'svg'];
        $values  = [];
        $format  = [];
        foreach ($entries as $entry) {
            $type = in_array($entry['element_type'], $allowed, true) ? $entry['element_type'] : 'text';
            $values[] = $wpdb->prepare('(%d, %s, %s, %f)', $entry['design_id'], $type, sanitize_text_field($entry['element_id']), $entry['price']);
        }
        // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- each value is individually prepared above
        $wpdb->query("INSERT INTO {$this->table} (design_id, element_type, element_id, price) VALUES " . implode(',', $values));
    }

    public function get_for_design(int $design_id): array {
        global $wpdb;
        return $wpdb->get_results(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE design_id = %d", $design_id),
            ARRAY_A
        ) ?: [];
    }

    public function delete_for_design(int $design_id): bool {
        global $wpdb;
        return (bool) $wpdb->delete($this->table, ['design_id' => $design_id], ['%d']);
    }
}

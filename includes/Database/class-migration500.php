<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class Migration500 {

    public function up(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        $collections_table = $wpdb->prefix . 'pf_clipart_collections';
        $clipart_table     = $wpdb->prefix . 'pf_clipart';

        $sql = "CREATE TABLE IF NOT EXISTS `{$collections_table}` (
            `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `name`       VARCHAR(255)    NOT NULL,
            `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`)
        ) ENGINE=InnoDB {$charset};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);

        $sql2 = "CREATE TABLE IF NOT EXISTS `{$clipart_table}` (
            `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `collection_id` BIGINT UNSIGNED NOT NULL,
            `name`          VARCHAR(255)    NOT NULL,
            `svg_url`       VARCHAR(2048)   NOT NULL,
            `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_collection` (`collection_id`)
        ) ENGINE=InnoDB {$charset};";

        dbDelta($sql2);

        // Add foreign key via raw query (dbDelta doesn't handle FK reliably)
        $wpdb->query(
            "ALTER TABLE `{$clipart_table}`
             ADD CONSTRAINT `fk_clipart_collection` FOREIGN KEY (`collection_id`)
             REFERENCES `{$collections_table}` (`id`) ON DELETE CASCADE"
        );
    }
}

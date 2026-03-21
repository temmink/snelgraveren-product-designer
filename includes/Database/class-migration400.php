<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class Migration400 {

    public function up(): void {
        global $wpdb;
        $table   = $wpdb->prefix . 'pf_fonts';
        $charset = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE IF NOT EXISTS `{$table}` (
            `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `family`     VARCHAR(255)    NOT NULL,
            `file_url`   VARCHAR(2048)   NOT NULL,
            `format`     VARCHAR(10)     NOT NULL COMMENT 'woff2, woff, or truetype',
            `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_family` (`family`)
        ) ENGINE=InnoDB {$charset};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);
    }
}

<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class Migration600 {

    public function up(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        $templates_table = $wpdb->prefix . 'pf_design_templates';
        $views_table     = $wpdb->prefix . 'pf_design_template_views';

        $sql = "CREATE TABLE IF NOT EXISTS `{$templates_table}` (
            `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `name`          VARCHAR(255)    NOT NULL,
            `category`      VARCHAR(100)    NOT NULL DEFAULT '',
            `thumbnail_url` VARCHAR(500)    NOT NULL DEFAULT '',
            `template_id`   BIGINT UNSIGNED DEFAULT NULL,
            `status`        VARCHAR(20)     NOT NULL DEFAULT 'active',
            `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_status` (`status`),
            KEY `idx_template_id` (`template_id`)
        ) ENGINE=InnoDB {$charset};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);

        $sql2 = "CREATE TABLE IF NOT EXISTS `{$views_table}` (
            `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `design_template_id` BIGINT UNSIGNED NOT NULL,
            `view_index`         INT UNSIGNED    NOT NULL DEFAULT 0,
            `canvas_json`        LONGTEXT        NOT NULL,
            PRIMARY KEY (`id`),
            KEY `idx_design_template_id` (`design_template_id`)
        ) ENGINE=InnoDB {$charset};";

        dbDelta($sql2);

        // Add foreign key via raw query (dbDelta doesn't handle FK reliably)
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- static DDL, table names are internal, no user input
        $wpdb->query(
            "ALTER TABLE `{$views_table}`
             ADD CONSTRAINT `fk_dtv_dt` FOREIGN KEY (`design_template_id`)
             REFERENCES `{$templates_table}` (`id`) ON DELETE CASCADE"
        );
    }
}

<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

/**
 * Font groups: named sets of font families the merchant assembles once and
 * selects per template. Members are family-name STRINGS (not FKs to
 * wp_pf_fonts) so web-safe, Google and custom-uploaded fonts can all belong
 * to a group — only custom fonts have rows in wp_pf_fonts.
 */
class Migration1300 {

    public function up(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        $groups_table  = $wpdb->prefix . 'pf_font_groups';
        $members_table = $wpdb->prefix . 'pf_font_group_members';

        $sql = "CREATE TABLE IF NOT EXISTS `{$groups_table}` (
            `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `name`       VARCHAR(255)    NOT NULL,
            `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`)
        ) ENGINE=InnoDB {$charset};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);

        // family is VARCHAR(191) so the unique index fits within utf8mb4
        // index-length limits on older MariaDB configurations.
        $sql2 = "CREATE TABLE IF NOT EXISTS `{$members_table}` (
            `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `group_id`   BIGINT UNSIGNED NOT NULL,
            `family`     VARCHAR(191)    NOT NULL,
            `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            UNIQUE KEY `idx_group_family` (`group_id`, `family`)
        ) ENGINE=InnoDB {$charset};";

        dbDelta($sql2);

        // Add foreign key via raw query (dbDelta doesn't handle FK reliably)
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- static DDL, table names are internal, no user input
        $wpdb->query(
            "ALTER TABLE `{$members_table}`
             ADD CONSTRAINT `fk_font_group_member` FOREIGN KEY (`group_id`)
             REFERENCES `{$groups_table}` (`id`) ON DELETE CASCADE"
        );
    }
}

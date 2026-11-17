<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

/**
 * Migration 1100: proof/approval state on designs.
 *
 * A design's `status` column describes its production lifecycle
 * (draft/final/ordered/archived). A proof is a PARALLEL state, not a phase of
 * that one — an approved proof is still a draft until the order lands — so it
 * gets its own column rather than new enum values.
 *
 * proof_token is generated separately from design_hash on purpose: the hash
 * leaks into cart URLs and order item meta, so it must never grant access.
 */
class Migration1100 {

    public function up(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pf_designs';

        $columns = [
            'proof_status'  => "ALTER TABLE `{$table}` ADD COLUMN `proof_status` ENUM('none','sent','changes_requested','approved') NOT NULL DEFAULT 'none' AFTER `status`",
            'proof_token'   => "ALTER TABLE `{$table}` ADD COLUMN `proof_token` CHAR(32) NOT NULL DEFAULT '' AFTER `proof_status`",
            'proof_sent_at' => "ALTER TABLE `{$table}` ADD COLUMN `proof_sent_at` DATETIME NULL DEFAULT NULL AFTER `proof_token`",
            'proof_note'    => "ALTER TABLE `{$table}` ADD COLUMN `proof_note` TEXT NULL DEFAULT NULL AFTER `proof_sent_at`",
            // A proof may go to someone with NO account — that is a premise of
            // the flow — so the address cannot be looked up from customer_id.
            'proof_email'   => "ALTER TABLE `{$table}` ADD COLUMN `proof_email` VARCHAR(191) NOT NULL DEFAULT '' AFTER `proof_note`",
        ];

        foreach ($columns as $name => $sql) {
            $exists = $wpdb->get_var($wpdb->prepare(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s",
                DB_NAME, $table, $name
            ));
            if (!$exists) {
                // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal, statements are literals above
                $wpdb->query($sql);
            }
        }

        $index = $wpdb->get_var($wpdb->prepare(
            "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND INDEX_NAME = 'proof_token'",
            DB_NAME, $table
        ));
        if (!$index) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal
            $wpdb->query("ALTER TABLE `{$table}` ADD KEY `proof_token` (`proof_token`)");
        }
    }
}

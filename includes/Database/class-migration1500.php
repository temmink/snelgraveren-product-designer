<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

/**
 * Let export records carry the LightBurn format (1.13.0).
 *
 * `pf_exports.format` was ENUM('pdf','png','svg') and ExportRepository turned
 * every other format into "pdf", so since 1.11.0 each LightBurn export was
 * recorded as a PDF: the order screen's "PDF" download handed out .lbrn2
 * files, and a new PDF export retired the LightBurn one (and vice versa).
 *
 * IDEMPOTENT — also run on every activation (DbManager::repair_schema()):
 * the column is only altered when "lbrn" is missing, and the relabel only
 * touches rows whose files are .lbrn2. Plain ALTER/UPDATE, valid on MySQL and
 * MariaDB alike. A failure is stored in Migration1400::ERRORS_OPTION.
 */
class Migration1500 {

    public function up(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pf_exports';

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- schema check during migration
        $type = (string) $wpdb->get_var($wpdb->prepare(
            'SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s',
            DB_NAME,
            $table,
            'format'
        ));
        if ($type === '') {
            return; // table missing — Migration1400 reports that
        }

        if (stripos($type, "'lbrn'") === false) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.SchemaChange,WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- static DDL, internal table name
            $ok = $wpdb->query("ALTER TABLE `{$table}` MODIFY `format` ENUM('pdf','png','svg','lbrn') NOT NULL DEFAULT 'pdf'");
            if ($ok === false) {
                $errors = (array) get_option(Migration1400::ERRORS_OPTION, []);
                $errors['pf_exports.format'] = (string) $wpdb->last_error;
                update_option(Migration1400::ERRORS_OPTION, $errors, false);
                return;
            }
        }
        // Repaired (now or earlier): drop a failure recorded by a previous run.
        $errors = (array) get_option(Migration1400::ERRORS_OPTION, []);
        if (isset($errors['pf_exports.format'])) {
            unset($errors['pf_exports.format']);
            $errors ? update_option(Migration1400::ERRORS_OPTION, $errors, false) : delete_option(Migration1400::ERRORS_OPTION);
        }

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off data repair during migration
        $wpdb->query($wpdb->prepare(
            "UPDATE `{$table}` SET `format` = 'lbrn' WHERE `format` <> 'lbrn' AND `file_path` LIKE %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- internal table name
            '%' . $wpdb->esc_like('.lbrn2') . '%'
        ));
    }
}

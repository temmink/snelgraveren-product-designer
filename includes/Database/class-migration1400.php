<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

/**
 * Schema repair for MySQL hosts (1.12.6).
 *
 * Until 1.12.6 Migration100 gave its TEXT/LONGTEXT columns a literal default
 * (`LONGTEXT NOT NULL DEFAULT '{}'`). MariaDB accepts that; MySQL does not
 * (5.7 never, 8.0 only as a parenthesised expression), so on MySQL dbDelta()
 * silently skipped pf_templates, pf_template_views and pf_design_views. The
 * later migrations still ran and recorded sgpd_db_version, so the version
 * gate made "deactivate and re-activate" a no-op — the site stayed broken.
 *
 * This migration is IDEMPOTENT and also runs on every activation
 * (DbManager::repair_schema()): it creates any missing core table with the
 * fixed DDL, re-runs the column migrations (each checks before it alters), and
 * adds the foreign keys that could not be created while their tables were
 * missing. Anything that still fails is stored in `sgpd_schema_errors` with
 * MySQL's own message, so System status shows the real reason instead of a
 * bare "missing tables".
 */
class Migration1400 {

    public const ERRORS_OPTION = 'sgpd_schema_errors';

    public function up(): void {
        global $wpdb;
        $p       = $wpdb->prefix;
        $charset = $wpdb->get_charset_collate();

        // Base DDL — identical to Migration100 (minus the TEXT defaults). The
        // columns added later are filled in by the column migrations below so
        // there is one definition of each column, not two.
        $ddl = [
            'pf_templates' => "CREATE TABLE IF NOT EXISTS `{$p}pf_templates` (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                title         VARCHAR(255)    NOT NULL DEFAULT '',
                slug          VARCHAR(255)    NOT NULL DEFAULT '',
                status        ENUM('draft','published','archived','trashed') NOT NULL DEFAULT 'draft',
                global_config LONGTEXT        NOT NULL,
                created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY slug (slug),
                KEY status (status)
            ) ENGINE=InnoDB {$charset}",
            'pf_template_views' => "CREATE TABLE IF NOT EXISTS `{$p}pf_template_views` (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                template_id   BIGINT UNSIGNED NOT NULL,
                name          VARCHAR(255)    NOT NULL DEFAULT '',
                sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                canvas_width  SMALLINT UNSIGNED NOT NULL DEFAULT 800,
                canvas_height SMALLINT UNSIGNED NOT NULL DEFAULT 600,
                background_color VARCHAR(20) NOT NULL DEFAULT '#ffffff',
                background_url VARCHAR(2048) NOT NULL DEFAULT '',
                zones_config  LONGTEXT        NOT NULL,
                layers_config LONGTEXT        NOT NULL,
                permissions   LONGTEXT        NOT NULL,
                PRIMARY KEY (id),
                KEY template_id (template_id)
            ) ENGINE=InnoDB {$charset}",
            'pf_design_views' => "CREATE TABLE IF NOT EXISTS `{$p}pf_design_views` (
                id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                design_id   BIGINT UNSIGNED NOT NULL,
                view_id     BIGINT UNSIGNED NOT NULL,
                canvas_json LONGTEXT        NOT NULL,
                thumbnail   VARCHAR(2048)   NOT NULL DEFAULT '',
                PRIMARY KEY (id),
                KEY design_id (design_id)
            ) ENGINE=InnoDB {$charset}",
        ];

        $errors = [];
        foreach ($ddl as $name => $sql) {
            if (self::table_exists($p . $name)) {
                continue;
            }
            // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- static DDL, no user input
            $wpdb->query($sql);
            if (!self::table_exists($p . $name)) {
                $errors[] = $p . $name . ': ' . ($wpdb->last_error !== '' ? $wpdb->last_error : 'CREATE TABLE failed');
            }
        }

        // Columns added after Migration100. Each one checks before altering,
        // so on a healthy install this is a handful of SELECTs and nothing else.
        foreach ([Migration300::class, Migration700::class, Migration800::class, Migration900::class, Migration1000::class, Migration1200::class] as $class) {
            (new $class())->up();
        }

        // Foreign keys that Migration100 could not add while the referenced
        // table was missing. A failure here (e.g. an orphan row) is not fatal
        // — the plugin never relied on them for correctness — so it is not
        // reported as a schema error.
        $fks = [
            ['pf_template_views', 'fk_tv_template', 'template_id', 'pf_templates', ' ON DELETE CASCADE'],
            ['pf_designs',        'fk_d_template',  'template_id', 'pf_templates', ''],
            ['pf_design_views',   'fk_dv_design',   'design_id',   'pf_designs',   ' ON DELETE CASCADE'],
        ];
        foreach ($fks as [$table, $name, $column, $ref, $on_delete]) {
            if (!self::table_exists($p . $table) || !self::table_exists($p . $ref) || self::fk_exists($p . $table, $name)) {
                continue;
            }
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- static DDL, table names internal
            $wpdb->query("ALTER TABLE `{$p}{$table}` ADD CONSTRAINT `{$name}` FOREIGN KEY (`{$column}`) REFERENCES `{$p}{$ref}`(`id`){$on_delete}");
        }

        if ($errors) {
            update_option(self::ERRORS_OPTION, $errors, false);
        } else {
            delete_option(self::ERRORS_OPTION);
        }
    }

    private static function table_exists(string $table): bool {
        global $wpdb;
        return $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) === $table;
    }

    private static function fk_exists(string $table, string $name): bool {
        global $wpdb;
        return (bool) $wpdb->get_var($wpdb->prepare(
            "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND CONSTRAINT_NAME = %s AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
            DB_NAME, $table, $name
        ));
    }
}

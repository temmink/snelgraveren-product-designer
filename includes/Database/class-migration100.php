<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

class Migration100 {

    public function up(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        // dbDelta() does not support CONSTRAINT/FOREIGN KEY syntax.
        // Create tables without FKs first, then add constraints separately.
        $sql = "
            CREATE TABLE {$wpdb->prefix}pf_templates (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                title         VARCHAR(255)    NOT NULL DEFAULT '',
                slug          VARCHAR(255)    NOT NULL DEFAULT '',
                status        ENUM('draft','published','archived','trashed') NOT NULL DEFAULT 'draft',
                global_config LONGTEXT        NOT NULL DEFAULT '{}',
                created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY slug (slug),
                KEY status (status)
            ) ENGINE=InnoDB {$charset};

            CREATE TABLE {$wpdb->prefix}pf_template_views (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                template_id   BIGINT UNSIGNED NOT NULL,
                name          VARCHAR(255)    NOT NULL DEFAULT '',
                sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                canvas_width  SMALLINT UNSIGNED NOT NULL DEFAULT 800,
                canvas_height SMALLINT UNSIGNED NOT NULL DEFAULT 600,
                background_color VARCHAR(20) NOT NULL DEFAULT '#ffffff',
                background_url VARCHAR(2048) NOT NULL DEFAULT '',
                zones_config  LONGTEXT        NOT NULL DEFAULT '[]',
                layers_config LONGTEXT        NOT NULL DEFAULT '[]',
                permissions   LONGTEXT        NOT NULL DEFAULT '{}',
                PRIMARY KEY (id),
                KEY template_id (template_id)
            ) ENGINE=InnoDB {$charset};

            CREATE TABLE {$wpdb->prefix}pf_designs (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                design_hash   CHAR(32)        NOT NULL,
                template_id   BIGINT UNSIGNED NOT NULL,
                product_id    BIGINT UNSIGNED NOT NULL DEFAULT 0,
                customer_id   BIGINT UNSIGNED NOT NULL DEFAULT 0,
                session_id    VARCHAR(64)     NOT NULL DEFAULT '',
                status        ENUM('draft','final','ordered','archived') NOT NULL DEFAULT 'draft',
                total_price   DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
                created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY design_hash (design_hash),
                KEY template_id (template_id),
                KEY customer_id (customer_id),
                KEY session_id (session_id)
            ) ENGINE=InnoDB {$charset};

            CREATE TABLE {$wpdb->prefix}pf_design_views (
                id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                design_id   BIGINT UNSIGNED NOT NULL,
                view_id     BIGINT UNSIGNED NOT NULL,
                canvas_json LONGTEXT        NOT NULL DEFAULT '{}',
                thumbnail   VARCHAR(2048)   NOT NULL DEFAULT '',
                PRIMARY KEY (id),
                KEY design_id (design_id)
            ) ENGINE=InnoDB {$charset};

            CREATE TABLE {$wpdb->prefix}pf_exports (
                id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                design_id   BIGINT UNSIGNED NOT NULL,
                order_id    BIGINT UNSIGNED NOT NULL DEFAULT 0,
                format      ENUM('pdf','png','svg') NOT NULL DEFAULT 'pdf',
                file_path   VARCHAR(2048)   NOT NULL DEFAULT '',
                status      ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
                created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY design_id (design_id),
                KEY order_id (order_id)
            ) ENGINE=InnoDB {$charset};

            CREATE TABLE {$wpdb->prefix}pf_price_log (
                id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                design_id   BIGINT UNSIGNED NOT NULL,
                element_type ENUM('text','image','svg') NOT NULL,
                element_id  VARCHAR(64)     NOT NULL DEFAULT '',
                price       DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
                logged_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY design_id (design_id)
            ) ENGINE=InnoDB {$charset};
        ";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);

        // Add foreign key constraints via direct queries.
        // Silently skip if they already exist (re-activation safe).
        $fks = [
            "ALTER TABLE {$wpdb->prefix}pf_template_views ADD CONSTRAINT fk_tv_template FOREIGN KEY (template_id) REFERENCES {$wpdb->prefix}pf_templates(id) ON DELETE CASCADE",
            "ALTER TABLE {$wpdb->prefix}pf_designs ADD CONSTRAINT fk_d_template FOREIGN KEY (template_id) REFERENCES {$wpdb->prefix}pf_templates(id)",
            "ALTER TABLE {$wpdb->prefix}pf_design_views ADD CONSTRAINT fk_dv_design FOREIGN KEY (design_id) REFERENCES {$wpdb->prefix}pf_designs(id) ON DELETE CASCADE",
            "ALTER TABLE {$wpdb->prefix}pf_exports ADD CONSTRAINT fk_e_design FOREIGN KEY (design_id) REFERENCES {$wpdb->prefix}pf_designs(id)",
            "ALTER TABLE {$wpdb->prefix}pf_price_log ADD CONSTRAINT fk_pl_design FOREIGN KEY (design_id) REFERENCES {$wpdb->prefix}pf_designs(id) ON DELETE CASCADE",
        ];

        foreach ($fks as $fk) {
            // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- static DDL, no user input
            $wpdb->query($fk);
        }
    }
}

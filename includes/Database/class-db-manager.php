<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

class DbManager {

    public static function run_migrations(): void {
        $current = (int) get_option('sgpd_db_version', 0);

        $migrations = [
            100 => Migration100::class,
            200 => Migration200::class,
            300 => Migration300::class,
            400 => Migration400::class,
            500 => Migration500::class,
            600 => Migration600::class,
            700 => Migration700::class,
            800 => Migration800::class,
            900 => Migration900::class,
            1000 => Migration1000::class,
        ];

        foreach ($migrations as $version => $class) {
            if ($current < $version) {
                (new $class())->up();
                update_option('sgpd_db_version', $version);
                $current = $version;
            }
        }
    }
}

<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class DbManager {

    public static function run_migrations(): void {
        $current = (int) get_option('pf_db_version', 0);

        $migrations = [
            100 => Migration100::class,
            200 => Migration200::class,
            300 => Migration300::class,
            400 => Migration400::class,
        ];

        foreach ($migrations as $version => $class) {
            if ($current < $version) {
                (new $class())->up();
                update_option('pf_db_version', $version);
                $current = $version;
            }
        }
    }
}

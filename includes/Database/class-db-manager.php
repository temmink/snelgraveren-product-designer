<?php
namespace ProductDesigner\Database;

defined('ABSPATH') || exit;

class DbManager {

    public static function run_migrations(): void {
        $current = (int) get_option('pd_db_version', 0);

        $migrations = [
            100 => Migration100::class,
        ];

        foreach ($migrations as $version => $class) {
            if ($current < $version) {
                (new $class())->up();
                update_option('pd_db_version', $version);
                $current = $version;
            }
        }
    }
}

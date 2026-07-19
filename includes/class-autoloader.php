<?php
namespace ProductForge;

defined('ABSPATH') || exit;

class Autoloader {

    public static function register(): void {
        spl_autoload_register([self::class, 'load']);
    }

    public static function load(string $class): void {
        $prefix = 'ProductForge\\';
        if (!str_starts_with($class, $prefix)) {
            return;
        }

        $relative = substr($class, strlen($prefix));
        // Convert namespace separators to directory separators and build file name.
        $parts     = explode('\\', $relative);
        $classname = array_pop($parts);
        // Convert CamelCase class name to lowercase-hyphenated file name.
        $filename  = 'class-' . strtolower(preg_replace('/([A-Z])/', '-$1', lcfirst($classname))) . '.php';
        $path      = SGPD_PLUGIN_DIR . 'includes/' . (empty($parts) ? '' : implode('/', $parts) . '/') . $filename;

        if (file_exists($path)) {
            require_once $path;
        }
    }
}

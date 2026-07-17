<?php
namespace ProductForge\Export;

defined('ABSPATH') || exit;

/**
 * Inspects saved Fabric.js canvas JSON. Clipart is added as a Fabric Image
 * pointing at an .svg URL, so "Image with non-.svg src" is the raster test.
 */
class DesignInspector {

	public static function contains_raster(array $views): bool {
		foreach ($views as $view) {
			$objects = $view['canvas_json']['objects'] ?? [];
			foreach ($objects as $obj) {
				if (!in_array($obj['type'] ?? '', ['Image', 'image'], true)) {
					continue;
				}
				$src = strtolower((string) ($obj['src'] ?? ''));
				$path = (string) wp_parse_url($src, PHP_URL_PATH);
				if ($path !== '' && !str_ends_with($path, '.svg')) {
					return true;
				}
			}
		}
		return false;
	}
}

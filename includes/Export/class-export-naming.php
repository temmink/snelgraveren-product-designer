<?php
namespace Snelgraveren\ProductDesigner\Export;

defined('ABSPATH') || exit;

/**
 * File and download names of the production exports, and the physical width
 * a view is exported at.
 *
 * Since 1.13.1 a file is named after what the operator works from:
 * "<order>_<side>_<product>.lbrn2" (e.g. 2571_voorkant_dog-tags.lbrn2), the
 * multi-view download "<order>_<product>-<format>.zip". Without an order (the
 * Designs page) the first 8 characters of the design hash take the order's
 * place. Files live in a per-design folder, so two designs in one order never
 * overwrite each other on disk. Before 1.13.0 four export buttons downloaded a
 * ZIP with one and the same name; paths from that era ("<hash>-<id>-view-N")
 * are still recognised. Pure PHP, unit-tested in tests/php-unit.
 */
class ExportNaming {

    /** Legacy marker of the font-embedded SVG variant ("<hash>-<id>-fonts"). */
    private const FONTS = '-fonts';

    /** New-style marker: a fourth "_fonts" part. */
    private const FONTS_PART = 'fonts';

    /** Lower-case ASCII, words joined by "-", at most 40 characters. */
    public static function slug(string $text): string {
        $t = $text;
        if (function_exists('iconv')) {
            $ascii = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $t);
            if ($ascii !== false) {
                $t = $ascii;
            }
        }
        $t = strtolower($t);
        $t = (string) preg_replace('/[^a-z0-9]+/', '-', $t);
        $t = trim($t, '-');
        if (strlen($t) > 40) {
            // Cut between words when there is one to cut at.
            $cut = substr($t, 0, 41);
            $at  = strrpos($cut, '-');
            $t   = $at !== false && $at >= 10 ? substr($cut, 0, $at) : substr($t, 0, 40);
            $t   = rtrim($t, '-');
        }
        return $t;
    }

    /** The order number, or the start of the design hash without an order. */
    public static function order_ref(int $order_id, string $design_hash): string {
        return $order_id > 0 ? (string) $order_id : substr(self::slug($design_hash), 0, 8);
    }

    /**
     * One file stem per view: "<ref>_<side>_<product>[_fonts]". Sides are
     * made unique ("voorkant", "voorkant-2"); a nameless side is "view-N".
     *
     * @param string[] $side_labels the display name of each view, in order
     * @return string[]
     */
    public static function view_stems(string $ref, array $side_labels, string $product, string $format, string $variant): array {
        $product = self::slug($product) ?: 'ontwerp';
        $fonts   = ($format === 'svg' && $variant === 'embed') ? '_' . self::FONTS_PART : '';
        $seen    = [];
        $stems   = [];
        foreach (array_values($side_labels) as $i => $label) {
            $side = self::slug((string) $label) ?: 'view-' . ($i + 1);
            $base = $side;
            $n    = 2;
            while (isset($seen[$side])) {
                $side = $base . '-' . $n++;
            }
            $seen[$side] = true;
            $stems[] = $ref . '_' . $side . '_' . $product . $fonts;
        }
        return $stems;
    }

    /** Stem of the one-file PDF (all views in one document): "<ref>_<product>". */
    public static function pdf_stem(string $ref, string $product): string {
        return $ref . '_' . (self::slug($product) ?: 'ontwerp');
    }

    /** Name of the ZIP for a multi-view download, derived from its first file. */
    public static function zip_name(string $first_path): string {
        $ext  = strtolower(pathinfo($first_path, PATHINFO_EXTENSION));
        $fmt  = $ext === 'lbrn2' ? 'lbrn' : $ext;
        $stem = pathinfo($first_path, PATHINFO_FILENAME);

        $parts = explode('_', $stem);
        if (count($parts) >= 3) {
            // New style: <ref>_<side>_<product>[_fonts].
            if (($parts[3] ?? '') === self::FONTS_PART) {
                $fmt .= self::FONTS;
            }
            $name = $parts[0] . '_' . $parts[2] . '-' . $fmt . '.zip';
        } else {
            // Legacy: <hash>-<id>[-fonts]-view-N.
            $stem = (string) preg_replace('/-view-\d+$/', '', $stem);
            if (str_ends_with($stem, self::FONTS)) {
                $stem = substr($stem, 0, -strlen(self::FONTS));
                $fmt .= self::FONTS;
            }
            $name = $stem . '-' . $fmt . '.zip';
        }
        return (string) preg_replace('/[^a-zA-Z0-9._-]/', '_', $name);
    }

    /** Which SVG variant a stored (comma-separated) path list holds. */
    public static function variant_of(string $file_path_list): string {
        $first = trim(explode(',', $file_path_list)[0]);
        if ($first === '') {
            return 'outline';
        }
        $stem  = pathinfo($first, PATHINFO_FILENAME);
        $parts = explode('_', $stem);
        if (count($parts) >= 3) {
            return ($parts[3] ?? '') === self::FONTS_PART ? 'embed' : 'outline';
        }
        $stem = (string) preg_replace('/-view-\d+$/', '', $stem);
        return str_ends_with($stem, self::FONTS) ? 'embed' : 'outline';
    }

    /**
     * The physical width (mm) a template view is exported at: its own
     * width_mm, else the first view that has one (front and back of one
     * object share it). The SAME rule as shared/js/rulerTicks.js#resolveWidthMm,
     * which the designer and the browser-side LightBurn writer use — the server
     * reading only the view's own value put the back of a dog tag at 209 mm
     * next to text laid out at 38 mm. 0 when no view has a width.
     */
    public static function resolve_width_mm(array $template_views, int $view_id): float {
        foreach ($template_views as $tv) {
            if ((int) ($tv['id'] ?? 0) === $view_id && (float) ($tv['width_mm'] ?? 0) > 0) {
                return (float) $tv['width_mm'];
            }
        }
        foreach ($template_views as $tv) {
            if ((float) ($tv['width_mm'] ?? 0) > 0) {
                return (float) $tv['width_mm'];
            }
        }
        return 0.0;
    }
}

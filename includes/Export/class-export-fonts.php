<?php
namespace Snelgraveren\ProductDesigner\Export;

defined('ABSPATH') || exit;

/**
 * Font names in the production files.
 *
 * LightBurn (and any SVG consumer) looks a font up BY NAME on the machine.
 * Templates can store a Google font in its camelCase-collapsed form —
 * "BebasNeue" for "Bebas Neue" — which the designer repairs only to LOAD the
 * font (shared/js/googleFontLoader.js#normalizeGoogleName). The exports carried
 * the stored name verbatim, so LightBurn reported "Could not find font
 * 'BebasNeue'". The name is repaired here, at export time, so designs that are
 * already ordered come out right too. A font the merchant uploaded keeps the
 * name it was uploaded under. Pure PHP, unit-tested in tests/php-unit.
 */
class ExportFonts {

    /** The name to write for $family; $custom lists the uploaded families. */
    public static function family(string $family, array $custom): string {
        $f = trim($family);
        foreach ($custom as $c) {
            if (strcasecmp(trim((string) $c), $f) === 0) {
                return $family;
            }
        }
        // Same rule as normalizeGoogleName() in the browser.
        $fixed = (string) preg_replace('/([a-z0-9])([A-Z])/', '$1 $2', $f);
        return $fixed === $f ? $family : $fixed;
    }

    /** Repair the family in every Font="Family,…" of a LightBurn project. */
    public static function fix_lbrn(string $xml, array $custom): string {
        return (string) preg_replace_callback(
            '/\bFont="([^",]+),/',
            static fn($m) => 'Font="' . self::family($m[1], $custom) . ',',
            $xml
        );
    }

    /**
     * Repair font-family values (attributes and CSS, incl. @font-face) of an
     * SVG. Only the value after "font-family" is touched, never text content.
     */
    public static function fix_svg(string $svg, array $custom): string {
        $list = static function (string $value) use ($custom): string {
            // A list: "'PT Serif', serif" / "&quot;GreatVibes&quot;, cursive".
            $parts = explode(',', $value);
            foreach ($parts as $i => $part) {
                $parts[$i] = (string) preg_replace_callback(
                    '/^(\s*(?:&quot;|["\'])?)([^"\'&]+?)((?:&quot;|["\'])?\s*)$/',
                    static fn($p) => $p[1] . self::family($p[2], $custom) . $p[3],
                    $part
                );
            }
            return implode(',', $parts);
        };
        // Attribute: font-family="…" / font-family='…'.
        $svg = (string) preg_replace_callback(
            '/(font-family\s*=\s*)(["\'])(.*?)\2/i',
            static fn($m) => $m[1] . $m[2] . $list($m[3]) . $m[2],
            $svg
        );
        // CSS (a <style> block, @font-face or a style attribute): font-family: …
        return (string) preg_replace_callback(
            '/(font-family\s*:\s*)((?:&quot;|[^;}"<>])*)/i',
            static fn($m) => $m[1] . $list($m[2]),
            $svg
        );
    }
}

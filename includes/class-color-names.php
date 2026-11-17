<?php
namespace Snelgraveren\ProductDesigner;

defined('ABSPATH') || exit;

/**
 * Colour names and the tint each one stands for, shop-wide.
 *
 * A product's colour is usually a WooCommerce option ("Kleur: Rood"), and that
 * option is what gets ordered. The designer has to show the product in that
 * colour — until 1.13 it had its own, unrelated colour picker, so a customer
 * could look at a red tag and order a black one. This list is the bridge: the
 * option's NAME is looked up here and the tint is painted on the preview.
 *
 * One list for every template and every product; matching is by name, case
 * and surrounding whitespace ignored. A name that is not in the list simply
 * leaves the preview as it is.
 */
class ColorNames {

    public const OPTION = 'sgpd_color_names';

    /**
     * Common colour names (Dutch and English) so a shop works out of the box.
     * Merchants overwrite the tints that should match their own material.
     */
    private const DEFAULTS = [
        ['Zwart', '#1a1a1a'], ['Wit', '#f5f5f5'], ['Rood', '#d62828'], ['Blauw', '#1e6fd9'],
        ['Donkerblauw', '#1b2a6b'], ['Lichtblauw', '#7ec8e3'], ['Groen', '#2e9e4f'],
        ['Geel', '#f2c618'], ['Oranje', '#f08a24'], ['Paars', '#8e44ad'], ['Roze', '#ef7fb1'],
        ['Grijs', '#8a8d91'], ['Zilver', '#c4c7cc'], ['Goud', '#c9a227'], ['Bruin', '#7a4b2a'],
        ['Black', '#1a1a1a'], ['White', '#f5f5f5'], ['Red', '#d62828'], ['Blue', '#1e6fd9'],
        ['Navy', '#1b2a6b'], ['Green', '#2e9e4f'], ['Yellow', '#f2c618'], ['Orange', '#f08a24'],
        ['Purple', '#8e44ad'], ['Pink', '#ef7fb1'], ['Grey', '#8a8d91'], ['Gray', '#8a8d91'],
        ['Silver', '#c4c7cc'], ['Gold', '#c9a227'], ['Brown', '#7a4b2a'],
    ];

    /** Lookup key for a colour name: lower case, single spaces, trimmed. */
    public static function key(string $name): string {
        $name = trim((string) preg_replace('/\s+/u', ' ', $name));
        return function_exists('mb_strtolower') ? mb_strtolower($name) : strtolower($name);
    }

    /**
     * The list as the merchant sees it: [['name' => 'Rood', 'hex' => '#d62828'], …].
     */
    public static function all(): array {
        $stored = get_option(self::OPTION, null);
        if (!is_array($stored)) {
            return array_map(
                static function ($pair) {
                    return ['name' => $pair[0], 'hex' => $pair[1]];
                },
                self::DEFAULTS
            );
        }
        return array_values(array_filter($stored, static function ($row) {
            return is_array($row) && !empty($row['name']) && !empty($row['hex']);
        }));
    }

    /** name-key => hex, the shape the designer looks colours up in. */
    public static function map(): array {
        $map = [];
        foreach (self::all() as $row) {
            $map[self::key((string) $row['name'])] = (string) $row['hex'];
        }
        return $map;
    }

    /**
     * Settings-API sanitiser. The form posts two parallel arrays
     * (names[], hex[]); rows without a name or a valid colour are dropped and
     * a repeated name keeps its last tint.
     */
    public static function sanitize($value): array {
        if (!is_array($value) || !isset($value['names'], $value['hex'])
            || !is_array($value['names']) || !is_array($value['hex'])) {
            // Already in stored shape (programmatic update_option) or garbage.
            return is_array($value) && isset($value[0]['name']) ? self::clean_rows($value) : self::all();
        }
        $rows = [];
        foreach ($value['names'] as $i => $name) {
            $rows[] = ['name' => $name, 'hex' => $value['hex'][$i] ?? ''];
        }
        return self::clean_rows($rows);
    }

    private static function clean_rows(array $rows): array {
        $clean = [];
        foreach ($rows as $row) {
            $name = sanitize_text_field((string) ($row['name'] ?? ''));
            $hex  = sanitize_hex_color((string) ($row['hex'] ?? ''));
            if ($name === '' || !$hex) {
                continue;
            }
            $clean[self::key($name)] = ['name' => $name, 'hex' => $hex];
        }
        return array_values($clean);
    }

    /**
     * Colour options in use on designer products that have no tint yet.
     *
     * Looks at variable products with the designer enabled and at options
     * whose attribute is named like a colour. Capped, because this runs on
     * the settings screen and is a hint, not a report.
     *
     * @return string[] option names, as the merchant wrote them
     */
    public static function unmapped_in_use(): array {
        if (!function_exists('wc_get_products')) {
            return [];
        }
        $known    = self::map();
        $missing  = [];
        $products = wc_get_products([
            'type'       => 'variable',
            'status'     => 'publish',
            'limit'      => 100,
            'meta_key'   => '_pf_designer_enabled', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- capped at 100 products, settings screen only.
            'meta_value' => 'yes', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
        ]);
        foreach ($products as $product) {
            foreach ($product->get_variation_attributes() as $attribute => $options) {
                if (!preg_match('/kleur|colou?r|farbe|couleur/i', (string) $attribute)) {
                    continue;
                }
                foreach ((array) $options as $option) {
                    $label = (string) $option;
                    if (taxonomy_exists($attribute)) {
                        $term  = get_term_by('slug', $label, $attribute);
                        $label = $term ? $term->name : $label;
                    }
                    if ($label !== '' && !isset($known[self::key($label)])) {
                        $missing[self::key($label)] = $label;
                    }
                }
            }
        }
        return array_values($missing);
    }
}

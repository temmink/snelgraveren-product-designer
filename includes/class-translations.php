<?php
namespace Snelgraveren\ProductDesigner;

defined('ABSPATH') || exit;

/**
 * One place that decides where this plugin's translations come from, for PHP
 * and for the React bundles alike.
 *
 * Two sources, and a build only ever has one of them:
 *  - wordpress.org installs get a language pack from translate.wordpress.org
 *    in wp-content/languages/plugins/. WordPress loads that by itself; our own
 *    languages/ folder is stripped from that build (bin/free-build.sh).
 *  - Every other build (the ZIP from bin/package.sh that runs on the shop and
 *    goes to Freemius) has no language pack to fall back on — WordPress only
 *    fetches packs for a plugin it installed from wordpress.org — so it ships
 *    languages/<domain>-<locale>.mo and loads it here.
 *
 * The bundles do NOT use per-script JSON files. They used to: the loader
 * looked for languages/<domain>-<locale>-<hash>.json, the files on disk still
 * carried the pre-rename domain, nothing matched, and the customer designer
 * was English on a Dutch shop without a single error (found 2026-11). Script
 * locale data is now built from whatever the text domain has loaded, so a
 * string that is translated for PHP is translated for JS — one file, one
 * name, nothing to keep in sync with a bundle path.
 */
class Translations {

    public const DOMAIN = 'snelgraveren-product-designer';

    public function init(): void {
        if (did_action('init')) {
            $this->load_bundled();
        } else {
            add_action('init', [$this, 'load_bundled'], 0);
        }
    }

    /**
     * Load languages/<domain>-<locale>.mo when this build ships one.
     */
    public function load_bundled(): void {
        $locale = determine_locale();
        $mofile = self::bundled_mofile($locale);
        if ($mofile !== null) {
            load_textdomain(self::DOMAIN, $mofile, $locale);
        }
    }

    /**
     * The bundled .mo for a locale, or null. A regional or formal variant
     * (nl_NL_formal, nl_BE) falls back to the base translation of its
     * language rather than to English.
     */
    public static function bundled_mofile(string $locale): ?string {
        $dir        = SGPD_PLUGIN_DIR . 'languages/';
        $candidates = [$locale, substr($locale, 0, 5)];
        $language   = substr($locale, 0, 2);
        if ($language === 'nl') {
            $candidates[] = 'nl_NL';
        }
        foreach (array_unique($candidates) as $candidate) {
            if (!preg_match('/^[A-Za-z_]+$/', $candidate)) {
                continue;
            }
            $file = $dir . self::DOMAIN . '-' . $candidate . '.mo';
            if (is_readable($file)) {
                return $file;
            }
        }
        return null;
    }

    /**
     * Hand the loaded translations to a script as wp.i18n locale data.
     *
     * Inlined on purpose (instead of wp_set_script_translations): caching
     * plugins rewrite or combine script URLs, after which WordPress can no
     * longer match a script to its translation file.
     */
    public static function inline_for_script(string $handle): void {
        $locale_data = self::locale_data();
        if ($locale_data === null) {
            return;
        }
        $script = 'wp.i18n.setLocaleData('
            . wp_json_encode($locale_data, JSON_HEX_TAG | JSON_HEX_AMP)
            . ', '
            . wp_json_encode(self::DOMAIN, JSON_HEX_TAG | JSON_HEX_AMP)
            . ');';
        wp_add_inline_script($handle, $script, 'before');
    }

    /**
     * Jed-style locale data for the text domain, or null when nothing is
     * loaded (English, or a locale without a translation).
     */
    public static function locale_data(): ?array {
        $translations = get_translations_for_domain(self::DOMAIN);
        $entries      = $translations->entries ?? [];
        if (!is_array($entries) || $entries === []) {
            return null;
        }

        $plural_forms = '';
        if (method_exists($translations, 'get_header')) {
            $plural_forms = (string) $translations->get_header('Plural-Forms');
        }

        $data = [
            '' => [
                'domain'       => self::DOMAIN,
                'lang'         => determine_locale(),
                'plural-forms' => $plural_forms !== '' ? $plural_forms : 'nplurals=2; plural=(n != 1);',
            ],
        ];
        foreach ($entries as $entry) {
            if (empty($entry->singular) || empty($entry->translations)) {
                continue;
            }
            $key = empty($entry->context)
                ? $entry->singular
                : $entry->context . "\4" . $entry->singular;
            $data[$key] = array_values((array) $entry->translations);
        }

        return count($data) > 1 ? $data : null;
    }
}

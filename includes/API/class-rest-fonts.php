<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\FontRepository;

/**
 * Public font read endpoint. The frontend designer needs the font list for
 * guest customers, so it is intentionally public and stays in the free build.
 * All management (upload/delete) endpoints live in RestFontsAdmin, which is
 * premium-only and stripped from the free build.
 */
class RestFonts {

    public function register_routes(): void {
        // Public: list all custom fonts (needed by frontend designer)
        register_rest_route('pf/v1', '/fonts', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_fonts'],
            'permission_callback' => '__return_true',
        ]);

        // Public: proxy a Google font as base64 TTF, so the designer can outline
        // (opentype.js) / embed text in SVG exports without decoding woff2 or
        // hitting CORS. Google fonts only; the URL is built server-side from a
        // sanitized family name (no arbitrary-URL fetching — SSRF-safe).
        register_rest_route('pf/v1', '/font-file', [
            'methods'             => 'GET',
            'callback'            => [$this, 'font_file'],
            'permission_callback' => '__return_true',
            'args'                => [
                'family' => ['type' => 'string', 'required' => true],
                'weight' => ['type' => 'integer', 'default' => 400],
            ],
        ]);
    }

    public function list_fonts(): \WP_REST_Response {
        return rest_ensure_response(FontRepository::all());
    }

    /**
     * Return a Google font as { format: 'ttf', data: <base64> }. Result is
     * cached for a week (uploads/pf-cache) so repeat exports don't re-fetch.
     */
    public function font_file(\WP_REST_Request $request): \WP_REST_Response {
        // Sanitize: family to letters/digits/spaces, weight to a known set.
        $family = trim(preg_replace('/[^A-Za-z0-9 ]/', '', (string) $request->get_param('family')));
        $weight = in_array((int) $request->get_param('weight'), [400, 700], true) ? (int) $request->get_param('weight') : 400;
        if ($family === '') {
            return new \WP_REST_Response(['error' => 'family required'], 400);
        }

        $cache_key = 'sgpd_fontfile_' . md5($family . '|' . $weight);
        $cached = get_transient($cache_key);
        if (is_string($cached) && $cached !== '') {
            return new \WP_REST_Response(['format' => 'ttf', 'data' => $cached], 200);
        }

        // Google Fonts wants the spaced family name ("Bebas Neue"), but designs
        // may store a camelCase variant ("BebasNeue"). Try the name as given,
        // then a de-camelCased fallback.
        $candidates = [$family];
        $spaced = trim(preg_replace('/([a-z0-9])([A-Z])/', '$1 $2', $family));
        if ($spaced !== $family) {
            $candidates[] = $spaced;
        }

        // A bare, very old UA makes Google Fonts serve a plain .ttf (a fuller
        // "MSIE 6.0" UA returns a special /l/font?kit= endpoint instead).
        $ttf = '';
        foreach ($candidates as $cand) {
            $css = wp_remote_get(
                'https://fonts.googleapis.com/css?family=' . rawurlencode($cand) . ':' . $weight,
                ['user-agent' => 'Mozilla/4.0', 'timeout' => 10]
            );
            if (is_wp_error($css)) {
                continue;
            }
            $body = (string) wp_remote_retrieve_body($css);
            if (preg_match('#src:\s*url\((https://fonts\.gstatic\.com/[^)]+\.ttf)\)#i', $body, $m)) {
                $ttf = $m[1];
                break;
            }
        }
        if ($ttf === '') {
            return new \WP_REST_Response(['error' => 'ttf not found'], 404);
        }
        $m = [1 => $ttf];

        $font = wp_remote_get($m[1], ['timeout' => 15]);
        if (is_wp_error($font)) {
            return new \WP_REST_Response(['error' => 'font fetch failed'], 502);
        }
        $bytes = wp_remote_retrieve_body($font);
        if ($bytes === '') {
            return new \WP_REST_Response(['error' => 'empty font'], 502);
        }

        $b64 = base64_encode($bytes);
        set_transient($cache_key, $b64, WEEK_IN_SECONDS);
        return new \WP_REST_Response(['format' => 'ttf', 'data' => $b64], 200);
    }
}

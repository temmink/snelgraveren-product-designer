<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\TemplateRepository;
use ProductForge\Pricing\PriceCalculator;

/**
 * Live price-preview endpoint for the frontend designer. Premium-only: the
 * whole pricing engine is stripped from the free build (@fs_premium_only in
 * productforge.php). The frontend treats a failed preview as "no surcharge"
 * (silent catch), so the free build degrades cleanly without this route.
 */
class RestPricing {

    public function register_routes(): void {
        register_rest_route('pf/v1', '/pricing/preview', [
            'methods'             => 'POST',
            'callback'            => [$this, 'preview'],
            'permission_callback' => [$this, 'verify_nonce'],
            'args'                => [
                'template_id' => ['type' => 'integer', 'required' => true],
                'counts'      => ['type' => 'object', 'required' => true],
            ],
        ]);
    }

    public function verify_nonce(\WP_REST_Request $request): bool {
        return (bool) wp_verify_nonce($request->get_header('x-wp-nonce') ?? '', 'wp_rest');
    }

    public function preview(\WP_REST_Request $request) {
        $template_id = (int) $request['template_id'];
        $template    = (new TemplateRepository())->get($template_id);
        if (!$template || ($template['status'] ?? '') !== 'published') {
            return new \WP_Error('pf_not_found', __('Template not found.', 'snelgraveren-product-designer'), ['status' => 404]);
        }

        $raw    = (array) $request['counts'];
        $counts = [
            'text'  => min(500, max(0, (int) ($raw['text'] ?? 0))),
            'image' => min(500, max(0, (int) ($raw['image'] ?? 0))),
            'svg'   => min(500, max(0, (int) ($raw['svg'] ?? 0))),
        ];
        $counts['total'] = $counts['text'] + $counts['image'] + $counts['svg'];

        $surcharge = (new PriceCalculator())->preview_from_counts($counts, $template['global_config'] ?? []);

        return rest_ensure_response([
            'surcharge'       => round($surcharge, 2),
            'currency_symbol' => function_exists('get_woocommerce_currency_symbol') ? get_woocommerce_currency_symbol() : '€',
        ]);
    }
}

<?php
namespace ProductForge\Pricing;

defined('ABSPATH') || exit;

use ProductForge\Database\DesignRepository;
use ProductForge\Database\TemplateRepository;
use ProductForge\Database\PriceRepository;

class PriceCalculator {

    private DesignRepository $designs;
    private TemplateRepository $templates;
    private PriceRepository $price_log;

    public function __construct() {
        $this->designs   = new DesignRepository();
        $this->templates = new TemplateRepository();
        $this->price_log = new PriceRepository();
    }

    /**
     * Calculate the design surcharge for a given design hash.
     * Returns the surcharge amount (0 if no pricing rules apply).
     */
    public function calculate(string $design_hash): float {
        $design = $this->designs->get_by_hash($design_hash);
        if (!$design) {
            return 0.0;
        }

        $template = $this->templates->get((int) $design['template_id']);
        if (!$template) {
            return 0.0;
        }

        $config = $template['global_config'] ?? [];
        $mode   = $config['pricing_mode'] ?? 'per_element';

        // Count elements across all views
        $counts = $this->count_elements($design['views'] ?? []);
        if ($counts['total'] === 0) {
            return 0.0;
        }

        // Calculate raw surcharge based on pricing mode
        if ($mode === 'tier') {
            $surcharge = $this->calculate_tier($counts['total'], $config['tiers'] ?? []);
        } else {
            $surcharge = $this->calculate_per_element($counts, $config);
        }

        // Apply min/max caps
        $min = (float) ($config['min_surcharge'] ?? 0);
        $max = $config['max_surcharge'] ?? null;

        if ($surcharge > 0 && $surcharge < $min) {
            $surcharge = $min;
        }
        if ($max !== null && $surcharge > (float) $max) {
            $surcharge = (float) $max;
        }

        // Persist the calculated price
        $this->designs->update_price((int) $design['id'], $surcharge);

        // Log individual element prices for audit trail
        $this->log_element_prices((int) $design['id'], $design['views'] ?? [], $config, $mode);

        return $surcharge;
    }

    /**
     * Count design elements by type across all views.
     */
    private function count_elements(array $views): array {
        $counts = ['text' => 0, 'image' => 0, 'svg' => 0, 'total' => 0];

        foreach ($views as $view) {
            $canvas = $view['canvas_json'] ?? [];
            $objects = $canvas['objects'] ?? [];

            foreach ($objects as $obj) {
                $type = $this->classify_object($obj);
                if ($type && isset($counts[$type])) {
                    $counts[$type]++;
                    $counts['total']++;
                }
            }
        }

        return $counts;
    }

    /**
     * Classify a Fabric.js object as text, image, svg, or null (zone/background).
     */
    private function classify_object(array $obj): ?string {
        $fabric_type = $obj['type'] ?? '';

        // Text types
        if (in_array($fabric_type, ['IText', 'Textbox', 'Text', 'i-text', 'textbox'], true)) {
            return 'text';
        }

        // Image type
        if (in_array($fabric_type, ['Image', 'image'], true)) {
            return 'image';
        }

        // SVG groups (Group containing paths/circles)
        if (in_array($fabric_type, ['Group', 'group'], true)) {
            return 'svg';
        }

        // Path objects that are standalone SVGs (not zone boundaries)
        if (in_array($fabric_type, ['Path', 'path'], true) && empty($obj['isZoneBoundary'])) {
            return 'svg';
        }

        // Rect objects used for zones — skip
        // Other unknown types — skip
        return null;
    }

    /**
     * Calculate surcharge using per-element pricing.
     */
    private function calculate_per_element(array $counts, array $config): float {
        $text_price  = (float) ($config['text_price'] ?? 0);
        $image_price = (float) ($config['image_price'] ?? 0);
        $svg_price   = (float) ($config['svg_price'] ?? 0);

        return ($counts['text'] * $text_price)
             + ($counts['image'] * $image_price)
             + ($counts['svg'] * $svg_price);
    }

    /**
     * Calculate surcharge using tier-based pricing.
     */
    private function calculate_tier(int $total_elements, array $tiers): float {
        foreach ($tiers as $tier) {
            $min = (int) ($tier['min'] ?? 0);
            $max = (int) ($tier['max'] ?? PHP_INT_MAX);
            if ($total_elements >= $min && $total_elements <= $max) {
                return (float) ($tier['surcharge'] ?? 0);
            }
        }
        return 0.0;
    }

    /**
     * Log individual element prices for audit trail.
     */
    private function log_element_prices(int $design_id, array $views, array $config, string $mode): void {
        $text_price  = (float) ($config['text_price'] ?? 0);
        $image_price = (float) ($config['image_price'] ?? 0);
        $svg_price   = (float) ($config['svg_price'] ?? 0);

        // Clear existing logs so the audit trail reflects the current design state
        $this->price_log->delete_for_design($design_id);

        $entries = [];
        $element_index = 0;
        foreach ($views as $view) {
            $canvas  = $view['canvas_json'] ?? [];
            $objects = $canvas['objects'] ?? [];

            foreach ($objects as $obj) {
                $type = $this->classify_object($obj);
                if (!$type) {
                    continue;
                }

                if ($mode === 'per_element') {
                    $price = match ($type) {
                        'text'  => $text_price,
                        'image' => $image_price,
                        'svg'   => $svg_price,
                        default => 0.0,
                    };
                } else {
                    $price = 0.0;
                }

                $entries[] = [
                    'design_id'    => $design_id,
                    'element_type' => $type,
                    'element_id'   => sprintf('%s_%d', $type, $element_index),
                    'price'        => $price,
                ];
                $element_index++;
            }
        }

        $this->price_log->log_batch($entries);
    }
}

<?php
namespace Snelgraveren\ProductDesigner\Export;

defined('ABSPATH') || exit;

/**
 * The template's zone outline as a non-engraving REFERENCE in every
 * production export, so the operator can line the design up with the real
 * product: LightBurn tool layer T1, a thin line in SVG/PNG/PDF.
 *
 * The outline itself is computed in the browser by the template builder
 * (shared/js/zoneOutline.js — only Fabric knows exactly where a zone SVG
 * lands) and stored per zone as `export_outline: { d, v }`, absolute M/L/C/Z
 * path data in canvas pixels. This class only validates and re-draws it.
 * Because the outline belongs to the TEMPLATE, designs ordered before this
 * existed get it too.
 *
 * Pure PHP — no WordPress calls — so it is unit-tested without a site
 * (tests/php-unit, bin/php-unit.sh).
 */
class ReferenceOutline {

    /** Longest stored outline, in characters. */
    public const MAX_LENGTH = 200000;

    /**
     * Keep a posted `export_outline` only when it is plain absolute path data.
     *
     * @param mixed $value
     * @return array{d:string,v:int}|null
     */
    public static function sanitize_outline($value): ?array {
        if (!is_array($value) || !isset($value['d']) || !is_string($value['d'])) {
            return null;
        }
        $d = trim($value['d']);
        if ($d === '' || strlen($d) > self::MAX_LENGTH) {
            return null;
        }
        if (!preg_match('/^[MLCZ0-9.\-\s]+$/', $d)) {
            return null;
        }
        return ['d' => $d, 'v' => 1];
    }

    /** LightBurn tool layer T1 (measured in LightBurn 2.2.01 project files). */
    public const LBRN_TOOL_INDEX = 30;

    /** Reference colour #00A0FF. */
    private const RGB = [0, 160, 255];

    /** Hairline width of the reference line in SVG and PDF, in millimetres. */
    private const LINE_MM = 0.1;

    /**
     * Largest PNG (in pixels) that is decoded to draw on. The PNG comes from
     * the customer's browser, so its header may declare any size; a normal
     * export is 3x the canvas (800x600 -> 4.3 MP). Above this the PNG is left
     * as it is: no outline in that one file, never an exhausted server.
     */
    public const MAX_PNG_PIXELS = 25000000;

    /** Bezier flattening steps for the raster formats. */
    private const CURVE_STEPS = 24;

    /**
     * The validated outline path strings of the template view a design view
     * belongs to. [] when that view has none (or none is valid).
     *
     * @return string[]
     */
    public static function for_view(array $design_view, array $template): array {
        $view_id = (int) ($design_view['view_id'] ?? 0);
        foreach ($template['views'] ?? [] as $tv) {
            if ((int) ($tv['id'] ?? 0) !== $view_id) {
                continue;
            }
            $ds = [];
            foreach ((array) ($tv['zones_config'] ?? []) as $zone) {
                $clean = is_array($zone) ? self::sanitize_outline($zone['export_outline'] ?? null) : null;
                if ($clean) {
                    $ds[] = $clean['d'];
                }
            }
            return $ds;
        }
        return [];
    }

    /** True when any zone of any view still lacks a stored outline. */
    public static function template_missing_outline(array $template): bool {
        foreach ($template['views'] ?? [] as $tv) {
            foreach ((array) ($tv['zones_config'] ?? []) as $zone) {
                if (is_array($zone) && !self::sanitize_outline($zone['export_outline'] ?? null)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Millimetres per canvas pixel for a view (96-DPI fallback, as the PDF export). */
    public static function mm_per_px(array $dimensions): float {
        $w  = max(1, (int) ($dimensions['width'] ?? 0));
        $mm = (float) ($dimensions['width_mm'] ?? 0);
        return $mm > 0 ? $mm / $w : 25.4 / 96;
    }

    /**
     * Absolute M/L/C/Z path data → subpaths. Every subpath is closed:
     * LightBurn drops open paths on import.
     *
     * @return array<int, array{start: float[], closed: bool, segs: array}>
     */
    public static function parse(string $d): array {
        preg_match_all('/[MLCZ]|-?[\d.]+/', $d, $m);
        $tok = $m[0];
        $subs = [];
        $cur = null;
        $cmd = '';
        $i = 0;
        $n = count($tok);
        $read = static function (int $k) use (&$i, $tok, $n): ?array {
            if ($i + $k > $n) {
                return null;
            }
            $vals = [];
            for ($j = 0; $j < $k; $j++) {
                if (!is_numeric($tok[$i + $j])) {
                    return null;
                }
                $vals[] = (float) $tok[$i + $j];
            }
            $i += $k;
            return $vals;
        };
        while ($i < $n) {
            if (preg_match('/^[MLCZ]$/', $tok[$i])) {
                $cmd = $tok[$i++];
                if ($cmd === 'Z') {
                    if ($cur !== null) {
                        $subs[] = $cur;
                        $cur = null;
                    }
                    continue;
                }
            }
            if ($cmd === 'M') {
                $p = $read(2);
                if (!$p) break;
                if ($cur !== null) {
                    $subs[] = $cur;
                }
                $cur = ['start' => $p, 'closed' => true, 'segs' => []];
                $cmd = 'L'; // implicit LineTo after a MoveTo
            } elseif ($cmd === 'L' && $cur !== null) {
                $p = $read(2);
                if (!$p) break;
                $cur['segs'][] = ['type' => 'L', 'to' => $p];
            } elseif ($cmd === 'C' && $cur !== null) {
                $p = $read(6);
                if (!$p) break;
                $cur['segs'][] = ['type' => 'C', 'c1' => [$p[0], $p[1]], 'c2' => [$p[2], $p[3]], 'to' => [$p[4], $p[5]]];
            } else {
                $i++;
            }
        }
        if ($cur !== null) {
            $subs[] = $cur;
        }
        return array_values(array_filter($subs, static fn($s) => !empty($s['segs'])));
    }

    /** JS `String(parseFloat(x.toFixed(6)))`, the LightBurn writer's number format. */
    private static function n(float $v, int $digits = 6): string {
        if (!is_finite($v)) {
            return '0';
        }
        $s = sprintf('%.' . $digits . 'F', $v);
        if (strpos($s, '.') !== false) {
            $s = rtrim(rtrim($s, '0'), '.');
        }
        return ($s === '-0' || $s === '') ? '0' : $s;
    }

    /**
     * Port of lbrnWriter.js `subpathsToVertPrim`, pinned to the same fixture
     * (tests/fixtures/reference-outline/vertprim.json).
     *
     * @return array{vertList: string, primList: string}
     */
    public static function to_vert_prim(array $subpaths, float $mm_per_px): array {
        $pt = static fn(array $p): array => [$p[0] * $mm_per_px, $p[1] * $mm_per_px];
        $verts = [];
        $prims = '';
        foreach ($subpaths as $sp) {
            $start_idx = count($verts);
            $verts[] = ['p' => $pt($sp['start']), 'c0' => null, 'c1' => null];
            $last_k = count($sp['segs']) - 1;
            foreach ($sp['segs'] as $k => $seg) {
                $is_last = $k === $last_k;
                $closes = $sp['closed'] && $is_last
                    && abs($seg['to'][0] - $sp['start'][0]) < 1e-9
                    && abs($seg['to'][1] - $sp['start'][1]) < 1e-9;
                $from = count($verts) - 1;
                $to_idx = $closes ? $start_idx : count($verts);
                if (!$closes) {
                    $verts[] = ['p' => $pt($seg['to']), 'c0' => null, 'c1' => null];
                }
                if ($seg['type'] === 'L') {
                    $prims .= "L{$from} {$to_idx}";
                } else {
                    $verts[$from]['c0'] = $pt($seg['c1']);
                    $verts[$to_idx]['c1'] = $pt($seg['c2']);
                    $prims .= "B{$from} {$to_idx}";
                }
                if ($sp['closed'] && $is_last && !$closes) {
                    $prims .= "L{$to_idx} {$start_idx}";
                }
            }
        }
        $vert_list = '';
        foreach ($verts as $v) {
            $vert_list .= 'V' . self::n($v['p'][0]) . ' ' . self::n($v['p'][1]);
            if ($v['c0']) {
                $vert_list .= 'c0x' . self::n($v['c0'][0]) . 'c0y' . self::n($v['c0'][1]);
            }
            if ($v['c1']) {
                $vert_list .= 'c1x' . self::n($v['c1'][0]) . 'c1y' . self::n($v['c1'][1]);
            }
        }
        return ['vertList' => $vert_list, 'primList' => $prims];
    }

    /**
     * Add the outline to a LightBurn project as Path shapes on tool layer T1,
     * which LightBurn never sends to the laser. The design's own shapes and
     * cut settings are left byte for byte as they were.
     */
    public static function inject_lbrn(string $xml, array $ds, float $mm_per_px): string {
        if (!$ds) {
            return $xml;
        }
        $next = 0;
        if (preg_match_all('/\s(?:VertID|PrimID)="(\d+)"/', $xml, $ids)) {
            $next = max(array_map('intval', $ids[1]));
        }
        $shapes = '';
        foreach ($ds as $d) {
            $vp = self::to_vert_prim(self::parse($d), $mm_per_px);
            if ($vp['primList'] === '') {
                continue;
            }
            $next++;
            $shapes .= '<Shape Type="Path" CutIndex="' . self::LBRN_TOOL_INDEX . '" VertID="' . $next . '" PrimID="' . $next . '">'
                . '<XForm>1 0 0 1 0 0</XForm>'
                . '<VertList>' . $vp['vertList'] . '</VertList>'
                . '<PrimList>' . $vp['primList'] . '</PrimList>'
                . "</Shape>\n";
        }
        if ($shapes === '') {
            return $xml;
        }
        if (!preg_match('/<CutSetting type="Tool">\s*<index Value="' . self::LBRN_TOOL_INDEX . '"\/>/', $xml)) {
            $tool = '<CutSetting type="Tool"><index Value="' . self::LBRN_TOOL_INDEX . '"/><name Value="T1"/><priority Value="1"/></CutSetting>' . "\n";
            $pos = strrpos($xml, '</CutSetting>');
            if ($pos !== false) {
                $pos += strlen('</CutSetting>');
                $nl = substr($xml, $pos, 1) === "\n" ? 1 : 0;
                $xml = substr($xml, 0, $pos + $nl) . $tool . substr($xml, $pos + $nl);
            } else {
                $xml = preg_replace('/(<LightBurnProject\b[^>]*>\n?)/', '$1' . $tool, $xml, 1);
            }
        }
        $pos = strpos($xml, '<Notes');
        if ($pos === false) {
            $pos = strrpos($xml, '</LightBurnProject>');
        }
        if ($pos === false) {
            return $xml;
        }
        return substr($xml, 0, $pos) . $shapes . substr($xml, $pos);
    }

    /**
     * Add the outline to an SVG export as its own group: thin, no fill, in the
     * reference colour. Coordinates are canvas px, the viewBox of every export.
     */
    public static function inject_svg(string $svg, array $ds, float $mm_per_px): string {
        if (!$ds) {
            return $svg;
        }
        $pos = strrpos($svg, '</svg>');
        if ($pos === false) {
            return $svg;
        }
        $sw = self::n(self::LINE_MM / max($mm_per_px, 1e-9), 3);
        $g = '<g id="referentie" fill="none" stroke="#00A0FF" stroke-width="' . $sw . '">';
        foreach ($ds as $d) {
            $g .= '<path d="' . $d . '"/>';
        }
        $g .= '</g>';
        return substr($svg, 0, $pos) . $g . substr($svg, $pos);
    }

    /**
     * Subpaths flattened to point lists (canvas px), closing point included.
     *
     * @return array<int, array<int, float[]>>
     */
    private static function polylines(array $ds): array {
        $lines = [];
        foreach ($ds as $d) {
            foreach (self::parse($d) as $sp) {
                $pts = [$sp['start']];
                $last = $sp['start'];
                foreach ($sp['segs'] as $seg) {
                    if ($seg['type'] === 'L') {
                        $pts[] = $seg['to'];
                    } else {
                        for ($k = 1; $k <= self::CURVE_STEPS; $k++) {
                            $t = $k / self::CURVE_STEPS;
                            $u = 1 - $t;
                            $pts[] = [
                                $u * $u * $u * $last[0] + 3 * $u * $u * $t * $seg['c1'][0] + 3 * $u * $t * $t * $seg['c2'][0] + $t * $t * $t * $seg['to'][0],
                                $u * $u * $u * $last[1] + 3 * $u * $u * $t * $seg['c1'][1] + 3 * $u * $t * $t * $seg['c2'][1] + $t * $t * $t * $seg['to'][1],
                            ];
                        }
                    }
                    $last = $seg['to'];
                }
                $pts[] = $sp['start'];
                $lines[] = $pts;
            }
        }
        return $lines;
    }

    /**
     * Draw the outline onto a PNG (binary in, binary out). `$scale` is PNG
     * pixels per canvas pixel (the browser renders at 3x). Returns the input
     * unchanged when there is nothing to draw or no image library.
     */
    public static function draw_png(string $png, array $ds, float $scale, int $max_pixels = self::MAX_PNG_PIXELS): string {
        if (!$ds) {
            return $png;
        }
        // Read the size from the header only — before anything is decoded.
        $size = @getimagesizefromstring($png);
        if (!$size || $size[0] < 1 || $size[1] < 1 || $size[0] * $size[1] > $max_pixels) {
            return $png;
        }
        $lines = self::polylines($ds);
        if (function_exists('imagecreatefromstring')) {
            $im = @imagecreatefromstring($png);
            if ($im === false) {
                return $png;
            }
            imagealphablending($im, true);
            imagesavealpha($im, true);
            imagesetthickness($im, 2);
            $col = imagecolorallocate($im, self::RGB[0], self::RGB[1], self::RGB[2]);
            foreach ($lines as $pts) {
                for ($i = 1, $c = count($pts); $i < $c; $i++) {
                    imageline(
                        $im,
                        (int) round($pts[$i - 1][0] * $scale), (int) round($pts[$i - 1][1] * $scale),
                        (int) round($pts[$i][0] * $scale), (int) round($pts[$i][1] * $scale),
                        $col
                    );
                }
            }
            ob_start();
            imagepng($im);
            $out = (string) ob_get_clean();
            imagedestroy($im);
            return $out !== '' ? $out : $png;
        }
        if (class_exists('\Imagick')) {
            try {
                $im = new \Imagick();
                $im->readImageBlob($png);
                $draw = new \ImagickDraw();
                $draw->setStrokeColor(new \ImagickPixel(sprintf('rgb(%d,%d,%d)', ...self::RGB)));
                $draw->setStrokeWidth(2);
                $draw->setFillOpacity(0);
                foreach ($lines as $pts) {
                    $draw->polyline(array_map(static fn($p) => ['x' => $p[0] * $scale, 'y' => $p[1] * $scale], $pts));
                }
                $im->drawImage($draw);
                $im->setImageFormat('png');
                return $im->getImageBlob();
            } catch (\Exception $e) {
                return $png;
            }
        }
        return $png;
    }

    /** Draw the outline on the current TCPDF page as a vector hairline. */
    public static function draw_pdf(\TCPDF $pdf, array $ds, float $mm_per_px): void {
        if (!$ds) {
            return;
        }
        $style = ['width' => self::LINE_MM, 'cap' => 'round', 'join' => 'round', 'dash' => 0, 'color' => self::RGB];
        foreach (self::polylines($ds) as $pts) {
            $flat = [];
            foreach ($pts as $p) {
                $flat[] = $p[0] * $mm_per_px;
                $flat[] = $p[1] * $mm_per_px;
            }
            $pdf->Polygon($flat, 'D', ['all' => $style], [], true);
        }
    }
}

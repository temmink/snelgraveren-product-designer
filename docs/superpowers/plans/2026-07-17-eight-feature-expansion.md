# Eight-Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live price preview, image-quality warnings, a "Mijn ontwerpen" account tab, a production bulk-export page, an engrave/vector-only guard, guest-design cleanup with retention setting, health-check e-mail alerts, and a design-funnel stats page.

**Architecture:** All server logic goes through existing Repository/REST patterns (`pf/v1` namespace, nonce/capability permission callbacks). New cron work uses a single daily WP-Cron hook with self-healing registration on `init` (plugin updates via ZIP upload never re-run activation). Frontend work extends the existing Zustand + Fabric.js designer app.

**Tech Stack:** PHP 8.1+ (WordPress/WooCommerce), React 18 + Zustand + Fabric.js 6, WP-Cron, WP Settings API.

## Global Constraints

- Namespace `ProductForge\` with sub-namespace per directory; file naming `class-{lowercase-hyphenated}.php`; `namespace` before `defined('ABSPATH') || exit;`.
- ALL DB queries via `$wpdb->prepare()`; all DB access via Repository classes in `includes/Database/`.
- Prices are always calculated server-side — the client only *displays* what the server returns.
- REST: nonce verification on customer endpoints (`verify_nonce`), `edit_pf_templates` on admin endpoints.
- Frontend CSS: `pf-` prefix, BEM (`pf-<block>__<element>--<modifier>`).
- All user-facing strings wrapped in `__()`/`esc_html__()` with domain `productforge`. Dutch translations are added in the final task, not per-task.
- **Verification pattern:** PHPUnit is not installed in the container (composer has no require-dev). PHP tasks verify via `php -l` + `docker compose exec -T wordpress wp eval ...` smoke scripts + `curl` against `http://localhost:8080` (admin/admin). JS tasks verify via `npm test` (Jest) and `npm run build`. Start env with `docker compose up -d` first.
- Commit after every task with a conventional-commit message.
- CRITICAL context: the plugin is deployed to production via ZIP upload (update flow) — activation hooks do NOT re-run on update. Anything that must exist after an update (cron schedules) needs self-healing registration on `init`.

---

### Task 1: Price preview endpoint (backend)

**Files:**
- Modify: `includes/Pricing/class-price-calculator.php`
- Create: `includes/API/class-rest-pricing.php`
- Modify: `includes/class-product-forge.php` (register routes in `init_api()`, ~line 141 where other `Rest*` classes are registered)

**Interfaces:**
- Produces: `PriceCalculator::preview_from_counts(array $counts, array $global_config): float` — pure, no persistence. `$counts = ['text'=>int,'image'=>int,'svg'=>int,'total'=>int]`.
- Produces: `POST /pf/v1/pricing/preview` body `{template_id:int, counts:{text:int,image:int,svg:int}}` → `{surcharge: float, currency_symbol: string}`. Permission: `verify_nonce` (same pattern as RestDesigns).

- [ ] **Step 1: Extract pure pricing math from `calculate()`**

In `class-price-calculator.php`, add this public method and make `calculate()` use it (replace lines 46–62, the mode dispatch + min/max clamp, with a call to it):

```php
    /**
     * Pure surcharge computation from element counts + template pricing
     * config. Used by calculate() (persisting path) and by the live
     * price-preview REST endpoint (non-persisting).
     */
    public function preview_from_counts(array $counts, array $config): float {
        $total = (int) ($counts['total'] ?? 0);
        if ($total === 0) {
            return 0.0;
        }

        $mode = $config['pricing_mode'] ?? 'per_element';
        if ($mode === 'tier') {
            $surcharge = $this->calculate_tier($total, $config['tiers'] ?? []);
        } else {
            $surcharge = $this->calculate_per_element($counts, $config);
        }

        $min = (float) ($config['min_surcharge'] ?? 0);
        $max = $config['max_surcharge'] ?? null;
        if ($surcharge > 0 && $surcharge < $min) {
            $surcharge = $min;
        }
        if ($max !== null && $surcharge > (float) $max) {
            $surcharge = (float) $max;
        }

        return $surcharge;
    }
```

The body of `calculate()` from line 37 onward becomes:

```php
        $config = $template['global_config'] ?? [];
        $mode   = $config['pricing_mode'] ?? 'per_element';

        $counts = $this->count_elements($design['views'] ?? []);
        if ($counts['total'] === 0) {
            return 0.0;
        }

        $surcharge = $this->preview_from_counts($counts, $config);

        // Persist the calculated price
        $this->designs->update_price((int) $design['id'], $surcharge);

        // Log individual element prices for audit trail
        $this->log_element_prices((int) $design['id'], $design['views'] ?? [], $config, $mode);

        return $surcharge;
```

- [ ] **Step 2: Create the REST endpoint**

Create `includes/API/class-rest-pricing.php`:

```php
<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\TemplateRepository;
use ProductForge\Pricing\PriceCalculator;

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
            return new \WP_Error('pf_not_found', __('Template not found.', 'productforge'), ['status' => 404]);
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
```

- [ ] **Step 3: Register in `init_api()`**

In `includes/class-product-forge.php`, inside `init_api()`'s `rest_api_init` closure where the other `Rest*` classes register, add:

```php
            (new API\RestPricing())->register_routes();
```

- [ ] **Step 4: Verify**

```bash
docker compose exec -T wordpress bash -c "php -l /var/www/html/wp-content/plugins/productforge/includes/API/class-rest-pricing.php && php -l /var/www/html/wp-content/plugins/productforge/includes/Pricing/class-price-calculator.php"
docker compose exec -T wordpress wp eval 'var_dump((new ProductForge\Pricing\PriceCalculator())->preview_from_counts(["text"=>2,"image"=>1,"svg"=>0,"total"=>3],["pricing_mode"=>"per_element","text_price"=>1.5,"image_price"=>2.0]));' --allow-root
```
Expected: `float(5)` (2×1.50 + 1×2.00). Then endpoint smoke test (401 without nonce is the expected pass — nonce check works):
```bash
curl -s -X POST http://localhost:8080/wp-json/pf/v1/pricing/preview -H 'Content-Type: application/json' -d '{"template_id":1,"counts":{"text":1}}' -o /dev/null -w '%{http_code}\n'
```
Expected: `403` (cookie-less nonce failure). Also verify the existing cart surcharge still works: `wp eval 'var_dump((new ProductForge\Pricing\PriceCalculator())->calculate("nonexistent"));'` → `float(0)`.

- [ ] **Step 5: Commit** — `feat: add non-persisting price preview endpoint (pf/v1/pricing/preview)`

---

### Task 2: Live price line in the designer (frontend)

**Files:**
- Create: `frontend/js/designer/src/utils/priceCounts.js`
- Create: `tests/js/utils/priceCounts.test.js`
- Modify: `frontend/js/designer/src/api/designerApi.js` (add `previewPrice`)
- Modify: `frontend/js/designer/src/App.jsx` (price state + polling effect + UI line near save button, `.pf-designer__sidebar-wrap` around line 594)
- Modify: `frontend/js/designer/src/designer.css` (`.pf-designer__price`)

**Interfaces:**
- Consumes: `POST /pf/v1/pricing/preview` from Task 1.
- Produces: `countPriceableElements(snapshots: object): {text,image,svg}` — classification MUST mirror `PriceCalculator::classify_object()` (server is the source of truth): IText/Textbox/Text→text, Image→image, Group→svg, Path without `isZoneBoundary`→svg; case-insensitive; skip objects whose `data.isZoneOverlay` is set.

- [ ] **Step 1: Write the failing Jest test**

`tests/js/utils/priceCounts.test.js`:

```js
import { countPriceableElements } from '../../../frontend/js/designer/src/utils/priceCounts';

describe('countPriceableElements', () => {
    it('classifies objects the same way as the server', () => {
        const snapshots = {
            0: { objects: [
                { type: 'IText' }, { type: 'i-text' },
                { type: 'Image' },
                { type: 'Group' },
                { type: 'Path' },
                { type: 'Path', isZoneBoundary: true },
                { type: 'Rect' },
            ] },
            1: { objects: [{ type: 'textbox' }] },
        };
        expect(countPriceableElements(snapshots)).toEqual({ text: 3, image: 1, svg: 2 });
    });

    it('returns zeros for empty snapshots', () => {
        expect(countPriceableElements({})).toEqual({ text: 0, image: 0, svg: 0 });
    });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npm test -- priceCounts` → module not found)

- [ ] **Step 3: Implement `utils/priceCounts.js`**

```js
/**
 * Count priceable elements across all view snapshots. The classification
 * mirrors PHP PriceCalculator::classify_object() — the server recalculates
 * authoritatively in the cart; this only feeds the live preview.
 */
const TEXT_TYPES = new Set(['itext', 'textbox', 'text']);

export function countPriceableElements(snapshots) {
    const counts = { text: 0, image: 0, svg: 0 };
    for (const json of Object.values(snapshots || {})) {
        for (const obj of json?.objects || []) {
            const type = String(obj.type || '').toLowerCase().replace(/-/g, '');
            if (TEXT_TYPES.has(type)) counts.text += 1;
            else if (type === 'image') counts.image += 1;
            else if (type === 'group') counts.svg += 1;
            else if (type === 'path' && !obj.isZoneBoundary) counts.svg += 1;
        }
    }
    return counts;
}
```

- [ ] **Step 4: Run test — expect PASS** (`npm test -- priceCounts`)

- [ ] **Step 5: API helper + UI**

`designerApi.js` — add (same style as the other helpers):

```js
export async function previewPrice(templateId, counts) {
  const res = await fetch(apiUrl('/pricing/preview'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ template_id: templateId, counts }),
  });
  if (!res.ok) throw new Error('Price preview failed');
  return res.json();
}
```

`App.jsx` — add imports (`previewPrice` from api, `countPriceableElements` from utils), then state + effect near the other state hooks:

```jsx
  const [pricePreview, setPricePreview] = useState(null); // {surcharge, currency_symbol}

  // Live price preview: recompute whenever snapshots change (snapshotView
  // fires on every object add/modify/remove). Debounced; failures are
  // silent — the authoritative price is always computed server-side in
  // the cart.
  useEffect(() => {
    if (!config.template_id || !template) return;
    const counts = countPriceableElements(canvasSnapshots);
    const timer = setTimeout(() => {
      previewPrice(config.template_id, counts)
        .then(setPricePreview)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [canvasSnapshots, config.template_id, template]);
```

In the sidebar wrap (directly ABOVE the save button, `App.jsx` ~line 601), add:

```jsx
            {pricePreview && pricePreview.surcharge > 0 && (
              <div className="pf-designer__price" aria-live="polite">
                {__('Design surcharge:', 'productforge')}{' '}
                <strong>{pricePreview.currency_symbol}{pricePreview.surcharge.toFixed(2)}</strong>
              </div>
            )}
```

`designer.css` — after the `.pf-designer__save-btn` rules:

```css
.pf-designer__price {
  padding: 8px 12px;
  font-size: 14px;
  color: #1f2937;
  background: #f3f4f6;
  border-radius: 6px;
  text-align: center;
}
```

- [ ] **Step 6: Verify** — `npm test` (new tests pass, same 12 pre-existing failures), `npm run build` succeeds. In Docker: open `http://localhost:8080/hondenpenning-graveren/`, set a `text_price` on template 1 via the admin Pricing tab (or `wp eval` update of global_config), add text in the designer → price line appears within ~0.5 s. With zero pricing config: no line.

- [ ] **Step 7: Commit** — `feat: live design surcharge preview in the designer sidebar`

---

### Task 3: Image quality (DPI) warning

**Files:**
- Create: `frontend/js/designer/src/utils/imageQuality.js`
- Create: `tests/js/utils/imageQuality.test.js`
- Modify: `frontend/js/designer/src/components/tabs/ElementTab.jsx` (ImageProperties section, ~line 345 where scale % renders)
- Modify: `frontend/js/designer/src/designer.css` (`.pf-element__warning`)

**Interfaces:**
- Produces: `getImageQuality(fabricImg): 'ok' | 'upscaled'` — pure function. Rule: exports render at 3× (`toDataURL multiplier: 3`), so output pixel width = `getScaledWidth() * 3`. If that exceeds the intrinsic `img.width * 1.1` (10% tolerance), the source is being upscaled in the final export → `'upscaled'`.

- [ ] **Step 1: Failing test** — `tests/js/utils/imageQuality.test.js`:

```js
import { getImageQuality } from '../../../frontend/js/designer/src/utils/imageQuality';

const fakeImg = (naturalWidth, scaledWidth) => ({
    width: naturalWidth,
    getScaledWidth: () => scaledWidth,
});

describe('getImageQuality', () => {
    it('flags images whose 3x export exceeds source pixels', () => {
        // 300px source shown at 200px → export 600px → upscaled
        expect(getImageQuality(fakeImg(300, 200))).toBe('upscaled');
    });
    it('accepts images with enough source pixels', () => {
        // 1500px source shown at 200px → export 600px → fine
        expect(getImageQuality(fakeImg(1500, 200))).toBe('ok');
    });
    it('is ok for missing dimensions', () => {
        expect(getImageQuality(fakeImg(0, 200))).toBe('ok');
    });
});
```

- [ ] **Step 2: Run — FAIL**, then implement `utils/imageQuality.js`:

```js
/**
 * Designs export at 3x the canvas size (App.jsx toDataURL multiplier: 3).
 * If the image's intrinsic pixels are fewer than what the export needs,
 * the engraving/print result will be blurry.
 */
const EXPORT_MULTIPLIER = 3;
const TOLERANCE = 1.1;

export function getImageQuality(img) {
    const natural = img?.width || 0;
    const displayed = typeof img?.getScaledWidth === 'function' ? img.getScaledWidth() : 0;
    if (!natural || !displayed) return 'ok';
    return displayed * EXPORT_MULTIPLIER > natural * TOLERANCE ? 'upscaled' : 'ok';
}
```

- [ ] **Step 3: Run — PASS** (`npm test -- imageQuality`)

- [ ] **Step 4: Show the warning in ElementTab**

In `ElementTab.jsx`, inside the image-properties branch (where the scale percentage renders, ~line 345), import `getImageQuality` and add below the scale control (the component re-renders on selection/modification because `selectedObject` updates):

```jsx
      {getImageQuality(fabricObj) === 'upscaled' && (
        <p className="pf-element__warning">
          {__('This image is scaled beyond its resolution — the result may look blurry or pixelated. Use a larger image for a sharp result.', 'productforge')}
        </p>
      )}
```

(`fabricObj` = the selected Fabric object already available in ImageProperties — reuse the exact local variable name used there for scale display.)

`designer.css`:

```css
.pf-element__warning {
  margin: 8px 0 0;
  padding: 8px 10px;
  font-size: 13px;
  color: #92400e;
  background: #fef3c7;
  border-left: 3px solid #dba617;
  border-radius: 4px;
}
```

- [ ] **Step 5: Verify** — `npm test`, `npm run build`. In the local designer: upload a small image (e.g. 200px), scale it up → warning appears in the Element tab; scale it back down → warning disappears (selection updates on `object:modified`).

- [ ] **Step 6: Commit** — `feat: warn when an image is scaled beyond its source resolution`

---

### Task 4: Flip design status to `ordered` at checkout

Foundation for cleanup (Task 5) and stats (Task 11): today NOTHING updates `wp_pf_designs.status` after checkout, so ordered designs are indistinguishable from abandoned drafts.

**Files:**
- Modify: `includes/Database/class-design-repository.php` (add `mark_ordered_by_hash`)
- Modify: `includes/Frontend/class-order-integration.php` (`save_order_item_meta` + `store_api_save_design_meta`)
- Modify: `includes/API/class-rest-designs.php:257` (fix `admin_update_status` allowed list — `['draft','active','completed','archived']` mismatches the DB enum; change to `['draft','final','ordered','archived']`)

**Interfaces:**
- Produces: `DesignRepository::mark_ordered_by_hash(string $hash): bool`.
- Later tasks rely on: `status='ordered'` meaning "this design belongs to a placed order".

- [ ] **Step 1: Repository method**

Add to `class-design-repository.php`:

```php
    /**
     * Mark a design as ordered (called at checkout). Idempotent.
     */
    public function mark_ordered_by_hash(string $hash): bool {
        global $wpdb;
        $result = $wpdb->update(
            $this->table,
            ['status' => 'ordered'],
            ['design_hash' => $hash],
            ['%s'],
            ['%s']
        );
        $this->invalidate_cache($hash);
        return $result !== false;
    }
```

- [ ] **Step 2: Call it from both checkout paths**

In `save_order_item_meta` (class-order-integration.php), extend:

```php
    public function save_order_item_meta(\WC_Order_Item_Product $item, string $cart_item_key, array $values, \WC_Order $order): void {
        if (!empty($values['pf_design_hash'])) {
            $item->add_meta_data('_pf_design_hash', $values['pf_design_hash'], true);
            (new \ProductForge\Database\DesignRepository())->mark_ordered_by_hash($values['pf_design_hash']);
        }
    }
```

In `store_api_save_design_meta`, at the point where a hash is written to an item (`$item->add_meta_data('_pf_design_hash', ...)`), add the same `mark_ordered_by_hash($hash)` call.

- [ ] **Step 3: Fix the REST status whitelist** — `class-rest-designs.php:257`: replace `['draft', 'active', 'completed', 'archived']` with `['draft', 'final', 'ordered', 'archived']` (values `active`/`completed` were always silently rejected by the repository enum).

- [ ] **Step 4: Verify**

```bash
docker compose exec -T wordpress bash -c "php -l /var/www/html/wp-content/plugins/productforge/includes/Frontend/class-order-integration.php"
docker compose exec -T wordpress wp eval '
$r = new ProductForge\Database\DesignRepository();
$id = $r->create(["template_id"=>1, "product_id"=>737, "customer_id"=>0, "session_id"=>"testsession"]);
$d = $r->get($id);
var_dump($r->mark_ordered_by_hash($d["design_hash"]));
var_dump($r->get($id)["status"]);
$r->delete($id);' --allow-root
```
Expected: `bool(true)`, `string(7) "ordered"`.

- [ ] **Step 5: Commit** — `feat: mark designs as ordered at checkout and fix admin status whitelist`

---

### Task 5: Guest-design cleanup cron + retention setting

**Files:**
- Modify: `includes/Database/class-design-repository.php` (add `find_stale_guest_drafts`)
- Create: `includes/class-cleanup.php` (namespace `ProductForge`, file follows `class-{name}.php` → class `Cleanup`)
- Modify: `includes/class-product-forge.php` (boot `Cleanup` in `init()`, both contexts)
- Modify: `includes/class-deactivator.php` (clear the schedule)
- Modify: `includes/Admin/class-settings-page.php` (register + render `pf_guest_design_retention_days`)

**Interfaces:**
- Produces: cron hook `pf_daily_maintenance` (daily). `Cleanup::init(): void` (hooks + self-healing schedule), `Cleanup::run(): array` (returns `['deleted' => int]`, also used by Task 6 for health alerts).
- Produces: option `pf_guest_design_retention_days` (int, default 30, `0` = cleanup disabled).
- Produces: `DesignRepository::find_stale_guest_drafts(int $days, int $limit = 200): array` — guest (`customer_id = 0`), `status = 'draft'`, `updated_at` older than `$days` days. Ordered designs (Task 4) are never touched.

- [ ] **Step 1: Repository query**

```php
    /**
     * Guest drafts untouched for $days days. Ordered designs are excluded by
     * status; registered customers' designs are kept for their account page.
     */
    public function find_stale_guest_drafts(int $days, int $limit = 200): array {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is a class property
        return $wpdb->get_results($wpdb->prepare(
            "SELECT id, design_hash FROM {$this->table}
             WHERE customer_id = 0 AND status = 'draft'
               AND updated_at < DATE_SUB(NOW(), INTERVAL %d DAY)
             ORDER BY updated_at ASC LIMIT %d",
            $days,
            $limit
        ), ARRAY_A) ?: [];
    }
```

- [ ] **Step 2: Create `includes/class-cleanup.php`**

```php
<?php
namespace ProductForge;

defined('ABSPATH') || exit;

use ProductForge\Database\DesignRepository;
use ProductForge\Export\FileUtils;

/**
 * Daily maintenance: prune abandoned guest designs (and their thumbnail
 * files) after the configured retention period. The schedule self-heals on
 * init because plugin updates via ZIP upload never re-run activation.
 */
class Cleanup {

    public const HOOK = 'pf_daily_maintenance';

    public function init(): void {
        add_action(self::HOOK, [$this, 'run']);
        add_action('init', static function () {
            if (!wp_next_scheduled(self::HOOK)) {
                wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::HOOK);
            }
        });
    }

    /**
     * @return array{deleted:int}
     */
    public function run(): array {
        $days = (int) get_option('pf_guest_design_retention_days', 30);
        if ($days < 1) {
            return ['deleted' => 0];
        }

        $repo    = new DesignRepository();
        $deleted = 0;

        foreach ($repo->find_stale_guest_drafts($days) as $row) {
            $design = $repo->get((int) $row['id']);
            foreach ($design['views'] ?? [] as $view) {
                $thumb = $view['thumbnail'] ?? '';
                if ($thumb) {
                    $path = FileUtils::url_to_local_path($thumb);
                    if ($path && strpos($path, 'pf-thumbnails') !== false && file_exists($path)) {
                        @unlink($path);
                    }
                }
            }
            if ($repo->delete((int) $row['id'])) {
                $deleted++;
            }
        }

        return ['deleted' => $deleted];
    }
}
```

(Confirm `FileUtils::url_to_local_path()` signature in `includes/Export/class-file-utils.php` before use — it exists per the code-review-fixes changelog; if the method is instance-level, instantiate.)

- [ ] **Step 3: Boot + deactivation**

`class-product-forge.php` `init()` — alongside `init_exports()` etc. (both contexts):

```php
        (new Cleanup())->init();
```

`class-deactivator.php` — inside `deactivate()`:

```php
        wp_clear_scheduled_hook(\ProductForge\Cleanup::HOOK);
```

- [ ] **Step 4: Settings field**

`class-settings-page.php` → `register_settings()` add:

```php
        register_setting(self::OPTION_GROUP, 'pf_guest_design_retention_days', [
            'type'              => 'integer',
            'default'           => 30,
            'sanitize_callback' => static function ($value) {
                return max(0, min(3650, (int) $value));
            },
        ]);
```

`render()` — new row in the form table (after the export-format row):

```php
                    <tr>
                        <th scope="row">
                            <label for="pf_guest_design_retention_days"><?php esc_html_e('Guest design retention (days)', 'productforge'); ?></label>
                        </th>
                        <td>
                            <input type="number" min="0" max="3650" name="pf_guest_design_retention_days" id="pf_guest_design_retention_days"
                                   value="<?php echo esc_attr((int) get_option('pf_guest_design_retention_days', 30)); ?>" class="small-text" />
                            <p class="description"><?php esc_html_e('Abandoned guest designs (never ordered) are deleted after this many days. 0 disables cleanup. Ordered designs and designs of logged-in customers are never deleted.', 'productforge'); ?></p>
                        </td>
                    </tr>
```

- [ ] **Step 5: Verify**

```bash
docker compose exec -T wordpress wp eval '
$r = new ProductForge\Database\DesignRepository();
$id = $r->create(["template_id"=>1,"product_id"=>737,"customer_id"=>0,"session_id"=>"stale"]);
global $wpdb;
$wpdb->query($wpdb->prepare("UPDATE {$wpdb->prefix}pf_designs SET updated_at = DATE_SUB(NOW(), INTERVAL 60 DAY), created_at = created_at WHERE id = %d", $id));
$result = (new ProductForge\Cleanup())->run();
var_dump($result, $r->get($id));' --allow-root
```
Expected: `['deleted' => 1]` (at least), `NULL` for the deleted design. Then confirm ordered designs survive: repeat with `$r->mark_ordered_by_hash(...)` before running → design still present. Confirm schedule: `wp cron event list --allow-root | grep pf_daily_maintenance` after loading any page.

- [ ] **Step 6: Commit** — `feat: daily cleanup of abandoned guest designs with retention setting`

---

### Task 6: Health-check e-mail alert

**Files:**
- Modify: `includes/class-cleanup.php` (extend the daily hook)
- Modify: `includes/Admin/class-settings-page.php` (register + render `pf_health_email_alerts`)

**Interfaces:**
- Consumes: `Admin\SystemStatus::run_checks(): array` (checks with `status === 'error'` are critical).
- Produces: option `pf_health_email_alerts` (bool, default 1); option `pf_health_last_alert_hash` (internal, not on the settings form).

- [ ] **Step 1: Extend `Cleanup::run()`** — append before the return:

```php
        $this->maybe_send_health_alert();
```

And add the method:

```php
    /**
     * E-mail the admin when critical system checks fail. Sends at most once
     * per unique failure set: the hash of failing check ids is stored and
     * compared, so a persistent failure doesn't mail daily but a NEW failure
     * does. Recovery resets the stored hash.
     */
    private function maybe_send_health_alert(): void {
        if (!get_option('pf_health_email_alerts', 1)) {
            return;
        }

        $failures = array_values(array_filter(
            \ProductForge\Admin\SystemStatus::run_checks(),
            static fn($c) => $c['status'] === 'error'
        ));

        $hash = $failures ? md5(implode('|', array_column($failures, 'id'))) : '';
        if ($hash === get_option('pf_health_last_alert_hash', '')) {
            return;
        }
        update_option('pf_health_last_alert_hash', $hash, false);

        if (!$failures) {
            return; // recovered — reset only
        }

        $lines = array_map(
            static fn($c) => sprintf("- %s: %s %s", $c['label'], $c['message'], $c['fix']),
            $failures
        );
        wp_mail(
            get_option('admin_email'),
            sprintf(__('[%s] ProductForge: server configuration problem', 'productforge'), wp_parse_url(home_url(), PHP_URL_HOST)),
            sprintf(
                /* translators: 1: failure list, 2: settings page URL */
                __("The following ProductForge system checks are failing:\n\n%1\$s\n\nDetails and fixes: %2\$s", 'productforge'),
                implode("\n", $lines),
                admin_url('admin.php?page=pf-settings')
            )
        );
    }
```

Note: `Admin\SystemStatus` is autoloadable in cron context (autoloader covers all of `includes/`); `run_checks()` has no admin-only dependencies.

- [ ] **Step 2: Settings toggle** — `register_settings()`:

```php
        register_setting(self::OPTION_GROUP, 'pf_health_email_alerts', [
            'type'              => 'boolean',
            'default'           => true,
            'sanitize_callback' => static function ($value) { return $value ? 1 : 0; },
        ]);
```

`render()` row:

```php
                    <tr>
                        <th scope="row"><?php esc_html_e('E-mail alerts', 'productforge'); ?></th>
                        <td>
                            <label for="pf_health_email_alerts">
                                <input type="checkbox" name="pf_health_email_alerts" id="pf_health_email_alerts" value="1" <?php checked((bool) get_option('pf_health_email_alerts', true)); ?> />
                                <?php esc_html_e('E-mail the site admin when a critical system check starts failing (checked daily).', 'productforge'); ?>
                            </label>
                        </td>
                    </tr>
```

- [ ] **Step 3: Verify**

```bash
docker compose exec -T wordpress bash -c "chmod 555 /var/www/html/wp-content/uploads/pf-exports && wp eval '(new ProductForge\Cleanup())->run(); var_dump(get_option(\"pf_health_last_alert_hash\"));' --allow-root; chmod 755 /var/www/html/wp-content/uploads/pf-exports"
```
Expected: non-empty hash string (mail attempt fires — local mail may not deliver, that's fine; `wp_mail` returning false is acceptable). Re-run with healthy dirs → hash resets to `""`.

- [ ] **Step 4: Commit** — `feat: daily e-mail alert when critical system checks fail`

---

### Task 7: "Mijn ontwerpen" account tab

**Files:**
- Modify: `includes/Database/class-design-repository.php` (add `list_by_customer`)
- Create: `includes/Frontend/class-account-designs.php`
- Modify: `includes/class-product-forge.php` (`init_frontend()` — boot it; also add `add_rewrite_endpoint` needs `init`, so boot in BOTH contexts is safest for flushes)
- Modify: `includes/class-activator.php` (set `pf_flush_rewrite` flag option so the endpoint works without manual permalink save)

**Interfaces:**
- Produces: WooCommerce My Account endpoint `pf-designs` ("Mijn ontwerpen"); `DesignRepository::list_by_customer(int $customer_id, int $limit = 50): array` (each row includes `views` like `get()` does NOT — keep it light: join first view thumbnail).

- [ ] **Step 1: Repository method**

```php
    /**
     * Designs for the account page: newest first, with the first view's
     * thumbnail joined in (no full canvas_json payloads).
     */
    public function list_by_customer(int $customer_id, int $limit = 50): array {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table names are class properties
        return $wpdb->get_results($wpdb->prepare(
            "SELECT d.id, d.design_hash, d.product_id, d.status, d.total_price, d.created_at, d.updated_at,
                    (SELECT v.thumbnail FROM {$this->views_table} v WHERE v.design_id = d.id ORDER BY v.id ASC LIMIT 1) AS thumbnail
             FROM {$this->table} d
             WHERE d.customer_id = %d
             ORDER BY d.updated_at DESC
             LIMIT %d",
            $customer_id,
            $limit
        ), ARRAY_A) ?: [];
    }
```

- [ ] **Step 2: Create `includes/Frontend/class-account-designs.php`**

```php
<?php
namespace ProductForge\Frontend;

defined('ABSPATH') || exit;

use ProductForge\Database\DesignRepository;

/**
 * "My designs" tab on the WooCommerce My Account page. Lists the logged-in
 * customer's saved designs with a reopen link (?pf_design=HASH on the
 * product page — the designer auto-loads it).
 */
class AccountDesigns {

    private const ENDPOINT = 'pf-designs';

    public function init(): void {
        add_action('init', static function () {
            add_rewrite_endpoint(self::ENDPOINT, EP_ROOT | EP_PAGES);
            if (get_option('pf_flush_rewrite')) {
                flush_rewrite_rules();
                delete_option('pf_flush_rewrite');
            }
        });
        add_filter('woocommerce_account_menu_items', [$this, 'menu_item']);
        add_action('woocommerce_account_' . self::ENDPOINT . '_endpoint', [$this, 'render']);
        add_filter('woocommerce_endpoint_' . self::ENDPOINT . '_title', static function () {
            return __('My designs', 'productforge');
        });
    }

    public function menu_item(array $items): array {
        $logout = $items['customer-logout'] ?? null;
        unset($items['customer-logout']);
        $items[self::ENDPOINT] = __('My designs', 'productforge');
        if ($logout !== null) {
            $items['customer-logout'] = $logout;
        }
        return $items;
    }

    public function render(): void {
        $designs = (new DesignRepository())->list_by_customer(get_current_user_id());
        if (empty($designs)) {
            echo '<p>' . esc_html__('You have no saved designs yet. Start designing on any customizable product!', 'productforge') . '</p>';
            return;
        }

        echo '<table class="woocommerce-orders-table shop_table shop_table_responsive"><thead><tr>';
        echo '<th>' . esc_html__('Design', 'productforge') . '</th>';
        echo '<th>' . esc_html__('Product', 'productforge') . '</th>';
        echo '<th>' . esc_html__('Last edited', 'productforge') . '</th>';
        echo '<th></th></tr></thead><tbody>';

        foreach ($designs as $design) {
            $product = wc_get_product((int) $design['product_id']);
            if (!$product) {
                continue;
            }
            $reopen = add_query_arg('pf_design', $design['design_hash'], $product->get_permalink());
            echo '<tr>';
            echo '<td>';
            if (!empty($design['thumbnail']) && filter_var($design['thumbnail'], FILTER_VALIDATE_URL)) {
                echo '<img src="' . esc_url($design['thumbnail']) . '" alt="" style="max-width:64px;max-height:64px;border-radius:4px;" />';
            }
            echo '</td>';
            echo '<td><a href="' . esc_url($product->get_permalink()) . '">' . esc_html($product->get_name()) . '</a></td>';
            echo '<td>' . esc_html(date_i18n(get_option('date_format'), strtotime($design['updated_at']))) . '</td>';
            echo '<td><a class="woocommerce-button button" href="' . esc_url($reopen) . '">' . esc_html__('Open in designer', 'productforge') . '</a></td>';
            echo '</tr>';
        }
        echo '</tbody></table>';
    }
}
```

- [ ] **Step 3: Boot + rewrite flush flag**

`class-product-forge.php` — boot alongside the other always-on components (rewrite endpoints must register in admin requests too):

```php
        (new Frontend\AccountDesigns())->init();
```

`class-activator.php` `activate()` — add `update_option('pf_flush_rewrite', 1);`. ALSO run once for existing installs (updates don't re-activate): in this task's verify step, run `wp rewrite flush --allow-root` in dev, and note in the deploy checklist that the live site needs one visit to Instellingen → Permalinks → Opslaan (or `pf_flush_rewrite` can be set via the update path — simplest: `Cleanup`'s self-heal `init` from Task 5 also checks `get_option('pf_endpoint_registered') !== PF_VERSION` → set `pf_flush_rewrite`; implement that guard in `AccountDesigns::init()`):

```php
            if (get_option('pf_endpoint_registered') !== PF_VERSION) {
                update_option('pf_endpoint_registered', PF_VERSION, false);
                flush_rewrite_rules();
            }
```

(Use this version-guard INSTEAD of the `pf_flush_rewrite` option — one mechanism, works for both activation and updates.)

- [ ] **Step 4: Verify**

```bash
docker compose exec -T wordpress wp eval '
$r = new ProductForge\Database\DesignRepository();
$id = $r->create(["template_id"=>1,"product_id"=>737,"customer_id"=>1,"session_id"=>""]);
var_dump(count($r->list_by_customer(1)) >= 1);
$r->delete($id);' --allow-root
```
Expected: `bool(true)`. Then log in via the scratchpad cookie jar and:
```bash
curl -s -b <cookiejar> http://localhost:8080/mijn-account/pf-designs/ | grep -c "My designs\|Mijn ontwerpen"
```
Expected: ≥ 1 (the tab renders; exact account URL depends on the local WooCommerce page slug — check `wp option get woocommerce_myaccount_page_id` and use its permalink).

- [ ] **Step 5: Commit** — `feat: My Designs tab on the WooCommerce account page`

---

### Task 8: Vector-only (engrave) template flag

**Files:**
- Modify: `admin/js/template-builder/src/components/GlobalSettings.jsx` (new checkbox, follow the exact pattern of the existing `drawing_enabled`/`curved_text_enabled` toggles in that file)
- Modify: `frontend/js/designer/src/components/tabs/AddTab.jsx` (disable the Image button)
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx` (guard `handleFileUpload` for `elementType === 'image'`)

**Interfaces:**
- Produces: `global_config.vector_only` (boolean, default false). Written by the admin builder, read by the frontend designer. SVG uploads and clipart stay allowed (vector); raster image uploads are blocked.

- [ ] **Step 1: Admin toggle** — in `GlobalSettings.jsx`, next to the existing boolean toggles, add (copy the surrounding markup style exactly):

```jsx
      <label className="pf-global__toggle">
        <input
          type="checkbox"
          checked={!!globalConfig.vector_only}
          onChange={(e) => updateGlobalConfig({ vector_only: e.target.checked })}
        />
        {__('Vector only (engraving) — block raster image uploads', 'productforge')}
      </label>
```

(Use the actual toggle class/update-function names found in the file — match `drawing_enabled`'s row verbatim.)

- [ ] **Step 2: Frontend enforcement** — `AddTab.jsx`: where the Image button's `disabled` is computed from `isTypeAllowed('image')` (~line 13–60), extend:

```jsx
  const vectorOnly = !!template?.global_config?.vector_only;
  const imageDisabled = vectorOnly || !isTypeAllowed('image');
```

Use `imageDisabled` for the Image button and, when `vectorOnly`, set its title to `__('Photos are not possible on this product (engraving requires vector artwork)', 'productforge')`.

`DesignerCanvas.jsx` `handleFileUpload` (~line 793) — first line of the function:

```js
    if (elementType === 'image' && template?.global_config?.vector_only) {
      useDesignerStore.getState().setError(__('Photos are not possible on this product (engraving requires vector artwork).', 'productforge'));
      return;
    }
```

(`template` is available in the component; verify the local variable name used there.)

- [ ] **Step 3: Verify** — `npm run build`. In the local admin builder: enable the toggle on template 1, save; open the product designer → Image button disabled with explanatory tooltip; SVG and clipart still work. Disable again → Image button back.

- [ ] **Step 4: Commit** — `feat: vector-only template flag blocks raster uploads for engraving products`

---

### Task 9: Raster warning on admin order items

**Files:**
- Create: `includes/Export/class-design-inspector.php`
- Modify: `includes/Frontend/class-order-integration.php` (`render_export_actions`, ~line 172)

**Interfaces:**
- Produces: `DesignInspector::contains_raster(array $views): bool` (static) — true when any view's `canvas_json.objects` contains a Fabric `Image`/`image` whose `src` is not an `.svg` URL. Task 10 reuses this.

- [ ] **Step 1: Create the inspector**

```php
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
```

- [ ] **Step 2: Show it in the admin order item** — in `render_export_actions()`, after the design hash is loaded (it already fetches the design to list exports; if it only has the hash, fetch via `DesignRepository::get_by_hash($hash)`), add before the buttons:

```php
        $design = (new \ProductForge\Database\DesignRepository())->get_by_hash($hash);
        if ($design && \ProductForge\Export\DesignInspector::contains_raster($design['views'] ?? [])) {
            echo '<p style="color:#b32d2e;margin:4px 0;">⚠ '
                . esc_html__('This design contains raster images (photos) — check engraving suitability before production.', 'productforge')
                . '</p>';
        }
```

(If `render_export_actions` already loads the design row, reuse it instead of a second fetch.)

- [ ] **Step 3: Verify**

```bash
docker compose exec -T wordpress wp eval '
$views = [["canvas_json" => ["objects" => [["type"=>"Image","src"=>"http://x/photo.jpg"]]]]];
var_dump(ProductForge\Export\DesignInspector::contains_raster($views));
$views = [["canvas_json" => ["objects" => [["type"=>"Image","src"=>"http://x/clip.svg"],["type"=>"IText"]]]]];
var_dump(ProductForge\Export\DesignInspector::contains_raster($views));' --allow-root
```
Expected: `bool(true)`, `bool(false)`. Then place a test order locally with a photo design and open the admin order → warning shows on the item.

- [ ] **Step 4: Commit** — `feat: warn in admin order view when a design contains raster images`

---

### Task 10: Production bulk-export page

**Files:**
- Create: `includes/Admin/class-export-dashboard.php`
- Modify: `includes/Admin/class-admin.php` (submenu registration + boot, next to `SettingsPage`)

**Interfaces:**
- Consumes: `ExportManager::generate_export(string $hash, string $format, int $order_id): array` and `ExportManager::get_download_paths(int $export_id): array`; `ExportRepository::get_by_order(int $order_id): array`; `DesignInspector::contains_raster()` (Task 9); option `pf_export_default_format`.
- Produces: admin page `pf-export-dashboard` ("Productie") listing orders with designs; POST to `admin-post.php?action=pf_bulk_export` streams one ZIP.

- [ ] **Step 1: Create `includes/Admin/class-export-dashboard.php`**

```php
<?php
namespace ProductForge\Admin;

defined('ABSPATH') || exit;

use ProductForge\Database\DesignRepository;
use ProductForge\Database\ExportRepository;
use ProductForge\Export\DesignInspector;
use ProductForge\Export\ExportManager;

/**
 * Production dashboard: all recent orders containing designs, with a
 * one-click "download everything as ZIP" for a production run. ZIP entries
 * are named order-{number}/{product}-... so a day's engraving work sorts
 * by order.
 */
class ExportDashboard {

    private const PAGE_SLUG = 'pf-export-dashboard';

    public function init(): void {
        add_action('admin_post_pf_bulk_export', [$this, 'handle_bulk_download']);
    }

    public function register_menu(): void {
        add_submenu_page(
            'productforge',
            __('Production', 'productforge'),
            __('Production', 'productforge'),
            'edit_pf_templates',
            self::PAGE_SLUG,
            [$this, 'render']
        );
    }

    /**
     * @return array[] Each: order (WC_Order), items: [{item, hash, raster}]
     */
    private function find_design_orders(string $status, int $days): array {
        $orders = wc_get_orders([
            'limit'        => 100,
            'status'       => $status,
            'date_created' => '>' . (time() - $days * DAY_IN_SECONDS),
            'orderby'      => 'date',
            'order'        => 'DESC',
        ]);

        $repo   = new DesignRepository();
        $result = [];
        foreach ($orders as $order) {
            $items = [];
            foreach ($order->get_items() as $item) {
                $hash = $item->get_meta('_pf_design_hash');
                if (!$hash) {
                    continue;
                }
                $design  = $repo->get_by_hash($hash);
                $items[] = [
                    'item'   => $item,
                    'hash'   => $hash,
                    'raster' => $design ? DesignInspector::contains_raster($design['views'] ?? []) : false,
                ];
            }
            if ($items) {
                $result[] = ['order' => $order, 'items' => $items];
            }
        }
        return $result;
    }

    public function render(): void {
        if (!current_user_can('edit_pf_templates')) {
            wp_die(esc_html__('You do not have permission to access this page.', 'productforge'));
        }

        // phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only filters
        $status = sanitize_key($_GET['pf_status'] ?? 'processing');
        $days   = max(1, min(90, (int) ($_GET['pf_days'] ?? 7)));
        // phpcs:enable
        $rows     = $this->find_design_orders($status, $days);
        $statuses = wc_get_order_statuses();
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Production — design exports', 'productforge'); ?></h1>
            <form method="get" style="margin:12px 0;">
                <input type="hidden" name="page" value="<?php echo esc_attr(self::PAGE_SLUG); ?>" />
                <select name="pf_status">
                    <?php foreach ($statuses as $key => $label) :
                        $s = preg_replace('/^wc-/', '', $key); ?>
                        <option value="<?php echo esc_attr($s); ?>" <?php selected($status, $s); ?>><?php echo esc_html($label); ?></option>
                    <?php endforeach; ?>
                </select>
                <label>
                    <?php esc_html_e('Last', 'productforge'); ?>
                    <input type="number" name="pf_days" value="<?php echo esc_attr($days); ?>" min="1" max="90" class="small-text" />
                    <?php esc_html_e('days', 'productforge'); ?>
                </label>
                <button class="button"><?php esc_html_e('Filter', 'productforge'); ?></button>
            </form>

            <?php if (!$rows) : ?>
                <p><?php esc_html_e('No orders with designs found for this filter.', 'productforge'); ?></p>
            <?php else : ?>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                    <input type="hidden" name="action" value="pf_bulk_export" />
                    <?php wp_nonce_field('pf_bulk_export'); ?>
                    <table class="widefat striped">
                        <thead><tr>
                            <th style="width:24px;"><input type="checkbox" onclick="document.querySelectorAll('.pf-bulk-cb').forEach(c=>c.checked=this.checked)" /></th>
                            <th><?php esc_html_e('Order', 'productforge'); ?></th>
                            <th><?php esc_html_e('Product', 'productforge'); ?></th>
                            <th><?php esc_html_e('Notes', 'productforge'); ?></th>
                        </tr></thead>
                        <tbody>
                        <?php foreach ($rows as $row) :
                            $order = $row['order'];
                            foreach ($row['items'] as $entry) : ?>
                            <tr>
                                <td><input class="pf-bulk-cb" type="checkbox" name="entries[]"
                                           value="<?php echo esc_attr($order->get_id() . ':' . $entry['hash']); ?>" checked /></td>
                                <td><a href="<?php echo esc_url($order->get_edit_order_url()); ?>">#<?php echo esc_html($order->get_order_number()); ?></a>
                                    — <?php echo esc_html($order->get_formatted_billing_full_name()); ?></td>
                                <td><?php echo esc_html($entry['item']->get_name()); ?></td>
                                <td><?php echo $entry['raster'] ? '<span style="color:#b32d2e;">⚠ ' . esc_html__('contains raster images', 'productforge') . '</span>' : ''; ?></td>
                            </tr>
                            <?php endforeach;
                        endforeach; ?>
                        </tbody>
                    </table>
                    <p><button class="button button-primary"><?php esc_html_e('Download selection as ZIP', 'productforge'); ?></button></p>
                </form>
            <?php endif; ?>
        </div>
        <?php
    }

    public function handle_bulk_download(): void {
        if (!current_user_can('edit_pf_templates')) {
            wp_die(esc_html__('You do not have permission to access this page.', 'productforge'));
        }
        check_admin_referer('pf_bulk_export');

        $entries = array_map('sanitize_text_field', wp_unslash((array) ($_POST['entries'] ?? [])));
        if (!$entries) {
            wp_safe_redirect(admin_url('admin.php?page=' . self::PAGE_SLUG));
            exit;
        }

        $format  = get_option('pf_export_default_format', 'pdf');
        $manager = new ExportManager();
        $repo    = new ExportRepository();
        $designs = new DesignRepository();

        $zip_path = wp_tempnam('pf-bulk-export.zip');
        $zip      = new \ZipArchive();
        $zip->open($zip_path, \ZipArchive::OVERWRITE);
        $added = 0;

        foreach ($entries as $entry) {
            if (!preg_match('/^(\d+):([a-f0-9]{32})$/', $entry, $m)) {
                continue;
            }
            [, $order_id, $hash] = $m;
            $order_id = (int) $order_id;

            // Reuse an existing done export of the default format, else generate.
            $design    = $designs->get_by_hash($hash);
            $export_id = 0;
            if ($design) {
                foreach ($repo->get_by_design((int) $design['id']) as $export) {
                    if ($export['format'] === $format && $export['status'] === 'done') {
                        $export_id = (int) $export['id'];
                        break;
                    }
                }
            }
            if (!$export_id) {
                $result    = $manager->generate_export($hash, $format, $order_id);
                $export_id = (int) ($result['export_id'] ?? 0);
                if (!$export_id || ($result['status'] ?? '') !== 'done') {
                    continue;
                }
            }

            $order  = wc_get_order($order_id);
            $prefix = 'order-' . ($order ? $order->get_order_number() : $order_id) . '/';
            foreach ($manager->get_download_paths($export_id) as $path) {
                $zip->addFile($path, $prefix . basename($path));
                $added++;
            }
        }
        $zip->close();

        if (!$added) {
            @unlink($zip_path);
            wp_die(esc_html__('No export files could be generated for the selection.', 'productforge'));
        }

        nocache_headers();
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="productforge-exports-' . gmdate('Y-m-d') . '.zip"');
        header('Content-Length: ' . filesize($zip_path));
        header('X-Content-Type-Options: nosniff');
        readfile($zip_path);
        @unlink($zip_path);
        exit;
    }
}
```

- [ ] **Step 2: Wire into `class-admin.php`** — constructor: `$this->export_dashboard = new ExportDashboard(); $this->export_dashboard->init();` (property `private ExportDashboard $export_dashboard;`); in `register_menus()` before `$this->settings_page->register_menu();` add `$this->export_dashboard->register_menu();`.

- [ ] **Step 3: Verify** — `php -l`. Locally: create an order from a saved design (checkout flow, or `wp wc` order create + set item meta `_pf_design_hash`), set it to processing. Open ProductForge → Production: the order row appears; submit → a ZIP downloads containing `order-{nr}/...` files. Confirm with `curl -b <cookiejar> -d ... admin-post.php` if the browser detour is impractical:

```bash
curl -s -b <cookiejar> "http://localhost:8080/wp-admin/admin.php?page=pf-export-dashboard" | grep -c 'Production\|Productie'
```
Expected ≥ 1.

- [ ] **Step 4: Commit** — `feat: production dashboard with bulk ZIP download of order design exports`

---

### Task 11: Design-funnel statistics

**Files:**
- Modify: `includes/Database/class-design-repository.php` (add `funnel_stats`)
- Modify: `includes/Admin/class-settings-page.php` (stats section on the settings page, above System status)

**Interfaces:**
- Consumes: `status='ordered'` written by Task 4 (older data predates it — the page must say so).
- Produces: `DesignRepository::funnel_stats(int $days = 30): array{saved:int, ordered:int, top_products:array<int,array{product_id:int,cnt:int}>}`.

- [ ] **Step 1: Repository method**

```php
    /**
     * Design funnel for the stats panel. "Saved" = design rows created in
     * the window (a row only exists once a customer saves); "ordered" =
     * those that reached checkout (status flip since v1.0.0+checkout-hook).
     */
    public function funnel_stats(int $days = 30): array {
        global $wpdb;
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is a class property
        $saved = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$this->table} WHERE created_at >= DATE_SUB(NOW(), INTERVAL %d DAY)",
            $days
        ));
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $ordered = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$this->table} WHERE status = 'ordered' AND created_at >= DATE_SUB(NOW(), INTERVAL %d DAY)",
            $days
        ));
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $top = $wpdb->get_results($wpdb->prepare(
            "SELECT product_id, COUNT(*) AS cnt FROM {$this->table}
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL %d DAY) AND product_id > 0
             GROUP BY product_id ORDER BY cnt DESC LIMIT 5",
            $days
        ), ARRAY_A) ?: [];

        return ['saved' => $saved, 'ordered' => $ordered, 'top_products' => $top];
    }
```

- [ ] **Step 2: Render on the settings page** — in `SettingsPage::render()`, between the form and the System status heading:

```php
            <hr />
            <h2><?php esc_html_e('Design statistics (last 30 days)', 'productforge'); ?></h2>
            <?php $stats = (new \ProductForge\Database\DesignRepository())->funnel_stats(30); ?>
            <table class="widefat striped" style="max-width:640px;">
                <tbody>
                    <tr><td><?php esc_html_e('Designs saved', 'productforge'); ?></td><td><strong><?php echo esc_html($stats['saved']); ?></strong></td></tr>
                    <tr><td><?php esc_html_e('Designs ordered', 'productforge'); ?></td><td><strong><?php echo esc_html($stats['ordered']); ?></strong></td></tr>
                    <tr><td><?php esc_html_e('Conversion', 'productforge'); ?></td>
                        <td><strong><?php echo esc_html($stats['saved'] > 0 ? round(100 * $stats['ordered'] / $stats['saved']) . '%' : '—'); ?></strong></td></tr>
                    <?php foreach ($stats['top_products'] as $i => $row) :
                        $product = wc_get_product((int) $row['product_id']);
                        if (!$product) { continue; } ?>
                    <tr><td><?php echo esc_html(sprintf(__('Top product #%d', 'productforge'), $i + 1)); ?></td>
                        <td><?php echo esc_html($product->get_name()); ?> (<?php echo esc_html($row['cnt']); ?>)</td></tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <p class="description"><?php esc_html_e('"Ordered" counts designs saved after this feature was installed — older orders are not back-filled.', 'productforge'); ?></p>
```

- [ ] **Step 3: Verify**

```bash
docker compose exec -T wordpress wp eval 'print_r((new ProductForge\Database\DesignRepository())->funnel_stats(30));' --allow-root
curl -s -b <cookiejar> "http://localhost:8080/wp-admin/admin.php?page=pf-settings" | grep -c 'Design statistics\|Designstatistieken'
```
Expected: sensible counts (≥ the test designs created earlier), page grep ≥ 1.

- [ ] **Step 4: Commit** — `feat: design funnel statistics on the settings page`

---

### Task 12: Dutch translations, docs, build

**Files:**
- Modify: `languages/productforge-nl_NL.po` (all new strings from Tasks 1–11)
- Modify: `languages/productforge-nl_NL-*.json` (frontend-designer bundle strings: price line, DPI warning, vector-only messages — the file whose entries include "Ontwerp Opslaan"; add via the python3 one-liner pattern used before)
- Regenerate: `languages/productforge.pot` + `.mo` via WP-CLI in Docker
- Modify: `CLAUDE.md` (Admin Pages table: add Production page; note `pf_daily_maintenance` cron, new options, `pf-designs` account endpoint)
- Modify: `current_status.md` (new features section)

- [ ] **Step 1: Add Dutch msgid/msgstr pairs** to `productforge-nl_NL.po` for every new `__()` string introduced in Tasks 1–11 (grep them: `git diff <base>..HEAD -- includes frontend admin | grep -oE "__\('[^']+'" | sort -u`). Suggested key translations: "Design surcharge:" → "Meerprijs ontwerp:", "My designs" → "Mijn ontwerpen", "Open in designer" → "Openen in designer", "Production" → "Productie", "Download selection as ZIP" → "Selectie downloaden als ZIP", "contains raster images" → "bevat rasterafbeeldingen", "Guest design retention (days)" → "Bewaartermijn gastontwerpen (dagen)", "Design statistics (last 30 days)" → "Designstatistieken (laatste 30 dagen)", "This image is scaled beyond its resolution — the result may look blurry or pixelated. Use a larger image for a sharp result." → "Deze afbeelding wordt groter geschaald dan de resolutie toelaat — het resultaat kan wazig of korrelig worden. Gebruik een grotere afbeelding voor een scherp resultaat.", "Photos are not possible on this product (engraving requires vector artwork)." → "Foto's zijn niet mogelijk bij dit product (graveren vereist vectorafbeeldingen).", "Vector only (engraving) — block raster image uploads" → "Alleen vector (graveren) — blokkeer rasterafbeeldingen".

- [ ] **Step 2: JS translation JSON** — add the frontend-bundle strings ("Design surcharge:", the DPI warning, the vector-only messages) to `languages/productforge-nl_NL-285489eb3d3b003e84da0c4f12693b0c.json` via python3 json edit (same pattern as the settings-page deploy). The admin-builder toggle string goes in the OTHER JSON file (`-b0ac43...`, the template-builder bundle) — verify by checking which file contains "Lettertype" vs admin strings.

- [ ] **Step 3: Compile**

```bash
docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && wp i18n make-pot . languages/productforge.pot --domain=productforge --exclude=node_modules,dist,vendor,freemius,tests --allow-root && wp i18n make-mo languages/productforge-nl_NL.po --allow-root"
```

- [ ] **Step 4: Docs** — CLAUDE.md Admin Pages table: add `Production | pf-export-dashboard`; document `pf_daily_maintenance` cron + self-heal pattern, options `pf_guest_design_retention_days` / `pf_health_email_alerts`, account endpoint `pf-designs` + version-guarded `flush_rewrite_rules`, `global_config.vector_only`, and the checkout status flip (`mark_ordered_by_hash`). current_status.md: new "2026-07-17 feature expansion" summary block.

- [ ] **Step 5: Full verify** — `npm test` (only the 12 pre-existing failures), `npm run build`, `php -l` over all touched PHP, settings page + production page + account tab render in Dutch locally.

- [ ] **Step 6: Commit** — `feat: Dutch translations and docs for the eight-feature expansion`

---

## Self-Review Notes

- **Spec coverage:** F1→T1+T2, F2→T7, F3→T3, F5→T10, F6→T8+T9, F7→T4+T5, F8→T6, F9→T4+T11, translations/docs→T12. German translation (F4) intentionally excluded per user.
- **Type consistency:** `preview_from_counts(array,array): float` used in T1 REST; `mark_ordered_by_hash` (T4) consumed by T5's status filter and T11's stats; `DesignInspector::contains_raster(array $views): bool` (T9) consumed by T10; `Cleanup::HOOK` cleared in Deactivator.
- **Open verification points flagged inside tasks:** exact local variable names in `ElementTab.jsx` ImageProperties and `GlobalSettings.jsx` toggle markup; whether `FileUtils::url_to_local_path` is static; whether `render_export_actions` already loads the design row. Implementers must check these in-file first — the anchors are given.

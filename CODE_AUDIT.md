# Code Audit Report — ProductForge for WooCommerce

**Date:** 2026-03-20
**Scope:** Full codebase (PHP + JS/JSX + CSS)
**Auditors:** 4 parallel Claude agents (security, performance, dead code, frontend)

---

## Executive Summary

| Category | Critical | Medium | Low | Total |
|----------|----------|--------|-----|-------|
| Security | 0 | 6 | 12 | 18 |
| Performance | 6 | 13 | 5 | 24 |
| Dead Code | 0 | 8 | 7 | 15 |
| Frontend | 5 | 9 | 10 | 24 |
| **Total** | **11** | **36** | **34** | **81** |

No critical security vulnerabilities. The plugin correctly avoids the CVE-2024-51919 (RCE) and CVE-2024-51818 (SQLi) classes that affected Fancy Product Designer. The highest-impact findings are frontend correctness bugs (stale closures, missing `['data']` in `toJSON`) and performance N+1 patterns.

---

## Critical Findings (Fix First)

### Frontend: `canvas.toJSON()` missing `['data']` in admin undo/redo (8 call sites)
**File:** `admin/js/template-builder/src/components/Canvas.jsx` lines 186, 221, 228, 231, 703, 717, 772, 786
**Impact:** After any undo/redo, restored objects lose `zoneIndex`, `layerKey`, `elementType` metadata. Zone clamping, permissions, and layer sync break silently.
**Fix:** Change all `canvas.toJSON()` to `canvas.toJSON(['data'])`. CLAUDE.md explicitly requires this.

### Frontend: No type whitelist before `loadFromJSON` in admin undo/redo
**File:** `admin/js/template-builder/src/components/Canvas.jsx` lines 737–739
**Impact:** History snapshots loaded without filtering. Frontend correctly uses `filterFabricJson()`.
**Fix:** Apply `filterFabricJson()` before `loadFromJSON` in undo/redo handlers.

### Frontend: Stale closures in frontend canvas event handlers
**File:** `frontend/js/designer/src/components/DesignerCanvas.jsx` line 416
**Impact:** `object:moving`, `object:scaling`, `text:changed` handlers close over stale `zones`/`permissions`. Zone clamping and snap-to-grid use outdated data after template updates.
**Fix:** Adopt the `ref` pattern used in admin `Canvas.jsx` (`clampToZoneRef`, `snapToGridRef`, etc.).

### Frontend: Snapshots written to wrong view index on fast switching
**File:** `frontend/js/designer/src/components/DesignerCanvas.jsx` lines 339–357
**Impact:** Old event handlers fire with stale `currentViewIndex`, corrupting canvas data for the wrong view.
**Fix:** Use a ref for `currentViewIndex` or read from store state inside handlers.

### Frontend: Race condition on rapid Save (double design creation)
**File:** `frontend/js/designer/src/App.jsx` lines 299–363
**Impact:** Double-click creates two orphaned design records.
**Fix:** Add `if (useDesignerStore.getState().isSaving) return;` at top of `handleSave`.

### Performance: N+1 DB queries in cart/checkout hot paths
**Files:** `Frontend/class-frontend.php`, `Frontend/class-order-integration.php`, `Pricing/class-price-calculator.php`
**Impact:** New `DesignRepository` created per cart item per hook call. 3 designed items = 18+ queries per page load.
**Fix:** Add static request-level cache in `DesignRepository::get_by_hash()` — single change eliminates bulk of N+1 patterns.

### Performance: N+1 INSERTs in price logging
**File:** `Pricing/class-price-calculator.php` lines 162–191
**Impact:** One `$wpdb->insert()` per canvas element per cart recalculation. 20-element design = 20 INSERTs every page load.
**Fix:** Batch into single multi-row INSERT, or move logging out of the recalculation hot path.

---

## Medium Findings

### Security (6)

| ID | File | Issue |
|----|------|-------|
| S1 | `Database/class-design-repository.php:31` | `count()` uses raw SQL without `prepare()` (table name is safe but inconsistent) |
| S2 | `Database/class-template-repository.php:58` | `get_status_counts()` same pattern as S1 |
| S3 | `API/class-rest-designs.php:52` | GET design endpoint uses `__return_true` — no nonce gate before ownership check |
| S4 | `Security/class-capability-checker.php:55` | Session cookie `SameSite=Lax` instead of `Strict` |
| S5 | `API/class-rest-templates.php:19–46` | Template write routes lack explicit nonce verification (relies on WP default cookie auth) |
| S6 | `API/class-rest-designs.php:148` | No size cap on base64 thumbnail before decode — memory exhaustion DoS possible |

### Performance (13)

| ID | File | Issue |
|----|------|-------|
| P1 | `API/class-rest-designs.php:91` | `TemplateRepository` instantiated inline in `create_design()` instead of class property |
| P2 | `API/class-rest-designs.php:153` | Double `get_by_hash()` after upsert_view (redundant round-trip) |
| P3 | `API/class-rest-designs.php:210` | Double `get_by_hash()` after admin_update_status |
| P4 | `API/class-rest-templates.php:101` | Double `get()` in update_template (existence check + response) |
| P5 | `API/class-rest-templates.php:137` | Redundant `get_views()` after `get()` already loaded views |
| P6 | `API/class-rest-exports.php:61` | Fresh `ExportManager` (3 repositories) per REST call |
| P7 | `Export/class-export-manager.php:231` | `wp_upload_dir()` called in loop during batch export |
| P8 | `Database/class-design-repository.php:46` | No caching on `get_by_hash()` (unlike template transient cache) |
| P9 | `Pricing/class-price-calculator.php:64` | DELETE + N INSERTs to price log on every cart recalculation |
| P10 | `Frontend/class-frontend.php:186` | `file_exists()` on JS/CSS assets on every product page |
| P11 | `Admin/class-product-integration.php:34` | Unconditional `$repo->list(100, 1)` on every product edit page |
| P12 | `class-productforge.php:58` | CartSurcharge/ExportManager registered in admin context unnecessarily |
| P13 | `API/class-rest-templates.php:163` | Duplicate view fetch in `list_views` endpoint |

### Frontend (9)

| ID | File | Issue |
|----|------|-------|
| F1 | `DesignerCanvas.jsx:408` | Canvas `dispose()` without explicit `canvas.off()` — fragile cleanup |
| F2 | `DesignerCanvas.jsx:213` | Unaborted SVG fetch; `group.clone().then()` runs on disposed canvas |
| F3 | `Canvas.jsx:346` | Same unguarded `.clone().then()` in admin zone-sync effect |
| F4 | `ElementTab.jsx:196` | `scalePercent` computed at render, never updates on canvas scale |
| F5 | `ElementTab.jsx:205` | `require('fabric').filters` — CJS require in ESM context |
| F6 | `DesignerCanvas.jsx:458` | `mouse:down` handler re-registered on every template change |
| F7 | `App.jsx:296` | `customizationRequired` not available before template loads |
| F8 | `Canvas.jsx:618` | Layers-sync effect uses stale `applyZoneClip`/`clampToZone` |
| F9 | `Canvas.jsx:692` | Brief listener gap when `object:modified` sync effect re-runs |

### Dead Code (8)

| ID | File | Issue |
|----|------|-------|
| D1 | `Security/class-nonce-manager.php` | Entire class is dead — never called anywhere |
| D2 | `Security/class-capability-checker.php:8–22` | 3 methods (`can_manage_settings`, `can_view_exports`, `can_manage_woocommerce`) never called |
| D3 | `Export/class-pdf-exporter.php:70` | `export_single()` never called |
| D4 | `Database/class-template-repository.php:155,162` | Singular `count_views()`/`count_products()` superseded by batch variants |
| D5 | `DesignerCanvas.jsx:3` | Unused imports: `filters`, `Path` from fabric |
| D6 | `svgPathUtils.js:53,74` | `extractClosedPath()` and `pathToBoundingBox()` — deprecated, zero callers |
| D7 | `CLAUDE.md:9` | References non-existent `docs/superpowers/specs/2026-03-18-productforge-plugin-design.md` |
| D8 | `CLAUDE.md:11` | References non-existent `.claude/plans/lazy-finding-panda.md` |

---

## Low Findings (34)

<details>
<summary>Security (12)</summary>

| ID | File | Issue |
|----|------|-------|
| S7 | `Frontend/class-order-integration.php:214` | Nonce in download URL visible in logs/Referrer |
| S8 | `Export/class-svg-exporter.php:91,134,201,233,261` | Float values in SVG attributes without `esc_attr()` |
| S9 | `Export/class-svg-exporter.php:286` | Path data `implode`d without validation (call site escapes) |
| S10 | `Export/class-pdf-exporter.php:110` | TCPDF `Cell()` receives raw text (safe now, fragile) |
| S11 | `Export/class-export-manager.php:231` | Export dirs lack `.htaccess` (only `index.php`) |
| S12 | `Security/class-capability-checker.php:55` | `SameSite=Lax` scope concern |
| S13 | `Security/class-upload-validator.php:78` | `date()` in subdir (theoretical, safe) |
| S14 | `API/class-rest-exports.php:65` | Internal error strings returned to admin callers |
| S15 | `Security/class-upload-validator.php:36` | Rate limit bucket collision for guests without session |
| S16 | `Admin/class-admin.php:106` | Media Library SVG uploads bypass enshrined sanitizer |
| S17 | `API/class-rest-designs.php:104` | Design content accessible to anyone knowing the hash |
| S18 | `Security/class-upload-validator.php:82` | Upload filename is safe (random) but subdir not validated |

</details>

<details>
<summary>Performance (5)</summary>

| ID | File | Issue |
|----|------|-------|
| P14 | `Database/class-template-repository.php:155` | Singular count methods risk N+1 if called in loops |
| P15 | `Frontend/class-frontend.php:200` | `has_shortcode_in_content()` called twice per product page |
| P16 | `Admin/class-admin.php:67` | `.asset.php` include stat on every admin page |
| P17 | `API/class-rest-designs.php:156` | `wp_upload_dir()` + 2x `file_exists()` on every thumbnail save |
| P18 | `Database/class-template-repository.php:310` | `decode_view()` migration runs on every DB read |

</details>

<details>
<summary>Frontend (10)</summary>

| ID | File | Issue |
|----|------|-------|
| F10 | `designerApi.js:54` | Nonce sent unnecessarily on GET requests |
| F11 | `designer.css:395` | `.single_add_to_cart_button.pf-design-required` not scoped inside `.pf-designer` |
| F12 | `builder.css:7` | `.wrap:has(#pf-template-builder-root)` is near-global admin override |
| F13 | `builder.css` | Admin builder missing `all: initial` isolation |
| F14 | `Canvas.jsx:744` | `viewKey` missing from keyboard undo/redo dep array |
| F15 | `ElementTab.jsx:225` | Scale label `<span>` has no explicit color class |
| F16 | `App.jsx (admin):97` | No in-flight guard in admin `handleSave` |
| F17 | `DesignerCanvas.jsx:281` | No origin validation on background image URL |
| F18 | `Canvas.jsx:786` | `removeBackground` also missing `['data']` in toJSON |
| F19 | `designer.css:371` | `.pf-sr-only` class defined but never used |

</details>

<details>
<summary>Dead Code / Stale Refs (7)</summary>

| ID | File | Issue |
|----|------|-------|
| D9 | `designer.css:371` | `.pf-sr-only` utility class never applied |
| D10 | `current_status.md:38` | Says `vite.config.js`, actual is `vite.config.mjs` |
| D11 | `current_status.md:36` | Says `docker/wordpress/Dockerfile`, actual is `docker/Dockerfile` |
| D12 | `current_status.md:51` | Labels `RestExports` as stub (fully implemented) |
| D13 | `current_status.md:64` | Documents deleted `ZoneList.jsx`/`LayerPanel.jsx` |
| D14 | `Database/class-price-repository.php:28` | `get_for_design()` defined but never called (keep for future audit trail) |
| D15 | `class-rest-fonts.php` | Intentional stub — not dead, placeholder for Phase 4 |

</details>

---

## Recommended Fix Order

### Phase 1: Critical Frontend (highest impact, mostly one-liners)
1. Add `['data']` to all `canvas.toJSON()` in admin `Canvas.jsx` (8 sites)
2. Add `filterFabricJson()` before `loadFromJSON` in admin undo/redo
3. Add `if (useDesignerStore.getState().isSaving) return;` guard in frontend `handleSave`
4. Adopt ref pattern for stale closures in frontend `DesignerCanvas.jsx`

### Phase 2: Performance (biggest runtime impact)
5. Static request-level cache in `DesignRepository::get_by_hash()` (fixes ~6 findings)
6. Promote repositories to class properties in `Frontend`, `OrderIntegration`, `RestExports`
7. Batch INSERT in `log_element_prices()` or move logging out of hot path
8. Eliminate double-fetch patterns in REST endpoints (5 one-liner fixes)

### Phase 3: Security Hardening
9. Add thumbnail size cap (5 MB) before base64 decode
10. Add `.htaccess` to export directories
11. Add nonce verification to template write endpoints
12. Sanitize Media Library SVG uploads through enshrined sanitizer

### Phase 4: Cleanup
13. Remove `NonceManager` class (entire file dead)
14. Remove 3 unused `CapabilityChecker` methods
15. Remove deprecated `svgPathUtils` functions and unused fabric imports
16. Fix stale CLAUDE.md and current_status.md references

---

## Detailed Reports

Full findings with code snippets, line references, and suggested fixes:
- `/tmp/audit-security.md` — 18 findings (0 critical, 6 medium, 12 low)
- `/tmp/audit-performance.md` — 24 findings (6 critical, 13 medium, 5 low)
- `/tmp/audit-deadcode.md` — 15 findings (0 critical, 8 medium, 7 low)
- `/tmp/audit-frontend.md` — 24 findings (5 critical, 9 medium, 10 low)

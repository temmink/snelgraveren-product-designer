# Starter Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship a bundled gallery of starter product templates (engrave set, print set, basic shapes — all newly designed) that buyers can import with one click; free tier may import 1 (same `unlimited_templates` limit as manual creation), premium imports all.

**Architecture:** Static content in `templates/starter/` (manifest.json + SVG assets, no DB until import). A server-side importer copies assets to `uploads/pf-template-assets/`, rewrites `asset:` URLs, and creates template + views via the existing repositories. Admin UI: a gallery panel on the Templates list page (prominent when the list is empty) calling a new admin REST endpoint.

**Tech Stack:** PHP (repositories, REST `pf/v1`), hand-authored SVG assets, vanilla PHP admin panel (no React build changes).

## Global Constraints

- Repository-only DB access, `$wpdb->prepare()` everywhere; REST admin endpoints gate on `edit_pf_templates`.
- Free limit MUST be enforced server-side in the importer exactly like `RestTemplates::create_template()` (`ProductForge::has_feature('unlimited_templates')`, count draft+published+archived, `>= 1` → `ProductForge::premium_error('unlimited_templates', ...)`).
- Imported templates land as status `draft`.
- All strings `__()` domain `productforge`; escape all output. Dutch translations in the final task.
- Assets are sanitized SVGs (no scripts/foreignObject; they are our own authored files but MUST still pass through `enshrined\svgSanitize\Sanitizer` at import time — same rule as every SVG that enters uploads).
- Verification: `php -l` + `wp eval` + curl against local Docker (localhost:8080, admin/admin) and the fresh env (pf-fresh project, port 8090) for the free-limit path.
- Conventional commit per task ending with:

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

- CRITICAL discovery step for Task 1: the EXACT zones/layers/permissions JSON schema must be derived from the live builder, not invented. Sources: an existing row (`docker compose exec -T wordpress wp db query "SELECT zones, layers, permissions, background_url, canvas_width, canvas_height FROM wp_pf_template_views WHERE template_id=1" --allow-root`), the builder components (`admin/js/template-builder/src/components/` — zones editor), and `DesignerCanvas.jsx` zone rendering (`renderZones`, `boundary_type`, `svg_url`, `svg_fill_editable`, `behavior`, `allowed_types`). Copy the field names exactly.

---

### Task 1: Starter content — manifest + SVG assets

**Files:**
- Create: `templates/starter/manifest.json`
- Create: `templates/starter/assets/*.svg` (one boundary/background SVG per view that needs one)

**Interfaces:**
- Produces `manifest.json`: array of template definitions:

```json
{
  "id": "engrave-dog-tag-bone",
  "title": "Dog Tag — Bone",
  "description": "Bone-shaped engraving tag with a vector-only text zone.",
  "set": "engrave",
  "global_config": { "vector_only": true, "customization_required": true, "fonts_enabled": true },
  "views": [
    {
      "name": "Front",
      "canvas_width": 800,
      "canvas_height": 600,
      "background_url": "asset:dog-tag-bone.svg",
      "zones": "«EXACT schema derived per Global Constraints — one zone covering the tag surface»",
      "layers": [],
      "permissions": "«copy the default permissions object from the DB row»"
    }
  ]
}
```

- `asset:FILENAME` is the placeholder scheme Task 2 rewrites to a real uploads URL.

**Content list (10 templates, all newly designed — do NOT copy the shop's existing templates):**
- Engrave set (`vector_only: true`): dog tag bone, dog tag round, name plate rectangular (rounded corners), keychain (rounded rect with hanging hole).
- Print set: t-shirt (Front + Back views, shirt silhouette background, rectangular print zone on the chest), mug wrap (single wide view, wrap zone), tote bag.
- Basic shapes: round canvas, rectangle canvas, heart canvas (SVG boundary zone, no background).

**SVG quality bar:** clean single-color silhouettes (#e5e7eb fill, #9ca3af 1.5px stroke), viewBox matching the canvas aspect, no raster data, no text elements, rounded/organic paths (the print set must look professional — smooth bezier shirt/bag silhouettes, not clip-art).

- [ ] Steps: derive the exact zones/permissions schema (see Global Constraints) → author 10+ SVG assets → author manifest.json (valid JSON, every `asset:` reference resolves to a file) → validate with `python3 -m json.tool` + a `wp eval` that loops the manifest and asserts every asset file exists → commit `feat: starter template content (manifest + SVG assets)`.

---

### Task 2: Importer backend + REST

**Files:**
- Create: `includes/Admin/class-starter-templates.php` (namespace `ProductForge\Admin`, class `StarterTemplates`)
- Modify: `includes/class-product-forge.php` (`init_api()`: register the new routes)

**Interfaces:**
- `StarterTemplates::get_catalog(): array` — parsed manifest + `imported` flag per entry (imported = a template exists whose slug equals `starter-{id}`).
- `StarterTemplates::import(string $starter_id): int|\WP_Error` — enforces the free limit (Global Constraints), copies each referenced asset to `uploads/pf-template-assets/` (`wp_mkdir_p`, sanitize SVG via `enshrined\svgSanitize\Sanitizer`, `wp_unique_filename`), rewrites `asset:` URLs, creates the template (`TemplateRepository::create` with slug `starter-{id}`, status draft) and views (`TemplateRepository::create_view`). Returns new template id.
- REST: `GET /pf/v1/starter-templates` → catalog; `POST /pf/v1/starter-templates/(?P<id>[a-z0-9-]+)/import` → `{template_id}` — both `edit_pf_templates` permission.

- [ ] Steps: implement → `php -l` → `wp eval` smoke: import one template, assert template+view rows and asset files exist, assert re-import of same id is refused (already imported), delete test rows/files → on the FRESH env (free tier): import one succeeds, importing a second returns the `pf_premium_required` error → commit `feat: starter template importer with free-tier limit`.

---

### Task 3: Gallery panel on the Templates admin page

**Files:**
- Modify: `includes/Admin/views/template-list.php` (render the panel above the list table; ALWAYS visible when at least one starter is un-imported, extra prominent intro text when the template list is empty)
- Modify: `includes/Admin/class-admin.php` (enqueue a small inline JS snippet on `toplevel_page_productforge` that wires the import buttons to the REST endpoint with `wp_create_nonce('wp_rest')`, disables the button while importing, reloads on success, and shows the server's error message (e.g. the premium upsell) on failure)

**Interfaces:**
- Consumes `StarterTemplates::get_catalog()` (server-side render of the cards: title, description, set badge, Import button; imported entries show a checkmark instead of a button).
- No React, no build step — plain PHP/JS, escaped output, strings via `__()`.

- [ ] Steps: implement → verify in local Docker admin via logged-in curl (cards render; POST import via curl creates a draft template; card flips to imported) → visual check in browser pane → commit `feat: starter template gallery on the Templates page`.

---

### Task 4: i18n, docs, package, end-to-end

**Files:**
- Modify: `languages/productforge-nl_NL.po` (+ recompile `.mo`, regenerate `.pot`), `bin/package.sh` (include `templates/`), `CLAUDE.md` (Admin Pages + starter templates section), `current_status.md`

- [ ] Steps: Dutch translations for every new string (natural Dutch, correct diacritics) → `wp i18n make-pot`/`make-mo` in Docker → package.sh includes `templates/` → build ZIP → fresh env end-to-end: install ZIP, free tier sees gallery, imports 1, second import shows upsell error; dev-license premium (`PF_LICENSE_KEY` constant) imports all; every imported template opens in the builder without errors → commit `feat: starter templates i18n, docs, and packaging`.

## Self-Review Notes

- Free-limit parity is the security-relevant invariant: the importer must never bypass `unlimited_templates` (Task 2 constraint + fresh-env verification in Tasks 2 and 4).
- Slug convention `starter-{id}` doubles as the imported-detection key (no extra DB column).
- SVG sanitization at import keeps the "no unsanitized SVG enters uploads" rule even for our own bundled files.

# Template Export/Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a product template (views/zones/layers + embedded assets) as one self-contained JSON file and import it on another site.

**Architecture:** New REST controller `API\RestTemplateTransfer` with `GET /pf/v1/templates/{id}/export` and `POST /pf/v1/templates/import`. Export embeds referenced upload files as base64 `assets` and rewrites their URLs to `asset:{key}` (starter-templates pattern). Import re-sanitizes every SVG (enshrined Sanitizer), finfo-validates other assets, writes them to `uploads/pf-template-assets/`, rewrites `asset:` refs, and creates the template (draft) + views via `TemplateRepository` (the `duplicate()` loop pattern). Admin UI: Export row action + Import button on the Templates list, wired via inline JS fetch (starter-templates pattern in `class-admin.php`).

**Tech Stack:** PHP (WP REST), PHPUnit-in-Docker (`tests/php/`, real WP), vanilla JS in admin.

## Global Constraints

- All endpoints gated on `edit_pf_templates` (admin_permission pattern).
- Import enforces the free-tier template limit exactly like StarterTemplates (`ProductForge::has_feature('unlimited_templates')`, count includes drafts → `pf_premium_required`).
- Every SVG in the payload is re-sanitized server-side on import (markup via `RestTemplates` zone/layer sanitizer path; asset files via `enshrined\svgSanitize\Sanitizer`, dropped if the class is missing).
- Non-SVG assets validated via `finfo` magic bytes; only image mimes allowed.
- Import payload cap: 20 MB. Format tag `sgpd-template`, version 1.
- Imported template always lands as `status: draft`, slug suffixed to stay unique.
- Fonts do NOT travel; import returns a `warnings` list naming missing font families.

### Task 1: RestTemplateTransfer — export endpoint + asset embedding
Files: Create `includes/API/class-rest-template-transfer.php`; Modify `includes/class-product-forge.php` (register); Test `tests/php/API/TemplateTransferTest.php`.
- [ ] Failing test: export of a seeded template returns format/version/template/views; an uploads URL in a view is rewritten to `asset:...` and its base64 data present in `assets`.
- [ ] Implement: collect URL fields (view `background_url`, zone `svg_url`, layer `src`) that start with the uploads baseurl; read file from basedir, base64 embed, rewrite.
- [ ] Test green; commit.

### Task 2: import endpoint
Same files.
- [ ] Failing test: importing a Task-1 export creates a draft template with equal view/zone/layer counts; `asset:` refs rewritten to fresh `uploads/pf-template-assets/` URLs; SVG asset re-sanitized (script tag stripped); oversized payload → 400; free-tier limit → `pf_premium_required` (premium filter off).
- [ ] Implement per Global Constraints; unknown font families collected into `warnings`.
- [ ] Test green; commit.

### Task 3: admin UI
Files: Modify `includes/Admin/views/template-list.php`, `includes/Admin/class-admin.php`.
- [ ] Export row action per template → JS fetch of export endpoint (X-WP-Nonce) → blob download `template-{slug}.json`.
- [ ] "Import Template" button beside the page title → hidden file input → JS fetch POST → reload list; alert on error/warnings.
- [ ] Smoke test in dev (wp eval + browser), commit.

### Task 4: dev round-trip verification
- [ ] `wp eval`: export template 17 → import → compare counts; open imported template in builder (user verifies visually).

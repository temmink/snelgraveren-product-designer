# Handoff

_Last updated: 2026-09-08._

## Where things stand

- **1.12.4 is built and committed (`b9f9ba3`), NOT yet released anywhere.** Two designer fixes
  found while investigating a Freemius bug report from le-denhelder.nl (runs the wp.org 1.7.8):
  one working "Customize Product" button on mobile in modal mode (the PHP button was dead, React
  rendered a second one), and no `/pricing/preview` 404 per canvas change in the free build.
  The reported bug itself ("can't make the URL" on save-to-cart, Android Chrome) could NOT be
  reproduced — the full guest flow on their site works; a screenshot has been requested.
  - `snelgraveren-product-designer-1.12.4.zip` (premium) and `…-free-1.12.4.zip` are in the
    project dir; the free zip passed the strip checks (0 proof/Pricing paths).
  - **wp.org:** `.svn-wporg/` is staged (dry-run, trunk + tags/1.12.4). Martin runs
    `bash bin/wporg-release.sh --skip-build` in Terminal.app (needs tty + SVN password).
  - **Freemius: DONE** — deployment **150982**, status Released, non-incremental (the Release
    dialog defaults "incremental" to ON; unticked), 2026-09-08. Driven through Martin's logged-in
    Chrome tab via the chrome-devtools MCP (upload_file on "Add New Version"). Before this,
    Freemius sat on 1.7.8 since 2026-08-20.
  - **snelgraveren.nl** still runs 1.12.3; the same premium zip can go up via plugin-install
    upload when convenient (nothing in 1.12.4 is urgent for the live shop).
- **Live site runs 1.12.3** (snelgraveren.nl), uploaded + installed + LiteSpeed-purged by Martin
  himself on 2026-09-04 (the chrome-devtools MCP could not connect and the persistent MCP Chrome
  profile's wp-admin session had expired). Verified as guest: readme Stable tag 1.12.3,
  `dist/admin-template-builder.js` and `dist/frontend-designer.js` md5-identical to local dist,
  live builder bundle contains "PT Serif Caption". `…-1.12.3.zip` in the project dir is the live
  build (rollback anchor: `…-1.12.2.zip`).
- **1.12.2 (Layers tab)** was live from 2026-09-02 until 1.12.3 replaced it — see "What shipped
  in 1.12.2" below.
- **1.12.1 shipped earlier the same day** (Designs page: per-row SVG/LightBurn download +
  design link) — see "What shipped in 1.12.1" below; live-verified end-to-end before 1.12.2
  replaced it.
- **All 30 live designs predate 1.11.0 and have no `export_lbrn` data** — the LightBurn download
  correctly reports "reopen and re-save once" on those rows until each design is re-saved.
- **`master` is current, NOT pushed** since `b7299ef` (1.11.4). Local commits on top: the 1.12.0
  font-groups cycle, `chore(release): 1.12.1` (`2daa3f1`), plus this docs commit. Push when
  convenient.
- **wordpress.org still has 1.7.8** (r3657251). Nothing in 1.12.1 changes the premium strip
  lists: the new download handler lives in the free-build `class-designs-page.php` but hides its
  links behind the `svg_export` gate, and `generate_export()` refuses premium formats without
  `PremiumExports` anyway.
- **Freemius Deployment**: no 1.11.x/1.12.x pushed to Freemius — live updates happen via direct
  ZIP upload only (dev-licence site, Freemius pushes nothing).

## What shipped in 1.12.3 (2026-09-04)

**LightBurn import: Rect/Ellipse shapes** — Martin's Leisteen template imported with "Skipped an
unreadable shape" ×2. LightBurn stores a `Rect` as `W`/`H`/`Cr` and an `Ellipse` as `Rx`/`Ry`,
centred on the XForm, with NO VertList; the parser treated them as Path and dropped them, so the
200 mm slate outline and the 160 mm rule vanished and the design imported at 160 mm.
`lbrnParser.js#rectVertPrim/ellipseVertPrim` synthesise the outline in LightBurn's own vertex
format (rounded corners/ellipses as beziers) so bbox/transform/group handling is untouched. Tests:
synthetic Rect/rounded Rect/Ellipse + the real file (`tests/js/fixtures/leisteen_template.lbrn2`).
The Ellipse attribute names `Rx`/`Ry` are from memory of LightBurn files, not from a sample —
if an ellipse still imports as unreadable, check the attribute names first.

**"PT Serif Caption" added to the built-in Google Fonts** — a separate family from "PT Serif".
Four lists must agree and were all edited: builder `utils/fonts.js`, `RestFonts::ALLOWED_GOOGLE_FONTS`
(font-file proxy whitelist), `RestFontsAdmin` reserved names, `RestTemplateTransfer::BUILTIN_FONTS`.
Google serves only weight 400 for it, so bold renders as browser-synthesised bold (the import
never carried the Qt weight anyway). Not verified with `php -l` (Docker was down, no local php);
the edits are single strings inside existing arrays.

Pre-existing, unrelated: `tests/js/components/AddTab.test.js` and `Sidebar.test.js` fail (12
tests) on master before and after 1.12.3.

## What shipped in 1.12.2 (2026-09-02)

**Layers tab in the customer designer** — Martin's report: with overlapping elements the canvas
selects the wrong one. Cause: Fabric hit-tests on bounding box, so transparent clipart corners /
empty text-box space on top steal the click. Chosen fix (out of four options offered): a fourth
sidebar tab listing every selectable element, topmost first (`tabs/LayersTab.jsx`); click selects
via `canvas.setActiveObject()` (fires the selection events, so store + Element tab follow).
Locked template art, zones, placeholders and background stay out of the list. The auto-switch to
the Element tab deliberately skips the Layers tab. Verified on the wolfje template in the
`productdesigner` stack. The NOT-chosen options remain candidates if canvas clicking itself
should improve: per-pixel target find for images/SVG, click-through cycling, builder zones
selectable on border only.

## What shipped in 1.12.1 (2026-09-02)

Two Designs-adminpage improvements, both requested by Martin:

- **Click the design, not the product**: the product name and thumbnail on each row now open the
  design itself (the existing reopen link, `?pf_design=HASH`, new tab); the WooCommerce product
  edit screen moved behind a small "(edit product)" link. Before, the name linked to
  `get_edit_post_link()` and there was no way to *view* a design from the list.
- **Download SVG / LightBurn per design, order or not** (`admin_post_sgpd_download_design` in
  `Admin\DesignsPage`): reuses `ExportManager::generate_export()` with `order_id 0` — the
  Production dashboard only reaches ordered designs, this reaches every draft. Always
  regenerates (a cached export of a draft goes stale on the next edit). Single view streams the
  file directly; multi-view zips. Failures land as row messages (`download_nodata` with
  re-save instructions / `download_failed`). Links render only when the Pro `svg_export` gate
  passes. `back_url()` now reads `_wp_http_referer` from `$_REQUEST` (the download links are GET
  and carry it as a query arg).

Testing route that worked: seed a design via `wp eval` (`DesignRepository::create()` IGNORES a
passed `design_hash` — read the real one back), log in with `wp_generate_auth_cookie` cookies for
curl, and mind that root-owned files from CLI tests block www-data writes in `pf-exports/`
(chown afterwards). Verified on BOTH stacks; the `productdesigner` live-copy is the one that
counts (`docker compose -p productdesigner up -d`, same :8080).

## Open — needs Martin, not code

1. **Tick font groups on the templates that should use them** (builder → Settings → Fonts) — the
   groups ("Display", "Handwriting") exist on live since 1.12.0.
2. **Re-save old designs that need a LightBurn download** — open via the row's design link, save
   once; the browser then writes `export_lbrn` (and the other export columns) fresh.
3. **Guest-design retention still at 30 days** — Martin asked about 14; setting exists under
   Product Designer → Settings.
4. **Five live templates still have the claiming `Imported` zone**: tpl 22 acacia (2630), tpl 7
   leeuwtje (1979), tpl 6 olifantje (1988), tpl 4 wolfje (1991), tpl 5 vosje (2007).
5. **Nearly every design zone is `behavior: clip`, not `restrict`** — a decision, not a bug.
6. **Modal display mode still off on all designer products** (`_pf_display_mode`).
7. **wordpress-mcp token is expired** (403 again this session) — renew it if Claude should reach
   the live site via MCP; the logged-in-Chrome route (chrome-devtools MCP) covered it this time.

## Open — code, deliberately deferred

- **Proof flow browser route still unverified end-to-end** (send → logged-out open → request
  change → resend → approve → checkout). PHPUnit-green only.
- **12 pre-existing jest failures** in `AddTab.test.js` / `Sidebar.test.js` — predate 1.11.x.
- **lbrn writer limits** (wave/circle presets, rasters, open 2-point paths) — explicit, reported
  in `skipped`; see the 1.11 handoff history in git if needed.
- **Template transfer & font groups**: exported templates carry `allowed_font_groups` ids that
  mean nothing on another site — harmless (resolution skips unknown ids silently), but a future
  import warning à la the unknown-font warning would be friendlier.

## Environment notes

- **Two Docker stacks, one compose file, different databases.** Repo `docker compose up` =
  project `productforge` (own volume, admin `pf-dev-test` / `pf-dev-test-2026`, dev
  `SGPD_LICENSE_KEY` in wp-config). Live-copy = `docker compose -p productdesigner up -d`
  (admin `martin.temmink`, cookie-login via `wp eval` if the password is needed-but-unknown).
  Both serve :8080 and both claim :3306, so never together — `docker ps` first. Details in
  CLAUDE.md → Development Environment.
- The productforge stack's system status complains about non-writable `uploads/pf-*` dirs —
  container permission quirk of that fresh volume, unrelated to code.

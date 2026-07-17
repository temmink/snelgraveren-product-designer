# WordPress.org Submission — Plugin Check triage (2026-07-17)

Official Plugin Check run against the Freemius **free build** (1.0.2) on a fresh WP 7.0.1.
Raw totals: 575 errors / 1539 warnings — **but 525 errors + 1239 warnings live in the bundled
Freemius SDK** (accepted on wp.org as-is; not ours to fix). Our surface: **50 errors, ~300
warnings** in `includes/` + root + `blocks/`.

## Blockers to fix before submission (our code)

1. **`plugin_updater_detected` (2×, productforge.php)** — the `site_transient_update_plugins`
   update-blocker filter. wp.org forbids updater-tampering code. Once we own the slug the
   filter is pointless anyway → remove it (or strip it from the wp.org build only).
2. **`PluginDirectoryWrite` (1×, class-frontend.php)** — the hashed-JS cache-busting copy
   writes into the plugin dir; wp.org disallows writing inside the plugin directory.
   Best fix (better engineering anyway): write hashed copies to `uploads/pf-cache/` instead.
   Falls back gracefully today, but reviewers will flag it.
3. **`unlink()` → `wp_delete_file()` (17×)**, **`rename()` → `WP_Filesystem::move()` (1×)**,
   **`is_writable()`/`readfile()` WP_Filesystem alternatives (2×)** — mechanical replacements
   in Cleanup, Frontend, ExportManager, ExportDashboard.
4. **`ExceptionNotEscaped` (14×, class-export-manager.php)** — RuntimeException messages with
   `$i` interpolation; wrap in `esc_html()` or use sprintf'd constants.
5. **Heredoc not allowed (3×)** — inline JS heredocs (class-admin.php starter gallery,
   freemius-init area, class-frontend viewport script) → concatenated strings or
   `wp_print_inline_script_tag`.
6. **I18n `MissingTranslatorsComment` (~10×)** — add `/* translators: */` comments above
   every `__()` containing placeholders.
7. **`missing_direct_file_access_protection` (1×)** — likely `blocks/designer/editor.asset.php`
   (no ABSPATH guard).
8. **`date()` → `gmdate()` (1×)** and remaining `MissingUnslash`/`InputNotSanitized` warnings
   (11×, e.g. `$_GET['pf_design']` in class-frontend.php:159) — quick mechanical fixes.
9. **Plugin URI example.com** — ALREADY fixed in git (points to snelgraveren.nl/productforge);
   the scanned build predates the commit.

## Acceptable / justify with phpcs:ignore (no code change needed)

- `DirectDatabaseQuery` / `PreparedSQL.InterpolatedNotPrepared` warnings in `includes/Database/`
  — custom-table architecture; table names are class properties built from `$wpdb->prefix`.
  Add targeted `phpcs:ignore` comments with justification (most already have them).
- `PrefixAllGlobals` warnings — our code is namespaced (`ProductForge\`); remaining hits are
  mostly in view templates' local vars. Cosmetic.
- Freemius SDK findings — bundled library, accepted by wp.org.
- `load_plugin_textdomain` deprecation warning — harmless; can drop once on wp.org.

## Submission steps (after fixes)

1. Re-run: `wp plugin check productforge` on the free build → our-code errors should be 0.
2. `readme.txt` is ready (exists, correct headers). Add screenshots (assets/ SVN dir).
3. Submit the **free build zip** at wordpress.org/plugins/developers/add/ (slug `productforge`
   is free — verified 2026-07-17).
4. After approval: SVN checkout, commit free build to `trunk/` + tag, screenshots to `assets/`.
5. Freemius: keep `is_org_compliant: true`; wp.org users get the Pro upsell in-dashboard.

Raw report: scratchpad `pcp-report.csv` (regenerate anytime: install plugin-check +
`wp plugin check productforge --format=csv`).

## UPDATE 2026-07-17 (submission form findings) — NEW BLOCKERS

Read directly from wordpress.org/plugins/developers/add/ before submitting:

1. **Max upload 10 MB — our free build is 16 MB.** Slim the ZIP: prune unused TCPDF
   fonts in vendor/ (biggest win), review dist/ bundles. Combine with blocker 2:
   premium-only code leaving the free build also shrinks it.
2. **Trialware guideline (5/6): runtime license gating is NOT allowed.** Our free build
   ships ALL premium code locked behind is_premium() — wp.org requires premium
   functionality to be physically ABSENT from the free version. Fix: annotate
   premium-only code with Freemius `__premium_only` / `@fs_premium_only` markers
   (PdfExporter, SvgExporter, auto-export, pricing engine, clipart/font admin, etc.)
   so the Freemius deployment processor strips it from the free build; ensure the
   free code degrades gracefully when those files are absent.
3. **Contributors fixed:** wp.org account is `snelgraveren` (was `martintemmink` in
   readme.txt — corrected).

Sequence: compliance sprint → new version → Freemius deploy → download free build →
verify <10 MB + Plugin Check clean + premium code absent → submit.

## UPDATE (compliance sprint uitgevoerd, v1.0.4)

Beide blockers opgelost:

1. **Trialware:** premium code fysiek gesplitst in eigen bestanden, gelist in de
   `@fs_premium_only` header-annotatie in `productforge.php`: `PremiumExports`
   (PDF/SVG-generatie + auto-export hook), `includes/Pricing/`, `RestPricing`,
   `RestPalettes` (geheel premium), `RestFontsAdmin`/`RestClipartAdmin`
   (mutaties; publieke GET's blijven free), en `/vendor/tecnickcom/` (TCPDF).
   Alle call sites hebben `class_exists()`-guards; settings-pagina en Production-
   dashboard vallen terug op PNG-only. Legacy `PdfExporter`/`SvgExporter`/
   `PngExporter` + `intervention/image` verwijderd (dode code).
2. **Quota's (guideline 5):** de 1-template- en 1-view-tellers zijn verwijderd
   (besluit Martin 2026-07-17, "hybride aanpak"): geen server-side blocks meer;
   multi-view e.d. blijven Pro via de bestaande client-side isPremium-gating
   (Pro-badge op "Add view"). `unlimited_templates`/`multi_view` feature-keys
   bestaan niet meer.
3. **10 MB:** `bin/package.sh` prunt TCPDF-fonts tot de core-set (24 MB → 56 KB).
   Premium-zip: 2.0 MB. Free build (zonder TCPDF): ~1 MB.
4. **Bonus-bugfix:** infinite render loop (React #185) die de designer crashte op
   templates zonder permissions/zones-config — fataal voor ELKE free install
   omdat het publieke template-endpoint `permissions` stript. Gefixt met stabiele
   fallback-referenties in `DesignerCanvas.jsx`.

Geverifieerd op pf-fresh (poort 8090) met een gesimuleerde free build (zip minus
de @fs_premium_only bestanden — zelfde als de Freemius-processor doet):
Plugin Check **0 errors eigen code**, boot/REST/designer/save-flow werken,
pricing-preview degradeert stil, PDF geeft nette Pro-error, auto-export hook
niet geregistreerd, 2e starter-import zonder block.

Nog te doen: 1.0.4 uploaden naar Freemius → echte free build downloaden →
zelfde verificatie herhalen → indienen bij wordpress.org.

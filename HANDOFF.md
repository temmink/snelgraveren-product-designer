# Handoff — wordpress.org release

_Last updated: 2026-08-20._

## Status

- **Approved on wordpress.org** 2026-08-20 (review ID P0TDX342667HGN, after 4 rounds). Slug `snelgraveren-product-designer`, SVN `https://plugins.svn.wordpress.org/snelgraveren-product-designer`, wp.org user `snelgraveren`. Updates after approval are **not** re-reviewed — commits to SVN go live within minutes (automated scanners + spot checks continue).
- **Nothing has been committed to SVN yet.** The public page is invisible until the first upload.
- **Current version: 1.7.8** (bumped in `snelgraveren-product-designer.php` header + `SGPD_VERSION`, and `readme.txt` Stable tag + changelog). The 1.7.7 ZIPs in the project dir are stale — rebuild.

## Done this session

1. `bin/wporg-release.sh` — builds premium + free ZIPs, sanity-checks the free ZIP (no premium paths, no gettext files, gatekeeper stripped, `is_premium => false`), syncs into SVN `trunk/`, copies `wporg-assets/` icon/banner/screenshots into SVN `assets/`, tags `tags/<version>/`, commits after a y/N prompt. `--dry-run` stages without committing. Checkout lives in `.svn-wporg/` (git-ignored).
2. Listing assets: `wporg-assets/screenshot-1..4.png` (designer with "BENITO" tag — Martin's retina capture; template builder; starter gallery; production dashboard) + `== Screenshots ==` section in `readme.txt`.
3. Free build 1.7.7 verified on a **clean** Docker install (WP 7.1, WC 11.0.1, installed from the free ZIP, bind-mounted dev copy inactive): activation (11 tables, empty debug.log), starter import, builder in free mode (Pro labels on Add View / LightBurn, no Permissions/Pricing tabs), product tab, frontend designer, save & add to cart, block cart thumbnail, settings.
4. **Bug found & fixed → 1.7.8:** starter templates with SVG boundaries imported misaligned (boundary at top-left, background oversized). Cause: manifest assumed boundary SVG maps 1:1 onto the canvas, but renderers place the boundary group's bounding box at `zone.x/y`. Fix is data-only: `templates/starter/manifest.json` zones now use the shape bbox for `x/y/width/height` + `svg_intrinsic_*`; all `templates/starter/assets/*.svg` got explicit `width`/`height`. Renderer untouched (live-site boundaries depend on the bbox convention). Verified in Docker builder + frontend.
5. `CLAUDE.md` updated (wp.org release bullet, SVG-boundary convention, removed stale "1 template free limit" note).

## Git status

Everything is committed on `master` (not pushed):

- `b2df20f` — release 1.7.8 (`readme.txt`, `snelgraveren-product-designer.php`, `templates/starter/manifest.json` + the 10 starter SVGs).
- `11c763f` — `bin/wporg-release.sh`, `wporg-assets/` (icon 128/256, banner 772/1544, screenshot-1..4), `CLAUDE.md`, this file, and `.gitignore` (ignores `.svn-wporg/`, un-ignores `wporg-assets/*.png` so the listing assets no longer need `git add -f`).

## Next steps (in order)

```bash
# 0. optional but recommended: Plugin Check on the free ZIP once built
# 1. release to wordpress.org (prompts for SVN user/password on first commit)
brew install svn                      # if missing
bash bin/wporg-release.sh --dry-run   # build + stage + show svn status
bash bin/wporg-release.sh             # same, then commit "Release 1.7.8"
```

Then: upload `snelgraveren-product-designer-1.7.8.zip` (premium) to Freemius → Deployment; deploy the same ZIP to snelgraveren.nl (Plugins → Upload → replace) and LiteSpeed Purge All; check https://wordpress.org/plugins/snelgraveren-product-designer/ renders banner/icon/screenshots; whitelist plugins@wordpress.org; validate readme at wordpress.org/plugins/developers/readme-validator/.

## Gotchas learned

- `docker/setup.sh` is stale (slug `product-designer`, WP image is 6.7 while current WooCommerce needs 6.9+ → run `wp core update` after install). Fresh WooCommerce enables Coming Soon mode: `wp option update woocommerce_coming_soon no`.
- To retest starters on Docker after changing manifest/assets: copy `templates/starter/` into the installed plugin dir, delete rows in `wp_pf_template_views`/`wp_pf_templates`, remove `uploads/pf-template-assets/`, re-import. `wp db query` only runs the first `;`-separated statement.
- SVN tags are immutable: never re-tag, bump the version instead.

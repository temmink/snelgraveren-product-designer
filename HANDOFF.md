# Handoff — wordpress.org release

_Last updated: 2026-08-20._

## Status

- **Approved on wordpress.org** 2026-08-20 (review ID P0TDX342667HGN, after 4 rounds). Slug `snelgraveren-product-designer`, SVN `https://plugins.svn.wordpress.org/snelgraveren-product-designer`, wp.org user `snelgraveren`. Updates after approval are **not** re-reviewed — commits to SVN go live within minutes (automated scanners + spot checks continue).
- **Released 2026-08-20: r3657251** — `trunk/` + `tags/1.7.8/` + `assets/` (2 banners, 2 icons, 4 screenshots) are live. Listing returns HTTP 200 and the wp.org API reports 1.7.8.
- **Current version: 1.7.8** (header + `SGPD_VERSION` + `readme.txt` Stable tag/changelog all agree; the release script enforces this in pre-flight).

## Done this session

1. `bin/wporg-release.sh` — builds premium + free ZIPs, sanity-checks the free ZIP (no premium paths, no gettext files, gatekeeper stripped, `is_premium => false`), syncs into SVN `trunk/`, copies `wporg-assets/` icon/banner/screenshots into SVN `assets/`, tags `tags/<version>/`, commits after a y/N prompt. `--dry-run` stages without committing. Checkout lives in `.svn-wporg/` (git-ignored).
2. Listing assets: `wporg-assets/screenshot-1..4.png` (designer with "BENITO" tag — Martin's retina capture; template builder; starter gallery; production dashboard) + `== Screenshots ==` section in `readme.txt`.
3. Free build 1.7.7 verified on a **clean** Docker install (WP 7.1, WC 11.0.1, installed from the free ZIP, bind-mounted dev copy inactive): activation (11 tables, empty debug.log), starter import, builder in free mode (Pro labels on Add View / LightBurn, no Permissions/Pricing tabs), product tab, frontend designer, save & add to cart, block cart thumbnail, settings.
4. **Bug found & fixed → 1.7.8:** starter templates with SVG boundaries imported misaligned (boundary at top-left, background oversized). Cause: manifest assumed boundary SVG maps 1:1 onto the canvas, but renderers place the boundary group's bounding box at `zone.x/y`. Fix is data-only: `templates/starter/manifest.json` zones now use the shape bbox for `x/y/width/height` + `svg_intrinsic_*`; all `templates/starter/assets/*.svg` got explicit `width`/`height`. Renderer untouched (live-site boundaries depend on the bbox convention). Verified in Docker builder + frontend.
5. `CLAUDE.md` updated (wp.org release bullet, SVG-boundary convention, removed stale "1 template free limit" note).

## Git status

Everything is committed on `master` (not pushed):

- `b2df20f` — release 1.7.8 (`readme.txt`, plugin header, `templates/starter/manifest.json` + the 10 starter SVGs).
- `11c763f` — `bin/wporg-release.sh`, `wporg-assets/` (icon 128/256, banner 772/1544, screenshot-1..4), `CLAUDE.md`, this file, `.gitignore`.
- `6861158`, `381aab6`, `59e7570`, `7b7af2b`, `4fe4c4c` — release-script fixes found by actually running it: remote-based tag guard, no `svn status | head` under `pipefail`, no empty-array expansion on bash 3.2, default `--username snelgraveren` + `svn cleanup`, and a single-run lock. The commit path is covered end to end against a throwaway `file://` repo.

## Next steps (in order)

1. ~~Upload the premium ZIP to Freemius → Deployment.~~ **Done 2026-08-20**: deployment ID 146191, status Released, SDK 2.13.4, rollout to all websites, incremental off (same as 1.7.7 and 1.7.6).
2. Deploy `snelgraveren-product-designer-1.7.8.zip` to snelgraveren.nl (Plugins → Upload → replace), then LiteSpeed Purge All. Freemius does not push updates to the live site — it runs on the dev licence, so this stays a manual upload.
3. Check https://wordpress.org/plugins/snelgraveren-product-designer/ renders banner, icon and the 4 screenshots.
4. Whitelist plugins@wordpress.org; validate the readme at wordpress.org/plugins/developers/readme-validator/.

Releasing a later version is one command (it rebuilds, re-checks and re-tags):

```bash
bash bin/wporg-release.sh --dry-run   # build + stage + show svn status
bash bin/wporg-release.sh             # same, then prompts before committing
```

Bump the version in `snelgraveren-product-designer.php` (header + `SGPD_VERSION`) and
`readme.txt` (Stable tag + changelog) first — pre-flight refuses to run if they disagree,
and the remote guard refuses to re-tag a released version.

## Gotchas learned

- `docker/setup.sh` is stale (slug `product-designer`, WP image is 6.7 while current WooCommerce needs 6.9+ → run `wp core update` after install). Fresh WooCommerce enables Coming Soon mode: `wp option update woocommerce_coming_soon no`.
- To retest starters on Docker after changing manifest/assets: copy `templates/starter/` into the installed plugin dir, delete rows in `wp_pf_template_views`/`wp_pf_templates`, remove `uploads/pf-template-assets/`, re-import. `wp db query` only runs the first `;`-separated statement.
- SVN tags are immutable: never re-tag, bump the version instead.
- Run the release script in a real terminal, once. It needs a tty (confirmation + SVN password) and now refuses to start twice (mkdir lock on `.svn-wporg.lock`) — two concurrent runs interleave their output and credential prompts, which is unreadable and finishes neither.
- SVN login = wp.org username `snelgraveren` (the script passes `--username`, or svn offers the macOS account name) + the **separate** SVN password from profiles.wordpress.org → Account & Security.
- macOS ships bash 3.2: expanding an empty array under `set -u` aborts the script, and `cmd | head` SIGPIPEs the producer under `set -o pipefail`. Both bit this script; keep the release path free of arrays and of piping long output into `head`.

# wp.org listing assets

These images are for the WordPress.org plugin listing (and the Freemius product
icon). They are **not** shipped in the plugin ZIP — `bin/package.sh` does not
include this folder (it only bundles `assets/`, not `wporg-assets/`).

## Files
- `icon-256x256.png` / `icon-128x128.png` — plugin icon (the round tile in
  search results and the plugin header).
- `banner-772x250.png` / `banner-1544x500.png` — plugin page banner (standard +
  retina).

Generated from the Snelgraveren logo (`snelgraveren_logo_groen_laser_symbol.png`,
brand green `#87c148`).

## How to publish them
**wp.org:** commit these to the SVN `assets/` directory of the plugin (the one
next to `trunk/`, NOT inside `trunk/`), keeping the exact filenames.

**Freemius product icon:** upload `icon-256x256.png` at Freemius → your product →
Settings → Information → Upload (replaces the blue placeholder). Requires 300×300
max / 200 KB — the 256×256 icon fits.

## Screenshots (still to add)
wp.org also shows screenshots (`screenshot-1.png`, `screenshot-2.png`, …) placed
in the same SVN `assets/` folder, described in `readme.txt` under
`== Screenshots ==`. Capture: the frontend designer, the template builder, and
the production/export dashboard.

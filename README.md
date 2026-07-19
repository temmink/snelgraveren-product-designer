# Snelgraveren Product Designer for WooCommerce

A WooCommerce plugin that lets customers personalize products with text, photos, SVG artwork, and clip art in a fast drag-and-drop designer — built for engraving and print shops. GPL-2.0-or-later.

This repository is the **public, canonical source** for the plugin distributed on WordPress.org and via Freemius. It contains the human-readable source for every compiled asset shipped in the plugin.

## Source → build mapping

The distributed plugin ships minified bundles in `dist/` (git-ignored build output). Their un-minified sources live here:

| Shipped bundle (`dist/`) | Source |
|--------------------------|--------|
| `frontend-designer.js` / `.css` | `frontend/js/designer/src/` (React 18 + Fabric.js) |
| `admin-template-builder.js` / `.css` | `admin/js/template-builder/src/` |
| `admin-design-templates.js` | `admin/js/design-templates/src/` |
| `admin-clipart.js` / `.css` | `admin/js/clipart/src/` |

The Gutenberg block script (`blocks/designer/editor.js`) is hand-written, un-minified, and ships as-is (no build step).

## Build tools

- **JavaScript:** [Vite](https://vitejs.dev/) — see `vite.config.mjs` (four entry points).
- **PHP dependencies:** [Composer](https://getcomposer.org/) (TCPDF for PDF export, `enshrined/svg-sanitize` for SVG sanitization).

## Building from source

```bash
npm install
npm run build          # compiles frontend + admin bundles into dist/
composer install --no-dev --optimize-autoloader   # PHP dependencies into vendor/
bash bin/package.sh    # produces the distributable plugin ZIP
```

`bin/package.sh` assembles the plugin folder (main file, `includes/`, `dist/`, `vendor/`, `blocks/`, `assets/`, `languages/`, the Freemius SDK) into a ZIP. `bin/free-build.sh` derives the WordPress.org free build from it (strips the `@fs_premium_only` files and the Freemius gatekeeper).

## Architecture

- Pure custom database tables (`wp_pf_*`), no custom post types.
- PHP: namespace `ProductForge\` (PSR-4 via a custom autoloader), REST namespace `pf/v1`.
- All prices calculated server-side; every upload MIME-validated; every SVG sanitized.
- Premium features (PDF/SVG export, auto-export, pricing engine, clip art / font / palette management) are marked `@fs_premium_only` and are physically absent from the free build.

## License

GPL-2.0-or-later. See the plugin's `readme.txt` for the user-facing changelog and the External Services disclosure.

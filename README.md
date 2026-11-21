# Snelgraveren Product Designer for WooCommerce — source

This repository holds the **human-readable source and build tooling** for the
free plugin published on WordPress.org:
https://wordpress.org/plugins/snelgraveren-product-designer/

It exists so that the compiled JavaScript shipped in the plugin's `dist/`
folder can be read, audited and rebuilt, as the WordPress.org plugin
guidelines require. It is a snapshot of each released version, not a
development repository: one commit per release, no pull requests.

Licence: GPL-2.0-or-later (see `LICENSE`).

## Source → build mapping

| Shipped bundle (`dist/`) | Source |
|--------------------------|--------|
| `frontend-designer.js` | `frontend/js/designer/src/` (React 18 + Fabric.js) |
| `frontend-designer.css` | `frontend/js/designer/src/designer.css`, copied as-is |
| `admin-template-builder.js` | `admin/js/template-builder/src/` |
| `admin-design-templates.js` | `admin/js/design-templates/src/` |
| `admin-clipart.js` | `admin/js/clipart/src/` |
| `admin-fonts.js` | `admin/js/fonts/src/` |

The admin screens have no separate stylesheet: their CSS is bundled into the
`.js` file and injected at runtime. `shared/js/` holds the modules both the
template builder and the customer designer import. The Gutenberg block script (`blocks/designer/editor.js`) is
hand-written, un-minified, and ships as-is.

## Building

```bash
npm install
npm run build                                     # compiles the bundles into dist/
composer install --no-dev --optimize-autoloader   # PHP dependencies into vendor/
```

- **JavaScript:** [Vite](https://vitejs.dev/) — see `vite.config.mjs`. Its
  `frontend-pro` entry builds the Pro-only export bundle from `pro/`, which is
  not part of the free plugin and not in this repository; `npm run build`
  skips that step when `pro/` is absent.
- **PHP dependencies:** [Composer](https://getcomposer.org/):
  `enshrined/svg-sanitize` for SVG sanitisation. `composer.json` also lists
  `tecnickcom/tcpdf`, used only by the Pro PDF export; the free plugin does not
  ship it.

The Freemius SDK that the published plugin bundles in `freemius/` is
third-party code and is not copied here; get it from
https://github.com/Freemius/wordpress-sdk.

## Guides

- [Guide for shop owners](docs/admin-guide.md)
- [Guide for customers](docs/user-guide.md)

## Support

Questions and bug reports: the plugin's support forum on WordPress.org.

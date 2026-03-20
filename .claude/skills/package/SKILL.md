---
name: package
description: Build production zip for WordPress plugin distribution — runs JS build, composer install, and packages into distributable zip
disable-model-invocation: true
---

# Package Plugin for Distribution

Build a production-ready zip file for the ProductForge WordPress plugin.

## Steps

1. Run `npm run build` to build JS assets (admin + frontend)
2. Run composer install via Docker (no dev dependencies):
   ```bash
   docker compose exec wordpress bash -c \
     "cd /var/www/html/wp-content/plugins/productforge && composer install --no-dev --optimize-autoloader"
   ```
3. Run `bash bin/package.sh` to create the zip
4. Report the output zip file name and size

## Validation

- Verify `dist/admin-template-builder.js` and `dist/frontend-designer.js` exist after build
- Verify `vendor/` directory has dependencies after composer install
- Verify the zip file was created successfully

## Error Handling

- If `npm run build` fails, stop and report the error
- If Docker is not running, warn the user and suggest `docker compose up -d`
- If `bin/package.sh` doesn't exist, create the zip manually

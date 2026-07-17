#!/bin/bash
# Package the ProductForge plugin into a distributable WordPress zip.
# Usage: bash bin/package.sh
set -e

PLUGIN_SLUG="productforge"
PLUGIN_FILE="productforge.php"
VERSION=$(grep "Version:" "$PLUGIN_FILE" | head -1 | awk '{print $NF}')
OUTPUT="${PLUGIN_SLUG}-${VERSION}.zip"
STAGE_DIR="/tmp/${PLUGIN_SLUG}-package"

echo "Building version ${VERSION}..."

# 1. Build JS assets
npm run build

# 2. Install PHP dependencies (no dev, optimised autoloader)
if command -v composer &>/dev/null; then
    composer install --no-dev --optimize-autoloader --quiet
else
    echo "composer not found on host — running via Docker container..."
    docker compose exec wordpress bash -c \
        "cd /var/www/html/wp-content/plugins/productforge && composer install --no-dev --optimize-autoloader --quiet"
fi

# 3. Stage files into a folder named after the slug
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/${PLUGIN_SLUG}"

cp "${PLUGIN_FILE}" "${STAGE_DIR}/${PLUGIN_SLUG}/"
cp uninstall.php "${STAGE_DIR}/${PLUGIN_SLUG}/"
cp -r includes/ "${STAGE_DIR}/${PLUGIN_SLUG}/includes/"
cp -r vendor/ "${STAGE_DIR}/${PLUGIN_SLUG}/vendor/"
cp -r dist/ "${STAGE_DIR}/${PLUGIN_SLUG}/dist/"
[ -d assets/ ] && cp -r assets/ "${STAGE_DIR}/${PLUGIN_SLUG}/assets/"
[ -d languages/ ] && cp -r languages/ "${STAGE_DIR}/${PLUGIN_SLUG}/languages/"
[ -d blocks/ ] && cp -r blocks/ "${STAGE_DIR}/${PLUGIN_SLUG}/blocks/"
[ -d templates/ ] && cp -r templates/ "${STAGE_DIR}/${PLUGIN_SLUG}/templates/"
# Freemius: productforge.php loads freemius-init.php, which requires
# freemius/start.php. Without these the live site silently loses all
# premium feature gating (is_premium() returns false).
[ -f freemius-init.php ] && cp freemius-init.php "${STAGE_DIR}/${PLUGIN_SLUG}/"
[ -d freemius/ ] && cp -r freemius/ "${STAGE_DIR}/${PLUGIN_SLUG}/freemius/"

# 4. Clean unwanted files
find "${STAGE_DIR}" -name '.DS_Store' -delete
find "${STAGE_DIR}" -name '.gitkeep' -delete

# 5. Create the zip
rm -f "${OUTPUT}"
(cd "${STAGE_DIR}" && zip -r - "${PLUGIN_SLUG}") > "${OUTPUT}"

# 6. Clean up staging dir
rm -rf "${STAGE_DIR}"

echo ""
echo "Package created: ${OUTPUT}"
echo "Size: $(du -sh "${OUTPUT}" | cut -f1)"

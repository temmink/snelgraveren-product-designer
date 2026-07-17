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
    docker run --rm -v "$(pwd)":/app -w /app composer:2 \
        install --no-dev --optimize-autoloader --ignore-platform-reqs --quiet
fi

# 3. Stage files into a folder named after the slug
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/${PLUGIN_SLUG}"

cp "${PLUGIN_FILE}" "${STAGE_DIR}/${PLUGIN_SLUG}/"
[ -f readme.txt ] && cp readme.txt "${STAGE_DIR}/${PLUGIN_SLUG}/"
# Plugin Check flags a missing composer.json when vendor/ is bundled
[ -f composer.json ] && cp composer.json "${STAGE_DIR}/${PLUGIN_SLUG}/"
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

# 4. Prune unused TCPDF fonts. The export pipeline only uses TCPDF's built-in
# core fonts (helvetica/times/courier/symbol/zapfdingbats, ~56 KB); the full
# font set is ~24 MB and would blow past wp.org's 10 MB upload limit.
# (In the Freemius FREE build /vendor/tecnickcom/ is stripped entirely via
# @fs_premium_only — this pruning keeps the PREMIUM build small too.)
TCPDF_FONTS="${STAGE_DIR}/${PLUGIN_SLUG}/vendor/tecnickcom/tcpdf/fonts"
if [ -d "${TCPDF_FONTS}" ]; then
    find "${TCPDF_FONTS}" -mindepth 1 -maxdepth 1 \
        ! -name 'helvetica*' ! -name 'times*' ! -name 'courier*' \
        ! -name 'symbol*' ! -name 'zapfdingbats*' \
        -exec rm -rf {} +
fi

# 5. Clean unwanted files
find "${STAGE_DIR}" -name '.DS_Store' -delete
find "${STAGE_DIR}" -name '.gitkeep' -delete

# 6. Create the zip
rm -f "${OUTPUT}"
(cd "${STAGE_DIR}" && zip -r - "${PLUGIN_SLUG}") > "${OUTPUT}"

# 7. Clean up staging dir
rm -rf "${STAGE_DIR}"

echo ""
echo "Package created: ${OUTPUT}"
echo "Size: $(du -sh "${OUTPUT}" | cut -f1)"

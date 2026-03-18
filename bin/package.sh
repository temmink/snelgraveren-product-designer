#!/bin/bash
# Package the Product Designer plugin into a distributable WordPress zip.
# Usage: bash bin/package.sh
set -e

PLUGIN_SLUG="product-designer"
PLUGIN_FILE="product-designer.php"
VERSION=$(grep "Version:" "$PLUGIN_FILE" | head -1 | awk '{print $NF}')
OUTPUT="${PLUGIN_SLUG}-${VERSION}.zip"

echo "Building version ${VERSION}..."

# 1. Build JS assets
npm run build

# 2. Install PHP dependencies (no dev, optimised autoloader)
if command -v composer &>/dev/null; then
    composer install --no-dev --optimize-autoloader --quiet
else
    echo "composer not found on host — running via Docker container..."
    docker compose exec wordpress bash -c \
        "cd /var/www/html/wp-content/plugins/product-designer && composer install --no-dev --optimize-autoloader --quiet"
fi

# 3. Remove any previous package
rm -f "${OUTPUT}"

# 4. Create the zip — include only production files
zip -r "${OUTPUT}" \
    "${PLUGIN_FILE}" \
    uninstall.php \
    includes/ \
    vendor/ \
    dist/ \
    assets/ \
    languages/ \
    -x "*.DS_Store" \
    -x "*/.gitkeep" \
    -x "*/node_modules/*" \
    -x "*/test/*" \
    -x "*/tests/*"

echo ""
echo "Package created: ${OUTPUT}"
echo "Size: $(du -sh "${OUTPUT}" | cut -f1)"

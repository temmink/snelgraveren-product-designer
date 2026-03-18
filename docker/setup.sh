#!/bin/bash
# Run inside the wordpress container to set up WP + WooCommerce.
# Usage: docker compose exec wordpress bash /var/www/html/wp-content/plugins/product-designer/docker/setup.sh

set -e

WP_URL="http://localhost"
WP_TITLE="Product Designer Dev"
WP_ADMIN_USER="admin"
WP_ADMIN_PASS="admin"
WP_ADMIN_EMAIL="admin@example.com"

echo "Waiting for WordPress to be ready..."
until wp core is-installed --allow-root 2>/dev/null; do
  sleep 2
done

echo "Installing WordPress..."
wp core install \
  --url="$WP_URL" \
  --title="$WP_TITLE" \
  --admin_user="$WP_ADMIN_USER" \
  --admin_password="$WP_ADMIN_PASS" \
  --admin_email="$WP_ADMIN_EMAIL" \
  --allow-root

echo "Installing WooCommerce..."
wp plugin install woocommerce --activate --allow-root

echo "Installing Storefront theme..."
wp theme install storefront --activate --allow-root

echo "Creating test products..."
wp wc product create \
  --name="Test T-Shirt" \
  --regular_price="25" \
  --type="simple" \
  --user=1 \
  --allow-root

wp wc product create \
  --name="Test Mug" \
  --regular_price="15" \
  --type="simple" \
  --user=1 \
  --allow-root

echo "Activating Product Designer plugin..."
wp plugin activate product-designer --allow-root

echo "Setup complete!"
echo "WordPress: http://localhost:8080 (admin / admin)"
echo "phpMyAdmin: http://localhost:8081"

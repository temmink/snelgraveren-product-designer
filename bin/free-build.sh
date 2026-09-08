#!/bin/bash
# Generate the WordPress.org free build from the premium package.
# Mirrors what the Freemius deployment processor does:
#   1. strip every path listed in the @fs_premium_only annotation
#   2. remove the wp_org_gatekeeper line (only ships in Freemius-served builds)
#   3. flip is_premium to false
# Usage: bash bin/free-build.sh   (run after bin/package.sh)
set -e

PLUGIN_SLUG="snelgraveren-product-designer"
VERSION=$(grep "Version:" "${PLUGIN_SLUG}.php" | head -1 | awk '{print $NF}')
SRC_ZIP="${PLUGIN_SLUG}-${VERSION}.zip"
OUT_ZIP="${PLUGIN_SLUG}-free-${VERSION}.zip"
STAGE="/tmp/${PLUGIN_SLUG}-free-build"

[ -f "$SRC_ZIP" ] || { echo "Eerst bin/package.sh draaien ($SRC_ZIP ontbreekt)"; exit 1; }

rm -rf "$STAGE" && mkdir -p "$STAGE"
unzip -q "$SRC_ZIP" -d "$STAGE"

# 1. Premium-only paths (keep in sync with @fs_premium_only in the main file)
rm -f  "$STAGE/$PLUGIN_SLUG/includes/Export/class-premium-exports.php"
rm -rf "$STAGE/$PLUGIN_SLUG/includes/Pricing"
rm -f  "$STAGE/$PLUGIN_SLUG/includes/API/class-rest-pricing.php"
rm -f  "$STAGE/$PLUGIN_SLUG/includes/API/class-rest-palettes.php"
rm -f  "$STAGE/$PLUGIN_SLUG/includes/API/class-rest-fonts-admin.php"
rm -f  "$STAGE/$PLUGIN_SLUG/includes/API/class-rest-clipart-admin.php"
rm -rf "$STAGE/$PLUGIN_SLUG/vendor/tecnickcom"
rm -rf "$STAGE/$PLUGIN_SLUG/includes/Proof"
rm -rf "$STAGE/$PLUGIN_SLUG/includes/Emails"
rm -rf "$STAGE/$PLUGIN_SLUG/templates/proof"
rm -f  "$STAGE/$PLUGIN_SLUG/templates/emails/proof-ready.php"
rm -f  "$STAGE/$PLUGIN_SLUG/templates/emails/proof-changes-requested.php"
rm -f  "$STAGE/$PLUGIN_SLUG/templates/emails/proof-approved.php"

# 2. Translations: our OWN languages/ stays out (package.sh never bundles it —
# wp.org serves those from translate.wordpress.org). The Freemius SDK's
# freemius/languages/*.mo are KEPT on purpose: they are the SDK's, not ours,
# wp.org does not translate them, and the free build Freemius generated for
# the 1.7.7 review carried them and was approved. Stripping them (done from
# 2026-07 to 1.12.4) only made the opt-in screens English on wp.org installs.
# The matching check in wporg-release.sh whitelists freemius/languages/.

# 3 + 4. Free-mode Freemius init
sed -i '' "/wp_org_gatekeeper/d" "$STAGE/$PLUGIN_SLUG/freemius-init.php"
sed -i '' "s/'is_premium'          => true,/'is_premium'          => false,/" "$STAGE/$PLUGIN_SLUG/freemius-init.php"

rm -f "$OUT_ZIP"
(cd "$STAGE" && zip -qr - "$PLUGIN_SLUG") > "$OUT_ZIP"
rm -rf "$STAGE"

echo "Free build: $OUT_ZIP ($(du -sh "$OUT_ZIP" | cut -f1))"
grep -c "wp_org_gatekeeper" <(unzip -p "$OUT_ZIP" "$PLUGIN_SLUG/freemius-init.php") | \
  awk '{ if ($1 == 0) print "gatekeeper gestript ✓"; else print "FOUT: gatekeeper nog aanwezig!" }'

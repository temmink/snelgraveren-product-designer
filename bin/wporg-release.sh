#!/bin/bash
# Release the FREE build to the WordPress.org plugin directory via SVN.
#
# Run from the project root on your Mac (needs: svn, npm, composer or docker, zip):
#   bash bin/wporg-release.sh            # build + stage + show diff, ask before commit
#   bash bin/wporg-release.sh --dry-run  # build + stage only, never touches the remote
#   bash bin/wporg-release.sh --skip-build   # reuse existing *-free-<version>.zip
#
# What it does
#   1. bin/package.sh  → premium ZIP          (npm run build + composer --no-dev)
#   2. bin/free-build.sh → free ZIP            (strips @fs_premium_only paths + gatekeeper)
#   3. svn checkout (or update) of the plugin repo into .svn-wporg/ (git-ignored)
#   4. replaces trunk/ with the free ZIP contents
#   5. copies wporg-assets/ (icon, banner, screenshot-*.png) into assets/
#   6. creates tags/<version>/ from trunk
#   7. one commit: "Release <version>"
#
# SVN credentials: your wordpress.org username (case-sensitive) and the separate
# SVN password from https://profiles.wordpress.org/me/profile/edit/group/3/?screen=svn-password
# svn will prompt for them on the first commit, or export SVN_USER=… beforehand.
set -euo pipefail

PLUGIN_SLUG="snelgraveren-product-designer"
PLUGIN_FILE="${PLUGIN_SLUG}.php"
SVN_URL="https://plugins.svn.wordpress.org/${PLUGIN_SLUG}"
SVN_DIR=".svn-wporg"
ASSETS_SRC="wporg-assets"

DRY_RUN=0
SKIP_BUILD=0
for arg in "$@"; do
    case "$arg" in
        --dry-run)    DRY_RUN=1 ;;
        --skip-build) SKIP_BUILD=1 ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

command -v svn >/dev/null || { echo "svn not found. Install with: brew install svn"; exit 1; }
[ -f "$PLUGIN_FILE" ] || { echo "Run this from the project root ($PLUGIN_FILE missing)"; exit 1; }

VERSION=$(grep "Version:" "$PLUGIN_FILE" | head -1 | awk '{print $NF}')
CONST_VERSION=$(grep -o "define('SGPD_VERSION', *'[^']*')" "$PLUGIN_FILE" | sed "s/.*'\([0-9.]*\)')/\1/")
STABLE_TAG=$(grep -i "^Stable tag:" readme.txt | awk '{print $NF}')
FREE_ZIP="${PLUGIN_SLUG}-free-${VERSION}.zip"

echo "==> Pre-flight for ${VERSION}"
[ "$VERSION" = "$CONST_VERSION" ] || { echo "FAIL: header Version ($VERSION) != SGPD_VERSION ($CONST_VERSION)"; exit 1; }
[ "$VERSION" = "$STABLE_TAG" ]   || { echo "FAIL: header Version ($VERSION) != readme Stable tag ($STABLE_TAG)"; exit 1; }
grep -q "= ${VERSION} =" readme.txt || { echo "FAIL: readme.txt changelog has no '= ${VERSION} =' entry"; exit 1; }
if [ -n "$(git status --porcelain -- "$PLUGIN_FILE" readme.txt includes/ 2>/dev/null)" ]; then
    echo "WARN: uncommitted changes in plugin sources — SVN should only receive released code."
fi
echo "    version ${VERSION}, stable tag ${STABLE_TAG} ✓"

if [ "$SKIP_BUILD" -eq 0 ]; then
    echo "==> Building premium + free packages"
    bash bin/package.sh
    bash bin/free-build.sh
fi
[ -f "$FREE_ZIP" ] || { echo "FAIL: $FREE_ZIP not found (run without --skip-build)"; exit 1; }

# Sanity checks on the free ZIP — these are the things wp.org reviewers/scanners flag.
echo "==> Checking ${FREE_ZIP}"
LISTING=$(unzip -Z1 "$FREE_ZIP")
fail=0
chk() { # chk <grep-pattern> <must-be-absent message>
    if echo "$LISTING" | grep -qE "$1"; then echo "FAIL: $2"; fail=1; fi
}
chk 'includes/Pricing/'               "premium path includes/Pricing/ still in free ZIP"
chk 'vendor/tecnickcom/'              "premium path vendor/tecnickcom/ still in free ZIP"
chk 'class-premium-exports\.php'      "premium exports class still in free ZIP"
chk '\.(po|mo|pot)$'                  "gettext files in ZIP (wp.org manages translations)"
chk 'node_modules/'                   "node_modules in ZIP"
chk '/\.git'                          ".git files in ZIP"
chk 'frontend/js/.*/src/'             "unbuilt frontend sources in ZIP"
if unzip -p "$FREE_ZIP" "${PLUGIN_SLUG}/freemius-init.php" | grep -q "wp_org_gatekeeper"; then
    echo "FAIL: wp_org_gatekeeper still present in freemius-init.php"; fail=1
fi
if unzip -p "$FREE_ZIP" "${PLUGIN_SLUG}/freemius-init.php" | grep -q "'is_premium'          => true"; then
    echo "FAIL: is_premium still true in freemius-init.php"; fail=1
fi
[ "$fail" -eq 0 ] || exit 1
SIZE_MB=$(du -m "$FREE_ZIP" | cut -f1)
echo "    contents clean, ${SIZE_MB} MB ✓"

echo "==> Syncing SVN working copy (${SVN_DIR})"
if [ -d "$SVN_DIR/.svn" ]; then
    svn update -q "$SVN_DIR"
else
    svn checkout -q "$SVN_URL" "$SVN_DIR"
fi
mkdir -p "$SVN_DIR/trunk" "$SVN_DIR/tags" "$SVN_DIR/assets"

if [ -d "$SVN_DIR/tags/$VERSION" ]; then
    echo "FAIL: tags/${VERSION} already exists in SVN. Bump the version — released tags must never be rewritten."
    exit 1
fi

# Replace trunk contents with the free build.
STAGE=$(mktemp -d)
unzip -q "$FREE_ZIP" -d "$STAGE"
find "$SVN_DIR/trunk" -mindepth 1 -maxdepth 1 ! -name '.svn' -exec rm -rf {} +
cp -R "$STAGE/$PLUGIN_SLUG/." "$SVN_DIR/trunk/"
rm -rf "$STAGE"

# Listing assets (icon, banner, screenshots) live in /assets, next to trunk.
if [ -d "$ASSETS_SRC" ]; then
    find "$ASSETS_SRC" -maxdepth 1 -type f \( -name 'icon-*.png' -o -name 'banner-*.png' -o -name 'screenshot-*.png' -o -name 'screenshot-*.jpg' \) \
        -exec cp {} "$SVN_DIR/assets/" \;
fi

# Register adds/deletes with svn.
(
    cd "$SVN_DIR"
    svn add --force -q trunk assets 2>/dev/null || true
    svn status | awk '/^!/ {print $2}' | while read -r f; do svn delete -q --force "$f"; done
    # Images must carry the right MIME type, or wp.org serves them as text.
    find assets -name '*.png' -exec svn propset -q svn:mime-type image/png {} \; 2>/dev/null || true
    find assets -name '*.jpg' -exec svn propset -q svn:mime-type image/jpeg {} \; 2>/dev/null || true
    svn copy -q trunk "tags/$VERSION"
)

echo "==> SVN status"
(cd "$SVN_DIR" && svn status | head -60)
echo "    (showing first 60 lines)"

if [ "$DRY_RUN" -eq 1 ]; then
    echo ""
    echo "Dry run — nothing committed. Inspect ${SVN_DIR}/, then run again without --dry-run."
    echo "To discard the staged changes: (cd ${SVN_DIR} && svn revert -R . && svn cleanup --remove-unversioned)"
    exit 0
fi

echo ""
read -r -p "Commit 'Release ${VERSION}' to ${SVN_URL}? [y/N] " answer
if [ "${answer}" != "y" ] && [ "${answer}" != "Y" ]; then
    echo "Aborted. Working copy left in ${SVN_DIR}/ — revert with: (cd ${SVN_DIR} && svn revert -R . && svn cleanup --remove-unversioned)"
    exit 1
fi

SVN_AUTH=()
[ -n "${SVN_USER:-}" ] && SVN_AUTH=(--username "$SVN_USER")
(cd "$SVN_DIR" && svn commit "${SVN_AUTH[@]}" -m "Release ${VERSION}")

echo ""
echo "Released ${VERSION}. The listing updates within a few minutes:"
echo "  https://wordpress.org/plugins/${PLUGIN_SLUG}/"
echo "Don't forget: upload ${PLUGIN_SLUG}-${VERSION}.zip (premium) to Freemius → Deployment as well."

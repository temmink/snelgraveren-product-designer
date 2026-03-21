# Custom Font Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admin users to upload custom font files (.woff2, .woff, .ttf) and make them available in the designer font picker alongside web-safe and Google Fonts.

**Architecture:** New `wp_pf_fonts` database table stores font metadata. Fonts are uploaded via a new admin REST endpoint, stored in `wp-content/uploads/pf-fonts/`, and served via dynamically generated `@font-face` CSS. The existing `AVAILABLE_FONTS` list is merged with custom fonts from the API at runtime.

**Tech Stack:** PHP (REST API, migration, repository), JavaScript (React admin UI, font loading), CSS (`@font-face`)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `includes/Database/class-migration400.php` | Create `wp_pf_fonts` table |
| Modify | `includes/Database/class-db-manager.php` | Register migration 400 |
| Create | `includes/Database/class-font-repository.php` | CRUD for fonts table |
| Create | `includes/Security/class-font-validator.php` | Validate font file uploads (MIME, size) |
| Modify | `includes/API/class-rest-fonts.php` | Full CRUD: list, upload, delete + family name collision check |
| Modify | `admin/js/template-builder/src/utils/fonts.js` | @font-face injection, merge custom fonts (with CSS escaping) |
| Modify | `admin/js/template-builder/src/api/templateApi.js` | Add font API helpers |
| Modify | `admin/js/template-builder/src/store/useTemplateStore.js` | Add customFonts state to Zustand store |
| Modify | `admin/js/template-builder/src/components/GlobalSettings.jsx` | Font upload UI in FontSelector (reads from Zustand) |
| Modify | `admin/js/template-builder/src/App.jsx` | Load custom fonts on mount into Zustand |
| Modify | `frontend/js/designer/src/utils/fonts.js` | Load custom fonts via @font-face, exclude from Google Fonts loading |
| Modify | `frontend/js/designer/src/api/designerApi.js` | Add fetchCustomFonts helper |
| Modify | `frontend/js/designer/src/App.jsx` | Fetch and load custom fonts |
| Modify | `includes/Export/class-svg-exporter.php` | Embed custom fonts as base64 @font-face in SVG `<defs>` |
| Modify | `includes/Export/class-pdf-exporter.php` | Fix fontFamily bug (was hardcoded helvetica) + register custom TTF |
| Modify | `includes/Export/class-png-exporter.php` | Add custom font directory to find_font() fallback |

---

### Task 1: Database Migration — `wp_pf_fonts` Table

**Files:**
- Create: `includes/Database/class-migration400.php`
- Modify: `includes/Database/class-db-manager.php`

- [ ] **Step 1: Create migration file**

Create `includes/Database/class-migration400.php`:

```php
<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class Migration400 {

    public function up(): void {
        global $wpdb;
        $table   = $wpdb->prefix . 'pf_fonts';
        $charset = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE IF NOT EXISTS `{$table}` (
            `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `family`     VARCHAR(255)    NOT NULL,
            `file_url`   VARCHAR(2048)   NOT NULL,
            `format`     VARCHAR(10)     NOT NULL COMMENT 'woff2, woff, or truetype',
            `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_family` (`family`)
        ) ENGINE=InnoDB {$charset};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);
    }
}
```

- [ ] **Step 2: Register migration in DbManager**

In `includes/Database/class-db-manager.php`, add `400 => Migration400::class` to the `$migrations` array:

```php
$migrations = [
    100 => Migration100::class,
    200 => Migration200::class,
    300 => Migration300::class,
    400 => Migration400::class,
];
```

- [ ] **Step 3: Test migration runs**

Run: Visit WordPress admin or run `docker compose exec wordpress wp eval "ProductForge\Database\DbManager::run_migrations();"`

Verify: `docker compose exec wordpress wp db query "DESCRIBE wp_pf_fonts;"`

Expected: Table with columns `id`, `family`, `file_url`, `format`, `created_at`.

- [ ] **Step 4: Commit**

```bash
git add includes/Database/class-migration400.php includes/Database/class-db-manager.php
git commit -m "feat: add wp_pf_fonts table migration"
```

---

### Task 2: Font Repository

**Files:**
- Create: `includes/Database/class-font-repository.php`

- [ ] **Step 1: Create FontRepository class**

Create `includes/Database/class-font-repository.php`:

```php
<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class FontRepository {

    private static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_fonts';
    }

    /**
     * Get all custom fonts, grouped by family.
     * Returns: [ ['family' => 'MyFont', 'files' => [['id' => 1, 'file_url' => '...', 'format' => 'woff2'], ...]], ... ]
     */
    public static function all(): array {
        global $wpdb;
        $table = self::table();

        $rows = $wpdb->get_results(
            "SELECT id, family, file_url, format, created_at FROM `{$table}` ORDER BY family, id",
            ARRAY_A
        );

        $grouped = [];
        foreach ($rows as $row) {
            $family = $row['family'];
            if (!isset($grouped[$family])) {
                $grouped[$family] = ['family' => $family, 'files' => []];
            }
            $grouped[$family]['files'][] = [
                'id'       => (int) $row['id'],
                'file_url' => $row['file_url'],
                'format'   => $row['format'],
            ];
        }

        return array_values($grouped);
    }

    /**
     * Insert a font file record.
     */
    public static function insert(string $family, string $file_url, string $format): int {
        global $wpdb;

        $wpdb->insert(self::table(), [
            'family'   => $family,
            'file_url' => $file_url,
            'format'   => $format,
        ], ['%s', '%s', '%s']);

        return (int) $wpdb->insert_id;
    }

    /**
     * Delete a font file by ID. Returns the row (for file cleanup) or null.
     */
    public static function delete(int $id): ?array {
        global $wpdb;
        $table = self::table();

        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT id, family, file_url, format FROM `{$table}` WHERE id = %d", $id),
            ARRAY_A
        );

        if (!$row) {
            return null;
        }

        $wpdb->delete($table, ['id' => $id], ['%d']);

        return $row;
    }

    /**
     * Delete all files for a font family. Returns deleted rows for file cleanup.
     */
    public static function delete_family(string $family): array {
        global $wpdb;
        $table = self::table();

        $rows = $wpdb->get_results(
            $wpdb->prepare("SELECT id, file_url FROM `{$table}` WHERE family = %s", $family),
            ARRAY_A
        );

        if (!empty($rows)) {
            $wpdb->delete($table, ['family' => $family], ['%s']);
        }

        return $rows;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add includes/Database/class-font-repository.php
git commit -m "feat: add FontRepository for custom fonts CRUD"
```

---

### Task 3: Font File Validator

**Files:**
- Create: `includes/Security/class-font-validator.php`

- [ ] **Step 1: Create FontValidator class**

Create `includes/Security/class-font-validator.php`:

```php
<?php
namespace ProductForge\Security;

defined('ABSPATH') || exit;

class FontValidator {

    private const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

    /**
     * Allowed font MIME types and their format identifiers.
     * Note: finfo may report font/sfnt or application/x-font-ttf for TTF files.
     */
    private const MIME_MAP = [
        'font/woff2'                => 'woff2',
        'font/woff'                 => 'woff',
        'application/font-woff'     => 'woff',
        'font/ttf'                  => 'truetype',
        'font/sfnt'                 => 'truetype',
        'application/x-font-ttf'    => 'truetype',
        'application/font-sfnt'     => 'truetype',
        'application/octet-stream'  => null, // needs extension check
    ];

    /**
     * Extension to format mapping (fallback when MIME is application/octet-stream).
     */
    private const EXT_MAP = [
        'woff2' => 'woff2',
        'woff'  => 'woff',
        'ttf'   => 'truetype',
    ];

    /**
     * Validate and store a font file upload.
     * Returns ['file_url' => '...', 'format' => 'woff2|woff|truetype'].
     */
    public static function validate_and_store(array $file): array {
        self::check_size($file);
        $format = self::detect_format($file);

        return self::move_file($file, $format);
    }

    private static function check_size(array $file): void {
        if ($file['size'] > self::MAX_FILE_SIZE) {
            throw new \RuntimeException('Font file exceeds maximum size of 5 MB.', 400);
        }
    }

    private static function detect_format(array $file): string {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime  = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);

        // Direct MIME match
        if (isset(self::MIME_MAP[$mime]) && self::MIME_MAP[$mime] !== null) {
            return self::MIME_MAP[$mime];
        }

        // Fallback: check file extension (font files often report application/octet-stream)
        if (isset(self::MIME_MAP[$mime])) {
            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            if (isset(self::EXT_MAP[$ext])) {
                return self::EXT_MAP[$ext];
            }
        }

        throw new \RuntimeException("Font file type '{$mime}' is not allowed. Use .woff2, .woff, or .ttf files.", 400);
    }

    private static function move_file(array $file, string $format): array {
        $upload_dir = wp_upload_dir();
        $dir        = $upload_dir['basedir'] . '/pf-fonts';
        wp_mkdir_p($dir);

        $ext_map  = ['woff2' => 'woff2', 'woff' => 'woff', 'truetype' => 'ttf'];
        $ext      = $ext_map[$format] ?? 'bin';
        $filename = bin2hex(random_bytes(8)) . '.' . $ext;
        $dest     = $dir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            throw new \RuntimeException('Failed to move uploaded font file.', 500);
        }

        return [
            'file_url' => $upload_dir['baseurl'] . '/pf-fonts/' . $filename,
            'format'   => $format,
        ];
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add includes/Security/class-font-validator.php
git commit -m "feat: add FontValidator for custom font upload validation"
```

---

### Task 4: REST API — Font Endpoints

**Files:**
- Modify: `includes/API/class-rest-fonts.php`

- [ ] **Step 1: Rewrite RestFonts with full CRUD**

Replace `includes/API/class-rest-fonts.php` with:

```php
<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\FontRepository;
use ProductForge\Security\FontValidator;

class RestFonts {

    public function register_routes(): void {
        // Public: list all custom fonts (needed by frontend designer)
        register_rest_route('pf/v1', '/fonts', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_fonts'],
            'permission_callback' => '__return_true',
        ]);

        // Admin: upload a new font
        register_rest_route('pf/v1', '/fonts', [
            'methods'             => 'POST',
            'callback'            => [$this, 'upload_font'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: delete a font file by ID
        register_rest_route('pf/v1', '/fonts/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_font'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: delete all files for a font family
        register_rest_route('pf/v1', '/fonts/family/(?P<family>[^/]+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_family'],
            'permission_callback' => [$this, 'can_edit'],
        ]);
    }

    public function can_edit(): bool {
        return current_user_can('edit_pf_templates');
    }

    public function list_fonts(): \WP_REST_Response {
        return rest_ensure_response(FontRepository::all());
    }

    public function upload_font(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $files = $request->get_file_params();
        if (empty($files['file'])) {
            return new \WP_Error('no_file', 'No font file uploaded.', ['status' => 400]);
        }

        $family = sanitize_text_field($request->get_param('family') ?? '');
        if (empty($family)) {
            return new \WP_Error('no_family', 'Font family name is required.', ['status' => 400]);
        }

        // Prevent collision with built-in web-safe and Google Fonts
        $reserved = [
            'Arial', 'Verdana', 'Helvetica', 'Tahoma', 'Trebuchet MS',
            'Times New Roman', 'Georgia', 'Garamond', 'Courier New',
            'Impact', 'Comic Sans MS', 'Roboto', 'Open Sans', 'Lato',
            'Montserrat', 'Poppins', 'Inter', 'Raleway', 'Nunito',
            'Ubuntu', 'Oswald', 'Playfair Display', 'Merriweather',
            'Lora', 'PT Serif', 'Roboto Slab', 'Roboto Mono',
            'Source Code Pro', 'Fira Code', 'Dancing Script', 'Pacifico',
            'Great Vibes', 'Caveat', 'Satisfy', 'Bebas Neue', 'Lobster',
            'Righteous', 'Permanent Marker', 'Alfa Slab One', 'Anton', 'Bangers',
        ];
        if (in_array($family, $reserved, true)) {
            return new \WP_Error('reserved_name', "'{$family}' is a built-in font name. Choose a different name.", ['status' => 400]);
        }

        try {
            $result = FontValidator::validate_and_store($files['file']);
            $id     = FontRepository::insert($family, $result['file_url'], $result['format']);

            return new \WP_REST_Response([
                'id'       => $id,
                'family'   => $family,
                'file_url' => $result['file_url'],
                'format'   => $result['format'],
            ], 201);
        } catch (\RuntimeException $e) {
            $code = $e->getCode() ?: 400;
            return new \WP_Error('font_upload_failed', $e->getMessage(), ['status' => $code]);
        }
    }

    public function delete_font(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id  = (int) $request['id'];
        $row = FontRepository::delete($id);

        if (!$row) {
            return new \WP_Error('not_found', 'Font not found.', ['status' => 404]);
        }

        // Delete the file from disk
        self::delete_file($row['file_url']);

        return new \WP_REST_Response(null, 204);
    }

    public function delete_family(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $family = sanitize_text_field(urldecode($request['family']));
        $rows   = FontRepository::delete_family($family);

        if (empty($rows)) {
            return new \WP_Error('not_found', 'Font family not found.', ['status' => 404]);
        }

        foreach ($rows as $row) {
            self::delete_file($row['file_url']);
        }

        return new \WP_REST_Response(null, 204);
    }

    private static function delete_file(string $url): void {
        $upload_dir = wp_upload_dir();
        $path = str_replace($upload_dir['baseurl'], $upload_dir['basedir'], $url);
        if (file_exists($path)) {
            unlink($path);
        }
    }
}
```

- [ ] **Step 2: Test API manually**

Upload test:
```bash
curl -X POST "http://localhost:8080/wp-json/pf/v1/fonts" \
  -H "X-WP-Nonce: <nonce>" \
  -F "file=@test-font.woff2" \
  -F "family=TestFont"
```

List test:
```bash
curl "http://localhost:8080/wp-json/pf/v1/fonts"
```

- [ ] **Step 3: Commit**

```bash
git add includes/API/class-rest-fonts.php
git commit -m "feat: implement font REST API with upload, list, delete"
```

---

### Task 5: Admin Font API Helpers

**Files:**
- Modify: `admin/js/template-builder/src/api/templateApi.js`

- [ ] **Step 1: Add font API functions**

Add to the end of `admin/js/template-builder/src/api/templateApi.js`:

```javascript
// Fonts
export const fontApi = {
  list: () => request('GET', 'fonts'),

  upload: async (file, family) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('family', family);

    const res = await fetch(`${base()}pf/v1/fonts`, {
      method: 'POST',
      headers: { 'X-WP-Nonce': nonce() },
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || 'Font upload failed');
    return data;
  },

  deleteFamily: (family) => request('DELETE', `fonts/family/${encodeURIComponent(family)}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add admin/js/template-builder/src/api/templateApi.js
git commit -m "feat: add font API helpers to template builder"
```

---

### Task 6: Admin Font Utilities — Merge Custom Fonts

**Files:**
- Modify: `admin/js/template-builder/src/utils/fonts.js`

- [ ] **Step 1: Add custom font support**

Add to `admin/js/template-builder/src/utils/fonts.js`, after the existing `loadGoogleFonts` function:

```javascript
/**
 * Escape a string for safe use inside CSS single-quoted values.
 */
function cssEscape(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Inject @font-face rules for custom-uploaded fonts.
 * @param {Array} customFonts — from GET /pf/v1/fonts: [{family, files: [{file_url, format}]}]
 */
export function loadCustomFonts(customFonts) {
  if (!customFonts || customFonts.length === 0) return;

  const styleId = 'pf-custom-fonts';
  let style = document.getElementById(styleId);

  const css = customFonts
    .map((font) => {
      const sources = font.files
        .map((f) => `url('${cssEscape(f.file_url)}') format('${cssEscape(f.format)}')`)
        .join(',\n       ');
      return `@font-face {
  font-family: '${cssEscape(font.family)}';
  src: ${sources};
  font-display: swap;
}`;
    })
    .join('\n\n');

  if (style) {
    style.textContent = css;
  } else {
    style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }
}

/**
 * Merge custom fonts into AVAILABLE_FONTS for the font picker.
 * Returns a new array with custom fonts appended.
 */
export function mergeCustomFonts(customFonts) {
  return [
    ...AVAILABLE_FONTS,
    ...customFonts.map((f) => ({
      family: f.family,
      category: 'custom',
      source: 'custom',
    })),
  ];
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/js/template-builder/src/utils/fonts.js
git commit -m "feat: add custom font @font-face injection and merge utilities"
```

---

### Task 7: Zustand Store + Admin UI

**Files:**
- Modify: `admin/js/template-builder/src/store/useTemplateStore.js`
- Modify: `admin/js/template-builder/src/App.jsx`
- Modify: `admin/js/template-builder/src/components/GlobalSettings.jsx`

- [ ] **Step 1: Add customFonts to Zustand store**

In `admin/js/template-builder/src/store/useTemplateStore.js`, add to the store's initial state and actions:

```javascript
// Add to state (alongside existing fields like id, title, etc.)
customFonts: [],

// Add action
setCustomFonts: (fonts) => set({ customFonts: fonts }),
```

- [ ] **Step 2: Update App.jsx to fetch and load custom fonts**

In `admin/js/template-builder/src/App.jsx`:

1. Update imports:
```javascript
import { loadGoogleFonts, loadCustomFonts } from './utils/fonts';
import { fontApi } from './api/templateApi';
```

2. Add `setCustomFonts` to the destructured store:
```javascript
const { ..., setCustomFonts } = useTemplateStore();
```

3. Add useEffect to fetch custom fonts on mount (after the existing template load useEffect):
```javascript
// Load custom fonts on mount
useEffect(() => {
  fontApi.list().then((fonts) => {
    setCustomFonts(fonts);
    loadCustomFonts(fonts);
  }).catch((err) => console.error('Failed to load custom fonts:', err));
}, []);
```

No prop drilling needed — `GlobalSettings` reads from the same Zustand store.

- [ ] **Step 3: Update GlobalSettings and FontSelector**

In `GlobalSettings.jsx`:

1. Update imports:
```javascript
import { AVAILABLE_FONTS, loadCustomFonts, mergeCustomFonts } from '../utils/fonts';
import { fontApi } from '../api/templateApi';
```

2. `GlobalSettings` stays props-free (no change to signature).

3. Replace the `FontSelector` function:

```javascript
function FontSelector({ allowed, onChange }) {
  const { customFonts, setCustomFonts } = useTemplateStore();
  const [adding, setAdding] = useState('');
  const [uploadFamily, setUploadFamily] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const allFonts = mergeCustomFonts(customFonts);
  const available = allFonts.filter((f) => !allowed.includes(f.family));

  const addFont = (family) => {
    if (family && !allowed.includes(family)) {
      onChange([...allowed, family]);
    }
    setAdding('');
  };

  const removeFont = (family) => {
    onChange(allowed.filter((f) => f !== family));
  };

  const refreshCustomFonts = async () => {
    const updated = await fontApi.list();
    setCustomFonts(updated);
    loadCustomFonts(updated);
    return updated;
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !uploadFamily.trim()) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      await fontApi.upload(file, uploadFamily.trim());
      await refreshCustomFonts();
      setUploadFamily('');
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteCustomFont = async (family) => {
    try {
      await fontApi.deleteFamily(family);
      await refreshCustomFonts();
      if (allowed.includes(family)) {
        onChange(allowed.filter((f) => f !== family));
      }
    } catch (err) {
      setUploadError(err.message);
    }
  };

  return (
    <div className="pf-settings__fonts">
      {allowed.length > 0 && (
        <div className="pf-settings__font-list">
          {allowed.map((family) => (
            <div key={family} className="pf-settings__font-item">
              <span>{family}</span>
              <button
                type="button"
                className="pf-settings__font-remove"
                onClick={() => removeFont(family)}
                aria-label={`Remove ${family}`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="pf-settings__font-add">
        <select value={adding} onChange={(e) => addFont(e.target.value)}>
          <option value="">{ __( 'Add a font...', 'productforge' ) }</option>
          {available.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family} ({f.category})
            </option>
          ))}
        </select>
      </div>

      {/* Custom font upload */}
      <div className="pf-settings__font-upload">
        <h4>{ __( 'Upload Custom Font', 'productforge' ) }</h4>
        <div className="pf-settings__font-upload-row">
          <input
            type="text"
            value={uploadFamily}
            onChange={(e) => setUploadFamily(e.target.value)}
            placeholder={ __( 'Font family name', 'productforge' ) }
            className="pf-settings__font-upload-name"
          />
          <label className="button button-small pf-settings__font-upload-btn">
            {isUploading ? __( 'Uploading…', 'productforge' ) : __( 'Choose File', 'productforge' )}
            <input
              type="file"
              accept=".woff2,.woff,.ttf"
              onChange={handleUpload}
              disabled={isUploading || !uploadFamily.trim()}
              style={{ display: 'none' }}
            />
          </label>
        </div>
        <p className="pf-settings__note">
          { __( 'Supported formats: .woff2, .woff, .ttf. You can upload multiple files for the same family name (e.g. regular + bold).', 'productforge' ) }
        </p>
        {uploadError && <p className="pf-settings__error">{uploadError}</p>}
      </div>

      {/* List of uploaded custom fonts */}
      {customFonts.length > 0 && (
        <div className="pf-settings__font-custom-list">
          <h4>{ __( 'Uploaded Fonts', 'productforge' ) }</h4>
          {customFonts.map((font) => (
            <div key={font.family} className="pf-settings__font-item">
              <span style={{ fontFamily: `'${font.family}'` }}>{font.family}</span>
              <span className="pf-settings__note" style={{ marginLeft: '0.5em' }}>
                ({font.files.length} {font.files.length === 1 ? 'file' : 'files'})
              </span>
              <button
                type="button"
                className="pf-settings__font-remove"
                onClick={() => handleDeleteCustomFont(font.family)}
                aria-label={`Delete ${font.family}`}
                title={ __( 'Delete font', 'productforge' ) }
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {allowed.length === 0 && (
        <p className="pf-settings__note">
          { __( "No fonts selected. Customers won't be able to change fonts.", 'productforge' ) }
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add admin/js/template-builder/src/store/useTemplateStore.js admin/js/template-builder/src/components/GlobalSettings.jsx admin/js/template-builder/src/App.jsx
git commit -m "feat: add custom font upload UI in template builder"
```

---

### Task 8: Frontend — Load Custom Fonts in Designer

**Files:**
- Modify: `frontend/js/designer/src/utils/fonts.js`
- Modify: `frontend/js/designer/src/api/designerApi.js`
- Modify: `frontend/js/designer/src/App.jsx`

- [ ] **Step 1: Update frontend fonts.js — add loadCustomFonts and fix loadGoogleFonts**

The existing `loadGoogleFonts` filters by `WEB_SAFE` list only, so custom font families would be sent to Google Fonts API (causing 404s). Fix by accepting an exclusion list.

Replace the entire `frontend/js/designer/src/utils/fonts.js`:

```javascript
/**
 * Load Google Fonts that aren't web-safe or custom.
 * Injects a single <link> tag for all required Google Fonts.
 */

const WEB_SAFE = [
  'Arial', 'Verdana', 'Helvetica', 'Tahoma', 'Trebuchet MS',
  'Times New Roman', 'Georgia', 'Garamond', 'Courier New',
  'Impact', 'Comic Sans MS',
];

// Custom font families loaded from the server — populated by loadCustomFonts()
let customFamilies = [];

export function loadGoogleFonts(fontFamilies) {
  const googleFonts = fontFamilies.filter(
    (f) => !WEB_SAFE.includes(f) && !customFamilies.includes(f)
  );
  if (googleFonts.length === 0) return;

  const linkId = 'pf-google-fonts';
  let link = document.getElementById(linkId);

  const families = googleFonts
    .map((f) => f.replace(/ /g, '+') + ':wght@400;700')
    .join('&family=');
  const href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;

  if (link) {
    if (link.href !== href) {
      link.href = href;
    }
  } else {
    link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}

/**
 * Escape a string for safe use inside CSS single-quoted values.
 */
function cssEscape(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Inject @font-face CSS for custom-uploaded fonts.
 * Must be called BEFORE loadGoogleFonts so custom families are excluded.
 * @param {Array} fonts — [{family, files: [{file_url, format}]}]
 */
export function loadCustomFonts(fonts) {
  if (!fonts || fonts.length === 0) return;

  // Track custom families so loadGoogleFonts skips them
  customFamilies = fonts.map((f) => f.family);

  const styleId = 'pf-custom-fonts';
  let style = document.getElementById(styleId);

  const css = fonts
    .map((font) => {
      const sources = font.files
        .map((f) => `url('${cssEscape(f.file_url)}') format('${cssEscape(f.format)}')`)
        .join(',\n       ');
      return `@font-face {
  font-family: '${cssEscape(font.family)}';
  src: ${sources};
  font-display: swap;
}`;
    })
    .join('\n\n');

  if (style) {
    style.textContent = css;
  } else {
    style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }
}
```

- [ ] **Step 2: Add fetchCustomFonts to designerApi.js**

Add to the end of `frontend/js/designer/src/api/designerApi.js`:

```javascript
export async function fetchCustomFonts() {
  const res = await fetch(apiUrl('/fonts'));
  if (!res.ok) return [];
  return res.json();
}
```

- [ ] **Step 3: Update frontend App.jsx to load custom fonts before Google Fonts**

In `frontend/js/designer/src/App.jsx`:

1. Add imports:
```javascript
import { loadGoogleFonts, loadCustomFonts } from './utils/fonts';
import { fetchCustomFonts } from './api/designerApi';
```

2. In the template load flow, change the font loading to load custom fonts first:

```javascript
// Load custom fonts BEFORE Google Fonts (so custom families are excluded from Google loading)
fetchCustomFonts()
  .then((customFonts) => {
    loadCustomFonts(customFonts);
    loadGoogleFonts(allowedFonts);
  })
  .catch(() => {
    // If custom fonts fail, still load Google Fonts
    loadGoogleFonts(allowedFonts);
  });
```

- [ ] **Step 4: Commit**

```bash
git add frontend/js/designer/src/utils/fonts.js frontend/js/designer/src/api/designerApi.js frontend/js/designer/src/App.jsx
git commit -m "feat: load custom fonts in frontend designer via @font-face"
```

---

### Task 9: SVG Export — Embed Custom Fonts

**Files:**
- Modify: `includes/Export/class-svg-exporter.php`

The SVG exporter already uses `fontFamily` correctly in `<text>` elements, but if the viewer doesn't have the font installed, it falls back to a system font. Fix: embed custom fonts as base64 `@font-face` in SVG `<defs>`. This also fixes the PNG export automatically (SVG→Imagick pipeline).

- [ ] **Step 1: Add font embedding to SvgExporter**

Add a new method `build_font_defs` and call it from `render()`:

```php
/**
 * Build @font-face CSS for custom fonts used in the canvas objects.
 * Only embeds fonts that are actually used.
 */
private function build_font_defs(array $objects): string {
    $used_families = $this->collect_font_families($objects);
    if (empty($used_families)) {
        return '';
    }

    $custom_fonts = \ProductForge\Database\FontRepository::all();
    if (empty($custom_fonts)) {
        return '';
    }

    $css = '';
    foreach ($custom_fonts as $font) {
        if (!in_array($font['family'], $used_families, true)) {
            continue;
        }

        foreach ($font['files'] as $file) {
            // Only embed TTF files in SVG (best compatibility with Imagick/renderers)
            $local_path = FileUtils::url_to_local_path($file['file_url']);
            if (empty($local_path) || !file_exists($local_path)) {
                continue;
            }

            $data = file_get_contents($local_path);
            if ($data === false) {
                continue;
            }

            $mime = match ($file['format']) {
                'woff2'    => 'font/woff2',
                'woff'     => 'font/woff',
                'truetype' => 'font/ttf',
                default    => 'application/octet-stream',
            };

            $base64 = base64_encode($data);
            $css .= "@font-face {\n";
            $css .= "  font-family: '" . esc_attr($font['family']) . "';\n";
            $css .= "  src: url('data:{$mime};base64,{$base64}') format('{$file['format']}');\n";
            $css .= "}\n";
        }
    }

    if (empty($css)) {
        return '';
    }

    return '<defs><style type="text/css"><![CDATA[' . "\n" . $css . ']]></style></defs>';
}

/**
 * Collect all unique font families from canvas objects.
 */
private function collect_font_families(array $objects): array {
    $families = [];
    foreach ($objects as $obj) {
        $type = $obj['type'] ?? '';
        if (in_array($type, ['i-text', 'IText', 'Textbox', 'textbox', 'Text'], true)) {
            $family = $obj['fontFamily'] ?? '';
            if ($family && !in_array($family, $families, true)) {
                $families[] = $family;
            }
        }
        // Check group children
        if (in_array($type, ['Group', 'group'], true)) {
            $child_families = $this->collect_font_families($obj['objects'] ?? []);
            foreach ($child_families as $f) {
                if (!in_array($f, $families, true)) {
                    $families[] = $f;
                }
            }
        }
    }
    return $families;
}
```

Then in the `render()` method, insert the font defs right after the opening `<svg>` tag:

```php
// In render(), after the opening <svg> tag:
$svg .= $this->build_font_defs($objects);
```

- [ ] **Step 2: Commit**

```bash
git add includes/Export/class-svg-exporter.php
git commit -m "feat: embed custom fonts as base64 @font-face in SVG export"
```

---

### Task 10: PDF Export — Fix Font Bug + Custom Font Support

**Files:**
- Modify: `includes/Export/class-pdf-exporter.php`

The PDF exporter currently hard-codes `'helvetica'` and ignores `fontFamily`. Fix this to use the actual font, and register custom fonts with TCPDF.

- [ ] **Step 1: Add custom font registration and fix render_text**

Add a helper method to resolve fonts and update `render_text`:

```php
/**
 * Map of custom font families to their TTF file paths (cached per export).
 */
private array $custom_font_map = [];

/**
 * Build a mapping of custom font family names to local TTF file paths.
 */
private function load_custom_fonts(): void {
    $custom_fonts = \ProductForge\Database\FontRepository::all();
    foreach ($custom_fonts as $font) {
        foreach ($font['files'] as $file) {
            // TCPDF only supports TrueType fonts
            if ($file['format'] !== 'truetype') {
                continue;
            }
            $local_path = FileUtils::url_to_local_path($file['file_url']);
            if ($local_path && file_exists($local_path)) {
                $this->custom_font_map[$font['family']] = $local_path;
                break; // One TTF per family is enough for TCPDF
            }
        }
    }
}

/**
 * Resolve a font family name to a TCPDF font name.
 * Registers custom TTF fonts on first use.
 */
private function resolve_font(\TCPDF $pdf, string $family): string {
    // TCPDF built-in fonts (case-insensitive match)
    $builtin = [
        'arial' => 'helvetica',
        'helvetica' => 'helvetica',
        'times new roman' => 'times',
        'times' => 'times',
        'courier new' => 'courier',
        'courier' => 'courier',
        'georgia' => 'times',       // closest built-in match
        'verdana' => 'helvetica',   // closest built-in match
        'tahoma' => 'helvetica',    // closest built-in match
        'trebuchet ms' => 'helvetica',
        'sans-serif' => 'helvetica',
        'serif' => 'times',
        'monospace' => 'courier',
    ];

    $lower = strtolower($family);
    if (isset($builtin[$lower])) {
        return $builtin[$lower];
    }

    // Check for custom font with TTF file
    if (isset($this->custom_font_map[$family])) {
        try {
            $font_name = \TCPDF_FONTS::addTTFfont($this->custom_font_map[$family], 'TrueTypeUnicode', '', 96);
            if ($font_name) {
                return $font_name;
            }
        } catch (\Exception $e) {
            // Fall through to default
        }
    }

    // Default fallback
    return 'helvetica';
}
```

Then update `render_text` to use the resolver:

```php
private function render_text(\TCPDF $pdf, array $obj): void {
    $left   = (float) ($obj['left'] ?? 0);
    $top    = (float) ($obj['top'] ?? 0);
    $text   = $obj['text'] ?? '';
    $fill   = $obj['fill'] ?? '#000000';
    $size   = (float) ($obj['fontSize'] ?? 20);
    $family = $obj['fontFamily'] ?? 'Arial';
    $weight = ($obj['fontWeight'] ?? 'normal') === 'bold' ? 'B' : '';
    $style  = ($obj['fontStyle'] ?? 'normal') === 'italic' ? 'I' : '';
    $scaleX = (float) ($obj['scaleX'] ?? 1);
    $scaleY = (float) ($obj['scaleY'] ?? 1);

    $rgb = $this->hex_to_rgb($fill);
    $pdf->SetTextColor($rgb[0], $rgb[1], $rgb[2]);

    $actual_size = $size * $scaleY;
    $font_name = $this->resolve_font($pdf, $family);
    $pdf->SetFont($font_name, $weight . $style, $actual_size);

    $pdf->SetXY($left, $top);
    $lines = explode("\n", $text);
    $line_height = $actual_size * 1.16;
    foreach ($lines as $i => $line) {
        $pdf->SetXY($left, $top + ($i * $line_height));
        $pdf->Cell(0, $line_height, $line, 0, 0, 'L');
    }
}
```

And call `load_custom_fonts()` at the start of `export()`:

```php
public function export(array $views, string $file_path): bool {
    // ... existing dir check ...
    $this->load_custom_fonts(); // Add this line
    // ... rest of export logic ...
}
```

- [ ] **Step 2: Commit**

```bash
git add includes/Export/class-pdf-exporter.php
git commit -m "fix: use actual fontFamily in PDF export + register custom TTF fonts"
```

---

### Task 11: PNG Export Fallback — Add Custom Font Paths

**Files:**
- Modify: `includes/Export/class-png-exporter.php`

The PNG primary path (SVG→Imagick) already benefits from Task 9 (embedded fonts in SVG). The fallback `find_font()` method also needs to check the custom font upload directory.

- [ ] **Step 1: Update find_font to check custom fonts**

Add the custom font directory to the search and check the database:

```php
private function find_font(string $family): string {
    $original_family = $family;
    $family = strtolower(trim($family));

    // Check custom uploaded fonts first (TTF only)
    $custom_fonts = \ProductForge\Database\FontRepository::all();
    foreach ($custom_fonts as $font) {
        if (strtolower($font['family']) === $family) {
            foreach ($font['files'] as $file) {
                if ($file['format'] === 'truetype') {
                    $local_path = FileUtils::url_to_local_path($file['file_url']);
                    if ($local_path && file_exists($local_path)) {
                        return $local_path;
                    }
                }
            }
        }
    }

    // Common mappings (existing code)
    $map = [
        'arial'       => ['Arial.ttf', 'arial.ttf', 'LiberationSans-Regular.ttf', 'DejaVuSans.ttf'],
        'helvetica'   => ['Helvetica.ttf', 'Arial.ttf', 'arial.ttf', 'LiberationSans-Regular.ttf', 'DejaVuSans.ttf'],
        'times'       => ['Times.ttf', 'times.ttf', 'LiberationSerif-Regular.ttf', 'DejaVuSerif.ttf'],
        'times new roman' => ['Times.ttf', 'times.ttf', 'LiberationSerif-Regular.ttf', 'DejaVuSerif.ttf'],
        'courier'     => ['Courier.ttf', 'courier.ttf', 'LiberationMono-Regular.ttf', 'DejaVuSansMono.ttf'],
        'courier new' => ['Courier.ttf', 'courier.ttf', 'LiberationMono-Regular.ttf', 'DejaVuSansMono.ttf'],
        'sans-serif'  => ['DejaVuSans.ttf', 'LiberationSans-Regular.ttf', 'arial.ttf'],
    ];

    $candidates = $map[$family] ?? [$family . '.ttf', 'DejaVuSans.ttf'];

    $dirs = [
        '/usr/share/fonts/truetype/',
        '/usr/share/fonts/truetype/dejavu/',
        '/usr/share/fonts/truetype/liberation/',
        '/usr/share/fonts/',
        '/usr/local/share/fonts/',
    ];

    foreach ($candidates as $file) {
        foreach ($dirs as $dir) {
            $path = $dir . $file;
            if (file_exists($path)) {
                return $path;
            }
        }
    }

    return '';
}
```

- [ ] **Step 2: Commit**

```bash
git add includes/Export/class-png-exporter.php
git commit -m "feat: check custom uploaded fonts in PNG export fallback"
```

---

### Task 12: Build, Test End-to-End, and Package

- [ ] **Step 1: Build**

Run: `npm run build`

Expected: Clean build with no errors.

- [ ] **Step 2: Test font upload in Docker**

1. Visit template builder → Settings → Font Picker
2. Enable fonts, upload a `.ttf` file with family name "TestFont"
3. Verify font appears in "Uploaded Fonts" list
4. Try uploading with a reserved name like "Arial" — should show error
5. Upload a `.woff2` file for a second font
6. Add both fonts to allowed fonts
7. Save template

- [ ] **Step 3: Test frontend designer**

1. Visit frontend product page with designer
2. Add text element, verify custom fonts appear in font dropdown
3. Select custom font, verify text renders correctly
4. Verify no failed Google Fonts requests in Network tab (custom fonts should not be sent to Google)

- [ ] **Step 4: Test exports**

1. Create a design with custom font text
2. Complete an order to trigger exports
3. Verify PDF export uses the custom font (not Helvetica)
4. Verify SVG export has embedded `@font-face` in `<defs>`
5. Verify PNG export renders the custom font correctly

- [ ] **Step 5: Test cleanup**

1. Delete custom font from template builder
2. Verify font file is removed from `wp-content/uploads/pf-fonts/`
3. Verify font is removed from allowed fonts list

- [ ] **Step 6: Package**

Run: `bash bin/package.sh`

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: custom font upload with server-side export support"
```

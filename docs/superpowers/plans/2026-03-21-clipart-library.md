# Clip Art Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clip art library where admins create named SVG collections and customers browse/add them to designs.

**Architecture:** Two new DB tables (`wp_pf_clipart_collections`, `wp_pf_clipart`), a new REST controller, a new validator, a new repository, admin UI in GlobalSettings, and frontend integration in AddTab. Follows identical patterns to the existing fonts system.

**Tech Stack:** PHP 8+ (PSR-4), React 18, Zustand, Fabric.js 6.x, Vite, enshrined/svg-sanitize

---

## File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Create | `includes/Database/class-migration500.php` | Create `wp_pf_clipart_collections` and `wp_pf_clipart` tables |
| Modify | `includes/Database/class-db-manager.php` | Register Migration500 |
| Create | `includes/Security/class-clipart-validator.php` | SVG validation + storage for clip art |
| Create | `includes/Database/class-clipart-repository.php` | CRUD for collections and items |
| Create | `includes/API/class-rest-clipart.php` | REST endpoints for clip art |
| Modify | `includes/class-product-forge.php` | Register RestClipart in `init_api()` |
| Modify | `admin/js/template-builder/src/api/templateApi.js` | Add `clipartApi` |
| Modify | `admin/js/template-builder/src/store/useTemplateStore.js` | Add `clipartCollections` state |
| Modify | `admin/js/template-builder/src/App.jsx` | Load collections on mount |
| Modify | `admin/js/template-builder/src/components/GlobalSettings.jsx` | Add Clip Art fieldset + CollectionManager |
| Modify | `admin/js/template-builder/src/builder.css` | Styles for CollectionManager |
| Modify | `frontend/js/designer/src/api/designerApi.js` | Add `fetchClipartCollections()` |
| Modify | `frontend/js/designer/src/store/useDesignerStore.js` | Add `clipartItems` state |
| Modify | `frontend/js/designer/src/App.jsx` | Load clip art on mount |
| Modify | `frontend/js/designer/src/components/tabs/AddTab.jsx` | Clip Art section |
| Modify | `frontend/js/designer/src/components/DesignerCanvas.jsx` | `addClipartToCanvas()` |
| Modify | `frontend/js/designer/src/designer.css` | Clip art grid styles |

---

### Task 1: Database Migration

**Files:**
- Create: `includes/Database/class-migration500.php`
- Modify: `includes/Database/class-db-manager.php`

- [ ] **Step 1: Create Migration500**

```php
<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class Migration500 {

    public function up(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        $collections_table = $wpdb->prefix . 'pf_clipart_collections';
        $clipart_table     = $wpdb->prefix . 'pf_clipart';

        $sql = "CREATE TABLE IF NOT EXISTS `{$collections_table}` (
            `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `name`       VARCHAR(255)    NOT NULL,
            `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`)
        ) ENGINE=InnoDB {$charset};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);

        $sql2 = "CREATE TABLE IF NOT EXISTS `{$clipart_table}` (
            `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `collection_id` BIGINT UNSIGNED NOT NULL,
            `name`          VARCHAR(255)    NOT NULL,
            `svg_url`       VARCHAR(2048)   NOT NULL,
            `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_collection` (`collection_id`)
        ) ENGINE=InnoDB {$charset};";

        dbDelta($sql2);

        // Add foreign key via raw query (dbDelta doesn't handle FK reliably)
        $wpdb->query(
            "ALTER TABLE `{$clipart_table}`
             ADD CONSTRAINT `fk_clipart_collection` FOREIGN KEY (`collection_id`)
             REFERENCES `{$collections_table}` (`id`) ON DELETE CASCADE"
        );
    }
}
```

- [ ] **Step 2: Register migration in DbManager**

In `includes/Database/class-db-manager.php`, add `500 => Migration500::class` to the `$migrations` array:

```php
$migrations = [
    100 => Migration100::class,
    200 => Migration200::class,
    300 => Migration300::class,
    400 => Migration400::class,
    500 => Migration500::class,
];
```

- [ ] **Step 3: Verify migration runs**

Run: Visit WordPress admin (http://localhost:8080/wp-admin/) to trigger migration.
Verify: Check phpMyAdmin (http://localhost:8081) — `wp_pf_clipart_collections` and `wp_pf_clipart` tables should exist.

- [ ] **Step 4: Commit**

```bash
git add includes/Database/class-migration500.php includes/Database/class-db-manager.php
git commit -m "feat: add clipart database migration (collections + items tables)"
```

---

### Task 2: Clip Art Validator

**Files:**
- Create: `includes/Security/class-clipart-validator.php`

- [ ] **Step 1: Create ClipartValidator**

```php
<?php
namespace ProductForge\Security;

defined('ABSPATH') || exit;

class ClipartValidator {

    private const MAX_FILE_SIZE = 512 * 1024; // 512 KB

    public static function validate_and_store(array $file): array {
        self::check_size($file);
        self::check_mime($file['tmp_name']);
        self::sanitize_svg($file['tmp_name']);

        return self::move_file($file);
    }

    private static function check_size(array $file): void {
        if ($file['size'] > self::MAX_FILE_SIZE) {
            throw new \RuntimeException('Clip art file exceeds maximum size of 512 KB.', 400);
        }
    }

    private static function check_mime(string $tmp): void {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime  = finfo_file($finfo, $tmp);
        finfo_close($finfo);

        if ($mime !== 'image/svg+xml') {
            throw new \RuntimeException("File type '{$mime}' is not allowed. Only SVG files are accepted.", 400);
        }
    }

    private static function sanitize_svg(string $tmp): void {
        if (!class_exists(\enshrined\svgSanitize\Sanitizer::class)) {
            throw new \RuntimeException('SVG sanitizer not available.', 500);
        }
        $sanitizer = new \enshrined\svgSanitize\Sanitizer();
        $dirty     = file_get_contents($tmp);
        $clean     = $sanitizer->sanitize($dirty);
        if ($clean === false) {
            throw new \RuntimeException('SVG file could not be sanitized.', 400);
        }
        file_put_contents($tmp, $clean);
    }

    private static function move_file(array $file): array {
        $upload_dir = wp_upload_dir();
        $dir        = $upload_dir['basedir'] . '/pf-clipart';
        wp_mkdir_p($dir);

        $filename = bin2hex(random_bytes(8)) . '.svg';
        $dest     = $dir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            throw new \RuntimeException('Failed to move uploaded clip art file.', 500);
        }

        return [
            'svg_url' => $upload_dir['baseurl'] . '/pf-clipart/' . $filename,
        ];
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add includes/Security/class-clipart-validator.php
git commit -m "feat: add ClipartValidator for SVG upload validation"
```

---

### Task 3: Clip Art Repository

**Files:**
- Create: `includes/Database/class-clipart-repository.php`

- [ ] **Step 1: Create ClipartRepository**

```php
<?php
namespace ProductForge\Database;

defined('ABSPATH') || exit;

class ClipartRepository {

    private static function collections_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_clipart_collections';
    }

    private static function items_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pf_clipart';
    }

    public static function list_collections(): array {
        global $wpdb;
        $ct = self::collections_table();
        $it = self::items_table();

        return $wpdb->get_results(
            "SELECT c.id, c.name, c.created_at, COUNT(i.id) AS item_count
             FROM `{$ct}` c
             LEFT JOIN `{$it}` i ON i.collection_id = c.id
             GROUP BY c.id
             ORDER BY c.name",
            ARRAY_A
        );
    }

    public static function get_collection(int $id): ?array {
        global $wpdb;
        $ct = self::collections_table();
        $it = self::items_table();

        $collection = $wpdb->get_row(
            $wpdb->prepare("SELECT id, name, created_at FROM `{$ct}` WHERE id = %d", $id),
            ARRAY_A
        );

        if (!$collection) {
            return null;
        }

        $collection['items'] = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT id, name, svg_url, created_at FROM `{$it}` WHERE collection_id = %d ORDER BY name",
                $id
            ),
            ARRAY_A
        );

        return $collection;
    }

    public static function create_collection(string $name): int {
        global $wpdb;

        $wpdb->insert(self::collections_table(), [
            'name' => $name,
        ], ['%s']);

        return (int) $wpdb->insert_id;
    }

    public static function collection_exists(int $id): bool {
        global $wpdb;
        $ct = self::collections_table();

        return (bool) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM `{$ct}` WHERE id = %d", $id)
        );
    }

    public static function rename_collection(int $id, string $name): bool {
        global $wpdb;

        if (!self::collection_exists($id)) {
            return false;
        }

        $wpdb->update(
            self::collections_table(),
            ['name' => $name],
            ['id' => $id],
            ['%s'],
            ['%d']
        );

        return true;
    }

    public static function delete_collection(int $id): ?array {
        global $wpdb;
        $it = self::items_table();

        if (!self::collection_exists($id)) {
            return null;
        }

        // Get all item URLs for file cleanup
        $items = $wpdb->get_results(
            $wpdb->prepare("SELECT id, svg_url FROM `{$it}` WHERE collection_id = %d", $id),
            ARRAY_A
        );

        // CASCADE will delete items, but we delete collection explicitly
        $wpdb->delete(self::collections_table(), ['id' => $id], ['%d']);

        return $items;
    }

    public static function create_item(int $collection_id, string $name, string $svg_url): int {
        global $wpdb;

        $wpdb->insert(self::items_table(), [
            'collection_id' => $collection_id,
            'name'          => $name,
            'svg_url'       => $svg_url,
        ], ['%d', '%s', '%s']);

        return (int) $wpdb->insert_id;
    }

    public static function get_item(int $id): ?array {
        global $wpdb;
        $it = self::items_table();

        return $wpdb->get_row(
            $wpdb->prepare(
                "SELECT id, collection_id, name, svg_url FROM `{$it}` WHERE id = %d",
                $id
            ),
            ARRAY_A
        );
    }

    public static function delete_item(int $id): ?array {
        global $wpdb;
        $it = self::items_table();

        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT id, svg_url FROM `{$it}` WHERE id = %d", $id),
            ARRAY_A
        );

        if (!$row) {
            return null;
        }

        $wpdb->delete($it, ['id' => $id], ['%d']);

        return $row;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add includes/Database/class-clipart-repository.php
git commit -m "feat: add ClipartRepository for collections and items CRUD"
```

---

### Task 4: REST API Controller

**Files:**
- Create: `includes/API/class-rest-clipart.php`
- Modify: `includes/class-product-forge.php`

- [ ] **Step 1: Create RestClipart**

```php
<?php
namespace ProductForge\API;

defined('ABSPATH') || exit;

use ProductForge\Database\ClipartRepository;
use ProductForge\Security\ClipartValidator;

class RestClipart {

    public function register_routes(): void {
        // Public: list collections with item count
        register_rest_route('pf/v1', '/clipart/collections', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_collections'],
            'permission_callback' => '__return_true',
        ]);

        // Admin: create collection
        register_rest_route('pf/v1', '/clipart/collections', [
            'methods'             => 'POST',
            'callback'            => [$this, 'create_collection'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Public: get collection with all items
        register_rest_route('pf/v1', '/clipart/collections/(?P<id>\d+)', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_collection'],
            'permission_callback' => '__return_true',
        ]);

        // Admin: rename collection
        register_rest_route('pf/v1', '/clipart/collections/(?P<id>\d+)', [
            'methods'             => 'PUT',
            'callback'            => [$this, 'rename_collection'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: delete collection
        register_rest_route('pf/v1', '/clipart/collections/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_collection'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: upload clip art SVG
        register_rest_route('pf/v1', '/clipart', [
            'methods'             => 'POST',
            'callback'            => [$this, 'upload_item'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Admin: delete single clip art item
        register_rest_route('pf/v1', '/clipart/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_item'],
            'permission_callback' => [$this, 'can_edit'],
        ]);
    }

    public function can_edit(): bool {
        return current_user_can('edit_pf_templates');
    }

    public function list_collections(): \WP_REST_Response {
        $collections = ClipartRepository::list_collections();
        // Cast numeric fields
        foreach ($collections as &$c) {
            $c['id']         = (int) $c['id'];
            $c['item_count'] = (int) $c['item_count'];
        }
        return rest_ensure_response($collections);
    }

    public function get_collection(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id         = (int) $request['id'];
        $collection = ClipartRepository::get_collection($id);

        if (!$collection) {
            return new \WP_Error('not_found', 'Collection not found.', ['status' => 404]);
        }

        $collection['id'] = (int) $collection['id'];
        foreach ($collection['items'] as &$item) {
            $item['id'] = (int) $item['id'];
        }

        return rest_ensure_response($collection);
    }

    public function create_collection(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $name = sanitize_text_field($request->get_param('name') ?? '');
        if (empty($name)) {
            return new \WP_Error('no_name', 'Collection name is required.', ['status' => 400]);
        }

        $id = ClipartRepository::create_collection($name);

        return new \WP_REST_Response([
            'id'         => $id,
            'name'       => $name,
            'item_count' => 0,
            'items'      => [],
        ], 201);
    }

    public function rename_collection(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id   = (int) $request['id'];
        $name = sanitize_text_field($request->get_param('name') ?? '');
        if (empty($name)) {
            return new \WP_Error('no_name', 'Collection name is required.', ['status' => 400]);
        }

        $ok = ClipartRepository::rename_collection($id, $name);
        if (!$ok) {
            return new \WP_Error('not_found', 'Collection not found.', ['status' => 404]);
        }

        return rest_ensure_response(['id' => $id, 'name' => $name]);
    }

    public function delete_collection(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id    = (int) $request['id'];
        $items = ClipartRepository::delete_collection($id);

        if ($items === null) {
            return new \WP_Error('not_found', 'Collection not found.', ['status' => 404]);
        }

        foreach ($items as $item) {
            self::delete_file($item['svg_url']);
        }

        return new \WP_REST_Response(null, 204);
    }

    public function upload_item(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $files = $request->get_file_params();
        if (empty($files['file'])) {
            return new \WP_Error('no_file', 'No SVG file uploaded.', ['status' => 400]);
        }

        $collection_id = (int) ($request->get_param('collection_id') ?? 0);
        if ($collection_id <= 0) {
            return new \WP_Error('no_collection', 'Collection ID is required.', ['status' => 400]);
        }

        $name = sanitize_text_field($request->get_param('name') ?? '');
        if (empty($name)) {
            // Derive name from filename
            $name = pathinfo($files['file']['name'], PATHINFO_FILENAME);
            $name = sanitize_text_field($name);
        }

        try {
            $result = ClipartValidator::validate_and_store($files['file']);
            $id     = ClipartRepository::create_item($collection_id, $name, $result['svg_url']);

            return new \WP_REST_Response([
                'id'            => $id,
                'collection_id' => $collection_id,
                'name'          => $name,
                'svg_url'       => $result['svg_url'],
            ], 201);
        } catch (\RuntimeException $e) {
            $code = $e->getCode() ?: 400;
            return new \WP_Error('clipart_upload_failed', $e->getMessage(), ['status' => $code]);
        }
    }

    public function delete_item(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $id  = (int) $request['id'];
        $row = ClipartRepository::delete_item($id);

        if (!$row) {
            return new \WP_Error('not_found', 'Clip art item not found.', ['status' => 404]);
        }

        self::delete_file($row['svg_url']);

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

- [ ] **Step 2: Register in ProductForge**

In `includes/class-product-forge.php`, add to `init_api()`:

```php
(new API\RestClipart())->register_routes();
```

- [ ] **Step 3: Verify API responds**

Run: `curl -s http://localhost:8080/wp-json/pf/v1/clipart/collections | jq`
Expected: `[]` (empty array)

- [ ] **Step 4: Commit**

```bash
git add includes/API/class-rest-clipart.php includes/class-product-forge.php
git commit -m "feat: add clip art REST API with collections and items endpoints"
```

---

### Task 5: Admin API Client + Store

**Files:**
- Modify: `admin/js/template-builder/src/api/templateApi.js`
- Modify: `admin/js/template-builder/src/store/useTemplateStore.js`
- Modify: `admin/js/template-builder/src/App.jsx`

- [ ] **Step 1: Add clipartApi to templateApi.js**

Add after the `paletteApi` export:

```javascript
// Clip Art
export const clipartApi = {
  listCollections: () => request('GET', 'clipart/collections'),
  createCollection: (name) => request('POST', 'clipart/collections', { name }),
  getCollection: (id) => request('GET', `clipart/collections/${id}`),
  renameCollection: (id, name) => request('PUT', `clipart/collections/${id}`, { name }),
  deleteCollection: (id) => request('DELETE', `clipart/collections/${id}`),

  upload: async (file, collectionId, name) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('collection_id', collectionId);
    if (name) formData.append('name', name);

    const res = await fetch(`${base()}pf/v1/clipart`, {
      method: 'POST',
      headers: { 'X-WP-Nonce': nonce() },
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || 'Clip art upload failed');
    return data;
  },

  deleteItem: (id) => request('DELETE', `clipart/${id}`),
};
```

- [ ] **Step 2: Add store state to useTemplateStore.js**

Add to the store:

```javascript
clipartCollections: [],
setClipartCollections: (collections) => set({ clipartCollections: collections }),
```

- [ ] **Step 3: Load collections on mount in App.jsx**

Import `clipartApi` and add to the mount effect (alongside palette loading):

```javascript
clipartApi.listCollections().then((c) => setClipartCollections(c)).catch(() => {});
```

- [ ] **Step 4: Commit**

```bash
git add admin/js/template-builder/src/api/templateApi.js admin/js/template-builder/src/store/useTemplateStore.js admin/js/template-builder/src/App.jsx
git commit -m "feat: add clip art admin API client and store state"
```

---

### Task 6: Admin UI — GlobalSettings Clip Art Fieldset + CollectionManager

**Files:**
- Modify: `admin/js/template-builder/src/components/GlobalSettings.jsx`
- Modify: `admin/js/template-builder/src/builder.css`

- [ ] **Step 1: Add Clip Art fieldset to GlobalSettings**

In `GlobalSettings.jsx`, import `clipartApi` at the top:

```javascript
import { fontApi, paletteApi, clipartApi } from '../api/templateApi';
```

Destructure from store (add `clipartCollections, setClipartCollections`):

```javascript
const { globalConfig, setGlobalConfig, colorPalettes, setColorPalettes, clipartCollections, setClipartCollections } = useTemplateStore();
```

Add state for collection manager:

```javascript
const [showCollectionManager, setShowCollectionManager] = useState(false);
```

Add a new fieldset after the Font Picker fieldset (before Image Upload Restrictions):

```jsx
<fieldset className="pf-settings__fieldset">
  <legend>{ __( 'Clip Art', 'productforge' ) }</legend>
  <label className="pf-settings__check">
    <input type="checkbox" checked={globalConfig.clipart_enabled || false}
      onChange={(e) => update('clipart_enabled', e.target.checked)} />
    { __( 'Enable clip art library', 'productforge' ) }
  </label>
  {globalConfig.clipart_enabled && (
    <>
      <label className="pf-settings__check">
        <input type="checkbox" checked={globalConfig.clipart_recolor !== false}
          onChange={(e) => update('clipart_recolor', e.target.checked)} />
        { __( 'Allow recoloring clip art', 'productforge' ) }
      </label>

      {clipartCollections.length > 0 && (
        <div className="pf-settings__clipart-collections">
          <span className="pf-settings__label">{ __( 'Available collections:', 'productforge' ) }</span>
          {clipartCollections.map((c) => {
            const allowed = globalConfig.allowed_clipart_collections || [];
            const isSelected = allowed.length === 0 || allowed.includes(c.id);
            return (
              <label key={c.id} className="pf-settings__check">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    let next;
                    if (e.target.checked) {
                      // If all were selected (empty array), switch to explicit and add this one
                      if (allowed.length === 0) {
                        next = clipartCollections.map((col) => col.id);
                      } else {
                        next = [...allowed, c.id];
                      }
                      // If all are now selected, go back to empty (= all)
                      if (next.length === clipartCollections.length) {
                        next = [];
                      }
                    } else {
                      // If all were selected (empty array), switch to all-except-this
                      if (allowed.length === 0) {
                        next = clipartCollections.filter((col) => col.id !== c.id).map((col) => col.id);
                      } else {
                        next = allowed.filter((id) => id !== c.id);
                      }
                    }
                    update('allowed_clipart_collections', next);
                  }}
                />
                {c.name} ({c.item_count})
              </label>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="button button-small"
        onClick={() => setShowCollectionManager(!showCollectionManager)}
        style={{ marginTop: 8 }}
      >
        { showCollectionManager ? __( 'Close', 'productforge' ) : __( 'Manage Collections', 'productforge' ) }
      </button>

      {showCollectionManager && (
        <CollectionManager
          collections={clipartCollections}
          onUpdate={setClipartCollections}
        />
      )}
    </>
  )}
</fieldset>
```

- [ ] **Step 2: Create CollectionManager component**

Add this function component at the bottom of `GlobalSettings.jsx`:

```jsx
function CollectionManager({ collections, onUpdate }) {
  const [newName, setNewName] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [collectionItems, setCollectionItems] = useState({});

  const refreshCollections = async () => {
    const updated = await clipartApi.listCollections();
    onUpdate(updated);
    return updated;
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      await clipartApi.createCollection(newName.trim());
      await refreshCollections();
      setNewName('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(__('Delete this collection and all its clip art?', 'productforge'))) return;
    setError(null);
    try {
      await clipartApi.deleteCollection(id);
      await refreshCollections();
      setCollectionItems((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRename = async (id) => {
    if (!editName.trim()) return;
    setError(null);
    try {
      await clipartApi.renameCollection(id, editName.trim());
      await refreshCollections();
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!collectionItems[id]) {
      try {
        const data = await clipartApi.getCollection(id);
        setCollectionItems((prev) => ({ ...prev, [id]: data.items }));
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const handleUpload = async (e, collectionId) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';

    setIsUploading(true);
    setError(null);

    try {
      const results = [];
      for (const file of files) {
        const result = await clipartApi.upload(file, collectionId);
        results.push(result);
      }
      // Update local items cache
      setCollectionItems((prev) => ({
        ...prev,
        [collectionId]: [...(prev[collectionId] || []), ...results],
      }));
      await refreshCollections();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteItem = async (itemId, collectionId) => {
    setError(null);
    try {
      await clipartApi.deleteItem(itemId);
      setCollectionItems((prev) => ({
        ...prev,
        [collectionId]: (prev[collectionId] || []).filter((i) => i.id !== itemId),
      }));
      await refreshCollections();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="pf-collection-manager">
      <h4>{ __( 'Clip Art Collections', 'productforge' ) }</h4>
      {error && <p className="pf-settings__error">{error}</p>}

      {collections.map((c) => (
        <div key={c.id} className="pf-collection-manager__item">
          <div className="pf-collection-manager__header">
            {editingId === c.id ? (
              <div className="pf-collection-manager__edit-row">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="pf-settings__input"
                  onKeyDown={(e) => e.key === 'Enter' && handleRename(c.id)}
                />
                <button type="button" className="button button-primary button-small" onClick={() => handleRename(c.id)}>
                  { __( 'Save', 'productforge' ) }
                </button>
                <button type="button" className="button button-small" onClick={() => setEditingId(null)}>
                  { __( 'Cancel', 'productforge' ) }
                </button>
              </div>
            ) : (
              <div className="pf-collection-manager__row">
                <button
                  type="button"
                  className="pf-collection-manager__expand"
                  onClick={() => handleExpand(c.id)}
                >
                  {expandedId === c.id ? '▾' : '▸'} <strong>{c.name}</strong> ({c.item_count})
                </button>
                <div className="pf-collection-manager__actions">
                  <button type="button" className="button button-small" onClick={() => { setEditingId(c.id); setEditName(c.name); }}>
                    { __( 'Rename', 'productforge' ) }
                  </button>
                  <button type="button" className="button button-small pf-btn--danger" onClick={() => handleDelete(c.id)}>
                    { __( 'Delete', 'productforge' ) }
                  </button>
                </div>
              </div>
            )}
          </div>

          {expandedId === c.id && (
            <div className="pf-collection-manager__content">
              <div className="pf-clipart-grid">
                {(collectionItems[c.id] || []).map((item) => (
                  <div key={item.id} className="pf-clipart-grid__item">
                    <img src={item.svg_url} alt={item.name} title={item.name} />
                    <button
                      type="button"
                      className="pf-clipart-grid__remove"
                      onClick={() => handleDeleteItem(item.id, c.id)}
                      aria-label={`Delete ${item.name}`}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
              <label className="button button-small pf-collection-manager__upload-btn">
                {isUploading ? __( 'Uploading…', 'productforge' ) : __( 'Upload SVGs', 'productforge' )}
                <input
                  type="file"
                  accept=".svg"
                  multiple
                  onChange={(e) => handleUpload(e, c.id)}
                  disabled={isUploading}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          )}
        </div>
      ))}

      {/* Create new collection */}
      <div className="pf-collection-manager__new">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={ __( 'New collection name', 'productforge' ) }
          className="pf-settings__input"
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <button
          type="button"
          className="button button-primary button-small"
          onClick={handleCreate}
          disabled={!newName.trim()}
        >
          { __( 'Create', 'productforge' ) }
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add CSS styles**

Add to `admin/js/template-builder/src/builder.css`:

```css
/* Collection Manager */
.pf-collection-manager { margin-top: 12px; border: 1px solid #ddd; border-radius: 4px; padding: 12px; }
.pf-collection-manager h4 { margin: 0 0 8px; }
.pf-collection-manager__item { border-bottom: 1px solid #eee; padding: 8px 0; }
.pf-collection-manager__item:last-child { border-bottom: none; }
.pf-collection-manager__row { display: flex; align-items: center; gap: 8px; }
.pf-collection-manager__edit-row { display: flex; align-items: center; gap: 8px; }
.pf-collection-manager__expand { background: none; border: none; cursor: pointer; padding: 0; font-size: 14px; color: inherit; }
.pf-collection-manager__actions { margin-left: auto; display: flex; gap: 4px; }
.pf-collection-manager__content { margin-top: 8px; padding-left: 16px; }
.pf-collection-manager__upload-btn { margin-top: 8px; cursor: pointer; }
.pf-collection-manager__new { margin-top: 12px; display: flex; gap: 8px; align-items: center; }

/* Clip Art Grid */
.pf-clipart-grid { display: grid; grid-template-columns: repeat(auto-fill, 48px); gap: 4px; }
.pf-clipart-grid__item { position: relative; width: 48px; height: 48px; border: 1px solid #ddd; border-radius: 3px; overflow: hidden; }
.pf-clipart-grid__item img { width: 100%; height: 100%; object-fit: contain; }
.pf-clipart-grid__remove { position: absolute; top: -2px; right: -2px; width: 16px; height: 16px; border: none; background: #dc3232; color: #fff; border-radius: 50%; font-size: 10px; line-height: 16px; padding: 0; cursor: pointer; display: none; }
.pf-clipart-grid__item:hover .pf-clipart-grid__remove { display: block; }

/* Clip Art collection checkboxes */
.pf-settings__clipart-collections { margin-top: 8px; }
```

- [ ] **Step 4: Verify admin UI**

Run: `npm run dev` and visit template builder. The Clip Art fieldset should appear after Font Picker.
Verify: Create a collection, upload SVGs, expand to see grid, delete items.

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/components/GlobalSettings.jsx admin/js/template-builder/src/builder.css
git commit -m "feat: add clip art admin UI with CollectionManager component"
```

---

### Task 7: Frontend — Designer Store + API

**Files:**
- Modify: `frontend/js/designer/src/api/designerApi.js`
- Modify: `frontend/js/designer/src/store/useDesignerStore.js`

- [ ] **Step 1: Add fetchClipartCollections to designerApi.js**

Add after the `fetchCustomFonts` function:

```javascript
export async function fetchClipartCollections() {
  const res = await fetch(apiUrl('/clipart/collections'));
  if (!res.ok) return [];
  const collections = await res.json();
  // Fetch items for each collection
  const withItems = await Promise.all(
    collections.map(async (c) => {
      const res2 = await fetch(apiUrl(`/clipart/collections/${c.id}`));
      if (!res2.ok) return { ...c, items: [] };
      return res2.json();
    })
  );
  return withItems;
}
```

- [ ] **Step 2: Add store state to useDesignerStore.js**

Add to the store:

```javascript
clipartCollections: [],
setClipartCollections: (collections) => set({ clipartCollections: collections }),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/js/designer/src/api/designerApi.js frontend/js/designer/src/store/useDesignerStore.js
git commit -m "feat: add clip art frontend API and store state"
```

---

### Task 8: Frontend — Load Clip Art on Mount

**Files:**
- Modify: `frontend/js/designer/src/App.jsx`

- [ ] **Step 1: Import fetchClipartCollections**

Add to import line:

```javascript
import { loadTemplate, loadDesign, createDesign, saveDesignView, fetchCustomFonts, fetchClipartCollections } from './api/designerApi';
```

- [ ] **Step 2: Load clip art after template loads**

In the mount `useEffect`, after fonts are loaded and template is set, add:

```javascript
// Load clip art collections if enabled
if (tmpl.global_config?.clipart_enabled) {
  fetchClipartCollections().then((collections) => {
    const allowed = tmpl.global_config.allowed_clipart_collections || [];
    const filtered = allowed.length > 0
      ? collections.filter((c) => allowed.includes(c.id))
      : collections;
    useDesignerStore.getState().setClipartCollections(filtered);
  }).catch(() => {});
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/js/designer/src/App.jsx
git commit -m "feat: load clip art collections in frontend designer on mount"
```

---

### Task 9: Frontend — AddTab Clip Art Section

**Files:**
- Modify: `frontend/js/designer/src/components/tabs/AddTab.jsx`
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`
- Modify: `frontend/js/designer/src/designer.css`

- [ ] **Step 1: Add addClipartToCanvas to DesignerCanvas**

In `DesignerCanvas.jsx`, add a new callback after `handleFileUpload`:

```javascript
const addClipartToCanvas = useCallback(async (svgUrl) => {
  try {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const img = await FabricImage.fromURL(svgUrl, { crossOrigin: 'anonymous' });
    const zoneIdx = findFirstZoneForType('svg');

    if (zoneIdx >= 0) {
      const zone = zones[zoneIdx];
      img.scaleToWidth(Math.min(img.width, zone.width * 0.8));
      img.set({
        left: zone.x + zone.width / 2 - (img.getScaledWidth() / 2),
        top:  zone.y + zone.height / 2 - (img.getScaledHeight() / 2),
      });
    } else {
      img.scaleToWidth(Math.min(img.width, canvas.width * 0.5));
      img.set({
        left: canvas.width / 2 - img.getScaledWidth() / 2,
        top:  canvas.height / 2 - img.getScaledHeight() / 2,
      });
    }

    // Store clipartNoRecolor in data so it survives JSON serialization
    const clipartRecolor = template?.global_config?.clipart_recolor;
    img.set({
      data: {
        elementType: 'svg',
        zoneIndex: zoneIdx,
        ...(clipartRecolor === false ? { clipartNoRecolor: true } : {}),
      },
    });

    applyPermissions(img, 'svg');

    if (zoneIdx >= 0) applyZoneClip(img, zoneIdx);
    canvas.add(img);
    canvas.setActiveObject(img);

    if (zoneIdx >= 0) clampToZone(img);

    canvas.renderAll();
    snapshotView(currentViewIndex, canvas.toJSON(['data']));
  } catch (err) {
    setError(err.message);
  }
}, [findFirstZoneForType, zones, template, applyPermissions, applyZoneClip, clampToZone, snapshotView, currentViewIndex, setError]);
```

Expose via store, similar to `triggerFileUpload`:

```javascript
const setAddClipart = useDesignerStore((s) => s.setAddClipart);

useEffect(() => {
  setAddClipart(addClipartToCanvas);
}, [addClipartToCanvas, setAddClipart]);
```

Add to `useDesignerStore.js`:

```javascript
addClipart: null,
setAddClipart: (fn) => set({ addClipart: fn }),
```

- [ ] **Step 2: Update AddTab with Clip Art section**

Update `AddTab.jsx` — add clip art imports, store fields, and the clip art section below the existing buttons. Full updated file:

```jsx
import React from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../../store/useDesignerStore';

export default function AddTab() {
  const { template, currentViewIndex, activeTool, setActiveTool, triggerFileUpload, clipartCollections, addClipart } = useDesignerStore();

  const currentView = template?.views?.[currentViewIndex];
  const zones = currentView?.zones_config || [];
  const globalConfig = template?.global_config || {};

  const isTypeAllowed = (type) => {
    if (zones.length === 0) return true;
    return zones.some((z) => (z.allowed_types || []).includes(type));
  };

  const handleToolClick = (tool) => {
    if (activeTool === tool) {
      setActiveTool('select');
    } else if (tool === 'add-image' || tool === 'add-svg') {
      const elementType = tool === 'add-image' ? 'image' : 'svg';
      triggerFileUpload?.(elementType);
    } else {
      setActiveTool(tool);
    }
  };

  const handleClipartClick = (svgUrl) => {
    addClipart?.(svgUrl);
  };

  const showClipart = globalConfig.clipart_enabled && isTypeAllowed('svg') && clipartCollections.length > 0;

  return (
    <div className="pf-sidebar__tab-content">
      <h3 className="pf-sidebar__heading">{__('Add Element', 'productforge')}</h3>
      <div className="pf-add-tools">
        {isTypeAllowed('text') && (
          <button
            type="button"
            className={`pf-add-tools__btn${activeTool === 'add-text' ? ' pf-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-text')}
            aria-label={__('Add text element', 'productforge')}
            title={__('Add text', 'productforge')}
          >
            {__('Text', 'productforge')}
          </button>
        )}
        {isTypeAllowed('image') && (
          <button
            type="button"
            className={`pf-add-tools__btn${activeTool === 'add-image' ? ' pf-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-image')}
            aria-label={__('Add image element', 'productforge')}
            title={__('Add image (jpg, png, webp)', 'productforge')}
          >
            {__('Image', 'productforge')}
          </button>
        )}
        {isTypeAllowed('svg') && (
          <button
            type="button"
            className={`pf-add-tools__btn${activeTool === 'add-svg' ? ' pf-add-tools__btn--active' : ''}`}
            onClick={() => handleToolClick('add-svg')}
            aria-label={__('Add SVG element', 'productforge')}
            title={__('Add SVG', 'productforge')}
          >
            {__('SVG', 'productforge')}
          </button>
        )}
      </div>

      {showClipart && (
        <div className="pf-clipart-section">
          <h3 className="pf-sidebar__heading">{__('Clip Art', 'productforge')}</h3>
          {clipartCollections.map((collection) => (
            <div key={collection.id} className="pf-clipart-collection">
              <h4 className="pf-clipart-collection__name">{collection.name}</h4>
              <div className="pf-clipart-collection__grid">
                {(collection.items || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="pf-clipart-collection__item"
                    onClick={() => handleClipartClick(item.svg_url)}
                    title={item.name}
                    aria-label={item.name}
                  >
                    <img src={item.svg_url} alt={item.name} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add frontend CSS**

Add to `frontend/js/designer/src/designer.css`:

```css
/* Clip Art section in AddTab */
.pf-clipart-section { margin-top: 16px; }
.pf-clipart-collection { margin-bottom: 12px; }
.pf-clipart-collection__name { font-size: 12px; font-weight: 600; margin: 0 0 4px; color: #555; }
.pf-clipart-collection__grid { display: grid; grid-template-columns: repeat(4, 48px); gap: 4px; }
.pf-clipart-collection__item { width: 48px; height: 48px; border: 1px solid #ddd; border-radius: 3px; background: #fff; cursor: pointer; padding: 2px; }
.pf-clipart-collection__item:hover { border-color: #0073aa; box-shadow: 0 0 0 1px #0073aa; }
.pf-clipart-collection__item img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
```

- [ ] **Step 4: Handle recolor permission in ElementTab**

In `frontend/js/designer/src/components/tabs/ElementTab.jsx`, in the `ImageProperties` component, update the recolor condition to also check `clipartNoRecolor` from the data property (which survives JSON serialization):

```jsx
{type === 'svg' && perms.recolor !== false && !fabricObj.data?.clipartNoRecolor && (
```

This works because `addClipartToCanvas` stores `clipartNoRecolor: true` in `data` when `clipart_recolor` is false in template config. The `data` property is serialized by `canvas.toJSON(['data'])` so it persists across save/load.

- [ ] **Step 5: Verify frontend**

Run: `npm run dev`, create a template with clip art enabled and a collection. Open the product page.
Verify: Clip art section appears in Add tab with collection headings and SVG thumbnails. Clicking a thumbnail adds the SVG to the canvas.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/designer/src/components/tabs/AddTab.jsx frontend/js/designer/src/components/DesignerCanvas.jsx frontend/js/designer/src/components/tabs/ElementTab.jsx frontend/js/designer/src/store/useDesignerStore.js frontend/js/designer/src/designer.css
git commit -m "feat: add clip art browsing and insertion in frontend designer"
```

---

### Task 10: Final Integration Test

- [ ] **Step 1: End-to-end test**

1. Visit admin template builder
2. Create a new clip art collection "Paw Prints"
3. Upload 3-4 SVG files to the collection
4. Enable clip art on a template, verify collection checkbox
5. Open the product page in the frontend
6. Verify clip art section appears in Add tab
7. Click a clip art SVG — it should appear on the canvas
8. Select it — verify recolor works (or doesn't, based on setting)
9. Save the design
10. Reload — verify clip art SVG persists in the saved design

- [ ] **Step 2: Test recolor disabled**

1. In admin, uncheck "Allow recoloring clip art"
2. Save template
3. Open frontend, add clip art
4. Select it — tint color control should NOT appear

- [ ] **Step 3: Test collection filtering**

1. Create 2 collections, upload SVGs to both
2. In template settings, check only one collection
3. Open frontend — only the selected collection should appear

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete clip art library implementation"
```

# Clip Art Library

## Summary

Add a clip art library system where admins create named collections of SVG files, and customers can browse and add them to their designs. Follows the same architectural patterns as the existing custom fonts system.

## Data Model

### Table: `wp_pf_clipart_collections`

| Column | Type | Purpose |
|--------|------|---------|
| id | BIGINT UNSIGNED PK AUTO_INCREMENT | Primary key |
| name | VARCHAR(255) NOT NULL | Collection display name |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | Creation timestamp |

### Table: `wp_pf_clipart`

| Column | Type | Purpose |
|--------|------|---------|
| id | BIGINT UNSIGNED PK AUTO_INCREMENT | Primary key |
| collection_id | BIGINT UNSIGNED NOT NULL | FK to collections table |
| name | VARCHAR(255) NOT NULL | Display name (derived from filename) |
| svg_url | VARCHAR(2048) NOT NULL | URL to stored SVG file |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | Creation timestamp |

Both tables use InnoDB. Foreign key: `clipart.collection_id` references `clipart_collections.id` with CASCADE delete.

File storage: `/wp-content/uploads/pf-clipart/{hex16}.svg`

SVG validation: MIME check via `finfo_file()`, sanitized with `enshrined/svg-sanitize` (same as existing SVG upload flow).

## Template Configuration

New fields in `globalConfig`:

```json
{
  "clipart_enabled": false,
  "clipart_recolor": true,
  "allowed_clipart_collections": []
}
```

- `clipart_enabled` — show clip art section in frontend Add tab
- `clipart_recolor` — whether customers can tint/recolor added clip art SVGs
- `allowed_clipart_collections` — array of collection IDs; empty array means all collections available

## REST API

Namespace: `pf/v1`

### Collections

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/clipart/collections` | GET | Public | List all collections (with item count) |
| `/clipart/collections` | POST | `edit_pf_templates` | Create collection (name) |
| `/clipart/collections/{id}` | GET | Public | Get collection with all items |
| `/clipart/collections/{id}` | PUT | `edit_pf_templates` | Rename collection |
| `/clipart/collections/{id}` | DELETE | `edit_pf_templates` | Delete collection + all items + files |

### Items

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/clipart` | POST | `edit_pf_templates` | Upload SVG to collection (multipart form) |
| `/clipart/{id}` | DELETE | `edit_pf_templates` | Delete single clip art item + file |

POST `/clipart` accepts:
- `file` — SVG file (multipart)
- `collection_id` — target collection ID
- `name` — optional display name (defaults to filename without extension)

## PHP Classes

### `includes/Database/class-clipart-repository.php`

Repository for both tables. Methods:
- `list_collections()` — returns all collections with item count
- `get_collection(int $id)` — returns collection with all items
- `create_collection(string $name)` — returns new ID
- `rename_collection(int $id, string $name)` — update name
- `delete_collection(int $id)` — deletes collection, items, and files on disk
- `create_item(int $collection_id, string $name, string $svg_url)` — returns new ID
- `get_item(int $id)` — returns single item
- `delete_item(int $id)` — deletes item and file on disk

### `includes/Security/class-clipart-validator.php`

Validates uploaded clip art SVGs:
- Max file size: 512 KB (clip art should be small)
- Allowed MIME: `image/svg+xml` only
- SVG sanitization via `enshrined\svgSanitize\Sanitizer`
- Storage path: `wp-content/uploads/pf-clipart/`
- Filename: `bin2hex(random_bytes(8)).svg`

### `includes/API/class-rest-clipart.php`

REST controller. Registered in `ProductForge::init_api()`.

### Database Migration

New migration class (next sequence number after existing migrations). Creates both tables with InnoDB engine and foreign key constraint.

## Admin UI

### GlobalSettings.jsx — "Clip Art" fieldset

Position: after the Color Picker fieldset.

**Controls:**
1. Checkbox: "Enable clip art" → `clipart_enabled`
2. Checkbox: "Allow recoloring" → `clipart_recolor` (only visible when enabled)
3. Multi-select or checkbox list: select allowed collections (only visible when enabled)
4. Button: "Manage Collections" → opens inline CollectionManager

### CollectionManager component

Same pattern as PaletteManager (inline panel in GlobalSettings).

**Features:**
- List existing collections with item count
- Create new collection (name input + create button)
- Expand collection to see SVG grid
- Upload SVGs to collection (file picker, multiple files, `accept=".svg"`)
- Delete individual SVGs (click × on thumbnail)
- Rename collection (inline edit)
- Delete collection (with confirmation)

**SVG thumbnails:** Rendered as `<img src={item.svg_url}>` at 48×48px with object-fit contain.

### Store changes

Add to `useTemplateStore.js`:
- `clipartCollections: []` — loaded on mount
- `setClipartCollections(collections)` — setter

### API additions

Add to `templateApi.js`:
```javascript
export const clipartApi = {
  listCollections: () => request('GET', 'clipart/collections'),
  createCollection: (name) => request('POST', 'clipart/collections', { name }),
  renameCollection: (id, name) => request('PUT', `clipart/collections/${id}`, { name }),
  deleteCollection: (id) => request('DELETE', `clipart/collections/${id}`),
  getCollection: (id) => request('GET', `clipart/collections/${id}`),
  upload: async (file, collectionId, name) => { /* FormData upload */ },
  deleteItem: (id) => request('DELETE', `clipart/${id}`),
};
```

## Frontend Designer

### Data Loading

In `DesignerApp.jsx` (or equivalent init):
- Fetch clip art collections on mount (only if `clipart_enabled`)
- Store in designer store: `clipartItems: []`
- Filter by `allowed_clipart_collections` from template config

### AddTab.jsx — Clip Art section

Below existing Text/Image/SVG buttons:

```
─── Clip Art ──────────────
[Collection Name]
[svg] [svg] [svg] [svg]
[svg] [svg] [svg]

[Another Collection]
[svg] [svg] [svg] [svg]
```

- Section heading "Clip Art" (only shown when `clipart_enabled` and items exist)
- Collection name as subheading
- Grid of 48×48px SVG thumbnails with 4px gap
- Click thumbnail → add SVG to canvas

### Canvas Integration

When user clicks a clip art thumbnail:
1. Fetch SVG from URL
2. Create Fabric.js image via `FabricImage.fromURL(svgUrl, { crossOrigin: 'anonymous' })`
3. Assign `data: { elementType: 'svg', zoneIndex }` — same as user-uploaded SVGs
4. Apply permissions from `globalConfig.permissions.svg`
5. If `clipart_recolor` is false, override: `permissions.svg.recolor = false`
6. Apply zone clipping if applicable
7. Scale to fit zone (80% of zone width, same as existing image add)

No file upload needed — SVG is already hosted on the server.

### Store changes

Add to `useDesignerStore.js`:
- `clipartItems: []` — all available clip art (filtered by template config)
- `setClipartItems(items)` — setter

## Security

- All SVGs sanitized on upload (strip `<script>`, `on*` attributes, `<use>` with external refs, `foreignObject`, `data:` URIs)
- Admin-only upload/delete endpoints (capability: `edit_pf_templates`)
- MIME validation via `finfo_file()` — never trust file extensions
- Random filenames prevent enumeration
- No rate limiting needed for admin uploads (unlike customer uploads)

## Not in scope

- Drag-and-drop upload (file picker is sufficient)
- Search/filter within collections (collections are small enough to browse)
- SVG editing/cropping before adding
- Customer-uploaded clip art (admin-only)
- Pricing per clip art item (uses existing per-SVG pricing from globalConfig)

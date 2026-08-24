# LightBurn Bitmaps, mm Ruler, Text Placement & Layer Locking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import LightBurn bitmap images as opacity-controlled background layers, add a millimetre ruler to both canvases, place customer text centred and draggable inside the boundary, and make the lock toggle govern the boundary only.

**Architecture:** Four independent phases. Phase 1 extends the pure `.lbrn2` parser with a `Bitmap` branch, uploads the embedded PNG to the WordPress media library, and threads a new `image` layer through both canvases while excluding it from every export render and from both price counters. Phase 2 adds a shared DOM ruler that derives its scale by measuring the rendered canvas element, avoiding any coupling to the Fabric zoom loop. Phase 3 changes how text is created and constrained. Phase 4 unlocks template layers for customers and fixes the containment clamp that makes them snap back.

**Tech Stack:** React 18, Zustand, Fabric.js 6.x, Vite, Jest (jsdom) for JS, PHPUnit (inside Docker) for PHP, WordPress REST API.

**Spec:** `docs/superpowers/specs/2026-08-24-bitmap-ruler-text-design.md`

## Global Constraints

Copied verbatim from the spec and from CLAUDE.md. Every task's requirements implicitly include this section.

- **PHP namespace** `Snelgraveren\ProductDesigner\`, sub-namespace per directory. `namespace` comes before `defined('ABSPATH') || exit;`.
- **Never store images as data URIs in Fabric.js JSON** — use URLs.
- **Fabric.js JSON serialization:** always `canvas.toJSON(['data'])`, never bare `toJSON()`.
- **Fabric.js 6.x type names:** runtime types are lowercase-hyphenated (`'i-text'`, `'image'`), JSON uses PascalCase (`'IText'`, `'Image'`). Compare case-insensitively at runtime.
- **Mobile detection** uses `matchMedia` via the existing `useIsMobile` hook, never `window.innerWidth`, never evaluated at module level.
- **No `stopPropagation` on `#pf-designer-root`.**
- **Verify hook imports** — a missing `useRef`/`useState` import crashes the whole React tree with no visible error.
- **Existing customer designs are never retro-modified.** New rules apply to new edits.
- **The bitmap layer is the only layer that stays locked for the customer.** Every other layer is movable within the boundary.
- **The minimum font size is expressed in millimetres**, converted per view via `canvas_width / width_mm`.
- **No ruler and no font-size minimum when `width_mm <= 0`.**
- **Only PNG bitmaps are supported** in this iteration; any other embedded format is skipped with a warning.

**Commands**

| What | Command |
|---|---|
| JS tests | `npm test` |
| One JS test file | `npx jest tests/js/utils/lbrnParser.test.js` |
| Build | `npm run build` |
| Dev server | `npm run dev` |
| Start environment | `docker compose up -d` |
| PHP lint | `docker compose exec -T wordpress php -l /var/www/html/wp-content/plugins/productforge/includes/<path>.php` |
| PHP tests | `docker compose exec wordpress bash -c "cd wp-content/plugins/productforge && phpunit"` |

**Docker is not running as of writing.** Ask the user to start Docker before any task that needs it (Tasks 6, 12, and every manual verification). Do not skip those steps.

**In-container plugin path is `productforge`, not the slug.**

---

# Phase 1 — Bitmap pipeline (spec §1, §2, §3)

## Task 1: Parse LightBurn `Bitmap` shapes

**Files:**
- Modify: `admin/js/template-builder/src/utils/lbrnParser.js`
- Test: `tests/js/utils/lbrnParser.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `decodePngSize(base64: string) => { width: number, height: number } | null` — exported from `lbrnParser.js`.
  - `parseLbrn` now emits layer descriptors of `type: 'image'` with the shape:
    ```
    { type: 'image', dataUrl: string, pngWidth: number, pngHeight: number,
      left: number, top: number, originX: 'center', originY: 'center',
      scaleX: number, scaleY: number, angle: number }
    ```
    `left`/`top` are the **centre** of the image in canvas pixels, not the top-left. Task 2 consumes `dataUrl` and replaces it with `src`; Tasks 3 and 4 consume `originX`/`originY`.

**Background for the implementer:**

A LightBurn bitmap shape looks like this:

```xml
<Shape Type="Bitmap" CutIndex="0" W="211.64021" H="103.17461"
       File="/…/borrelplank28x13.png" Data="iVBORw0KGgoAAAANSUhEUgAA…">
  <XForm>1.3230001 0 0 1.3230001 308 716</XForm>
</Shape>
```

- `W` and `H` are the **final size in millimetres**.
- `Data` is raw base64 PNG with **no** `data:` prefix.
- The `<XForm>` translation is the **centre** of the image, not a corner. (Verified: in `borrelplank.lbrn2` the vector paths span x 168.72–447.17 and y 648.25–783.66, whose centre is exactly (308, 716) — the bitmap's XForm translation.)
- The local box is therefore `W/sx` by `H/sy` centred on the origin, where `sx = hypot(a,b)` and `sy = hypot(c,d)` of the composed XForm. For the sample: `211.64 / 1.323 = 160.0` and `103.17 / 1.323 = 78.0`.

Using a **centre origin** (`originX/originY: 'center'`) makes rotation exact: Fabric rotates around the origin point, so a centre-anchored image needs no bbox correction. Every other layer type uses top-left; that is why the descriptor carries the origin explicitly instead of overloading `left`/`top` with two meanings.

- [ ] **Step 1: Write the failing tests**

Append to `tests/js/utils/lbrnParser.test.js`:

```js
import { parseLbrn, decodePngSize } from '../../../admin/js/template-builder/src/utils/lbrnParser';

describe('decodePngSize', () => {
  // A 1x1 transparent PNG. Bytes 16-23 of a PNG are the IHDR width and height.
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('reads width and height from the PNG IHDR header', () => {
    expect(decodePngSize(PNG_1X1)).toEqual({ width: 1, height: 1 });
  });

  it('returns null for a non-PNG payload', () => {
    // JPEG magic bytes FFD8FF, padded to a valid base64 length.
    expect(decodePngSize('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ')).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(decodePngSize('not base64 at all!!')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodePngSize('')).toBeNull();
  });
});

describe('parseLbrn (bitmap shapes)', () => {
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const wrap = (inner) => `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03">
${inner}
</LightBurnProject>`;

  // A 20mm x 10mm bitmap centred at machine (100, 50), unrotated and unscaled.
  const BITMAP = (attrs = '', xform = '1 0 0 1 100 50') =>
    `  <Shape Type="Bitmap" CutIndex="0" W="20" H="10" Data="${PNG_1X1}"${attrs}>
    <XForm>${xform}</XForm>
  </Shape>`;

  // A 40mm x 20mm rect spanning machine x 80..120, y 40..60 — same centre as BITMAP.
  const RECT = `  <Shape Type="Path" CutIndex="0">
    <XForm>1 0 0 1 80 40</XForm>
    <VertList>V0 0V40 0V40 20V0 20</VertList>
    <PrimList>LineClosed</PrimList>
  </Shape>`;

  it('imports a bitmap as an image layer instead of warning', () => {
    const { layers, warnings } = parseLbrn(wrap(BITMAP()), { availableFonts: [] });
    expect(warnings).toEqual([]);
    const img = layers.find((l) => l.type === 'image');
    expect(img).toBeTruthy();
    expect(img.dataUrl).toBe(`data:image/png;base64,${PNG_1X1}`);
    expect(img.pngWidth).toBe(1);
    expect(img.pngHeight).toBe(1);
  });

  it('anchors the image on its centre, not its corner', () => {
    const { layers } = parseLbrn(wrap(BITMAP()), { availableFonts: [] });
    const img = layers.find((l) => l.type === 'image');
    expect(img.originX).toBe('center');
    expect(img.originY).toBe('center');
    // Alone on the canvas the union bbox is the bitmap itself: 20x10 mm, so
    // the centre sits at half of each side, in pixels.
    expect(img.left).toBeCloseTo(10 * PX_PER_MM, 1);
    expect(img.top).toBeCloseTo(5 * PX_PER_MM, 1);
  });

  it('scales the 1px PNG up to its physical millimetre size', () => {
    const { layers } = parseLbrn(wrap(BITMAP()), { availableFonts: [] });
    const img = layers.find((l) => l.type === 'image');
    expect(img.scaleX).toBeCloseTo(20 * PX_PER_MM, 1); // 20mm across 1 source pixel
    expect(img.scaleY).toBeCloseTo(10 * PX_PER_MM, 1);
  });

  it('divides the physical size by the XForm scale to find the local box', () => {
    // XForm scale 2 means the local half-extent is W/(2*2) = 5, so the corners
    // land at machine 100 +/- 10 — the physical size is unchanged at 20mm.
    const { widthMm } = parseLbrn(wrap(BITMAP('', '2 0 0 2 100 50')), { availableFonts: [] });
    expect(widthMm).toBeCloseTo(20, 3);
  });

  it('reports the rotation from the XForm', () => {
    // 90 degrees: [a,b,c,d] = [0,1,-1,0].
    const { layers } = parseLbrn(wrap(BITMAP('', '0 1 -1 0 100 50')), { availableFonts: [] });
    const img = layers.find((l) => l.type === 'image');
    expect(img.angle).toBeCloseTo(90, 3);
  });

  it('widens the union bbox when the bitmap extends past the vectors', () => {
    // A 60mm-wide bitmap centred on a 40mm-wide rect must win the union.
    const wide = `  <Shape Type="Bitmap" CutIndex="0" W="60" H="10" Data="${PNG_1X1}">
    <XForm>1 0 0 1 100 50</XForm>
  </Shape>`;
    const { widthMm } = parseLbrn(wrap(RECT + '\n' + wide), { availableFonts: [] });
    expect(widthMm).toBeCloseTo(60, 3);
  });

  it('places the bitmap layer before the vector layers', () => {
    const { layers } = parseLbrn(wrap(RECT + '\n' + BITMAP()), { availableFonts: [] });
    expect(layers[0].type).toBe('image');
  });

  it('warns and skips a non-PNG bitmap', () => {
    const jpeg = `  <Shape Type="Bitmap" CutIndex="0" W="20" H="10" Data="/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ">
    <XForm>1 0 0 1 100 50</XForm>
  </Shape>`;
    const { layers, warnings } = parseLbrn(wrap(jpeg), { availableFonts: [] });
    expect(layers.some((l) => l.type === 'image')).toBe(false);
    expect(warnings.join(' ')).toMatch(/only PNG/i);
  });

  it('warns and skips a bitmap with no physical size', () => {
    const zero = `  <Shape Type="Bitmap" CutIndex="0" W="0" H="0" Data="${PNG_1X1}">
    <XForm>1 0 0 1 100 50</XForm>
  </Shape>`;
    const { layers, warnings } = parseLbrn(wrap(zero), { availableFonts: [] });
    expect(layers.some((l) => l.type === 'image')).toBe(false);
    expect(warnings.join(' ')).toMatch(/size/i);
  });
});
```

`PX_PER_MM` is already exported from `lbrnParser.js`; add it to the import list at the top of the test file if it is not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/js/utils/lbrnParser.test.js`
Expected: FAIL — `decodePngSize is not a function`, and the bitmap tests fail because `parseLbrn` still pushes the `'Skipped a bitmap image (not supported).'` warning.

- [ ] **Step 3: Add `decodePngSize`**

In `lbrnParser.js`, below `qtFontToFamily`:

```js
/**
 * Read a PNG's pixel dimensions from the IHDR header of its base64 payload.
 * Bytes 0-7 are the PNG signature, 16-19 the width and 20-23 the height, all
 * big-endian — so the first 24 decoded bytes are enough and we never decode a
 * multi-megabyte image just to learn how big it is.
 * Returns null for anything that is not a PNG (LightBurn can embed other
 * formats; without dimensions we cannot scale, so those are skipped upstream).
 */
export function decodePngSize(base64) {
  const head = String(base64 || '').slice(0, 48); // 48 base64 chars → 36 bytes
  if (head.length < 32) return null;
  let bin;
  try {
    bin = atob(head);
  } catch (_) {
    return null; // not valid base64
  }
  if (bin.length < 24) return null;
  if (bin.slice(0, 8) !== '\x89PNG\r\n\x1a\n') return null;
  const be32 = (o) => (
    (bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16)
    | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)
  ) >>> 0;
  const width = be32(16);
  const height = be32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
```

- [ ] **Step 4: Collect bitmap shapes in `parseLbrn`**

In `parseLbrn`, next to the existing `paths` and `texts` arrays, add:

```js
  const bitmaps = []; // { data, pngW, pngH, wMm, hMm, corners, centre, angle }
```

Replace the existing `Bitmap` branch inside the `collectShapes(root).forEach` callback:

```js
    } else if (type === 'Bitmap') {
      warnings.push('Skipped a bitmap image (not supported).');
```

with:

```js
    } else if (type === 'Bitmap') {
      const data = el.getAttribute('Data') || '';
      const wMm  = parseFloat(el.getAttribute('W') || '0') || 0;
      const hMm  = parseFloat(el.getAttribute('H') || '0') || 0;
      const size = data ? decodePngSize(data) : null;
      if (!data || wMm <= 0 || hMm <= 0) {
        warnings.push('Skipped a bitmap image with no usable size.');
      } else if (!size) {
        warnings.push('Skipped a bitmap image: only PNG images are supported.');
      } else {
        // W/H are the FINAL millimetre size; the XForm translation is the
        // image CENTRE. Divide by the XForm's own scale to recover the local
        // box, then map its corners so a scaled or rotated bitmap still
        // contributes its true extent to the union bbox.
        const sx = Math.hypot(xform[0], xform[1]) || 1;
        const sy = Math.hypot(xform[2], xform[3]) || 1;
        const halfW = wMm / (2 * sx);
        const halfH = hMm / (2 * sy);
        const corners = [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]]
          .map(([lx, ly]) => applyXform(xform, lx, ly));
        bitmaps.push({
          data,
          pngW: size.width,
          pngH: size.height,
          wMm,
          hMm,
          corners,
          centre: applyXform(xform, 0, 0),
          angle: Math.atan2(xform[1], xform[0]) * 180 / Math.PI,
        });
      }
    } else if (type && type !== 'Group') {
```

- [ ] **Step 5: Include bitmaps in the union bbox**

In step 2 of `parseLbrn` (the union bbox), directly after the `paths.forEach` / `texts.forEach` accumulator lines, add:

```js
  bitmaps.forEach((b) => b.corners.forEach(([x, y]) => acc(x, y)));
```

- [ ] **Step 6: Emit the image layers first**

Immediately after `const layers = [];` and **before** the `const buckets = [];` block, add:

```js
  // Bitmaps first so they sit at the bottom of the layer list. Anchored on
  // their centre (originX/originY) rather than a bbox corner: Fabric rotates
  // around the origin, so a centre anchor keeps a rotated bitmap exact without
  // any bounding-box correction.
  bitmaps.forEach((b) => {
    layers.push({
      type: 'image',
      dataUrl: `data:image/png;base64,${b.data}`,
      pngWidth: b.pngW,
      pngHeight: b.pngH,
      originX: 'center',
      originY: 'center',
      left: n((b.centre[0] - minX) * PX_PER_MM),
      top:  n((b.centre[1] - minY) * PX_PER_MM),
      scaleX: n((b.wMm * PX_PER_MM) / b.pngW),
      scaleY: n((b.hMm * PX_PER_MM) / b.pngH),
      angle: n(b.angle),
    });
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest tests/js/utils/lbrnParser.test.js`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 8: Commit**

```bash
git add admin/js/template-builder/src/utils/lbrnParser.js tests/js/utils/lbrnParser.test.js
git commit -m "feat(lbrn): import Bitmap shapes as centre-anchored image layers"
```

---

## Task 2: Upload the bitmap to the media library

**Files:**
- Create: `admin/js/template-builder/src/api/mediaApi.js`
- Create: `tests/js/utils/mediaApi.test.js`
- Modify: `admin/js/template-builder/src/components/ImportLightBurn.jsx`

**Interfaces:**
- Consumes: `layer.dataUrl` from Task 1.
- Produces:
  - `dataUrlToBlob(dataUrl: string) => Blob` — throws on a non-base64 data URL.
  - `uploadDataUrlToMedia(dataUrl: string, filename: string) => Promise<string>` — resolves to the attachment's `source_url`, rejects with a readable `Error`.
  - Image layers reaching the store now carry `src` instead of `dataUrl`, plus `locked: true`, `visible: true`, `opacity: 1`, `name`, `exclude_from_export: true`, `template_art: true`.

**Background for the implementer:**

`window.sgpdTemplateBuilder` already exposes `restUrl` (the REST root, e.g. `https://site/wp-json/`) and `nonce` (a `wp_rest` nonce). The core media endpoint is `wp/v2/media`, not the plugin's `pf/v1` namespace, so the existing `request()` helper in `templateApi.js` cannot be reused — it hardcodes `pf/v1/`. The `fontApi.upload` function in the same file shows the multipart pattern to follow: `FormData`, `X-WP-Nonce` header, and **no** `Content-Type` header (the browser sets the multipart boundary).

Uploading requires the `upload_files` capability. Administrators and shop managers have it; a custom role might not. A failed upload must skip that one layer and let the vector import finish.

- [ ] **Step 1: Write the failing test**

Create `tests/js/utils/mediaApi.test.js`:

```js
import { dataUrlToBlob, uploadDataUrlToMedia } from '../../../admin/js/template-builder/src/api/mediaApi';

// A 1x1 transparent PNG.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DATA_URL = `data:image/png;base64,${PNG_1X1}`;

describe('dataUrlToBlob', () => {
  it('produces a Blob carrying the data URL mime type', () => {
    const blob = dataUrlToBlob(DATA_URL);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('throws on a string that is not a base64 data URL', () => {
    expect(() => dataUrlToBlob('https://example.com/x.png')).toThrow(/base64 data URL/);
  });
});

describe('uploadDataUrlToMedia', () => {
  beforeEach(() => {
    window.sgpdTemplateBuilder = { restUrl: 'https://site/wp-json/', nonce: 'NONCE123' };
  });

  afterEach(() => {
    delete global.fetch;
    delete window.sgpdTemplateBuilder;
  });

  it('posts multipart to wp/v2/media with the REST nonce and returns source_url', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, source_url: 'https://site/uploads/bitmap.png' }),
    });

    const url = await uploadDataUrlToMedia(DATA_URL, 'bitmap.png');

    expect(url).toBe('https://site/uploads/bitmap.png');
    const [calledUrl, opts] = global.fetch.mock.calls[0];
    expect(calledUrl).toBe('https://site/wp-json/wp/v2/media');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-WP-Nonce']).toBe('NONCE123');
    // The browser must set the multipart boundary itself.
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('rejects with the server message when the upload is refused', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Sorry, you are not allowed to upload files.' }),
    });

    await expect(uploadDataUrlToMedia(DATA_URL, 'bitmap.png'))
      .rejects.toThrow(/not allowed to upload/);
  });

  it('rejects when the response is OK but carries no source_url', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 42 }),
    });

    await expect(uploadDataUrlToMedia(DATA_URL, 'bitmap.png')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/js/utils/mediaApi.test.js`
Expected: FAIL — `Cannot find module '.../api/mediaApi'`.

- [ ] **Step 3: Create `mediaApi.js`**

```js
const base  = () => window.sgpdTemplateBuilder?.restUrl || '/wp-json/';
const nonce = () => window.sgpdTemplateBuilder?.nonce   || '';

/**
 * Decode a `data:<mime>;base64,<payload>` string into a Blob.
 * Throws on anything else — callers treat that as "skip this layer".
 */
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Not a base64 data URL');
  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/**
 * Upload a base64 data URL to the WordPress media library and return the
 * attachment's public URL.
 *
 * Uses core's wp/v2/media rather than a plugin endpoint: the file is an
 * ordinary image the merchant should be able to find and manage afterwards,
 * and core already handles MIME validation, sideloading and thumbnails.
 * Requires the `upload_files` capability — a caller must handle rejection.
 *
 * No Content-Type header: the browser must set the multipart boundary.
 */
export async function uploadDataUrlToMedia(dataUrl, filename) {
  const blob = dataUrlToBlob(dataUrl);
  const form = new FormData();
  form.append('file', blob, filename);

  const res = await fetch(`${base()}wp/v2/media`, {
    method: 'POST',
    headers: { 'X-WP-Nonce': nonce() },
    body: form,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.source_url) {
    throw new Error(data?.message || `Media upload failed (${res.status})`);
  }
  return data.source_url;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/js/utils/mediaApi.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the upload into the importer**

In `ImportLightBurn.jsx`, add the import at the top:

```js
import { uploadDataUrlToMedia } from '../api/mediaApi';
```

Inside `onFile`, after the `if (!layers.length)` guard and **before** the `DISPLAY_TARGET_PX` block, insert:

```js
      // Bitmaps arrive as base64 from the .lbrn2 file. Upload each one to the
      // media library and swap in the URL — a multi-hundred-kilobyte data URI
      // in zones_config would be read on every designer page load, and Fabric
      // JSON must never carry data URIs.
      let bitmapNo = 0;
      const uploaded = [];
      for (const layer of layers) {
        if (layer.type !== 'image' || !layer.dataUrl) { uploaded.push(layer); continue; }
        bitmapNo += 1;
        try {
          const src = await uploadDataUrlToMedia(
            layer.dataUrl,
            `lightburn-bitmap-${Date.now()}-${bitmapNo}.png`
          );
          const { dataUrl, ...rest } = layer;
          uploaded.push({
            ...rest,
            src,
            name: sprintf( __( 'Bitmap %d', 'snelgraveren-product-designer' ), bitmapNo ),
            locked: true,          // background reference art, not customer content
            visible: true,
            opacity: 1,
            exclude_from_export: true,
            template_art: true,    // keeps it out of both price counters
          });
        } catch (err) {
          // Skip this bitmap only — the vector import must still complete.
          warnings.push(
            sprintf( __( 'Could not upload a bitmap image: %s', 'snelgraveren-product-designer' ), err.message )
          );
        }
      }
```

Then change the two following statements to consume `uploaded`:

- `const namedLayers = layers.map((l) => {` becomes `const namedLayers = uploaded.map((l) => {`
- Inside that callback the first line is `if (l.type !== 'svg') return l;` — leave it: image layers already carry their `name` from the block above.

In the `scaledLayers` map, the non-text branch already scales `left`, `top`, `scaleX` and `scaleY`, which is correct for a centre-anchored image too — uniform scaling about the canvas origin maps a centre point exactly as it maps a corner.

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add admin/js/template-builder/src/api/mediaApi.js tests/js/utils/mediaApi.test.js admin/js/template-builder/src/components/ImportLightBurn.jsx
git commit -m "feat(lbrn): upload imported bitmaps to the media library"
```

---

## Task 3: Opacity and centre-origin support in the builder canvas

**Files:**
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`
- Modify: `admin/js/template-builder/src/components/TreePanel.jsx`

**Interfaces:**
- Consumes: `layer.opacity`, `layer.originX`, `layer.originY` from Tasks 1 and 2.
- Produces: the layer form writes `opacity` as a number in `[0, 1]`.

**Background for the implementer:**

`Canvas.jsx` renders each layer in one of three branches (`text`, `image`, `svg`), and **each branch has two paths**: an `existing.set({…})` update path and a create path. Both need the new properties or the value will apply on first render and then be lost on the next store update — a class of bug that looks like "the slider works until I touch something else".

The image branch's update path is around `Canvas.jsx:589`, its create path around `:605`. The svg branch has **three** create paths (inline markup, and two under `layer.src`). Search for `visible:    layer.visible !== false,` — every occurrence marks a place that needs the new properties.

- [ ] **Step 1: Add opacity and origin to every layer branch**

In `Canvas.jsx`, for **each** of the object literals that currently contain `visible: layer.visible !== false,` add:

```js
            opacity:    layer.opacity ?? 1,
            originX:    layer.originX || 'left',
            originY:    layer.originY || 'top',
```

Do not add `originX`/`originY` to the text branch yet — Task 12 handles text.

- [ ] **Step 2: Add the opacity slider to the layer form**

In `TreePanel.jsx`, in `LayerDetail`'s non-text branch, directly after the `{layer.src && (…preview…)}` block, add:

```jsx
      <label>
        { __( 'Opacity', 'snelgraveren-product-designer' ) }
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round((layer.opacity ?? 1) * 100)}
          onChange={(e) => onChange({ opacity: (parseInt(e.target.value, 10) || 0) / 100 })}
        />
        <span style={{ fontSize: 11, opacity: 0.7 }}>
          {Math.round((layer.opacity ?? 1) * 100)}%
        </span>
      </label>
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual verification**

Ask the user to start Docker if it is not running, then `docker compose up -d` and `npm run dev`.

1. Open the Template Builder, import `~/Downloads/borrelplank.lbrn2`.
2. The bitmap appears as the bottom layer named "Bitmap 1", aligned with the vector artwork.
3. Select it in the Structure tree — the Opacity slider appears; dragging it fades the image on the canvas live.
4. Toggle the eye icon — the image hides and shows.
5. Save the template, reload the page, reopen it: opacity and visibility survived.

- [ ] **Step 5: Commit**

```bash
git add admin/js/template-builder/src/components/Canvas.jsx admin/js/template-builder/src/components/TreePanel.jsx
git commit -m "feat(builder): per-layer opacity slider and centre-origin support"
```

---

## Task 4: Render image layers in the customer designer

**Files:**
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`

**Interfaces:**
- Consumes: image layer descriptors from Tasks 1–3.
- Produces: Fabric objects carrying `data.excludeFromExport` and `data.templateArt`, consumed by Tasks 5 and 6.

**Background for the implementer:**

The customer designer renders template layers in a `zones.forEach(… (zone.layers || []).forEach(…))` loop around `DesignerCanvas.jsx:474`. It has a `text` branch and an `svg` branch — **there is no `image` branch at all**, which is why an imported bitmap is invisible to customers today.

Two hazards the svg branch already documents and this branch must copy:

1. **The snapshot race** (`:458-471`). The async load can resolve *after* `loadFromJSON` restored a snapshot that already contains the image, stacking a duplicate. The svg branch guards with `!hasSnapshotForView`; do the same.
2. **Serialization of `data`.** Fabric 6's `Group.toObject` ignores `propertiesToInclude`, which is why the zone overlay patches its own `toObject` (`:349-355`). A plain `Image` should round-trip `data` natively via `toJSON(['data'])` — Step 4 verifies that rather than assuming it. If it does not round-trip, the bitmap reappears in the export of every non-active view.

- [ ] **Step 1: Add the image branch**

In `DesignerCanvas.jsx`, inside the layer loop, after the closing brace of the `if (!hasSnapshotForView && layer.type === 'svg' …)` block, add:

```js
        if (!hasSnapshotForView && layer.type === 'image' && layer.src) {
          FabricImage.fromURL(layer.src, { crossOrigin: 'anonymous' })
            .then((img) => {
              if (disposed) return;
              img.set({
                left:          layer.left   ?? zone.x,
                top:           layer.top    ?? zone.y,
                originX:       layer.originX || 'left',
                originY:       layer.originY || 'top',
                scaleX:        layer.scaleX || 1,
                scaleY:        layer.scaleY || 1,
                angle:         layer.angle  || 0,
                opacity:       layer.opacity ?? 1,
                visible:       layer.visible !== false,
                // Background reference art: never selectable, never movable.
                // evented:false is what lets clicks fall through to the text
                // and logos above it.
                selectable:    false,
                evented:       false,
                hasControls:   false,
                lockMovementX: true,
                lockMovementY: true,
                data: {
                  elementType:       'image',
                  zoneIndex:         zoneIdx,
                  templateLocked:    true,
                  // Kept out of every export render (App.jsx) and out of both
                  // price counters (priceCounts.js / PriceCalculator).
                  excludeFromExport: layer.exclude_from_export !== false,
                  templateArt:       layer.template_art !== false,
                },
              });
              if (zoneClips(zone)) applyZoneClip(img, zoneIdx);
              canvas.add(img);
              canvas.sendObjectToBack(img);
              img.setCoords();
              canvas.renderAll();
            })
            .catch((err) => console.warn('[PF] template image layer load failed:', err));
        }
```

Verify `FabricImage` is in the `fabric` import list at the top of the file; add it if it is missing. A missing import here crashes the whole React tree with no visible error.

- [ ] **Step 2: Honour `opacity` on the existing text and svg branches**

The opacity slider from Task 3 must reach the customer too, not just the builder. In the same layer loop, add `opacity: layer.opacity ?? 1,` to the `new IText({…})` options in the `text` branch (`:479`) and to the `group.set({…})` options in the `svg` branch (`:519`).

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Verify `data` round-trips through the canvas JSON**

Ask the user to start Docker if needed. With a template containing an imported bitmap, open the product page as a customer and run in the browser console:

```js
const c = document.querySelector('#pf-designer-root');
// Grab the Fabric canvas the store holds, then inspect the serialized form.
const json = window.__pfCanvas ? window.__pfCanvas.toJSON(['data']) : null;
```

If no debug handle is exposed, instead: save a design, then check the stored `canvas_json` for the view in phpMyAdmin (http://localhost:8081, table `wp_pf_design_views`) and confirm the image object carries `"data":{…"excludeFromExport":true…}`.

Expected: the flags are present. **If they are missing**, patch `toObject` on the image the same way the zone overlay does:

```js
              const _origToObject = img.toObject.bind(img);
              img.toObject = function (propertiesToInclude) {
                const obj = _origToObject(propertiesToInclude);
                if (this.data) obj.data = this.data;
                return obj;
              };
```

- [ ] **Step 5: Manual verification**

1. As a customer, open a product using the imported template.
2. The bitmap shows behind the artwork at its configured opacity.
3. Clicking on the bitmap selects nothing; clicking a text element above it selects that text.
4. Set the layer's opacity to 0 % in the builder, reload the product page — the bitmap is invisible but the rest is unchanged.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat(designer): render template image layers as locked background art"
```

---

## Task 5: Exclude flagged objects from every export render

**Files:**
- Modify: `frontend/js/designer/src/App.jsx`

**Interfaces:**
- Consumes: `data.excludeFromExport` set in Task 4.
- Produces: `withoutExcludedObjects(canvas, fn)` — an async helper local to `App.jsx`.

**Background for the implementer:**

There are **four** export render paths and **two** thumbnail paths, and they must be treated differently:

| Call site | Excluded? |
|---|---|
| `fabricCanvasRef.toDataURL({ format: 'png', multiplier: 3 })` at `App.jsx:566` | yes |
| the same call at `App.jsx:723` | yes |
| `renderOffscreenExportPng` | yes |
| `renderOffscreenExportSvg` (feeds **both** `export_vector` variants via `buildExportVectors`) | yes |
| `toDataURL({ multiplier: 0.5 })` thumbnails, live at `:563` and `:720`, and `renderOffscreenThumbnail` | **no** |

The thumbnail deliberately keeps the bitmap: it is what the customer sees in the cart and in My Account, so it should look like their design. The exports are production files for the engraver and must contain only the geometry to cut.

Restoring visibility in a `finally` block is not optional. The two live-canvas call sites operate on the customer's **on-screen** canvas; a throwing `toDataURL` that skipped the restore would leave the customer staring at a design with a missing layer.

- [ ] **Step 1: Add the helper**

In `App.jsx`, directly above `renderOffscreenThumbnail`:

```js
/**
 * Run `fn` with every object flagged data.excludeFromExport hidden, then
 * restore. Used for the production export renders only — thumbnails keep those
 * objects, because a thumbnail should look like what the customer designed.
 *
 * The restore lives in `finally` on purpose: two call sites operate on the
 * customer's LIVE on-screen canvas, so a throwing render must never leave a
 * layer hidden in front of them.
 */
function withoutExcludedObjects(canvas, fn) {
  const hidden = [];
  try {
    canvas.getObjects().forEach((o) => {
      if (o.data?.excludeFromExport && o.visible !== false) {
        hidden.push(o);
        o.visible = false;
      }
    });
    if (hidden.length) canvas.renderAll();
    return fn();
  } finally {
    if (hidden.length) {
      hidden.forEach((o) => { o.visible = true; });
      canvas.renderAll();
    }
  }
}
```

- [ ] **Step 2: Apply it to the two offscreen export renderers**

In `renderOffscreenExportPng`, replace:

```js
    offscreen.renderAll();
    const dataUrl = offscreen.toDataURL({ format: 'png', multiplier: 3 });
```

with:

```js
    offscreen.renderAll();
    const dataUrl = withoutExcludedObjects(offscreen, () =>
      offscreen.toDataURL({ format: 'png', multiplier: 3 })
    );
```

In `renderOffscreenExportSvg`, replace:

```js
    offscreen.renderAll();
    const svg = offscreen.toSVG();
```

with:

```js
    offscreen.renderAll();
    const svg = withoutExcludedObjects(offscreen, () => offscreen.toSVG());
```

Leave `renderOffscreenThumbnail` untouched.

- [ ] **Step 3: Apply it to the two live-canvas export captures**

At `App.jsx:566` and again at `:723`, replace:

```js
                exportSvg = store.fabricCanvasRef.toDataURL({ format: 'png', multiplier: 3 });
```

with:

```js
                exportSvg = withoutExcludedObjects(store.fabricCanvasRef, () =>
                  store.fabricCanvasRef.toDataURL({ format: 'png', multiplier: 3 })
                );
```

The second site uses the local `fabricCanvasRef` rather than `store.fabricCanvasRef`; keep whichever identifier that site already uses. Leave the adjacent `multiplier: 0.5` thumbnail lines untouched.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification**

Ask the user to start Docker if needed.

1. As a customer, design on a product whose template has a bitmap layer, and add to cart.
2. The **cart thumbnail shows the bitmap**.
3. Place the order, then in WP admin export the design as PDF, as PNG and as SVG.
4. **None of the three contains the bitmap.** Check the SVG in a text editor — no `<image>` element.
5. Add a second view to the template and repeat: the non-active view's export (rendered offscreen from stored JSON) is also free of the bitmap. This is the case that fails if `data` does not serialize (Task 4, Step 4).
6. Back in the designer, the bitmap is still visible on screen after saving — the restore worked.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/designer/src/App.jsx
git commit -m "feat(export): exclude flagged background art from all export renders"
```

---

## Task 6: Exclude template art from both price counters

**Files:**
- Modify: `frontend/js/designer/src/utils/priceCounts.js`
- Modify: `includes/Pricing/class-price-calculator.php`
- Test: `tests/js/utils/priceCounts.test.js`
- Test: `tests/php/Pricing/PriceCalculatorTest.php`

**Interfaces:**
- Consumes: `data.templateArt` set in Task 4.
- Produces: nothing consumed by later tasks.

**Background for the implementer:**

Both counters classify by Fabric object type and exclude only `data.isZoneOverlay`. A bitmap background is an `Image` on the canvas, so **every customer would be charged an image surcharge for a background they never added**. The server-side calculation is the authoritative one — the JS counter only feeds the live preview — so both must change or the displayed price and the charged price diverge.

Existing template `svg` layers stay billable on purpose. They are counted today, and excluding them would change live prices on snelgraveren.nl.

`classify_object` is `private`; the test reaches it with reflection, which is appropriate for a pure classification function with no collaborators.

- [ ] **Step 1: Write the failing JS test**

Append to `tests/js/utils/priceCounts.test.js`:

```js
  it('does not bill template background art', () => {
    const counts = countPriceableElements({
      0: {
        objects: [
          { type: 'Image', data: { templateArt: true } },   // the bitmap background
          { type: 'Image' },                                 // a customer upload
          { type: 'IText' },
        ],
      },
    });
    expect(counts.image).toBe(1);
    expect(counts.text).toBe(1);
  });
```

Place it inside the existing top-level `describe` block in that file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/js/utils/priceCounts.test.js`
Expected: FAIL — `expect(counts.image).toBe(1)` receives `2`.

- [ ] **Step 3: Add the JS exclusion**

In `priceCounts.js`, immediately after the `isZoneOverlay` guard:

```js
            if (obj.data?.isZoneOverlay) continue;
            // Template-supplied background art (e.g. an imported LightBurn
            // bitmap) is not something the customer added — never billable.
            if (obj.data?.templateArt) continue;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest tests/js/utils/priceCounts.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing PHP test**

Append to `tests/php/Pricing/PriceCalculatorTest.php`, inside the class:

```php
    /**
     * classify_object() is private and has no collaborators — reflection is the
     * least invasive way to pin its behaviour.
     */
    private function classify(array $obj): ?string {
        $m = new \ReflectionMethod(PriceCalculator::class, 'classify_object');
        $m->setAccessible(true);
        return $m->invoke($this->calc, $obj);
    }

    public function test_classifies_a_customer_image_as_billable(): void {
        $this->assertSame('image', $this->classify(['type' => 'Image']));
    }

    public function test_does_not_bill_template_background_art(): void {
        $this->assertNull($this->classify([
            'type' => 'Image',
            'data' => ['templateArt' => true],
        ]));
    }

    public function test_still_bills_template_svg_layers(): void {
        // Deliberate: svg template layers are billable today and must stay so,
        // or live prices on existing products would change.
        $this->assertSame('svg', $this->classify(['type' => 'Group']));
    }
```

- [ ] **Step 6: Run it to verify it fails**

Ask the user to start Docker if it is not running, then:

Run: `docker compose exec wordpress bash -c "cd wp-content/plugins/productforge && phpunit --filter PriceCalculatorTest"`
Expected: FAIL — `test_does_not_bill_template_background_art` gets `'image'` instead of `null`.

- [ ] **Step 7: Add the PHP exclusion**

In `includes/Pricing/class-price-calculator.php`, in `classify_object()`, immediately after the `isZoneOverlay` guard:

```php
        // Template-supplied background art (e.g. an imported LightBurn bitmap)
        // is not a customer element — never billable. Set by the designer on
        // the Fabric object as data.templateArt.
        if (!empty($obj['data']['templateArt'])) {
            return null;
        }
```

- [ ] **Step 8: Run the PHP tests to verify they pass**

Run: `docker compose exec wordpress bash -c "cd wp-content/plugins/productforge && phpunit --filter PriceCalculatorTest"`
Expected: PASS.

Also lint: `docker compose exec -T wordpress php -l /var/www/html/wp-content/plugins/productforge/includes/Pricing/class-price-calculator.php`

- [ ] **Step 9: Manual verification**

1. Configure a per-element surcharge for images on the template.
2. As a customer, open a product whose template has a bitmap and add nothing.
3. The live price shows **no** image surcharge.
4. Add to cart — the cart total matches the live preview.

- [ ] **Step 10: Commit**

```bash
git add frontend/js/designer/src/utils/priceCounts.js includes/Pricing/class-price-calculator.php tests/js/utils/priceCounts.test.js tests/php/Pricing/PriceCalculatorTest.php
git commit -m "fix(pricing): never bill template background art"
```

---

# Phase 2 — Millimetre ruler (spec §4)

## Task 7: Ruler tick arithmetic

**Files:**
- Create: `shared/js/mmRuler.js`
- Create: `tests/js/utils/mmRuler.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `chooseTickStepMm(mmPerPx: number, minLabelSpacingPx = 40) => number` — the smallest step from `[1,2,5,10,20,50,100]` whose on-screen spacing is at least `minLabelSpacingPx`; returns `100` when even that is too tight.
  - `buildTicks({ lengthPx, mmPerPx, minLabelSpacingPx = 40 }) => Array<{ px: number, mm: number, major: boolean }>` — ticks from 0 to `lengthPx` inclusive; majors carry a label, minors sit at one fifth of the step. Returns `[]` when `mmPerPx <= 0` or `lengthPx <= 0`.

**Background for the implementer:**

`shared/js/` is the established home for code both apps import — see `shared/js/zoneContainment.js`, imported from `frontend/js/designer/src/components/DesignerCanvas.jsx:12` and `admin/js/template-builder/src/components/Canvas.jsx:7` via a relative path. Follow that pattern.

This task is pure arithmetic with no DOM and no React, which is why it is separated from the component in Task 8.

- [ ] **Step 1: Write the failing tests**

Create `tests/js/utils/mmRuler.test.js`:

```js
import { chooseTickStepMm, buildTicks } from '../../../shared/js/mmRuler';

describe('chooseTickStepMm', () => {
  it('uses 1mm steps when a millimetre is comfortably wide on screen', () => {
    // 1mm = 50px on screen, well past the 40px floor.
    expect(chooseTickStepMm(1 / 50)).toBe(1);
  });

  it('climbs to a coarser step as the drawing shrinks', () => {
    // 1mm = 10px, so a 1mm step would label every 10px. 5mm gives 50px.
    expect(chooseTickStepMm(1 / 10)).toBe(5);
  });

  it('caps at 100mm when even that is too tight', () => {
    // 1mm = 0.1px: a 100mm step is still only 10px, but there is nothing coarser.
    expect(chooseTickStepMm(10)).toBe(100);
  });

  it('honours a custom minimum label spacing', () => {
    // 1mm = 10px. With a 20px floor a 2mm step (20px) is enough.
    expect(chooseTickStepMm(1 / 10, 20)).toBe(2);
  });
});

describe('buildTicks', () => {
  it('emits a major tick at zero', () => {
    const ticks = buildTicks({ lengthPx: 500, mmPerPx: 1 / 50 });
    expect(ticks[0]).toEqual({ px: 0, mm: 0, major: true });
  });

  it('spaces majors by the chosen step and minors at one fifth of it', () => {
    // 1mm = 50px → step 1mm → majors every 50px, minors every 10px.
    const ticks = buildTicks({ lengthPx: 100, mmPerPx: 1 / 50 });
    const majors = ticks.filter((t) => t.major);
    expect(majors.map((t) => t.mm)).toEqual([0, 1, 2]);
    expect(majors.map((t) => t.px)).toEqual([0, 50, 100]);
    const minors = ticks.filter((t) => !t.major);
    expect(minors.length).toBe(10); // 5 per major interval, 2 intervals
  });

  it('never emits a tick past the ruler length', () => {
    const ticks = buildTicks({ lengthPx: 120, mmPerPx: 1 / 50 });
    ticks.forEach((t) => expect(t.px).toBeLessThanOrEqual(120));
  });

  it('keeps labelled ticks at least the minimum spacing apart', () => {
    // Sweep a range of scales; the floor must hold at every one of them.
    [0.01, 0.05, 0.2, 1, 5].forEach((mmPerPx) => {
      const majors = buildTicks({ lengthPx: 800, mmPerPx }).filter((t) => t.major);
      for (let i = 1; i < majors.length; i++) {
        expect(majors[i].px - majors[i - 1].px).toBeGreaterThanOrEqual(40);
      }
    });
  });

  it('returns nothing when there is no physical scale', () => {
    expect(buildTicks({ lengthPx: 500, mmPerPx: 0 })).toEqual([]);
    expect(buildTicks({ lengthPx: 500, mmPerPx: -1 })).toEqual([]);
  });

  it('returns nothing for a zero-length ruler', () => {
    expect(buildTicks({ lengthPx: 0, mmPerPx: 1 / 50 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/js/utils/mmRuler.test.js`
Expected: FAIL — `Cannot find module '.../shared/js/mmRuler'`.

- [ ] **Step 3: Implement the arithmetic**

Create `shared/js/mmRuler.js`:

```js
/**
 * Tick arithmetic for the millimetre rulers shown alongside both canvases.
 * Pure — no DOM, no React — so it is unit-testable and shared by the Template
 * Builder and the customer Designer.
 */

const STEPS_MM = [1, 2, 5, 10, 20, 50, 100];
const MINORS_PER_MAJOR = 5;

/**
 * Smallest step from STEPS_MM whose on-screen spacing clears the label floor.
 * Falls back to the coarsest step rather than returning nothing, so a very
 * small drawing still gets a usable (if sparse) scale.
 *
 * @param {number} mmPerPx millimetres represented by one on-screen pixel
 * @param {number} [minLabelSpacingPx] minimum gap between labelled ticks
 * @returns {number} step in millimetres
 */
export function chooseTickStepMm(mmPerPx, minLabelSpacingPx = 40) {
  if (!(mmPerPx > 0)) return STEPS_MM[0];
  for (const step of STEPS_MM) {
    if (step / mmPerPx >= minLabelSpacingPx) return step;
  }
  return STEPS_MM[STEPS_MM.length - 1];
}

/**
 * Ticks from 0 to lengthPx inclusive. Majors carry a millimetre value for the
 * label; minors sit at one fifth of the step and stay unlabelled.
 *
 * @param {{lengthPx:number, mmPerPx:number, minLabelSpacingPx?:number}} opts
 * @returns {Array<{px:number, mm:number, major:boolean}>}
 */
export function buildTicks({ lengthPx, mmPerPx, minLabelSpacingPx = 40 }) {
  if (!(mmPerPx > 0) || !(lengthPx > 0)) return [];
  const stepMm = chooseTickStepMm(mmPerPx, minLabelSpacingPx);
  const minorMm = stepMm / MINORS_PER_MAJOR;
  const ticks = [];
  for (let i = 0; ; i++) {
    const mm = i * minorMm;
    const px = mm / mmPerPx;
    if (px > lengthPx + 1e-6) break;
    ticks.push({
      px: Math.round(px * 1000) / 1000,
      mm: Math.round(mm * 1000) / 1000,
      major: i % MINORS_PER_MAJOR === 0,
    });
  }
  return ticks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/js/utils/mmRuler.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/js/mmRuler.js tests/js/utils/mmRuler.test.js
git commit -m "feat(ruler): millimetre tick arithmetic shared by both canvases"
```

---

## Task 8: Ruler component and customer-designer integration

**Files:**
- Create: `shared/js/MmRuler.jsx`
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`
- Modify: `frontend/js/designer/src/hooks/useCanvasScale.js`
- Modify: `frontend/js/designer/src/designer.css` (imported by `index.jsx:1`; the build also copies it out to `dist/frontend-designer.css`)

**Interfaces:**
- Consumes: `buildTicks` from Task 7.
- Produces: `<MmRuler canvasEl={HTMLCanvasElement|null} widthMm={number} canvasWidth={number} canvasHeight={number} />` — a React component rendering both the top and left strips, or `null` when there is no physical scale.

**Background for the implementer:**

**Why the ruler measures the canvas element itself.** `useCanvasScale` deliberately keeps React state out of the resize loop — its own comment says "no React state in the loop, so resizes are instant with no visible grow/shrink animation between frames". Publishing the zoom to React would undo that. Instead the ruler runs its own `ResizeObserver` on the `<canvas>` element and derives everything from its rendered size:

```
mmPerScreenPx = widthMm / renderedCanvasWidthPx
```

This works unchanged in the Template Builder, where the canvas is not zoomed at all.

**The layout hazard.** `useCanvasScale` currently observes `.pf-canvas-wrap`. If the ruler strips go inside that element, `el.clientWidth` grows to include them and the canvas is scaled against the wrong available space. `scaleContainerRef` must move onto the canvas cell of a grid:

```
.pf-canvas-wrap
  └─ .pf-canvas-grid            (CSS grid: auto 1fr / auto 1fr)
       ├─ corner spacer
       ├─ top ruler
       ├─ left ruler
       └─ canvas cell           ← scaleContainerRef
            └─ .pf-canvas-scroll > canvas
```

**Do not draw the ruler with Fabric.** A Fabric ruler would be serialized into the saved canvas JSON and rendered into every export.

- [ ] **Step 1: Create the component**

Create `shared/js/MmRuler.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import { buildTicks } from './mmRuler';

const THICKNESS = 22; // px, matches the CSS grid track

/**
 * Millimetre rulers along the top and left edges of a Fabric canvas.
 *
 * Rendered as DOM/SVG beside the canvas, never as Fabric objects: a Fabric
 * ruler would be serialized into the saved design and drawn into every export.
 *
 * Scale is derived by measuring the canvas element rather than by reading the
 * Fabric zoom, so the responsive zoom loop in useCanvasScale can stay free of
 * React state.
 *
 * Renders nothing when widthMm is 0 — a millimetre scale derived from no
 * physical size would be a lie.
 */
export default function MmRuler({ canvasEl, widthMm, canvasWidth, canvasHeight }) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!canvasEl) return undefined;
    const measure = () => {
      const r = canvasEl.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(canvasEl);
    measure();
    return () => ro.disconnect();
  }, [canvasEl]);

  if (!(widthMm > 0) || !(canvasWidth > 0) || !(size.w > 0)) return null;

  const mmPerPx = widthMm / size.w;
  const hTicks = buildTicks({ lengthPx: size.w, mmPerPx });
  const vTicks = buildTicks({ lengthPx: size.h, mmPerPx });
  if (!hTicks.length) return null;

  const strip = (ticks, horizontal) => (
    <svg
      className={`pf-ruler pf-ruler--${horizontal ? 'top' : 'left'}`}
      width={horizontal ? size.w : THICKNESS}
      height={horizontal ? THICKNESS : size.h}
      aria-hidden="true"
    >
      {ticks.map((t, i) => {
        const len = t.major ? THICKNESS * 0.5 : THICKNESS * 0.25;
        return horizontal ? (
          <line key={i} x1={t.px} y1={THICKNESS - len} x2={t.px} y2={THICKNESS} className="pf-ruler__tick" />
        ) : (
          <line key={i} x1={THICKNESS - len} y1={t.px} x2={THICKNESS} y2={t.px} className="pf-ruler__tick" />
        );
      })}
      {ticks.filter((t) => t.major).map((t, i) => (
        horizontal ? (
          <text key={i} x={t.px + 2} y={9} className="pf-ruler__label">{t.mm}</text>
        ) : (
          <text key={i} x={2} y={t.px - 2} className="pf-ruler__label">{t.mm}</text>
        )
      ))}
    </svg>
  );

  return (
    <>
      <div className="pf-ruler__corner">mm</div>
      {strip(hTicks, true)}
      {strip(vTicks, false)}
    </>
  );
}
```

`canvasHeight` is accepted for symmetry with the caller's props but the vertical extent comes from the measured element; leave the prop in the signature so both apps pass the same shape.

- [ ] **Step 2: Add the grid to the customer designer**

In `DesignerCanvas.jsx`, add the imports:

```js
import MmRuler from '../../../../../shared/js/MmRuler';
import useIsMobile from '../hooks/useIsMobile';
```

`useIsMobile` is already imported in this file — verify rather than duplicating. Add near the other derived values:

```js
  const widthMm = Number(currentView?.width_mm) || 0;
  const showRuler = widthMm > 0 && !isMobile;
```

Replace the returned JSX wrapper:

```jsx
    <div className="pf-canvas-wrap">
      <div className={`pf-canvas-grid${showRuler ? ' pf-canvas-grid--ruler' : ''}`}>
        {showRuler && (
          <MmRuler
            canvasEl={canvasEl.current}
            widthMm={widthMm}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
          />
        )}
        <div className="pf-canvas-cell" ref={scaleContainerRef}>
          <div className="pf-canvas-scroll">
            <canvas ref={canvasEl} />
          </div>
        </div>
      </div>
      {/* the two hidden file inputs stay exactly as they are */}
    </div>
```

Note that `scaleContainerRef` moved off `.pf-canvas-wrap` and onto `.pf-canvas-cell`.

- [ ] **Step 3: Add the CSS**

In `frontend/js/designer/src/designer.css`:

```css
.pf-canvas-grid {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}

.pf-canvas-grid--ruler {
  grid-template-columns: 22px 1fr;
  grid-template-rows: 22px 1fr;
}

.pf-ruler__corner {
  font-size: 9px;
  line-height: 22px;
  text-align: center;
  color: #888;
  user-select: none;
}

.pf-ruler--top  { grid-column: 2; grid-row: 1; }
.pf-ruler--left { grid-column: 1; grid-row: 2; }
.pf-canvas-grid--ruler .pf-canvas-cell { grid-column: 2; grid-row: 2; }

.pf-ruler__tick  { stroke: #999; stroke-width: 1; }
.pf-ruler__label { font-size: 8px; fill: #666; user-select: none; }
```

When `.pf-canvas-grid--ruler` is absent the single-cell grid places the canvas cell automatically, so no extra rule is needed for the no-ruler case.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds, and `dist/frontend-designer.css` exists (the build's `cp` step).

- [ ] **Step 5: Manual verification**

Ask the user to start Docker if needed.

1. On a template with `width_mm` set (the LightBurn import sets it), open the product page: rulers appear along the top and left.
2. Hold a physical ruler to the screen at 100 % browser zoom — a 100 mm span on the on-screen ruler measures 100 mm. (If the display's CSS pixel density differs this can be off; what must be exact is the ratio between the ruler and the artwork.)
3. Resize the browser window: the ruler rescales with the canvas and the labels re-space rather than crowding.
4. On a template with `width_mm = 0`: no ruler, and the canvas fills the space exactly as before.
5. Narrow the viewport to phone width: the ruler disappears and the canvas keeps its full width.
6. **Regression:** the canvas is not smaller than before at desktop width — this is what a wrongly-placed `scaleContainerRef` would break.

- [ ] **Step 6: Commit**

```bash
git add shared/js/MmRuler.jsx frontend/js/designer/src/components/DesignerCanvas.jsx frontend/js/designer/src/hooks/useCanvasScale.js
git add frontend/js/designer/src/designer.css
git commit -m "feat(designer): millimetre rulers along the canvas edges"
```

---

## Task 9: Ruler in the Template Builder

**Files:**
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`
- Modify: `admin/js/template-builder/src/components/ViewTabs.jsx`
- Modify: `admin/js/template-builder/src/builder.css`

**Interfaces:**
- Consumes: `MmRuler` from Task 8.
- Produces: nothing consumed by later tasks.

**Background for the implementer:**

The builder canvas is not zoomed, so the same measured-element approach works without any change to the component. The builder has no mobile case, so the ruler shows whenever `width_mm > 0`.

`ViewTabs.jsx:147` already renders the `width_mm` input. A merchant who never fills it in will wonder where the ruler went, so a short hint goes next to it.

- [ ] **Step 1: Add the ruler to the builder canvas**

In `Canvas.jsx`, add the import:

```js
import MmRuler from '../../../../../shared/js/MmRuler';
```

Add near the other derived values:

```js
  const widthMm = Number(currentView?.width_mm) || 0;
```

Replace the canvas block at the end of the main JSX:

```jsx
      <div className={`pf-canvas-grid${widthMm > 0 ? ' pf-canvas-grid--ruler' : ''}`}>
        {widthMm > 0 && (
          <MmRuler
            canvasEl={canvasEl.current}
            widthMm={widthMm}
            canvasWidth={currentView?.canvas_width || 800}
            canvasHeight={currentView?.canvas_height || 600}
          />
        )}
        <div className="pf-canvas-cell">
          <div className="pf-canvas-scroll">
            <canvas ref={canvasEl} />
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Add the hint to the width field**

In `ViewTabs.jsx`, directly after the `width_mm` input, add:

```jsx
          <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 6 }}>
            { __( 'Physical width. Fill this in to show the millimetre ruler and to enable the minimum font size.', 'snelgraveren-product-designer' ) }
          </span>
```

Verify `__` is imported in that file; add `import { __ } from '@wordpress/i18n';` if it is not.

- [ ] **Step 3: Add the CSS**

Copy the same block added in Task 8, Step 3 into `admin/js/template-builder/src/builder.css`.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification**

1. Open a template whose view has `width_mm` set — rulers appear in the builder.
2. Change `width_mm` in the view settings — the ruler rescales immediately.
3. Set `width_mm` to 0 — the ruler disappears and the hint is visible next to the field.
4. Import `borrelplank.lbrn2` into a fresh template: the import sets `width_mm`, so the ruler appears by itself, and the bitmap's 211.6 mm width reads as ~212 mm on the ruler.

- [ ] **Step 6: Commit**

```bash
git add admin/js/template-builder/src/components/Canvas.jsx admin/js/template-builder/src/components/ViewTabs.jsx admin/js/template-builder/src/builder.css
git commit -m "feat(builder): millimetre ruler and a width_mm hint"
```

---

# Phase 3 — Text placement, form and minimum size (spec §5, §8, §9)

## Task 10: Minimum font size setting and conversion

**Files:**
- Modify: `admin/js/template-builder/src/components/PermissionsPanel.jsx`
- Create: `shared/js/fontSizeLimits.js`
- Create: `tests/js/utils/fontSizeLimits.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `minFontSizePx({ minFontSizeMm, canvasWidth, widthMm }) => number` — the minimum font size in canvas pixels, or `0` when there is no minimum or no physical scale.
  - The template stores `global_config.permissions.text.min_font_size_mm` (number, `0` = off).

**Background for the implementer:**

`PermissionsPanel.jsx` renders one fieldset per element type from `ELEMENT_TYPE_KEYS`, with a `boolKeys` row of checkboxes and a `pf-permissions__scales` block holding `min_scale`, `max_scale` and `grid_size`. The new field belongs in that scales block, for the `text` type only.

Millimetres rather than pixels because legibility when engraving is a physical property: the same pixel value means different real sizes on a 40 mm tag and a 300 mm board.

The conversion is per view, since `width_mm` is a per-view column:

```
pxPerMm = canvasWidth / widthMm
minPx   = minFontSizeMm * pxPerMm
```

- [ ] **Step 1: Write the failing tests**

Create `tests/js/utils/fontSizeLimits.test.js`:

```js
import { minFontSizePx } from '../../../shared/js/fontSizeLimits';

describe('minFontSizePx', () => {
  it('converts millimetres to canvas pixels using the view scale', () => {
    // 600px canvas across 60mm → 10px per mm → a 3mm minimum is 30px.
    expect(minFontSizePx({ minFontSizeMm: 3, canvasWidth: 600, widthMm: 60 })).toBeCloseTo(30, 6);
  });

  it('returns 0 when the template sets no minimum', () => {
    expect(minFontSizePx({ minFontSizeMm: 0, canvasWidth: 600, widthMm: 60 })).toBe(0);
    expect(minFontSizePx({ canvasWidth: 600, widthMm: 60 })).toBe(0);
  });

  it('returns 0 when the view has no physical size', () => {
    // Without width_mm there is no millimetre scale, so no minimum is enforced.
    expect(minFontSizePx({ minFontSizeMm: 3, canvasWidth: 600, widthMm: 0 })).toBe(0);
  });

  it('returns 0 for a nonsensical canvas width', () => {
    expect(minFontSizePx({ minFontSizeMm: 3, canvasWidth: 0, widthMm: 60 })).toBe(0);
  });

  it('scales with the canvas, not with the millimetres alone', () => {
    // Same 3mm minimum on a denser canvas yields a larger pixel value.
    const a = minFontSizePx({ minFontSizeMm: 3, canvasWidth: 600, widthMm: 60 });
    const b = minFontSizePx({ minFontSizeMm: 3, canvasWidth: 1200, widthMm: 60 });
    expect(b).toBeCloseTo(a * 2, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/js/utils/fontSizeLimits.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the conversion**

Create `shared/js/fontSizeLimits.js`:

```js
/**
 * Convert a template's minimum font size from millimetres to canvas pixels.
 *
 * The minimum is authored in millimetres because engraving legibility is a
 * physical property: 18px means a different real size on a 40mm tag than on a
 * 300mm board. The conversion is per view, since width_mm is a per-view column.
 *
 * Returns 0 — meaning "no minimum" — when the template sets none or when the
 * view has no physical width to convert against.
 *
 * @param {{minFontSizeMm?:number, canvasWidth?:number, widthMm?:number}} opts
 * @returns {number} minimum font size in canvas pixels
 */
export function minFontSizePx({ minFontSizeMm, canvasWidth, widthMm }) {
  const mm = Number(minFontSizeMm) || 0;
  const cw = Number(canvasWidth) || 0;
  const wmm = Number(widthMm) || 0;
  if (mm <= 0 || cw <= 0 || wmm <= 0) return 0;
  return mm * (cw / wmm);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/js/utils/fontSizeLimits.test.js`
Expected: PASS.

- [ ] **Step 5: Add the setting to the permissions panel**

In `PermissionsPanel.jsx`, inside `pf-permissions__scales`, after the `Max scale` label, add:

```jsx
              {key === 'text' && (
                <label>
                  { __( 'Min font size (mm)', 'snelgraveren-product-designer' ) }
                  <input
                    type="number" step="0.5" min="0"
                    value={perm.min_font_size_mm ?? 0}
                    onChange={(e) => updatePerm(key, 'min_font_size_mm', parseFloat(e.target.value) || 0)}
                    className="pf-permissions__number"
                    title={ __( '0 disables the minimum. Requires the view to have a physical width.', 'snelgraveren-product-designer' ) }
                  />
                </label>
              )}
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add shared/js/fontSizeLimits.js tests/js/utils/fontSizeLimits.test.js admin/js/template-builder/src/components/PermissionsPanel.jsx
git commit -m "feat(text): template minimum font size in millimetres"
```

---

## Task 11: Place customer text centred in the boundary

**Files:**
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`

**Interfaces:**
- Consumes: `minFontSizePx` from Task 10.
- Produces: nothing consumed by later tasks.

**Background for the implementer:**

The `add-text` tool currently sets `canvas.defaultCursor = 'crosshair'` and waits for a `mouse:down`, placing the text with its **top-left corner** on the clicked point (`DesignerCanvas.jsx:775`). Two problems: the customer has to discover the click step, and the `Textbox` is created `zone.width - 20` wide, so the selection box spans nearly the whole zone.

That width is not merely cosmetic. Task 14 shows it is what makes text impossible to drag inside a non-rectangular boundary.

`IText` auto-sizes to its content, which is why the template text layers already use it (`:479`, with the reasoning in the comment there).

- [ ] **Step 1: Replace the add-text effect**

In `DesignerCanvas.jsx`, replace the whole `activeTool === 'add-text'` effect body with:

```js
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'add-text') return;

    // setActiveTool('select') below is async with respect to this effect, so a
    // dependency change in the same tick could re-enter and add a second copy.
    // The ref makes the placement idempotent for one activation of the tool.
    if (addTextGuardRef.current) return;
    addTextGuardRef.current = true;

    // Place immediately, centred in the boundary — no click step. The customer
    // drags it into position afterwards, which is the interaction that actually
    // reads as "put the text where I want it".
    const zoneIdx = zones.findIndex((z) => (z.allowed_types || ['text', 'image', 'svg']).includes('text'));
    const zone = zoneIdx >= 0 ? zones[zoneIdx] : null;
    const defaultFont = zone?.defaultFontFamily || 'Arial';

    const minPx = minFontSizePx({
      minFontSizeMm: permissions.text?.min_font_size_mm,
      canvasWidth,
      widthMm: Number(currentView?.width_mm) || 0,
    });

    const text = new IText(__('Your text here', 'snelgraveren-product-designer'), {
      left:       zone ? zone.x + zone.width / 2  : canvasWidth / 2,
      top:        zone ? zone.y + zone.height / 2 : canvasHeight / 2,
      originX:    'center',
      originY:    'center',
      fontFamily: defaultFont,
      fontSize:   Math.max(24, Math.ceil(minPx)),
      fill:       '#000000',
      data: {
        elementType: 'text',
        zoneIndex:   zoneIdx,
      },
    });

    applyPermissions(text, 'text');
    if (zoneIdx >= 0) applyZoneClip(text, zoneIdx);
    canvas.add(text);
    canvas.setActiveObject(text);
    // Seed the containment anchor at the centre — the most interior point of
    // the zone — so the very first drag has a valid position to fall back to.
    // Without this the object has no anchor and every drag inside a shaped
    // boundary snaps it back to nowhere.
    text._sgpdLastValid = { left: text.left, top: text.top };
    if (zoneIdx >= 0) clampToZone(text);

    pushHistoryRef.current?.();
    canvas.renderAll();
    snapshotView(currentViewIndex, canvas.toJSON(['data']));
    setActiveTool('select');
  }, [activeTool, currentViewIndex, zones, permissions, canvasWidth, canvasHeight,
      currentView, applyPermissions, applyZoneClip, clampToZone, snapshotView, setActiveTool]);
```

Add the import at the top of the file:

```js
import { minFontSizePx } from '../../../../../shared/js/fontSizeLimits';
```

Declare the guard ref beside the other refs near the top of the component (around `DesignerCanvas.jsx:41-46`), and clear it whenever the tool is not active:

```js
  const addTextGuardRef = useRef(false);
```

```js
  useEffect(() => {
    if (activeTool !== 'add-text') addTextGuardRef.current = false;
  }, [activeTool]);
```

Verify `IText` is in the `fabric` import list; the curved-text tool already uses it, so it should be. Verify `useRef` is imported — a missing hook import crashes the whole React tree with no visible error on the page.

- [ ] **Step 2: Centre the curved-text placement too**

In the `add-curved-text` effect, change the `IText` options from `left: ptr.x, top: ptr.y` to the same centred anchor, and seed `_sgpdLastValid` the same way. Keep its click-driven structure otherwise — only the placement changes.

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual verification**

1. As a customer, click "Add text": the text appears immediately, centred in the boundary, already selected — no crosshair, no second click.
2. The selection box hugs the letters instead of spanning the zone.
3. Type: the box grows with the text and stays centred on its anchor.
4. Drag it: it moves smoothly.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat(designer): place new text centred in the boundary, auto-width"
```

---

## Task 12: Enforce the minimum font size

**Files:**
- Modify: `frontend/js/designer/src/components/tabs/ElementTab.jsx`
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`

**Interfaces:**
- Consumes: `minFontSizePx` from Task 10.
- Produces: nothing consumed by later tasks.

**Background for the implementer:**

The size input is **not** the only way to shrink text. Dragging a corner handle changes `scaleY`, not `fontSize`; the effective size is `fontSize × scaleY`. Clamping only the input leaves the handle as an open door.

Fabric enforces `minScaleLimit` natively during a scale gesture, so the cleanest guard is:

```js
obj.minScaleLimit = Math.max(perms.min_scale ?? 0, minPx / obj.fontSize)
```

recomputed whenever `fontSize` changes, since the ratio depends on it.

`ElementTab.jsx:179` currently hardcodes `min="8"`.

Existing saved designs below the minimum are **not** retro-modified: a design opens exactly as the customer left it, and the minimum applies from the next edit.

- [ ] **Step 1: Clamp the size input**

`ElementTab` (the outer component) already destructures `template`, `currentViewIndex` and derives `permissions` at `ElementTab.jsx:12-15`. The size input lives in the `TextProperties` sub-component (`:116`), which receives `perms`, `globalConfig`, `snapshotView` and `currentViewIndex` as props but **not** `template`. Compute the floor in the parent and pass it down as one prop rather than adding a second store subscription in the child.

In `ElementTab`, after `const permissions = globalConfig.permissions || {};`:

```js
  const currentView = template?.views?.[currentViewIndex];
  const sizeFloor = Math.max(8, Math.ceil(minFontSizePx({
    minFontSizeMm: permissions.text?.min_font_size_mm,
    canvasWidth: currentView?.canvas_width || 0,
    widthMm: Number(currentView?.width_mm) || 0,
  })));
```

Pass `sizeFloor={sizeFloor}` to `TextProperties` at both call sites where `perms={perms}` is already passed (`:50` and `:66` — check which of those render `TextProperties` rather than another properties component, and add it only there). Add `sizeFloor` to the `TextProperties` parameter list:

```js
function TextProperties({ fabricObj, perms, globalConfig, snapshotView, currentViewIndex, sizeFloor }) {
```

Then change the size input:

```jsx
        <input
          type="number"
          min={sizeFloor}
          max="200"
          value={fontSize}
          onChange={(e) => {
            const v = Math.max(sizeFloor, parseInt(e.target.value, 10) || 24);
            setFontSize(v);
            update({ fontSize: v });
          }}
        />
```

Add the import:

```js
import { minFontSizePx } from '../../../../../../shared/js/fontSizeLimits';
```

Count the `../` segments against this file's depth (`frontend/js/designer/src/components/tabs/`) — it is one level deeper than `DesignerCanvas.jsx`.

- [ ] **Step 2: Keep the scale limit in step with the font size**

The corner-handle guard in Step 4 derives its ratio from `fontSize`, so it goes stale the moment the customer types a new size. `TextProperties.update` (`ElementTab.jsx:124`) is the single funnel for every property change, so recompute there. Extend it:

```js
  const update = useCallback((props) => {
    if ('fontFamily' in props) {
      fabricCache.clearFontCache(props.fontFamily);
    }
    fabricObj.set(props);
    if ('fontFamily' in props || 'fontSize' in props) {
      fabricObj.initDimensions();
      fabricObj.setCoords();
    }
    // The handle guard is a ratio against fontSize, so it must move with it.
    if ('fontSize' in props && sizeFloor > 8 && fabricObj.fontSize > 0) {
      fabricObj.set({
        minScaleLimit: Math.max(perms.min_scale ?? 0, sizeFloor / fabricObj.fontSize),
      });
    }
    fabricObj.canvas?.renderAll();
    snapshotView(currentViewIndex, fabricObj.canvas?.toJSON(['data']));
  }, [fabricObj, snapshotView, currentViewIndex, sizeFloor, perms]);
```

- [ ] **Step 3: Apply the same floor to engraving text**

In the engraving-text section of the same file (`:621`), apply `min={sizeFloor}` and the same clamp in its `onChange`. Engraving text is the case the rule exists for. `EngravingProperties` needs `sizeFloor` passed to it the same way `TextProperties` does.

- [ ] **Step 4: Guard the scale handles**

In `DesignerCanvas.jsx`, extend `applyPermissions` so text objects carry the derived limit:

```js
  const applyPermissions = useCallback((obj, elementType) => {
    const perms = permissions[elementType] || {};

    if (perms.resize === false) {
      obj.set({ hasControls: false });
    }

    if (perms.rotate === false) {
      obj.setControlVisible('mtr', false);
    }

    if (perms.min_scale != null) {
      obj.set({ minScaleLimit: perms.min_scale });
    }

    // Corner handles change scaleY, not fontSize, so the effective size is
    // fontSize * scaleY. Clamping the size input alone leaves the handles as an
    // open door under the template's engraving minimum.
    const minPx = minFontSizePx({
      minFontSizeMm: permissions.text?.min_font_size_mm,
      canvasWidth,
      widthMm: Number(currentView?.width_mm) || 0,
    });
    if (minPx > 0 && obj.fontSize > 0) {
      obj.set({ minScaleLimit: Math.max(perms.min_scale ?? 0, minPx / obj.fontSize) });
    }
  }, [permissions, canvasWidth, currentView]);
```

This covers objects at creation time. Step 2 keeps the limit correct afterwards, when the customer changes the size.

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

Ask the user to start Docker if needed.

1. On a template with `width_mm = 60`, `canvas_width = 600` and `min_font_size_mm = 3`, the effective floor is 30 px.
2. As a customer, add text: it starts at 30 px, not 24.
3. The size input will not go below 30.
4. **Drag a corner handle inwards** — the text stops shrinking at the floor and will not go smaller.
5. Set `min_font_size_mm` back to 0: the input floor returns to 8 and handles scale freely again.
6. On a view with `width_mm = 0` no minimum applies, and the hint from Task 9 explains why.
7. Open a design saved before this change that contains smaller text: it renders at its original size, unchanged.

- [ ] **Step 7: Commit**

```bash
git add frontend/js/designer/src/components/tabs/ElementTab.jsx frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat(text): enforce the template minimum font size on input and handles"
```

---

## Task 13: Simplify the builder's text layer form

**Files:**
- Modify: `admin/js/template-builder/src/components/TreePanel.jsx`
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`

**Interfaces:**
- Consumes: `layer.originX` / `layer.originY` handling added in Task 3.
- Produces: new text layers carry `originX: 'center', originY: 'center'` with `left`/`top` as the centre point.

**Background for the implementer:**

`LayerDetail`'s text branch offers **Width** (default 200), **X** and **Y** inputs. With text centred by default and auto-sizing to its content, all three are noise — the merchant positions text by dragging on the canvas, which already writes `left`/`top`.

**The compatibility trap.** Existing template text layers were authored as a wide box plus an alignment, and `left` means the box's **left edge**. The customer designer compensates with an anchoring calculation (`DesignerCanvas.jsx:479-497`). If new layers simply stored a centre in the same field, `left` would carry two meanings and positions would silently drift.

The fix is an explicit marker: new layers set `originX`/`originY`, old layers have neither and keep the existing anchoring path exactly. Both canvases read `layer.originX ?? 'left'`.

- [ ] **Step 1: Remove the three fields**

In `TreePanel.jsx`'s `LayerDetail` text branch, delete the `Width` label and the whole `pf-tree-panel__coord-row` div containing X and Y. Keep Text, Font Size, Font Family, the `ColorField` and Text Align. Leave the non-text branch's coordinate row untouched.

- [ ] **Step 2: Centre new text layers**

In `TreePanel.jsx`, replace `handleText`:

```js
  const handleText = () => {
    onAdd({
      name: __('Text', 'snelgraveren-product-designer'),
      type: 'text',
      locked: false,
      visible: true,
      text: __('Text', 'snelgraveren-product-designer'),
      fontSize: 24,
      fontFamily: 'Arial',
      fill: '#000000',
      // Centre anchor: left/top are the CENTRE, not the box's top-left. Layers
      // without originX/originY predate this and keep the old top-left meaning.
      originX: 'center',
      originY: 'center',
      left: zone.x + (zone.width || 200) / 2,
      top:  zone.y + (zone.height || 200) / 2,
    });
  };
```

- [ ] **Step 3: Render builder text layers as `IText`**

In `Canvas.jsx`'s text branch, replace `Textbox` with `IText` so the builder shows what the customer will see. In the create path:

```js
          const text = new IText(layer.text, {
            left:       layer.left       ?? 100,
            top:        layer.top        ?? 100,
            originX:    layer.originX    || 'left',
            originY:    layer.originY    || 'top',
            fontSize:   layer.fontSize   || 24,
            fontFamily,
            fill:       layer.fill       || '#000000',
            textAlign:  layer.textAlign  || 'left',
            opacity:    layer.opacity    ?? 1,
            visible:    layer.visible !== false,
            selectable: !layer.locked,
            evented:    !layer.locked,
            data:       layerData(layer),
          });
```

Drop the `width` and `textWidth` computation from both the create and the update path — `IText` sizes itself. In the update path, remove `width` from the `existing.set({…})` call and add `originX`/`originY`/`opacity`.

Update the `fabric` import at the top of `Canvas.jsx`: add `IText`, and remove `Textbox` if nothing else in the file uses it.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification**

1. In the builder, add a text layer to a zone: it appears centred with a box that hugs the letters.
2. The layer form shows Text, Font Size, Font Family, Color and Align — no Width, no X, no Y.
3. Drag the text on the canvas, save, reload: it is where you left it.
4. **Regression:** open a template authored **before** this change that has text layers. Their visual positions are unchanged in both the builder and the customer designer. This is the case the `originX` marker exists to protect.

- [ ] **Step 6: Commit**

```bash
git add admin/js/template-builder/src/components/TreePanel.jsx admin/js/template-builder/src/components/Canvas.jsx
git commit -m "feat(builder): auto-width centred text layers, drop width and x/y fields"
```

---

# Phase 4 — Locking and dragging (spec §6, §7)

## Task 14: Diagnose and fix the containment snap-back

**Files:**
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`
- Modify: `admin/js/template-builder/src/components/Canvas.jsx`

**Interfaces:**
- Consumes: the centred placement from Tasks 11 and 13.
- Produces: nothing consumed by later tasks.

**REQUIRED SUB-SKILL:** Use `superpowers:systematic-debugging`. This is a bug, not a feature. Reproduce it and confirm the root cause from observed behaviour **before** editing anything.

**The hypothesis to confirm or refute:**

For a zone with `boundary_type: 'svg'` and `behavior: 'restrict'`, `clampToZone` tests true shape containment (`DesignerCanvas.jsx:199-214`):

```js
const pts = objectSamplePoints(obj.getCoords());
if (pts.length && pointsInsideZoneShape(shape, zone, pts)) { …accept… }
if (obj._sgpdLastValid) { …snap back… }
```

`objectSamplePoints` (`shared/js/zoneContainment.js:56`) samples the object's four rotated bounding-box corners, the four edge midpoints and the centre. `pointsInsideZoneShape` requires **every** point to be inside the path.

A `Textbox` created `zone.width - 20` wide has a bounding box nearly as wide as the zone's bounding box, so for a non-rectangular contour — a bone tag, an oval, a heart — the corners lie outside the outline by construction. Containment can never pass, so every drag snaps back to `_sgpdLastValid`.

- [ ] **Step 1: Reproduce**

Ask the user to start Docker if needed.

Build a template with a bone-shaped or oval SVG boundary, `behavior: 'restrict'`, containing a text layer. Open it as a customer and try to drag the text. Record exactly what happens.

- [ ] **Step 2: Confirm the mechanism**

In the browser console, with the text selected, log the containment inputs during a drag:

```js
// Replace with the actual canvas handle available in the page.
const obj = canvas.getActiveObject();
console.log('corners', obj.getCoords());
console.log('bbox width vs zone width', obj.getBoundingRect().width, zone.width);
```

Expected if the hypothesis holds: the bounding-box width is close to the zone width, and some sample points test outside the path.

**If the observed cause differs, stop and report it** rather than applying the fix below.

- [ ] **Step 3: Verify Tasks 11 and 13 already improved it**

With the `IText` change in place, repeat Step 1. Text should now drag inside the shape. Note how much of the problem remains — this tells you whether Step 4 is still needed.

- [ ] **Step 4: Seed the anchor on every object placed in a zone**

Anywhere an object is added to a restrict-mode zone and `clampToZone` is called, seed the anchor first so the object has a valid position to fall back to:

```js
              obj._sgpdLastValid = { left: obj.left, top: obj.top };
```

Apply this in `DesignerCanvas.jsx` for the template `text`, `svg` and `image` branches and for clipart/upload additions, and in the builder's `Canvas.jsx` equivalents. Task 11 already did it for newly added text.

- [ ] **Step 5: Verify the fix**

Repeat Step 1. Text and logos drag freely inside the shaped boundary and stop at its outline rather than snapping back. Confirm in **both** the builder and the customer designer, since both carry the same clamp.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/designer/src/components/DesignerCanvas.jsx admin/js/template-builder/src/components/Canvas.jsx
git commit -m "fix(zones): seed the containment anchor so objects can be dragged in shaped boundaries"
```

---

## Task 15: Make layers movable for the customer

**Files:**
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`

**Interfaces:**
- Consumes: the image branch from Task 4, the clamp fix from Task 14.
- Produces: nothing consumed by later tasks.

**Background for the implementer:**

Today `layer.locked` is **never read** in the customer designer — the word appears only in a comment. Instead template `svg` layers are hardcoded `templateLocked: true` (`:526-534`) and text layers are always editable.

The target: the lock toggle governs the **boundary only, and only in the Template Builder**. In the customer designer the boundary stays fixed under all circumstances, and every layer is movable within it. The bitmap background from Task 4 is the single exception.

**The hazard — read this before touching the re-lock loop.** After `loadFromJSON`, `DesignerCanvas.jsx:573` re-locks everything carrying `data.templateLocked`. Designs already saved on snelgraveren.nl carry `templateLocked: true` in their stored JSON. If that loop survives unchanged, those designs keep their logos frozen and the loop re-freezes the new movable layers on every reopen.

This is a save-path change touching stored customer designs. Task 16 is the gate.

- [ ] **Step 1: Unlock template svg layers**

In the `layer.type === 'svg'` branch (`DesignerCanvas.jsx:519-535`), replace this block — **including the comment**, which now states the opposite of the new behaviour:

```js
                // Pre-placed template artwork is locked for the customer:
                // non-selectable art they can't move, resize, rotate or delete.
                // Only text layers stay editable. Customer-added SVGs (clipart)
                // go through a different add path and remain interactive.
                // data.templateLocked is re-enforced on snapshot restore.
                selectable:    false,
                evented:       false,
                hasControls:   false,
                lockMovementX: true,
                lockMovementY: true,
                data:          { elementType: 'svg', zoneIndex: zoneIdx, templateLocked: true },
```

with:

```js
                // Template artwork is customer-movable: the lock toggle governs
                // the boundary in the Template Builder, not layers here.
                selectable:    true,
                evented:       true,
                data:          { elementType: 'svg', zoneIndex: zoneIdx },
```

and directly after `canvas.add(group)` add:

```js
              applyPermissions(group, 'svg');
              group._sgpdLastValid = { left: group.left, top: group.top };
              if (zone.behavior === 'restrict') clampToZone(group);
```

- [ ] **Step 2: Narrow the re-lock loop**

Replace the loop at `:573`:

```js
          canvas.getObjects().forEach((obj) => {
            if (obj.data?.templateLocked) {
              obj.set({ selectable: false, evented: false, hasControls: false, lockMovementX: true, lockMovementY: true });
            }
          });
```

with:

```js
          // Only background art stays locked. Designs saved before layers
          // became movable carry data.templateLocked on their template svg
          // layers too; honouring that flag blindly would keep those designs
          // frozen forever and re-freeze every newly movable layer on reopen.
          // templateArt is set only by the bitmap background branch.
          canvas.getObjects().forEach((obj) => {
            if (obj.data?.templateArt) {
              obj.set({ selectable: false, evented: false, hasControls: false, lockMovementX: true, lockMovementY: true });
            } else if (obj.data?.templateLocked) {
              obj.set({ selectable: true, evented: true, hasControls: true, lockMovementX: false, lockMovementY: false });
            }
          });
```

- [ ] **Step 3: Confirm the boundary stays fixed**

The zone overlay branches (`:341` and `:434`) already set `selectable: false, evented: false` and call `sendObjectToBack`. **Leave them exactly as they are.** `clampToZone` reads `zone.x`/`zone.y` from the template configuration, not from the rendered overlay, so a customer-movable boundary would decouple the visible outline from the containment geometry.

- [ ] **Step 4: Confirm z-order still protects clicks**

The existing "bring text to front after async template art loads" block must stay. Without it a group's bounding-box hit area swallows clicks meant for the text underneath. Verify it still runs after the svg branch's `canvas.add(group)`.

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

1. As a customer, open a product whose template has an svg logo layer: the logo is selectable and drags within the boundary.
2. Dragging it to the boundary edge stops it there rather than snapping it back.
3. The boundary outline itself cannot be selected or moved.
4. The bitmap background cannot be selected, and clicking on it selects whatever is above it.
5. In the Template Builder, locking the boundary with the padlock still freezes it there.

- [ ] **Step 7: Commit**

```bash
git add frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat(designer): template layers are customer-movable within the boundary"
```

---

## Task 16: Save-path regression proof

**Files:** none — this is a verification gate.

**Interfaces:**
- Consumes: everything.
- Produces: the evidence required before any of this is deployed.

**Background for the implementer:**

Task 15 changed what happens to stored customer designs on restore. A previous save-path change on this project cost real customer data: a design reopened and re-saved came back empty. The rule from that incident is that a save-path change must be **proven** on the dev environment to preserve content before it goes live — not reasoned about, proven.

**Do not skip this task, and do not report the work complete without its output.**

- [ ] **Step 1: Create a design under the OLD code**

```bash
git stash            # set the working tree back to pre-change
npm run build
```

Ask the user to start Docker if needed. As a customer, create and save a design containing: template text, a template svg logo, a customer-added text element, and a customer-uploaded image. Note the design hash from the hidden `pf_design_hash` input.

Record the stored state:

```bash
docker compose exec -T wordpress wp db query \
  "SELECT dv.id, LENGTH(dv.canvas_json) AS json_len, LENGTH(dv.thumbnail) AS thumb_len
   FROM wp_pf_design_views dv
   JOIN wp_pf_designs d ON d.id = dv.design_id
   WHERE d.design_hash = '<HASH>'"
```

- [ ] **Step 2: Restore the new code**

```bash
git stash pop
npm run build
```

- [ ] **Step 3: Reopen and re-save**

Open the product page with `?pf_design=<HASH>`. Confirm visually that every element is present and positioned as saved.

Then move one element and save.

- [ ] **Step 4: Prove nothing was lost**

Re-run the query from Step 1.

Expected: `json_len` is in the same order of magnitude as before — **not** near-zero, and not missing rows. Reload the page once more and confirm all four elements are still on the canvas.

**If any element is missing or `json_len` collapsed, stop. Do not deploy.** Report the finding and re-open Task 15.

- [ ] **Step 5: Run the whole test suite**

```bash
npm test
docker compose exec wordpress bash -c "cd wp-content/plugins/productforge && phpunit"
```

Expected: all green. Report the actual output, including any pre-existing failures, rather than summarising it as "tests pass".

- [ ] **Step 6: Record the result**

Append the evidence — the two query outputs and the test summary — to `current_status.md` under a dated heading, so the next session can see the gate was cleared and with what.

```bash
git add current_status.md
git commit -m "docs: record the save-path regression proof for the layer-locking change"
```

---

## Deployment

Not part of any task above. When the user asks for it, follow CLAUDE.md:

1. Bump the version in `snelgraveren-product-designer.php` (header **and** `SGPD_VERSION`) and in `readme.txt` (Stable tag **and** changelog).
2. `bash bin/package.sh`
3. Upload the ZIP **from the project directory** — the Freemius download is named `…-premium.zip` and installs as a second folder instead of updating the live one.
4. WP admin → Plugins → Upload → "Huidige vervangen door de geüploade".
5. LiteSpeed → Purge All.
6. Check the active row on `plugins.php` to confirm which version is live.

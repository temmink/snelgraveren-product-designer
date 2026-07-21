# LightBurn (.lbrn2) Import for Templates — Design Spec

**Date:** 2026-07-21
**Status:** Draft
**Scope:** Import a LightBurn project file (`.lbrn2`) in the admin Template Builder and convert its shapes into fully editable Fabric objects on the current view's canvas.

## Goal

A laser/engraving shop authors artwork in LightBurn. This feature lets a merchant import that `.lbrn2` file directly in the Template Builder so its geometry and text become individual, editable objects on the template canvas — instead of rebuilding the design by hand. Physical scale (mm) is preserved so exports come out at true size.

## Decisions (locked)

1. **Fully editable canvas** — every supported LightBurn element becomes a separate, editable Fabric object (not a flat background image).
2. **Text: editable, with vector fallback** — text imports as an editable text object with its font mapped to the nearest web font. If no web font matches, we use LightBurn's stored backup vector path instead (exact shape, not editable) and emit a warning.
3. **Cut-layers preserved as color (round-trip)** — each LightBurn cut-layer maps to a stable stroke color; paths import stroke-only (engraving style). On SVG export the colors survive, so re-importing into LightBurn recovers the layers.
4. **Pro (premium) feature** — the import UI is gated behind premium, consistent with custom fonts / clip-art management.
5. **One view per import** — shapes land on the currently selected view. A two-sided product is filled by importing one file per side (select BACK tab, import second file). A single `.lbrn2` never auto-splits across views.
6. **Per-path editable layers** — every LightBurn path becomes its own editable layer (not one grouped object), delivered via a new inline-vector layer type (see "Persistence model" below).

## Persistence model (corrected during planning)

The Template Builder does **not** persist a view as raw canvas JSON. It stores **layers** inside `zones_config[zoneIndex].layers[]` (a JSON blob on `wp_pf_template_views.zones_config`). Each layer has a `type`:

- **`text`** — stores content inline: `text`, `fontFamily`, `fontSize`, `left`, `top`, `width`, `fill`, `textAlign`. The frontend designer instantiates these directly (`DesignerCanvas.jsx`, the `zone.layers` loop).
- **`svg`** — today renders **only from a URL** (`layer.src`, fetched then `loadSVGFromString`). There is no inline-vector layer.

To import each LightBurn path as its own editable layer without uploading one SVG file per path, we add **inline-vector support** to the `svg` layer type: a new optional `svg_markup` field holding a small standalone `<svg>` for that single path. This touches three places:

1. **Builder render** (`admin/js/template-builder/src/components/Canvas.jsx`, `svg` branch) — when `layer.svg_markup` is present and `layer.src` is absent, render via `loadSVGFromString(layer.svg_markup)` instead of `fetch(layer.src)`.
2. **Frontend render** (`frontend/js/designer/src/components/DesignerCanvas.jsx`, the `zone.layers` loop) — currently instantiates only `text` layers; add a `type === 'svg'` branch that renders `svg_markup` (or `src`) as a positioned group.
3. **Server sanitisation** (`includes/API/class-rest-templates.php`, view create/update) — `svg_markup` is admin-provided raw SVG that is later served to every customer, so it MUST be run through `enshrined\svgSanitize\Sanitizer` on save (same library the plugin already uses for uploads). This is the one security-critical addition.

Imported content therefore becomes ordinary `text` and `svg` (inline) layers via the store's `addLayer(viewIndex, zoneIndex, layer)` action, and saves + loads through the existing template pipeline.

## The `.lbrn2` format (verified against `test_svg_import.lbrn2`)

Plain XML (not gzipped), root `<LightBurnProject AppVersion DeviceName FormatVersion MaterialHeight MirrorX MirrorY …>`. Coordinates are in **millimetres**.

### Cut settings (layers)

```xml
<CutSetting type="Scan"><index Value="0"/><name Value="Outer Cut"/>…</CutSetting>
<CutSetting type="Cut"><index Value="2"/><name Value="C02"/>…</CutSetting>
```

Each layer has an `index`, a `name`, and a `type` (`Cut` / `Scan` / others). LightBurn does not store the layer's RGB in the CutSetting — the colour is derived from the index via LightBurn's fixed 30-entry palette. We reproduce that palette so imported colours match LightBurn and round-trip cleanly.

### Shapes

Each `<Shape>` carries a `Type`, a `CutIndex` (→ layer), and an `<XForm>` affine matrix `a b c d e f` (SVG-style, in mm) placing the shape's local geometry into machine space.

- **Text:** `Type="Text" Font="Arial,-1,4096,5,400,0,0,0,0,0" Str="Bobbie" H="6.175" Ah=".." Av=".." HasBackupPath="1"`.
  - `Font` is a Qt QFont string: `family,pointSize,pixelSize,styleHint,weight,italic,underline,strikeOut,fixedPitch,rawMode`. We use `family` and `weight`.
  - `H` = text height in mm. `Ah`/`Av` = horizontal/vertical anchor.
  - `HasBackupPath="1"` → the shape also contains a `VertList`/`PrimList` outline of the text (our fallback geometry).
- **Path:** `Type="Path" VertID PrimID` referencing a `<VertList>` + `<PrimList>`.

### Geometry encoding (`VertList` / `PrimList`)

- **VertList:** a sequence of `V x y` vertices, each optionally followed by bezier control handles `c0x c0y c1x c1y` (`c0*` = incoming handle, `c1*` = outgoing handle). Handle components can be omitted and default to the vertex coordinate (a handle collinear with the vertex).
- **PrimList:** primitives connecting vertices by index — `L a b` = straight line a→b; `B a b` = cubic bezier a→b using vertex `a`'s outgoing handle (`c1`) and vertex `b`'s incoming handle (`c0`). Multiple subpaths appear as separate primitive runs; a run that returns to its start vertex is a closed contour.

## Architecture

### Components

1. **`admin/js/template-builder/src/utils/lbrnParser.js`** — pure, DOM-light parsing + geometry + layer building. No Fabric, no React. Testable in isolation.
   - `vertPrimToPathData(vertList, primList) → string` (SVG `d`) — the core geometry decoder.
   - `qtFontToFamily(fontString) → { family, weight }`.
   - `layerColor(index) → '#rrggbb'` (LightBurn palette).
   - `parseLbrn(xmlString, { availableFonts }) → { layers: LayerDescriptor[], widthMm, heightMm, warnings: string[] }` — the top-level entry. `availableFonts` is the set of family names the builder can render (`AVAILABLE_FONTS` from `fonts.js`), injected so the module stays pure/testable.
   - `LayerDescriptor` is a plain object ready for the store's `addLayer`:
     - text → `{ type: 'text', text, fontFamily, fontSize, left, top, fill, textAlign }`
     - path → `{ type: 'svg', svg_markup, left, top, scaleX: 1, scaleY: 1 }` where `svg_markup` is a standalone `<svg>` containing that one path (`stroke = layerColor(cutIndex)`, `fill: none`).
   - All `left`/`top`/`fontSize` are in **canvas px** (after bbox + Y-flip + mm→px); `svg_markup` holds the path in its own local coordinates, positioned by the layer's `left`/`top`.

2. **Import handler** — wired into the Template Builder (a Pro-gated "Import LightBurn" button near the view/canvas controls). Flow: file picker (`accept=".lbrn2"`) → `FileReader` text → `parseLbrn(xml, { availableFonts: AVAILABLE_FONTS.map(f => f.family) })` → for each descriptor call `addLayer(currentViewIndex, targetZoneIndex, descriptor)` → set the view's `width_mm` via `updateView(currentViewIndex, { width_mm })` → surface a summary + warnings (unmapped font → backup path, skipped bitmap, etc.).

3. **Inline-vector layer type** — the three touchpoints from "Persistence model": builder render, frontend render, server sanitisation.

### Data flow

```
.lbrn2 file
  → FileReader (text)
  → parseLbrn(xml, {availableFonts})   // XML → LayerDescriptor[] in canvas px
  → addLayer() per descriptor + updateView({width_mm})
  → store layers (zones_config[].layers[])
  → merchant edits (zones, permissions, pricing) → existing template save
      → server sanitises each layer's svg_markup (enshrined/svg-sanitize)
  → frontend designer instantiates text + svg(inline) layers
```

### Coordinate & scale mapping

- Union bbox of all shapes in mm → `widthMm` / `heightMm`.
- Pick a fixed working resolution `pxPerMm` (**3.7795 px/mm ≈ 96 dpi**, matching the existing SVG-import unit conversion in `svgPathUtils.js`/Canvas so imported vectors share one scale). This is a rendering resolution only.
- Global transform per point: translate so the bbox min corner is `(0,0)`, **flip Y** (LightBurn Y-up → canvas Y-down), scale mm→px by `pxPerMm`. (Y-flip verified in the manual test; it is a one-line toggle if orientation comes out mirrored.)
- View `width_mm` = `widthMm` (true physical size). `width_mm` — not the pixel count — drives the true-scale export pipeline added in 1.3.0.
- Every object is transformed into that canvas space (offset + Y-flip + scale).

### Premium gating

The import control is rendered/enabled only when the builder config reports premium (same flag the builder already uses to gate Pro features). This is a UX/feature gate, not a security boundary — the produced content is a normal template save available to any `edit_pf_templates` admin. That is acceptable for an admin-only authoring convenience; no server enforcement endpoint is added in v1.

## Scope (v1)

**Supported shape types:** `Text`, `Path`, `Rect`, `Ellipse`, `Group` (flattened into its child shapes).
`Rect`/`Ellipse` are converted to path geometry so downstream handling is uniform.

**Skipped with a warning:** `Bitmap`/image shapes, and any unrecognised `Type`. The rest of the import still succeeds.

**One view per import** into the currently selected view.

## Error handling & warnings

- **Invalid / non-LightBurn XML** → clear error, nothing added to the canvas.
- **Unmapped font** → text imported as backup vector path; warning lists the affected font.
- **Bitmap / unsupported shape** → skipped; warning names how many and which type.
- **Empty result** (no supported shapes) → informational message, canvas unchanged.
- **Malformed VertList/PrimList run** → that shape is skipped with a warning; the rest import.

## Security

`svg_markup` is admin-authored raw SVG stored in the template and served to every customer's browser. It MUST be sanitised server-side on save with `enshrined\svgSanitize\Sanitizer` (the library already used for uploads), stripping `<script>`, `on*` handlers, external refs, `foreignObject`, and `data:` URIs — per the plugin's SVG security rules. Sanitisation happens on WRITE (view create/update) so stored data is always clean; the parser also emits only `<svg><path>` markup, never scripts.

## Testing

- **Unit tests (pure functions, no DOM/Fabric)** — `tests/js/utils/lbrnParser.test.js`:
  - `vertPrimToPathData` — feed the `test_svg_import.lbrn2` VertList/PrimList fixtures; assert the SVG `d` string produces the expected `M/L/C` commands and closed contours.
  - `qtFontToFamily` — `Arial,-1,4096,5,400,…` → `{ family: 'Arial', weight: 400 }`.
  - `layerColor` — stable hex per index; two different indices → two different colours.
  - `parseLbrn` (integration, using the fixture file) — returns one `text` layer (`text: 'Bobbie'`, `fontFamily: 'Arial'`) and two `svg` layers with non-empty `svg_markup`; a known vertex lands at the expected canvas px (bbox + Y-flip + mm→px); `widthMm` matches the design bbox; an unknown-font fixture routes text to a backup `svg` layer + warning.
- **PHP test / manual** — server sanitisation: a layer whose `svg_markup` contains `<script>` is stored stripped of the script.
- **Manual (dev):** import `test_svg_import.lbrn2` in the builder → "Bobbie" text + bone outline + engraved lines appear at correct relative positions and physical scale; each path is its own movable layer; text is editable; save as a template; open in the frontend designer and confirm the vector layers render + true-size SVG export.

## Non-goals (YAGNI)

- Exporting back to `.lbrn2`.
- Importing machine settings (power, speed, PPI, passes).
- Bitmap/raster shapes.
- Multi-file batch import or auto-splitting one file across multiple views.
- Preserving LightBurn layer names/order as metadata (colour round-trip only in v1).

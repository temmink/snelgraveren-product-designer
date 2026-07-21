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

1. **`admin/js/template-builder/src/utils/lbrnParser.js`** — pure, DOM-light parsing + geometry. No Fabric, no React. Testable in isolation.
   - `parseLbrn(xmlString) → { widthMm, heightMm, shapes: ParsedShape[], warnings: string[] }`
   - `vertPrimToPathData(vertList, primList) → string` (SVG `d`) — the core geometry decoder.
   - `qtFontToFamily(fontString) → { family, weight }`.
   - `layerColor(index) → '#rrggbb'` (LightBurn palette).
   - `ParsedShape` = `{ kind: 'path'|'text', d?, text?, family?, weight?, heightMm?, xform, cutIndex, backupPathData? }` in **machine mm space** (XForm already applied to local geometry).

2. **`admin/js/template-builder/src/utils/lbrnToFabric.js`** — turns `parseLbrn` output into Fabric object JSON for one view.
   - Computes the union bounding box of all shapes (mm).
   - Picks a working resolution `pxPerMm` (fixed constant, e.g. 4 px/mm ≈ ~100 dpi, chosen so a typical design lands on a comfortably sized canvas). This is a rendering resolution only; true size is carried by `width_mm`, not by the pixel count.
   - Builds a global transform: translate so the bbox min corner is `(0,0)`, **flip Y** (LightBurn Y-up → canvas Y-down), scale mm→px by `pxPerMm`.
   - Emits Fabric `Path` objects (stroke = `layerColor(cutIndex)`, `fill: ''`) and text objects.
   - Text: if `qtFontToFamily` maps to an available web font → editable text object (`fontSize` derived from `heightMm`, positioned/anchored per `Ah`/`Av`); else → `Path` from `backupPathData` + warning.
   - Returns `{ objects, widthMm, heightMm, warnings }`.

3. **Import UI** — an "Import LightBurn" control in the Template Builder (near the view/canvas controls). File picker (`accept=".lbrn2"`) → read text → `parseLbrn` → `lbrnToFabric` → add objects to the current view's Fabric canvas → set the view's `width_mm` from the design width. Shows a summary + any warnings (unmapped font, skipped bitmap, etc.).

### Data flow

```
.lbrn2 file
  → FileReader (text)
  → parseLbrn()            // XML → ParsedShape[] in mm (XForm applied)
  → lbrnToFabric()         // bbox + Y-flip + mm→px → Fabric object JSON
  → add to current view canvas + set view.width_mm
  → merchant edits (zones, permissions, pricing)
  → existing template save (server-side Fabric-JSON validation/sanitisation)
```

No new REST endpoint: the import produces ordinary canvas content saved through the existing template-view save path, which already whitelists Fabric object types and sanitises. Text strings are sanitised on the way in as well.

### Coordinate & scale mapping

- Union bbox of all shapes in mm → `widthMm` / `heightMm`.
- View `width_mm` = `widthMm` (true physical size); canvas pixel size = `widthMm × pxPerMm` by `heightMm × pxPerMm` with the fixed `pxPerMm` above. `width_mm` — not the pixel count — drives the true-scale export pipeline added in 1.3.0.
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

## Testing

- **Unit tests (pure functions, no DOM/Fabric):**
  - `vertPrimToPathData` — feed the `test_svg_import.lbrn2` VertList/PrimList fixtures; assert the SVG `d` string produces the expected closed contours and bezier segments.
  - Coordinate transform — assert bbox, Y-flip, and mm→px scaling place a known vertex at the expected canvas pixel.
  - `qtFontToFamily` — `Arial,-1,4096,5,400,…` → `{ family: 'Arial', weight: 400 }`.
- **Manual (dev):** import `test_svg_import.lbrn2` into the builder → "Bobbie" text + bone outline + engraved lines appear at the correct relative positions and physical scale; text is editable; save as a template; open in the frontend designer and confirm layout + true-size SVG export.

## Non-goals (YAGNI)

- Exporting back to `.lbrn2`.
- Importing machine settings (power, speed, PPI, passes).
- Bitmap/raster shapes.
- Multi-file batch import or auto-splitting one file across multiple views.
- Preserving LightBurn layer names/order as metadata (colour round-trip only in v1).

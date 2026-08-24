# FIX-fontremeasure — selection box still ~1/3 too wide after the alias + per-object fixes

## Root cause (confirmed, not the same as either prior fix)

Two independent mechanisms exist to correct a text object's stale (fallback-font) width, and
**neither covers the exact-alias proxy-registered case**:

1. **Global `document.fonts.addEventListener('loadingdone', ...)` handler** (in both
   `Canvas.jsx` and `DesignerCanvas.jsx`). `registerViaProxy()`
   (`shared/js/googleFontLoader.js`) builds a `FontFace` from proxy-fetched bytes and does
   `await face.load()` **before** `document.fonts.add(face)`. By the time the face is added to
   the set it is already in the `loaded` state — the set never observes an
   `unloaded → loading → loaded` transition for it, and per the CSS Font Loading Module spec
   that transition is what drives `'loadingdone'`. Confirmed live: the event genuinely never
   fires for this path (matches the task's hypothesis).
2. **`ensureFontMeasured` (348c10a), per-object, at creation/update time.** It does
   `document.fonts.check(spec)` → if false, `await document.fonts.load(spec)`. For the
   alias case, at the moment an object is created the alias isn't in `document.fonts` yet (the
   proxy fetch is still in flight), so `check` is false — but `document.fonts.load(spec)` can
   only wait on fonts already declared via `@font-face` CSS or already in the set; there is
   nothing yet for it to find, so it resolves immediately with an empty match (per spec, no
   hang) and `ensureFontMeasured` returns having done nothing. It never gets a second chance —
   it isn't re-invoked once the proxy actually finishes.

So the "631.78 unchanged for 8s" symptom is exactly explained: the object is created before the
proxy call resolves, `ensureFontMeasured` fires once and finds nothing to await, and
`loadingdone` never fires for the manually-added `FontFace`. `ensureFontMeasured` is NOT broken
for its intended cases (custom uploaded fonts, canonical Google Font names loaded via the css2
`<link>` — both are real `@font-face` declarations `document.fonts.load()` can actually await);
it structurally cannot solve the alias-via-manual-`FontFace` case, because there is no
`@font-face` rule for it to hook onto before the proxy finishes.

## Fix — drive re-measurement from the loader's own completion, not a font event

`shared/js/googleFontLoader.js`:
- Added a module-level pub/sub: `onFontFamilyLoaded(callback)` (returns an unsubscribe
  function) / internal `notifyFamilyLoaded(family)`.
- `registerViaProxy()` now tracks `loadedAny` across its two-weight loop and calls
  `notifyFamilyLoaded(family)` once, only if at least one weight's `FontFace` was successfully
  `add()`ed. No notify on total failure (network down, proxy error).

`admin/js/template-builder/src/components/Canvas.jsx` and
`frontend/js/designer/src/components/DesignerCanvas.jsx`: each got a new `useEffect` (empty
deps, `[]`) that subscribes to `onFontFamilyLoaded` on mount and unsubscribes on unmount. The
callback reads `fabricRef.current` **at call time** (not captured at effect setup), calls
`fabricCache.clearFontCache(family)` (per-family, matching the existing `ensureFontMeasured`
convention — same bundled `cache` import each file already has, so no
fresh-module-instance-has-its-own-cache problem), then `initDimensions()` + `setCoords()` on
every current `text`/`i-text` object whose `fontFamily === family`, then `canvas.renderAll()`.

**Authority.** `onFontFamilyLoaded` is authoritative for the proxy-registered-alias path — it's
the only mechanism guaranteed to fire for it. `ensureFontMeasured` remains authoritative (and is
unchanged) for its original cases: it correctly no-ops when a font is already resolved, and
correctly awaits real `@font-face` loads (custom fonts, canonical google names). The old
`document.fonts.ready`/`'loadingdone'` global handler is left in place, now explicitly commented
as a secondary safety net for genuine browser font-loading-state transitions — it does no harm
and still helps for e.g. slow custom-font file loads; it is not relied on for the alias case.

**Why this doesn't need extra "catch-up" logic on mount.** Both `App.jsx`s trigger
`loadGoogleFonts()` from an effect that fires only after `Canvas`/`DesignerCanvas` has already
mounted in the same commit (child effects fire before the parent's own effects for a shared
commit), so the subscription is always established before `registerViaProxy`'s `fetch()` can
resolve. Verified this holds in practice via the browser timelines below (subscribers were
listening well before the proxy's network round-trip completed in both apps).

## Reconciling with `ensureFontMeasured` (348c10a) — verdict

Not fighting, not redundant duplicates: they cover disjoint failure windows.
- Object created **after** the family is already in `document.fonts` (later navigations, view
  switches within the same page session): Fabric measures correctly from construction — no bug,
  neither mechanism needs to do anything (`ensureFontMeasured`'s `check()` fast-path correctly
  no-ops).
- Object created **before** a real declared `@font-face` (custom font, canonical css2 name)
  resolves: `ensureFontMeasured` is authoritative — `document.fonts.load()` has something to
  wait on.
- Object created **before** a proxy-registered alias resolves: the new `onFontFamilyLoaded`
  subscription is authoritative — this is the gap `ensureFontMeasured` cannot close.

## Tests

- `tests/js/utils/googleFontLoader.test.js`: 3 new cases — notifies subscribers with the family
  name once the proxy `FontFace` is added; does NOT notify when every weight's fetch fails;
  stops notifying after `unsubscribe()`.
- `npm test`: **235 total, 223 passed, 12 failed** — the 12 failures are the pre-existing
  `window.matchMedia is not a function` failures in `AddTab.test.js`/`Sidebar.test.js`, count
  unchanged from before this fix (232 → 235 total reflects the +3 new tests).
- `npm run build`: clean, all four entry points built (pre-existing >500kB chunk-size warnings
  for `admin-template-builder.js`/`frontend-designer.js`, unrelated).

## Environment check

`curl -s "http://localhost:8080/wp-json/pf/v1/font-file?family=Bebas%20Neue" | head -c 80`
returned real TTF-derived base64 (`{"format":"ttf","data":"AAEAAAARAQAABAAQR0RFRg..."`), and the
bind-mounted `dist/` in the container matched the freshly built files (mtimes verified) before
any browser verification.

## Browser verification — timeline, not a spot check

Method: on `navigate_page(type: reload, ignoreCache: true, initScript: ...)`, the `initScript`
installs a `setInterval` (250ms) **before any app code runs** that walks the React fiber tree
from every `<canvas>` element to find the `useRef` holding the live Fabric `Canvas` instance
(`hook.memoizedState.current` with a `getObjects` function), locates the Bebas-Neue text object,
and records `{t, width}` against `Date.now()` from the instant the document starts loading. This
captures the true cold-load window, not just whatever state exists after my own tool round-trip
completes.

### Admin Template Builder (`template_id=1`, "Naam Hond", `BebasNeue` @ 130px)

| t (ms) | width |
|---|---|
| 752 | 631.78 (fallback) |
| 1001 | 631.78 |
| 1253 | 631.78 |
| **1502** | **466.05 (corrected)** |
| 1754 … 11002 | 466.05 (stable for the remaining 9.5s) |

Corrected ~1.5s after the object was first measured. Never regressed afterward.

`measureText` triad (actual object text `"Naam Hond"`, size 130):
nonsense = `631.7822265625`, alias (`"BebasNeue"`) = `466.0499267578125`,
canonical (`"Bebas Neue"`) = `466.0499267578125`. Fabric `obj.width` = `466.0499851226807` —
agrees with the alias measurement.

Selection box screenshotted after `canvas.setActiveObject(obj)`: hugs "NAAM HOND" tightly on all
sides.

### Customer designer (`/hondenpenning-graveren/`, same template/layer)

| t (ms) | width |
|---|---|
| 513 | 631.78 (fallback) |
| 752 … 6751 | 631.78 (unchanged for ~6.75s — this app loads custom fonts, THEN Google fonts,
so the proxy fetch starts later than in the builder) |
| **7004** | **466.05 (corrected)** |
| 7257 … 11005 | 466.05 (stable for the remaining ~4s) |

`measureText` triad: nonsense = `631.7822265625`, alias = `466.0499267578125`, canonical (css2
`<link>` still `loading` at sample time) = `631.7822265625`. Fabric `obj.width` =
`466.0499851226807` — agrees with the alias measurement, not the still-loading canonical one.

**This directly answers the task's "is the designer correct for a sound reason or by luck"
question: it was NOT sound before this fix.** The pre-existing `ensureFontMeasured`/`loadingdone`
mechanisms leave the same ~7s wrong-width window here that the builder had at ~1.5s — the
customer designer's longer sequential (custom-fonts-then-Google-fonts) load chain would have
made the bug even more visible on a real page, not less. The new `onFontFamilyLoaded`
subscription is what corrects it in both apps; without it, this would have failed the same way
on a slow connection, confirming the task's concern.

Selection box screenshotted (scrolled to the `#pf-designer-root` element,
`canvas.setActiveObject(obj)`): hugs "NAAM HOND" tightly, no overflow past the glyphs.

No console errors attributable to this change in either app (only pre-existing theme-level
`preload` warnings and unrelated 404s from Astra local fonts / a hero background image).

## Global constraints checked

- No `canvas.toJSON()` used or introduced — only `obj.initDimensions()`/`setCoords()` and
  `canvas.renderAll()` added, no serialization touched.
- No new React hooks introduced (plain `useEffect`, already imported in both files).
- No reformatting of neighbouring/unrelated code — edits are scoped to the font-loading module
  and the two font-remeasure effects; the pre-existing `onFontLoad` effects were left structurally
  untouched (only a clarifying comment added above each).

## Files changed

- `shared/js/googleFontLoader.js` (pub/sub: `onFontFamilyLoaded`, `notifyFamilyLoaded`, wired
  into `registerViaProxy`)
- `admin/js/template-builder/src/components/Canvas.jsx` (new subscription effect + import;
  clarifying comment on the pre-existing `onFontLoad` effect)
- `frontend/js/designer/src/components/DesignerCanvas.jsx` (same)
- `tests/js/utils/googleFontLoader.test.js` (3 new tests for the pub/sub)

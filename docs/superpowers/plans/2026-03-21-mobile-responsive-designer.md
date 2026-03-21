# Mobile Responsive Designer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ProductForge designer fully usable on mobile devices (phones and tablets) by adding responsive layout, canvas scaling, touch-optimized controls, and a mobile-first UI.

**Architecture:** The existing desktop layout (sidebar 280px + flex canvas) becomes a stacked layout on screens < 768px: canvas on top, sidebar as a collapsible bottom panel. The Fabric.js canvas scales down via `viewportTransform` to fit the screen width while maintaining the same coordinate system. Touch targets are enlarged and the modal display mode is forced on mobile to avoid scroll conflicts with the WooCommerce product page.

**Tech Stack:** React 18, Fabric.js 6.x, CSS media queries, Zustand, no new dependencies.

**BELANGRIJK:** Alle wijzigingen moeten eerst worden getest in de lokale Docker-omgeving (`docker compose up -d`, `npm run dev`, http://localhost:8080) voordat er iets naar de live site (snelgraveren.nl) wordt gedeployed. Test op mobiel via Chrome DevTools device emulation (iPhone SE, iPhone 14 Pro, iPad) en indien mogelijk met een echt mobiel apparaat op het lokale netwerk.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/js/designer/src/designer.css` | Modify | Add all mobile media queries, stacked layout, bottom panel styles |
| `frontend/js/designer/src/components/DesignerCanvas.jsx` | Modify | Canvas auto-scaling to container width, touch control sizing |
| `frontend/js/designer/src/App.jsx` | Modify | Force modal on mobile, pass `isMobile` context, adjust layout classes |
| `frontend/js/designer/src/hooks/useIsMobile.js` | Create | Shared hook for responsive breakpoint detection |
| `frontend/js/designer/src/hooks/useCanvasScale.js` | Create | Hook to calculate and apply canvas zoom based on container width |
| `frontend/js/designer/src/components/Sidebar.jsx` | Modify | Collapsible bottom panel behavior on mobile |
| `frontend/js/designer/src/components/tabs/ElementTab.jsx` | Modify | Larger touch targets for mobile controls |
| `frontend/js/designer/src/components/tabs/AddTab.jsx` | Modify | Larger touch targets |
| `includes/Frontend/class-frontend.php` | Modify | Add viewport meta hint for designer, force modal on mobile via JS config |

---

## Task 1: Create `useIsMobile` hook

**Files:**
- Create: `frontend/js/designer/src/hooks/useIsMobile.js`

This hook provides a reactive boolean `isMobile` based on a CSS breakpoint (768px). Used by all components that need to adapt layout or behavior for mobile.

- [ ] **Step 1: Create the hook file**

```javascript
import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
```

- [ ] **Step 2: Ensure hooks directory exists and verify file**

Run: `mkdir -p frontend/js/designer/src/hooks && cat frontend/js/designer/src/hooks/useIsMobile.js`

- [ ] **Step 3: Test build compiles**

Run: `npm run build`
Expected: No errors, clean build.

- [ ] **Step 4: Commit**

```bash
git add frontend/js/designer/src/hooks/useIsMobile.js
git commit -m "feat(mobile): add useIsMobile responsive breakpoint hook"
```

---

## Task 2: Add responsive CSS — stacked layout and mobile overrides

**Files:**
- Modify: `frontend/js/designer/src/designer.css` (add media queries at end of file)

Add a `@media (max-width: 767px)` block that:
- Stacks `.pf-designer__layout` vertically (flex-direction: column)
- Makes sidebar full-width
- Reduces padding/gaps
- Makes modal padding smaller
- Enlarges touch targets (buttons min 44px height)
- Adds a `.pf-sidebar--collapsed` class for the bottom panel toggle

- [ ] **Step 1: Add mobile media queries to designer.css**

Append the following at the end of `designer.css` (before the closing comment, after line 433):

```css
/* ── Mobile responsive ──────────────────────────────────────────────────── */

@media (max-width: 767px) {
  /* Stack layout vertically */
  .pf-designer__layout {
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0;
  }

  /* Canvas takes full width */
  .pf-canvas-wrap {
    width: 100%;
  }

  /* Canvas scroll container should not overflow horizontally */
  .pf-canvas-scroll {
    overflow-x: hidden;
    overflow-y: auto;
  }

  /* Sidebar becomes full-width bottom panel */
  .pf-designer__sidebar-wrap {
    width: 100%;
    flex-shrink: 1;
    gap: 0.5rem;
  }

  /* Collapsible sidebar — hide both tabs and content when collapsed */
  .pf-sidebar--collapsed .pf-sidebar__tabs,
  .pf-sidebar--collapsed .pf-sidebar__content {
    display: none;
  }

  .pf-sidebar__collapse-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: #f9fafb;
    border: none;
    border-top: 1px solid #e5e7eb;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: #374151;
  }

  .pf-sidebar__collapse-toggle::after {
    content: '▲';
    font-size: 10px;
    transition: transform 0.2s;
  }

  .pf-sidebar--collapsed .pf-sidebar__collapse-toggle::after {
    transform: rotate(180deg);
  }

  /* Enlarge all interactive elements for touch (44px min target) */
  .pf-sidebar__tab {
    padding: 0.75rem 0.25rem;
    font-size: 14px;
    min-height: 44px;
  }

  .pf-add-tools__btn {
    padding: 0.75rem;
    font-size: 14px;
    min-height: 44px;
  }

  .pf-element__toggle {
    width: 44px;
    height: 44px;
    font-size: 15px;
  }

  .pf-element__swatch {
    width: 32px;
    height: 32px;
  }

  .pf-element__align-btn {
    padding: 8px 12px;
    font-size: 16px;
    min-height: 44px;
    min-width: 44px;
  }

  .pf-element__delete-btn {
    padding: 0.75rem;
    font-size: 14px;
    min-height: 44px;
  }

  .pf-views__btn {
    padding: 0.75rem;
    font-size: 14px;
    min-height: 44px;
  }

  .pf-designer__save-btn {
    padding: 0.75rem 1rem;
    font-size: 15px;
    min-height: 48px;
  }

  .pf-designer__close-btn {
    padding: 0.75rem 1rem;
    font-size: 15px;
    min-height: 48px;
  }

  .pf-element__field select,
  .pf-element__field input[type="number"] {
    width: 100%;
    padding: 0.5rem;
    font-size: 14px;
    min-height: 40px;
  }

  .pf-element__field input[type="color"] {
    width: 48px;
    height: 40px;
  }

  .pf-element__field {
    flex-wrap: wrap;
  }

  /* Modal: reduce padding on mobile, fill more screen */
  .pf-designer--modal {
    padding: 0.5rem;
  }

  .pf-designer--modal .pf-designer__layout {
    padding: 0.75rem;
    border-radius: 4px;
    max-height: 100dvh;
    overflow-y: auto;
  }
}

/* Hide collapse toggle on desktop */
@media (min-width: 768px) {
  .pf-sidebar__collapse-toggle {
    display: none;
  }
}
```

- [ ] **Step 2: Test build compiles**

Run: `npm run build`
Expected: Clean build, CSS included in `dist/frontend-designer.css`.

- [ ] **Step 3: Test in Docker — Desktop unchanged**

Open http://localhost:8080 in Chrome, navigate to a product with the designer enabled. Verify the desktop layout is unchanged (sidebar right, canvas left, same spacing).

- [ ] **Step 4: Test in Docker — Mobile layout**

Open Chrome DevTools → Toggle Device Toolbar → iPhone SE (375×667). Verify:
- Layout stacks vertically (canvas on top, sidebar below)
- Sidebar is full width
- Buttons are at least 44px tall
- No horizontal overflow

- [ ] **Step 5: Commit**

```bash
git add frontend/js/designer/src/designer.css
git commit -m "feat(mobile): add responsive CSS with stacked layout and touch-sized controls"
```

---

## Task 3: Create `useCanvasScale` hook — auto-scale canvas to container

**Files:**
- Create: `frontend/js/designer/src/hooks/useCanvasScale.js`

This hook observes the canvas wrapper's width using `ResizeObserver` and returns a scale factor. The Fabric.js canvas uses `canvas.setZoom()` + `canvas.setDimensions(cssOnly)` to scale — **NOT CSS transforms**, which would break Fabric.js pointer event calculations (clicks/drags would be offset from actual objects).

- [ ] **Step 1: Create the hook file**

```javascript
import { useState, useEffect, useRef } from 'react';

/**
 * Observe a container element and return the scale factor needed
 * to fit a canvas of `canvasWidth` into the container.
 * Returns { scale, containerRef } where containerRef is attached to the wrapper div.
 *
 * IMPORTANT: Do NOT use CSS transform to scale the canvas.
 * Fabric.js calculates pointer positions from the DOM element's bounding rect.
 * A CSS transform on a parent causes pointer position mismatch.
 * Instead, apply the returned scale via canvas.setZoom() + canvas.setDimensions(cssOnly).
 */
export default function useCanvasScale(canvasWidth) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canvasWidth) return;

    const updateScale = () => {
      const availableWidth = el.clientWidth;
      if (availableWidth <= 0) return;
      // Only scale down, never up
      const newScale = Math.min(1, availableWidth / canvasWidth);
      setScale(newScale);
    };

    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    updateScale(); // initial

    return () => ro.disconnect();
  }, [canvasWidth]);

  return { scale, containerRef };
}
```

- [ ] **Step 2: Test build compiles**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add frontend/js/designer/src/hooks/useCanvasScale.js
git commit -m "feat(mobile): add useCanvasScale hook for responsive canvas sizing"
```

---

## Task 4: Apply canvas scaling in DesignerCanvas

**Files:**
- Modify: `frontend/js/designer/src/components/DesignerCanvas.jsx`

Use `useCanvasScale` to dynamically scale the Fabric.js canvas via `canvas.setZoom()` and `canvas.setDimensions({ cssOnly: true })`. **Do NOT use CSS transforms** — they break Fabric.js pointer event calculations, causing clicks/drags to be offset from actual objects.

- [ ] **Step 1: Import the hook and useIsMobile**

At the top of `DesignerCanvas.jsx` (after existing imports, ~line 5):

```javascript
import useCanvasScale from '../hooks/useCanvasScale';
import useIsMobile from '../hooks/useIsMobile';
```

- [ ] **Step 2: Use the hooks in the component**

Inside the `DesignerCanvas` function body, after the existing refs (~line 43), add:

```javascript
const isMobile = useIsMobile();
const isMobileRef = useRef(isMobile);
isMobileRef.current = isMobile; // keep ref in sync for event handlers

const canvasWidth = currentView?.canvas_width || 800;
const canvasHeight = currentView?.canvas_height || 600;
const { scale, containerRef: scaleContainerRef } = useCanvasScale(canvasWidth);
```

- [ ] **Step 3: Add a useEffect to apply Fabric.js zoom when scale changes**

After the canvas init `useEffect`, add a new `useEffect` that applies the zoom:

```javascript
// Apply responsive zoom via Fabric.js (NOT CSS transform — that breaks pointer math)
useEffect(() => {
  const canvas = fabricRef.current;
  if (!canvas) return;

  canvas.setZoom(scale);
  canvas.setDimensions(
    { width: canvasWidth * scale, height: canvasHeight * scale },
    { cssOnly: true }
  );
  canvas.renderAll();
}, [scale, canvasWidth, canvasHeight]);
```

- [ ] **Step 4: Attach scaleContainerRef to the canvas wrapper**

In the return JSX, add the ref to the canvas wrapper div:

Change:
```jsx
<div className="pf-canvas-wrap">
```
to:
```jsx
<div className="pf-canvas-wrap" ref={scaleContainerRef}>
```

- [ ] **Step 5: Enlarge Fabric.js touch controls on mobile**

In the canvas init `useEffect` (around line 212-218), after creating the canvas, use an `object:added` listener to apply touch-friendly controls. Use `isMobileRef` (the ref) instead of `isMobile` directly, so it stays reactive without requiring `isMobile` in the canvas init dependency array:

```javascript
// Disable multi-select on mobile (too error-prone with touch)
if (isMobileRef.current) {
  canvas.selection = false;
}

// Apply mobile-friendly controls to every object added to the canvas
canvas.on('object:added', (e) => {
  const obj = e.target;
  if (!isMobileRef.current || !obj || obj.data?.isZoneOverlay) return;
  obj.set({
    cornerSize: 28,
    touchCornerSize: 40,
    cornerStyle: 'circle',
    transparentCorners: false,
    cornerColor: '#2563eb',
    borderColor: '#2563eb',
  });
});
```

This listener covers both template layers loaded during init AND new elements added by the user later.

- [ ] **Step 6: Test build compiles**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 7: Test in Docker — Desktop unchanged**

Open http://localhost:8080, check designer on a product page at full desktop width. Canvas should render at scale=1 (zoom=1), no visual change. Verify pointer events work correctly (drag, resize, select).

- [ ] **Step 8: Test in Docker — Mobile canvas scaling**

Chrome DevTools → iPhone SE (375px). Verify:
- Canvas scales down to fit within 375px viewport
- Canvas is not cut off or overflowing horizontally
- Zone overlays and background image scale with the canvas
- **Critical:** Objects can be selected and dragged **at the correct position** (no pointer offset)
- Object controls (corner handles) are larger circles, easy to tap
- Resizing objects via corner handles works correctly

- [ ] **Step 9: Test in Docker — Tablet (iPad)**

Chrome DevTools → iPad (768px). Verify:
- At exactly 768px: desktop layout kicks in (side-by-side)
- At 767px: stacked layout with scaled canvas

- [ ] **Step 10: Commit**

```bash
git add frontend/js/designer/src/components/DesignerCanvas.jsx
git commit -m "feat(mobile): auto-scale canvas via Fabric.js zoom with touch-optimized controls"
```

---

## Task 5: Force modal mode on mobile + viewport meta

**Files:**
- Modify: `frontend/js/designer/src/App.jsx`
- Modify: `includes/Frontend/class-frontend.php`

On mobile, the embedded designer inside the WooCommerce product page creates scroll conflicts. Force modal (fullscreen) display on mobile so the designer takes over the viewport.

- [ ] **Step 1: Import useIsMobile in App.jsx**

At the top of `App.jsx`, add:
```javascript
import useIsMobile from './hooks/useIsMobile';
```

- [ ] **Step 2: Use the hook and derive effective display mode**

Inside the `App` function, after the existing state declarations (~line 53), add:

```javascript
const isMobile = useIsMobile();
const effectiveDisplayMode = isMobile ? 'modal' : (config.display_mode || 'embedded');
```

- [ ] **Step 3: Replace ALL references to `config.display_mode` with `effectiveDisplayMode`**

In `App.jsx`, there are 5 references to `config.display_mode` that must all be updated. Since `useIsMobile()` initializes synchronously from `window.innerWidth`, the first render already has the correct value — no flash risk.

**Reference 1 — line 47 (`useState` initializer):**
```javascript
// Before:
const [designerOpen, setDesignerOpen] = useState(config.display_mode !== 'modal' || !!config.auto_open);
// After:
const [designerOpen, setDesignerOpen] = useState(effectiveDisplayMode !== 'modal' || !!config.auto_open || !!config.existing_design_hash);
```
Note: `useIsMobile` must be called BEFORE this line (hooks must be in consistent order). Place the `useIsMobile()` call and `effectiveDisplayMode` derivation right after the store destructuring (~line 44), before the `useState` calls.

**Reference 2 — line 109 (modal open useEffect):**
```javascript
// Before:
if (config.display_mode !== 'modal') return;
// After:
if (effectiveDisplayMode !== 'modal') return;
```

**Reference 3 — line 126 (focus trapping useEffect):**
```javascript
// Before:
if (config.display_mode !== 'modal') return;
// After:
if (effectiveDisplayMode !== 'modal') return;
```

**Reference 4 — line 386 (isModal constant):**
```javascript
// Before:
const isModal = config.display_mode === 'modal';
// After:
const isModal = effectiveDisplayMode === 'modal';
```

**Reference 5 — line 389 (wrapperClass):**
```javascript
// Before:
`pf-designer--${config.display_mode || 'embedded'}`,
// After:
`pf-designer--${effectiveDisplayMode}`,
```

- [ ] **Step 4: Auto-open designer on mobile**

On mobile, since it's forced modal, we want a "Customize" button to appear. The PHP already renders `.pf-open-designer` for modal mode, but on mobile with embedded mode configured, there's no button. Add a JS-rendered open button for mobile:

In the JSX, before the main designer div, when `isMobile` and designer is not open:
```jsx
{isMobile && !designerOpen && (
  <button
    type="button"
    className="pf-open-designer button"
    onClick={() => setDesignerOpen(true)}
  >
    {__('Customize Product', 'productforge')}
  </button>
)}
```

- [ ] **Step 5: Add mobile viewport hint in PHP**

In `class-frontend.php`, inside the `enqueue_assets()` method, after the `wp_localize_script` call (~line 231), add an inline script that prevents pinch-to-zoom when the designer modal is open:

```php
// Prevent pinch-to-zoom interference when designer is open on mobile
wp_add_inline_script('pf-frontend-designer', '
  document.addEventListener("pf:designer-open", function() {
    var meta = document.querySelector("meta[name=viewport]");
    if (meta) {
      meta._pfOriginal = meta.getAttribute("content");
      meta.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no");
    }
  });
  document.addEventListener("pf:designer-close", function() {
    var meta = document.querySelector("meta[name=viewport]");
    if (meta && meta._pfOriginal) {
      meta.setAttribute("content", meta._pfOriginal);
    }
  });
', 'after');
```

- [ ] **Step 6: Dispatch viewport events from App.jsx**

In `App.jsx`, in the `designerOpen` useEffect, dispatch custom events:

```javascript
useEffect(() => {
  if (designerOpen) {
    document.dispatchEvent(new Event('pf:designer-open'));
  } else {
    document.dispatchEvent(new Event('pf:designer-close'));
  }
}, [designerOpen]);
```

- [ ] **Step 7: Test build compiles**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 8: Test in Docker — Desktop remains unchanged**

Open http://localhost:8080, product with embedded mode. Verify:
- Designer shows inline (embedded), no modal button visible
- No viewport meta changes

- [ ] **Step 9: Test in Docker — Mobile forces modal**

Chrome DevTools → iPhone SE. Verify:
- "Customize Product" button appears on product page
- Tapping it opens the designer in a fullscreen modal overlay
- Stacked layout inside modal (canvas top, sidebar bottom)
- Closing the modal returns to the product page
- No pinch-to-zoom issues while designer is open

- [ ] **Step 10: Commit**

```bash
git add frontend/js/designer/src/App.jsx includes/Frontend/class-frontend.php
git commit -m "feat(mobile): force modal display on mobile with viewport zoom lock"
```

---

## Task 6: Collapsible sidebar on mobile

**Files:**
- Modify: `frontend/js/designer/src/components/Sidebar.jsx`

On mobile, the sidebar takes significant vertical space below the canvas. Make it collapsible with a toggle button so users can focus on the canvas and expand the sidebar when needed.

- [ ] **Step 1: Import useIsMobile in Sidebar.jsx**

```javascript
import useIsMobile from '../hooks/useIsMobile';
```

- [ ] **Step 2: Add collapse state and toggle**

Inside the `Sidebar` component function, add:

```javascript
const isMobile = useIsMobile();
const [collapsed, setCollapsed] = useState(false);

// Auto-expand when an object is selected (user needs element tab)
useEffect(() => {
  if (selectedObject && isMobile) {
    setCollapsed(false);
  }
}, [selectedObject, isMobile]);
```

- [ ] **Step 3: Update the JSX to include toggle and collapse class**

Wrap the sidebar container with the collapse class:

```jsx
<div className={`pf-sidebar${isMobile && collapsed ? ' pf-sidebar--collapsed' : ''}`}>
  {isMobile && (
    <button
      type="button"
      className="pf-sidebar__collapse-toggle"
      onClick={() => setCollapsed(!collapsed)}
      aria-expanded={!collapsed}
      aria-label={collapsed ? __('Show options', 'productforge') : __('Hide options', 'productforge')}
    >
      {activeTab === 'element' && selectedObject
        ? __('Element Options', 'productforge')
        : activeTab === 'add'
          ? __('Add Element', 'productforge')
          : __('Views', 'productforge')
      }
    </button>
  )}
  <div className="pf-sidebar__tabs" role="tablist">
    {/* existing tab buttons */}
  </div>
  <div className="pf-sidebar__content">
    {/* existing tab content */}
  </div>
</div>
```

- [ ] **Step 4: Test build compiles**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 5: Test in Docker — Desktop unchanged**

Verify collapse toggle button is hidden on desktop (CSS `display: none` at min-width 768px).

- [ ] **Step 6: Test in Docker — Mobile collapse behavior**

Chrome DevTools → iPhone SE. Verify:
- Toggle button visible at top of sidebar
- Tapping collapses sidebar content (only toggle visible)
- Tapping again expands it
- Selecting an element on canvas auto-expands sidebar
- Toggle label updates based on active tab

- [ ] **Step 7: Commit**

```bash
git add frontend/js/designer/src/components/Sidebar.jsx
git commit -m "feat(mobile): add collapsible sidebar with auto-expand on element selection"
```

---

## Task 7: Integration testing on Docker

**Files:** None (testing only)

Full end-to-end test of the mobile experience in the Docker environment before deploying to production.

- [ ] **Step 1: Build production assets**

Run: `npm run build`

- [ ] **Step 2: Test on Docker — iPhone SE (375px)**

Chrome DevTools → iPhone SE (375×667):
1. Navigate to product page with designer enabled
2. Verify "Customize Product" button appears
3. Tap button → modal opens fullscreen
4. Canvas scales to fit width, no horizontal scroll
5. Add text element → sidebar auto-expands, element tab shows
6. Edit text properties → inputs are touch-friendly (44px+ height)
7. Drag element → no sticky cursor, movement smooth
8. Collapse sidebar → more canvas visible
9. Switch views → canvas re-renders at correct scale
10. Save design → success message
11. Close designer → returns to product page
12. Add to cart → design hash attached

- [ ] **Step 3: Test on Docker — iPhone 14 Pro (393px)**

Repeat the same flow, verify slightly wider layout still works.

- [ ] **Step 4: Test on Docker — iPad (768px)**

At exactly 768px width: verify desktop layout (side-by-side) is used, no mobile overrides active.

- [ ] **Step 5: Test on Docker — Landscape phone (667×375)**

Verify the stacked layout still works in landscape, canvas scales appropriately.

- [ ] **Step 6: Test on Docker — Desktop full width**

Verify no regressions: desktop layout unchanged, all features work.

- [ ] **Step 7: Test with real mobile device (optional but recommended)**

If possible, access Docker site from phone on local network:
1. Find Mac's local IP: `ipconfig getifaddr en0`
2. Access `http://<mac-ip>:8080` from phone
3. Test touch interactions, pinch-to-zoom prevention, keyboard behavior

- [ ] **Step 8: Fix any issues found**

Address bugs discovered during testing.

- [ ] **Step 9: Commit any fixes**

Stage only the specific files that were changed (do NOT use `git add -A`):
```bash
git add frontend/js/designer/src/designer.css frontend/js/designer/src/components/DesignerCanvas.jsx frontend/js/designer/src/App.jsx frontend/js/designer/src/components/Sidebar.jsx
git commit -m "fix(mobile): address integration testing feedback"
```

---

## Summary

| Task | What | Key Change |
|------|------|------------|
| 1 | `useIsMobile` hook | Reactive mobile breakpoint detection |
| 2 | Responsive CSS | Stacked layout, enlarged touch targets, mobile modal |
| 3 | `useCanvasScale` hook | ResizeObserver-based canvas scale calculation |
| 4 | Canvas scaling | Fabric.js setZoom + enlarged touch controls |
| 5 | Force modal on mobile | Fullscreen designer, viewport zoom lock |
| 6 | Collapsible sidebar | Bottom panel toggle, auto-expand on selection |
| 7 | Integration testing | Full E2E test on Docker before production deploy |

**After all tasks pass on Docker:** Build the production zip and deploy to snelgraveren.nl.

import {
  clampObjectDuringMove,
  settleObjectInZone,
  zoneContainmentShape,
  keepInsideRect,
} from '../../../shared/js/zoneClamp';

/**
 * These tests state USER-FACING requirements, not the shape of the code:
 *
 *   R1  An object can always be moved. No gesture may leave it unable to move.
 *   R2  An object that fits the outline ends up inside the outline once dropped.
 *   R3  An object that cannot fit the outline is left where the user put it,
 *       at the size the user gave it.
 *
 * The ten tests that covered the previous rectangular clamp all passed while
 * encoding the trap they were supposed to catch, so nothing below asserts
 * "called clampRectToZone" or "returned 'moved'" as the point of the test:
 * every assertion is about where the object ends up after a simulated gesture.
 */

// ── A fake Fabric object: only what the clamp actually touches ──────────────
// Origin is top-left and there is no rotation, so obj.left/top and the bounding
// rect coincide — except where a test deliberately gives them an offset.
function makeObject({ left, top, width, height, offsetX = 0, offsetY = 0 }) {
  return {
    left,
    top,
    width,
    height,
    offsetX,
    offsetY,
    setCoordsCalls: 0,
    // Reads this.width/this.height, never the constructor arguments: a test
    // that enlarges the object must actually enlarge its bounding rect, or it
    // silently proves nothing.
    getBoundingRect() {
      return {
        left: this.left - this.offsetX,
        top: this.top - this.offsetY,
        width: this.width,
        height: this.height,
      };
    },
    getCoords() {
      const b = this.getBoundingRect();
      return [
        { x: b.left, y: b.top },
        { x: b.left + b.width, y: b.top },
        { x: b.left + b.width, y: b.top + b.height },
        { x: b.left, y: b.top + b.height },
      ];
    },
    set(patch) { Object.assign(this, patch); },
    setCoords() { this.setCoordsCalls++; },
  };
}

// ── A zone whose outline is a circle inscribed in its bounding box ─────────
// jsdom has no Path2D, so the containment predicate is injected — exactly how
// zoneContainment.test.js exercises the real geometry. `shape` is a token; the
// predicate below IS the outline.
const ZONE = {
  behavior: 'restrict',
  boundary_type: 'svg',
  svg_markup: '<svg><path d="M0 0"/></svg>',
  x: 0, y: 0, width: 400, height: 400,
};
const CIRCLE = { cx: 200, cy: 200, r: 150 };

const insideCircle = (shape, zone, points) =>
  points.every(([x, y]) => (x - CIRCLE.cx) ** 2 + (y - CIRCLE.cy) ** 2 <= CIRCLE.r ** 2 + 1e-9);

const neverInside = () => false;

const DEPS = { getShape: () => 'circle', isInside: insideCircle };
const DEPS_IMPOSSIBLE = { getShape: () => 'circle', isInside: neverInside };

function boxInsideCircle(obj) {
  const b = obj.getBoundingRect();
  return [
    [b.left, b.top], [b.left + b.width, b.top],
    [b.left + b.width, b.top + b.height], [b.left, b.top + b.height],
  ].every(([x, y]) => (x - CIRCLE.cx) ** 2 + (y - CIRCLE.cy) ** 2 <= CIRCLE.r ** 2 + 1e-6);
}

/**
 * Replay a drag the way Fabric does: each frame Fabric writes the position the
 * POINTER dictates (start position + total pointer delta so far), and only then
 * does the clamp get a say. This is the detail the old code got wrong — it is
 * why restoring a remembered position mid-drag makes the object fight the
 * pointer instead of following it.
 */
function dragBy(obj, zone, dx, dy, steps = 10, deps = DEPS) {
  const startLeft = obj.left;
  const startTop = obj.top;
  const positions = [];
  for (let i = 1; i <= steps; i++) {
    obj.set({ left: startLeft + (dx * i) / steps, top: startTop + (dy * i) / steps });
    clampObjectDuringMove(obj, zone, deps);
    positions.push([obj.left, obj.top]);
  }
  settleObjectInZone(obj, zone, deps);
  return positions;
}

describe('R1 — an object can always be moved', () => {
  it('a small object dragged inside the outline follows the pointer every frame', () => {
    const obj = makeObject({ left: 180, top: 180, width: 40, height: 40 });
    const frames = dragBy(obj, ZONE, 60, 40);
    const xs = frames.map((p) => p[0]);
    expect(new Set(xs).size).toBe(frames.length); // no two frames identical
    expect(xs[xs.length - 1]).toBeGreaterThan(xs[0]);
  });

  it('an object dragged hard against the outline keeps moving — it never freezes', () => {
    // 160 px of drag straight through the contour — far outside the circle,
    // still inside the zone's bounding box, so nothing legitimately blocks it.
    // The old code moved the object ~20 px and then not at all for the rest of
    // the gesture (measured in the builder: pointer 250 px, object 21 px).
    const obj = makeObject({ left: 180, top: 180, width: 40, height: 40 });
    const frames = dragBy(obj, ZONE, -160, 0, 10);
    const xs = frames.map((p) => p[0]);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeLessThan(xs[i - 1]); // strictly following the pointer
    }
  });

  it('an object too large for the outline is NOT pinned — it moves with the pointer', () => {
    // 380x120 cannot fit a circle of radius 150 anywhere. R3: leave it alone.
    const obj = makeObject({ left: 10, top: 140, width: 380, height: 120 });
    const before = obj.left;
    dragBy(obj, ZONE, 120, 0, 6, DEPS);
    expect(obj.left).toBeGreaterThan(before);
  });

  it('an object enlarged until it no longer fits can still be dragged, twice, in both directions', () => {
    // The exact live sequence, and the one the user reported: the text fitted,
    // it was settled inside the outline, and then it grew (more characters, or
    // a bigger font). The old code welded it to the remembered point — measured
    // in the builder at (174.089, 411), unmoved by drags of 150 px and 200 px.
    const obj = makeObject({ left: 180, top: 190, width: 40, height: 20 });
    settleObjectInZone(obj, ZONE, DEPS);

    // 280x120: too big for a circle of radius 150 (half-diagonal 152), but
    // still inside the zone's 400x400 box, so the box legitimately allows
    // left ∈ [0, 120] and the object must be free to move across that range.
    obj.width = 280; obj.height = 120;

    dragBy(obj, ZONE, -200, 0, 5, DEPS);
    const afterLeftward = obj.left;

    dragBy(obj, ZONE, 200, 0, 5, DEPS);
    const afterRightward = obj.left;

    expect(afterRightward).toBeGreaterThan(afterLeftward);

    dragBy(obj, ZONE, -200, 0, 5, DEPS);
    expect(obj.left).toBeLessThan(afterRightward);
    expect(obj.left).toBe(afterLeftward); // and it is reversible, not one-way
  });

  it('nothing at all fits: two successive drags still end in two different places', () => {
    const obj = makeObject({ left: 100, top: 100, width: 30, height: 30 });
    dragBy(obj, ZONE, 40, 20, 4, DEPS_IMPOSSIBLE);
    const first = [obj.left, obj.top];
    dragBy(obj, ZONE, -70, 10, 4, DEPS_IMPOSSIBLE);
    expect([obj.left, obj.top]).not.toEqual(first);
  });
});

describe('R2 — an object that fits ends up inside the outline after the drop', () => {
  it('dropped half outside the contour, it is inside the contour afterwards', () => {
    const obj = makeObject({ left: 180, top: 190, width: 40, height: 20 });
    dragBy(obj, ZONE, -170, 0, 8); // drag out through the left of the circle
    expect(boxInsideCircle(obj)).toBe(true);
  });

  it('dropped outside on the diagonal, it is inside the contour afterwards', () => {
    const obj = makeObject({ left: 180, top: 190, width: 40, height: 20 });
    dragBy(obj, ZONE, 160, 150, 8);
    expect(boxInsideCircle(obj)).toBe(true);
  });

  it('it lands NEAR where it was dropped, not flung back to the middle', () => {
    const obj = makeObject({ left: 180, top: 190, width: 40, height: 20 });
    dragBy(obj, ZONE, -170, 0, 8);
    // Pushed left, so it must settle in the left half of the circle rather
    // than snapping to the zone's centre.
    const centreX = obj.getBoundingRect().left + obj.getBoundingRect().width / 2;
    expect(centreX).toBeLessThan(CIRCLE.cx);
    expect(boxInsideCircle(obj)).toBe(true);
  });

  it('an object already inside the contour is not moved at all by the drop', () => {
    const obj = makeObject({ left: 190, top: 195, width: 20, height: 10 });
    const before = { left: obj.left, top: obj.top };
    expect(settleObjectInZone(obj, ZONE, DEPS)).toBe('inside');
    expect({ left: obj.left, top: obj.top }).toEqual(before);
  });

  it('honours an obj.left ↔ bounding-rect offset instead of teleporting by it', () => {
    // A rotated / centre-origin object: left is 25 px away from bound.left.
    // Settling must SHIFT by the correction, not assign the box position.
    const obj = makeObject({ left: 30, top: 190, width: 40, height: 20, offsetX: 25, offsetY: 7 });
    settleObjectInZone(obj, ZONE, DEPS);
    expect(obj.left - obj.getBoundingRect().left).toBe(25);
    expect(obj.top - obj.getBoundingRect().top).toBe(7);
    expect(boxInsideCircle(obj)).toBe(true);
  });
});

describe('R3 — an object that cannot fit is left exactly as the user left it', () => {
  it('is never resized to make it fit', () => {
    const obj = makeObject({ left: 10, top: 140, width: 380, height: 120 });
    obj.scaleX = 1; obj.scaleY = 1;
    settleObjectInZone(obj, ZONE, DEPS);
    expect(obj.scaleX).toBe(1);
    expect(obj.scaleY).toBe(1);
    expect(obj.width).toBe(380);
  });

  it('is not moved either — the drop leaves its position untouched', () => {
    const obj = makeObject({ left: 10, top: 140, width: 380, height: 120 });
    const before = { left: obj.left, top: obj.top };
    settleObjectInZone(obj, ZONE, DEPS);
    expect({ left: obj.left, top: obj.top }).toEqual(before);
  });
});

describe('zones that are not shape-enforced still behave exactly as before', () => {
  const rectZone = { behavior: 'restrict', boundary_type: 'rect', x: 0, y: 0, width: 100, height: 100 };

  it('a rectangular zone clamps to its box on drag and on drop', () => {
    const obj = makeObject({ left: 90, top: 10, width: 20, height: 20 });
    clampObjectDuringMove(obj, rectZone);
    expect(obj.left).toBe(80);
    settleObjectInZone(obj, rectZone, DEPS);
    expect(obj.left).toBe(80);
  });

  it('a non-restrict zone enforces nothing of its own, and with no canvas given nothing at all', () => {
    const clipZone = { ...ZONE, behavior: 'clip' };
    const obj = makeObject({ left: -500, top: -500, width: 20, height: 20 });
    expect(clampObjectDuringMove(obj, clipZone)).toBe(false);
    expect(settleObjectInZone(obj, clipZone, DEPS)).toBe('skipped');
    expect(obj.left).toBe(-500);
  });

  it('an svg zone with a rotated boundary falls back to the bounding box', () => {
    const rotated = { ...ZONE, svg_rotation: 20 };
    expect(zoneContainmentShape(rotated, () => 'circle')).toBeNull();
    const obj = makeObject({ left: 390, top: 10, width: 40, height: 20 });
    expect(settleObjectInZone(obj, rotated, DEPS)).toBe('rect');
    expect(obj.left).toBe(360); // zone.x + zone.width - bound.width
  });

  it('an svg zone whose markup will not parse falls back to the bounding box', () => {
    expect(zoneContainmentShape(ZONE, () => null)).toBeNull();
    const obj = makeObject({ left: 390, top: 10, width: 40, height: 20 });
    expect(settleObjectInZone(obj, ZONE, { getShape: () => null, isInside: insideCircle })).toBe('rect');
    expect(obj.left).toBe(360);
  });
});


/**
 * R4  An element that belongs to no restrict zone is still kept ON THE CANVAS.
 * R5  ...but never more strictly than a zone would keep it: an element too
 *     large for the canvas stays movable, exactly as R1 demands inside a zone.
 *
 * Why this exists: a template with no restrict zone has always let customers
 * drag content clean off the design, and the LightBurn import's container zone
 * used to hide that by claiming the whole canvas as a customer drop target.
 * With the claim gone, the canvas fallback is what keeps strays on the design.
 */
describe('R4 — an element with no zone is kept on the canvas', () => {
  // The reported template's canvas.
  const CANVAS = { width: 600, height: 289 };
  const OPTS = { canvas: CANVAS };

  it('cannot be dragged off the right or bottom edge', () => {
    const obj = makeObject({ left: 0, top: 0, width: 100, height: 50 });
    obj.set({ left: 5000, top: 5000 });
    clampObjectDuringMove(obj, null, OPTS);
    expect(obj.left).toBe(500);  // 600 - 100
    expect(obj.top).toBe(239);   // 289 - 50
  });

  it('cannot be dragged off the left or top edge', () => {
    const obj = makeObject({ left: 0, top: 0, width: 100, height: 50 });
    obj.set({ left: -5000, top: -5000 });
    clampObjectDuringMove(obj, null, OPTS);
    expect(obj.left).toBe(0);
    expect(obj.top).toBe(0);
  });

  it('is left exactly where it is while it is on the canvas', () => {
    const obj = makeObject({ left: 120, top: 40, width: 100, height: 50 });
    expect(clampObjectDuringMove(obj, null, OPTS)).toBe(false);
    expect({ left: obj.left, top: obj.top }).toEqual({ left: 120, top: 40 });
  });

  it('is held on the canvas when its zone only clips, rather than restricts', () => {
    // A 'clip' zone never clamped movement; the element could still be dragged
    // into nowhere. The canvas — not the clip zone's box — catches it.
    const clipZone = { behavior: 'clip', boundary_type: 'rect', x: 45, y: 45, width: 379, height: 197 };
    const obj = makeObject({ left: 5000, top: 5000, width: 100, height: 50 });
    clampObjectDuringMove(obj, clipZone, OPTS);
    expect(obj.left).toBe(500);
    expect(obj.top).toBe(239);
  });

  it('is held on the canvas at the end of the gesture too, with no outline applied', () => {
    const obj = makeObject({ left: 5000, top: 5000, width: 100, height: 50 });
    // DEPS_IMPOSSIBLE would refuse every point if an outline were consulted;
    // the canvas has none, so the object simply lands inside the canvas box.
    expect(settleObjectInZone(obj, null, { ...DEPS_IMPOSSIBLE, canvas: CANVAS })).toBe('rect');
    expect(obj.left).toBe(500);
    expect(obj.top).toBe(239);
  });

  it('survives a full drag: every frame stays on the canvas and tracks the pointer', () => {
    const obj = makeObject({ left: 250, top: 100, width: 100, height: 50 });
    const frames = dragBy(obj, null, 600, 0, 10, { ...DEPS, canvas: CANVAS });
    for (const [left] of frames) {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + 100).toBeLessThanOrEqual(CANVAS.width);
    }
    // Monotonic: the clamp never reverses the drag direction.
    const xs = frames.map((f) => f[0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    expect(obj.left).toBe(500);
  });

  it('a real restrict zone still wins over the canvas', () => {
    const zone = { behavior: 'restrict', boundary_type: 'rect', x: 45, y: 45, width: 379, height: 197 };
    const obj = makeObject({ left: 5000, top: 5000, width: 100, height: 50 });
    clampObjectDuringMove(obj, zone, OPTS);
    expect(obj.left).toBe(45 + 379 - 100);
    expect(obj.top).toBe(45 + 197 - 50);
  });

  it('enforces nothing when there is no canvas size to fall back to', () => {
    const obj = makeObject({ left: -5000, top: -5000, width: 10, height: 10 });
    expect(clampObjectDuringMove(obj, null)).toBe(false);
    expect(clampObjectDuringMove(obj, null, { canvas: { width: 0, height: 0 } })).toBe(false);
    expect(settleObjectInZone(obj, null, DEPS)).toBe('skipped');
    expect(obj.left).toBe(-5000);
  });
});

describe('R5 — the canvas fallback is never stricter than a zone', () => {
  const CANVAS = { width: 600, height: 289 };
  const OPTS = { canvas: CANVAS };

  it('an element larger than the canvas can still be moved, in both directions', () => {
    // 900x400 on a 600x289 canvas: oversized on BOTH axes. Trapping it would be
    // the very failure 0d4c69b and 9921cda were about — the customer would have
    // no way to drag it back to something they can work with.
    const obj = makeObject({ left: 0, top: 0, width: 900, height: 400 });
    const seen = [];
    for (const pos of [-400, -100, 0, 120, 400]) {
      obj.set({ left: pos, top: pos });
      clampObjectDuringMove(obj, null, OPTS);
      seen.push([obj.left, obj.top]);
    }
    expect(seen).toEqual([[-400, -400], [-100, -100], [0, 0], [120, 120], [400, 400]]);
  });

  it('an element too wide but not too tall keeps the vertical clamp', () => {
    const obj = makeObject({ left: -300, top: 5000, width: 900, height: 50 });
    clampObjectDuringMove(obj, null, OPTS);
    expect(obj.left).toBe(-300);  // oversized axis: free
    expect(obj.top).toBe(239);    // fitting axis: clamped
  });

  it('an oversized element is never resized to make it fit', () => {
    const obj = makeObject({ left: -400, top: -400, width: 900, height: 400 });
    settleObjectInZone(obj, null, { ...DEPS, canvas: CANVAS });
    expect(obj.width).toBe(900);
    expect(obj.height).toBe(400);
  });
});

describe('keepInsideRect — which rectangle is enforced', () => {
  const CANVAS = { width: 600, height: 289 };

  it('is the zone for a restrict zone', () => {
    const zone = { behavior: 'restrict', x: 45, y: 45, width: 379, height: 197 };
    expect(keepInsideRect(zone, CANVAS)).toEqual({ x: 45, y: 45, width: 379, height: 197 });
  });

  it('is the canvas for no zone, a clip zone, or a zone that enforces nothing', () => {
    const canvasBox = { x: 0, y: 0, width: 600, height: 289 };
    expect(keepInsideRect(null, CANVAS)).toEqual(canvasBox);
    expect(keepInsideRect({ behavior: 'clip', x: 1, y: 1, width: 2, height: 2 }, CANVAS)).toEqual(canvasBox);
    expect(keepInsideRect({ behavior: 'none', x: 1, y: 1, width: 2, height: 2 }, CANVAS)).toEqual(canvasBox);
  });

  it('is nothing at all without a zone and without a usable canvas size', () => {
    expect(keepInsideRect(null, undefined)).toBeNull();
    expect(keepInsideRect(null, { width: 0, height: 100 })).toBeNull();
    expect(keepInsideRect({ behavior: 'clip' }, { width: NaN, height: 100 })).toBeNull();
  });
});

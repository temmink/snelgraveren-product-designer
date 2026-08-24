import {
  isEmptyTextObject,
  isTextPlaceholder,
  syncTextPlaceholders,
  installTextPlaceholders,
  withoutTextPlaceholders,
} from '../../../shared/js/textPlaceholder';

// ── The requirement these guard ────────────────────────────────────────────
// "Zichtbaar houden als lege plek." Clearing a text layer's text used to make
// the layer vanish from the canvas — in the builder it was removed outright,
// in the customer designer an empty template layer was never drawn. The layer
// must stay: visible as an obviously-empty spot, clickable so text can go back
// in, honest about its lock state, and invisible to every export and
// thumbnail. These tests are written against those outcomes, not against how
// the two canvases happen to call the module.

// ── Minimal fabric stand-ins ───────────────────────────────────────────────
// Only the surface the module actually touches. Real Fabric needs a canvas
// implementation jsdom does not have.

class FakeRect {
  constructor(opts) { Object.assign(this, opts); this.type = 'rect'; }
  set(props) { Object.assign(this, props); return this; }
  setCoords() {}
}

function makeCanvas() {
  const objects = [];
  const handlers = {};
  return {
    renders: 0,
    active: null,
    getObjects() { return objects.slice(); },
    add(o) { objects.push(o); o.canvas = this; this.fire('object:added', { target: o }); },
    remove(o) {
      const i = objects.indexOf(o);
      if (i >= 0) objects.splice(i, 1);
      this.fire('object:removed', { target: o });
    },
    bringObjectToFront(o) {
      const i = objects.indexOf(o);
      if (i >= 0) { objects.splice(i, 1); objects.push(o); }
    },
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    off(name, fn) { handlers[name] = (handlers[name] || []).filter((h) => h !== fn); },
    fire(name, opt) { (handlers[name] || []).slice().forEach((h) => h(opt)); },
    requestRenderAll() { this.renders += 1; },
    renderAll() { this.renders += 1; },
    setActiveObject(o) { this.active = o; },
    // What actually gets saved and re-rendered offscreen.
    toObject() { return { objects: objects.filter((o) => !o.excludeFromExport) }; },
  };
}

function makeText(props = {}) {
  return {
    type: 'i-text',
    text: '',
    fontSize: 24,
    fontFamily: 'Bebas Neue',
    fill: '#ff0000',
    left: 120,
    top: 60,
    originX: 'center',
    originY: 'center',
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    visible: true,
    selectable: true,
    evented: true,
    opacity: 1,
    isEditing: false,
    data: { elementType: 'text', layerKey: 'layer-1' },
    set(p) { Object.assign(this, p); return this; },
    setCoords() {},
    enterEditing() { this.isEditing = true; },
    ...props,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const decoOf = (canvas) => canvas.getObjects().find(isTextPlaceholder);

describe('recognising an empty text layer', () => {
  it('sees a text object with no text', () => {
    expect(isEmptyTextObject(makeText())).toBe(true);
  });

  it('does not see a text object that has text', () => {
    expect(isEmptyTextObject(makeText({ text: 'Bella' }))).toBe(false);
  });

  it('does not see zones, boundaries, backgrounds or images', () => {
    expect(isEmptyTextObject({ type: 'rect', data: { isZone: true } })).toBe(false);
    expect(isEmptyTextObject({ type: 'group', data: { isZoneOverlay: true } })).toBe(false);
    expect(isEmptyTextObject({ type: 'image', data: {} })).toBe(false);
  });

  it('does not see a placeholder as something needing its own placeholder', () => {
    const canvas = makeCanvas();
    canvas.add(makeText());
    syncTextPlaceholders(canvas, FakeRect);
    expect(isEmptyTextObject(decoOf(canvas))).toBe(false);
  });
});

describe('an emptied text layer is still there and still clickable', () => {
  it('keeps the layer object itself on the canvas, untouched', () => {
    const canvas = makeCanvas();
    const host = makeText();
    canvas.add(host);
    syncTextPlaceholders(canvas, FakeRect);

    expect(canvas.getObjects()).toContain(host);
    // Everything the layer is made of survives being empty.
    expect(host.fontFamily).toBe('Bebas Neue');
    expect(host.fontSize).toBe(24);
    expect(host.fill).toBe('#ff0000');
    expect(host.left).toBe(120);
    expect(host.top).toBe(60);
    expect(host.originX).toBe('center');
    expect(host.data.layerKey).toBe('layer-1');
  });

  it('gives it a real clickable area, not a zero-width one', () => {
    const canvas = makeCanvas();
    canvas.add(makeText());
    syncTextPlaceholders(canvas, FakeRect);

    const deco = decoOf(canvas);
    expect(deco).toBeDefined();
    expect(deco.width).toBeGreaterThan(10);
    expect(deco.height).toBeGreaterThan(10);
    expect(deco.evented).toBe(true);
  });

  it('puts the empty spot where the text itself would be', () => {
    const canvas = makeCanvas();
    const host = makeText({ left: 300, top: 210, originX: 'right', originY: 'bottom', angle: 12 });
    canvas.add(host);
    syncTextPlaceholders(canvas, FakeRect);

    const deco = decoOf(canvas);
    expect(deco.left).toBe(300);
    expect(deco.top).toBe(210);
    expect(deco.originX).toBe('right');
    expect(deco.originY).toBe('bottom');
    expect(deco.angle).toBe(12);
  });

  it('looks empty — dashed outline, no solid fill of its own', () => {
    const canvas = makeCanvas();
    canvas.add(makeText());
    syncTextPlaceholders(canvas, FakeRect);
    expect(decoOf(canvas).strokeDashArray).toEqual(expect.arrayContaining([expect.any(Number)]));
  });

  it('sizes the empty spot to the layer’s own font size', () => {
    const canvas = makeCanvas();
    canvas.add(makeText({ fontSize: 12 }));
    canvas.add(makeText({ fontSize: 96, data: { elementType: 'text', layerKey: 'layer-2' } }));
    syncTextPlaceholders(canvas, FakeRect);

    const [small, large] = canvas.getObjects().filter(isTextPlaceholder);
    expect(large.height).toBeGreaterThan(small.height);
  });

  it('does not stack a second box when the canvas re-syncs', () => {
    const canvas = makeCanvas();
    canvas.add(makeText());
    syncTextPlaceholders(canvas, FakeRect);
    syncTextPlaceholders(canvas, FakeRect);
    syncTextPlaceholders(canvas, FakeRect);
    expect(canvas.getObjects().filter(isTextPlaceholder)).toHaveLength(1);
  });

  it('gives no empty spot to a text layer that has text', () => {
    const canvas = makeCanvas();
    canvas.add(makeText({ text: 'Bella' }));
    syncTextPlaceholders(canvas, FakeRect);
    expect(decoOf(canvas)).toBeUndefined();
  });
});

describe('putting text back loses nothing', () => {
  it('removes the empty spot as soon as the layer has text again', () => {
    const canvas = makeCanvas();
    const host = makeText();
    canvas.add(host);
    syncTextPlaceholders(canvas, FakeRect);
    expect(decoOf(canvas)).toBeDefined();

    host.set({ text: 'Bella' });
    syncTextPlaceholders(canvas, FakeRect);

    expect(decoOf(canvas)).toBeUndefined();
    // Same object, same styling — nothing was rebuilt from scratch.
    expect(canvas.getObjects()).toContain(host);
    expect(host.fontFamily).toBe('Bebas Neue');
    expect(host.fill).toBe('#ff0000');
    expect(host.left).toBe(120);
    expect(host.originY).toBe('center');
  });

  it('drops the empty spot when the layer is deleted outright', () => {
    const canvas = makeCanvas();
    const host = makeText();
    canvas.add(host);
    syncTextPlaceholders(canvas, FakeRect);

    canvas.remove(host);
    syncTextPlaceholders(canvas, FakeRect);

    expect(canvas.getObjects()).toHaveLength(0);
  });
});

describe('the empty spot respects the layer’s lock and visibility', () => {
  it('is not clickable when the layer is locked', () => {
    const canvas = makeCanvas();
    canvas.add(makeText({ selectable: false, evented: false }));
    syncTextPlaceholders(canvas, FakeRect);
    expect(decoOf(canvas).evented).toBe(false);
  });

  it('becomes clickable again when the layer is unlocked', () => {
    const canvas = makeCanvas();
    const host = makeText({ selectable: false, evented: false });
    canvas.add(host);
    syncTextPlaceholders(canvas, FakeRect);

    host.set({ selectable: true, evented: true });
    syncTextPlaceholders(canvas, FakeRect);

    expect(decoOf(canvas).evented).toBe(true);
  });

  it('is hidden when the layer is hidden', () => {
    const canvas = makeCanvas();
    canvas.add(makeText({ visible: false }));
    syncTextPlaceholders(canvas, FakeRect);
    expect(decoOf(canvas).visible).toBe(false);
  });
});

describe('the empty spot never reaches an export or a thumbnail', () => {
  it('is left out of the saved canvas JSON, so every offscreen render misses it', () => {
    const canvas = makeCanvas();
    const host = makeText();
    canvas.add(host);
    syncTextPlaceholders(canvas, FakeRect);

    const json = canvas.toObject();
    expect(json.objects).toContain(host);
    expect(json.objects.some(isTextPlaceholder)).toBe(false);
  });

  it('uses Fabric’s NATIVE excludeFromExport, not only the plugin flag', () => {
    // The two are different properties that share a name. toObject()/toSVG()
    // honour the native one; App.jsx#withoutExcludedObjects reads the plugin
    // one. Both are needed, and confusing them has bitten this branch before.
    const canvas = makeCanvas();
    canvas.add(makeText());
    syncTextPlaceholders(canvas, FakeRect);

    const deco = decoOf(canvas);
    expect(deco.excludeFromExport).toBe(true);
    expect(deco.data.excludeFromExport).toBe(true);
  });

  it('is hidden while a live-canvas thumbnail is rasterised, and shown again after', () => {
    const canvas = makeCanvas();
    canvas.add(makeText());
    syncTextPlaceholders(canvas, FakeRect);
    const deco = decoOf(canvas);

    let seenDuringRender = null;
    const out = withoutTextPlaceholders(canvas, () => {
      seenDuringRender = deco.visible;
      return 'data:image/png;base64,AAAA';
    });

    expect(seenDuringRender).toBe(false);
    expect(out).toBe('data:image/png;base64,AAAA');
    expect(deco.visible).toBe(true);
  });

  it('shows the empty spot again even if the render throws', () => {
    const canvas = makeCanvas();
    canvas.add(makeText());
    syncTextPlaceholders(canvas, FakeRect);
    const deco = decoOf(canvas);

    expect(() => withoutTextPlaceholders(canvas, () => { throw new Error('render failed'); }))
      .toThrow('render failed');
    expect(deco.visible).toBe(true);
  });

  it('leaves the real layers alone while hiding the chrome', () => {
    const canvas = makeCanvas();
    const host = makeText();
    canvas.add(host);
    syncTextPlaceholders(canvas, FakeRect);

    withoutTextPlaceholders(canvas, () => {
      expect(host.visible).toBe(true);
    });
  });
});

describe('clicking the empty spot puts text back in reach', () => {
  it('selects the layer the box belongs to', async () => {
    const canvas = makeCanvas();
    const host = makeText();
    canvas.add(host);
    const dispose = installTextPlaceholders(canvas, FakeRect, { enterEditing: false });
    await flush();

    canvas.fire('mouse:up', { target: decoOf(canvas) });
    await flush();

    expect(canvas.active).toBe(host);
    expect(host.isEditing).toBe(false);
    dispose();
  });

  it('opens the caret straight away where typing on the canvas is the only way in', async () => {
    const canvas = makeCanvas();
    const host = makeText();
    canvas.add(host);
    const dispose = installTextPlaceholders(canvas, FakeRect, { enterEditing: true });
    await flush();

    canvas.fire('mouse:up', { target: decoOf(canvas) });
    await flush();

    expect(canvas.active).toBe(host);
    expect(host.isEditing).toBe(true);
    dispose();
  });

  it('ignores a click on a locked layer’s box', async () => {
    const canvas = makeCanvas();
    const host = makeText({ selectable: false, evented: false });
    canvas.add(host);
    const dispose = installTextPlaceholders(canvas, FakeRect, { enterEditing: true });
    await flush();

    canvas.fire('mouse:up', { target: decoOf(canvas) });
    await flush();

    expect(canvas.active).toBeNull();
    expect(host.isEditing).toBe(false);
    dispose();
  });

  it('ignores clicks that are not on a box', async () => {
    const canvas = makeCanvas();
    const host = makeText({ text: 'Bella' });
    canvas.add(host);
    const dispose = installTextPlaceholders(canvas, FakeRect, { enterEditing: true });
    await flush();

    canvas.fire('mouse:up', { target: host });
    canvas.fire('mouse:up', { target: undefined });
    await flush();

    expect(canvas.active).toBeNull();
    dispose();
  });
});

describe('the bridge keeps up with the canvas on its own', () => {
  it('adds a box for a layer that is emptied while typing', async () => {
    const canvas = makeCanvas();
    const host = makeText({ text: 'B' });
    canvas.add(host);
    const dispose = installTextPlaceholders(canvas, FakeRect, {});
    await flush();
    expect(decoOf(canvas)).toBeUndefined();

    host.set({ text: '' });
    canvas.fire('text:changed', { target: host });
    await flush();

    expect(decoOf(canvas)).toBeDefined();
    dispose();
  });

  it('removes the box on the first character typed back in', async () => {
    const canvas = makeCanvas();
    const host = makeText();
    canvas.add(host);
    const dispose = installTextPlaceholders(canvas, FakeRect, {});
    await flush();
    expect(decoOf(canvas)).toBeDefined();

    host.set({ text: 'B' });
    canvas.fire('text:changed', { target: host });
    await flush();

    expect(decoOf(canvas)).toBeUndefined();
    dispose();
  });

  it('re-creates boxes after a snapshot restore wipes and refills the canvas', async () => {
    const canvas = makeCanvas();
    const dispose = installTextPlaceholders(canvas, FakeRect, {});
    // What loadFromJSON does: clear, then add the restored objects back.
    canvas.add(makeText());
    await flush();

    expect(canvas.getObjects().filter(isTextPlaceholder)).toHaveLength(1);
    dispose();
  });

  it('settles instead of looping when its own add fires object:added', async () => {
    const canvas = makeCanvas();
    canvas.add(makeText());
    const dispose = installTextPlaceholders(canvas, FakeRect, {});
    await flush();
    await flush();
    await flush();

    expect(canvas.getObjects().filter(isTextPlaceholder)).toHaveLength(1);
    dispose();
  });

  it('stops touching the canvas once disposed', async () => {
    const canvas = makeCanvas();
    const dispose = installTextPlaceholders(canvas, FakeRect, {});
    await flush();
    dispose();

    canvas.add(makeText());
    await flush();

    expect(canvas.getObjects().filter(isTextPlaceholder)).toHaveLength(0);
  });
});

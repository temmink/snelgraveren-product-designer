import { ensureFontMeasured } from '../../../shared/js/ensureFontMeasured';

// jsdom does not implement document.fonts (verified: `new JSDOM().window.document.fonts`
// is undefined), so every test installs its own stub and restores it afterwards.
const realFonts = global.document.fonts;

function makeFakeCanvas(objects) {
  return {
    disposed: false,
    getObjects: () => objects,
    renderAll: jest.fn(),
  };
}

function makeFakeObj({ fontFamily = 'BebasNeue', fontSize = 130, canvas } = {}) {
  const obj = {
    fontFamily,
    fontSize,
    canvas,
    initDimensions: jest.fn(),
    setCoords: jest.fn(),
  };
  return obj;
}

afterEach(() => {
  document.fonts = realFonts;
  jest.restoreAllMocks();
});

describe('ensureFontMeasured', () => {
  it('does nothing when the font is already loaded (fonts.check() true)', async () => {
    const check = jest.fn().mockReturnValue(true);
    const load = jest.fn();
    document.fonts = { check, load };

    const obj = makeFakeObj();
    const canvas = makeFakeCanvas([obj]);
    obj.canvas = canvas;
    const fabricCache = { clearFontCache: jest.fn() };

    await ensureFontMeasured(obj, fabricCache);

    expect(check).toHaveBeenCalledWith('130px "BebasNeue"');
    expect(load).not.toHaveBeenCalled();
    expect(fabricCache.clearFontCache).not.toHaveBeenCalled();
    expect(obj.initDimensions).not.toHaveBeenCalled();
    expect(canvas.renderAll).not.toHaveBeenCalled();
  });

  it('awaits the load, clears the cache for that family, and re-measures the object', async () => {
    document.fonts = {
      check: jest.fn().mockReturnValue(false),
      load: jest.fn().mockResolvedValue(undefined),
    };

    const obj = makeFakeObj({ fontFamily: 'BebasNeue', fontSize: 130 });
    const canvas = makeFakeCanvas([obj]);
    obj.canvas = canvas;
    const fabricCache = { clearFontCache: jest.fn() };

    await ensureFontMeasured(obj, fabricCache);

    expect(document.fonts.load).toHaveBeenCalledWith('130px "BebasNeue"');
    expect(fabricCache.clearFontCache).toHaveBeenCalledWith('BebasNeue');
    expect(obj.initDimensions).toHaveBeenCalledTimes(1);
    expect(obj.setCoords).toHaveBeenCalledTimes(1);
    expect(canvas.renderAll).toHaveBeenCalledTimes(1);
  });

  it('bails out without touching the object if the canvas was disposed while awaiting the load', async () => {
    let resolveLoad;
    document.fonts = {
      check: jest.fn().mockReturnValue(false),
      load: jest.fn(() => new Promise((resolve) => { resolveLoad = resolve; })),
    };

    const obj = makeFakeObj();
    const canvas = makeFakeCanvas([obj]);
    obj.canvas = canvas;
    const fabricCache = { clearFontCache: jest.fn() };

    const pending = ensureFontMeasured(obj, fabricCache);

    // Simulate a view switch tearing the canvas down mid-await.
    canvas.disposed = true;
    resolveLoad();
    await pending;

    expect(fabricCache.clearFontCache).not.toHaveBeenCalled();
    expect(obj.initDimensions).not.toHaveBeenCalled();
    expect(canvas.renderAll).not.toHaveBeenCalled();
  });

  it('bails out if the object was removed from the canvas while awaiting the load', async () => {
    let resolveLoad;
    document.fonts = {
      check: jest.fn().mockReturnValue(false),
      load: jest.fn(() => new Promise((resolve) => { resolveLoad = resolve; })),
    };

    const obj = makeFakeObj();
    const canvas = makeFakeCanvas([obj]);
    obj.canvas = canvas;
    const fabricCache = { clearFontCache: jest.fn() };

    const pending = ensureFontMeasured(obj, fabricCache);

    // Simulate canvas.remove(obj): fabric clears obj.canvas and the object
    // drops out of canvas.getObjects().
    obj.canvas = undefined;
    canvas.getObjects = () => [];
    resolveLoad();
    await pending;

    expect(fabricCache.clearFontCache).not.toHaveBeenCalled();
    expect(obj.initDimensions).not.toHaveBeenCalled();
  });

  it('leaves the existing measurement in place if the font fails to load', async () => {
    document.fonts = {
      check: jest.fn().mockReturnValue(false),
      load: jest.fn().mockRejectedValue(new Error('network error')),
    };

    const obj = makeFakeObj();
    const canvas = makeFakeCanvas([obj]);
    obj.canvas = canvas;
    const fabricCache = { clearFontCache: jest.fn() };

    await expect(ensureFontMeasured(obj, fabricCache)).resolves.toBeUndefined();

    expect(fabricCache.clearFontCache).not.toHaveBeenCalled();
    expect(obj.initDimensions).not.toHaveBeenCalled();
  });

  it('is a no-op for an object without a fontFamily', async () => {
    document.fonts = { check: jest.fn(), load: jest.fn() };
    const obj = { fontSize: 24 };
    const fabricCache = { clearFontCache: jest.fn() };

    await ensureFontMeasured(obj, fabricCache);

    expect(document.fonts.check).not.toHaveBeenCalled();
    expect(fabricCache.clearFontCache).not.toHaveBeenCalled();
  });
});

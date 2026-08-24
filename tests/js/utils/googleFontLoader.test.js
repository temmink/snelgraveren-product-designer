import {
  normalizeGoogleName,
  cssEscape,
  loadGoogleFontFamilies,
  injectCustomFontFaces,
} from '../../../shared/js/googleFontLoader';

describe('normalizeGoogleName', () => {
  it('splits a camelCase alias back into Google\'s canonical space-separated name', () => {
    expect(normalizeGoogleName('BebasNeue')).toBe('Bebas Neue');
    expect(normalizeGoogleName('PermanentMarker')).toBe('Permanent Marker');
  });

  it('leaves an already-canonical name unchanged', () => {
    expect(normalizeGoogleName('Bebas Neue')).toBe('Bebas Neue');
    expect(normalizeGoogleName('Roboto')).toBe('Roboto');
  });
});

describe('cssEscape', () => {
  it('escapes backslashes and single quotes', () => {
    expect(cssEscape("O'Brien\\Font")).toBe("O\\'Brien\\\\Font");
  });
});

describe('injectCustomFontFaces', () => {
  afterEach(() => {
    document.getElementById('pf-custom-fonts')?.remove();
  });

  it('does nothing for an empty/missing font list', () => {
    injectCustomFontFaces([]);
    expect(document.getElementById('pf-custom-fonts')).toBeNull();
  });

  it('creates a <style> tag with @font-face rules, escaping values', () => {
    injectCustomFontFaces([
      { family: "My'Font", files: [{ file_url: 'https://example.com/f.woff2', format: 'woff2' }] },
    ]);
    const style = document.getElementById('pf-custom-fonts');
    expect(style).not.toBeNull();
    expect(style.textContent).toContain("font-family: 'My\\'Font'");
    expect(style.textContent).toContain("url('https://example.com/f.woff2') format('woff2')");
  });

  it('updates the existing style tag in place rather than duplicating it', () => {
    injectCustomFontFaces([{ family: 'A', files: [{ file_url: 'a.woff2', format: 'woff2' }] }]);
    injectCustomFontFaces([{ family: 'B', files: [{ file_url: 'b.woff2', format: 'woff2' }] }]);
    const styles = document.querySelectorAll('#pf-custom-fonts');
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain('B');
    expect(styles[0].textContent).not.toContain("family: 'A'");
  });
});

describe('loadGoogleFontFamilies', () => {
  const realFetch = global.fetch;
  const realFontFace = global.FontFace;

  beforeEach(() => {
    document.getElementById('pf-google-fonts')?.remove();
  });

  afterEach(() => {
    global.fetch = realFetch;
    global.FontFace = realFontFace;
    document.getElementById('pf-google-fonts')?.remove();
    jest.restoreAllMocks();
  });

  it('is a no-op for an empty family list', () => {
    loadGoogleFontFamilies([], 'https://example.com/wp-json/pf/v1');
    expect(document.getElementById('pf-google-fonts')).toBeNull();
  });

  it('injects a css2 <link> using the CANONICAL (space-separated) name even when given a non-canonical alias', () => {
    // Uses a different alias than the FontFace-registration test below —
    // _proxyRegistered is a module-level Set, so reusing the same family
    // name across tests would make the second registerViaProxy call a
    // silent no-op.
    global.fetch = jest.fn(() => Promise.reject(new Error('no proxy in this test')));
    loadGoogleFontFamilies(['PermanentMarker'], 'https://example.com/wp-json/pf/v1');

    const link = document.getElementById('pf-google-fonts');
    expect(link).not.toBeNull();
    expect(link.rel).toBe('stylesheet');
    expect(link.href).toContain('family=Permanent+Marker');
  });

  it('updates an existing link href on a subsequent call with different families', () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('no proxy in this test')));
    loadGoogleFontFamilies(['Roboto'], 'https://example.com/wp-json/pf/v1');
    const first = document.getElementById('pf-google-fonts');
    expect(first.href).toContain('family=Roboto');

    loadGoogleFontFamilies(['Lato'], 'https://example.com/wp-json/pf/v1');
    const links = document.querySelectorAll('#pf-google-fonts');
    expect(links.length).toBe(1);
    expect(links[0].href).toContain('family=Lato');
  });

  it('registers a FontFace under the EXACT stored alias via the /font-file proxy', async () => {
    const b64 = btoa('fake-ttf-bytes');
    global.fetch = jest.fn((url) => {
      expect(String(url)).toContain('/font-file?family=BebasNeue');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: b64 }),
      });
    });

    const added = [];
    const fakeFace = { load: jest.fn().mockResolvedValue(undefined) };
    global.FontFace = jest.fn(() => fakeFace);
    document.fonts = { add: jest.fn((f) => added.push(f)) };

    loadGoogleFontFamilies(['BebasNeue'], 'https://example.com/wp-json/pf/v1');

    // registerViaProxy is fire-and-forget and sequentially awaits two weights
    // (400, 700), each with its own fetch -> json -> FontFace#load chain —
    // flush enough microtasks for both iterations to finish.
    for (let i = 0; i < 20; i++) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    expect(global.FontFace).toHaveBeenCalledWith('BebasNeue', expect.anything(), { weight: '400' });
    expect(global.FontFace).toHaveBeenCalledWith('BebasNeue', expect.anything(), { weight: '700' });
    expect(document.fonts.add).toHaveBeenCalled();
  });
});

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

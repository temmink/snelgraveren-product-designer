import { saveDesignView, createDesign, uploadFile } from '../../../frontend/js/designer/src/api/designerApi';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('designerApi', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="pf-designer-root" data-config=\'{"template_id":3,"rest_url":"https://shop.test/wp-json/pf/v1","nonce":"abc"}\'></div>';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete global.fetch;
  });

  describe('saveDesignView — multipart body, never one big JSON string', () => {
    // ModSecurity's SecRequestBodyNoFilesLimit (1 MiB by default on cPanel
    // hosts) counts every byte that is NOT a file part. A design with a photo
    // pushes the 3x export PNG past that alone, and the host then answers
    // with WordPress' rest_no_route. File parts fall under the far larger
    // SecRequestBodyLimit, so every blob must travel as a file.
    it('sends the blobs as file parts of a FormData body', async () => {
      global.fetch.mockResolvedValue(jsonResponse(200, { design_hash: 'a'.repeat(32) }));

      await saveDesignView('a'.repeat(32), 7, { objects: [{ type: 'IText' }] }, PNG_DATA_URL, PNG_DATA_URL, '<svg/>', '<svg id="embed"/>', '<LightBurnProject/>');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe(`https://shop.test/wp-json/pf/v1/designs/${'a'.repeat(32)}/views`);
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      // The browser must set the multipart boundary itself.
      expect(init.headers['Content-Type']).toBeUndefined();
      expect(init.headers['X-WP-Nonce']).toBe('abc');

      const fd = init.body;
      expect(fd.get('view_id')).toBe('7');
      for (const key of ['canvas_json', 'thumbnail', 'export_svg', 'export_vector', 'export_vector_embed', 'export_lbrn']) {
        expect(fd.get(key)).toBeInstanceOf(Blob);
      }
      expect(fd.get('thumbnail').type).toBe('image/png');
      expect(fd.get('export_svg').type).toBe('image/png');
      expect(fd.get('export_vector').type).toBe('image/svg+xml');
      expect(fd.get('canvas_json').type).toBe('application/json');
      // The PNG travels as raw bytes, not as base64 text (that is the whole point).
      expect(fd.get('export_svg').size).toBe(Buffer.from(PNG_B64, 'base64').length);
      // jsdom's Blob has no text(); the byte length of the JSON is the next best check.
      expect(fd.get('canvas_json').size).toBe(JSON.stringify({ objects: [{ type: 'IText' }] }).length);
    });

    it('omits empty blobs so the server keeps whatever it already had for them', async () => {
      global.fetch.mockResolvedValue(jsonResponse(200, {}));
      await saveDesignView('b'.repeat(32), 1, { objects: [] }, '', '', '', '', '');
      const fd = global.fetch.mock.calls[0][1].body;
      expect(fd.get('canvas_json')).toBeInstanceOf(Blob);
      for (const key of ['thumbnail', 'export_svg', 'export_vector', 'export_vector_embed', 'export_lbrn']) {
        expect(fd.get(key)).toBeNull();
      }
    });

    it('surfaces the server message on a normal error', async () => {
      global.fetch.mockResolvedValue(jsonResponse(403, { code: 'forbidden', message: 'Access denied.' }));
      await expect(saveDesignView('c'.repeat(32), 1, { objects: [] })).rejects.toThrow('Access denied.');
    });
  });

  describe('rest_no_route on a route the designer knows exists', () => {
    // That combination means the request never reached the plugin: the web
    // server rejected it (body-size limit) and let WordPress answer the
    // retry as a GET. "No route was found" is useless to a customer.
    it('is translated into a size/hosting explanation for the view save', async () => {
      global.fetch.mockResolvedValue(jsonResponse(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' }));
      await expect(saveDesignView('d'.repeat(32), 1, { objects: [] })).rejects.toThrow(/too large|server/i);
      await expect(saveDesignView('d'.repeat(32), 1, { objects: [] })).rejects.not.toThrow(/No route was found/);
    });

    it('is translated for createDesign and uploadFile too', async () => {
      global.fetch.mockResolvedValue(jsonResponse(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' }));
      await expect(createDesign(3, 9)).rejects.toThrow(/too large|server/i);
      await expect(uploadFile(new File(['x'], 'x.png', { type: 'image/png' }))).rejects.toThrow(/too large|server/i);
    });

    it('leaves a genuine 404 from the plugin alone', async () => {
      global.fetch.mockResolvedValue(jsonResponse(404, { code: 'not_found', message: 'Design not found.' }));
      await expect(saveDesignView('e'.repeat(32), 1, { objects: [] })).rejects.toThrow('Design not found.');
    });
  });
});

import { __ } from '@wordpress/i18n';
import { getDesignerConfig } from '../utils/config';

function apiUrl(path) {
  return `${getDesignerConfig().rest_url}${path}`;
}

/**
 * Build the Error for a failed response.
 *
 * `rest_no_route` on a route the designer KNOWS it registers means the request
 * never reached the plugin: the web server refused it (typically ModSecurity's
 * 1 MiB SecRequestBodyNoFilesLimit on cPanel hosts) and let WordPress answer
 * the fallback GET, which has no such route. WordPress' "No route was found
 * matching the URL and request method" is meaningless to a customer, so it is
 * replaced by the one thing they can act on. Seen on le-denhelder.nl, 1.12.4.
 */
async function restError(res, fallback) {
  const err = await res.json().catch(() => ({}));
  if (res.status === 404 && err.code === 'rest_no_route') {
    return new Error(__('The server refused this request before it reached the designer, usually because the design is too large for the server’s limits. Please try a smaller image, or contact the shop.', 'snelgraveren-product-designer'));
  }
  return new Error(err.message || fallback);
}

/**
 * Turn a view-save value into a Blob file part. PNG data URLs become raw PNG
 * bytes (a third smaller than their base64 text); markup/XML/JSON travel as
 * text with the right MIME type. File parts matter: ModSecurity's
 * SecRequestBodyNoFilesLimit (1 MiB by default) counts every byte that is
 * NOT a file, so the export PNG of a design with a photo tripped it when the
 * whole save was one JSON body.
 */
function toBlobPart(value, type) {
  if (typeof value === 'string' && value.startsWith('data:')) {
    const comma = value.indexOf(',');
    const meta = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    const mime = meta.split(';')[0] || type;
    if (/;base64$/.test(meta)) {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  }
  return new Blob([value], { type });
}

function headers(includeNonce = true) {
  const h = { 'Content-Type': 'application/json' };
  const { nonce } = getDesignerConfig();
  if (includeNonce && nonce) {
    h['X-WP-Nonce'] = nonce;
  }
  return h;
}

export async function loadTemplate(templateId) {
  const res = await fetch(apiUrl(`/templates/${templateId}/public`));
  if (!res.ok) throw await restError(res, 'Failed to load template');
  return res.json();
}

export async function createDesign(templateId, productId) {
  const res = await fetch(apiUrl('/designs'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ template_id: templateId, product_id: productId }),
  });
  if (!res.ok) throw await restError(res, 'Failed to create design');
  return res.json();
}

/**
 * Save one view. Sent as multipart/form-data with every blob as a FILE part —
 * never as one JSON body. See toBlobPart() for why; RestDesigns::upsert_view
 * reads both shapes. Empty blobs are omitted so the server keeps what it has.
 */
export async function saveDesignView(designHash, viewId, canvasJson, thumbnail = '', exportSvg = '', exportVector = '', exportVectorEmbed = '', exportLbrn = '') {
  const fd = new FormData();
  fd.append('view_id', String(viewId));
  fd.append('canvas_json', toBlobPart(JSON.stringify(canvasJson), 'application/json'), 'canvas.json');
  const parts = [
    ['thumbnail', thumbnail, 'image/png', 'thumbnail.png'],
    ['export_svg', exportSvg, 'image/png', 'export.png'],
    ['export_vector', exportVector, 'image/svg+xml', 'export.svg'],
    ['export_vector_embed', exportVectorEmbed, 'image/svg+xml', 'export-embed.svg'],
    ['export_lbrn', exportLbrn, 'application/xml', 'export.lbrn2'],
  ];
  for (const [key, value, type, filename] of parts) {
    if (value) fd.append(key, toBlobPart(value, type), filename);
  }

  // No Content-Type header: the browser sets the multipart boundary itself.
  const { nonce } = getDesignerConfig();
  const res = await fetch(apiUrl(`/designs/${designHash}/views`), {
    method: 'POST',
    headers: nonce ? { 'X-WP-Nonce': nonce } : {},
    body: fd,
  });
  if (!res.ok) throw await restError(res, 'Failed to save view');
  return res.json();
}

export async function loadDesign(designHash) {
  const res = await fetch(apiUrl(`/designs/${designHash}`), {
    headers: headers(),
  });
  if (!res.ok) throw await restError(res, 'Failed to load design');
  return res.json();
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  // No Content-Type header here — the browser must set the multipart
  // boundary for FormData itself, so we can't reuse headers().
  const { nonce } = getDesignerConfig();
  const res = await fetch(apiUrl('/uploads'), {
    method: 'POST',
    headers: nonce ? { 'X-WP-Nonce': nonce } : {},
    body: formData,
  });
  if (!res.ok) throw await restError(res, 'Upload failed');
  return res.json();
}

export async function fetchCustomFonts() {
  const res = await fetch(apiUrl('/fonts'));
  if (!res.ok) return [];
  return res.json();
}

export async function fetchDesignTemplates(templateId, allowedIds) {
  let url = apiUrl('/design-templates');
  const params = [];
  if (templateId) params.push(`template_id=${templateId}`);
  if (allowedIds?.length) params.push(`ids=${allowedIds.join(',')}`);
  if (params.length) url += `?${params.join('&')}`;

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchDesignTemplateDetail(id) {
  const res = await fetch(apiUrl(`/design-templates/${id}`), { headers: headers() });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchClipartCollections() {
  const res = await fetch(apiUrl('/clipart/collections'));
  if (!res.ok) return [];
  const collections = await res.json();
  // Fetch items for each collection
  const withItems = await Promise.all(
    collections.map(async (c) => {
      const res2 = await fetch(apiUrl(`/clipart/collections/${c.id}`));
      if (!res2.ok) return { ...c, items: [] };
      return res2.json();
    })
  );
  return withItems;
}

export async function previewPrice(templateId, counts) {
  const res = await fetch(apiUrl('/pricing/preview'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ template_id: templateId, counts }),
  });
  if (!res.ok) throw new Error('Price preview failed');
  return res.json();
}

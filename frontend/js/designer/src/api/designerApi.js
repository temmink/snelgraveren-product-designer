import { getDesignerConfig } from '../utils/config';

function apiUrl(path) {
  return `${getDesignerConfig().rest_url}${path}`;
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
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to load template');
  }
  return res.json();
}

export async function createDesign(templateId, productId) {
  const res = await fetch(apiUrl('/designs'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ template_id: templateId, product_id: productId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create design');
  }
  return res.json();
}

export async function saveDesignView(designHash, viewId, canvasJson, thumbnail = '', exportSvg = '', exportVector = '', exportVectorEmbed = '') {
  const res = await fetch(apiUrl(`/designs/${designHash}/views`), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      view_id: viewId,
      canvas_json: canvasJson,
      thumbnail,
      export_svg: exportSvg,
      export_vector: exportVector,
      export_vector_embed: exportVectorEmbed,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to save view');
  }
  return res.json();
}

export async function loadDesign(designHash) {
  const res = await fetch(apiUrl(`/designs/${designHash}`), {
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to load design');
  }
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
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Upload failed');
  }
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

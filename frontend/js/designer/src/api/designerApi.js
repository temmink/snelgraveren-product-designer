const config = window.pdDesigner || {};

function apiUrl(path) {
  return `${config.api_base}${path}`;
}

function headers(includeNonce = true) {
  const h = { 'Content-Type': 'application/json' };
  if (includeNonce && config.nonce) {
    h['X-WP-Nonce'] = config.nonce;
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

export async function saveDesignView(designHash, viewId, canvasJson, thumbnail = '') {
  const res = await fetch(apiUrl(`/designs/${designHash}/views`), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      view_id: viewId,
      canvas_json: canvasJson,
      thumbnail,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to save view');
  }
  return res.json();
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(apiUrl('/uploads'), {
    method: 'POST',
    headers: config.nonce ? { 'X-WP-Nonce': config.nonce } : {},
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Upload failed');
  }
  return res.json();
}

const base  = () => window.pfTemplateBuilder?.restUrl || '/wp-json/';
const nonce = () => window.pfTemplateBuilder?.nonce   || '';

async function request(method, path, body) {
  const res = await fetch(`${base()}pf/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-WP-Nonce':   nonce(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 204 No Content — nothing to parse.
  if (res.status === 204) return null;

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Request failed: ${res.status}`);
  }
  return data;
}

export const templateApi = {
  // Templates
  list:      ()              => request('GET',    'templates'),
  create:    (data)          => request('POST',   'templates', data),
  get:       (id)            => request('GET',    `templates/${id}`),
  update:    (id, data)      => request('PUT',    `templates/${id}`, data),
  delete:    (id)            => request('DELETE', `templates/${id}`),
  duplicate: (id)            => request('POST',   `templates/${id}/duplicate`),

  // Views
  createView: (templateId, data)           => request('POST',   `templates/${templateId}/views`, data),
  updateView: (templateId, viewId, data)   => request('PUT',    `templates/${templateId}/views/${viewId}`, data),
  deleteView: (templateId, viewId)         => request('DELETE', `templates/${templateId}/views/${viewId}`),
};

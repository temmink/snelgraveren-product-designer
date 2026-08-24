const base  = () => window.sgpdTemplateBuilder?.restUrl || '/wp-json/';
const nonce = () => window.sgpdTemplateBuilder?.nonce   || '';

/**
 * Decode a `data:<mime>;base64,<payload>` string into a Blob.
 * Throws on anything else — callers treat that as "skip this layer".
 */
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Not a base64 data URL');
  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/**
 * Upload a base64 data URL to the WordPress media library and return the
 * attachment's public URL.
 *
 * Uses core's wp/v2/media rather than a plugin endpoint: the file is an
 * ordinary image the merchant should be able to find and manage afterwards,
 * and core already handles MIME validation, sideloading and thumbnails.
 * Requires the `upload_files` capability — a caller must handle rejection.
 *
 * No Content-Type header: the browser must set the multipart boundary.
 */
export async function uploadDataUrlToMedia(dataUrl, filename) {
  const blob = dataUrlToBlob(dataUrl);
  const form = new FormData();
  form.append('file', blob, filename);

  const res = await fetch(`${base()}wp/v2/media`, {
    method: 'POST',
    headers: { 'X-WP-Nonce': nonce() },
    body: form,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.source_url) {
    throw new Error(data?.message || `Media upload failed (${res.status})`);
  }
  return data.source_url;
}

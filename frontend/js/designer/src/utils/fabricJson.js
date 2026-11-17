// Fabric.js 6.x uses PascalCase in JSON but lowercase-hyphenated at runtime.
// Accept both forms for safe whitelist filtering.
const ALLOWED_FABRIC_TYPES = new Set([
  'IText', 'Textbox', 'Image', 'Rect', 'Path', 'Group',
  'i-text', 'textbox', 'image', 'rect', 'path', 'group',
]);

export function filterFabricJson(json) {
  if (!json || !json.objects) return json;
  return {
    ...json,
    objects: json.objects.filter((obj) => ALLOWED_FABRIC_TYPES.has(obj.type)),
  };
}

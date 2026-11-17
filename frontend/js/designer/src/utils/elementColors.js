// Which colours a customer's own elements (text, clip art) may have.
//
// One reading of the template's colour settings, used by the colour controls
// in the sidebar AND by the tools that create an element. They disagreed
// before: the controls offered only the template's palette while every new
// text was created in a hard-coded black — a colour the customer could not
// pick, on a product (anodised dog tag, one engraving colour) where it does
// not exist.

const BLACK = '#000000';

export function resolveElementColors(globalConfig = {}) {
  const enabled = globalConfig.element_colors_enabled ?? globalConfig.colors_enabled ?? true;
  const allowed = globalConfig.element_allowed_colors || globalConfig.allowed_colors || [];
  const anyColor = globalConfig.element_any_color ?? globalConfig.any_color ?? false;
  return { enabled, anyColor, allowed: Array.isArray(allowed) ? allowed : [] };
}

/**
 * The colour a newly created element starts in: the first colour of a
 * restricted palette, black when the customer may pick freely.
 */
export function defaultElementColor(globalConfig = {}) {
  const { anyColor, allowed } = resolveElementColors(globalConfig);
  if (anyColor || allowed.length === 0) return BLACK;
  return allowed.includes(BLACK) ? BLACK : allowed[0];
}

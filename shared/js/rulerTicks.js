/**
 * Tick arithmetic for the millimetre rulers shown alongside both canvases.
 * Pure — no DOM, no React — so it is unit-testable and shared by the Template
 * Builder and the customer Designer.
 */

const STEPS_MM = [1, 2, 5, 10, 20, 50, 100];
const MINORS_PER_MAJOR = 5;

/**
 * Smallest step from STEPS_MM whose on-screen spacing clears the label floor.
 * Falls back to the coarsest step rather than returning nothing, so a very
 * small drawing still gets a usable (if sparse) scale.
 *
 * @param {number} mmPerPx millimetres represented by one on-screen pixel
 * @param {number} [minLabelSpacingPx] minimum gap between labelled ticks
 * @returns {number} step in millimetres
 */
export function chooseTickStepMm(mmPerPx, minLabelSpacingPx = 40) {
  if (!(mmPerPx > 0)) return STEPS_MM[0];
  for (const step of STEPS_MM) {
    if (step / mmPerPx >= minLabelSpacingPx) return step;
  }
  return STEPS_MM[STEPS_MM.length - 1];
}

/**
 * Ticks from 0 to lengthPx inclusive. Majors carry a millimetre value for the
 * label; minors sit at one fifth of the step and stay unlabelled.
 *
 * @param {{lengthPx:number, mmPerPx:number, minLabelSpacingPx?:number}} opts
 * @returns {Array<{px:number, mm:number, major:boolean}>}
 */
export function buildTicks({ lengthPx, mmPerPx, minLabelSpacingPx = 40 }) {
  if (!(mmPerPx > 0) || !(lengthPx > 0)) return [];
  const stepMm = chooseTickStepMm(mmPerPx, minLabelSpacingPx);
  const minorMm = stepMm / MINORS_PER_MAJOR;
  const ticks = [];
  for (let i = 0; ; i++) {
    const mm = i * minorMm;
    const px = mm / mmPerPx;
    if (px > lengthPx + 1e-6) break;
    ticks.push({
      px: Math.round(px * 1000) / 1000,
      mm: Math.round(mm * 1000) / 1000,
      major: i % MINORS_PER_MAJOR === 0,
    });
  }
  return ticks;
}

/**
 * Physical width (mm) for the view at `index`, inheriting the raw millimetre
 * value from a sibling view when the current view has none set.
 *
 * Views of one template are the front/back of ONE physical object, so the
 * physical width carries over as-is even when the canvas pixel size differs
 * between views — this deliberately inherits the raw mm number, NOT a
 * mm-per-pixel ratio. Display-time fallback only: never write the inherited
 * value back to the view.
 *
 * @param {Array<{width_mm?: number|string}>} [views]
 * @param {number} index
 * @returns {{widthMm: number, inherited: boolean}}
 */
export function resolveWidthMm(views, index) {
  const list = Array.isArray(views) ? views : [];

  const own = Number(list[index]?.width_mm) || 0;
  if (own > 0) return { widthMm: own, inherited: false };

  for (const view of list) {
    const mm = Number(view?.width_mm) || 0;
    if (mm > 0) return { widthMm: mm, inherited: true };
  }

  return { widthMm: 0, inherited: false };
}

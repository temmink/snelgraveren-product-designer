/**
 * Generate SVG path strings for curved text presets.
 * @param {number} width - Text bounding width
 * @param {number} intensity - Curve intensity (-100 to 100)
 */

export function archUpPath(width, intensity = 60) {
  const h = Math.abs(intensity) * (width / 200);
  return `M 0 ${h} Q ${width / 2} ${-h * 0.5} ${width} ${h}`;
}

export function archDownPath(width, intensity = 60) {
  const h = Math.abs(intensity) * (width / 200);
  return `M 0 0 Q ${width / 2} ${h * 1.5} ${width} 0`;
}

export function wavePath(width, intensity = 60) {
  const h = Math.abs(intensity) * (width / 300);
  return `M 0 ${h} C ${width * 0.25} ${-h} ${width * 0.75} ${h * 3} ${width} ${h}`;
}

export function circlePath(width) {
  const r = width / (2 * Math.PI);
  const cx = width / 2;
  const cy = r;
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
}

export function straightPath(width) {
  return `M 0 0 L ${width} 0`;
}

export function customPath(width, intensity) {
  if (intensity >= 0) return archUpPath(width, intensity);
  return archDownPath(width, Math.abs(intensity));
}

export const PRESETS = [
  { id: 'arch-up', label: 'Arch up', generator: archUpPath },
  { id: 'arch-down', label: 'Arch down', generator: archDownPath },
  { id: 'wave', label: 'Wave', generator: wavePath },
  { id: 'circle', label: 'Circle', generator: circlePath },
  { id: 'straight', label: 'Straight', generator: straightPath },
  { id: 'custom', label: 'Custom', generator: customPath },
];

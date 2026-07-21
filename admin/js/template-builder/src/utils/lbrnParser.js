/** Round to 3 decimals, drop trailing zeros. */
function n(v) {
  return parseFloat(Number(v).toFixed(3));
}

/**
 * Parse a LightBurn VertList: `V{x} {y}` optionally followed by control-handle
 * tokens `c0x{v}` `c0y{v}` `c1x{v}` `c1y{v}`. A missing handle component
 * defaults to the vertex coordinate. c0 = incoming handle, c1 = outgoing.
 */
export function parseVertList(vertList) {
  const verts = [];
  const re = /V(-?[\d.]+) (-?[\d.]+)((?:c[01][xy]-?[\d.]+)*)/g;
  let m;
  while ((m = re.exec(vertList)) !== null) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const v = { x, y, c0x: x, c0y: y, c1x: x, c1y: y };
    const hre = /c([01])([xy])(-?[\d.]+)/g;
    let h;
    while ((h = hre.exec(m[3])) !== null) v[`c${h[1]}${h[2]}`] = parseFloat(h[3]);
    verts.push(v);
  }
  return verts;
}

/** Parse a LightBurn PrimList: `L{a} {b}` = line a→b, `B{a} {b}` = bezier a→b. */
export function parsePrimList(primList) {
  const prims = [];
  const re = /([LB])(\d+) (\d+)/g;
  let m;
  while ((m = re.exec(primList)) !== null) {
    prims.push({ cmd: m[1], a: parseInt(m[2], 10), b: parseInt(m[3], 10) });
  }
  return prims;
}

/**
 * Convert a VertList/PrimList pair to an SVG path `d` string.
 * A primitive whose target is the subpath's start vertex closes it: a line
 * closes with `Z`; a bezier emits its curve then `Z`. `transform(x,y)→[x,y]`
 * is applied to every coordinate (vertices and handles).
 */
export function vertPrimToPathData(vertList, primList, transform) {
  const t = transform || ((x, y) => [x, y]);
  const verts = parseVertList(vertList);
  const prims = parsePrimList(primList);
  if (!verts.length || !prims.length) return '';
  const px = (x, y) => { const [a, b] = t(x, y); return `${n(a)} ${n(b)}`; };
  let d = '';
  let i = 0;
  while (i < prims.length) {
    const start = prims[i].a;
    const sv = verts[start];
    if (!sv) break;
    d += `M${px(sv.x, sv.y)}`;
    let cursor = start;
    while (i < prims.length && prims[i].a === cursor) {
      const p = prims[i];
      const a = verts[p.a];
      const b = verts[p.b];
      const closing = p.b === start;
      if (p.cmd === 'L') {
        if (!closing) d += `L${px(b.x, b.y)}`;
      } else {
        d += `C${px(a.c1x, a.c1y)} ${px(b.c0x, b.c0y)} ${px(b.x, b.y)}`;
      }
      cursor = p.b;
      i++;
      if (closing) { d += 'Z'; break; }
    }
  }
  return d;
}

// Puts a real screenshot onto a generated device's chroma-green screen: finds the green area, fits its four edges
// (least squares, so rounded corners don't skew it), maps the screenshot with a homography (bilinear), blends with a
// soft mask and removes green spill. Runs in headless Chrome's canvas.
//   node composite.mjs <photo.png> <screenshot.png> <out.png> [portrait|landscape]
import { readFileSync, writeFileSync } from 'node:fs';
const puppeteer = (await import('/Users/hunr/Documents/clawd/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const [photo, shot, out, orient = 'landscape'] = process.argv.slice(2);
const b64 = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--disable-web-security'] });
const p = await b.newPage();
p.on('console', (m) => console.log('page:', m.text()));
await p.setContent('<html><body></body></html>');
const res = await p.evaluate(async (photoSrc, shotSrc, orient) => {
  const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
  const [P, S] = await Promise.all([load(photoSrc), load(shotSrc)]);
  const W = P.naturalWidth, H = P.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'); cx.drawImage(P, 0, 0);
  const img = cx.getImageData(0, 0, W, H), d = img.data;
  const sc = document.createElement('canvas'); sc.width = S.naturalWidth; sc.height = S.naturalHeight;
  const sx = sc.getContext('2d'); sx.drawImage(S, 0, 0);
  const sd = sx.getImageData(0, 0, sc.width, sc.height).data, SW = sc.width, SH = sc.height;
  // greenness: how far green beats red and blue
  const gr = (i) => (d[i + 1] - Math.max(d[i], d[i + 2]));
  const mask = new Float32Array(W * H);
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, g = gr(i);
    const m = Math.min(1, Math.max(0, (g - 40) / 90));
    mask[y * W + x] = m; if (m > 0.5) n++;
  }
  if (n < 1000) return { error: 'no green screen found' };
  // the screen is the largest connected patch of strong green (the desk's green glow is weaker and elsewhere)
  const strong = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) if (gr(k * 4) > 110) strong[k] = 1;
  const label = new Int32Array(W * H);
  let best = 0, bestSize = 0, cur = 0;
  const stack = new Int32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    if (!strong[k] || label[k]) continue;
    cur++; let sp = 0, size = 0; stack[sp++] = k; label[k] = cur;
    while (sp) {
      const q = stack[--sp]; size++;
      const qx = q % W, qy = (q / W) | 0;
      if (qx > 0 && strong[q - 1] && !label[q - 1]) { label[q - 1] = cur; stack[sp++] = q - 1; }
      if (qx < W - 1 && strong[q + 1] && !label[q + 1]) { label[q + 1] = cur; stack[sp++] = q + 1; }
      if (qy > 0 && strong[q - W] && !label[q - W]) { label[q - W] = cur; stack[sp++] = q - W; }
      if (qy < H - 1 && strong[q + W] && !label[q + W]) { label[q + W] = cur; stack[sp++] = q + W; }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
  }
  // the core, filled (so dark notches or reflections inside it count), then grown a few pixels for the soft edge
  const core = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) if (label[k] === best) core[k] = 1;
  const near = new Uint8Array(core);
  for (let it = 0; it < 4; it++) { const prev = new Uint8Array(near); for (let k = W; k < W * H - W; k++) if (!prev[k] && (prev[k - 1] || prev[k + 1] || prev[k - W] || prev[k + W])) near[k] = 1; }
  for (let k = 0; k < W * H; k++) { if (!near[k]) mask[k] = 0; }
  // the screen's main axis (PCA of its pixels), then each side = the boundary points at an extreme along an axis
  let mx = 0, my = 0, cnt = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (core[y * W + x]) { mx += x; my += y; cnt++; }
  mx /= cnt; my /= cnt;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (core[y * W + x]) { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); }
  const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ca = Math.cos(th), sa = Math.sin(th);
  const boundary = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x;
    if (!core[k]) continue;
    if (!core[k - 1] || !core[k + 1] || !core[k - W] || !core[k + W]) {
      const u = (x - mx) * ca + (y - my) * sa, v = -(x - mx) * sa + (y - my) * ca;
      boundary.push([x, y, u, v]);
    }
  }
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  boundary.forEach(([, , u, v]) => { umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); });
  const fitLine = (pp) => {
    let ax = 0, ay = 0; pp.forEach(([x, y]) => { ax += x; ay += y; }); ax /= pp.length; ay /= pp.length;
    let sxx = 0, syy = 0, sxy = 0; pp.forEach(([x, y]) => { sxx += (x - ax) ** 2; syy += (y - ay) ** 2; sxy += (x - ax) * (y - ay); });
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { px: ax, py: ay, dx: Math.cos(ang), dy: Math.sin(ang), count: pp.length };
  };
  const side = (pred) => {
    const pts = boundary.filter(pred);
    let l = fitLine(pts);
    const keep = pts.filter(([x, y]) => Math.abs((x - l.px) * l.dy - (y - l.py) * l.dx) < 3);
    if (keep.length > 20) l = fitLine(keep);
    return l;
  };
  const Lu = umax - umin, Lv = vmax - vmin, band = 14;
  const midU = (u) => u > umin + 0.18 * Lu && u < umax - 0.18 * Lu, midV = (v) => v > vmin + 0.18 * Lv && v < vmax - 0.18 * Lv;
  const sVmin = side(([, , u, v]) => v < vmin + band && midU(u)), sVmax = side(([, , u, v]) => v > vmax - band && midU(u));
  const sUmin = side(([, , u, v]) => u < umin + band && midV(v)), sUmax = side(([, , u, v]) => u > umax - band && midV(v));
  const lines = [sVmin, sUmax, sVmax, sUmin];
  const meet = (l1, l2) => {
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    return [l1.px + t * l1.dx, l1.py + t * l1.dy];
  };
  // a cycle of corners, then order it clockwise starting anywhere (fixed up below)
  let Q = [meet(sUmin, sVmin), meet(sVmin, sUmax), meet(sUmax, sVmax), meet(sVmax, sUmin)];
  const area = Q.reduce((a, q, i) => { const r = Q[(i + 1) % 4]; return a + q[0] * r[1] - r[0] * q[1]; }, 0);
  if (area < 0) Q = [Q[0], Q[3], Q[2], Q[1]]; // clockwise in image coordinates (y down)
  // make the screenshot's long side follow the screen's long side
  const len = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1]);
  const topLen = len(Q[0], Q[1]), sideLen = len(Q[1], Q[2]);
  const wantPortrait = orient === 'portrait';
  if ((sideLen > topLen) !== wantPortrait) Q = [Q[3], Q[0], Q[1], Q[2]];
  // the screenshot's top goes on the end of the device nearer the top of the photo
  if ((Q[0][1] + Q[1][1]) > (Q[2][1] + Q[3][1])) Q = [Q[2], Q[3], Q[0], Q[1]];
  // homography from screenshot corners to Q, then its inverse
  function homography(src, dst) {
    const A = [], bb = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bb.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bb.push(v);
    }
    // gaussian elimination
    for (let c = 0; c < 8; c++) {
      let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [bb[c], bb[piv]] = [bb[piv], bb[c]];
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; bb[r] -= f * bb[c]; }
    }
    const h = bb.map((v, i) => v / A[i][i]);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  const Hinv = homography(Q, [[0, 0], [SW, 0], [SW, SH], [0, SH]]); // photo -> screenshot
  const xs = Q.map((q) => q[0]), ys = Q.map((q) => q[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 4), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)) + 4);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 4), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)) + 4);
  const sample = (u, v, c) => {
    u = Math.min(SW - 1.001, Math.max(0, u)); v = Math.min(SH - 1.001, Math.max(0, v));
    const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
    const i00 = (iy * SW + ix) * 4 + c, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
    return (sd[i00] * (1 - fx) + sd[i10] * fx) * (1 - fy) + (sd[i01] * (1 - fx) + sd[i11] * fx) * fy;
  };
  // the green screen's glow on the desk and keys becomes neutral screen light
  for (let i = 0; i < d.length; i += 4) {
    const mx2 = Math.max(d[i], d[i + 2]); if (d[i + 1] > mx2 + 6) d[i + 1] = mx2 + 6;
    // and a cyan cast (green and blue both over red) goes back toward neutral
    const r = d[i], g = d[i + 1], bl = d[i + 2];
    if (g > r + 2 && bl <= r) d[i + 1] = r + 2; // olive: green over red, with little blue
    if (g > r + 4 && bl > r) { const lum = 0.3 * r + 0.59 * g + 0.11 * bl; const t = Math.min(1, (g - r) / 40) * 0.85; d[i] = r + (lum - r) * t; d[i + 1] = g + (lum - g) * t; d[i + 2] = bl + (lum - bl) * t; }
  }
  // feathered mask: grow by a pixel so no green fringe is left
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = y * W + x, i = k * 4;
    let m = mask[k];
    if (m < 1) { const nb = Math.max(mask[k - 1] || 0, mask[k + 1] || 0, mask[k - W] || 0, mask[k + W] || 0); m = Math.max(m, nb * 0.85); }
    // despill the photo pixel
    if (d[i + 1] > Math.max(d[i], d[i + 2])) d[i + 1] = Math.max(d[i], d[i + 2]);
    if (m <= 0) continue;
    const w = Hinv[6] * x + Hinv[7] * y + Hinv[8];
    const u = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / w, v = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / w;
    const dim = 0.94; // a screen in a photo is never quite full brightness
    for (let c = 0; c < 3; c++) d[i + c] = sample(u, v, c) * dim * m + d[i + c] * (1 - m);
  }
  cx.putImageData(img, 0, 0);
  return { url: cv.toDataURL('image/png'), corners: Q.map((q) => q.map((v) => Math.round(v))), edges: lines.map((l) => l.count) };
}, b64(photo), b64(shot), orient);
await b.close();
if (res.error) { console.log(res.error); process.exit(1); }
writeFileSync(out, Buffer.from(res.url.split(',')[1], 'base64'));
console.log('corners', JSON.stringify(res.corners), 'edge points', res.edges.join(','));

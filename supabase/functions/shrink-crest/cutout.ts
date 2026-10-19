import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

// Auto-cut: a crest uploaded on a white square / white circle becomes a
// transparent crest, so it sits on any background (web, iOS, Android circles,
// banners). Port of hockey/crests-cutout/cut_crest.py, which cut the 7 league
// crests by hand on 2026-10-13.
//
// The idea: white that touches the image border is background; white that the
// crest's big shapes enclose is design (letters, stripes) and stays. Small
// marks outside the body (a Hebrew club line above a shield) keep their ink but
// lose their white counters. Edges are un-mixed from white, so there is no halo
// on dark backgrounds.
//
// It only acts when the picture clearly IS a crest on white: mostly-white
// border, and the crest left over is a sane share of the picture. A photo, a
// crest on a coloured square, or an upload that is already transparent comes
// back null and is used as-is.

const WHITE_TOL = 40;          // 255 - min(r,g,b) below this = "white"
const MIN_WHITE_BORDER = 0.6;  // share of border pixels that must be white/clear
const MIN_CUT_SHARE = 0.01;    // at least this much opaque white must go, or nothing to do
const MIN_KEEP_SHARE = 0.08;   // the crest must keep at least this much of the frame

/** Returns the trimmed transparent crest, or null when the image isn't a crest on white. */
export function cutWhiteBackground(src: Image): Image | null {
  const w = src.width, h = src.height, n = w * h, s = src.bitmap;
  if (w < 16 || h < 16) return null;

  // Flatten any existing transparency onto white; aw = how far from white (0..1).
  const rgb = new Float32Array(n * 3), aw = new Float32Array(n);
  const white = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const a = s[i * 4 + 3] / 255;
    let mn = 255;
    for (let c = 0; c < 3; c++) {
      const v = s[i * 4 + c] * a + 255 * (1 - a);
      rgb[i * 3 + c] = v; if (v < mn) mn = v;
    }
    aw[i] = (255 - mn) / 255;
    white[i] = 255 - mn < WHITE_TOL ? 1 : 0;
  }

  // Border must be mostly white/clear — otherwise this is not "a crest on white".
  let borderWhite = 0, borderN = 0;
  const onBorder = (x: number, y: number) => { borderN++; if (white[y * w + x]) borderWhite++; };
  for (let x = 0; x < w; x++) { onBorder(x, 0); onBorder(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { onBorder(0, y); onBorder(w - 1, y); }
  if (borderWhite / borderN < MIN_WHITE_BORDER) return null;

  // 1. background = white connected to the border.
  const bg = floodFromBorder(w, h, (i) => white[i] === 1);
  let cutOpaque = 0;
  for (let i = 0; i < n; i++) if (bg[i] && s[i * 4 + 3] > 240) cutOpaque++;
  if (cutOpaque / n < MIN_CUT_SHARE) return null; // already clean (or no white to remove)

  // fg = coloured pixels; drop small specks that touch the border (scan junk).
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = !bg[i] && !white[i] ? 1 : 0;
  let { label, sizes, touches } = components(w, h, fg);
  let total = 0; for (const z of sizes) total += z;
  if (total === 0) return null;
  for (let i = 0; i < n; i++) {
    const l = label[i];
    if (l && touches[l] && sizes[l] < 0.02 * total) fg[i] = 0;
  }
  ({ label, sizes } = components(w, h, fg));
  total = 0; for (const z of sizes) total += z;

  // 2. body = the big shapes with their holes filled → white inside them is design.
  const big = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (label[i] && sizes[label[i]] >= 0.05 * total) big[i] = 1;
  const outside = floodFromBorder(w, h, (i) => big[i] === 0);
  const body = new Uint8Array(n);
  let kept = 0;
  for (let i = 0; i < n; i++) { body[i] = outside[i] ? 0 : 1; if (body[i] || fg[i]) kept++; }
  if (kept / n < MIN_KEEP_SHARE) return null;

  // 3. alpha: body + inner ink solid; everything else colour-to-alpha vs white.
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = body[i] || fg[i] ? 1 : 0;
  const alpha = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const rim = solid[i] && !allNeighbours(w, h, x, y, solid, false);
    if (body[i] || (fg[i] && !rim)) alpha[i] = 1;
    else alpha[i] = bg[i] && aw[i] < 0.06 ? 0 : aw[i];
    // soften the body's own outline (8-neighbour edge)
    if (body[i] && !allNeighbours(w, h, x, y, body, true)) alpha[i] = Math.min(1, aw[i] * 1.6);
  }
  // kill faint noise more than 3px from any ink
  const near = dilate(w, h, solid, 3);
  for (let i = 0; i < n; i++) if (!near[i]) alpha[i] = 0;

  // 4. un-mix white from semi-transparent pixels, then trim to the crest + 2px.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (alpha[y * w + x] * 255 > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
  const out = new Image(x1 - x0 + 1, y1 - y0 + 1), d = out.bitmap;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x, o = ((y - y0) * out.width + (x - x0)) * 4, a = alpha[i];
    for (let c = 0; c < 3; c++) {
      const v = rgb[i * 3 + c];
      d[o + c] = a > 0.01 ? Math.max(0, Math.min(255, (v - (1 - a) * 255) / a)) : v;
    }
    d[o + 3] = Math.round(a * 255);
  }
  return out;
}

/** Pixels reachable from the border through pixels where `pass(i)` holds (4-connected). */
function floodFromBorder(w: number, h: number, pass: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let top = 0;
  const push = (i: number) => { if (!seen[i] && pass(i)) { seen[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const i = stack[--top], x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return seen;
}

/** 8-connected components of `m`: label per pixel, size and border-touch per label (1-based). */
function components(w: number, h: number, m: Uint8Array) {
  const n = w * h, label = new Int32Array(n), stack = new Int32Array(n);
  const sizes: number[] = [0], touches: boolean[] = [false];
  for (let start = 0; start < n; start++) {
    if (!m[start] || label[start]) continue;
    const id = sizes.length; let size = 0, touch = false, top = 0;
    label[start] = id; stack[top++] = start;
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w;
      size++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (m[j] && !label[j]) { label[j] = id; stack[top++] = j; }
      }
    }
    sizes.push(size); touches.push(touch);
  }
  return { label, sizes, touches };
}

/** True when every in-frame neighbour (4- or 8-connected) of (x,y) is set in `m`. */
function allNeighbours(w: number, h: number, x: number, y: number, m: Uint8Array, eight: boolean): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dy) || (!eight && dx && dy)) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (!m[ny * w + nx]) return false;
  }
  return true;
}

/** `m` grown by r pixels (square neighbourhood). */
function dilate(w: number, h: number, m: Uint8Array, r: number): Uint8Array {
  let cur = m;
  for (let k = 0; k < r; k++) {
    const nxt = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (cur[y * w + x]) { nxt[y * w + x] = 1; continue; }
      outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && cur[ny * w + nx]) { nxt[y * w + x] = 1; break outer; }
      }
    }
    cur = nxt;
  }
  return cur;
}

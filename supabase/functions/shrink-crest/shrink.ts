import { decode, Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { cutWhiteBackground } from "./cutout.ts";

export const MAX_SIDE = 256;
/** Cutting runs on at most this size — enough for clean edges, cheap on edge-function CPU. */
const CUT_SIDE = 512;

/** Area-average downscale (premultiplied alpha), so edges stay smooth — imagescript only does nearest-neighbour. */
export function downscale(src: Image, w: number, h: number): Image {
  const sw = src.width, sh = src.height, s = src.bitmap;
  const out = new Image(w, h), d = out.bitmap;
  const fx = sw / w, fy = sh / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    for (let x = 0; x < w; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.min(Math.ceil(y1), sh); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.min(Math.ceil(x1), sw); sx++) {
          const wgt = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const i = (sy * sw + sx) * 4, al = s[i + 3] * wgt;
          r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; area += wgt;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; }
      d[o + 3] = a / area;
    }
  }
  return out;
}

function fit(img: Image, side: number): Image {
  const k = Math.min(1, side / Math.max(img.width, img.height));
  return k < 1 ? downscale(img, Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k))) : img;
}

/**
 * Bytes → a crest no larger than MAX_SIDE, its white background cut away when it
 * has one (see cutout.ts): JPEG when fully opaque (smallest), PNG otherwise.
 * Null = nothing to do (already small and nothing to cut).
 */
export async function shrinkCrest(bytes: Uint8Array): Promise<{ data: Uint8Array; ext: "jpg" | "png"; type: string; cut: boolean } | null> {
  const img = await decode(bytes);
  if (!(img instanceof Image)) throw new Error("not a still image");
  const cutout = cutWhiteBackground(fit(img, CUT_SIDE));
  if (!cutout && Math.max(img.width, img.height) <= MAX_SIDE && bytes.length <= 80_000) return null;
  const small = fit(cutout ?? img, MAX_SIDE);
  let opaque = true;
  for (let i = 3; i < small.bitmap.length; i += 4) if (small.bitmap[i] < 255) { opaque = false; break; }
  return opaque
    ? { data: await small.encodeJPEG(90), ext: "jpg", type: "image/jpeg", cut: !!cutout }
    : { data: await small.encode(9), ext: "png", type: "image/png", cut: !!cutout };
}

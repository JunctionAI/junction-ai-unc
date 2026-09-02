/* Pixel comparison for the parity captures.

   Decodes both PNGs with the pngjs that ships inside @playwright/test (playwright-core's
   utilsBundle) and runs a pixelmatch-style YIQ colour delta over every pixel of the union
   canvas. Pixels present in only one image (different page heights) count as differences.
   Writes a diff image: greyed-out base with differing pixels painted red. */

import * as fs from "node:fs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PNG } = require("playwright-core/lib/utilsBundle") as {
  PNG: {
    new (opts: { width: number; height: number }): PngImage;
    sync: { read: (buf: Buffer) => PngImage; write: (png: PngImage) => Buffer };
  };
};
interface PngImage {
  width: number;
  height: number;
  data: Buffer;
}

export interface CompareResult {
  width: number;
  height: number;
  protoSize: { width: number; height: number };
  portSize: { width: number; height: number };
  totalPixels: number;
  diffPixels: number;
  /** Pixels that differ only because one image is taller/wider than the other. */
  sizeOnlyPixels: number;
  diffPct: number;
  /** Diff % restricted to the overlapping region (isolates layout drift from height drift). */
  overlapDiffPct: number;
}

/* pixelmatch's colour delta (YIQ, NTSC weights). Max value 35215. */
function rgb2y(r: number, g: number, b: number) {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
}
function rgb2i(r: number, g: number, b: number) {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
}
function rgb2q(r: number, g: number, b: number) {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
}
function colorDelta(a: Buffer, ai: number, b: Buffer, bi: number): number {
  let r1 = a[ai], g1 = a[ai + 1], b1 = a[ai + 2], a1 = a[ai + 3];
  let r2 = b[bi], g2 = b[bi + 1], b2 = b[bi + 2], a2 = b[bi + 3];
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;
  if (a1 < 255) {
    a1 /= 255;
    r1 = 255 + (r1 - 255) * a1;
    g1 = 255 + (g1 - 255) * a1;
    b1 = 255 + (b1 - 255) * a1;
  }
  if (a2 < 255) {
    a2 /= 255;
    r2 = 255 + (r2 - 255) * a2;
    g2 = 255 + (g2 - 255) * a2;
    b2 = 255 + (b2 - 255) * a2;
  }
  const y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2);
  const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2);
  const q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);
  return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
}

export function comparePngs(protoPath: string, portPath: string, diffPath: string, threshold = 0.1): CompareResult {
  const a = PNG.sync.read(fs.readFileSync(protoPath));
  const b = PNG.sync.read(fs.readFileSync(portPath));
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const out = new PNG({ width, height });
  const maxDelta = 35215 * threshold * threshold;

  let diff = 0;
  let sizeOnly = 0;
  let overlapDiff = 0;
  const overlapW = Math.min(a.width, b.width);
  const overlapH = Math.min(a.height, b.height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oi = (y * width + x) * 4;
      const inA = x < a.width && y < a.height;
      const inB = x < b.width && y < b.height;
      if (inA && inB) {
        const ai = (y * a.width + x) * 4;
        const bi = (y * b.width + x) * 4;
        const d = colorDelta(a.data, ai, b.data, bi);
        if (d > maxDelta) {
          diff++;
          overlapDiff++;
          out.data[oi] = 255;
          out.data[oi + 1] = 0;
          out.data[oi + 2] = 0;
          out.data[oi + 3] = 255;
        } else {
          // greyed base (from the port) so the red reads against context
          const g = Math.round(255 - (255 - rgb2y(b.data[bi], b.data[bi + 1], b.data[bi + 2])) * 0.1);
          out.data[oi] = g;
          out.data[oi + 1] = g;
          out.data[oi + 2] = g;
          out.data[oi + 3] = 255;
        }
      } else {
        diff++;
        sizeOnly++;
        out.data[oi] = 255;
        out.data[oi + 1] = 200;
        out.data[oi + 2] = 120;
        out.data[oi + 3] = 255;
      }
    }
  }
  fs.writeFileSync(diffPath, PNG.sync.write(out));
  const total = width * height;
  const overlapTotal = Math.max(1, overlapW * overlapH);
  return {
    width,
    height,
    protoSize: { width: a.width, height: a.height },
    portSize: { width: b.width, height: b.height },
    totalPixels: total,
    diffPixels: diff,
    sizeOnlyPixels: sizeOnly,
    diffPct: (diff / total) * 100,
    overlapDiffPct: (overlapDiff / overlapTotal) * 100,
  };
}

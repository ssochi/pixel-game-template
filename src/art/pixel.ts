/**
 * Low-level pixel canvas used by every asset baker.
 *
 * Everything is authored into a PixelBuffer (a raw RGBA byte array) with
 * integer coordinates, then flattened once into an HTMLCanvasElement that the
 * renderer blits. No sub-pixel drawing ever reaches the screen, which is what
 * keeps the art crisp when the whole frame is upscaled with nearest-neighbour.
 */

import { ALL_COLORS, R, type Ramp } from './palette';

export type RGBA = [number, number, number, number];

/** `#rgb`, `#rrggbb` or `#rrggbbaa` -> RGBA tuple. */
export function hex(h: string, alpha = 255): RGBA {
  let s = h.replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = s.length >= 8 ? parseInt(s.slice(6, 8), 16) : alpha;
  return [r, g, b, a];
}

export function rgba(c: RGBA, a: number): RGBA {
  return [c[0], c[1], c[2], Math.round(a)];
}

// ---------------------------------------------------------------------------
// Palette-aware colour maths
// ---------------------------------------------------------------------------

const key = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

/** packed rgb -> which ramp it came from and at which step. */
const RAMP_INDEX = new Map<number, { ramp: Ramp; i: number }>();
for (const ramp of Object.values(R)) {
  ramp.forEach((c, i) => {
    const k = key(c[0], c[1], c[2]);
    if (!RAMP_INDEX.has(k)) RAMP_INDEX.set(k, { ramp, i });
  });
}

/**
 * Step along the colour's own ramp instead of fading it towards black/white.
 *
 * This is the whole reason shadows here don't go muddy: `shade(green, -0.4)`
 * lands on the ramp's cool, hue-shifted dark green rather than on a desaturated
 * grey-green. Colours that aren't on the palette (mid-blend results) fall back
 * to a plain lighten/darken and get snapped later by `quantize`.
 */
export function shade(c: RGBA, t: number): RGBA {
  const found = RAMP_INDEX.get(key(c[0], c[1], c[2]));
  if (found) {
    const step = Math.round(t * 3.2);
    const i = Math.max(0, Math.min(found.ramp.length - 1, found.i + step));
    const out = found.ramp[i];
    return [out[0], out[1], out[2], c[3]];
  }
  if (t >= 0) {
    return [
      Math.round(c[0] + (255 - c[0]) * t),
      Math.round(c[1] + (255 - c[1]) * t),
      Math.round(c[2] + (255 - c[2]) * t),
      c[3],
    ];
  }
  const k = 1 + t;
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k), c[3]];
}

/** 4x4 ordered dither threshold — the retro way to blend two ramp steps. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function bayer(x: number, y: number): number {
  return (BAYER[y & 3][x & 3] + 0.5) / 16;
}

/**
 * Sample a ramp at a continuous position, dithering across the two nearest
 * steps. Use this anywhere a gradient is wanted — never `mix()`.
 */
export function rampPick(ramp: Ramp, t: number, x: number, y: number): RGBA {
  const f = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  let i = Math.floor(f);
  if (f - i > bayer(x, y)) i++;
  return ramp[Math.max(0, Math.min(ramp.length - 1, i))];
}

/**
 * Like `rampPick`, but the ramp steps hold as *flat plateaus* and only the
 * narrow band where two steps meet gets dithered.
 *
 * Dithering everywhere turns a large surface into a uniform screen-door
 * texture. Flat areas next to textured ones is what makes ground read as
 * ground — the negative space is doing as much work as the detail.
 */
export function rampBand(ramp: Ramp, t: number, x: number, y: number, softness = 0.42): RGBA {
  const f = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  let i = Math.floor(f);
  const frac = f - i;
  const lo = (1 - softness) / 2;
  const hi = 1 - lo;
  if (frac > hi) i++;
  else if (frac > lo && bayer(x, y) < (frac - lo) / softness) i++;
  return ramp[Math.max(0, Math.min(ramp.length - 1, i))];
}

const qcache = new Map<number, RGBA>();

/** Nearest palette swatch, using the "redmean" approximation of perceptual distance. */
export function quantizeColor(r: number, g: number, b: number): RGBA {
  const k = key(r, g, b);
  const hit = qcache.get(k);
  if (hit) return hit;
  let best = ALL_COLORS[0];
  let bestD = Infinity;
  for (const c of ALL_COLORS) {
    const rm = (c[0] + r) * 0.5;
    const dr = c[0] - r;
    const dg = c[1] - g;
    const db = c[2] - b;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  qcache.set(k, best);
  return best;
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

export class PixelBuffer {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;

  constructor(w: number, h: number) {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
    this.data = new Uint8ClampedArray(this.w * this.h * 4);
  }

  clone(): PixelBuffer {
    const b = new PixelBuffer(this.w, this.h);
    b.data.set(this.data);
    return b;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Hard write (replaces alpha). */
  set(x: number, y: number, c: RGBA): void {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  /** Source-over blend. */
  blend(x: number, y: number, c: RGBA): void {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    const a = c[3] / 255;
    if (a <= 0) return;
    if (a >= 1) return this.set(x, y, c);
    const i = (y * this.w + x) * 4;
    const da = this.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    this.data[i] = (c[0] * a + this.data[i] * da * (1 - a)) / oa;
    this.data[i + 1] = (c[1] * a + this.data[i + 1] * da * (1 - a)) / oa;
    this.data[i + 2] = (c[2] * a + this.data[i + 2] * da * (1 - a)) / oa;
    this.data[i + 3] = oa * 255;
  }

  get(x: number, y: number): RGBA {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  alphaAt(x: number, y: number): number {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  clear(): void {
    this.data.fill(0);
  }

  fill(c: RGBA): void {
    this.fillRect(0, 0, this.w, this.h, c);
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    x |= 0;
    y |= 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.blend(i, j, c);
  }

  strokeRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    this.hline(x, x + w - 1, y, c);
    this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y, y + h - 1, c);
    this.vline(x + w - 1, y, y + h - 1, c);
  }

  hline(x0: number, x1: number, y: number, c: RGBA): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = x0 | 0; x <= (x1 | 0); x++) this.blend(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: RGBA): void {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = y0 | 0; y <= (y1 | 0); y++) this.blend(x, y, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.blend(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /**
   * Axis-aligned ellipse, rasterised the way pixel artists draw circles.
   *
   * Testing `(dx/r)^2 + (dy/r)^2 <= 1` against pixel *corners* pinches the top
   * and bottom of a circle down to a single pixel — the classic jaggy dome that
   * makes procedural blobs look wrong. Testing against pixel *centres* with the
   * radius pushed out by half a pixel produces the canonical run lengths
   * instead: a radius-4 circle comes out 5,7,9,9,9,9,9,7,5 wide, which is
   * exactly the circle a person would draw by hand.
   */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA, filled = true): void {
    if (rx <= 0 || ry <= 0) return;
    // Very small radii need a smaller bias or they square off.
    const ex = rx + (rx < 1.6 ? 0.2 : 0.5);
    const ey = ry + (ry < 1.6 ? 0.2 : 0.5);
    for (let y = Math.floor(cy - ey); y <= Math.ceil(cy + ey); y++) {
      for (let x = Math.floor(cx - ex); x <= Math.ceil(cx + ex); x++) {
        const dx = (x - cx) / ex;
        const dy = (y - cy) / ey;
        const d = dx * dx + dy * dy;
        if (d <= 1.0) {
          if (filled) this.blend(x, y, c);
          else if (d > 0.42) this.blend(x, y, c);
        }
      }
    }
  }

  /** Thick line with round caps — the workhorse for limbs, branches, planks. */
  capsule(x0: number, y0: number, x1: number, y1: number, r: number, c: RGBA): void {
    const minX = Math.floor(Math.min(x0, x1) - r - 1);
    const maxX = Math.ceil(Math.max(x0, x1) + r + 1);
    const minY = Math.floor(Math.min(y0, y1) - r - 1);
    const maxY = Math.ceil(Math.max(y0, y1) + r + 1);
    const vx = x1 - x0;
    const vy = y1 - y0;
    const len2 = vx * vx + vy * vy;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let t = len2 === 0 ? 0 : ((x - x0) * vx + (y - y0) * vy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = x0 + vx * t;
        const py = y0 + vy * t;
        const d = Math.hypot(x - px, y - py);
        // Same half-pixel bias as `ellipse`, so limb caps stay round.
        if (d <= r + (r < 1.6 ? 0.2 : 0.5)) this.blend(x, y, c);
      }
    }
  }

  /** Blit another buffer, optionally mirrored / tinted / faded. */
  blit(
    src: PixelBuffer,
    dx: number,
    dy: number,
    opts: { flipX?: boolean; flipY?: boolean; alpha?: number; tint?: RGBA; tintAmount?: number } = {},
  ): void {
    const { flipX = false, flipY = false, alpha = 1, tint, tintAmount = 0 } = opts;
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const sx = flipX ? src.w - 1 - x : x;
        const sy = flipY ? src.h - 1 - y : y;
        const c = src.get(sx, sy);
        if (c[3] === 0) continue;
        const out: RGBA = tint && tintAmount > 0 ? mix(c, [tint[0], tint[1], tint[2], c[3]], tintAmount) : c;
        this.blend(dx + x, dy + y, [out[0], out[1], out[2], out[3] * alpha]);
      }
    }
  }

  /**
   * Nearest-neighbour rotate + scale blit around a pivot. Used for the death
   * animation (falling over) and for wind-swayed foliage.
   */
  blitTransformed(
    src: PixelBuffer,
    cx: number,
    cy: number,
    opts: {
      angle?: number;
      scaleX?: number;
      scaleY?: number;
      pivotX?: number;
      pivotY?: number;
      alpha?: number;
      tint?: RGBA;
      tintAmount?: number;
    } = {},
  ): void {
    const {
      angle = 0,
      scaleX = 1,
      scaleY = 1,
      pivotX = src.w / 2,
      pivotY = src.h / 2,
      alpha = 1,
      tint,
      tintAmount = 0,
    } = opts;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Destination bounds: transform the four corners.
    const corners = [
      [-pivotX, -pivotY],
      [src.w - pivotX, -pivotY],
      [-pivotX, src.h - pivotY],
      [src.w - pivotX, src.h - pivotY],
    ].map(([x, y]) => {
      const sx = x * scaleX;
      const sy = y * scaleY;
      return [sx * cos - sy * sin, sx * sin + sy * cos];
    });
    const minX = Math.floor(cx + Math.min(...corners.map((p) => p[0]))) - 1;
    const maxX = Math.ceil(cx + Math.max(...corners.map((p) => p[0]))) + 1;
    const minY = Math.floor(cy + Math.min(...corners.map((p) => p[1]))) - 1;
    const maxY = Math.ceil(cy + Math.max(...corners.map((p) => p[1]))) + 1;
    const isx = scaleX === 0 ? 0 : 1 / scaleX;
    const isy = scaleY === 0 ? 0 : 1 / scaleY;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const rx = x - cx;
        const ry = y - cy;
        const ux = (rx * cos + ry * sin) * isx + pivotX;
        const uy = (-rx * sin + ry * cos) * isy + pivotY;
        const sx = Math.floor(ux);
        const sy = Math.floor(uy);
        if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
        const c = src.get(sx, sy);
        if (c[3] === 0) continue;
        const out: RGBA = tint && tintAmount > 0 ? mix(c, [tint[0], tint[1], tint[2], c[3]], tintAmount) : c;
        this.blend(x, y, [out[0], out[1], out[2], out[3] * alpha]);
      }
    }
  }

  /**
   * Wrap every opaque cluster in a 1px outline. Applied once per sprite so the
   * whole asset set shares a single, consistent silhouette treatment.
   */
  outline(color: RGBA, diagonal = false): void {
    const src = this.clone();
    const n: [number, number][] = diagonal
      ? [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]
      : [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src.alphaAt(x, y) > 8) continue;
        let touch = false;
        for (const [ox, oy] of n) {
          if (src.alphaAt(x + ox, y + oy) > 128) {
            touch = true;
            break;
          }
        }
        if (touch) this.set(x, y, color);
      }
    }
  }

  /**
   * Snap every pixel onto the palette.
   *
   * Blending and anti-aliased shape drawing invent hundreds of near-identical
   * colours; at 1px they read as blur rather than as detail. Running this over
   * a finished sprite is what enforces "a few colours, each with its own
   * identity" no matter how the sprite was drawn. Alpha is left alone, but
   * partial alpha is snapped to a 3-step ladder so edges stay crisp.
   */
  quantize(): void {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;
      const c = quantizeColor(d[i], d[i + 1], d[i + 2]);
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = a < 40 ? 0 : a < 150 ? 128 : 255;
    }
  }

  /**
   * Selective outline ("sel-out").
   *
   * A single flat black key line around everything flattens a sprite and makes
   * the whole set look stamped out. Instead the outline borrows the hue of the
   * pixel it hugs and darkens it along that colour's ramp, and the top-left
   * edges — the ones facing the key light — get a lighter line than the
   * bottom-right ones.
   */
  selOutline(dark = 0.78, light = 0.5): void {
    const src = this.clone();
    const ink = R.night[0];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src.alphaAt(x, y) > 8) continue;
        // Which side of the shape are we on?
        const below = src.alphaAt(x, y + 1) > 128;
        const right = src.alphaAt(x + 1, y) > 128;
        const above = src.alphaAt(x, y - 1) > 128;
        const leftN = src.alphaAt(x - 1, y) > 128;
        if (!below && !right && !above && !leftN) continue;
        const n = below
          ? src.get(x, y + 1)
          : right
            ? src.get(x + 1, y)
            : above
              ? src.get(x, y - 1)
              : src.get(x - 1, y);
        // Lit side = the shape is below/right of us, i.e. we hug its top-left.
        const lit = below || right;
        const k = lit ? light : dark;
        this.set(x, y, [
          Math.round(n[0] + (ink[0] - n[0]) * k),
          Math.round(n[1] + (ink[1] - n[1]) * k),
          Math.round(n[2] + (ink[2] - n[2]) * k),
          255,
        ]);
      }
    }
  }

  /** Brighten the top edge of every opaque cluster (cheap fake rim light). */
  rimLight(color: RGBA, amount = 0.35, from: [number, number] = [0, -1]): void {
    const src = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const a = src.alphaAt(x, y);
        if (a < 200) continue;
        if (src.alphaAt(x + from[0], y + from[1]) > 100) continue;
        const c = src.get(x, y);
        this.set(x, y, mix(c, [color[0], color[1], color[2], c[3]], amount));
      }
    }
  }

  /** Drop a soft elliptical ground shadow (drawn under everything else). */
  groundShadow(cx: number, cy: number, rx: number, ry: number, strength = 90): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        this.blend(x, y, [8, 6, 14, strength * (1 - d * 0.55)]);
      }
    }
  }

  /** Trim fully transparent border rows/columns. Returns offset applied. */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let minX = this.w;
    let minY = this.h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alphaAt(x, y) > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

/**
 * Parse a string-art sprite. Handy for small hand-authored items where exact
 * pixel placement matters more than parametric shapes.
 */
export function parseArt(rows: string[], map: Record<string, RGBA>): PixelBuffer {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const buf = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const c = map[ch];
      if (c) buf.set(x, y, c);
    }
  }
  return buf;
}

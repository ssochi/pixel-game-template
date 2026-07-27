/**
 * Animated river surface.
 *
 * The first version drove the whole surface from one global sine field, which
 * produced smooth concentric contour lines — it read as a topographic map, not
 * as water. Hand-drawn pixel water is not a gradient at all: it is a few flat
 * depth bands with **discrete wave strokes** scattered over them, and the
 * strokes scroll downstream. So that is how this is built now:
 *
 *   1. flat depth bands (3 values, dithered only at their boundaries)
 *   2. two layers of dashed wave strokes on scrolling jittered lattices,
 *      moving at different speeds so the surface has parallax
 *   3. sparkle clusters on the fastest water
 *   4. a lacy shoreline built from the same lattice trick, plus a hard
 *      waterline pixel and a dark band where the bank shades the water
 *   5. foam rings and V-wakes around obstacles
 *
 * Everything is a lattice/hash lookup rather than a continuous function, which
 * is what keeps the marks discrete instead of smearing into contours.
 */
import { R } from '../art/palette';
import { hash2 } from '../engine/rng';
import { riverCenter, riverHalf } from './terrain';

/**
 * Six steps: the darkest three are the water body, 4 is a bright crest and 5
 * is foam. Taken straight from the shared palette.
 */
const RAMP: [number, number, number][] = [
  [R.water[0][0], R.water[0][1], R.water[0][2]],
  [R.water[1][0], R.water[1][1], R.water[1][2]],
  [R.water[2][0], R.water[2][1], R.water[2][2]],
  [R.water[3][0], R.water[3][1], R.water[3][2]],
  [R.water[4][0], R.water[4][1], R.water[4][2]],
  [R.paper[3][0], R.paper[3][1], R.paper[3][2]],
];

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((r) => r.map((v) => (v + 0.5) / 16));

export interface WaterObstacle {
  x: number;
  y: number;
  r: number;
}

/** One layer of scrolling dashes. */
interface StrokeLayer {
  /** Vertical spacing between rows of dashes. */
  rowH: number;
  /** Horizontal spacing between dash slots. */
  cellW: number;
  /** Rows scroll downstream this many px per second. */
  speed: number;
  /** Fraction of slots that actually carry a dash. */
  density: number;
  /** Dash length range. */
  minLen: number;
  maxLen: number;
  /** Ramp step written by this layer. */
  step: number;
  seed: number;
}

const LAYERS: StrokeLayer[] = [
  // Long slow troughs: the large-scale structure of the surface.
  { rowH: 6, cellW: 22, speed: 11, density: 0.62, minLen: 8, maxLen: 18, step: 1, seed: 11 },
  // Crests riding on top, faster. One ramp step up from the body colour — a
  // white dash here reads as a scratch, not as water.
  { rowH: 5, cellW: 16, speed: 21, density: 0.6, minLen: 5, maxLen: 13, step: 3, seed: 29 },
  // Rare bright flecks, fastest. These are the only near-white marks on the
  // open water, and they are two or three pixels long at most.
  { rowH: 9, cellW: 34, speed: 38, density: 0.16, minLen: 2, maxLen: 3, step: 4, seed: 47 },
];

export class River {
  private img: ImageData | null = null;
  private buf32: Uint32Array | null = null;
  private surface: HTMLCanvasElement | null = null;
  private sctx: CanvasRenderingContext2D | null = null;
  readonly obstacles: WaterObstacle[] = [];

  private ensure(w: number, h: number): void {
    if (this.img && this.img.width === w && this.img.height === h) return;
    this.surface = document.createElement('canvas');
    this.surface.width = w;
    this.surface.height = h;
    this.sctx = this.surface.getContext('2d', { willReadFrequently: true })!;
    this.img = this.sctx.createImageData(w, h);
    this.buf32 = new Uint32Array(this.img.data.buffer);
  }

  /**
   * Is (wx, wy) inside a dash of this layer?
   *
   * The lattice scrolls downstream and each row is offset by a per-row hash, so
   * dashes never line up into columns. `lateral` (0 at the bank, 1 mid-stream)
   * speeds up the middle of the channel — a river does not move as one sheet.
   */
  private inStroke(L: StrokeLayer, wx: number, wy: number, t: number): boolean {
    // The scroll must depend on time alone. Making it a function of x (to fake
    // a faster mid-channel) shears the horizontal rows into diagonals, and the
    // surface ends up looking like it has been scratched with a fork.
    const scroll = t * L.speed;
    const fy = wy + scroll;
    const row = Math.floor(fy / L.rowH);
    // Only the top pixel row of each band carries the dash: a 1px mark reads as
    // a wave line, a 2px one reads as a stripe.
    if (Math.floor(fy) - row * L.rowH !== 0) return false;
    const rowShift = hash2(row, L.seed) * L.cellW;
    const cx = Math.floor((wx + rowShift) / L.cellW);
    const h = hash2(cx, row * 3 + L.seed);
    if (h > L.density) return false;
    const len = L.minLen + Math.floor(hash2(cx + 7, row + L.seed) * (L.maxLen - L.minLen + 1));
    const start = cx * L.cellW - rowShift + Math.floor(hash2(cx + 31, row) * (L.cellW - len));
    return wx >= start && wx < start + len;
  }

  /** Draw the water covering the camera window. Coordinates are integers. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, time: number): void {
    this.ensure(w, h);
    const px = this.buf32!;
    px.fill(0);

    for (let sy = 0; sy < h; sy++) {
      const wy = sy + camY;
      const cx = riverCenter(wy);
      const half = riverHalf(wy);
      const rowBase = sy * w;
      const x0 = Math.max(0, Math.floor(cx - half - 2 - camX));
      const x1 = Math.min(w - 1, Math.ceil(cx + half + 2 - camX));
      for (let sx = x0; sx <= x1; sx++) {
        const wx = sx + camX;
        const d = Math.abs(wx - cx) - half; // >0 outside
        if (d >= 0) continue;
        const depth = -d;

        // --- 1. flat depth bands ------------------------------------------
        // Two values over most of the channel, with the boundary dithered so
        // it doesn't read as a contour line but the interiors stay flat.
        let step = depth > 26 || (depth > 16 && BAYER[wy & 3][wx & 3] < (depth - 16) / 10) ? 1 : 2;

        // --- 2. scrolling wave strokes ------------------------------------
        for (const L of LAYERS) {
          // Keep the bright flecks off the margins, where they fight the foam.
          if (L.step === 4 && depth < 10) continue;
          if (this.inStroke(L, wx, wy, time)) step = L.step;
        }

        // --- 3. bank shadow -----------------------------------------------
        // Water against a bank reflects the bank rather than the sky, so it
        // sits one step darker. This is what stops the river reading as a flat
        // ribbon laid on the grass.
        if (depth < 8) step = Math.max(0, step - 1);

        // --- 4. shoreline foam --------------------------------------------
        // A lacy, irregular line rather than a uniform band: same lattice
        // trick, keyed on the distance to the bank.
        if (depth < 6) {
          const cell = Math.floor((wy + time * 7) / 4);
          const bite = hash2(cell, Math.floor(wx / 6) + 3);
          const reach = 1.4 + bite * 2.6;
          if (depth < reach) step = 5;
          else if (depth < reach + 1.4 && bite > 0.6) step = 4;
        }

        // --- 5. obstacles: foam ring + downstream V-wake -------------------
        for (const o of this.obstacles) {
          const dx = wx - o.x;
          const dy = wy - o.y;
          const dd = Math.hypot(dx, dy) - o.r;
          if (dd < 2.6 && dd > -1) {
            step = 5;
          } else if (dy > 0 && dy < 34) {
            const spread = o.r * 0.4 + dy * 0.45;
            const edge = Math.abs(Math.abs(dx) - spread);
            if (edge < 1.6 && hash2(Math.floor(wx / 3), Math.floor((wy + time * 30) / 3)) > 0.35) {
              step = dy < 16 ? 5 : 4;
            }
          }
        }

        const c = RAMP[Math.max(0, Math.min(RAMP.length - 1, step))];
        // Shallow margins stay translucent so the baked riverbed shows through.
        const alpha = Math.min(255, 150 + depth * 26);
        px[rowBase + sx] =
          ((alpha & 255) << 24) | ((c[2] & 255) << 16) | ((c[1] & 255) << 8) | (c[0] & 255);
      }
    }

    // putImageData would overwrite the ground instead of blending with it, so
    // the surface goes through an offscreen canvas and is composited normally.
    this.sctx!.putImageData(this.img!, 0, 0);
    ctx.drawImage(this.surface!, 0, 0);
  }
}

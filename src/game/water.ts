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
  /** Ramp step most dashes on this layer write. */
  step: number;
  seed: number;
}

const LAYERS: StrokeLayer[] = [
  // Long slow troughs: the large-scale structure of the surface.
  { rowH: 6, cellW: 22, speed: 11, density: 0.62, step: 1, seed: 11 },
  // Crests riding on top, faster. One ramp step up from the body colour — a
  // white dash here reads as a scratch, not as water.
  { rowH: 5, cellW: 16, speed: 21, density: 0.6, step: 3, seed: 29 },
  // Rare bright flecks, fastest. These are the only near-white marks on the
  // open water, and they are two or three pixels long at most.
  { rowH: 9, cellW: 34, speed: 38, density: 0.16, step: 4, seed: 47 },
];

/** Every dash picks one of these three lengths — a discrete set reads as
 *  hand-scattered strokes, a continuous range collapses into a print-screen
 *  grid of same-ish dots once hundreds of them tile the surface. */
const LEN_CHOICES = [3, 4, 6];
/** Share of dashes rendered 2px thick instead of 1px. */
const THICK_FRAC = 0.08;

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
   * Is (wx, wy) inside a dash of this layer, and if so which ramp step should
   * it write?
   *
   * The lattice scrolls downstream and each row is offset by a per-row hash, so
   * dashes never line up into columns. Every dash is then individually varied
   * by its own lattice hashes — length (3/4/6px), colour (+-1 ramp step off
   * the layer's base), and an 8% chance of being 2px thick — which is what
   * keeps hundreds of them from reading as a uniform halftone grid.
   */
  private dashAt(L: StrokeLayer, wx: number, wy: number, t: number): number | null {
    // The scroll must depend on time alone. Making it a function of x (to fake
    // a faster mid-channel) shears the horizontal rows into diagonals, and the
    // surface ends up looking like it has been scratched with a fork.
    const scroll = t * L.speed;
    const fy = wy + scroll;
    const row = Math.floor(fy / L.rowH);
    const rowOffset = Math.floor(fy) - row * L.rowH;
    // Normally only the top pixel row of each band carries the dash: a 1px
    // mark reads as a wave line. The 2nd row only lights up for the dashes
    // that rolled "thick" below.
    if (rowOffset > 1) return null;

    const rowShift = hash2(row, L.seed) * L.cellW;
    const cx = Math.floor((wx + rowShift) / L.cellW);
    const h = hash2(cx, row * 3 + L.seed);
    if (h > L.density) return null;

    const thick = hash2(cx * 17 + 41, row * 23 + L.seed + 800) < THICK_FRAC;
    if (rowOffset === 1 && !thick) return null;

    const len = LEN_CHOICES[Math.floor(hash2(cx + 7, row + L.seed) * LEN_CHOICES.length)];
    // Jitter the start well past the slot's own width so a dash sometimes
    // spills into a neighbour's territory instead of always sitting mid-slot
    // — that spill is what breaks up the row-to-row column alignment.
    const spill = Math.floor(L.cellW * 0.3);
    const start =
      cx * L.cellW - rowShift - spill + Math.floor(hash2(cx + 31, row) * (L.cellW - len + spill * 2));
    if (wx < start || wx >= start + len) return null;

    const colorH = hash2(cx * 5 + 3, row * 11 + L.seed + 400);
    const step = colorH < 0.33 ? Math.max(0, L.step - 1) : colorH > 0.67 ? Math.min(RAMP.length - 1, L.step + 1) : L.step;
    return step;
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
        // Three plateaus, not two adjacent ramp steps that read as one blue:
        // a bright, cyan-leaning shallow band right off the bank, a mid band
        // across most of the channel, and a dark band at the centre. Each
        // boundary is dithered over ~3px so it reads as an edge, not a ring.
        const SHALLOW_EDGE = 9; // px of bright shallow water off the bank
        const SHALLOW_BAND = 3; // dither width at that boundary
        const DEEP_EDGE = 21; // px where the centre starts reading as dark
        const DEEP_BAND = 3; // dither width at that boundary
        const POOL_EDGE = 22; // deep pools (riverSDF < -POOL_EDGE) go darker still
        const shallowLo = SHALLOW_EDGE - SHALLOW_BAND / 2;
        const shallowHi = SHALLOW_EDGE + SHALLOW_BAND / 2;
        const deepLo = DEEP_EDGE - DEEP_BAND / 2;
        const deepHi = DEEP_EDGE + DEEP_BAND / 2;
        let step: number;
        if (depth < shallowLo) step = 3;
        else if (depth < shallowHi) step = BAYER[wy & 3][wx & 3] < (depth - shallowLo) / SHALLOW_BAND ? 2 : 3;
        else if (depth < deepLo) step = 2;
        else if (depth < deepHi) step = BAYER[wy & 3][wx & 3] < (depth - deepLo) / DEEP_BAND ? 1 : 2;
        else step = 1;
        // Deep pools (mill pond, fishing hole) read one shade darker still.
        if (depth > POOL_EDGE) step = 0;

        // --- 2. scrolling wave strokes ------------------------------------
        for (const L of LAYERS) {
          // Keep the bright flecks off the margins, where they fight the foam.
          if (L.step === 4 && depth < 10) continue;
          const dash = this.dashAt(L, wx, wy, time);
          if (dash !== null) step = dash;
        }

        // --- 3. bank shadow -----------------------------------------------
        // Only right at the physical edge, so the bright shallow band above
        // stays visibly bright — a river does not sit in shadow 10px out.
        if (depth < 4) step = Math.max(0, step - 1);

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

/**
 * Animated river surface.
 *
 * The river is rendered per-pixel every frame (the visible window only, at the
 * game's internal 448x252 resolution) rather than as a tiled sprite, which is
 * what lets the flow bend with the riverbank, foam against the shoreline and
 * break around rocks.
 */
import { fbm } from '../engine/rng';
import { riverCenter, riverHalf } from './terrain';

const NOISE = 128;

/**
 * The surface is quantised to a fixed 6-step ramp and dithered between steps
 * with a Bayer matrix, so it bands like hand-drawn water instead of showing a
 * smooth 24-bit gradient.
 */
const RAMP: [number, number, number][] = [
  [14, 46, 76],
  [22, 68, 104],
  [34, 92, 132],
  [58, 129, 168],
  [104, 178, 205],
  [199, 234, 245],
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

export class River {
  private noise: Float32Array;
  private img: ImageData | null = null;
  private buf32: Uint32Array | null = null;
  private surface: HTMLCanvasElement | null = null;
  private sctx: CanvasRenderingContext2D | null = null;
  readonly obstacles: WaterObstacle[] = [];

  constructor() {
    this.noise = new Float32Array(NOISE * NOISE);
    for (let y = 0; y < NOISE; y++)
      for (let x = 0; x < NOISE; x++) this.noise[y * NOISE + x] = fbm(x * 0.09, y * 0.09, 3);
  }

  private n(x: number, y: number): number {
    const xi = ((x | 0) % NOISE + NOISE) % NOISE;
    const yi = ((y | 0) % NOISE + NOISE) % NOISE;
    return this.noise[yi * NOISE + xi];
  }

  private ensure(w: number, h: number): void {
    if (this.img && this.img.width === w && this.img.height === h) return;
    this.surface = document.createElement('canvas');
    this.surface.width = w;
    this.surface.height = h;
    this.sctx = this.surface.getContext('2d', { willReadFrequently: true })!;
    this.img = this.sctx.createImageData(w, h);
    this.buf32 = new Uint32Array(this.img.data.buffer);
  }

  /** Draw the water covering the camera window. Coordinates are integers. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, time: number): void {
    this.ensure(w, h);
    const px = this.buf32!;
    px.fill(0);

    const flow = time * 26; // downstream scroll in px
    const t = time;

    for (let sy = 0; sy < h; sy++) {
      const wy = sy + camY;
      const cx = riverCenter(wy);
      const half = riverHalf(wy);
      const rowBase = sy * w;
      // Only iterate the span that can possibly be water.
      const x0 = Math.max(0, Math.floor(cx - half - 2 - camX));
      const x1 = Math.min(w - 1, Math.ceil(cx + half + 2 - camX));
      for (let sx = x0; sx <= x1; sx++) {
        const wx = sx + camX;
        const d = Math.abs(wx - cx) - half; // >0 outside
        if (d >= 0) continue;
        const depth = -d;

        // Distance to the nearest in-river obstacle, for foam + wake.
        let obsD = 999;
        let wake = 0;
        for (const o of this.obstacles) {
          const dx = wx - o.x;
          const dy = wy - o.y;
          const dd = Math.hypot(dx, dy) - o.r;
          if (dd < obsD) obsD = dd;
          // A narrow V opening downstream of the rock.
          if (dy > 0 && dy < 30) {
            const spread = o.r * 0.35 + dy * 0.42;
            const edge = Math.abs(Math.abs(dx) - spread);
            if (edge < 2.5) wake = Math.max(wake, (1 - edge / 2.5) * (1 - dy / 30));
          }
        }

        // Surface waves: scrolling downstream, sheared by the bank curvature.
        const lateral = (wx - cx) / half;
        const phase = wy * 0.26 - flow * 0.6 + Math.sin(wx * 0.05 + t * 0.9) * 2.4 + lateral * 2.2;
        const band = Math.sin(phase) * 0.62 + Math.sin(phase * 0.41 + 1.7) * 0.38;
        const swirl = this.n(wx * 0.22 - t * 1.6, wy * 0.22 - flow * 0.3);
        const ripple = this.n(wx * 0.55 + t * 5, wy * 0.55 - flow * 0.9);

        // `v` is a single brightness scalar; the ramp turns it into a colour.
        const depthT = Math.min(1, depth / 26);
        let v = 0.72 - depthT * 0.42;
        v += band * 0.2;
        v += (swirl - 0.5) * 0.34;

        // Thin, fast highlight streaks running with the current.
        const streak = Math.sin(phase * 2.6 + swirl * 5);
        if (streak > 0.86 && depth > 4) v += 0.3;

        let foam = 0;
        // Specular glints riding the crests.
        if (ripple > 0.78 && band > 0.15) foam = (ripple - 0.78) * 3.6;
        // Shore foam: a lacy line hugging the bank.
        const shore = 1 - Math.min(1, depth / 6);
        if (shore > 0) {
          const lace = this.n(wx * 0.65, wy * 0.65 - flow * 0.55);
          foam = Math.max(foam, (shore * shore) * (0.5 + lace * 1.15));
          if (depth < 1.4) foam = 1.2;
        }
        // Obstacle foam ring + the two wake lines trailing downstream.
        if (obsD < 2.4) foam = Math.max(foam, (1 - obsD / 2.4) * 1.2);
        if (wake > 0) {
          const churn = this.n(wx * 0.8, wy * 0.8 - flow * 1.8);
          foam = Math.max(foam, wake * (churn > 0.42 ? 0.9 : 0.25));
        }

        if (foam > 0) v = Math.max(v, 0.82 + Math.min(0.4, foam) * 0.45);

        // Quantise to the ramp, dithering across the two nearest steps.
        const f = Math.max(0, Math.min(1, v)) * (RAMP.length - 1);
        let lvl = Math.floor(f);
        if (f - lvl > BAYER[wy & 3][wx & 3]) lvl++;
        if (lvl > RAMP.length - 1) lvl = RAMP.length - 1;
        const c = RAMP[lvl];

        // Shallow edges stay translucent so the baked riverbed shows through.
        const alpha = Math.min(255, 138 + depth * 26);
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

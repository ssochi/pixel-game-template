/**
 * World terrain: the river's shape is the source of truth for everything else.
 *
 * A signed distance to the river centreline drives the water mask, the sandy
 * bank, the grass falloff and the collision test, so the art and the gameplay
 * can never disagree about where the water is.
 */
import { R } from '../art/palette';
import { PixelBuffer, bayer, rampBand, shade, type RGBA } from '../art/pixel';
import { RNG, fbm, hash2 } from '../engine/rng';

export const WORLD_W = 960;
export const WORLD_H = 640;

export const PLAZA = { x0: 96, y0: 96, x1: 356, y1: 320 };

export function riverCenter(y: number): number {
  return 470 + Math.sin(y * 0.0125) * 96 + Math.sin(y * 0.031 + 1.4) * 26 + Math.sin(y * 0.007) * 40;
}

export function riverHalf(y: number): number {
  return 40 + Math.sin(y * 0.019 + 0.7) * 9 + Math.sin(y * 0.005) * 7;
}

/** Negative inside the water, positive on land; roughly in pixels. */
export function riverSDF(x: number, y: number): number {
  return Math.abs(x - riverCenter(y)) - riverHalf(y);
}

/** Bridge deck (world px) — the only place the river can be crossed. */
export const BRIDGE = (() => {
  const y0 = 292;
  const y1 = 324;
  let maxC = 0;
  let maxH = 0;
  for (let y = y0; y <= y1; y++) {
    maxC = Math.max(maxC, riverCenter(y));
    maxH = Math.max(maxH, riverHalf(y));
  }
  let minC = 1e9;
  for (let y = y0; y <= y1; y++) minC = Math.min(minC, riverCenter(y));
  return { y0, y1, x0: minC - maxH - 26, x1: maxC + maxH + 26, cy: (y0 + y1) / 2 };
})();

export function isWater(x: number, y: number): boolean {
  return riverSDF(x, y) < 0;
}

export function onBridge(x: number, y: number): boolean {
  return y > BRIDGE.y0 && y < BRIDGE.y1 && x > BRIDGE.x0 && x < BRIDGE.x1;
}

/** Movement blocker test used by the player and creatures. */
export function blocksMovement(x: number, y: number): boolean {
  if (x < 8 || y < 8 || x > WORLD_W - 8 || y > WORLD_H - 8) return true;
  if (isWater(x, y) && !onBridge(x, y)) return true;
  return false;
}

const PATH: [number, number][] = [
  [150, 210],
  [250, 240],
  [330, 300],
  [420, 308],
  [560, 308],
  [700, 300],
  [800, 250],
  [880, 180],
];

function distToPath(x: number, y: number): number {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [x0, y0] = PATH[i];
    const [x1, y1] = PATH[i + 1];
    const vx = x1 - x0;
    const vy = y1 - y0;
    const len2 = vx * vx + vy * vy;
    let t = ((x - x0) * vx + (y - y0) * vy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (x0 + vx * t), y - (y0 + vy * t));
    if (d < best) best = d;
  }
  return best;
}

function inPlaza(x: number, y: number): boolean {
  return x > PLAZA.x0 && x < PLAZA.x1 && y > PLAZA.y0 && y < PLAZA.y1;
}

// ---------------------------------------------------------------------------
// Ground painting
//
// The rule that matters here: a texture is made of a few *clusters* repeated in
// a varied distribution, not of per-pixel random noise. Random pixels read as
// TV static and blur the whole surface; a handful of 2-3px motifs scattered on
// a jittered lattice, with bare negative space between them, reads as grass.
// Everything is drawn from ramp steps with Bayer dithering between them, so the
// ground uses about a dozen colours in total.
// ---------------------------------------------------------------------------

type Motif = string[];

/** `l` = light step, `m` = base, `d` = dark step, `.` = leave the ground alone. */
const GRASS_MOTIFS: Motif[] = [
  ['l.l', '.l.'],
  ['.l.', 'l.l'],
  ['ll'],
  ['l', 'l'],
  ['.d.', 'd.d'],
  ['dd'],
];

const DIRT_MOTIFS: Motif[] = [
  ['l.', '.d'],
  ['ll', '.d'],
  ['d'],
  ['dd'],
  ['.l.', 'l.d'],
];

const SAND_MOTIFS: Motif[] = [['ll'], ['l'], ['.d', 'd.'], ['dd']];

function stampMotif(
  buf: PixelBuffer,
  m: Motif,
  x: number,
  y: number,
  light: RGBA,
  base: RGBA,
  dark: RGBA,
  mask: (x: number, y: number) => boolean,
): void {
  for (let j = 0; j < m.length; j++) {
    for (let i = 0; i < m[j].length; i++) {
      const ch = m[j][i];
      if (ch === '.') continue;
      const px = x + i;
      const py = y + j;
      if (!mask(px, py)) continue;
      buf.set(px, py, ch === 'l' ? light : ch === 'd' ? dark : base);
    }
  }
}

/**
 * Scatter motifs on a jittered lattice. Cell size is always larger than the
 * motifs, which is what guarantees clusters never merge into each other — the
 * single most common way a hand-made texture turns into noise.
 */
function scatter(
  buf: PixelBuffer,
  cell: number,
  seed: number,
  motifs: Motif[],
  light: RGBA,
  base: RGBA,
  dark: RGBA,
  density: (x: number, y: number) => number,
  mask: (x: number, y: number) => boolean,
): void {
  const rng = new RNG(seed);
  for (let cy = 0; cy < WORLD_H; cy += cell) {
    for (let cx = 0; cx < WORLD_W; cx += cell) {
      const x = cx + rng.int(0, cell - 3);
      const y = cy + rng.int(0, cell - 3);
      if (!mask(x, y)) continue;
      if (rng.next() > density(x, y)) continue;
      stampMotif(buf, rng.pick(motifs), x, y, light, base, dark, mask);
    }
  }
}

/**
 * Flagstones, not bricks.
 *
 * A perfectly regular offset-brick lattice reads as a *wall* when seen from
 * above — which is exactly what the first version of this floor looked like.
 * Row heights and column widths are jittered per row, corners are knocked off,
 * and the stones only span two values so the floor stays quiet under the props.
 */
function cobble(x: number, y: number): RGBA {
  // Rows of varying height.
  let row = 0;
  let rowTop = 0;
  for (;;) {
    const h = 7 + Math.floor(hash2(row, 77) * 5);
    if (y < rowTop + h) break;
    rowTop += h;
    row++;
  }
  const rowH = 7 + Math.floor(hash2(row, 77) * 5);
  const ly = y - rowTop;

  // Columns of varying width, offset per row.
  const off = Math.floor(hash2(row, 31) * 16);
  let col = 0;
  let colLeft = -off;
  for (;;) {
    const w = 11 + Math.floor(hash2(col, row * 7 + 5) * 8);
    if (x < colLeft + w) break;
    colLeft += w;
    col++;
  }
  const colW = 11 + Math.floor(hash2(col, row * 7 + 5) * 8);
  const lx = x - colLeft;

  const mortar = lx <= 0 || ly <= 0;
  // Knock the corners off so stones look cut rather than tiled.
  const corner = (lx <= 1 && ly <= 1) || (lx >= colW - 2 && ly <= 1) || (lx <= 1 && ly >= rowH - 2);
  if (mortar || corner) return R.stone[0];

  // Kept in the lower half of the ramp on purpose: the floor is the largest
  // surface in the scene, so it has to sit *below* the props in value or every
  // object standing on it loses its silhouette.
  const n = hash2(col * 3 + 1, row * 5 + 2);
  const base = n > 0.55 ? 2 : 1;
  let step = base;
  if (n > 0.94) step = 3;
  if (lx === 1 || ly === 1) step = base + 1;
  else if (lx >= colW - 1 || ly >= rowH - 1) step = base - 1;
  return R.stone[Math.max(0, Math.min(4, step))];
}

/**
 * Bake the whole ground layer once into an offscreen canvas. It never changes
 * at runtime, so the render loop draws it with a single clipped drawImage.
 */
export function bakeGround(): HTMLCanvasElement {
  const buf = new PixelBuffer(WORLD_W, WORLD_H);
  const rng = new RNG(1234);

  const isSand = (x: number, y: number): boolean => {
    const d = riverSDF(x, y);
    return d >= 0 && d < 12 + fbm(x * 0.04, y * 0.04, 2) * 12;
  };
  const isPath = (x: number, y: number): boolean =>
    !inPlaza(x, y) && distToPath(x, y) < 12 + fbm(x * 0.055, y * 0.055, 2) * 9;

  // --- pass 1: flat base tones, dithered between two ramp steps -------------
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const d = riverSDF(x, y);
      let c: RGBA;
      if (d < 0) {
        // Riverbed — visible through the shallows at the edges.
        c = rampBand(R.dirt, 0.25 + fbm(x * 0.06, y * 0.06, 2) * 0.4, x, y);
      } else if (inPlaza(x, y)) {
        c = cobble(x, y);
        // Worn plaza edges break into dirt with a dithered boundary.
        const edge = Math.min(x - PLAZA.x0, PLAZA.x1 - x, y - PLAZA.y0, PLAZA.y1 - y);
        if (edge < 12 && bayer(x, y) < (1 - edge / 12) * fbm(x * 0.12, y * 0.12, 2) * 1.6) {
          c = rampBand(R.dirt, 0.35 + fbm(x * 0.05, y * 0.05, 2) * 0.3, x, y);
        }
      } else if (isSand(x, y)) {
        // Wet sand right at the waterline, dry sand further up.
        c = d < 3 ? R.sand[2] : rampBand(R.sand, 0.5 + fbm(x * 0.05, y * 0.05, 2) * 0.45, x, y);
      } else if (isPath(x, y)) {
        c = rampBand(R.dirt, 0.35 + fbm(x * 0.05, y * 0.05, 2) * 0.35, x, y);
      } else {
        // Broad, slow tonal drift only — two steps of the grass ramp. All the
        // detail comes from the clusters in pass 2.
        const t = fbm(x * 0.018, y * 0.018, 2);
        c = rampBand(R.grass, 0.28 + t * 0.55, x, y, 0.3);
      }
      buf.set(x, y, c);
    }
  }

  // --- pass 2: texture clusters --------------------------------------------
  const onGrass = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && riverSDF(x, y) >= 0 && !inPlaza(x, y) && !isSand(x, y) && !isPath(x, y);
  const onDirt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && riverSDF(x, y) >= 0 && !inPlaza(x, y) && !isSand(x, y) && isPath(x, y);
  const onSand = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && riverSDF(x, y) >= 3 && isSand(x, y);

  // Density varies over large distances so there are lush patches and bare
  // patches instead of an even carpet of detail.
  const grassDensity = (x: number, y: number): number => {
    const t = fbm(x * 0.012 + 90, y * 0.012, 2);
    return Math.max(0, t * 1.75 - 0.2);
  };
  scatter(buf, 7, 11, GRASS_MOTIFS, R.grass[4], R.grass[2], R.grass[1], grassDensity, onGrass);
  scatter(buf, 11, 12, GRASS_MOTIFS, R.leaf[3], R.grass[2], R.grass[0], (x, y) => grassDensity(x, y) * 0.5, onGrass);
  scatter(buf, 8, 21, DIRT_MOTIFS, R.sand[2], R.dirt[2], R.dirt[1], () => 0.5, onDirt);
  scatter(buf, 9, 31, SAND_MOTIFS, R.sand[4], R.sand[3], R.sand[2], () => 0.4, onSand);

  // --- pass 3: a few large-scale features ----------------------------------
  // Cracks in the plaza, and worn dirt patches where the grass thins out.
  for (let i = 0; i < 90; i++) {
    const x = rng.int(0, WORLD_W - 1);
    const y = rng.int(0, WORLD_H - 1);
    if (isWater(x, y)) continue;
    if (inPlaza(x, y)) {
      let px = x;
      let py = y;
      for (let j = 0; j < rng.int(8, 24); j++) {
        if (inPlaza(px, py)) buf.set(px, py, R.stone[1]);
        px += rng.int(-1, 1);
        py += rng.int(0, 1);
      }
    } else if (onGrass(x, y)) {
      // A bare earth patch: dithered edge, so it doesn't look stamped on.
      const rx = rng.range(5, 13);
      const ry = rx * rng.range(0.5, 0.8);
      for (let py = Math.floor(y - ry); py <= y + ry; py++)
        for (let px = Math.floor(x - rx); px <= x + rx; px++) {
          const dx = (px - x) / rx;
          const dy = (py - y) / ry;
          const dd = dx * dx + dy * dy;
          if (dd > 1 || !onGrass(px, py)) continue;
          if (dd > 0.55 && bayer(px, py) < (dd - 0.55) / 0.45) continue;
          buf.set(px, py, rampBand(R.dirt, 0.3 + fbm(px * 0.08, py * 0.08, 2) * 0.3, px, py));
        }
    }
  }

  // Border falloff so the play area reads as an island of interest.
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const edge = Math.min(x, y, WORLD_W - 1 - x, WORLD_H - 1 - y);
      if (edge >= 44) continue;
      const t = 1 - edge / 44;
      // Dithered darkening keeps the vignette on the palette instead of
      // generating a smooth 24-bit gradient.
      const c = buf.get(x, y);
      const steps = t > 0.66 ? 2 : t > 0.3 ? 1 : 0;
      const extra = bayer(x, y) < (t * 3) % 1 ? 1 : 0;
      buf.set(x, y, shade(c, -(steps + extra) * 0.32));
    }
  }
  return buf.toCanvas();
}

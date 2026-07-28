/**
 * World terrain: the river's shape is the source of truth for everything else.
 *
 * A signed distance to the river centreline drives the water mask, the sandy
 * bank, the grass falloff and the collision test, so the art and the gameplay
 * can never disagree about where the water is. The town's roads, market square
 * and field plots are laid out here too, so the ground painting and the prop
 * placement in `scene.ts` read from the same numbers.
 */
import { R } from '../art/palette';
import { PixelBuffer, bayer, rampBand, shade, type RGBA } from '../art/pixel';
import { RNG, fbm, hash2 } from '../engine/rng';

export const WORLD_W = 1440;
export const WORLD_H = 960;

/** Cobbled market square at the centre of town. */
export const PLAZA = { x0: 430, y0: 400, x1: 700, y1: 610 };

export function riverCenter(y: number): number {
  return 1140 + Math.sin(y * 0.0105) * 74 + Math.sin(y * 0.026 + 1.4) * 22 + Math.sin(y * 0.006) * 34;
}

export function riverHalf(y: number): number {
  return 42 + Math.sin(y * 0.017 + 0.7) * 9 + Math.sin(y * 0.004) * 7;
}

/** Negative inside the water, positive on land; roughly in pixels. */
export function riverSDF(x: number, y: number): number {
  return Math.abs(x - riverCenter(y)) - riverHalf(y);
}

/** Bridge deck (world px) — the only place the river can be crossed. */
export const BRIDGE = (() => {
  const y0 = 486;
  const y1 = 522;
  let maxC = 0;
  let maxH = 0;
  let minC = 1e9;
  for (let y = y0; y <= y1; y++) {
    maxC = Math.max(maxC, riverCenter(y));
    maxH = Math.max(maxH, riverHalf(y));
    minC = Math.min(minC, riverCenter(y));
  }
  return { y0, y1, x0: minC - maxH - 28, x1: maxC + maxH + 28, cy: (y0 + y1) / 2 };
})();

/** Where the mill sits: on the west bank, its wheel dipping into the current. */
export const MILL = { x: 0, y: 760 };
MILL.x = riverCenter(MILL.y) - riverHalf(MILL.y) - 34;

export function isWater(x: number, y: number): boolean {
  return riverSDF(x, y) < 0;
}

export function onBridge(x: number, y: number): boolean {
  return y > BRIDGE.y0 && y < BRIDGE.y1 && x > BRIDGE.x0 && x < BRIDGE.x1;
}

/** Movement blocker test used by the player, NPCs and animals. */
export function blocksMovement(x: number, y: number): boolean {
  if (x < 8 || y < 8 || x > WORLD_W - 8 || y > WORLD_H - 8) return true;
  if (isWater(x, y) && !onBridge(x, y)) return true;
  return false;
}

// --- town layout -----------------------------------------------------------

export interface Road {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
}

/**
 * The street network. A single main street running north-south with a market
 * square on it, a high street heading east to the bridge, and lanes serving
 * the outlying farms. Buildings are placed along these in `scene.ts`.
 */
export const ROADS: Road[] = [
  { x0: 565, y0: 90, x1: 565, y1: 900, w: 30 }, // main street
  { x0: 300, y0: 504, x1: 1000, y1: 504, w: 28 }, // high street to the bridge
  { x0: 300, y0: 504, x1: 230, y1: 300, w: 20 }, // lane to the north farm
  { x0: 300, y0: 504, x1: 250, y1: 740, w: 20 }, // lane to the south farm
  { x0: 565, y0: 700, x1: 900, y1: 760, w: 20 }, // mill lane
  { x0: 565, y0: 240, x1: 860, y1: 200, w: 20 }, // chapel lane
];

export function distToRoad(x: number, y: number): number {
  let best = 1e9;
  for (const r of ROADS) {
    const vx = r.x1 - r.x0;
    const vy = r.y1 - r.y0;
    const len2 = vx * vx + vy * vy;
    let t = ((x - r.x0) * vx + (y - r.y0) * vy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (r.x0 + vx * t), y - (r.y0 + vy * t)) - r.w / 2;
    if (d < best) best = d;
  }
  return best;
}

export interface Field {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Furrows run along this axis. */
  vertical: boolean;
  crop: 'wheat' | 'cabbage' | 'fallow';
}

export const FIELDS: Field[] = [
  { x0: 120, y0: 180, x1: 330, y1: 300, vertical: false, crop: 'wheat' },
  { x0: 120, y0: 620, x1: 300, y1: 740, vertical: true, crop: 'cabbage' },
  { x0: 330, y0: 640, x1: 470, y1: 760, vertical: false, crop: 'wheat' },
  { x0: 140, y0: 330, x1: 280, y1: 430, vertical: true, crop: 'fallow' },
];

export function fieldAt(x: number, y: number): Field | null {
  for (const f of FIELDS) if (x > f.x0 && x < f.x1 && y > f.y0 && y < f.y1) return f;
  return null;
}

/** Fenced paddock where the livestock graze. */
export const PADDOCK = { x0: 300, y0: 780, x1: 520, y1: 900 };

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

/** Small pebbles (stone ramp) and shell flecks (paper ramp), scattered
 *  sparsely on the sand — clusters, not an even sprinkle of noise. */
const PEBBLE_MOTIFS: Motif[] = [['d'], ['dd'], ['d.', '.d'], ['ld']];
const SHELL_MOTIFS: Motif[] = [['l'], ['l.', '.l']];

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
    const h = 5 + Math.floor(hash2(row, 77) * 4);
    if (y < rowTop + h) break;
    rowTop += h;
    row++;
  }
  const rowH = 5 + Math.floor(hash2(row, 77) * 4);
  const ly = y - rowTop;

  // Columns of varying width, offset per row.
  const off = Math.floor(hash2(row, 31) * 12);
  let col = 0;
  let colLeft = -off;
  for (;;) {
    const w = 8 + Math.floor(hash2(col, row * 7 + 5) * 6);
    if (x < colLeft + w) break;
    colLeft += w;
    col++;
  }
  const colW = 8 + Math.floor(hash2(col, row * 7 + 5) * 6);
  const lx = x - colLeft;

  // About one slab in ten has broken up or been swallowed by weeds, so the
  // plaza reads as walked-on ground rather than a freshly laid floor. This
  // check runs before the mortar/corner test so a "missing" slab loses its
  // seams too — the whole footprint is gone, not just the paved face.
  if (hash2(col * 13 + 7, row * 17 + 19) < 0.1) {
    const gt = hash2(col * 5 + 1, row * 9 + 3);
    const grassHere = rampBand(R.grass, 0.32 + gt * 0.4, x, y, 0.3);
    // 2px-ish tuft clusters (grouped by a coarse block hash, not per-pixel
    // noise) instead of an even grass fill.
    const tuft = hash2(Math.floor(x / 2), Math.floor(y / 2) + row * 31 + col * 7) > 0.82;
    return tuft ? R.grass[4] : grassHere;
  }

  const mortar = lx <= 0 || ly <= 0;
  // Knock the corners off so stones look cut rather than tiled.
  const corner = (lx <= 1 && ly <= 1) || (lx >= colW - 2 && ly <= 1) || (lx <= 1 && ly >= rowH - 2);
  // Deep neutral seam colour rather than just the darkest stone step — the
  // joints need to read as gaps, not as one more (dark) flagstone.
  if (mortar || corner) return R.night[0];

  // Kept in the lower half of the ramp on purpose: the floor is the largest
  // surface in the scene, so it has to sit *below* the props in value or every
  // object standing on it loses its silhouette. Pushed down one notch further
  // still — stone[1] is now the common case and the highlight step is rare —
  // so the plaza stops being the single brightest surface on screen.
  const n = hash2(col * 3 + 1, row * 5 + 2);
  const base = n > 0.7 ? 2 : 1;
  let step = base;
  if (n > 0.97) step = 3;
  if (lx >= colW - 1 || ly >= rowH - 1) step = Math.max(0, base - 1);
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
  // The broad fbm term already wobbles the verge at a slow, large-scale rate;
  // on top of that a 2px bayer-dithered fringe breaks the edge up pixel by
  // pixel, and a sparse coarse-block hash lets the odd grass clump bite a
  // couple of px into the road itself so the line never reads as ruled.
  const isRoad = (x: number, y: number): boolean => {
    if (inPlaza(x, y)) return false;
    const threshold = 1 + fbm(x * 0.055, y * 0.055, 2) * 7;
    const d = distToRoad(x, y);
    if (d >= threshold + 1) return false;
    if (d < threshold - 1) {
      if (d > threshold - 4) {
        const bx = Math.floor(x / 2);
        const by = Math.floor(y / 2);
        if (hash2(bx * 13 + 5, by * 17 + 9) < 0.05) return false;
      }
      return true;
    }
    return bayer(x, y) < (threshold + 1 - d) / 2;
  };

  /** Nearest road's centreline distance + width + direction (unlike
   *  `distToRoad`, not offset by half the road width) — used to lay wheel
   *  ruts along the middle of the street rather than the edge test above. */
  const nearestRoad = (x: number, y: number): { d: number; dx: number; dy: number } => {
    let best = { d: 1e9, dx: 1, dy: 0 };
    for (const r of ROADS) {
      const vx = r.x1 - r.x0;
      const vy = r.y1 - r.y0;
      const len = Math.hypot(vx, vy) || 1;
      let t = ((x - r.x0) * vx + (y - r.y0) * vy) / (len * len);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (r.x0 + vx * t), y - (r.y0 + vy * t));
      if (d < best.d) best = { d, dx: vx / len, dy: vy / len };
    }
    return best;
  };

  // --- pass 1: flat base tones, dithered between two ramp steps -------------
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const d = riverSDF(x, y);
      const field = fieldAt(x, y);
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
        // Wet sand right at the waterline (1-2px, a full step darker), dry
        // sand further up.
        const dry = rampBand(R.sand, 0.5 + fbm(x * 0.05, y * 0.05, 2) * 0.45, x, y);
        c = d < 2 ? R.sand[1] : dry;
        // Blend into the grass over the outer 2-3px of the band so it doesn't
        // stop in a hard ring — a few sand pixels dither into the turf tone
        // that's actually sitting there, not a random one.
        const sandLimit = 12 + fbm(x * 0.04, y * 0.04, 2) * 12;
        const edgeDist = sandLimit - d;
        if (edgeDist < 3) {
          const gt = fbm(x * 0.018, y * 0.018, 2);
          const grassHere = rampBand(R.grass, 0.28 + gt * 0.55, x, y, 0.3);
          if (bayer(x, y) < (3 - edgeDist) / 3) c = grassHere;
        }
      } else if (isRoad(x, y)) {
        c = rampBand(R.dirt, 0.35 + fbm(x * 0.05, y * 0.05, 2) * 0.35, x, y);
      } else if (field) {
        // Ploughed earth: alternating furrow ridges, with the sunlit side of
        // each ridge one step up the ramp. The regular rhythm is the whole
        // point — it is what reads as "worked land" from above.
        const along = field.vertical ? x : y;
        const phase = along % 7;
        const base = 0.3 + fbm(x * 0.05, y * 0.05, 2) * 0.25;
        c =
          phase === 0
            ? R.dirt[0]
            : phase <= 2
              ? rampBand(R.dirt, base + 0.22, x, y)
              : rampBand(R.dirt, base, x, y);
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
    x >= 0 &&
    y >= 0 &&
    x < WORLD_W &&
    y < WORLD_H &&
    riverSDF(x, y) >= 0 &&
    !inPlaza(x, y) &&
    !isSand(x, y) &&
    !isRoad(x, y) &&
    !fieldAt(x, y);
  const onDirt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && riverSDF(x, y) >= 0 && !inPlaza(x, y) && !isSand(x, y) && isRoad(x, y);
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
  scatter(buf, 13, 41, PEBBLE_MOTIFS, R.stone[3], R.stone[2], R.stone[1], () => 0.3, onSand);
  scatter(buf, 22, 53, SHELL_MOTIFS, R.paper[3], R.paper[3], R.paper[3], () => 0.16, onSand);

  // --- pass 3: a few large-scale features ----------------------------------
  // Cracks in the plaza, and worn dirt patches where the grass thins out.
  for (let i = 0; i < 160; i++) {
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

  // Wheel ruts: a handful of short dark scuffs clustered near the centreline
  // of every road, roughly aligned with it, so the street doesn't read as one
  // flat dirt ribbon.
  for (let i = 0; i < 70; i++) {
    const x = rng.int(0, WORLD_W - 1);
    const y = rng.int(0, WORLD_H - 1);
    if (!isRoad(x, y)) continue;
    const near = nearestRoad(x, y);
    if (near.d > 4) continue;
    const len = rng.int(3, 6);
    for (let j = -Math.floor(len / 2); j <= Math.floor(len / 2); j++) {
      const px = Math.round(x + near.dx * j);
      const py = Math.round(y + near.dy * j);
      if (!isRoad(px, py)) continue;
      buf.set(px, py, R.dirt[0]);
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

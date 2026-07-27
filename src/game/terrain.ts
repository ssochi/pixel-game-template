/**
 * World terrain: the river's shape is the source of truth for everything else.
 *
 * A signed distance to the river centreline drives the water mask, the sandy
 * bank, the grass falloff and the collision test, so the art and the gameplay
 * can never disagree about where the water is.
 */
import { P } from '../art/palette';
import { PixelBuffer, mix, rgba, shade, type RGBA } from '../art/pixel';
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

/** Cobblestone: brick lattice with per-stone tint and mortar gaps. */
function cobble(x: number, y: number): RGBA {
  const row = Math.floor(y / 8);
  const off = (row % 2) * 6;
  const cx = Math.floor((x + off) / 12);
  const lx = (x + off) % 12;
  const ly = y % 8;
  if (lx === 0 || ly === 0) return P.stoneDeep;
  const n = hash2(cx, row);
  let c = mix(P.stoneDark, P.stoneLight, 0.25 + n * 0.55);
  if (lx === 1 || ly === 1) c = shade(c, 0.16);
  if (lx === 11 || ly === 7) c = shade(c, -0.18);
  if (hash2(x, y) > 0.965) c = shade(c, -0.3);
  return c;
}

function grassColor(x: number, y: number): RGBA {
  const n = fbm(x * 0.035, y * 0.035, 3);
  const m = fbm(x * 0.14 + 40, y * 0.14, 2);
  let c = mix(P.leafDeep, P.leaf, 0.3 + n * 0.8);
  if (m > 0.66) c = mix(c, P.leafLight, 0.45);
  if (m < 0.3) c = mix(c, P.leafDeep, 0.5);
  // Individual blades
  const h = hash2(x, y);
  if (h > 0.972) c = mix(c, P.leafLight, 0.7);
  else if (h < 0.02) c = mix(c, P.leafDeep, 0.6);
  return c;
}

function dirtColor(x: number, y: number): RGBA {
  const n = fbm(x * 0.06, y * 0.06, 3);
  let c = mix(P.dirtDark, P.dirt, 0.25 + n * 0.9);
  const h = hash2(x + 7, y + 3);
  if (h > 0.985) c = mix(c, P.sand, 0.55); // pebble
  else if (h < 0.015) c = shade(c, -0.25);
  return c;
}

function sandColor(x: number, y: number): RGBA {
  const n = fbm(x * 0.08, y * 0.08, 2);
  let c = mix(P.sandDark, P.sand, 0.2 + n * 1.0);
  const h = hash2(x + 31, y + 17);
  if (h > 0.98) c = mix(c, P.stoneLight, 0.5);
  return c;
}

/**
 * Bake the whole ground layer once into an offscreen canvas. It never changes
 * at runtime, so the render loop draws it with a single clipped drawImage.
 */
export function bakeGround(): HTMLCanvasElement {
  const buf = new PixelBuffer(WORLD_W, WORLD_H);
  const rng = new RNG(1234);
  for (let y = 0; y < WORLD_H; y++) {
    const cxr = riverCenter(y);
    const half = riverHalf(y);
    for (let x = 0; x < WORLD_W; x++) {
      const d = Math.abs(x - cxr) - half; // >0 on land
      let c: RGBA;
      if (d < 0) {
        // Riverbed — mostly hidden under the animated water, but visible
        // through the shallows at the edges.
        const n = fbm(x * 0.1, y * 0.1, 2);
        c = mix(P.sandDark, P.dirtDark, n);
      } else {
        const bankT = Math.min(1, d / (14 + fbm(x * 0.05, y * 0.05, 2) * 10));
        const pathD = distToPath(x, y);
        const plaza = inPlaza(x, y);
        if (plaza) {
          c = cobble(x, y);
          // Worn edges of the plaza fade into dirt.
          const edge = Math.min(x - PLAZA.x0, PLAZA.x1 - x, y - PLAZA.y0, PLAZA.y1 - y);
          if (edge < 10 && fbm(x * 0.2, y * 0.2, 2) > 0.35 + edge * 0.05) c = dirtColor(x, y);
        } else if (pathD < 13 + fbm(x * 0.09, y * 0.09, 2) * 8) {
          c = dirtColor(x, y);
          const t = pathD / 20;
          if (t > 0.6) c = mix(c, grassColor(x, y), (t - 0.6) / 0.4);
        } else {
          c = grassColor(x, y);
        }
        if (bankT < 1) {
          const s = sandColor(x, y);
          const k = 1 - bankT;
          c = mix(c, s, k * k * 0.95 + 0.05);
        }
      }
      buf.set(x, y, c);
    }
  }

  // Scatter ground decals: cracks in the plaza, pebbles, and dark patches.
  for (let i = 0; i < 220; i++) {
    const x = rng.int(0, WORLD_W - 1);
    const y = rng.int(0, WORLD_H - 1);
    if (isWater(x, y)) continue;
    if (inPlaza(x, y)) {
      let px = x;
      let py = y;
      for (let j = 0; j < rng.int(6, 20); j++) {
        buf.blend(px, py, rgba(P.stoneDeep, 150));
        px += rng.int(-1, 1);
        py += rng.int(0, 1);
      }
    } else if (rng.chance(0.5)) {
      buf.ellipse(x, y, rng.range(2, 6), rng.range(1.4, 3.5), rgba(P.dirtDark, 60));
    } else {
      buf.ellipse(x, y, rng.range(1, 2.4), rng.range(0.8, 1.6), rgba(P.stoneDark, 170));
    }
  }

  // Soft vignette-ish darkening at the map border so the play area reads.
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const edge = Math.min(x, y, WORLD_W - 1 - x, WORLD_H - 1 - y);
      if (edge < 40) buf.blend(x, y, rgba(P.shadow, (1 - edge / 40) * 90));
    }
  }
  return buf.toCanvas();
}

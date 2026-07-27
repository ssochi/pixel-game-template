/**
 * Furniture, architecture and pickups.
 *
 * Anything with a flame, a shimmer or a lid gets a Clip; the rest bake to a
 * single-frame Sheet so the scene can treat every prop identically.
 */
import { PixelBuffer, mix, rgba, shade, type RGBA } from './pixel';
import { P } from './palette';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';
import { RNG, fbm } from '../engine/rng';

function still(b: PixelBuffer, ax: number, ay: number): Sheet {
  return bakeSheet([b], ax, ay);
}

function anim(frames: PixelBuffer[], ax: number, ay: number, fps: number, loop = true): Clip {
  const sheet = bakeSheet(frames, ax, ay);
  return clip(sheet, frames.map((_, i) => i), fps, loop);
}

/** Plank texture helper: horizontal boards with seams and grain. */
function planks(b: PixelBuffer, x: number, y: number, w: number, h: number, seed: number, vertical = false): void {
  const rng = new RNG(seed);
  const step = 4;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const along = vertical ? i : j;
      const t = along % step;
      let c = P.wood;
      if (t === 0) c = P.woodDark;
      else if (t === 1) c = P.woodLight;
      if (rng.chance(0.08)) c = shade(c, -0.15);
      b.set(x + i, y + j, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

export function table(): PixelBuffer {
  const b = new PixelBuffer(34, 26);
  b.groundShadow(17, 23, 15, 3.5, 110);
  // legs
  b.fillRect(4, 14, 3, 8, P.woodDark);
  b.fillRect(27, 14, 3, 8, P.woodDark);
  // top (slight 3/4 perspective: front face + top surface)
  planks(b, 2, 6, 30, 8, 7);
  b.fillRect(2, 14, 30, 3, P.woodDark);
  b.hline(2, 31, 6, P.woodPale);
  b.strokeRect(2, 6, 30, 11, shade(P.woodDark, -0.3));
  // clutter: mug + book
  b.fillRect(8, 8, 3, 4, P.steelDark);
  b.set(11, 9, P.steel);
  b.fillRect(19, 9, 7, 3, P.blood);
  b.hline(19, 25, 9, P.gold);
  b.outline(P.ink);
  return b;
}

export function chair(facing: 1 | -1): PixelBuffer {
  const b = new PixelBuffer(16, 24);
  b.groundShadow(8, 21, 6, 2, 100);
  b.fillRect(3, 12, 2, 8, P.woodDark);
  b.fillRect(11, 12, 2, 8, P.woodDark);
  planks(b, 3, 9, 10, 4, 3);
  const bx = facing === 1 ? 3 : 11;
  b.fillRect(bx, 2, 2, 9, P.wood);
  b.fillRect(bx - (facing === 1 ? 0 : 0), 2, 2, 1, P.woodLight);
  b.fillRect(3, 3, 10, 2, P.wood);
  b.fillRect(3, 6, 10, 2, P.woodDark);
  b.outline(P.ink);
  return b;
}

export function barrel(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(20, 26);
  b.groundShadow(10, 23, 8, 2.5, 120);
  for (let y = 4; y < 23; y++) {
    const t = (y - 4) / 19;
    const bulge = Math.sin(t * Math.PI) * 1.6;
    const x0 = Math.round(3 - bulge);
    const x1 = Math.round(16 + bulge);
    for (let x = x0; x <= x1; x++) {
      let c = P.wood;
      if (x <= x0 + 1) c = P.woodLight;
      else if (x >= x1 - 2) c = P.woodDark;
      if ((x - x0) % 4 === 3) c = shade(c, -0.2);
      b.set(x, y, c);
    }
  }
  // Iron bands
  for (const by of [7, 13, 19]) {
    for (let x = 1; x < 19; x++) if (b.alphaAt(x, by) > 0) b.set(x, by, P.steelDark);
    for (let x = 1; x < 19; x++) if (b.alphaAt(x, by) > 0 && x < 7) b.set(x, by, P.steel);
  }
  // Lid
  b.ellipse(10, 4.5, 7.2, 2.6, P.woodDark);
  b.ellipse(10, 4, 6.4, 2.1, P.woodPale);
  for (let i = 0; i < 6; i++) b.set(rng.int(5, 15), 4, P.woodDark);
  b.outline(P.ink);
  b.rimLight(P.woodPale, 0.3);
  return b;
}

export function crate(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(20, 22);
  b.groundShadow(10, 20, 8, 2.5, 120);
  planks(b, 2, 4, 16, 15, seed);
  b.strokeRect(2, 4, 16, 15, P.woodDark);
  b.line(2, 4, 17, 18, P.woodDark);
  b.line(17, 4, 2, 18, P.woodDark);
  b.line(3, 4, 18, 18, P.woodLight);
  for (let i = 0; i < 5; i++) b.set(rng.int(3, 16), rng.int(5, 18), shade(P.woodDark, -0.3));
  b.fillRect(2, 4, 16, 1, P.woodPale);
  b.outline(P.ink);
  return b;
}

export function bookshelf(): PixelBuffer {
  const rng = new RNG(9);
  const b = new PixelBuffer(30, 40);
  b.groundShadow(15, 37, 13, 3, 120);
  b.fillRect(1, 2, 28, 36, P.woodDark);
  b.fillRect(3, 4, 24, 32, shade(P.woodDark, -0.35));
  for (let s = 0; s < 3; s++) {
    const sy = 4 + s * 11;
    b.fillRect(3, sy + 9, 24, 2, P.wood);
    let x = 4;
    while (x < 25) {
      const w = rng.int(2, 4);
      const h = rng.int(6, 9);
      if (x + w > 26) break;
      const col: RGBA = rng.pick([P.blood, P.coat, P.moss, P.gold, P.magicDeep, P.copper]);
      b.fillRect(x, sy + 9 - h, w, h, col);
      b.vline(x, sy + 9 - h, sy + 8, shade(col, 0.3));
      b.set(x + w - 1, sy + 9 - h + 1, P.gold);
      x += w + rng.int(0, 1);
    }
  }
  b.strokeRect(1, 2, 28, 36, P.ink);
  b.fillRect(1, 2, 28, 2, P.wood);
  b.outline(P.ink);
  return b;
}

export function rug(): PixelBuffer {
  const b = new PixelBuffer(40, 28);
  b.ellipse(20, 14, 19, 13, P.bloodDark);
  b.ellipse(20, 14, 17, 11.5, P.blood);
  b.ellipse(20, 14, 13, 8.5, P.goldDark);
  b.ellipse(20, 14, 11.5, 7.5, P.blood);
  b.ellipse(20, 14, 5, 3.5, P.gold);
  b.ellipse(20, 14, 3, 2, P.blood);
  // Fringe
  for (let x = 2; x < 38; x += 3) {
    b.set(x, 1, P.goldDark);
    b.set(x, 26, P.goldDark);
  }
  return b;
}

export function bed(): PixelBuffer {
  const b = new PixelBuffer(26, 40);
  b.groundShadow(13, 37, 11, 3, 110);
  // Frame: headboard at the top, side rails, footboard at the bottom.
  planks(b, 2, 2, 22, 5, 31);
  b.fillRect(2, 6, 22, 32, P.woodDark);
  b.fillRect(2, 6, 2, 32, P.wood);
  b.fillRect(22, 6, 2, 32, P.woodDark);
  planks(b, 2, 34, 22, 4, 33);
  // Mattress + pillow
  b.fillRect(4, 7, 18, 5, shade(P.white, -0.04));
  b.fillRect(5, 8, 16, 3, P.white);
  b.set(6, 9, shade(P.white, -0.14));
  // Blanket with a folded hem and a couple of creases.
  b.fillRect(4, 13, 18, 21, P.coat);
  b.fillRect(4, 13, 18, 3, P.coatLight);
  b.fillRect(4, 16, 18, 1, P.coatDark);
  for (const y of [21, 27]) b.hline(5, 20, y, P.coatDark);
  b.vline(4, 13, 33, P.coatLight);
  b.vline(21, 13, 33, P.coatDark);
  b.outline(P.ink);
  b.rimLight(P.white, 0.2);
  return b;
}

export function sign(): PixelBuffer {
  const b = new PixelBuffer(22, 26);
  b.groundShadow(11, 24, 6, 2, 100);
  b.fillRect(10, 12, 2, 12, P.woodDark);
  planks(b, 2, 4, 18, 10, 12);
  b.strokeRect(2, 4, 18, 10, P.woodDark);
  for (let i = 0; i < 3; i++) b.hline(5, 16 - i * 3, 7 + i * 2, shade(P.woodDark, -0.4));
  b.outline(P.ink);
  return b;
}

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

/** A stone block wall segment, 16 wide with a raised top face. */
export function wallSegment(seed: number, ruined = false): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(16, 28);
  const topH = ruined ? rng.int(6, 12) : 6;
  const bodyTop = topH;
  // Face
  for (let y = bodyTop; y < 28; y++) {
    for (let x = 0; x < 16; x++) {
      const row = Math.floor((y - bodyTop) / 5);
      const offset = row % 2 === 0 ? 0 : 4;
      const bx = (x + offset) % 8;
      let c = P.stone;
      if (fbm(x * 0.4 + seed, y * 0.4, 2) > 0.6) c = P.stoneLight;
      else if (fbm(x * 0.4 + seed, y * 0.4, 2) < 0.38) c = P.stoneDark;
      if ((y - bodyTop) % 5 === 0 || bx === 0) c = P.stoneDeep;
      b.set(x, y, c);
    }
  }
  // Top cap
  b.fillRect(0, bodyTop - 3, 16, 4, P.stoneLight);
  b.hline(0, 15, bodyTop - 3, mix(P.stoneLight, P.white, 0.25));
  b.hline(0, 15, bodyTop, P.stoneDark);
  if (ruined) {
    for (let x = 0; x < 16; x++) {
      const cut = Math.round(fbm(x * 0.5 + seed, 0, 2) * 5);
      for (let y = bodyTop - 3; y < bodyTop - 3 + cut; y++) b.set(x, y, [0, 0, 0, 0]);
    }
    for (let i = 0; i < 6; i++) b.set(rng.int(0, 15), rng.int(bodyTop, 27), P.moss);
  }
  b.outline(P.ink);
  return b;
}

export function pillar(): PixelBuffer {
  const b = new PixelBuffer(18, 44);
  b.groundShadow(9, 41, 8, 2.5, 130);
  b.fillRect(2, 38, 14, 4, P.stoneDark);
  b.fillRect(1, 40, 16, 3, P.stone);
  for (let y = 8; y < 39; y++) {
    for (let x = 4; x < 14; x++) {
      let c = P.stone;
      if (x < 6) c = P.stoneLight;
      else if (x > 11) c = P.stoneDark;
      if ((x - 4) % 3 === 0) c = shade(c, -0.12);
      if (y % 9 === 0) c = P.stoneDeep;
      b.set(x, y, c);
    }
  }
  b.fillRect(2, 4, 14, 5, P.stone);
  b.fillRect(1, 2, 16, 3, P.stoneLight);
  b.hline(1, 16, 2, mix(P.stoneLight, P.white, 0.3));
  b.outline(P.ink);
  return b;
}

export function archDoor(): PixelBuffer {
  const b = new PixelBuffer(40, 48);
  b.groundShadow(20, 45, 17, 3, 130);
  // Stone frame
  b.fillRect(0, 8, 40, 38, P.stone);
  b.ellipse(20, 10, 20, 12, P.stone);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 40; x++) {
      if (b.alphaAt(x, y) < 200) continue;
      const n = fbm(x * 0.35, y * 0.35, 2);
      if (n > 0.62) b.set(x, y, P.stoneLight);
      else if (n < 0.36) b.set(x, y, P.stoneDark);
      if (y % 6 === 0 || (x + (Math.floor(y / 6) % 2) * 5) % 10 === 0) b.blend(x, y, rgba(P.stoneDeep, 130));
    }
  // Doorway
  b.fillRect(11, 16, 18, 30, P.stoneDeep);
  b.ellipse(20, 17, 9, 8, P.stoneDeep);
  // Door leafs
  planks(b, 12, 17, 16, 28, 5, true);
  b.ellipse(20, 18, 8, 7, P.wood);
  for (let y = 17; y < 45; y++)
    for (let x = 12; x < 28; x++)
      if (b.alphaAt(x, y) > 0 && (x - 12) % 4 === 0) b.set(x, y, P.woodDark);
  b.fillRect(12, 24, 16, 2, P.steelDark);
  b.fillRect(12, 36, 16, 2, P.steelDark);
  b.ellipse(24, 31, 1.6, 1.6, P.gold);
  b.outline(P.ink);
  return b;
}

export function fence(): PixelBuffer {
  const b = new PixelBuffer(16, 20);
  b.groundShadow(8, 18, 7, 2, 90);
  b.fillRect(2, 4, 3, 14, P.woodDark);
  b.fillRect(11, 4, 3, 14, P.woodDark);
  b.fillRect(2, 4, 1, 14, P.wood);
  b.fillRect(11, 4, 1, 14, P.wood);
  b.fillRect(0, 7, 16, 2, P.wood);
  b.fillRect(0, 13, 16, 2, P.wood);
  b.hline(0, 15, 7, P.woodLight);
  b.hline(0, 15, 13, P.woodLight);
  b.outline(P.ink);
  return b;
}

/** Bridge deck tile — laid in a row across the river. */
export function bridgeTile(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(16, 16);
  planks(b, 0, 0, 16, 16, seed, true);
  for (let i = 0; i < 6; i++) b.set(rng.int(0, 15), rng.int(0, 15), shade(P.woodDark, -0.25));
  b.hline(0, 15, 0, rgba(P.shadow, 60));
  return b;
}

export function bridgeRail(): PixelBuffer {
  const b = new PixelBuffer(16, 14);
  b.fillRect(0, 8, 16, 3, P.woodDark);
  b.fillRect(0, 8, 16, 1, P.wood);
  b.fillRect(2, 2, 3, 10, P.wood);
  b.fillRect(11, 2, 3, 10, P.wood);
  b.fillRect(0, 2, 16, 2, P.woodLight);
  b.outline(P.ink);
  return b;
}

export function well(): PixelBuffer {
  const b = new PixelBuffer(34, 42);
  b.groundShadow(17, 39, 15, 4, 130);
  // Stone ring
  b.ellipse(17, 30, 14, 7, P.stoneDark);
  b.ellipse(17, 28, 14, 7, P.stone);
  b.ellipse(17, 28, 10, 4.5, P.stoneDeep);
  b.ellipse(17, 29, 9, 3.6, shade(P.waterDeep, -0.3));
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    const x = 17 + Math.cos(ang) * 12;
    const y = 28 + Math.sin(ang) * 5.8;
    b.set(Math.round(x), Math.round(y), a % 2 ? P.stoneLight : P.stoneDark);
  }
  // Posts + roof
  b.fillRect(5, 10, 3, 18, P.woodDark);
  b.fillRect(26, 10, 3, 18, P.woodDark);
  b.fillRect(4, 14, 26, 2, P.wood);
  for (let i = 0; i < 14; i++) {
    b.hline(4 + i, 29 - i, 12 - i * 0.7, i % 2 ? P.woodDark : P.wood);
  }
  b.fillRect(14, 15, 6, 5, P.steelDark);
  b.vline(17, 16, 27, P.steel);
  b.outline(P.ink);
  return b;
}

// ---------------------------------------------------------------------------
// Animated props
// ---------------------------------------------------------------------------

function flameShape(b: PixelBuffer, cx: number, baseY: number, h: number, w: number, t: number, seed: number): void {
  for (let y = 0; y < h; y++) {
    const yy = baseY - y;
    const p = y / h;
    const wobble = Math.sin(p * 5 + t * 6 + seed) * (1.2 + p * 1.6);
    const half = Math.max(0.4, w * (1 - p * p) + Math.sin(t * 9 + p * 3) * 0.4);
    const x0 = Math.round(cx + wobble * p - half);
    const x1 = Math.round(cx + wobble * p + half);
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1;
      let c = P.fire;
      if (p > 0.72) c = P.fireDeep;
      else if (p < 0.35 && !edge) c = P.fireHot;
      else if (edge) c = P.fireDeep;
      b.blend(x, yy, c);
    }
  }
  // Detached spark
  const sy = baseY - h - 1 - Math.round(((t * 8 + seed) % 3));
  b.blend(Math.round(cx + Math.sin(t * 7 + seed) * 2), sy, rgba(P.fireHot, 200));
}

export function torchClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const b = new PixelBuffer(14, 30);
    // Wall bracket + handle
    b.fillRect(5, 14, 4, 14, P.wood);
    b.vline(5, 14, 27, P.woodLight);
    b.vline(8, 14, 27, P.woodDark);
    b.fillRect(4, 12, 6, 3, P.steelDark);
    b.fillRect(4, 12, 6, 1, P.steel);
    b.outline(P.ink);
    flameShape(b, 7, 12, 10 + (i % 2), 2.4, t, 0);
    frames.push(b);
  }
  return anim(frames, 7, 28, 12);
}

export function campfireClip(): Clip {
  const frames: PixelBuffer[] = [];
  const rng = new RNG(77);
  const logAngles = [0.2, -0.5, 1.1, 2.3];
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const b = new PixelBuffer(30, 30);
    b.groundShadow(15, 26, 11, 3.5, 110);
    // Stone ring
    for (let a = 0; a < 9; a++) {
      const ang = (a / 9) * Math.PI * 2;
      b.ellipse(15 + Math.cos(ang) * 10, 24 + Math.sin(ang) * 4.5, 2.6, 2, a % 2 ? P.stone : P.stoneDark);
    }
    // Logs
    for (const a of logAngles) {
      b.capsule(15 - Math.cos(a) * 7, 24 - Math.sin(a) * 3, 15 + Math.cos(a) * 7, 24 + Math.sin(a) * 3, 1.6, P.woodDark);
    }
    b.outline(P.ink);
    // Embers
    for (let e = 0; e < 6; e++) b.blend(rng.int(11, 19), rng.int(22, 25), rgba(P.fire, 200));
    flameShape(b, 15, 23, 13 + (i % 3), 3.4, t, 0);
    flameShape(b, 12, 23, 8 + ((i + 1) % 3), 2.2, t + 0.3, 1.7);
    flameShape(b, 18, 23, 9 + ((i + 2) % 3), 2.4, t + 0.6, 3.1);
    frames.push(b);
  }
  return anim(frames, 15, 27, 12);
}

export function braziersClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const b = new PixelBuffer(22, 40);
    b.groundShadow(11, 37, 8, 2.5, 120);
    b.fillRect(9, 22, 4, 14, P.steelDark);
    b.fillRect(6, 34, 10, 3, P.steelDark);
    b.fillRect(6, 34, 10, 1, P.steel);
    b.ellipse(11, 20, 8, 4, P.steelDark);
    b.ellipse(11, 19, 7, 3.2, P.steel);
    b.ellipse(11, 19, 5.4, 2.4, shade(P.steelDark, -0.4));
    b.outline(P.ink);
    b.ellipse(11, 19, 5, 2, rgba(P.fireDeep, 220));
    flameShape(b, 11, 19, 12 + (i % 3), 3, t, 0.9);
    flameShape(b, 8.5, 19, 7 + ((i + 1) % 2), 1.8, t + 0.4, 2.2);
    frames.push(b);
  }
  return anim(frames, 11, 38, 12);
}

export function cauldronClip(): Clip {
  const frames: PixelBuffer[] = [];
  const rng = new RNG(313);
  for (let i = 0; i < 6; i++) {
    const b = new PixelBuffer(26, 28);
    b.groundShadow(13, 26, 10, 3, 120);
    b.capsule(7, 22, 19, 22, 3, P.steelDark);
    b.ellipse(13, 16, 10, 8, P.steelDark);
    b.ellipse(13, 15, 9, 7, shade(P.steelDark, 0.12));
    b.ellipse(13, 10, 9, 3.4, P.ink);
    b.ellipse(13, 10, 8, 2.8, P.magicDeep);
    b.outline(P.ink);
    // Bubbles rise on a loop
    for (let k = 0; k < 3; k++) {
      const ph = (i / 6 + k / 3) % 1;
      const bx = 8 + k * 4 + Math.round(Math.sin(ph * 6) * 1.5);
      const by = 10 - Math.round(ph * 6);
      const r = 1 + (1 - ph) * 1.2;
      b.ellipse(bx, by, r, r * 0.85, rgba(P.magic, 200 * (1 - ph * 0.7)));
    }
    for (let k = 0; k < 4; k++) b.blend(rng.int(7, 19), 10 + rng.int(-1, 1), rgba(P.magic, 160));
    frames.push(b);
  }
  return anim(frames, 13, 27, 8);
}

/** Chest: 4 frames closed -> open, held on the last frame. */
export function chestClips(): { closed: Sheet; open: Clip } {
  const build = (lift: number, glow: number): PixelBuffer => {
    const b = new PixelBuffer(24, 24);
    b.groundShadow(12, 21, 10, 2.5, 120);
    // body
    planks(b, 3, 11, 18, 9, 21);
    b.strokeRect(3, 11, 18, 9, P.woodDark);
    b.fillRect(3, 14, 18, 2, P.steelDark);
    b.fillRect(10, 12, 4, 6, P.gold);
    b.set(12, 15, P.ink);
    if (glow > 0) {
      b.fillRect(5, 10, 14, 2, rgba(P.gold, 120 + glow * 100));
      for (let i = 0; i < 5; i++) b.set(6 + i * 3, 9 - Math.round(glow * 2), rgba(P.fireHot, 200));
    }
    // lid (rotates up by `lift` px)
    const ly = 4 - lift;
    for (let x = 3; x <= 20; x++) {
      const t = (x - 3) / 17;
      const dome = Math.round(Math.sin(t * Math.PI) * 2.2);
      for (let y = ly + 3 - dome; y <= ly + 7; y++) {
        let c = P.wood;
        if (y <= ly + 4 - dome) c = P.woodLight;
        if ((x - 3) % 5 === 0) c = P.woodDark;
        b.set(x, y + lift * 0.15, c);
      }
    }
    b.fillRect(3, ly + 6, 18, 2, P.steelDark);
    b.outline(P.ink);
    return b;
  };
  const closed = build(0, 0);
  const frames = [build(0, 0), build(2, 0.2), build(5, 0.6), build(7, 1), build(7, 0.75), build(7, 1)];
  return { closed: still(closed, 12, 22), open: anim(frames, 12, 22, 10, false) };
}

export function bannerClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    const b = new PixelBuffer(20, 40);
    b.fillRect(2, 0, 2, 38, P.woodDark);
    b.fillRect(2, 0, 16, 2, P.wood);
    for (let y = 2; y < 32; y++) {
      const wob = Math.sin(t + y * 0.35) * 1.6 * ((y - 2) / 30);
      for (let x = 4; x < 16; x++) {
        const xx = Math.round(x + wob);
        let c = P.blood;
        if (x < 6) c = shade(P.blood, 0.25);
        if (x > 13) c = P.bloodDark;
        if (y > 26 && (x + y) % 3 === 0) c = P.bloodDark;
        b.set(xx, y, c);
      }
      if (y > 26) {
        const cut = Math.round((y - 26) * 1.2);
        for (let x = 8 - cut; x <= 11 + cut; x++) b.set(Math.round(x + wob), y, [0, 0, 0, 0]);
      }
    }
    // Emblem
    const wob0 = Math.sin(t + 10 * 0.35) * 1.6 * (8 / 30);
    b.ellipse(10 + wob0, 12, 3.2, 3.2, P.gold);
    b.ellipse(10 + wob0, 12, 1.6, 1.6, P.blood);
    b.outline(P.ink);
    frames.push(b);
  }
  return anim(frames, 3, 38, 8);
}

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

function bobbing(base: (t: number) => PixelBuffer, ax: number, ay: number, fps = 8, n = 8): Clip {
  const frames: PixelBuffer[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const src = base(t);
    const out = new PixelBuffer(src.w, src.h);
    const off = Math.round(Math.sin(t * Math.PI * 2) * 1.5);
    out.ellipse(src.w / 2, src.h - 2, 4 - Math.abs(off) * 0.3, 1.6, rgba(P.shadow, 90));
    out.blit(src, 0, -off);
    frames.push(out);
  }
  return anim(frames, ax, ay, fps);
}

export function potion(color: RGBA): Clip {
  return bobbing((t) => {
    const b = new PixelBuffer(14, 18);
    b.fillRect(6, 2, 2, 3, P.steelDark);
    b.fillRect(5, 1, 4, 2, P.wood);
    b.ellipse(7, 10, 4, 4.6, shade(color, -0.35));
    b.ellipse(7, 10.5, 3.2, 3.8, color);
    b.ellipse(5.6, 9, 1.2, 1.6, rgba(P.white, 180));
    // Sloshing surface
    const s = Math.round(Math.sin(t * Math.PI * 2) * 0.8);
    b.hline(4, 10, 8 + s, shade(color, 0.35));
    b.outline(P.ink);
    return b;
  }, 7, 16);
}

export function coinClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let i = 0; i < 8; i++) {
    const b = new PixelBuffer(12, 14);
    // Width oscillates -> spinning disc
    const w = Math.abs(Math.cos((i / 8) * Math.PI * 2)) * 3.6 + 0.6;
    const off = Math.round(Math.sin((i / 8) * Math.PI * 2) * 1.2);
    b.ellipse(6, 10, 3.4, 1.4, rgba(P.shadow, 90));
    b.ellipse(6, 6 - off, w, 4, P.goldDark);
    b.ellipse(6, 6 - off, Math.max(0.4, w - 1), 3, P.gold);
    if (w > 2.4) b.ellipse(6, 6 - off, w - 2.2, 1.6, P.goldDark);
    b.set(6 - Math.round(w * 0.4), 4 - off, P.white);
    b.outline(P.ink);
    frames.push(b);
  }
  return anim(frames, 6, 12, 12);
}

export function keyItem(): Clip {
  return bobbing(() => {
    const b = new PixelBuffer(14, 14);
    b.ellipse(4, 5, 3, 3, P.gold);
    b.ellipse(4, 5, 1.4, 1.4, [0, 0, 0, 0]);
    b.fillRect(6, 4, 7, 2, P.gold);
    b.fillRect(10, 6, 2, 2, P.gold);
    b.fillRect(12, 6, 1, 3, P.gold);
    b.set(3, 3, P.fireHot);
    b.outline(P.ink);
    return b;
  }, 7, 12);
}

export function gemClip(color: RGBA): Clip {
  const frames: PixelBuffer[] = [];
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const b = new PixelBuffer(14, 16);
    const off = Math.round(Math.sin(t * Math.PI * 2) * 1.4);
    b.ellipse(7, 13, 3.6, 1.4, rgba(P.shadow, 80));
    const cy = 7 - off;
    b.line(7, cy - 4, 3, cy, shade(color, 0.35));
    b.line(7, cy - 4, 11, cy, shade(color, -0.2));
    for (let y = -4; y <= 5; y++) {
      const half = y < 0 ? (y + 4) : 4 - Math.round(((y) / 5) * 4);
      for (let x = -half; x <= half; x++) {
        const c = x < 0 ? color : shade(color, -0.28);
        b.set(7 + x, cy + y, c);
      }
    }
    b.set(6, cy - 2, rgba(P.white, 220));
    b.set(5, cy - 1, rgba(P.white, 150));
    b.outline(P.ink);
    // Sparkle
    if (i % 4 === 0) {
      b.set(11, cy - 4, P.white);
      b.set(12, cy - 4, rgba(P.white, 120));
      b.set(11, cy - 5, rgba(P.white, 120));
    }
    frames.push(b);
  }
  return anim(frames, 7, 14, 8);
}

export function ammoBox(): PixelBuffer {
  const b = new PixelBuffer(16, 14);
  b.groundShadow(8, 12, 6, 1.8, 100);
  b.fillRect(2, 4, 12, 8, P.moss);
  b.fillRect(2, 4, 12, 2, shade(P.moss, 0.25));
  b.fillRect(2, 8, 12, 1, shade(P.moss, -0.3));
  b.fillRect(5, 2, 6, 2, P.steelDark);
  b.fillRect(6, 6, 4, 4, P.gold);
  b.set(7, 7, P.goldDark);
  b.outline(P.ink);
  return b;
}

export function heartItem(): Clip {
  return bobbing(() => {
    const b = new PixelBuffer(14, 14);
    b.ellipse(5, 5, 2.6, 2.6, P.blood);
    b.ellipse(9, 5, 2.6, 2.6, P.blood);
    for (let y = 5; y < 11; y++) {
      const half = 4 - (y - 5) * 0.8;
      for (let x = -half; x <= half; x++) b.set(Math.round(7 + x), y, P.blood);
    }
    b.ellipse(4.6, 4.2, 1.1, 1, rgba(P.white, 200));
    b.outline(P.ink);
    return b;
  }, 7, 12, 6);
}

export function scroll(): PixelBuffer {
  const b = new PixelBuffer(16, 12);
  b.groundShadow(8, 10, 6, 1.6, 90);
  b.fillRect(3, 3, 10, 6, P.sand);
  b.hline(3, 12, 3, shade(P.sand, 0.3));
  b.fillRect(1, 2, 3, 8, P.woodDark);
  b.fillRect(12, 2, 3, 8, P.woodDark);
  for (let i = 0; i < 3; i++) b.hline(5, 11, 4 + i * 2, P.sandDark);
  b.outline(P.ink);
  return b;
}

export interface PropAssets {
  table: Sheet;
  chairL: Sheet;
  chairR: Sheet;
  barrels: Sheet[];
  crates: Sheet[];
  bookshelf: Sheet;
  rug: Sheet;
  bed: Sheet;
  sign: Sheet;
  walls: Sheet[];
  ruinedWalls: Sheet[];
  pillar: Sheet;
  archDoor: Sheet;
  fence: Sheet;
  well: Sheet;
  bridgeTiles: Sheet[];
  bridgeRail: Sheet;
  torch: Clip;
  campfire: Clip;
  brazier: Clip;
  cauldron: Clip;
  banner: Clip;
  chestClosed: Sheet;
  chestOpen: Clip;
  potions: Clip[];
  coin: Clip;
  key: Clip;
  gems: Clip[];
  ammo: Sheet;
  heart: Clip;
  scroll: Sheet;
}

export function bakeProps(): PropAssets {
  const chest = chestClips();
  return {
    table: still(table(), 17, 24),
    chairL: still(chair(-1), 8, 22),
    chairR: still(chair(1), 8, 22),
    barrels: [still(barrel(1), 10, 24), still(barrel(2), 10, 24)],
    crates: [still(crate(3), 10, 21), still(crate(4), 10, 21)],
    bookshelf: still(bookshelf(), 15, 38),
    rug: still(rug(), 20, 14),
    bed: still(bed(), 13, 38),
    sign: still(sign(), 11, 25),
    walls: [still(wallSegment(1), 8, 26), still(wallSegment(2), 8, 26), still(wallSegment(3), 8, 26)],
    ruinedWalls: [still(wallSegment(11, true), 8, 26), still(wallSegment(12, true), 8, 26)],
    pillar: still(pillar(), 9, 42),
    archDoor: still(archDoor(), 20, 46),
    fence: still(fence(), 8, 18),
    well: still(well(), 17, 38),
    bridgeTiles: [still(bridgeTile(1), 8, 8), still(bridgeTile(2), 8, 8), still(bridgeTile(3), 8, 8)],
    bridgeRail: still(bridgeRail(), 8, 11),
    torch: torchClip(),
    campfire: campfireClip(),
    brazier: braziersClip(),
    cauldron: cauldronClip(),
    banner: bannerClip(),
    chestClosed: chest.closed,
    chestOpen: chest.open,
    potions: [potion(P.blood), potion(P.magic), potion(P.leafLight)],
    coin: coinClip(),
    key: keyItem(),
    gems: [gemClip(P.magic), gemClip(P.flowerA), gemClip(P.leafLight)],
    ammo: still(ammoBox(), 8, 13),
    heart: heartItem(),
    scroll: still(scroll(), 8, 11),
  };
}

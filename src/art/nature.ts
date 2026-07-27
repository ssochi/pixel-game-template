/**
 * Plants, rocks and other outdoor set dressing.
 *
 * Foliage is baked once and then animated with a per-row horizontal shear,
 * which is the classic pixel-art wind trick: it keeps every pixel on the grid
 * (no rotation blur) while reading as a soft sway.
 */
import { PixelBuffer, mix, rgba, shade, type RGBA } from './pixel';
import { P, R } from './palette';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';
import { RNG, fbm } from '../engine/rng';

/** Shear rows horizontally, stronger towards the top. */
export function sway(src: PixelBuffer, amount: number, rootY = src.h, power = 2): PixelBuffer {
  const out = new PixelBuffer(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    const t = Math.max(0, (rootY - y) / rootY);
    const off = Math.round(amount * Math.pow(t, power));
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (c[3] === 0) continue;
      out.set(x + off, y, c);
    }
  }
  return out;
}

export function swayClip(base: PixelBuffer, ax: number, ay: number, amp = 1, fps = 6, frames = 4): Clip {
  const list: PixelBuffer[] = [];
  for (let i = 0; i < frames; i++) {
    const a = Math.sin((i / frames) * Math.PI * 2) * amp;
    list.push(sway(base, a, base.h));
  }
  return clip(bakeSheet(list, ax, ay), list.map((_, i) => i), fps);
}

// ---------------------------------------------------------------------------
// Grass / bushes / flowers
// ---------------------------------------------------------------------------

export function grassTuft(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(16, 14);
  const blades = rng.int(5, 8);
  for (let i = 0; i < blades; i++) {
    const x = 3 + Math.round(rng.range(0, 9));
    const h = rng.int(5, 10);
    const bend = rng.range(-2.5, 2.5);
    const col = rng.chance(0.4) ? P.leafLight : P.leaf;
    for (let j = 0; j < h; j++) {
      const t = j / h;
      const px = Math.round(x + bend * t * t);
      const py = 12 - j;
      b.set(px, py, j > h - 3 ? mix(col, P.leafLight, 0.5) : col);
      if (j < 3) b.set(px, py, P.leafDark);
    }
  }
  b.hline(3, 12, 13, rgba(P.leafDeep, 160));
  b.selOutline();
  return b;
}

export function bush(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(28, 24);
  const cx = 14;
  const cy = 15;

  // Silhouette first (blocking), in the darkest value.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.ellipse(cx + Math.cos(a) * 6, cy + Math.sin(a) * 3.2, rng.range(4.5, 6.5), rng.range(3.5, 5), R.leaf[0]);
  }
  // Body value, inset from the bottom-right so the dark rim survives there.
  b.ellipse(cx - 1, cy - 1.5, 8.5, 5.6, R.leaf[1]);
  b.ellipse(cx - 1.5, cy - 2.5, 7, 4.4, R.leaf[2]);
  // Directional light: leaf clumps only on the upper-left half. Shading that
  // followed the outline all the way round would be pillow shading.
  for (let i = 0; i < 16; i++) {
    const a = rng.range(Math.PI * 0.75, Math.PI * 1.95);
    const r = rng.range(0.25, 1);
    const x = cx - 1 + Math.cos(a) * 7 * r;
    const y = cy - 2 + Math.sin(a) * 4.5 * r;
    b.ellipse(x, y, rng.range(1.2, 2.2), rng.range(1, 1.8), r > 0.7 ? R.leaf[3] : R.leaf[4]);
  }
  // Berries sit in the shaded half for contrast.
  for (let i = 0; i < 4; i++) {
    b.set(Math.round(rng.range(9, 21)), Math.round(rng.range(13, 18)), P.flowerA);
  }
  b.groundShadow(cx, 21, 9, 2.5, 110);
  b.selOutline();
  return b;
}

export function flower(seed: number, color: RGBA): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(12, 14);
  const x = 6;
  const topY = rng.int(3, 5);
  for (let y = 12; y > topY; y--) b.set(x + (y < 8 ? 0 : 0), y, P.leafDark);
  b.set(x - 1, 9, P.leaf);
  b.set(x - 2, 8, P.leaf);
  b.set(x + 1, 10, P.leaf);
  b.ellipse(x, topY, 2.2, 2.2, color);
  b.ellipse(x, topY, 1, 1, P.flowerB);
  b.set(x - 2, topY - 1, shade(color, 0.25));
  b.selOutline();
  return b;
}

export function reed(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(14, 22);
  for (let i = 0; i < 4; i++) {
    const x = 4 + i * 2 + Math.round(rng.range(-1, 1));
    const h = rng.int(12, 20);
    for (let j = 0; j < h; j++) {
      const py = 20 - j;
      const px = Math.round(x + Math.pow(j / h, 2) * rng.range(-2, 2));
      b.set(px, py, j > h - 4 ? P.leafLight : P.leafDark);
    }
    if (rng.chance(0.6)) {
      const py = 20 - h;
      b.fillRect(x - 1, py - 3, 2, 4, P.wood);
      b.set(x - 1, py - 3, P.woodLight);
    }
  }
  b.selOutline();
  return b;
}

export function lilyPad(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(14, 10);
  b.ellipse(7, 5, 5.5, 3.5, P.leafDark);
  b.ellipse(7, 4.5, 5, 3, P.leaf);
  b.ellipse(5.5, 4, 2.5, 1.4, P.leafLight);
  // notch
  b.fillRect(7, 5, 5, 2, [0, 0, 0, 0]);
  for (let i = 0; i < 3; i++) b.set(Math.round(rng.range(4, 10)), Math.round(rng.range(3, 6)), P.leafDeep);
  b.selOutline();
  return b;
}

export function mushroom(seed: number, glow: boolean): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(14, 14);
  const cx = 7;
  const capColor = glow ? P.magicDeep : P.flowerA;
  b.fillRect(cx - 1, 8, 3, 5, P.sand);
  b.vline(cx - 1, 8, 12, P.sandDark);
  b.ellipse(cx, 7, 5, 3.4, capColor);
  b.ellipse(cx, 6.4, 4.6, 2.8, glow ? P.magic : shade(capColor, 0.2));
  for (let i = 0; i < 4; i++) {
    b.set(Math.round(rng.range(3, 11)), Math.round(rng.range(5, 8)), glow ? P.white : P.sand);
  }
  b.selOutline();
  return b;
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

export function tree(seed: number, kind: 'oak' | 'pine' | 'dead' = 'oak'): PixelBuffer {
  const rng = new RNG(seed);
  const w = 52;
  const h = 64;
  const b = new PixelBuffer(w, h);
  const cx = w / 2;
  const baseY = h - 3;

  b.groundShadow(cx, baseY, 13, 4, 120);

  // Trunk
  const trunkH = kind === 'pine' ? 22 : 26;
  for (let y = 0; y < trunkH; y++) {
    const yy = baseY - y;
    const wdt = 4 + Math.round((1 - y / trunkH) * 3);
    const lean = Math.round(Math.sin(y * 0.16 + seed) * 1.2);
    b.fillRect(cx - wdt / 2 + lean, yy, wdt, 1, P.wood);
    b.set(cx - wdt / 2 + lean, yy, P.woodLight);
    b.set(cx + wdt / 2 + lean - 1, yy, P.woodDark);
    if (y % 5 === 2) b.set(cx + lean, yy, P.woodDark);
  }
  // Roots
  b.capsule(cx - 1, baseY, cx - 6, baseY + 1, 1.4, P.woodDark);
  b.capsule(cx + 1, baseY, cx + 6, baseY + 1, 1.4, P.woodDark);

  if (kind === 'dead') {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + rng.range(-1.2, 1.2);
      const len = rng.range(9, 16);
      const sx = cx + rng.range(-2, 2);
      const sy = baseY - trunkH + rng.range(-2, 6);
      b.capsule(sx, sy, sx + Math.cos(a) * len, sy + Math.sin(a) * len, 1.3, P.woodDark);
      b.capsule(
        sx + Math.cos(a) * len,
        sy + Math.sin(a) * len,
        sx + Math.cos(a + 0.6) * len * 1.4,
        sy + Math.sin(a + 0.6) * len * 1.4,
        1,
        P.woodDark,
      );
    }
    b.selOutline();
    return b;
  }

  if (kind === 'pine') {
    let ty = baseY - trunkH + 4;
    let rad = 17;
    for (let layer = 0; layer < 4; layer++) {
      for (let i = 0; i < 3; i++) {
        b.ellipse(cx + rng.range(-2, 2), ty + i * 1.2, rad - i, rad * 0.4 - i * 0.3, i === 0 ? P.leafDark : P.leafDeep);
      }
      b.ellipse(cx - 2, ty - 1, rad * 0.6, rad * 0.22, P.leaf);
      ty -= 9;
      rad -= 3.6;
    }
    b.ellipse(cx, ty + 4, 3, 5, P.leafDark);
    b.selOutline();
    b.rimLight(P.leafLight, 0.3);
    return b;
  }

  // Oak canopy. Built in value layers with a single light direction (upper
  // left) rather than concentric rings, which would read as a green pillow.
  const cy = baseY - trunkH - 8;
  const blobs: [number, number, number][] = [
    [cx, cy, 15],
    [cx - 11, cy + 4, 10],
    [cx + 11, cy + 4, 10],
    [cx - 6, cy - 8, 9],
    [cx + 7, cy - 7, 9],
  ];
  // 1. Full silhouette in the darkest value.
  for (const [bx, by, r] of blobs) b.ellipse(bx, by, r, r * 0.82, R.leaf[0]);
  // 2. Body value, pushed up and left so the dark stays as a bottom-right rim.
  for (const [bx, by, r] of blobs) b.ellipse(bx - r * 0.12, by - r * 0.16, r * 0.9, r * 0.72, R.leaf[1]);
  for (const [bx, by, r] of blobs) b.ellipse(bx - r * 0.22, by - r * 0.3, r * 0.7, r * 0.54, R.leaf[2]);
  // 3. Lit clumps: only on the upper-left of each blob, in repeating shapes.
  for (const [bx, by, r] of blobs) {
    const n = Math.round(r * 0.5);
    for (let i = 0; i < n; i++) {
      const a = rng.range(Math.PI * 0.8, Math.PI * 1.9);
      const d = rng.range(0.2, 0.72);
      const x = bx + Math.cos(a) * r * d;
      const y = by + Math.sin(a) * r * 0.78 * d;
      if (b.alphaAt(Math.round(x), Math.round(y)) < 200) continue;
      b.ellipse(x, y, rng.range(1.6, 2.6), rng.range(1.2, 2), R.leaf[3]);
      if (rng.chance(0.4)) b.ellipse(x - 0.8, y - 0.8, 1.2, 1, R.leaf[4]);
    }
  }
  // 4. A few gaps where sky shows through, to break the solid mass.
  for (let i = 0; i < 10; i++) {
    const bx = cx + rng.range(-16, 16);
    const by = cy + rng.range(-10, 8);
    if (fbm(bx * 0.3, by * 0.3, 2) > 0.62) b.ellipse(bx, by, 1.6, 1.2, R.leaf[0]);
  }
  b.selOutline();
  return b;
}

// ---------------------------------------------------------------------------
// Rocks & crystals
// ---------------------------------------------------------------------------

export function rock(seed: number, size: 'small' | 'mid' | 'big', mossy = false): PixelBuffer {
  const rng = new RNG(seed);
  const dim = size === 'small' ? 14 : size === 'mid' ? 24 : 38;
  const b = new PixelBuffer(dim, Math.round(dim * 0.85));
  const cx = dim / 2;
  const cy = b.h * 0.62;
  const rx = dim * 0.42;
  const ry = b.h * 0.34;

  b.groundShadow(cx, b.h - 2, rx, ry * 0.5, 110);

  // Irregular silhouette from a few overlapping facets.
  const facets = rng.int(3, 5);
  for (let i = 0; i < facets; i++) {
    const a = (i / facets) * Math.PI * 2 + rng.range(-0.4, 0.4);
    b.ellipse(cx + Math.cos(a) * rx * 0.35, cy + Math.sin(a) * ry * 0.35, rx * rng.range(0.6, 0.85), ry * rng.range(0.7, 1), P.stone);
  }
  b.ellipse(cx, cy, rx * 0.9, ry * 0.9, P.stone);
  // Top-left lit facet, bottom-right shadow.
  b.ellipse(cx - rx * 0.25, cy - ry * 0.35, rx * 0.5, ry * 0.45, P.stoneLight);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (b.alphaAt(x, y) < 200) continue;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx + dy > 0.75) b.blend(x, y, rgba(P.stoneDark, 190));
      if (dy > 0.75) b.blend(x, y, rgba(P.stoneDeep, 140));
    }
  // Cracks
  const cracks = size === 'small' ? 1 : 2;
  for (let i = 0; i < cracks; i++) {
    let x = cx + rng.range(-rx * 0.5, rx * 0.5);
    let y = cy - ry * 0.4;
    for (let j = 0; j < dim * 0.4; j++) {
      if (b.alphaAt(Math.round(x), Math.round(y)) > 200) b.set(Math.round(x), Math.round(y), P.stoneDeep);
      x += rng.range(-0.9, 0.9);
      y += rng.range(0.2, 1);
    }
  }
  if (mossy) {
    for (let i = 0; i < dim * 2; i++) {
      const x = Math.round(rng.range(0, b.w));
      const y = Math.round(rng.range(cy - ry, cy + ry));
      if (b.alphaAt(x, y) < 200) continue;
      if (fbm(x * 0.3, y * 0.3, 2) > 0.55) b.blend(x, y, rgba(P.moss, 220));
    }
  }
  b.selOutline();
  b.rimLight(P.stoneLight, 0.4);
  return b;
}

export function crystalClip(seed: number): Clip {
  const rng = new RNG(seed);
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 8; f++) {
    const pulse = 0.5 + 0.5 * Math.sin((f / 8) * Math.PI * 2);
    const b = new PixelBuffer(22, 26);
    const cx = 11;
    const baseY = 23;
    b.ellipse(cx, baseY, 7, 2.5, rgba(P.magicDeep, 60 + pulse * 60));
    const shards = 3;
    for (let i = 0; i < shards; i++) {
      const ox = (i - 1) * 4 + rng.range(-0.5, 0.5);
      const hgt = 10 + (i === 1 ? 8 : 0) + rng.range(0, 3);
      const wid = i === 1 ? 3.2 : 2.2;
      const tipY = baseY - hgt;
      for (let y = tipY; y <= baseY; y++) {
        const t = (y - tipY) / hgt;
        const half = wid * t;
        const x0 = Math.round(cx + ox - half);
        const x1 = Math.round(cx + ox + half);
        for (let x = x0; x <= x1; x++) {
          const edge = x <= x0 ? 1 : x >= x1 ? 2 : 0;
          const c = edge === 1 ? mix(P.magic, P.white, 0.4) : edge === 2 ? P.magicDeep : mix(P.magicDeep, P.magic, 0.45 + pulse * 0.35);
          b.set(x, y, c);
        }
      }
      b.set(Math.round(cx + ox), Math.round(tipY + 1), mix(P.white, P.magic, 1 - pulse * 0.6));
    }
    b.selOutline();
    // Inner glow overlay
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++)
        if (b.alphaAt(x, y) > 200 && fbm(x * 0.5, y * 0.5 + f, 1) > 0.7)
          b.blend(x, y, rgba(P.magic, 90 * pulse));
    frames.push(b);
  }
  return clip(bakeSheet(frames, 11, 24), frames.map((_, i) => i), 8);
}

export function stump(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(20, 16);
  b.groundShadow(10, 14, 8, 2.5, 110);
  b.fillRect(4, 6, 12, 8, P.woodDark);
  b.ellipse(10, 12, 6, 2.4, P.woodDark);
  b.ellipse(10, 6, 6, 3, P.wood);
  b.ellipse(10, 6, 4, 1.9, P.woodPale);
  b.ellipse(10, 6, 2, 0.9, P.wood);
  b.set(10, 6, P.woodDark);
  for (let y = 7; y < 14; y++) if (rng.chance(0.5)) b.set(rng.int(5, 14), y, P.woodPale);
  b.selOutline();
  return b;
}

/** Fallen log — doubles as a river crossing prop. */
export function log(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(40, 16);
  b.groundShadow(20, 13, 17, 2.5, 110);
  b.fillRect(3, 5, 34, 7, P.wood);
  b.hline(3, 36, 5, P.woodLight);
  b.hline(3, 36, 11, P.woodDark);
  b.ellipse(4, 8.5, 2.4, 3.6, P.woodPale);
  b.ellipse(4, 8.5, 1.2, 1.8, P.woodDark);
  b.ellipse(36, 8.5, 2, 3.4, P.woodDark);
  for (let i = 0; i < 14; i++) {
    const x = rng.int(6, 34);
    const y = rng.int(6, 11);
    b.set(x, y, rng.chance(0.5) ? P.woodDark : P.woodLight);
  }
  for (let i = 0; i < 8; i++) b.set(rng.int(6, 34), 5, P.moss);
  b.selOutline();
  return b;
}

export interface NatureAssets {
  grass: Clip[];
  bushes: Clip[];
  flowers: Clip[];
  reeds: Clip[];
  trees: Clip[];
  pine: Clip;
  deadTree: Clip;
  rocks: Sheet[];
  crystal: Clip;
  stump: Sheet;
  log: Sheet;
  lily: Clip;
  mushrooms: Sheet[];
}

function still(b: PixelBuffer, ax: number, ay: number): Sheet {
  return bakeSheet([b], ax, ay);
}

export function bakeNature(): NatureAssets {
  const grass = [0, 1, 2].map((i) => swayClip(grassTuft(11 + i * 7), 8, 13, 1.6, 5 + i));
  const bushes = [0, 1].map((i) => swayClip(bush(31 + i * 13), 14, 22, 1.2, 4 + i));
  const flowers = [P.flowerA, P.flowerB, P.flowerC].map((c, i) => swayClip(flower(51 + i * 5, c), 6, 13, 1.4, 5));
  const reeds = [0, 1].map((i) => swayClip(reed(71 + i * 9), 7, 21, 2.2, 6));
  const trees = [0, 1].map((i) => swayClip(tree(101 + i * 17, 'oak'), 26, 62, 1.6, 3, 6));
  return {
    grass,
    bushes,
    flowers,
    reeds,
    trees,
    pine: swayClip(tree(203, 'pine'), 26, 62, 1.2, 3, 6),
    deadTree: swayClip(tree(307, 'dead'), 26, 62, 1, 3, 4),
    rocks: [
      still(rock(401, 'small'), 7, 11),
      still(rock(402, 'mid', true), 12, 19),
      still(rock(403, 'big'), 19, 31),
      still(rock(404, 'mid'), 12, 19),
    ],
    crystal: crystalClip(501),
    stump: still(stump(601), 10, 15),
    log: still(log(701), 20, 13),
    lily: swayClip(lilyPad(801), 7, 8, 1, 4),
    mushrooms: [still(mushroom(901, false), 7, 13), still(mushroom(902, true), 7, 13)],
  };
}

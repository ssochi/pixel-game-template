/**
 * Plants, rocks and other outdoor set dressing.
 *
 * Foliage is baked once and then animated with a per-row horizontal shear,
 * which is the classic pixel-art wind trick: it keeps every pixel on the grid
 * (no rotation blur) while reading as a soft sway.
 */
import { PixelBuffer, mix, parseArt, rgba, shade, type RGBA } from './pixel';
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
  // A handful of well-separated clumps, all one value. Two values scattered at
  // random turned the top of the bush into a mottled hole.
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.85 + (i / 6) * Math.PI * 1.05;
    const r = rng.range(0.45, 0.9);
    const x = cx - 1 + Math.cos(a) * 7 * r;
    const y = cy - 2.5 + Math.sin(a) * 4 * r;
    b.ellipse(x, y, 2, 1.4, R.leaf[3]);
  }
  // Berries: single pixels, in the shaded half so they read as accents.
  for (const [bx, by] of [
    [11, 16],
    [17, 14],
    [14, 18],
  ] as [number, number][]) {
    b.set(bx, by, R.red[3]);
  }
  b.groundShadow(cx, 21, 9, 2.5, 110);
  b.selOutline();
  return b;
}

/**
 * Below roughly 12px, generated shapes stop reading as objects — a flower head
 * built from ellipses is just a coloured smudge. These are drawn pixel by
 * pixel; the outline is added afterwards by `selOutline`.
 */
const FLOWER_ART = [
  '..P.P..',
  '.PLPPP.',
  'PPPYPPP',
  '.PPPPP.',
  '..P.P..',
  '...S...',
  '..LS...',
  '...SL..',
  '...S...',
  '...S...',
];

export function flower(seed: number, color: RGBA): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(12, 14);
  const art = parseArt(FLOWER_ART, {
    P: color,
    L: shade(color, 0.35),
    Y: P.flowerB,
    S: R.leaf[1],
  });
  // Vary the stem height per instance so a patch doesn't look stamped.
  b.blit(art, 2, 2 + rng.int(0, 2));
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

const MUSHROOM_ART = [
  '...MMMMM...',
  '..MoMMMoM..',
  '.MMMMoMMMM.',
  '.MMMMMMMMD.',
  '.DDDDDDDDD.',
  '..DSSSSSD..',
  '....SSS....',
  '....SsS....',
  '....SSS....',
  '...SSSSS...',
];

export function mushroom(_seed: number, glow: boolean): PixelBuffer {
  const b = new PixelBuffer(14, 14);
  const art = parseArt(MUSHROOM_ART, {
    M: glow ? R.magic[2] : R.red[2],
    o: glow ? R.magic[4] : P.white,
    D: glow ? R.magic[1] : R.red[1],
    S: R.paper[3],
    s: R.paper[2],
  });
  b.blit(art, 1, 3);
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

/**
 * Rocks are built from **planes, not blobs**.
 *
 * The previous version stacked translucent ellipses and speckled noise over
 * them, which produced a flat grey puddle: no silhouette, no form. A rock reads
 * as a rock when it has a hard-edged silhouette that is wider at the base than
 * the top, and two or three *flat* facets divided by straight breaks — a lit
 * top plane, a mid front plane and a dark under-plane. The row-width table gives
 * the silhouette; a diagonal split gives the facets.
 */
export function rock(seed: number, size: 'small' | 'mid' | 'big', mossy = false): PixelBuffer {
  const rng = new RNG(seed);
  const scale = size === 'small' ? 1 : size === 'mid' ? 1.7 : 2.7;
  // Base silhouette as fractions of the full width, top row first.
  const profile = [0.34, 0.6, 0.82, 0.95, 1, 1, 0.92, 0.68];
  const w = Math.round(12 * scale);
  const rowH = Math.max(1, Math.round(scale));
  const h = profile.length * rowH + 2;
  const b = new PixelBuffer(w + 4, h + 2);
  const cx = (w + 4) / 2;

  b.groundShadow(cx, h, w * 0.44, Math.max(1.4, scale), 110);

  // Per-row horizontal jitter so the rock is asymmetric but still hard-edged.
  const lean = profile.map(() => rng.int(-1, 1));
  const spans: [number, number][] = [];
  for (let i = 0; i < profile.length; i++) {
    const half = Math.max(1, Math.round((profile[i] * w) / 2));
    spans.push([Math.round(cx - half + lean[i]), Math.round(cx + half + lean[i])]);
  }

  // The facet break runs from the upper-right down to the lower-left.
  const breakAt = (row: number): number => cx - w * 0.1 + row * rowH * 0.9;

  for (let i = 0; i < spans.length; i++) {
    const [x0, x1] = spans[i];
    for (let r = 0; r < rowH; r++) {
      const y = 1 + i * rowH + r;
      for (let x = x0; x <= x1; x++) {
        const topPlane = i === 0 || (i === 1 && x < breakAt(i));
        const lit = x < breakAt(i);
        let c = topPlane ? R.stone[3] : lit ? R.stone[2] : R.stone[1];
        // Under-plane: the bottom two rows always fall away into shadow.
        if (i >= spans.length - 2) c = lit ? R.stone[1] : R.stone[0];
        if (x === x1 && i > 1) c = R.stone[0];
        b.set(x, y, c);
      }
    }
  }

  // One straight crack, following the facet break rather than wandering.
  if (size !== 'small') {
    const startRow = 1 + rng.int(0, 1);
    let x = Math.round(breakAt(startRow)) + rng.int(0, 2);
    for (let i = startRow; i < spans.length - 1; i++) {
      for (let r = 0; r < rowH; r++) {
        const y = 1 + i * rowH + r;
        if (b.alphaAt(x, y) > 200) b.set(x, y, R.stone[0]);
      }
      x += rng.int(0, 1);
    }
  }

  if (mossy) {
    // Moss sits on the top plane only, in clumps, never as scattered pixels.
    for (let i = 0; i < 3; i++) {
      const [x0, x1] = spans[rng.int(0, 2)];
      const mx = rng.int(x0 + 1, x1 - 2);
      const my = 1 + rng.int(0, 2) * rowH;
      b.fillRect(mx, my, 2, 1, R.leaf[1]);
      b.set(mx, my - 1, R.leaf[2]);
    }
  }

  b.selOutline();
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
      still(rock(401, 'small'), 8, 10),
      still(rock(402, 'mid', true), 12, 18),
      still(rock(403, 'big'), 18, 26),
      still(rock(404, 'mid'), 12, 18),
    ],
    crystal: crystalClip(501),
    stump: still(stump(601), 10, 15),
    log: still(log(701), 20, 13),
    lily: swayClip(lilyPad(801), 7, 8, 1, 4),
    mushrooms: [still(mushroom(901, false), 7, 13), still(mushroom(902, true), 7, 13)],
  };
}

/**
 * Plants, rocks and other outdoor set dressing.
 *
 * Foliage is baked once and then animated with a per-row horizontal shear,
 * which is the classic pixel-art wind trick: it keeps every pixel on the grid
 * (no rotation blur) while reading as a soft sway.
 */
import { PixelBuffer, TRANSPARENT, mix, parseArt, rgba, shade, type RGBA } from './pixel';
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

/**
 * Mushroom — 7x6 of actual sprite. The old one was 11x10, which next to a 16px
 * villager read as a parasol; forageables should sit below knee height. At this
 * size the cap spots have to be single pixels or they eat the whole cap.
 */
const MUSHROOM_ART = [
  '.MMMMM.',
  'MHMoMMM',
  'MMMMMoM',
  '.DDDDD.',
  '..SSs..',
  '.SSSSs.',
];

export function mushroom(_seed: number, glow: boolean): PixelBuffer {
  const b = new PixelBuffer(14, 14);
  const art = parseArt(MUSHROOM_ART, {
    M: glow ? R.magic[2] : R.red[2],
    H: glow ? R.magic[3] : R.red[3],
    o: glow ? R.magic[4] : P.white,
    D: glow ? R.magic[1] : R.red[1],
    S: R.paper[3],
    s: R.paper[2],
  });
  // Bottom row stays on y=12 so the (7,13) anchor still sits at the base.
  b.blit(art, 4, 7);
  b.selOutline();
  return b;
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

function sameRGB(a: RGBA, c: RGBA): boolean {
  return a[0] === c[0] && a[1] === c[1] && a[2] === c[2];
}

/** "Is this pixel part of the shape" — alpha test used by the shading passes. */
function solid(b: PixelBuffer, x: number, y: number): boolean {
  return b.alphaAt(x, y) > 200;
}

const UP = -Math.PI / 2;

/**
 * One tapering limb that folds back towards vertical as it travels.
 *
 * Both properties matter for reading as a branch: constant-width limbs
 * radiating from a single point are fingers, and a limb that keeps its launch
 * angle is a spoke. Real branches leave the trunk thick, bend back up towards
 * the light and end on a single pixel.
 */
function limb(
  b: PixelBuffer,
  x: number,
  y: number,
  ang: number,
  len: number,
  w0: number,
  w1: number,
  col: RGBA,
  fold = 0.75,
): { x: number; y: number; a: number } {
  const steps = Math.max(6, Math.round(len * 2));
  let px = x;
  let py = y;
  let a = ang;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    a = ang + (UP - ang) * t * fold;
    px += Math.cos(a) * (len / steps);
    py += Math.sin(a) * (len / steps);
    b.capsule(px, py, px, py, Math.max(0.4, w0 + (w1 - w0) * t), col);
  }
  return { x: px, y: py, a };
}

/** Light from the upper left: left edges catch it, right edges fall away. */
function edgeLight(b: PixelBuffer, body: RGBA, lit: RGBA, dark: RGBA): void {
  const src = b.clone();
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (!solid(src, x, y) || !sameRGB(src.get(x, y), body)) continue;
      const l = solid(src, x - 1, y);
      const r = solid(src, x + 1, y);
      // 1px twigs (open on both sides) keep the base value — a highlight and a
      // shadow crammed into one pixel is just noise.
      if (!l && r) b.set(x, y, lit);
      else if (l && !r) b.set(x, y, dark);
    }
  }
}

/**
 * Dead tree.
 *
 * The failure mode here is the hand: five limbs of equal thickness leaving one
 * point on a stubby trunk is a palm with fingers, whatever colour it is. The
 * fix is structural — one tapered trunk that carries most of the height, limbs
 * that leave it at clearly different heights, every limb thinning to 1px, and
 * two snapped-off stubs to say "dead" rather than "bare".
 */
function deadTree(b: PixelBuffer, cx: number, baseY: number, rng: RNG): PixelBuffer {
  const trunkH = 37;
  const topY = baseY - trunkH;
  const botW = 7;
  const topW = 2;
  // A slow S-curve, so the trunk isn't a ruler.
  const bendAt = (y: number): number => Math.sin((baseY - y) * 0.062 + 0.5) * 2.3 - 1.1;
  const widthAt = (y: number): number => {
    const t = (baseY - y) / trunkH;
    return Math.max(topW, Math.round(topW + (botW - topW) * Math.pow(1 - t, 1.6)));
  };

  for (let y = baseY; y >= topY; y--) {
    const wdt = widthAt(y);
    b.fillRect(Math.round(cx + bendAt(y) - wdt / 2), y, wdt, 1, R.wood[1]);
  }
  // Root flare, so the trunk grows out of the ground instead of being stuck in.
  b.capsule(cx - 1, baseY - 2, cx - 6, baseY + 1, 1.4, R.wood[1]);
  b.capsule(cx + 1, baseY - 2, cx + 6, baseY + 1, 1.4, R.wood[1]);
  b.capsule(cx - 3, baseY - 4, cx - 5, baseY + 1, 1, R.wood[1]);

  const tx = (y: number): number => cx + bendAt(y);
  // [start height, launch angle, length, base width] — note the spread of
  // start heights: that alone kills the "fingers from one palm" read.
  const main: [number, number, number, number, number][] = [
    [topY + 13, -2.55, 15, 1.9, 0.4],
    [topY + 6, -0.65, 14, 1.7, 0.42],
    [topY + 1, -1.9, 12, 1.5, 0.6],
    [topY, -1.15, 11, 1.4, 0.62],
  ];
  for (const [sy, ang, len, w0, fold] of main) {
    const tip = limb(b, tx(sy), sy, ang, len, w0, 0.55, R.wood[1], fold);
    for (let i = 0, n = rng.int(2, 3); i < n; i++) {
      limb(b, tip.x, tip.y, tip.a + rng.range(-0.75, 0.75), rng.range(4, 7), 0.7, 0.4, R.wood[1], 0.5);
    }
  }
  // Snapped stubs: short, blunt, splintered dark at the break.
  for (const [sy, ang, len] of [
    [topY + 20, -0.5, 6],
    [topY + 26, -2.55, 5],
  ] as [number, number, number][]) {
    const s = limb(b, tx(sy), sy, ang, len, 1.7, 1.2, R.wood[1], 0.3);
    b.capsule(s.x, s.y, s.x, s.y, 1.1, R.wood[0]);
  }

  // Bark: short vertical dashes kept inside the trunk, plus one rot hollow.
  for (let i = 0; i < 10; i++) {
    const y = topY + rng.int(3, trunkH - 6);
    const wdt = widthAt(y);
    if (wdt < 3) continue;
    const x0 = Math.round(tx(y) - wdt / 2);
    b.vline(x0 + rng.int(1, wdt - 2), y, y + rng.int(1, 3), R.wood[0]);
  }
  const hy = baseY - 15;
  b.ellipse(tx(hy) + 0.5, hy, 1.5, 2.4, R.wood[0]);

  edgeLight(b, R.wood[1], R.wood[2], R.wood[0]);
  b.selOutline();
  return b;
}

/**
 * One conifer tier: a triangular skirt with a saw-toothed lower edge.
 *
 * Stacked ellipses read as a cake because every layer has the same smooth
 * curve and they touch. A tier is instead widest at its own base, its underside
 * breaks into 3px frond steps, and its top is sloped so the tier above can sit
 * clear of it with trunk showing in between.
 */
function pineTier(b: PixelBuffer, cx: number, bottom: number, half: number, hgt: number, rng: RNG): void {
  const apex = bottom - hgt;
  // Independent left/right jitter: symmetric tiers are what make it a cake.
  const x0 = Math.round(cx - half - rng.range(0, 1.7));
  const x1 = Math.round(cx + half + rng.range(0, 1.7));
  const phase = rng.int(0, 2);
  const split = rng.int(0, 6);
  for (let x = x0; x <= x1; x++) {
    const reach = Math.max(1, x < cx ? cx - x0 : x1 - cx);
    const u = Math.min(1, Math.abs(x - cx) / reach);
    // Sloped upper edge: apex at the centre, tips at the bottom corners. The
    // steep exponent keeps the tier thick out to ~2/3 of its span, so the
    // stack reads as one tree instead of four stacked umbrellas.
    const top = Math.round(apex + hgt * Math.pow(u, 2.5));
    // Saw teeth: a repeating 3px motif, not per-pixel noise.
    const bot = Math.max(top, bottom - ((x - x0 + phase) % 3));
    const lit = x < cx - half * 0.12;
    for (let y = top; y <= bot; y++) {
      let c = lit ? R.leaf[2] : R.leaf[1];
      if (y - top < 2) c = lit ? R.leaf[3] : R.leaf[2];
      if (y === bot) c = R.leaf[0];
      b.set(x, y, c);
    }
    // A couple of dark splits so the skirt reads as separate fronds.
    if ((x - x0 + split) % 7 === 0 && bot - top > 3) b.vline(x, bot - 2, bot, R.leaf[0]);
  }
}

export function tree(seed: number, kind: 'oak' | 'pine' | 'dead' = 'oak'): PixelBuffer {
  const rng = new RNG(seed);
  const w = 52;
  const h = 64;
  const b = new PixelBuffer(w, h);
  const cx = w / 2;
  const baseY = h - 3;

  b.groundShadow(cx, baseY, 13, 4, 120);

  if (kind === 'dead') return deadTree(b, cx, baseY, rng);

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

  if (kind === 'pine') {
    // A slim stem carries on up through the canopy, so the 1-2px band between
    // two tiers shows trunk rather than sky.
    const stemTop = 4;
    for (let y = baseY - trunkH; y >= stemTop; y--) {
      const t = (baseY - trunkH - y) / (baseY - trunkH - stemTop);
      const wdt = t < 0.3 ? 3 : t < 0.72 ? 2 : 1;
      const x0 = Math.round(cx - wdt / 2);
      b.fillRect(x0, y, wdt, 1, P.wood);
      b.set(x0, y, P.woodDark);
    }
    // [bottom row, half width, height]; the gaps between one tier's apex and
    // the next tier's bottom are the exposed trunk.
    const tiers: [number, number, number][] = [
      [46, 15.5, 12],
      [33, 12.8, 11],
      [21, 10.0, 9],
      [11, 7.4, 7],
      [5, 3.0, 3],
    ];
    for (const [bottom, half, hgt] of tiers) pineTier(b, cx, bottom, half * rng.range(0.86, 1.12), hgt, rng);
    b.selOutline();
    return b;
  }

  // Oak canopy. The outline is the whole job: five smooth ellipses in a ring
  // give a cartoon cloud. Here a set of differently sized clumps interlock,
  // 1-2px bumps are stamped along the resulting contour, and the interior is
  // shaded in leaf clumps rather than concentric ellipses.
  const cy = baseY - trunkH - 8;
  const blobs = (
    [
      [cx - 1, cy - 1, 12.5],
      [cx - 11, cy + 2, 8.5],
      [cx + 10, cy + 1, 9],
      [cx - 6, cy - 9, 8],
      [cx + 6, cy - 8, 7.5],
      [cx - 14, cy - 4, 6],
      [cx + 14, cy - 3, 6.5],
      [cx - 4, cy + 7, 7.5],
      [cx + 5, cy + 8, 6.5],
    ] as [number, number, number][]
  ).map(
    ([bx, by, r]) =>
      [bx + rng.range(-1.5, 1.5), by + rng.range(-1.5, 1.5), r * rng.range(0.86, 1.14)] as [number, number, number],
  );

  // 1. Silhouette, darkest value.
  for (const [bx, by, r] of blobs) b.ellipse(bx, by, r, r * 0.82, R.leaf[0]);

  // 2. Ragged it up: 1-2px clusters hung off the contour. Without these the
  //    join between two overlapping circles is still a smooth arc.
  const contour: [number, number][] = [];
  for (let y = 1; y < b.h - 1; y++) {
    for (let x = 1; x < b.w - 1; x++) {
      if (!solid(b, x, y) || !sameRGB(b.get(x, y), R.leaf[0])) continue;
      if (solid(b, x - 1, y) && solid(b, x + 1, y) && solid(b, x, y - 1) && solid(b, x, y + 1)) continue;
      contour.push([x, y]);
    }
  }
  for (let i = 0; i < 24; i++) {
    const [ex, ey] = contour[rng.int(0, contour.length - 1)];
    b.ellipse(ex + rng.range(-1.2, 1.2), ey + rng.range(-1.2, 1.2), rng.range(0.7, 1.7), rng.range(0.7, 1.4), R.leaf[0]);
  }

  // 3. Interior, shaded in 3x2 leaf clumps.
  //
  //    The value of a clump comes from a field — light falls from the upper
  //    left, and it is crushed towards the darkest step where the canopy sits
  //    down onto the trunk. Sampling that field on a 3x2 grid (with smooth
  //    noise, so neighbouring cells often agree and merge into bigger bunches)
  //    is what makes it read as clumps of leaves instead of a smooth dome or
  //    per-pixel confetti. Only pixels 2px in from the bottom-right edge are
  //    touched, so the darkest step survives there as a rim and every contour
  //    bump keeps its dark edge.
  const src = b.clone();
  const capTop = cy - 20;
  const capBot = cy + 14;
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (!solid(src, x, y) || !sameRGB(src.get(x, y), R.leaf[0])) continue;
      if (!solid(src, x + 1, y) || !solid(src, x, y + 1) || !solid(src, x + 1, y + 1)) continue;
      if (!solid(src, x + 2, y) || !solid(src, x, y + 2)) continue;
      const cellN = fbm(Math.floor(x / 3) * 1.1, Math.floor(y / 2) * 1.7, 2);
      const vert = (capBot - y) / (capBot - capTop);
      const horiz = (cx + 9 - x) / 40;
      const dx = (x - cx) / 11;
      const dy = (y - (cy + 15)) / 9;
      const join = Math.max(0, 1 - (dx * dx + dy * dy));
      const t = 0.62 * vert + 0.24 * horiz + (cellN - 0.5) * 0.55 - join * 0.75;
      b.set(x, y, R.leaf[t > 0.82 ? 4 : t > 0.58 ? 3 : t > 0.36 ? 2 : t > 0.14 ? 1 : 0]);
    }
  }
  // 4. A few 1px sparkles on the brightest clumps, on their upper-left corner.
  for (let i = 0; i < 8; i++) {
    const x = Math.round(cx + rng.range(-15, 5));
    const y = Math.round(cy + rng.range(-16, -2));
    if (sameRGB(b.get(x, y), R.leaf[3]) && sameRGB(b.get(x + 1, y), R.leaf[3])) b.set(x, y, R.leaf[4]);
  }
  // 5. Two small gaps where sky shows through, so the mass isn't solid.
  for (let i = 0; i < 2; i++) {
    const gx = Math.round(cx + rng.range(-12, 8));
    const gy = Math.round(cy + rng.range(-10, 0));
    if (!sameRGB(b.get(gx, gy), R.leaf[2]) && !sameRGB(b.get(gx, gy), R.leaf[3])) continue;
    for (let y = gy; y < gy + 2; y++)
      for (let x = gx; x < gx + 3; x++) if (solid(b, x, y)) b.set(x, y, TRANSPARENT);
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

/**
 * Cut stump.
 *
 * End grain is a place where the generated ellipse loses: at r=6 a ring drawn
 * by a rasteriser is either a doughnut (perfectly concentric, even weight) or a
 * broken smear. So the whole face is hand-placed. What sells it is that the
 * rings are *eccentric* — crowded to one side of the pith — and that a radial
 * crack runs from the pith out through the bark. The side is vertical bark
 * strips, which is also what stops the top ellipse reading as a floating disc.
 *
 *   b bark rim   p heartwood   r growth ring   k pith / crack
 *   L lit bark   s bark        d bark seam & ground contact
 */
const STUMP_ART = [
  '...bppppppb...',
  '.bppprrrrrppb.',
  'bppprpkpprpppb',
  'bppprppkprpppb',
  '.bppprrrkkppb.',
  '...bbbbbbbb...',
  'dLLdssdssdssdd',
  'dLLddsdssdssdd',
  '.LLdssdssdssd.',
  '.Lddssdssdssd.',
  '...dddddddd...',
];

export function stump(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(20, 16);
  b.groundShadow(10, 14, 8, 2.5, 110);
  const art = parseArt(STUMP_ART, {
    b: R.wood[1],
    p: R.wood[3],
    r: R.wood[1],
    k: R.wood[0],
    L: R.wood[2],
    s: R.wood[1],
    d: R.wood[0],
  });
  b.blit(art, 3, 3);
  // Per-instance bark nicks so a row of stumps isn't stamped out.
  for (let i = 0; i < 3; i++) b.set(rng.int(4, 15), rng.int(10, 12), R.wood[0]);
  b.selOutline();
  return b;
}

/**
 * Fallen log.
 *
 * A flat brown rectangle is a pipe. What makes it a log is the end grain —
 * a pale disc with rings on both cut faces — plus a barrel that steps down the
 * wood ramp from a lit top edge to a dark underside, bark splits running with
 * the grain (i.e. horizontally), and one knot where a branch was.
 */
const LOG_END = [
  '..b..',
  '.bpb.',
  'bprpb',
  'brppb',
  'brkpb',
  'brppb',
  'bprkb',
  '.bbb.',
  '..b..',
];

const LOG_END_FAR = [
  '..b..',
  '.bpb.',
  'bprpb',
  'bpprb',
  'bpkrb',
  'bpprb',
  'bprpb',
  '.bbb.',
  '..b..',
];

export function log(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(40, 16);
  b.groundShadow(20, 13, 17, 2.5, 110);

  // Barrel: flat bands down the ramp, no gradient.
  const band = [3, 2, 2, 2, 1, 1, 1, 0, 0];
  for (let x = 5; x <= 35; x++) for (let y = 4; y <= 12; y++) b.set(x, y, R.wood[band[y - 4]]);

  // Bark splits: broken horizontal lines, one step darker than their row.
  for (const [ly, lx0, lx1, col] of [
    [5, 9, 20, R.wood[1]],
    [7, 15, 28, R.wood[1]],
    [9, 12, 22, R.wood[0]],
    [10, 24, 32, R.wood[0]],
  ] as [number, number, number, RGBA][]) {
    for (let x = lx0; x <= lx1; x++) if ((x - lx0) % 6 !== 4) b.set(x, ly, col);
  }

  // Knot: the stub of a broken branch, lit on its upper-left lip.
  b.ellipse(25, 7.5, 2.3, 1.7, R.wood[0]);
  b.ellipse(25, 7.2, 1.5, 1.0, R.wood[1]);
  b.set(24, 7, R.wood[3]);
  b.set(25, 6, R.wood[2]);

  // Cut faces, hand-placed for the same reason as the stump's: a 5x9 disc of
  // end grain has room for exactly one ring, and it has to be off-centre.
  b.blit(parseArt(LOG_END, { b: R.wood[0], p: R.wood[3], r: R.wood[1], k: R.wood[0] }), 3, 4);
  // Far end: same construction, one step down the ramp, ring mirrored.
  b.blit(parseArt(LOG_END_FAR, { b: R.wood[0], p: R.wood[2], r: R.wood[1], k: R.wood[0] }), 33, 4);

  // A little moss along the lit top edge.
  for (let i = 0; i < 3; i++) {
    const mx = rng.int(10, 30);
    b.fillRect(mx, 4, 2, 1, R.leaf[1]);
    b.set(mx + rng.int(0, 1), 5, R.leaf[0]);
  }
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

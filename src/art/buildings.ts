/**
 * Town architecture, drawn in the same 3/4 top-down projection as everything
 * else: you see the roof from above and the front wall face-on beneath it.
 *
 * A building is mostly roof, so the roof is where the craft goes — shingles are
 * laid in offset courses like real ones, the ridge catches the key light and
 * the eaves cast a hard shadow line onto the wall. Walls are half-timbered
 * (plaster panels between dark beams) which gives a small sprite a lot of
 * structure for very few pixels.
 */
import { PixelBuffer, rgba, shade, type RGBA } from './pixel';
import { P, R, type Ramp } from './palette';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';
import { RNG, hash2 } from '../engine/rng';

export type RoofStyle = 'shingle' | 'thatch' | 'tile';

export interface BuildingOpts {
  /** Wall width in pixels; the roof overhangs it by 3px on each side. */
  w: number;
  wallH: number;
  roofH: number;
  wall: Ramp;
  roofRamp: Ramp;
  roof?: RoofStyle;
  door?: 'center' | 'left' | 'right' | 'none';
  windows?: number;
  /** Lit windows at night; these become light sources in the scene. */
  chimney?: boolean;
  timbered?: boolean;
  stoneBase?: boolean;
  seed?: number;
  /** Extra height for a second storey of windows. */
  storeys?: 1 | 2;
  /** Overhang the upper storey past the lower one (timber-frame jetty). */
  jetty?: boolean;
  /** A single-pitch outbuilding stuck on one side. */
  lean?: 'none' | 'left' | 'right';
  /** Windows poking out of the roof plane. */
  dormers?: number;
  ivy?: boolean;
}

export interface Building {
  buffer: PixelBuffer;
  /** Anchor: bottom centre of the wall. */
  ax: number;
  ay: number;
  /** Window centres, relative to the anchor — used to place warm lights. */
  windows: { x: number; y: number }[];
  /** Chimney top, relative to the anchor, for the smoke emitter. */
  chimney?: { x: number; y: number };
  /** Half-width / height of the solid footprint, for collision. */
  solidW: number;
  solidH: number;
}

/**
 * A gable roof, drawn as a roof and not as a rectangle.
 *
 * Seen from the front-and-above you see one roof plane running up to the ridge.
 * That plane is a **trapezoid** — wide at the eaves, narrower at the ridge —
 * and its two sloping edges carry barge boards. Above the ridge a couple of
 * pixels of the far plane show in a darker value. Drawing the roof as a plain
 * rectangle is what made the first version of these buildings read as boxes.
 */
function gableRoof(
  b: PixelBuffer,
  cx: number,
  top: number,
  h: number,
  eaveHalf: number,
  ridgeHalf: number,
  ramp: Ramp,
  style: RoofStyle,
  seed: number,
): void {
  // Far slope peeking over the ridge.
  b.fillRect(cx - ridgeHalf, top - 2, ridgeHalf * 2, 3, ramp[1]);

  for (let j = 0; j < h; j++) {
    const t = j / (h - 1);
    const half = Math.round(ridgeHalf + (eaveHalf - ridgeHalf) * t);
    const y = top + j;
    for (let x = cx - half; x <= cx + half; x++) {
      const i = x - (cx - half);
      const w = half * 2 + 1;
      let step: number;
      if (style === 'thatch') {
        const course = 5;
        const within = j % course;
        const shift = Math.floor(hash2(Math.floor(j / course), seed) * 4);
        step = t < 0.28 ? 3 : t < 0.7 ? 2 : 1;
        if ((i + shift) % 3 === 0 && within > 0 && within < course - 1) step += 1;
        if (within === course - 1) step -= 2;
      } else if (style === 'tile') {
        const course = 5;
        const row = Math.floor(j / course);
        const within = j % course;
        const lx = (i + (row % 2) * 2) % 4;
        step = t < 0.3 ? 3 : 2;
        if (lx === 0) step -= 1;
        else if (lx === 1) step += 1;
        if (within === 0) step -= 2;
        else if (within === 1) step += 1;
      } else {
        const course = 4;
        const row = Math.floor(j / course);
        const lx = (i + (row % 2) * 3) % 6;
        step = t < 0.28 ? 3 : t < 0.66 ? 2 : 1;
        if (j % course === 0) step -= 1;
        if (lx === 0) step -= 1;
        if (hash2(i * 3 + j, seed) > 0.94) step -= 1;
      }
      // Barge boards: the sloping edges of the gable, in timber.
      if (i < 2 || i > w - 3) step = -9;
      b.set(x, y, step === -9 ? R.wood[1] : ramp[Math.max(0, Math.min(4, step))]);
    }
  }
  // Ridge cap, brightest line on the building.
  b.fillRect(cx - ridgeHalf - 1, top, ridgeHalf * 2 + 3, 2, ramp[4]);
  b.hline(cx - ridgeHalf - 1, cx + ridgeHalf + 1, top + 2, ramp[3]);
}

/** A single-pitch lean-to stuck on the side of a building. */
function leanTo(b: PixelBuffer, x0: number, baseY: number, w: number, wallH: number, roofH: number, ramp: Ramp): void {
  b.fillRect(x0, baseY - wallH, w, wallH, R.wood[2]);
  for (let i = 0; i < w; i += 3) b.vline(x0 + i, baseY - wallH, baseY - 1, R.wood[1]);
  b.fillRect(x0, baseY - wallH - roofH, w, roofH, ramp[2]);
  b.hline(x0, x0 + w - 1, baseY - wallH - roofH, ramp[4]);
  b.hline(x0, x0 + w - 1, baseY - wallH - 1, R.night[1]);
  for (let j = 1; j < roofH; j += 3) b.hline(x0, x0 + w - 1, baseY - wallH - roofH + j, ramp[1]);
}

function drawWindow(b: PixelBuffer, x: number, y: number, shutters: boolean, box: boolean): void {
  b.fillRect(x - 3, y - 3, 7, 7, R.wood[1]);
  b.fillRect(x - 2, y - 2, 5, 5, R.gold[4]);
  b.fillRect(x - 2, y - 2, 5, 2, R.gold[3]);
  b.set(x - 2, y - 2, R.gold[2]);
  b.vline(x, y - 2, y + 2, R.wood[1]);
  b.hline(x - 2, x + 2, y, R.wood[1]);
  b.fillRect(x - 4, y + 4, 9, 1, R.wood[3]);
  if (shutters) {
    for (const sx of [x - 5, x + 4]) {
      b.fillRect(sx, y - 3, 2, 7, R.teal[1]);
      b.vline(sx, y - 3, y + 3, R.teal[2]);
    }
  }
  if (box) {
    b.fillRect(x - 4, y + 5, 9, 3, R.wood[1]);
    b.hline(x - 4, x + 4, y + 5, R.wood[2]);
    for (let i = -3; i <= 3; i += 2) {
      b.set(x + i, y + 4, R.leaf[2]);
      b.set(x + i, y + 3, i % 4 === 1 ? R.red[3] : R.gold[4]);
    }
  }
}

function drawDoor(b: PixelBuffer, x: number, y: number, w: number, h: number, canopy: boolean): void {
  b.fillRect(x - w / 2 - 1, y - h - 1, w + 2, h + 1, R.wood[1]);
  b.fillRect(x - w / 2, y - h, w, h, R.wood[2]);
  for (let i = 0; i < w; i += 3) b.vline(x - w / 2 + i, y - h, y - 1, R.wood[1]);
  b.hline(x - w / 2, x + w / 2 - 1, y - h, R.wood[3]);
  b.hline(x - w / 2, x + w / 2 - 1, y - h + 3, R.metal[1]);
  b.hline(x - w / 2, x + w / 2 - 1, y - 4, R.metal[1]);
  b.set(x + w / 2 - 2, y - Math.round(h / 2), R.gold[3]);
  b.fillRect(x - w / 2 - 2, y, w + 4, 1, R.stone[2]);
  b.fillRect(x - w / 2 - 1, y - 1, w + 2, 1, R.stone[3]);
  if (canopy) {
    // A little pitched hood over the doorway, on two brackets.
    const cw = w + 8;
    b.fillRect(x - cw / 2, y - h - 5, cw, 3, R.wood[1]);
    b.hline(x - cw / 2, x + cw / 2 - 1, y - h - 5, R.wood[3]);
    b.set(x - cw / 2 + 1, y - h - 2, R.wood[1]);
    b.set(x + cw / 2 - 2, y - h - 2, R.wood[1]);
  }
}

/** A dormer poking out of the roof plane. */
function dormer(b: PixelBuffer, x: number, y: number, ramp: Ramp): void {
  b.fillRect(x - 6, y, 13, 9, R.paper[3]);
  b.fillRect(x - 6, y + 7, 13, 2, R.paper[2]);
  for (let j = 0; j < 5; j++) {
    const half = 7 - j;
    b.fillRect(x - half, y - 5 + j, half * 2 + 1, 1, ramp[j < 2 ? 3 : 2]);
  }
  b.hline(x - 7, x + 7, y - 5, ramp[4]);
  b.fillRect(x - 2, y + 2, 5, 5, R.wood[1]);
  b.fillRect(x - 1, y + 3, 3, 3, R.gold[4]);
}

export function building(opts: BuildingOpts): Building {
  const {
    w,
    wallH,
    roofH,
    wall,
    roofRamp,
    roof = 'shingle',
    door = 'center',
    windows = 2,
    chimney = false,
    timbered = true,
    stoneBase = false,
    seed = 1,
    storeys = 1,
    jetty = storeys === 2,
    lean = 'none',
    dormers = 0,
    ivy = false,
  } = opts;

  const rng = new RNG(seed);
  const eaveHalf = Math.round(w / 2) + 4;
  const ridgeHalf = Math.max(4, Math.round(eaveHalf * 0.42));
  const leanW = lean === 'none' ? 0 : Math.round(w * 0.34);
  const bw = eaveHalf * 2 + 10 + leanW * 2;
  const bh = roofH + wallH + 12;
  const b = new PixelBuffer(bw, bh);
  const cx = Math.round(bw / 2);
  const baseY = bh - 4;
  const wallTop = baseY - wallH;
  const roofTop = wallTop - roofH;
  // The upper storey overhangs the lower one — a jetty. Very characteristic of
  // timber-framed towns, and it breaks the flat slab of wall for three pixels
  // of work.
  const upperHalf = Math.round(w / 2);
  const lowerHalf = jetty ? upperHalf - 3 : upperHalf;
  const jettyY = jetty ? wallTop + Math.round(wallH * 0.46) : baseY;

  b.groundShadow(cx, baseY + 1, lowerHalf + 3, 3, 120);

  // --- lean-to behind the main block --------------------------------------
  if (lean !== 'none') {
    const lx = lean === 'left' ? cx - upperHalf - leanW : cx + upperHalf;
    leanTo(b, lx, baseY, leanW, Math.round(wallH * 0.55), 8, roofRamp);
  }

  // --- walls ---------------------------------------------------------------
  const paintWall = (x0: number, x1: number, y0: number, y1: number): void => {
    b.fillRect(x0, y0, x1 - x0, y1 - y0, wall[3]);
    b.fillRect(x0, y0, x1 - x0, 2, wall[4]);
    b.fillRect(x0, y1 - 3, x1 - x0, 3, wall[2]);
  };
  paintWall(cx - upperHalf, cx + upperHalf, wallTop, jettyY);
  paintWall(cx - lowerHalf, cx + lowerHalf, jettyY, baseY);
  if (jetty) {
    // Joist ends under the overhang, and the shadow it casts.
    b.hline(cx - upperHalf, cx + upperHalf - 1, jettyY, R.wood[1]);
    b.hline(cx - lowerHalf, cx + lowerHalf - 1, jettyY + 1, R.night[1]);
    for (let x = cx - upperHalf + 2; x < cx + upperHalf; x += 6) b.fillRect(x, jettyY - 1, 2, 2, R.wood[2]);
  }
  if (stoneBase) {
    for (let y = baseY - 7; y < baseY; y++)
      for (let x = cx - lowerHalf; x < cx + lowerHalf; x++) {
        const n = ((x * 7 + y * 13) % 11) / 11;
        b.set(x, y, n > 0.7 ? R.stone[3] : n > 0.3 ? R.stone[2] : R.stone[1]);
      }
  }
  if (timbered) {
    for (const [x0, x1, y0, y1] of [
      [cx - upperHalf, cx + upperHalf, wallTop, jettyY],
      [cx - lowerHalf, cx + lowerHalf, jettyY, baseY],
    ] as [number, number, number, number][]) {
      b.fillRect(x0, y0, 2, y1 - y0, R.wood[1]);
      b.fillRect(x1 - 2, y0, 2, y1 - y0, R.wood[1]);
      const mid = y0 + Math.round((y1 - y0) / 2);
      b.fillRect(x0, mid - 1, x1 - x0, 2, R.wood[1]);
      b.line(x0 + 2, mid - 2, x0 + 8, y0 + 1, R.wood[1]);
      b.line(x1 - 3, mid - 2, x1 - 9, y0 + 1, R.wood[1]);
    }
  }

  // --- windows + door -----------------------------------------------------
  const winList: { x: number; y: number }[] = [];
  const rows: [number, number][] =
    storeys === 2
      ? [
          [wallTop + 8, upperHalf],
          [jettyY + Math.round((baseY - jettyY) * 0.42), lowerHalf],
        ]
      : [[wallTop + Math.round(wallH * 0.38), upperHalf]];
  for (const [wy, half] of rows) {
    for (let i = 0; i < windows; i++) {
      const t = (i + 1) / (windows + 1);
      const wxp = Math.round(cx - half + t * half * 2);
      if (door !== 'none' && wy > baseY - wallH * 0.55 && Math.abs(wxp - cx) < 10) continue;
      drawWindow(b, wxp, wy, rng.chance(0.6), rng.chance(0.45));
      winList.push({ x: wxp - cx, y: wy - baseY });
    }
  }
  if (door !== 'none') {
    const dx = door === 'center' ? cx : door === 'left' ? cx - lowerHalf + 10 : cx + lowerHalf - 10;
    drawDoor(b, dx, baseY, 10, Math.min(16, baseY - jettyY - 2), rng.chance(0.5));
  }

  // --- roof ---------------------------------------------------------------
  gableRoof(b, cx, roofTop, roofH, eaveHalf, ridgeHalf, roofRamp, roof, seed);
  // Hard shadow the eave throws onto the wall.
  b.hline(cx - upperHalf, cx + upperHalf - 1, wallTop, R.night[1]);
  for (let i = 0; i < dormers; i++) {
    const t = (i + 1) / (dormers + 1);
    dormer(b, Math.round(cx - eaveHalf * 0.6 + t * eaveHalf * 1.2), roofTop + Math.round(roofH * 0.5), roofRamp);
  }

  // --- chimney ------------------------------------------------------------
  let chim: { x: number; y: number } | undefined;
  if (chimney) {
    const chx = cx + Math.round(w * 0.3);
    const chTop = roofTop - 9;
    b.fillRect(chx - 3, chTop, 6, 13, R.stone[2]);
    b.fillRect(chx - 3, chTop, 6, 2, R.stone[3]);
    b.fillRect(chx - 4, chTop, 8, 2, R.stone[3]);
    b.vline(chx + 2, chTop, chTop + 12, R.stone[1]);
    b.fillRect(chx - 2, chTop + 1, 4, 1, R.night[0]);
    chim = { x: chx - cx, y: chTop - baseY };
  }

  // --- climbing ivy, to break a blank corner ------------------------------
  if (ivy) {
    const side = rng.chance(0.5) ? -1 : 1;
    const ex = cx + side * (lowerHalf - 3);
    for (let y = baseY - 2; y > wallTop + 4; y -= 2) {
      const spread = Math.max(1, Math.round((baseY - y) / 10));
      for (let k = 0; k < spread; k++) {
        const px = ex - side * rng.int(0, 4);
        b.set(px, y - rng.int(0, 1), rng.chance(0.5) ? R.leaf[1] : R.leaf[2]);
        b.set(px - side, y, R.leaf[0]);
      }
    }
  }

  b.selOutline();
  return {
    buffer: b,
    ax: cx,
    ay: baseY,
    windows: winList,
    chimney: chim,
    solidW: lowerHalf + (lean === 'none' ? 0 : leanW * 0.6),
    solidH: wallH + roofH * 0.35,
  };
}

// ---------------------------------------------------------------------------
// Hanging trade signs
// ---------------------------------------------------------------------------

export type SignKind = 'tavern' | 'inn' | 'smith' | 'shop' | 'bakery';

const SIGN_GLYPH: Record<SignKind, string[]> = {
  // A foaming tankard.
  tavern: ['..fff..', '.fffff.', 'MMMMMMM', 'MMMMMMm', 'MMMMMMM', '.MMMMM.', '..MMM..'],
  // A bed.
  inn: ['.......', 'ff.....', 'fffffff', 'MMMMMMM', 'M.....M', '.......', '.......'],
  // An anvil.
  smith: ['.......', '.MMMMM.', 'MMMMMMM', '..MMM..', '..MMM..', '.MMMMM.', '.......'],
  // A coin purse.
  shop: ['..MMM..', '.MMMMM.', 'MMMMMMM', 'MMfMfMM', 'MMMMMMM', '.MMMMM.', '..MMM..'],
  // A loaf.
  bakery: ['.......', '..MMM..', '.MMMMM.', 'MMfMfMM', 'MMMMMMM', '.MMMMM.', '.......'],
};

export function tradeSign(kind: SignKind): PixelBuffer {
  const b = new PixelBuffer(18, 20);
  // Bracket arm
  b.fillRect(0, 1, 12, 2, R.metal[1]);
  b.line(1, 3, 5, 7, R.metal[1]);
  b.vline(10, 2, 5, R.metal[1]);
  // Board
  b.fillRect(3, 5, 13, 13, R.wood[1]);
  b.fillRect(4, 6, 11, 11, R.wood[2]);
  b.hline(4, 14, 6, R.wood[3]);
  const glyph = SIGN_GLYPH[kind];
  for (let j = 0; j < glyph.length; j++)
    for (let i = 0; i < glyph[j].length; i++) {
      const ch = glyph[j][i];
      if (ch === '.') continue;
      b.set(5 + i, 8 + j, ch === 'M' ? R.gold[3] : ch === 'm' ? R.gold[1] : R.paper[4]);
    }
  b.selOutline();
  return b;
}

// ---------------------------------------------------------------------------
// The mill wheel
// ---------------------------------------------------------------------------

/**
 * Undershot water wheel, 8 frames.
 *
 * With 8 paddles the wheel repeats every 45 degrees, so the loop only needs to
 * cover 45/8 degrees per frame to read as continuous rotation — turning it a
 * full 45 degrees per frame would look completely static.
 */
export function waterWheelClip(): Clip {
  const frames: PixelBuffer[] = [];
  const RAD = 17;
  const size = RAD * 2 + 8;
  const cx = size / 2;
  const cy = size / 2;
  const PADDLES = 8;
  for (let f = 0; f < 8; f++) {
    const b = new PixelBuffer(size, size);
    const rot = (f / 8) * ((Math.PI * 2) / PADDLES);
    // Rims
    b.ellipse(cx, cy, RAD, RAD, R.wood[1], false);
    b.ellipse(cx, cy, RAD - 3, RAD - 3, R.wood[1], false);
    for (let i = 0; i < PADDLES; i++) {
      const a = rot + (i / PADDLES) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Spoke
      b.line(cx + ca * 3, cy + sa * 3, cx + ca * (RAD - 2), cy + sa * (RAD - 2), R.wood[2]);
      // Paddle: a short bar tangent to the rim.
      const px = cx + ca * (RAD - 1);
      const py = cy + sa * (RAD - 1);
      b.capsule(px - sa * 4, py + ca * 4, px + sa * 4, py - ca * 4, 1.4, R.wood[3]);
      // Water clinging to the paddles on the way up out of the river.
      if (sa > 0.2 && ca > 0) b.capsule(px - sa * 3, py + ca * 3, px + sa * 3, py - ca * 3, 1, R.water[3]);
    }
    // Hub
    b.ellipse(cx, cy, 4, 4, R.wood[2]);
    b.ellipse(cx, cy, 2, 2, R.metal[1]);
    b.selOutline();
    frames.push(b);
  }
  return clip(bakeSheet(frames, cx, size - 2), frames.map((_, i) => i), 14);
}

// ---------------------------------------------------------------------------
// Farm & market dressing
// ---------------------------------------------------------------------------

export function haystack(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(32, 30);
  const cx = 16;
  b.groundShadow(cx, 27, 13, 3, 120);
  // A rick is a cone: a clean row-width profile, lit hard from the left, with
  // horizontal binding ropes. The value split does the work, not speckle.
  const profile = [2, 4, 6, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 13];
  const top = 12;
  for (let i = 0; i < profile.length; i++) {
    const y = top + i;
    const half = profile[i];
    const split = cx - Math.round(half * 0.25);
    for (let x = cx - half; x <= cx + half; x++) {
      let step = x < split ? 3 : x < cx + half - 2 ? 2 : 1;
      if (i < 2) step += 1;
      if (i > profile.length - 3) step -= 1;
      // Straw ticks read as texture only near the lit/shade boundary.
      if ((x + i) % 5 === 0 && x > split - 4 && x < split + 6) step -= 1;
      b.set(x, y, R.sand[Math.max(0, Math.min(4, step))]);
    }
  }
  // Peak: a twisted straw finial on a pole.
  b.vline(cx, 6, top + 1, R.sand[2]);
  b.line(cx, 6, cx - 3, top, R.sand[4]);
  b.line(cx, 6, cx + 3, top, R.sand[3]);
  b.set(cx, 5, R.sand[4]);
  // Two binding ropes around the rick.
  for (const ry of [top + 5, top + 10]) {
    const half = profile[ry - top];
    b.hline(cx - half + 1, cx + half - 1, ry, R.wood[1]);
  }
  // Loose straw scattered at the base.
  for (let i = 0; i < 9; i++) b.set(rng.int(2, 29), 26 + rng.int(0, 1), R.sand[2]);
  b.selOutline();
  return b;
}

export function scarecrow(): PixelBuffer {
  const b = new PixelBuffer(24, 34);
  b.groundShadow(12, 31, 6, 2, 110);
  // Cross frame: the post is 2px, the arm only 1px so it doesn't read as a log.
  b.fillRect(11, 10, 2, 21, R.wood[1]);
  b.hline(5, 18, 15, R.wood[1]);
  b.hline(5, 18, 16, R.wood[0]);
  // Straw-stuffed shirt, sleeves ending in tufts of straw for hands.
  b.fillRect(7, 13, 10, 11, R.red[2]);
  b.fillRect(7, 13, 10, 2, R.red[3]);
  b.fillRect(7, 21, 10, 3, R.red[1]);
  b.fillRect(5, 14, 2, 3, R.red[2]);
  b.fillRect(17, 14, 2, 3, R.red[1]);
  for (const [x, c] of [
    [4, R.sand[3]],
    [19, R.sand[2]],
  ] as [number, RGBA][]) {
    b.set(x, 15, c);
    b.set(x, 16, c);
    b.set(x + (x < 12 ? -1 : 1), 16, c);
  }
  for (let i = 0; i < 5; i++) b.set(8 + i * 2, 24 + (i % 2), R.sand[3]);
  // Sack head with a stitched face and a battered hat.
  b.fillRect(8, 4, 8, 8, R.sand[3]);
  b.fillRect(8, 4, 8, 2, R.sand[4]);
  b.set(10, 7, R.night[0]);
  b.set(13, 7, R.night[0]);
  b.hline(10, 13, 10, R.night[0]);
  b.fillRect(6, 2, 12, 2, R.wood[2]);
  b.fillRect(9, 0, 6, 3, R.wood[2]);
  b.hline(9, 14, 0, R.wood[3]);
  b.selOutline();
  return b;
}

export function marketStall(accent: RGBA, seed: number): PixelBuffer {
  const b = new PixelBuffer(40, 36);
  const rng = new RNG(seed);
  b.groundShadow(20, 33, 16, 3, 120);
  // Posts
  for (const x of [4, 34]) b.fillRect(x, 10, 2, 22, R.wood[1]);
  // Counter with goods on it
  b.fillRect(3, 24, 34, 3, R.wood[2]);
  b.hline(3, 36, 24, R.wood[3]);
  b.fillRect(3, 27, 34, 5, R.wood[1]);
  for (let i = 0; i < 7; i++) {
    const x = 6 + i * 4 + rng.int(0, 1);
    const c: Ramp = rng.pick([R.red, R.gold, R.leaf, R.purple]);
    b.ellipse(x, 22, 1.6, 1.6, c[3]);
    b.set(x - 1, 21, c[4]);
  }
  // Striped awning: a shallow arc of alternating colour.
  for (let x = 0; x < 40; x++) {
    const dip = Math.round(Math.abs(x - 20) * 0.12);
    const stripe = Math.floor(x / 4) % 2 === 0;
    for (let y = 6 + dip; y < 12 + dip; y++) {
      b.set(x, y, stripe ? accent : R.paper[3]);
    }
    b.set(x, 6 + dip, stripe ? shade(accent, 0.3) : R.paper[4]);
    b.set(x, 11 + dip, stripe ? shade(accent, -0.3) : R.paper[2]);
  }
  b.selOutline();
  return b;
}

export function cart(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(38, 26);
  b.groundShadow(19, 23, 15, 3, 110);
  // Bed
  b.fillRect(4, 10, 30, 9, R.wood[2]);
  b.hline(4, 33, 10, R.wood[3]);
  for (let x = 6; x < 33; x += 4) b.vline(x, 11, 18, R.wood[1]);
  b.fillRect(4, 8, 30, 2, R.wood[1]);
  // Cargo
  for (let i = 0; i < 4; i++) {
    const x = 8 + i * 6;
    b.fillRect(x, 4 + rng.int(0, 2), 5, 5, R.sand[3]);
    b.fillRect(x, 4 + rng.int(0, 2), 5, 1, R.sand[4]);
  }
  // Wheels
  for (const wx of [10, 28]) {
    b.ellipse(wx, 20, 5, 5, R.wood[1], false);
    b.ellipse(wx, 20, 1.5, 1.5, R.wood[2]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      b.line(wx - Math.cos(a) * 4, 20 - Math.sin(a) * 4, wx + Math.cos(a) * 4, 20 + Math.sin(a) * 4, R.wood[2]);
    }
  }
  b.selOutline();
  return b;
}

export function lamppost(): Clip {
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 4; f++) {
    const b = new PixelBuffer(14, 40);
    b.groundShadow(7, 37, 5, 2, 110);
    b.fillRect(6, 12, 2, 25, R.metal[1]);
    b.fillRect(4, 35, 6, 3, R.metal[1]);
    b.fillRect(4, 35, 6, 1, R.metal[2]);
    // Lantern housing
    b.fillRect(3, 4, 8, 9, R.metal[1]);
    b.fillRect(4, 5, 6, 7, R.gold[4 - (f % 2)]);
    b.fillRect(4, 5, 6, 2, R.gold[3]);
    b.vline(7, 5, 11, R.metal[1]);
    b.fillRect(2, 2, 10, 2, R.metal[2]);
    b.set(7, 1, R.metal[2]);
    b.selOutline();
    frames.push(b);
  }
  return clip(bakeSheet(frames, 7, 38), [0, 1, 2, 1], 6);
}

/** Rows of crops for the fields. `growth` 0..1. */
export function cropRow(kind: 'wheat' | 'cabbage', seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(16, 18);
  if (kind === 'wheat') {
    for (let i = 0; i < 5; i++) {
      const x = 2 + i * 3 + rng.int(0, 1);
      const h = rng.int(9, 13);
      const bend = rng.int(-1, 1);
      for (let j = 0; j < h; j++) {
        b.set(x + (j > h - 4 ? bend : 0), 15 - j, j < 3 ? R.leaf[1] : R.sand[2]);
      }
      // Ear of grain
      const ty = 15 - h;
      b.fillRect(x + bend - 1, ty - 3, 3, 4, R.gold[3]);
      b.set(x + bend - 1, ty - 3, R.gold[4]);
      b.set(x + bend + 1, ty - 1, R.gold[1]);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const x = 3 + i * 5;
      const y = 13 - rng.int(0, 1);
      b.ellipse(x, y, 2.6, 2, R.leaf[1]);
      b.ellipse(x, y - 0.5, 2, 1.4, R.leaf[2]);
      b.set(x - 1, y - 1, R.leaf[3]);
    }
  }
  b.selOutline();
  return b;
}

export interface BuildingAssets {
  cottages: Building[];
  tavern: Building;
  inn: Building;
  smithy: Building;
  shop: Building;
  chapel: Building;
  mill: Building;
  barn: Building;
  waterWheel: Clip;
  signs: Record<SignKind, Sheet>;
  haystacks: Sheet[];
  scarecrow: Sheet;
  stalls: Sheet[];
  cart: Sheet;
  lamppost: Clip;
  wheat: Sheet[];
  cabbage: Sheet[];
}

function still(b: PixelBuffer, ax: number, ay: number): Sheet {
  return bakeSheet([b], ax, ay);
}

export function bakeBuildings(): BuildingAssets {
  const cottages = [
    building({ w: 52, wallH: 28, roofH: 28, wall: R.paper, roofRamp: R.wood, roof: 'thatch', windows: 2, chimney: true, seed: 3, lean: 'right', ivy: true }),
    building({ w: 44, wallH: 26, roofH: 24, wall: R.sand, roofRamp: R.red, roof: 'tile', windows: 2, chimney: true, seed: 5 }),
    building({ w: 60, wallH: 34, roofH: 30, wall: R.paper, roofRamp: R.wood, roof: 'shingle', windows: 3, chimney: true, seed: 7, stoneBase: true, lean: 'left', dormers: 1 }),
    building({ w: 40, wallH: 24, roofH: 22, wall: R.sand, roofRamp: R.wood, roof: 'thatch', windows: 1, chimney: true, seed: 11, ivy: true }),
  ];
  return {
    cottages,
    tavern: building({
      w: 74,
      wallH: 40,
      roofH: 30,
      wall: R.sand,
      roofRamp: R.red,
      roof: 'tile',
      windows: 3,
      storeys: 2,
      chimney: true,
      stoneBase: true,
      seed: 21,
      lean: 'left',
      dormers: 2,
    }),
    inn: building({
      w: 82,
      wallH: 44,
      roofH: 32,
      wall: R.paper,
      roofRamp: R.wood,
      roof: 'shingle',
      windows: 4,
      storeys: 2,
      chimney: true,
      stoneBase: true,
      seed: 23,
      dormers: 2,
      ivy: true,
    }),
    smithy: building({
      w: 56,
      wallH: 28,
      roofH: 22,
      wall: R.stone,
      roofRamp: R.metal,
      roof: 'shingle',
      windows: 1,
      chimney: true,
      timbered: false,
      stoneBase: true,
      seed: 29,
      lean: 'right',
    }),
    shop: building({ w: 54, wallH: 34, roofH: 26, wall: R.paper, roofRamp: R.leaf, roof: 'tile', windows: 2, chimney: true, seed: 31, storeys: 2, dormers: 1 }),
    chapel: building({
      w: 46,
      wallH: 46,
      roofH: 34,
      wall: R.stone,
      roofRamp: R.metal,
      roof: 'shingle',
      windows: 2,
      storeys: 2,
      timbered: false,
      stoneBase: true,
      door: 'center',
      seed: 37,
    }),
    mill: building({
      w: 62,
      wallH: 44,
      roofH: 30,
      wall: R.stone,
      roofRamp: R.wood,
      roof: 'shingle',
      windows: 2,
      storeys: 2,
      chimney: false,
      timbered: false,
      stoneBase: true,
      seed: 41,
      lean: 'left',
      dormers: 1,
    }),
    barn: building({
      w: 70,
      wallH: 34,
      roofH: 30,
      wall: R.red,
      roofRamp: R.wood,
      roof: 'shingle',
      windows: 2,
      chimney: false,
      timbered: false,
      seed: 43,
    }),
    waterWheel: waterWheelClip(),
    signs: {
      tavern: still(tradeSign('tavern'), 2, 2),
      inn: still(tradeSign('inn'), 2, 2),
      smith: still(tradeSign('smith'), 2, 2),
      shop: still(tradeSign('shop'), 2, 2),
      bakery: still(tradeSign('bakery'), 2, 2),
    },
    haystacks: [still(haystack(2), 16, 28), still(haystack(9), 16, 28)],
    scarecrow: still(scarecrow(), 12, 32),
    stalls: [
      still(marketStall(R.red[2], 1), 20, 33),
      still(marketStall(R.teal[2], 2), 20, 33),
      still(marketStall(R.purple[2], 3), 20, 33),
    ],
    cart: still(cart(5), 19, 24),
    lamppost: lamppost(),
    wheat: [still(cropRow('wheat', 1), 8, 16), still(cropRow('wheat', 2), 8, 16), still(cropRow('wheat', 3), 8, 16)],
    cabbage: [still(cropRow('cabbage', 4), 8, 16), still(cropRow('cabbage', 5), 8, 16)],
  };
}

/** Window glow colour, shared by the scene lights. */
export const WINDOW_LIGHT: RGBA = rgba(P.fireHot, 255);

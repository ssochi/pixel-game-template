/**
 * Town architecture, drawn in the same 3/4 top-down projection as everything
 * else: you see the roof from above and the front wall face-on beneath it.
 *
 * **Everything here is measured against the player.** A villager is 30px from
 * sole to crown, so a door has to be about 26px of opening and a storey about
 * 38px of wall — anything less and the building reads as a doll's house no
 * matter how nicely the shingles are laid. That single ratio is what the whole
 * table at the bottom of this file is built on; the first version of these
 * buildings had 15px doors and 26px walls, which is why every house in town
 * looked like a toy someone had left on the grass.
 *
 * A building is mostly roof, so the roof is where the craft goes — shingles are
 * laid in offset courses like real ones, the ridge catches the key light and
 * the eaves cast a hard 2px shadow onto the wall. Walls are half-timbered
 * (plaster panels between dark beams, each beam with a 1px shadow seam so the
 * timber sits *proud* of the plaster) or laid in coursed masonry, which gives a
 * facade a lot of structure for very few pixels.
 */
import { PixelBuffer, rgba, shade, TRANSPARENT, type RGBA } from './pixel';
import { P, R, type Ramp } from './palette';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';
import { RNG, hash2 } from '../engine/rng';

export type RoofStyle = 'shingle' | 'thatch' | 'tile';

/** Visible height of a villager, sole to crown. The unit everything else uses. */
export const FIGURE_H = 30;
/** Door opening height. A 30px figure standing on the threshold clears it. */
export const DOOR_H = 26;
/** Door opening width *including* the frame; the leaf inside it is 10px. */
export const DOOR_W = 14;
/** Shortest storey allowed: the door plus its hood plus the eaves above. */
export const STOREY_MIN = 38;

export interface BuildingOpts {
  /** Wall width in pixels; the roof overhangs it by 5px on each side. */
  w: number;
  /** Total wall height, base to eaves. Split between storeys when `storeys` is 2. */
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
  /** A masonry plinth along the bottom of the ground floor. */
  stoneBase?: boolean;
  /** The whole ground floor in coursed masonry — shops and the forge. */
  stoneLower?: boolean;
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
  /** An iron bracket over the door, for a hanging trade sign. */
  signBar?: boolean;
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
  /** Where a hanging trade sign's bracket meets the wall, relative to the anchor. */
  sign: { x: number; y: number };
  /** Half-width / height of the solid footprint, for collision. */
  solidW: number;
  solidH: number;
}

const clampStep = (n: number): number => (n < 0 ? 0 : n > 4 ? 4 : n);

/**
 * Coursed rubble masonry.
 *
 * Stone is laid in *courses* with the vertical joints staggered between them.
 * The old version filled the plinth with per-pixel noise, which reads as gravel
 * poured against the wall; what makes stone read as stone is the joint grid
 * plus a lit top edge on each block.
 */
function masonry(b: PixelBuffer, x0: number, x1: number, y0: number, y1: number, seed: number): void {
  const COURSE = 5;
  const BLOCK = 11;
  for (let y = y0; y < y1; y++) {
    // Count courses up from the base so the bottom one is always whole.
    const fromBase = y1 - 1 - y;
    const row = Math.floor(fromBase / COURSE);
    const inRow = fromBase % COURSE;
    const off = (row % 2) * 6;
    for (let x = x0; x < x1; x++) {
      const col = Math.floor((x - x0 + off) / BLOCK);
      const inCol = (x - x0 + off) % BLOCK;
      let step = hash2(col, row * 7 + seed) > 0.55 ? 3 : 2;
      if (hash2(col * 3 + 11, row + seed) > 0.9) step = 1;
      if (inRow === COURSE - 1 || inCol === 0) step = 1; // mortar joints
      else if (inRow === COURSE - 2) step += 1; // lit top of each block
      b.set(x, y, R.stone[clampStep(step)]);
    }
  }
}

/**
 * A half-timbered panel: posts, rails and braces, each with a 1px shadow seam
 * on its shaded side. The seam is the whole trick — without it the timber is
 * flush with the plaster and the wall reads as a painted pattern rather than a
 * frame with infill between it.
 */
function timberFrame(b: PixelBuffer, x0: number, x1: number, y0: number, y1: number, doorX: number | null): void {
  const h = y1 - y0;
  if (h < 10) return;
  const rail = (y: number, t: number): void => {
    b.fillRect(x0, y, x1 - x0, t, R.wood[1]);
    b.hline(x0, x1 - 1, y, R.wood[2]);
    if (y + t < y1) b.hline(x0, x1 - 1, y + t, R.night[1]);
  };
  // Corner posts. The left one throws its seam onto the plaster; the right one
  // has nothing to its right, so it gets none.
  b.fillRect(x0, y0, 3, h, R.wood[1]);
  b.vline(x0, y0, y1 - 1, R.wood[2]);
  b.vline(x0 + 3, y0, y1 - 1, R.night[1]);
  b.fillRect(x1 - 3, y0, 3, h, R.wood[1]);
  b.vline(x1 - 3, y0, y1 - 1, R.wood[2]);
  // Wall plate, mid rail, sill plate.
  rail(y0, 2);
  // The mid rail sits just under the window sills, which is where a real one
  // goes; splitting the wall exactly in half leaves the sills floating.
  const mid = y0 + Math.round(h * 0.56);
  rail(mid, 3);
  rail(y1 - 3, 3);
  // Corner braces, 2px with a dark trailing edge.
  const run = Math.min(12, Math.round((x1 - x0) * 0.22));
  b.line(x0 + 3, mid - 1, x0 + 3 + run, y0 + 2, R.wood[1]);
  b.line(x0 + 4, mid - 1, x0 + 4 + run, y0 + 2, R.wood[0]);
  b.line(x1 - 4, mid - 1, x1 - 4 - run, y0 + 2, R.wood[1]);
  b.line(x1 - 5, mid - 1, x1 - 5 - run, y0 + 2, R.wood[0]);
  // Close studding in the panel under the mid rail. Once the windows sit in the
  // upper panel that lower strip is the one blank slab of plaster left on the
  // facade, and a bare slab is exactly what makes a wall look like cardboard.
  const py0 = mid + 3;
  const py1 = y1 - 3;
  if (py1 - py0 >= 7) {
    const inner = x1 - x0 - 20;
    const studs = Math.max(1, Math.round(inner / 15));
    for (let i = 0; i < studs; i++) {
      const sx = Math.round(x0 + 10 + ((i + 0.5) / studs) * inner);
      if (doorX !== null && Math.abs(sx - doorX) < 13) continue;
      b.fillRect(sx, py0, 2, py1 - py0, R.wood[1]);
      b.vline(sx, py0, py1 - 1, R.wood[2]);
      b.vline(sx + 2, py0, py1 - 1, R.night[1]);
    }
  }
}

/**
 * A gable roof, drawn as a roof and not as a rectangle.
 *
 * Seen from the front-and-above you see one roof plane running up to the ridge.
 * That plane is a **trapezoid** — wide at the eaves, narrower at the ridge —
 * and its two sloping edges carry barge boards. Above the ridge a couple of
 * pixels of the far plane show in a darker value. Drawing the roof as a plain
 * rectangle is what made the first version of these buildings read as boxes.
 *
 * The courses do *not* scale with the building: shingles are shingles whatever
 * the house is worth, so a bigger roof simply gets more of them.
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
  b.fillRect(cx - ridgeHalf, top - 3, ridgeHalf * 2, 4, ramp[1]);

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
      b.set(x, y, step === -9 ? R.wood[1] : ramp[clampStep(step)]);
    }
  }
  // Ridge cap, brightest line on the building.
  b.fillRect(cx - ridgeHalf - 1, top, ridgeHalf * 2 + 3, 2, ramp[4]);
  b.hline(cx - ridgeHalf - 1, cx + ridgeHalf + 1, top + 2, ramp[3]);
  // Fascia board along the eaves, so the roof ends on an edge rather than
  // fading into the shadow it casts on the wall.
  b.hline(cx - eaveHalf, cx + eaveHalf, top + h - 1, R.wood[1]);
  b.hline(cx - eaveHalf, cx + eaveHalf, top + h - 2, R.wood[2]);
}

/** A single-pitch lean-to stuck on the side of a building. */
function leanTo(b: PixelBuffer, x0: number, baseY: number, w: number, wallH: number, roofH: number, ramp: Ramp): void {
  b.fillRect(x0, baseY - wallH, w, wallH, R.wood[2]);
  for (let i = 0; i < w; i += 4) {
    b.vline(x0 + i, baseY - wallH, baseY - 1, R.wood[1]);
    b.vline(x0 + i + 1, baseY - wallH, baseY - 1, R.wood[3]);
  }
  b.fillRect(x0, baseY - wallH - roofH, w, roofH, ramp[2]);
  b.hline(x0, x0 + w - 1, baseY - wallH - roofH, ramp[4]);
  b.hline(x0, x0 + w - 1, baseY - wallH - roofH + 1, ramp[3]);
  b.fillRect(x0, baseY - wallH - 2, w, 2, R.night[1]);
  for (let j = 3; j < roofH; j += 4) b.hline(x0, x0 + w - 1, baseY - wallH - roofH + j, ramp[1]);
}

/**
 * An 11x11 window with a 2px sill.
 *
 * At the old 7x7 a window was four pixels of glass and read as a porthole. Once
 * the wall is tall enough for a real one there is room for a proper opening:
 * glazing bars in a cross, sky reflected in the top of the panes, a stone sill
 * standing proud of the wall with its own cast shadow under it.
 */
function drawWindow(b: PixelBuffer, x: number, y: number, shutters: boolean, box: boolean): void {
  // Reveal + frame.
  b.fillRect(x - 5, y - 5, 11, 11, R.wood[1]);
  b.hline(x - 5, x + 5, y - 5, R.wood[2]);
  // Glass. The top of a pane reflects sky, so it sits a step down from the
  // bottom of it — a flat fill of one gold reads as a sticker.
  b.fillRect(x - 4, y - 4, 9, 9, R.gold[4]);
  b.fillRect(x - 4, y - 4, 9, 3, R.gold[3]);
  b.fillRect(x - 4, y - 4, 4, 2, R.gold[2]);
  // Glazing bars.
  b.vline(x, y - 4, y + 4, R.wood[1]);
  b.hline(x - 4, x + 4, y, R.wood[1]);
  // Sill: 2px, wider than the opening, with the shadow it throws below it.
  b.fillRect(x - 7, y + 6, 15, 2, R.wood[3]);
  b.hline(x - 7, x + 7, y + 6, R.wood[4]);
  b.hline(x - 6, x + 6, y + 8, R.night[1]);
  if (shutters) {
    for (const sx of [x - 9, x + 6]) {
      b.fillRect(sx, y - 5, 3, 11, R.teal[1]);
      b.vline(sx, y - 5, y + 5, R.teal[2]);
      for (let j = y - 3; j <= y + 4; j += 3) b.hline(sx, sx + 2, j, R.teal[0]);
    }
  }
  if (box) {
    b.fillRect(x - 6, y + 8, 13, 4, R.wood[1]);
    b.hline(x - 6, x + 6, y + 8, R.wood[2]);
    b.hline(x - 6, x + 6, y + 12, R.night[1]);
    for (let i = -5; i <= 5; i += 2) {
      b.set(x + i, y + 8, R.leaf[2]);
      b.set(x + i, y + 7, i % 4 === 1 ? R.red[3] : R.gold[4]);
      if (i % 4 === 3) b.set(x + i, y + 9, R.leaf[1]);
    }
  }
}

/**
 * The doorway.
 *
 * A door has to be the darkest thing on the wall *and* it has to be tall enough
 * to walk through: 26px of opening against a 30px villager. The old 15px stub
 * on a 26px wall is the single clearest reason the town read as toys — you
 * could see the roof of a house over the head of the person about to enter it.
 */
function drawDoor(b: PixelBuffer, x: number, y: number, h: number, canopy: boolean, signBar: boolean): void {
  const half = Math.round(DOOR_W / 2); // 7 -> a 14px opening including the frame
  const leaf = 5; // 10px of door leaf inside it
  // Recessed opening: a hard dark reveal all around the leaf.
  b.fillRect(x - half, y - h - 2, half * 2, h + 2, R.night[1]);
  b.vline(x - half, y - h - 2, y - 1, R.night[2]);
  b.hline(x - half, x + half - 1, y - h - 2, R.night[0]);
  // The leaf itself, on the dirt ramp — redder than any timber on the wall.
  b.fillRect(x - leaf, y - h, leaf * 2, h, R.dirt[2]);
  for (let i = -leaf + 3; i < leaf; i += 3) b.vline(x + i, y - h + 1, y - 1, R.dirt[1]);
  b.hline(x - leaf, x + leaf - 1, y - h, R.dirt[3]);
  b.vline(x - leaf, y - h, y - 1, R.dirt[3]);
  // Iron hinge bands, near the head and the foot of the leaf.
  b.hline(x - leaf, x + leaf - 1, y - h + 5, R.metal[1]);
  b.hline(x - leaf, x + leaf - 1, y - 6, R.metal[1]);
  // Knob: two pixels so it survives at 1x.
  b.fillRect(x + leaf - 3, y - Math.round(h / 2), 2, 2, R.gold[4]);
  // Stone threshold, a step wider than the opening.
  b.fillRect(x - half - 3, y, half * 2 + 6, 3, R.stone[2]);
  b.hline(x - half - 3, x + half + 2, y, R.stone[3]);
  b.hline(x - half - 3, x + half + 2, y + 2, R.stone[1]);
  if (canopy) {
    // A pitched hood over the doorway, on two brackets.
    const cw = half * 2 + 10;
    const cy = y - h - 6;
    b.fillRect(x - cw / 2, cy, cw, 3, R.wood[1]);
    b.hline(x - cw / 2, x + cw / 2 - 1, cy, R.wood[3]);
    b.hline(x - cw / 2 + 1, x + cw / 2 - 2, cy + 3, R.night[1]);
    b.vline(x - cw / 2 + 1, cy + 3, cy + 5, R.wood[1]);
    b.vline(x + cw / 2 - 2, cy + 3, cy + 5, R.wood[1]);
  }
  if (signBar) {
    // A 1px iron rod out of the wall for the trade sign to hang off.
    b.hline(x + half, x + half + 8, y - h - 9, R.metal[1]);
    b.line(x + half + 1, y - h - 9, x + half + 4, y - h - 6, R.metal[1]);
    b.set(x + half + 8, y - h - 8, R.metal[2]);
  }
}

/** A dormer poking out of the roof plane. */
function dormer(b: PixelBuffer, x: number, y: number, ramp: Ramp): void {
  // Cheeks.
  b.fillRect(x - 8, y, 17, 12, R.paper[3]);
  b.fillRect(x - 8, y + 10, 17, 2, R.paper[2]);
  b.vline(x - 8, y, y + 11, R.paper[4]);
  b.vline(x + 8, y, y + 11, R.paper[2]);
  // Its own little gable over the top.
  for (let j = 0; j < 7; j++) {
    const half = 9 - j;
    b.fillRect(x - half, y - 7 + j, half * 2 + 1, 1, ramp[j < 2 ? 3 : 2]);
  }
  b.hline(x - 9, x + 9, y - 7, ramp[4]);
  b.hline(x - 8, x + 8, y, R.night[1]);
  // Window.
  b.fillRect(x - 3, y + 2, 7, 7, R.wood[1]);
  b.fillRect(x - 2, y + 3, 5, 5, R.gold[4]);
  b.fillRect(x - 2, y + 3, 5, 2, R.gold[3]);
  b.vline(x, y + 3, y + 7, R.wood[1]);
}

/**
 * Where the windows go along one storey.
 *
 * They cannot simply be spread evenly across the wall any more: a 26px door
 * with a hood over it eats the middle 24 pixels of the ground floor, so on that
 * storey the windows have to be dealt into the bands either side of it. Doing
 * this properly (rather than the old "skip any window that lands near the
 * middle") is what stops a widened cottage ending up with one lonely window.
 */
function windowRow(cx: number, half: number, count: number, doorX: number | null): number[] {
  /** Minimum centre-to-centre spacing: an 11px opening plus its shutters. */
  const PITCH = 15;
  /** Beyond this they stop reading as one facade and become lonely holes. */
  const MAX_PITCH = 26;
  /** Keep the opening clear of the corner posts. */
  const INSET = 9;
  const band = (a: number, z: number, n: number): number[] => {
    const span = z - a;
    if (span < 0 || n <= 0) return [];
    const fit = Math.min(n, Math.floor(span / PITCH) + 1);
    const mid = (a + z) / 2;
    if (fit <= 1) return [Math.round(mid)];
    const pitch = Math.min(span / (fit - 1), MAX_PITCH);
    const out: number[] = [];
    for (let i = 0; i < fit; i++) out.push(Math.round(mid + (i - (fit - 1) / 2) * pitch));
    return out;
  };
  if (doorX === null) return band(cx - half + INSET, cx + half - INSET, count);
  /** Half the door hood plus a window's shoulder. */
  const gap = 19;
  const left: [number, number] = [cx - half + INSET, doorX - gap];
  const right: [number, number] = [doorX + gap, cx + half - INSET];
  const wide = [Math.max(0, left[1] - left[0] + 1), Math.max(0, right[1] - right[0] + 1)];
  const total = wide[0] + wide[1];
  if (total <= 0) return [];
  const nLeft = Math.round((count * wide[0]) / total);
  return [...band(left[0], left[1], nLeft), ...band(right[0], right[1], count - nLeft)];
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
    stoneLower = false,
    seed = 1,
    storeys = 1,
    jetty = storeys === 2,
    lean = 'none',
    dormers = 0,
    ivy = false,
    signBar = false,
  } = opts;

  const rng = new RNG(seed);
  const eaveHalf = Math.round(w / 2) + 5;
  const ridgeHalf = Math.max(5, Math.round(eaveHalf * 0.42));
  const leanW = lean === 'none' ? 0 : Math.round(w * 0.34);
  const bw = eaveHalf * 2 + 12 + leanW * 2;
  // Headroom above the ridge for the chimney, and a few rows below the
  // threshold for the cast shadow.
  const bh = roofH + wallH + 26;
  const b = new PixelBuffer(bw, bh);
  const cx = Math.round(bw / 2);
  const baseY = bh - 6;
  const wallTop = baseY - wallH;
  const roofTop = wallTop - roofH;
  // The upper storey overhangs the lower one — a jetty. Very characteristic of
  // timber-framed towns, and it breaks the flat slab of wall for four pixels
  // of work.
  const upperHalf = Math.round(w / 2);
  const lowerHalf = jetty ? upperHalf - 4 : upperHalf;
  // The ground floor is sized by the door, not by a fraction of the building:
  // it has to swallow 26px of opening, a hood over it and the joists above.
  const lowerH = storeys === 2 ? Math.max(STOREY_MIN, Math.round(wallH * 0.52)) : wallH;
  const jettyY = storeys === 2 ? baseY - lowerH : baseY;
  const doorH = Math.max(20, Math.min(DOOR_H, lowerH - 12));

  b.groundShadow(cx, baseY + 2, lowerHalf + 5, 4, 120);

  // --- lean-to behind the main block --------------------------------------
  if (lean !== 'none') {
    const lx = lean === 'left' ? cx - upperHalf - leanW : cx + upperHalf;
    leanTo(b, lx, baseY, leanW, Math.round(wallH * 0.42), 10, roofRamp);
  }

  // --- walls ---------------------------------------------------------------
  const paintWall = (x0: number, x1: number, y0: number, y1: number): void => {
    if (y1 - y0 < 2) return;
    b.fillRect(x0, y0, x1 - x0, y1 - y0, wall[3]);
    // Under the eaves the plaster is in shade from above but bounced into from
    // the street, so the value runs light at the top and heavier at the foot.
    b.fillRect(x0, y0, x1 - x0, 3, wall[4]);
    b.fillRect(x0, y1 - 4, x1 - x0, 4, wall[2]);
    b.vline(x0, y0, y1 - 1, wall[4]);
    b.vline(x1 - 1, y0, y1 - 1, wall[2]);
    // Plaster is never perfectly flat: a few 2-3px clusters of the neighbouring
    // step, never single pixels (that is noise, not render).
    for (let i = 0; i < Math.round((x1 - x0) * (y1 - y0) * 0.004); i++) {
      const px = Math.round(rng.range(x0 + 3, x1 - 4));
      const py = Math.round(rng.range(y0 + 4, y1 - 5));
      const c = rng.chance(0.5) ? wall[2] : wall[4];
      b.hline(px, px + rng.int(1, 2), py, c);
      if (rng.chance(0.5)) b.set(px + 1, py + 1, c);
    }
  };
  paintWall(cx - upperHalf, cx + upperHalf, wallTop, jettyY);
  paintWall(cx - lowerHalf, cx + lowerHalf, jettyY, baseY);
  if (jetty && storeys === 2) {
    // Joist ends under the overhang, and the shadow it casts.
    b.fillRect(cx - upperHalf, jettyY, upperHalf * 2, 2, R.wood[1]);
    b.hline(cx - upperHalf, cx + upperHalf - 1, jettyY, R.wood[3]);
    b.fillRect(cx - lowerHalf, jettyY + 2, lowerHalf * 2, 2, R.night[1]);
    for (let x = cx - upperHalf + 3; x < cx + upperHalf - 2; x += 8) b.fillRect(x, jettyY - 2, 3, 2, R.wood[2]);
  }

  // --- facade treatment ----------------------------------------------------
  if (stoneLower) {
    // Ground floor in masonry. A building with no timber frame at all (the
    // forge, the chapel, the mill) is stone the whole way up.
    masonry(b, cx - lowerHalf, cx + lowerHalf, jettyY, baseY, seed);
    if (!timbered) masonry(b, cx - upperHalf, cx + upperHalf, wallTop, jettyY, seed + 5);
    // Quoins: the corners of a stone building are dressed blocks.
    const qTop = timbered ? jettyY : wallTop;
    for (const qx of [cx - lowerHalf, cx + lowerHalf - 3]) {
      for (let y = baseY - 6; y >= qTop; y -= 6) b.fillRect(qx, y, 3, 5, R.stone[(baseY - y) % 12 === 0 ? 3 : 2]);
    }
  } else if (stoneBase) {
    masonry(b, cx - lowerHalf, cx + lowerHalf, baseY - 11, baseY, seed);
    b.hline(cx - lowerHalf, cx + lowerHalf - 1, baseY - 12, R.stone[4]);
  }
  const dx = door === 'none' ? null : door === 'center' ? cx : door === 'left' ? cx - lowerHalf + 16 : cx + lowerHalf - 16;
  if (timbered) {
    if (storeys === 2) timberFrame(b, cx - upperHalf, cx + upperHalf, wallTop, jettyY, null);
    if (!stoneLower) timberFrame(b, cx - lowerHalf, cx + lowerHalf, jettyY, baseY - (stoneBase ? 12 : 0), dx);
    if (storeys === 1) timberFrame(b, cx - upperHalf, cx + upperHalf, wallTop, baseY - (stoneBase ? 12 : 0), dx);
  }

  // --- windows + door -----------------------------------------------------
  const winList: { x: number; y: number }[] = [];
  const rows: { y: number; half: number; door: number | null }[] =
    storeys === 2
      ? [
          { y: wallTop + Math.round((jettyY - wallTop) * 0.4), half: upperHalf, door: null },
          { y: baseY - lowerH + Math.round(lowerH * 0.36), half: lowerHalf, door: dx },
        ]
      : [{ y: wallTop + Math.round(wallH * 0.34), half: upperHalf, door: dx }];
  for (const row of rows) {
    for (const wxp of windowRow(cx, row.half, windows, row.door)) {
      // Shutters need four pixels of wall either side of the opening, and they
      // must not run into the door hood.
      const clearance = row.half - Math.abs(wxp - cx);
      const clearDoor = row.door === null || Math.abs(wxp - row.door) >= 26;
      // Flower boxes belong on a home, not on a forge or a chapel.
      drawWindow(b, wxp, row.y, clearance >= 15 && clearDoor && rng.chance(0.7), timbered && clearance >= 13 && rng.chance(0.5));
      winList.push({ x: wxp - cx, y: row.y - baseY });
    }
  }
  if (dx !== null) drawDoor(b, dx, baseY, doorH, true, signBar);

  // --- roof ---------------------------------------------------------------
  gableRoof(b, cx, roofTop, roofH, eaveHalf, ridgeHalf, roofRamp, roof, seed);
  // The hard shadow the eave throws onto the wall: two rows now, because at
  // this scale one row of it disappears under the roof's own fascia.
  b.fillRect(cx - upperHalf, wallTop, upperHalf * 2, 1, R.night[0]);
  b.fillRect(cx - upperHalf, wallTop + 1, upperHalf * 2, 1, R.night[1]);
  for (let i = 0; i < dormers; i++) {
    const t = (i + 1) / (dormers + 1);
    dormer(b, Math.round(cx - eaveHalf * 0.62 + t * eaveHalf * 1.24), roofTop + Math.round(roofH * 0.46), roofRamp);
  }

  // --- chimney ------------------------------------------------------------
  let chim: { x: number; y: number } | undefined;
  if (chimney) {
    const chx = cx + Math.round(w * 0.28);
    const chTop = roofTop - 12;
    const chBot = roofTop + Math.round(roofH * 0.5);
    b.fillRect(chx - 4, chTop, 9, chBot - chTop, R.stone[2]);
    for (let y = chTop + 4; y < chBot; y += 4) b.hline(chx - 4, chx + 4, y, R.stone[1]);
    b.vline(chx - 4, chTop, chBot, R.stone[3]);
    b.vline(chx + 3, chTop, chBot, R.stone[1]);
    b.vline(chx + 4, chTop, chBot, R.stone[0]);
    // Corbelled cap, a pixel proud on each side.
    b.fillRect(chx - 5, chTop, 11, 3, R.stone[3]);
    b.hline(chx - 5, chx + 5, chTop + 2, R.stone[1]);
    // Flue mouth.
    b.fillRect(chx - 2, chTop, 5, 2, R.night[0]);
    chim = { x: chx - cx, y: chTop - baseY };
  }

  // --- climbing ivy, to break a blank corner ------------------------------
  if (ivy) {
    const side = rng.chance(0.5) ? -1 : 1;
    const ex = cx + side * (lowerHalf - 4);
    for (let y = baseY - 3; y > wallTop + 5; y -= 2) {
      const spread = Math.max(1, Math.round((baseY - y) / 11));
      for (let k = 0; k < spread; k++) {
        const px = ex - side * rng.int(0, 5);
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
    sign: { x: lowerHalf - 14, y: -(lowerH - 10) },
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
 * A true annulus `w` pixels thick. `PixelBuffer.ellipse(..., false)` keeps
 * every pixel with a normalised distance over 0.42, which at radius 17 is a
 * six pixel wide band — fine for a small pebble outline, useless for a hoop.
 */
function wheelRing(b: PixelBuffer, cx: number, cy: number, r: number, w: number, c: RGBA): void {
  const outer = r + 0.5;
  const inner = r - w + 0.5;
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= outer && d >= inner) b.blend(x, y, c);
    }
  }
}

/**
 * Undershot water wheel, 8 frames.
 *
 * With 8 paddles the wheel repeats every 45 degrees, so the loop only needs to
 * cover 45/8 degrees per frame to read as continuous rotation — turning it a
 * full 45 degrees per frame would look completely static.
 *
 * The first version was hairline spokes plus a 1px tangent bar per paddle,
 * which reads as a cartwheel: a wheel is only machinery if you can see the
 * *boards* that catch the water and the mass at the hub that carries the axle.
 * So each paddle here is a real board — three radial steps thick, lit on the
 * inner face and kept dark on the outer edge so consecutive blades separate —
 * and the hub gets four heavy cross spokes on top of the eight light ones.
 */
export function waterWheelClip(): Clip {
  const frames: PixelBuffer[] = [];
  const RAD = 17;
  const size = RAD * 2 + 8;
  const cx = size / 2;
  const cy = size / 2;
  const PADDLES = 8;
  /** Radius of the inner face of a paddle board. */
  const BOARD = RAD - 1;
  for (let f = 0; f < 8; f++) {
    const b = new PixelBuffer(size, size);
    const rot = (f / 8) * ((Math.PI * 2) / PADDLES);
    // Two hoops: a heavy outer rim the boards are nailed to, and an inner one
    // the spokes die into. Note these are drawn with `wheelRing`, not with
    // `ellipse(..., false)` — at r=17 that leaves a *six pixel* band, and two
    // of them overlapping is what turned the old wheel into a solid disc with
    // no spokes and no blades visible at all.
    wheelRing(b, cx, cy, RAD, 2, R.wood[1]);
    wheelRing(b, cx, cy, RAD - 6, 1, R.wood[1]);
    // Eight light spokes, then four heavy cross spokes over them: the cross is
    // what gives the centre enough mass to read as machinery at this size.
    for (let i = 0; i < PADDLES; i++) {
      const a = rot + (i / PADDLES) * Math.PI * 2;
      b.line(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4, cx + Math.cos(a) * (RAD - 1), cy + Math.sin(a) * (RAD - 1), R.wood[1]);
    }
    for (let i = 0; i < 4; i++) {
      const a = rot + (i / 4) * Math.PI * 2;
      b.capsule(
        cx + Math.cos(a) * 3,
        cy + Math.sin(a) * 3,
        cx + Math.cos(a) * (RAD - 3),
        cy + Math.sin(a) * (RAD - 3),
        1,
        R.wood[2],
      );
    }
    // Paddle boards, laid tangent to the rim and moving with `rot`. Nine pixels
    // long on a rim ~13px per bay, so there is a clear gap between blades.
    for (let i = 0; i < PADDLES; i++) {
      const a = rot + (i / PADDLES) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Tangent unit vector — the direction the board actually lies along.
      const tx = -sa;
      const ty = ca;
      const half = 4;
      for (let k = 0; k < 3; k++) {
        const px = cx + ca * (BOARD + k);
        const py = cy + sa * (BOARD + k);
        // Inner face lit, middle base tone, outer edge dark: that dark edge is
        // the only thing that stops eight blades merging into a solid ring.
        const step = k === 0 ? 3 : k === 1 ? 2 : 0;
        b.capsule(px - tx * half, py - ty * half, px + tx * half, py + ty * half, 0.7, R.wood[step]);
      }
      const bx = cx + ca * (BOARD + 1);
      const by = cy + sa * (BOARD + 1);
      if (sa > 0.75) {
        // The one or two blades actually in the river: wet along their whole
        // length, with a bright fleck of foam.
        b.capsule(bx - tx * half, by - ty * half, bx + tx * half, by + ty * half, 0.7, R.water[3]);
        b.set(Math.round(bx + tx * 2), Math.round(by + ty * 2), R.water[4]);
        b.set(Math.round(bx - tx * 3), Math.round(by - ty * 3), R.water[2]);
      } else if (sa > 0.15 && ca > 0) {
        // Just lifted clear: water still clinging to the middle of the board.
        b.capsule(bx - tx * 3, by - ty * 3, bx + tx * 3, by + ty * 3, 0.7, R.water[2]);
      }
    }
    // Hub last, over the spoke roots: boss, then the iron axle end.
    b.ellipse(cx, cy, 5, 5, R.wood[1]);
    b.ellipse(cx, cy, 4, 4, R.wood[2]);
    b.ellipse(cx - 1, cy - 1, 3, 3, R.wood[3]);
    b.ellipse(cx, cy, 2, 2, R.metal[2]);
    b.set(cx - 1, cy - 1, R.metal[4]);
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

/**
 * Scarecrow.
 *
 * The old one was a square head on a stick with the arms drawn *along* the
 * crossbar, which is a signpost, not a scarecrow. Four things carry the read
 * here: the cross frame, sleeves that hang **down** off the bar because there
 * is no arm inside them, a round head under a wide straw brim, and old clothes
 * that are visibly patched. Straw pokes out wherever the clothes end.
 */
export function scarecrow(): PixelBuffer {
  const b = new PixelBuffer(24, 34);
  b.groundShadow(12, 31, 8, 2.4, 120);
  // Cross frame. 2px upright, 1px crossbar with a 1px shadow under it so the
  // bar reads as a stick lashed on rather than a second beam.
  b.fillRect(11, 12, 2, 19, R.wood[1]);
  b.vline(11, 12, 30, R.wood[2]);
  b.hline(3, 20, 15, R.wood[2]);
  b.hline(3, 20, 16, R.wood[0]);
  b.set(10, 16, R.wood[0]);
  b.set(13, 16, R.wood[0]);

  // Patched coat hung over the frame.
  b.fillRect(7, 14, 10, 12, R.red[2]);
  b.fillRect(7, 14, 10, 2, R.red[3]);
  b.fillRect(7, 23, 10, 3, R.red[1]);
  b.vline(7, 14, 25, R.red[3]);
  b.vline(16, 14, 25, R.red[1]);
  // Two patches of another cloth, each ringed with a 1px stitch line.
  b.fillRect(9, 18, 3, 3, R.purple[2]);
  b.strokeRect(8, 17, 5, 5, R.purple[0]);
  b.fillRect(13, 21, 3, 3, R.purple[1]);
  b.strokeRect(12, 20, 5, 5, R.purple[0]);
  // Straw bursting out at the hem.
  b.set(8, 26, R.sand[3]);
  b.set(10, 27, R.sand[4]);
  b.set(13, 26, R.sand[2]);
  b.set(15, 27, R.sand[3]);

  // Empty sleeves: they drop off the ends of the bar under their own weight.
  b.fillRect(4, 16, 3, 4, R.red[2]);
  b.fillRect(3, 19, 3, 5, R.red[2]);
  b.vline(3, 19, 23, R.red[3]);
  b.hline(3, 5, 23, R.red[0]);
  b.fillRect(17, 16, 3, 4, R.red[1]);
  b.fillRect(18, 19, 3, 5, R.red[1]);
  b.vline(20, 19, 23, R.red[0]);
  b.hline(18, 20, 23, R.red[0]);
  // Shoulder seams, so the shaded sleeve doesn't melt into the shaded side of
  // the coat into one flat slab of red.
  b.vline(16, 16, 19, R.red[0]);
  // Straw hands out of the cuffs.
  b.set(4, 24, R.sand[3]);
  b.set(3, 25, R.sand[2]);
  b.set(5, 25, R.sand[4]);
  b.set(19, 24, R.sand[3]);
  b.set(20, 25, R.sand[2]);
  b.set(18, 25, R.sand[3]);

  // Round sack head with a stitched face, sitting low enough on the shoulders
  // that the brim doesn't eat all of it.
  b.ellipse(12, 11, 4.2, 3.4, R.sand[2]);
  b.ellipse(11, 10, 3.2, 2.4, R.sand[3]);
  b.set(10, 11, R.night[0]);
  b.set(14, 11, R.night[0]);
  b.set(10, 12, R.night[1]);
  b.set(14, 12, R.night[1]);
  b.hline(11, 13, 13, R.night[0]);

  // Wide-brimmed straw hat: a flat brim ellipse, a crown on top, a band where
  // the two meet. The brim overhanging the head is the whole silhouette.
  b.ellipse(12, 6, 8, 2.6, R.gold[1]);
  b.ellipse(12, 5, 8, 2.4, R.gold[2]);
  b.ellipse(11, 5, 6, 1.8, R.gold[3]);
  b.fillRect(9, 1, 7, 4, R.gold[2]);
  b.hline(9, 15, 1, R.gold[3]);
  b.vline(9, 1, 4, R.gold[3]);
  b.vline(15, 1, 4, R.gold[1]);
  b.hline(9, 15, 4, R.wood[1]);
  // Notches bitten out of the brim — an old hat, not a new one.
  b.set(19, 4, TRANSPARENT);
  b.set(4, 6, TRANSPARENT);

  // A tuft of grass at the foot of the post.
  b.line(8, 31, 5, 28, R.leaf[1]);
  b.line(10, 31, 9, 26, R.leaf[2]);
  b.line(13, 31, 15, 27, R.leaf[1]);
  b.line(15, 31, 18, 29, R.leaf[2]);
  b.hline(6, 18, 31, R.leaf[0]);
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

/**
 * The size table, and the only place the town's scale is decided.
 *
 * Every number here is derived from the 30px villager: a storey is never
 * shorter than `STOREY_MIN` (38) because the door plus its hood plus the eaves
 * have to fit inside it, and the roof pitch is kept at roughly the wall height
 * so the trapezoid silhouette stays the one the town already had. Two-storey
 * buildings get the ground floor sized first and hand whatever is left to the
 * upper one — the reverse (a fixed fraction each) is what used to squeeze the
 * tavern's ground floor down to 22px and its door down to 15.
 *
 * Facades come from three families and nothing else: warm off-white plaster
 * (`R.paper`), pale yellow plaster (`R.sand`) and grey stone (`R.stone`). The
 * trades — the shop and the forge — take a masonry ground floor.
 */
export function bakeBuildings(): BuildingAssets {
  const cottages = [
    building({ w: 78, wallH: 40, roofH: 40, wall: R.paper, roofRamp: R.wood, roof: 'thatch', windows: 2, chimney: true, seed: 3, lean: 'right', ivy: true }),
    building({ w: 68, wallH: 38, roofH: 36, wall: R.sand, roofRamp: R.red, roof: 'tile', windows: 2, chimney: true, seed: 5 }),
    building({ w: 90, wallH: 44, roofH: 44, wall: R.paper, roofRamp: R.wood, roof: 'shingle', windows: 3, chimney: true, seed: 7, stoneBase: true, dormers: 1 }),
    building({ w: 62, wallH: 38, roofH: 34, wall: R.sand, roofRamp: R.wood, roof: 'thatch', windows: 2, chimney: true, seed: 11, ivy: true }),
  ];
  return {
    cottages,
    tavern: building({
      w: 100,
      wallH: 76,
      roofH: 42,
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
      signBar: true,
    }),
    inn: building({
      w: 112,
      wallH: 80,
      roofH: 46,
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
      signBar: true,
    }),
    smithy: building({
      w: 72,
      wallH: 40,
      roofH: 34,
      wall: R.stone,
      roofRamp: R.metal,
      roof: 'shingle',
      windows: 2,
      chimney: true,
      timbered: false,
      stoneLower: true,
      seed: 29,
      signBar: true,
    }),
    shop: building({
      w: 80,
      wallH: 74,
      roofH: 40,
      wall: R.paper,
      roofRamp: R.leaf,
      roof: 'tile',
      windows: 2,
      storeys: 2,
      chimney: true,
      stoneLower: true,
      dormers: 1,
      seed: 31,
      signBar: true,
    }),
    chapel: building({
      w: 64,
      wallH: 78,
      roofH: 48,
      wall: R.stone,
      roofRamp: R.metal,
      roof: 'shingle',
      windows: 2,
      storeys: 2,
      jetty: false,
      timbered: false,
      stoneLower: true,
      door: 'center',
      seed: 37,
    }),
    mill: building({
      w: 86,
      wallH: 76,
      roofH: 42,
      wall: R.stone,
      roofRamp: R.wood,
      roof: 'shingle',
      windows: 2,
      storeys: 2,
      jetty: false,
      chimney: false,
      timbered: false,
      stoneLower: true,
      seed: 41,
      lean: 'left',
      dormers: 1,
    }),
    barn: building({
      w: 88,
      wallH: 46,
      roofH: 44,
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

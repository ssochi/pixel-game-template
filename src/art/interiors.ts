/**
 * Interior fittings.
 *
 * Rooms are drawn in the same 3/4 projection as the outdoors: you look down at
 * the floor and straight at the back wall. So a room needs three things the
 * outdoor set never had — a wall surface with a skirting and a top edge, floor
 * materials that tile seamlessly, and furniture that reads *against a wall*
 * rather than standing free on grass.
 */
import { bayer, PixelBuffer, parseArt, rgba, shade, type RGBA } from './pixel';
import { P, R, type Ramp } from './palette';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';
import { RNG, fbm, hash2 } from '../engine/rng';

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export type FloorKind = 'plank' | 'tile' | 'stone' | 'straw';

/** Board pitch for a plank floor. `floorPatches` lands its repairs on this grid. */
export const BOARD_H = 10;

const clampStep = (s: number): number => (s < 0 ? 0 : s > 4 ? 4 : s);

/**
 * Per-course board layout for a plank floor.
 *
 * The old floor was one board length — the whole room — repeated at a perfect
 * 10px pitch with a bright arris on every course, so from the left wall to the
 * right wall it was a run of evenly spaced light/dark stripes. That is a deck,
 * not a floor. Boards come out of a stack in whatever lengths the sawyer had:
 * every course is cut into 12-28px runs, each course starts part-way into a
 * board so the butt joints never line up with the course above, and each run
 * gets its own tone a step either side of the base. `lit` is what breaks the
 * last of the periodicity: only about half the boards take a lit top arris, so
 * the eye stops finding a rhythm to lock onto.
 */
function plankLayout(w: number, courses: number, base: number): { tone: Int8Array; flag: Uint8Array } {
  const tone = new Int8Array(courses * w);
  const flag = new Uint8Array(courses * w);
  for (let bi = 0; bi < courses; bi++) {
    const rng = new RNG((base + bi) * 9176 + 37);
    let x = -rng.int(2, 26);
    while (x < w) {
      const len = rng.int(12, 28);
      const t = rng.int(-1, 1);
      const lit = rng.chance(0.45) ? 2 : 0;
      const end = Math.min(w, x + len);
      for (let i = Math.max(0, x); i < end; i++) {
        tone[bi * w + i] = t;
        flag[bi * w + i] = lit;
      }
      if (x >= 0 && x < w) flag[bi * w + x] |= 1; // butt joint
      x += len;
    }
  }
  return { tone, flag };
}

/**
 * Cut an axis into tiles of jittered size. Returns, per pixel along the axis,
 * the tile index, the distance from its near edge and the distance from its far
 * edge — enough to grout, light and chip each tile independently.
 *
 * A flagged floor laid to the millimetre reads as graph paper, and rule 7's
 * point about regular top-down brickwork reading as a *wall* applies just as
 * hard indoors: the chapel's 12px chequer was the most rigid surface in the
 * game.
 */
function tileAxis(n: number, seed: number, lo: number, hi: number): { idx: Int32Array; near: Int32Array; far: Int32Array } {
  const idx = new Int32Array(n);
  const near = new Int32Array(n);
  const far = new Int32Array(n);
  const rng = new RNG(seed);
  let p = -rng.int(0, lo);
  let t = 0;
  while (p < n) {
    const size = rng.int(lo, hi);
    for (let i = Math.max(0, p); i < Math.min(n, p + size); i++) {
      idx[i] = t;
      near[i] = i - p;
      far[i] = p + size - 1 - i;
    }
    p += size;
    t++;
  }
  return { idx, near, far };
}

/** Paint a floor directly into a room bitmap. */
export function paintFloor(b: PixelBuffer, x0: number, y0: number, w: number, h: number, kind: FloorKind): void {
  const courses = Math.ceil((h + y0) / BOARD_H) + 2;
  const plank = kind === 'plank' ? plankLayout(w, courses, Math.floor(y0 / BOARD_H)) : null;
  const tileX = kind === 'tile' ? tileAxis(w, 4211, 10, 15) : null;
  const tileY = kind === 'tile' ? tileAxis(h, 7717, 9, 14) : null;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      const y = y0 + j;
      let c: RGBA;
      if (kind === 'plank' && plank) {
        const course = Math.floor(j / BOARD_H);
        const within = j - course * BOARD_H;
        const k = course * w + i;
        const flag = plank.flag[k];
        let step = 2 + plank.tone[k];
        // One dark pixel between courses, and that is the whole seam — the old
        // floor put a dark row *and* a second dark row nine pixels later, which
        // is what banded the room.
        if (within === 0) step -= 1;
        else if (within === 1 && (flag & 2) !== 0) step += 1;
        // The butt joint: a single dark pixel down the end of the board.
        if (within > 0 && (flag & 1) !== 0) step -= 1;
        // Grain and knots, in 2px streaks rather than single specks.
        else if (within > 1 && hash2(x >> 1, y * 3 + course) > 0.955) step -= 1;
        c = R.wood[clampStep(step)];
      } else if (kind === 'tile' && tileX && tileY) {
        const ti = tileX.idx[i];
        const tj = tileY.idx[j];
        const lx = tileX.near[i];
        const ly = tileY.near[j];
        const rx = tileX.far[i];
        const ry = tileY.far[j];
        const n = hash2(ti, tj);
        // Base chequer, with a few flags out of a different batch.
        let step = (ti + tj) % 2 === 0 ? 3 : 2;
        if (n > 0.88) step += 1;
        else if (n < 0.18) step -= 1;
        if (lx === 0 || ly === 0) step = 1; // 1px joint
        else if ((lx === 1 || ly === 1) && n > 0.38) step += 1; // lit arris, not on every flag
        else if (rx === 0 || ry === 0) step -= 1;
        // Chipped corners. A floor this old with not one broken flag in it is
        // the giveaway that nobody laid it.
        const chip = hash2(ti * 7 + 3, tj * 11 + 5);
        if (chip > 0.8) {
          const corner = Math.floor(hash2(ti + 5, tj + 9) * 4) & 3;
          const cx = corner & 1 ? rx : lx;
          const cy = corner & 2 ? ry : ly;
          if (cx + cy < (chip > 0.93 ? 3 : 2)) step = 1;
        }
        c = R.stone[clampStep(step)];
      } else if (kind === 'straw') {
        const n = hash2(i, Math.floor(j / 2));
        c = R.sand[n > 0.8 ? 3 : n > 0.35 ? 2 : 1];
      } else {
        // Irregular flagstones, as outside but smaller and warmer.
        const row = Math.floor(j / 9);
        const off = Math.floor(hash2(row, 5) * 8);
        const col = Math.floor((i + off) / 11);
        const lx = (i + off) % 11;
        const ly = j % 9;
        const n = hash2(col, row);
        let step = n > 0.55 ? 3 : 2;
        if (lx === 0 || ly === 0) step = 1;
        else if (lx === 1 || ly === 1) step += 1;
        c = R.stone[Math.max(0, Math.min(4, step))];
      }
      b.set(x, y, c);
    }
  }
}

export type WallKind = 'plaster' | 'log' | 'stone' | 'brick';

/**
 * The back wall: a skirting board at the bottom, the wall field, and a bright
 * cornice line where it meets the ceiling. Without the skirting the wall and
 * the floor merge into one surface and the room loses its corner.
 */
export function paintWall(b: PixelBuffer, x0: number, y0: number, w: number, h: number, kind: WallKind): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      const y = y0 + j;
      const fromBottom = h - 1 - j;
      let c: RGBA;
      if (fromBottom < 6) {
        // Skirting, in the *wall's own* material: a brick forge with a parlour
        // dado rail round it reads as a set dressed by two different people.
        // Three parts, and all three are needed — a lit cap where the top of
        // the board catches the lamps, the board itself, and a 2px plinth at
        // the very foot that is a step darker than anything else in the room.
        // Without that plinth the wall and the floor share an edge and the
        // room loses its corner again at exactly the height the eye reads it.
        const ramp = kind === 'stone' || kind === 'brick' ? R.stone : R.wood;
        c =
          fromBottom === 5
            ? ramp[3]
            : fromBottom >= 3
              ? ramp[1]
              : fromBottom === 2
                ? ramp[0]
                : R.night[0];
        // A scuffed run along the board, in clusters: skirting takes the boot.
        if (fromBottom >= 3 && hash2(i >> 1, fromBottom) > 0.88) c = ramp[0];
      } else if (j < 2) {
        c = R.night[1];
      } else if (j < 4) {
        c = kind === 'stone' ? R.stone[3] : R.wood[2];
      } else if (kind === 'plaster') {
        const n = hash2(i, j);
        c = R.paper[n > 0.96 ? 2 : 3];
        if (j < 7) c = R.paper[4];
      } else if (kind === 'log') {
        // Kept in the dark half of the ramp: the wall has to sit well below the
        // floor in value or the two surfaces merge and the room loses its
        // corner entirely.
        const course = j % 8;
        c = course === 0 ? R.night[0] : course === 1 ? R.wood[2] : course === 7 ? R.wood[0] : R.wood[1];
      } else if (kind === 'brick') {
        const row = Math.floor(j / 6);
        const lx = (i + (row % 2) * 7) % 14;
        c = lx === 0 || j % 6 === 0 ? R.red[0] : R.red[hash2(Math.floor((i + row * 7) / 14), row) > 0.6 ? 2 : 1];
      } else {
        const row = Math.floor(j / 8);
        const lx = (i + (row % 2) * 9) % 18;
        const n = hash2(Math.floor((i + row * 9) / 18), row);
        c = lx === 0 || j % 8 === 0 ? R.stone[0] : R.stone[n > 0.6 ? 3 : 2];
      }
      b.set(x, y, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Floor wear
//
// Furniture alone never fixes an empty room, because the emptiness is not in
// the middle of the floor — it is in the floor being one flat, unbroken,
// factory-fresh surface. Everything in this section paints *into the room
// bitmap*, one ramp step at a time, so the floor has a history before a single
// extra prop is placed on it.
// ---------------------------------------------------------------------------

/**
 * Patch boards and mismatched flags.
 *
 * Real floors are repaired piecemeal: a board replaced later out of different
 * timber, a flag that came from another quarry. Two or three of them one ramp
 * step off is plenty — more starts to read as damage rather than as age.
 */
export function floorPatches(
  b: PixelBuffer,
  x0: number,
  y0: number,
  w: number,
  h: number,
  kind: FloorKind,
  seed: number,
): void {
  const rng = new RNG(seed * 131 + 7);
  const count = kind === 'plank' ? 3 : 4;
  for (let i = 0; i < count; i++) {
    if (kind !== 'plank') {
      // Masonry has no "next board along" to swap out, and a rectangle laid
      // over irregular flagstones reads as a hole in the floor rather than as
      // a repair. What masonry does have is areas rubbed lighter and areas
      // gone dark with damp, so those get a soft-edged patch instead.
      const rx = rng.int(9, 17);
      const ry = rng.int(6, 11);
      const px = x0 + rng.int(rx + 2, Math.max(rx + 3, w - rx - 2));
      const py = y0 + rng.int(ry + 2, Math.max(ry + 3, h - ry - 2));
      const dir = rng.chance(0.4) ? 1 : -1;
      for (let y = py - ry; y <= py + ry; y++) {
        for (let x = px - rx; x <= px + rx; x++) {
          if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) continue;
          const d = ((x - px) / rx) ** 2 + ((y - py) / ry) ** 2;
          if (d > 1) continue;
          const cover = (1 - d) * (0.55 + fbm(x * 0.12 + i * 9, y * 0.17, 2) * 1.0);
          if (cover < 0.3) continue;
          if (cover < 0.55 && bayer(x, y) > (cover - 0.3) / 0.25) continue;
          b.set(x, y, shade(b.get(x, y), dir * 0.2));
        }
      }
      continue;
    }
    const pw = rng.int(20, 40);
    const px = x0 + rng.int(8, Math.max(9, w - pw - 8));
    const ph = BOARD_H;
    // A patch board has to sit *on* the board grid, or it reads as a stain.
    // The grid is absolute (`paintFloor` counts courses from y=0), so the snap
    // has to be absolute too — snapping relative to `y0` put every repair six
    // pixels out and turned all three of them into oblong smudges.
    const py = Math.max(y0, Math.floor((y0 + rng.int(0, Math.max(1, h - 14))) / BOARD_H) * BOARD_H);
    // Boards only ever go *darker*. A board a step lighter than its neighbours
    // reads as a highlight lying on the floor, not as different timber — the
    // room is lit from lamps overhead, so nothing down there gets brighter.
    for (let y = py; y < py + ph; y++) {
      for (let x = px; x < px + pw; x++) {
        if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) continue;
        b.set(x, y, shade(b.get(x, y), -0.2));
      }
    }
    // The butt joints at each end. They are what say "this is a different
    // plank" rather than "this bit of the floor is darker".
    for (const jx of [px, px + pw - 1]) {
      for (let y = py + 1; y < py + ph - 1; y++) {
        if (jx < x0 || jx >= x0 + w || y < y0 || y >= y0 + h) continue;
        b.set(jx, y, R.wood[0]);
      }
    }
  }
}

/**
 * A worn track along the line the household actually walks.
 *
 * Doorway to counter, hearth to table — this is the single cheapest way to say
 * a room is used, and it costs one ramp step. The edges are dithered against a
 * hash so the track has a ragged boundary; an airbrushed stripe down the floor
 * would read as a lighting bug.
 */
export function wearPath(b: PixelBuffer, pts: readonly (readonly [number, number])[], halfW = 7): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = ax + (bx - ax) * t;
      const cy = ay + (by - ay) * t;
      const rw = halfW + Math.sin(t * 9 + i * 2) * 1.4;
      const rh = rw * 0.5;
      for (let y = Math.round(cy - rh); y <= Math.round(cy + rh); y++) {
        for (let x = Math.round(cx - rw); x <= Math.round(cx + rw); x++) {
          const d = Math.hypot((x - cx) / rw, (y - cy) / rh);
          if (d > 1) continue;
          // These ramps are five steps wide, so a whole step is a big move in
          // value — laid down solid it is a smear of mud, and masked with a
          // hash it is spilt grit. Neither is wear. What is wanted is *half* a
          // step, and the only way to get half a step out of a closed palette
          // is rule 5's ordered dither: darken a fraction of the pixels on the
          // Bayer grid, densest along the centre line, thinning to nothing at
          // the edges so the track has no boundary to notice.
          const cover = 0.34 * (1 - d * d) * (0.7 + fbm(x * 0.1, y * 0.14, 2) * 0.6);
          if (bayer(x, y) > cover) continue;
          b.set(x, y, shade(b.get(x, y), -0.25));
        }
      }
    }
  }
}

/**
 * Blotching on the floor in front of a hearth (`dir < 0`, soot) or under a
 * mill's meal spout (`dir > 0`, flour). Clustered by noise rather than laid
 * down as a smooth vignette: soot lands in patches, and a soft radial fade at
 * this resolution just looks like the renderer is broken.
 */
export function floorStain(b: PixelBuffer, cx: number, cy: number, rx: number, ry: number, dir = -1): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      // Rule 5, applied to a stain: a flat plateau where the soot is thick and
      // dithering *only* in the narrow band where it thins out. Dithering the
      // whole ellipse turns it into a patch of screen-door mesh — which on a
      // flagstone floor is the most conspicuous thing in the room.
      // The noise has to *dominate* the radial falloff, or the solid core comes
      // out as a smooth lozenge with a dotted halo round it — which reads as a
      // hole in the floorboards rather than as soot.
      const cover = (1 - d * 0.85) * (0.2 + fbm(x * 0.15, y * 0.21, 2) * 1.5);
      if (cover < 0.28) continue;
      if (cover < 0.78 && bayer(x, y) > (cover - 0.28) / 0.5) continue;
      b.set(x, y, shade(b.get(x, y), dir * 0.25));
    }
  }
}

/**
 * The nave's aisle: the flags down the centre line rubbed pale by four
 * centuries of feet, with a darker joint holding each edge. A church floor
 * without an aisle is a warehouse floor.
 */
export function aisleBand(b: PixelBuffer, cx: number, y0: number, y1: number, half: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const edge = Math.abs(x - cx) > half - 2;
      b.set(x, y, shade(b.get(x, y), edge ? -0.3 : 0.24));
    }
  }
}

/**
 * The pool of colour a stained window throws onto the floor.
 *
 * It can't be a translucent sprite — sheet baking snaps partial alpha away, so
 * a soft overlay would come back opaque. Painting it straight into the room
 * bitmap keeps it on the palette: the flags are lifted a step, then the panes'
 * own colours are dithered over the top in the same lattice as the glass.
 */
export function glassSpill(b: PixelBuffer, cx: number, cy: number, rx: number, ry: number): void {
  const tints: Ramp[] = [R.gold, R.teal, R.red, R.purple];
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      // The light itself: the flags simply lift a step.
      b.set(x, y, shade(b.get(x, y), 0.25));
      // The colour arrives as whole projected panes — *solid* blocks with hard
      // edges, one tint each. Two earlier attempts chose the tint per pixel
      // and then dithered it, and both threw coloured confetti across the
      // chancel: at 4x a 50% dither of a saturated hue is not a wash, it is a
      // field of dots. Only the panes on the rim of the pool are dithered, and
      // only to soften the boundary.
      const cxi = Math.floor((x - cx + 60) / 6);
      const cyi = Math.floor((y - cy + 60) / 4);
      const ccx = (cxi - 10) * 6 + 3;
      const ccy = (cyi - 15) * 4 + 2;
      const cd = (ccx / rx) ** 2 + (ccy / ry) ** 2;
      if (cd > 1.05) continue;
      // Half the panes are left as bare lit stone. Leaded glass is mostly
      // clear quarries with coloured lights set into it, and a solid mosaic
      // of saturated blocks reads as a patchwork quilt lying on the floor.
      if ((cxi + cyi) % 2 === 0) continue;
      const ramp = tints[(((cxi + cyi * 3) % tints.length) + tints.length) % tints.length];
      if (cd < 0.5 || bayer(x, y) < 1.05 - cd) b.set(x, y, ramp[2]);
    }
  }
}

// ---------------------------------------------------------------------------
// Fittings
// ---------------------------------------------------------------------------

function still(b: PixelBuffer, ax: number, ay: number): Sheet {
  return bakeSheet([b], ax, ay);
}

/** A shop or bar counter: a top surface plus a panelled front. */
export function counter(w: number, accent: Ramp): PixelBuffer {
  const b = new PixelBuffer(w, 22);
  b.groundShadow(w / 2, 20, w / 2 - 1, 2, 110);
  // Top surface, seen from above.
  b.fillRect(0, 2, w, 6, R.wood[3]);
  b.hline(0, w - 1, 2, R.wood[4]);
  b.hline(0, w - 1, 7, R.wood[1]);
  // Front panel.
  b.fillRect(0, 8, w, 11, R.wood[2]);
  for (let x = 3; x < w - 2; x += 9) {
    b.fillRect(x, 10, 6, 7, R.wood[1]);
    b.fillRect(x + 1, 11, 4, 5, accent[1]);
  }
  b.hline(0, w - 1, 18, R.wood[0]);
  b.selOutline();
  return b;
}

/** Wall shelving stocked with jars, bolts and sacks. */
export function shelfUnit(w: number, seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(w, 34);
  b.fillRect(0, 0, w, 34, R.wood[1]);
  b.fillRect(1, 1, w - 2, 32, shade(R.wood[0], -0.1));
  for (let s = 0; s < 3; s++) {
    const sy = 3 + s * 10;
    b.fillRect(1, sy + 8, w - 2, 2, R.wood[3]);
    let x = 2;
    while (x < w - 4) {
      const iw = rng.int(3, 6);
      const ih = rng.int(4, 8);
      if (x + iw > w - 2) break;
      const ramp: Ramp = rng.pick([R.red, R.gold, R.leaf, R.purple, R.teal, R.paper]);
      b.fillRect(x, sy + 8 - ih, iw, ih, ramp[2]);
      b.vline(x, sy + 8 - ih, sy + 7, ramp[3]);
      b.hline(x, x + iw - 1, sy + 8 - ih, ramp[3]);
      b.set(x + iw - 1, sy + 8 - ih + 1, ramp[1]);
      x += iw + rng.int(1, 2);
    }
  }
  b.selOutline();
  return b;
}

/** Hearth set into the back wall. Four frames of fire. */
export function fireplaceClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 6; f++) {
    const b = new PixelBuffer(34, 34);
    // Stone surround
    b.fillRect(0, 0, 34, 34, R.stone[2]);
    b.fillRect(1, 1, 32, 32, R.stone[3]);
    b.fillRect(4, 6, 26, 26, R.stone[1]);
    b.fillRect(6, 8, 22, 24, R.night[0]);
    // Mantel
    b.fillRect(0, 0, 34, 4, R.wood[2]);
    b.hline(0, 33, 0, R.wood[3]);
    b.hline(0, 33, 3, R.wood[0]);
    // Logs and fire
    b.capsule(11, 29, 23, 29, 2, R.wood[1]);
    b.capsule(13, 27, 21, 27, 1.6, R.wood[0]);
    const t = f / 6;
    for (let i = 0; i < 3; i++) {
      const fx = 12 + i * 5;
      const fh = 8 + ((f + i) % 3) * 2;
      for (let j = 0; j < fh; j++) {
        const p = j / fh;
        const wob = Math.sin(p * 5 + t * 6 + i) * (1 + p * 1.4);
        const half = Math.max(0.4, 2 * (1 - p * p));
        for (let x = Math.round(fx + wob - half); x <= Math.round(fx + wob + half); x++) {
          b.blend(x, 28 - j, p > 0.7 ? R.fire[1] : p < 0.35 ? R.fire[4] : R.fire[3]);
        }
      }
    }
    b.ellipse(17, 29, 7, 2, rgba(R.fire[2], 150));
    b.selOutline();
    frames.push(b);
  }
  return clip(bakeSheet(frames, 17, 33), frames.map((_, i) => i), 12);
}

/** Blacksmith's anvil, with sparks on the strike frames. */
export function anvilClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 4; f++) {
    const b = new PixelBuffer(22, 22);
    b.groundShadow(11, 20, 8, 2, 110);
    // Stump
    b.fillRect(5, 14, 12, 6, R.wood[1]);
    b.hline(5, 16, 14, R.wood[2]);
    // Anvil body
    b.fillRect(4, 8, 14, 3, R.metal[2]);
    b.hline(4, 17, 8, R.metal[3]);
    b.fillRect(7, 11, 8, 3, R.metal[1]);
    b.fillRect(2, 8, 3, 2, R.metal[2]);
    b.set(1, 9, R.metal[1]);
    b.selOutline();
    if (f === 1) {
      for (let i = 0; i < 5; i++) {
        b.set(9 + i - 2, 6 - Math.abs(i - 2), R.fire[4]);
        b.set(9 + (i - 2) * 2, 5 - Math.abs(i - 2), R.gold[4]);
      }
    }
    frames.push(b);
  }
  return clip(bakeSheet(frames, 11, 21), [0, 1, 2, 3, 3, 3], 8);
}

/** Wall-mounted lamp; two frames of flicker. */
export function wallLampClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 2; f++) {
    const b = new PixelBuffer(12, 16);
    b.fillRect(5, 0, 2, 5, R.metal[1]);
    b.fillRect(2, 4, 8, 2, R.metal[2]);
    b.fillRect(3, 6, 6, 7, R.metal[1]);
    b.fillRect(4, 7, 4, 5, R.gold[4 - f]);
    b.set(4, 7, R.gold[3]);
    b.fillRect(3, 13, 6, 1, R.metal[2]);
    b.selOutline();
    frames.push(b);
  }
  return clip(bakeSheet(frames, 6, 15), [0, 1, 0, 1, 1], 5);
}

/**
 * A three-legged stool.
 *
 * The first version was a disc with two stubs tucked *underneath* it, which is
 * why it read as a dinner plate lying on the floorboards: nothing broke the
 * silhouette below the seat. The legs have to splay out past the edge of the
 * seat, and there has to be a stretcher between them — the diagonals and the
 * triangle of negative space they cut out are the entire read at this size.
 */
export function stool(): PixelBuffer {
  const b = new PixelBuffer(14, 17);
  b.groundShadow(7, 15, 6, 1.8, 100);
  // Back leg first, then the two front ones over it.
  b.line(7, 9, 7, 13, R.wood[1]);
  b.line(8, 9, 8, 13, R.wood[0]);
  b.line(5, 9, 2, 15, R.wood[2]);
  b.line(6, 9, 3, 15, R.wood[1]);
  b.line(9, 9, 12, 15, R.wood[1]);
  b.line(10, 9, 13, 15, R.wood[0]);
  b.set(2, 15, R.wood[0]);
  b.set(13, 15, R.wood[0]);
  // Stretcher: the one line that turns three sticks into joinery.
  b.hline(3, 11, 12, R.wood[1]);
  b.hline(4, 10, 11, R.wood[2]);
  // Seat: rim, then the top face two rows above it — that offset is the only
  // way to say "this board has thickness" from directly above.
  b.ellipse(7, 8, 6, 2.6, R.wood[1]);
  b.ellipse(7, 6, 6, 2.6, R.wood[3]);
  b.ellipse(6, 5.2, 3.6, 1.4, R.wood[4]);
  b.hline(3, 10, 8, R.wood[0]);
  b.selOutline();
  return b;
}

export function barrelKeg(): PixelBuffer {
  const b = new PixelBuffer(20, 18);
  b.groundShadow(10, 16, 8, 2, 110);
  b.fillRect(2, 4, 16, 11, R.wood[2]);
  b.hline(2, 17, 4, R.wood[3]);
  b.hline(2, 17, 14, R.wood[1]);
  for (const y of [6, 12]) b.hline(2, 17, y, R.metal[1]);
  b.ellipse(3, 9.5, 2, 5, R.wood[3]);
  b.ellipse(17, 9.5, 2, 5, R.wood[1]);
  b.fillRect(9, 12, 2, 3, R.metal[2]);
  b.selOutline();
  return b;
}

export function painting(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(22, 18);
  b.fillRect(0, 0, 22, 18, R.gold[1]);
  b.fillRect(1, 1, 20, 16, R.gold[3]);
  b.fillRect(2, 2, 18, 14, R.teal[1]);
  // A little landscape: sky band, hills, sun.
  b.fillRect(2, 2, 18, 6, R.teal[3]);
  b.ellipse(6, 5, 2, 2, R.gold[4]);
  for (let i = 0; i < 3; i++) {
    b.ellipse(5 + i * 6, 11 + rng.int(0, 2), 5, 3, R.leaf[i % 2 ? 1 : 2]);
  }
  b.fillRect(2, 14, 18, 2, R.leaf[0]);
  b.selOutline();
  return b;
}

export function potPlant(): PixelBuffer {
  const b = new PixelBuffer(16, 22);
  b.groundShadow(8, 20, 6, 2, 100);
  b.fillRect(4, 14, 8, 6, R.red[2]);
  b.hline(3, 12, 14, R.red[3]);
  b.hline(4, 11, 19, R.red[1]);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 5) * Math.PI;
    b.capsule(8, 14, 8 + Math.cos(a) * 5, 14 + Math.sin(a) * 8, 1.4, i % 2 ? R.leaf[2] : R.leaf[1]);
  }
  b.ellipse(8, 6, 3, 2.4, R.leaf[3]);
  b.selOutline();
  return b;
}

export function sacks(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(24, 18);
  b.groundShadow(12, 16, 10, 2, 110);
  for (let i = 0; i < 3; i++) {
    const x = 4 + i * 7;
    const h = rng.int(8, 12);
    b.ellipse(x, 15 - h / 2, 4, h / 2, R.sand[2]);
    b.ellipse(x - 1, 15 - h / 2 - 1, 3, h / 2 - 1, R.sand[3]);
    b.fillRect(x - 1, 15 - h, 3, 2, R.sand[1]);
  }
  b.selOutline();
  return b;
}

/**
 * 2-3px weave figures, stamped on a jittered lattice exactly as the outdoor
 * grass is (rule 4). `l` takes the bright thread, `d` the dark one.
 */
const RUG_MOTIFS: string[][] = [
  ['.l.', 'ldl', '.l.'],
  ['l.l', '.d.', 'l.l'],
  ['ld', 'dl'],
  ['.l.', 'ld.'],
  ['ll'],
  ['l', 'l'],
  ['.d.', 'd.d'],
];

/** The hand-dotted centre figure. Under 12px, so per rule 8 it is placed pixel
 *  by pixel rather than assembled out of rectangles. */
const RUG_MEDALLION = [
  '.....d.....',
  '....dhd....',
  '...dhlhd...',
  '..dhl.lhd..',
  '.dhl.d.lhd.',
  '..dhl.lhd..',
  '...dhlhd...',
  '....dhd....',
  '.....d.....',
];

const RUG_MEDALLION_SMALL = ['..d..', '.dhd.', 'dhlhd', '.dhd.', '..d..'];

/**
 * A rug that sits under furniture; flat, no shadow.
 *
 * The old one was five concentric rectangles, which is a target, not a textile:
 * on the shop's floorboards the purple one read as a magenta sticker somebody
 * had dropped. A rug is legible from four things and they are all texture, not
 * shape — a woven ground with a visible rib, small figures repeated across the
 * field with bare ground between them, a fringe of loose thread at the edge,
 * and the fact that the middle is walked on and the corners are not.
 */
export function roomRug(w: number, h: number, ramp: Ramp, seed = 1): PixelBuffer {
  const rng = new RNG(seed * 137 + 29);
  const b = new PixelBuffer(w, h);
  // Rows 0-1 and the last two are left for the fringe; the pile is what's left.
  const y0 = 2;
  const y1 = h - 3;
  // --- Ground weave --------------------------------------------------------
  // A rib that steps sideways row by row. A flat fill is a sticker and
  // per-pixel noise is static; cloth is a regular structure seen slightly out
  // of register with itself.
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < w; x++) {
      const rib = (x + (y % 2) * 2 + Math.floor(y / 6)) % 5 === 0;
      b.set(x, y, rib ? ramp[1] : ramp[2]);
    }
  }
  // --- Figures across the field -------------------------------------------
  const medW = w >= 40 ? 11 : 5;
  const medH = w >= 40 ? 9 : 5;
  const mx0 = Math.round((w - medW) / 2);
  const my0 = Math.round((h - medH) / 2);
  const cell = 7;
  for (let cy = y0 + 1; cy < y1 - 2; cy += cell) {
    for (let cx = 1; cx < w - 3; cx += cell) {
      const px = cx + rng.int(0, 2);
      const py = cy + rng.int(0, 2);
      // A quarter of the cells stay bare. The negative space is what stops the
      // figures joining up into a second flat colour.
      if (rng.chance(0.26)) continue;
      // Keep clear of the medallion, with a ring of plain ground round it.
      if (px > mx0 - 4 && px < mx0 + medW + 2 && py > my0 - 4 && py < my0 + medH + 2) continue;
      const m = rng.pick(RUG_MOTIFS);
      const light = rng.chance(0.55) ? ramp[4] : ramp[3];
      for (let j = 0; j < m.length; j++) {
        for (let i = 0; i < m[j].length; i++) {
          const ch = m[j][i];
          if (ch === '.') continue;
          const x = px + i;
          const y = py + j;
          if (x < 1 || x > w - 2 || y < y0 + 1 || y > y1 - 1) continue;
          b.set(x, y, ch === 'l' ? light : ramp[0]);
        }
      }
    }
  }
  // --- Wear ----------------------------------------------------------------
  // One ramp step, and it does more for the object than any amount of pattern:
  // the middle is where the household walks, so the dye has gone out of it, and
  // the corners nobody treads on keep theirs. Dithered at both boundaries so
  // neither has an edge to notice.
  const ccx = (w - 1) / 2;
  const ccy = (h - 1) / 2;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - ccx) / (w * 0.42), (y - ccy) / (h * 0.42));
      if (d < 1) {
        if (d > 0.55 && bayer(x, y) > (1 - d) / 0.45) continue;
        b.set(x, y, shade(b.get(x, y), 0.32));
      } else if (d > 1.15) {
        if (bayer(x, y) > (d - 1.15) * 1.6) continue;
        b.set(x, y, shade(b.get(x, y), -0.32));
      }
    }
  }
  // --- Centre figure -------------------------------------------------------
  const med = parseArt(w >= 40 ? RUG_MEDALLION : RUG_MEDALLION_SMALL, {
    d: ramp[0],
    h: ramp[4],
    l: ramp[3],
  });
  b.blit(med, mx0, my0);
  // --- Bound edge ----------------------------------------------------------
  // A rug has thickness, so the edge that faces the key light is a step up and
  // the one facing away is a step down. One pixel each — any more and we are
  // back to concentric rectangles.
  b.hline(0, w - 1, y0, ramp[3]);
  b.hline(0, w - 1, y1, ramp[0]);
  b.vline(0, y0, y1, ramp[3]);
  b.vline(w - 1, y0, y1, ramp[0]);
  // --- Fringe --------------------------------------------------------------
  // Loose thread, 1-2px, with gaps where it has been walked flat. A solid line
  // of it would just be a sixth concentric rectangle.
  for (const [edge, dir] of [
    [y0, -1],
    [y1, 1],
  ] as [number, number][]) {
    for (let x = 1; x < w - 1; x += 2) {
      if (rng.chance(0.22)) continue;
      const len = rng.int(1, 2);
      const c = rng.chance(0.5) ? ramp[4] : dir < 0 ? ramp[3] : ramp[2];
      const sx = x + rng.int(0, 1);
      for (let k = 1; k <= len; k++) b.set(sx, edge + dir * k, c);
    }
  }
  return b;
}

/** The doormat / exit trigger, drawn on the floor at the door. */
export function doorMat(): PixelBuffer {
  const b = new PixelBuffer(28, 12);
  b.fillRect(0, 0, 28, 12, R.wood[1]);
  b.fillRect(1, 1, 26, 10, R.wood[2]);
  for (let x = 2; x < 26; x += 3) b.vline(x, 2, 9, R.wood[1]);
  b.hline(0, 27, 0, R.wood[3]);
  return b;
}

/** Interior side of the front door, set into the back or bottom wall. */
export function innerDoor(): PixelBuffer {
  const b = new PixelBuffer(24, 30);
  b.fillRect(0, 0, 24, 30, R.wood[0]);
  b.fillRect(2, 2, 20, 28, R.wood[2]);
  for (let x = 2; x < 22; x += 5) b.vline(x, 2, 29, R.wood[1]);
  b.hline(2, 21, 2, R.wood[3]);
  b.fillRect(2, 8, 20, 2, R.metal[1]);
  b.fillRect(2, 22, 20, 2, R.metal[1]);
  b.ellipse(18, 16, 1.6, 1.6, R.gold[3]);
  b.selOutline();
  return b;
}

/**
 * A flight of stairs going up and away from the camera.
 *
 * The first version stacked six identical treads, which reads as a striped
 * decal pasted onto the back wall. A staircase seen in this projection is a
 * *perspective* object: every tread further up the flight is narrower (it is
 * further away) and one step darker (it is further from the room's lamps), the
 * two stringers converge towards the landing, and the bottom tread needs a
 * contact shadow or the whole flight floats. Far steps are drawn first so the
 * near ones overlap them, which is the other half of the depth cue.
 */
export function stairsUp(): PixelBuffer {
  const b = new PixelBuffer(28, 30);
  const cx = 14;
  const STEPS = 6;
  const shape = (i: number): { y: number; x0: number; x1: number } => {
    const half = 12 - i * 1.5;
    return { y: 24 - i * 4, x0: Math.round(cx - half), x1: Math.round(cx + half) };
  };
  const near = shape(0);
  const far = shape(STEPS - 1);
  // Contact shadow at the foot of the flight.
  b.groundShadow(cx, 28, 13, 2.4, 130);
  // The dark landing the flight disappears into.
  b.fillRect(far.x0 + 1, 0, far.x1 - far.x0 - 1, far.y + 2, R.night[0]);
  b.hline(far.x0 + 1, far.x1 - 1, 0, R.night[1]);
  // Stringers, then a handrail line a couple of pixels outboard of each. Both
  // pairs converge on the landing, which is what sells the recession.
  b.line(near.x0 - 1, near.y + 4, far.x0 - 1, far.y, R.wood[1]);
  b.line(near.x1 + 1, near.y + 4, far.x1 + 1, far.y, R.wood[0]);
  b.line(near.x0 - 2, near.y + 1, far.x0 - 2, far.y - 4, R.wood[3]);
  b.line(near.x1 + 2, near.y + 1, far.x1 + 2, far.y - 4, R.wood[1]);
  // Balusters: short uprights from the stringer to the rail, thinning out as
  // the flight recedes.
  for (let i = 0; i < STEPS; i += 2) {
    const s = shape(i);
    b.vline(s.x0 - 2, s.y - 3, s.y, R.wood[1]);
    b.vline(s.x1 + 2, s.y - 3, s.y, R.wood[0]);
  }
  for (let i = STEPS - 1; i >= 0; i--) {
    const s = shape(i);
    // Value drops a step at a time going up: nearest treads are lit, the top
    // of the flight sinks towards the landing.
    const step = i < 2 ? 2 : i < 4 ? 1 : 0;
    b.fillRect(s.x0, s.y, s.x1 - s.x0 + 1, 4, R.wood[step]);
    b.hline(s.x0, s.x1, s.y, R.wood[Math.min(4, step + 2)]);
    b.hline(s.x0, s.x1, s.y + 3, R.night[i > 3 ? 0 : 1]);
  }
  b.selOutline();
  return b;
}

/**
 * The millstone: the machine the whole building exists for.
 *
 * Seen from above it is two stacked discs — a fixed bed stone and a smaller
 * runner turning on top of it — on a timber trestle, with dressing furrows cut
 * radially into the runner's face and a driving handle pegged near its rim.
 * Two frames, a sixth of a turn apart and played slowly: the furrows and the
 * handle move, which is all it takes to read as a heavy thing turning.
 */
export function millstoneClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 2; f++) {
    const b = new PixelBuffer(34, 30);
    const cx = 17;
    b.groundShadow(cx, 27, 15, 3, 130);
    // Trestle: two legs and a stretcher, sized so they peek out *below* the
    // stone. Furniture that is entirely hidden by what stands on it is wasted.
    for (const lx of [4, 26]) {
      b.fillRect(lx, 16, 4, 10, R.wood[1]);
      b.vline(lx, 16, 25, R.wood[2]);
      b.hline(lx, lx + 3, 25, R.wood[0]);
    }
    b.fillRect(6, 22, 22, 2, R.wood[1]);
    b.hline(6, 27, 22, R.wood[2]);
    // Bed stone: the rim first, then the top face two pixels higher. That
    // offset is the stone's thickness — there is no other way to say it here.
    // Both discs are held in the *dark* half of the stone ramp: the mill floor
    // is itself stone, so a bright millstone standing on it has no silhouette
    // at all. The separation between the two stones has to come from one ramp
    // step and from the rims, not from making the whole thing pale.
    b.ellipse(cx, 15, 15, 7, R.stone[0]);
    b.ellipse(cx, 13, 15, 7, R.stone[1]);
    b.ellipse(cx - 1, 12.5, 13, 6, R.stone[2]);
    // Runner stone: smaller, higher, and one step lighter than the bed.
    b.ellipse(cx, 10, 11, 5.5, R.stone[0]);
    b.ellipse(cx, 8, 11, 5.5, R.stone[2]);
    b.ellipse(cx - 2, 7, 8, 3.6, R.stone[3]);
    b.ellipse(cx - 3, 6.5, 5, 2.2, R.stone[4]);
    // Dressing furrows, straight grooves radiating from the eye. Squashed on
    // the vertical axis by the same amount as the disc.
    const rot = f * (Math.PI / 6);
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a) * 0.5;
      b.line(cx + ca * 3.5, 8 + sa * 3.5, cx + ca * 10, 8 + sa * 10, R.stone[0]);
    }
    // The eye, with the iron rynd bridged across it.
    b.ellipse(cx, 8, 2.4, 1.5, R.night[1]);
    b.hline(cx - 3, cx + 3, 8, R.metal[2]);
    b.set(cx - 3, 8, R.metal[3]);
    // Driving handle, pegged near the rim and swinging round with the stone.
    const ha = rot + (f ? Math.PI * 0.62 : Math.PI * 0.12);
    const hx = cx + Math.cos(ha) * 9;
    const hy = 8 + Math.sin(ha) * 4.5;
    b.capsule(hx, hy, hx, hy - 6, 1.2, R.wood[2]);
    b.set(Math.round(hx), Math.round(hy) - 7, R.wood[3]);
    b.set(Math.round(hx) + 1, Math.round(hy) - 2, R.wood[0]);
    // Meal spilt round the base, in 2px dashes — single specks on top of the
    // contact shadow just read as dirt on the screen.
    for (let i = 0; i < 5; i++) {
      const mx = 7 + i * 5 + ((i + f) % 2);
      b.hline(mx, mx + 1, 26 + ((i + f) % 2), R.paper[f ? 3 : 4]);
    }
    b.selOutline();
    frames.push(b);
  }
  return clip(bakeSheet(frames, 17, 28), [0, 1], 1.2);
}

/**
 * The meal spout: a planked hopper on posts, feeding a bin of flour. This is
 * where the ground grain comes out, and it is what turns "a room with a big
 * stone in it" into a mill.
 */
export function flourChute(): PixelBuffer {
  const b = new PixelBuffer(22, 30);
  b.groundShadow(11, 28, 9, 2.2, 120);
  // Support posts, drawn first so the hopper sits on them.
  b.fillRect(1, 3, 2, 16, R.wood[1]);
  b.fillRect(19, 3, 2, 16, R.wood[2]);
  // Hopper: a trapezoid, never a box — a box on stilts reads as a crate.
  for (let i = 0; i < 10; i++) {
    const half = 9 - Math.round(i * 0.67);
    const y = 2 + i;
    b.hline(11 - half, 11 + half, y, i === 0 ? R.wood[3] : i % 3 === 0 ? R.wood[1] : R.wood[2]);
  }
  b.hline(2, 20, 2, R.wood[4]);
  b.line(2, 3, 8, 11, R.wood[3]);
  b.line(20, 3, 14, 11, R.wood[0]);
  // Spout, and the thin fall of meal dropping out of it.
  b.fillRect(9, 12, 4, 2, R.wood[1]);
  b.hline(9, 12, 12, R.wood[2]);
  b.vline(11, 14, 15, R.paper[4]);
  b.set(10, 15, R.paper[3]);
  // Bin: a plank box with staves and feet.
  b.fillRect(2, 19, 18, 9, R.wood[1]);
  b.fillRect(2, 19, 18, 2, R.wood[2]);
  for (const x of [5, 10, 15]) b.vline(x, 21, 26, R.wood[0]);
  b.hline(2, 19, 27, R.wood[0]);
  b.fillRect(2, 28, 2, 1, R.wood[0]);
  b.fillRect(18, 28, 2, 1, R.wood[0]);
  // The meal heaped proud of the rim, lit from the left.
  b.ellipse(11, 18, 7, 1.8, R.paper[3]);
  b.ellipse(10, 17, 5, 1.4, R.paper[4]);
  b.hline(5, 17, 20, R.paper[2]);
  b.selOutline();
  return b;
}

/** A baled truss of hay: a squat box bound with two cords. */
export function hayBale(seed: number): PixelBuffer {
  const rng = new RNG(seed);
  const b = new PixelBuffer(22, 16);
  b.groundShadow(11, 14, 10, 2.2, 120);
  // Two planes meeting — the top face and the cut front face — do the reading.
  // Speckling the whole thing with straw would just make a yellow smudge.
  b.fillRect(1, 4, 20, 9, R.sand[2]);
  b.fillRect(1, 2, 20, 3, R.sand[3]);
  b.hline(2, 19, 2, R.sand[4]);
  b.hline(1, 20, 12, R.sand[1]);
  b.vline(1, 4, 12, R.sand[3]);
  b.vline(20, 4, 12, R.sand[1]);
  // Straw ends only on the cut face, in clusters rather than as noise.
  for (let i = 0; i < 9; i++) {
    const x = 3 + rng.int(0, 16);
    const y = 5 + rng.int(0, 6);
    b.set(x, y, R.sand[y < 8 ? 3 : 1]);
  }
  // A few wisps standing proud of the top — in 2px pairs, because single stray
  // pixels read as dirt on the screen rather than as straw.
  for (let i = 0; i < 3; i++) {
    const x = 4 + i * 6 + rng.int(0, 2);
    b.set(x, 1, R.sand[3]);
    b.set(x + 1, 1, R.sand[4]);
  }
  // Two binding cords.
  for (const cxx of [6, 15]) {
    b.vline(cxx, 2, 12, R.wood[1]);
    b.set(cxx, 3, R.wood[2]);
  }
  b.selOutline();
  return b;
}

/** Livestock water trough: a hollowed log with a still water surface in it. */
export function waterTrough(): PixelBuffer {
  const b = new PixelBuffer(26, 16);
  b.groundShadow(13, 14, 11, 2.2, 120);
  // Log body with the ends left proud, so it reads as hollowed timber and not
  // as a crate with blue paint in it.
  b.fillRect(2, 4, 22, 9, R.wood[1]);
  b.fillRect(2, 3, 22, 2, R.wood[2]);
  b.hline(2, 23, 12, R.wood[0]);
  b.fillRect(1, 2, 3, 11, R.wood[2]);
  b.fillRect(22, 2, 3, 11, R.wood[1]);
  // Water: an inset surface, darker where it meets the far side, with two flat
  // highlight strokes. Flat bands, not a gradient.
  b.fillRect(5, 4, 16, 5, R.water[2]);
  b.hline(5, 20, 4, R.water[0]);
  b.hline(5, 20, 5, R.water[1]);
  b.hline(7, 12, 7, R.water[3]);
  b.hline(15, 19, 6, R.water[4]);
  b.hline(5, 20, 9, R.water[1]);
  // Iron bands, on the front face only.
  for (const x of [8, 17]) b.vline(x, 10, 12, R.metal[1]);
  b.selOutline();
  return b;
}

// ---------------------------------------------------------------------------
// Wall furniture
//
// A wall with one painting on it is a wall with a stamp on it. What makes an
// interior read as somebody's workplace is the *trade-specific* junk hung at
// head height — pans in a kitchen, tongs in a forge, a key board behind a
// desk. All of these are bottom-anchored so they can be dropped at a single
// wall height and sorted at 0, in front of the wall and behind everything else.
// ---------------------------------------------------------------------------

/** The peg rail that half of this section hangs from. */
function pegRail(b: PixelBuffer, x0: number, x1: number, y: number, pegs: readonly number[]): void {
  b.hline(x0, x1, y, R.wood[2]);
  b.hline(x0, x1, y + 1, R.wood[0]);
  for (const px of pegs) {
    b.vline(px, y + 2, y + 3, R.wood[1]);
    b.set(px, y + 3, R.wood[0]);
  }
}

/**
 * Tavern kitchen: a pan, a ladle and a cleaver hung off one rail.
 *
 * All three are held at the *light* end of the iron ramp. The first version
 * used steps 1-2, which is what an iron pan actually is — and against a log
 * wall that is already in the dark half of the wood ramp it vanished into a
 * black smudge. Value contrast against the surface a thing hangs on beats
 * material accuracy every time.
 */
export function panRack(): PixelBuffer {
  const b = new PixelBuffer(29, 22);
  pegRail(b, 1, 27, 0, [7, 16, 23]);
  // The pan hangs by the hole in its *handle*, so the handle runs up to the
  // peg and the disc swings below it. Hung by the rim it reads as a shield.
  b.vline(7, 3, 8, R.metal[2]);
  b.set(7, 4, R.metal[4]);
  b.ellipse(7, 13, 5.5, 4.5, R.metal[0]);
  b.ellipse(7, 12, 4.5, 3.6, R.metal[3]);
  b.ellipse(6, 11, 2.4, 1.6, R.metal[4]);
  b.hline(3, 11, 16, R.metal[0]);
  // Ladle: wooden shaft, bright bowl.
  b.vline(16, 3, 11, R.wood[3]);
  b.set(15, 5, R.wood[1]);
  b.ellipse(16, 14, 2.6, 2.2, R.metal[1]);
  b.ellipse(16, 13, 2, 1.6, R.metal[4]);
  // A cleaver — three identical silhouettes in a row would read as wallpaper.
  b.vline(23, 3, 6, R.wood[2]);
  b.fillRect(21, 7, 6, 6, R.metal[3]);
  b.hline(21, 26, 7, R.metal[4]);
  b.hline(21, 26, 12, R.metal[0]);
  b.vline(26, 7, 12, R.metal[1]);
  b.selOutline();
  return b;
}

/** A bunch of herbs hung up to dry — widest at the bottom, because it is upside down. */
export function herbBundle(seed: number): PixelBuffer {
  const rng = new RNG(seed * 17 + 3);
  const b = new PixelBuffer(15, 21);
  // Cord and a *narrow* corded neck. A fat block at the top pulls the eye off
  // the leaves and the whole thing reads as a mallet.
  b.vline(7, 0, 3, R.wood[1]);
  b.hline(6, 8, 4, R.wood[3]);
  b.hline(6, 8, 5, R.wood[1]);
  for (let i = 0; i < 9; i++) {
    const dx = (i - 4) * 0.5;
    const len = 10 + rng.int(0, 5);
    // Nearly parallel, only slightly splayed. Fanned wide from a single point
    // the bunch comes out as a perfect triangle and reads as a small fir tree
    // nailed to the wall. Mostly leaf, with two dried stems — an even
    // alternation put a solid band of sand across the top instead.
    const ramp: Ramp = i === 1 || i === 6 ? R.sand : R.leaf;
    b.capsule(7 + dx * 0.4, 6, 7 + dx, 7 + len, 1, ramp[i % 2 ? 2 : 1]);
    b.set(Math.round(7 + dx), 7 + len, ramp[0]);
  }
  // The cord and the bound neck sit *over* the stems, so the eye reads "tied
  // bunch" before it reads "green shape".
  b.hline(5, 9, 5, R.wood[3]);
  b.hline(5, 9, 6, R.wood[1]);
  // Lit tips on the key-light side only — never a rim all the way round.
  b.set(3, 12, R.leaf[3]);
  b.set(4, 15, R.leaf[3]);
  b.set(5, 10, R.leaf[3]);
  b.set(9, 13, R.sand[3]);
  b.selOutline();
  return b;
}

/** The rack of bottles behind a bar. */
export function bottleShelf(w: number, seed: number): PixelBuffer {
  const rng = new RNG(seed * 29 + 5);
  const b = new PixelBuffer(w, 24);
  for (const sy of [10, 22]) {
    b.fillRect(0, sy, w, 2, R.wood[2]);
    b.hline(0, w - 1, sy, R.wood[3]);
    b.hline(0, w - 1, sy + 1, R.wood[0]);
  }
  b.vline(0, 0, 23, R.wood[1]);
  b.vline(w - 1, 0, 23, R.wood[1]);
  for (const sy of [10, 22]) {
    let x = 2;
    while (x < w - 5) {
      const ramp: Ramp = rng.pick([R.leaf, R.teal, R.purple, R.red, R.gold]);
      const bh = rng.int(6, 8);
      // Body, shoulder, neck: three widths. A bottle drawn as one bar of
      // colour is a bar of colour.
      b.fillRect(x, sy - bh + 2, 3, bh - 2, ramp[2]);
      b.vline(x, sy - bh + 2, sy - 1, ramp[3]);
      b.vline(x + 2, sy - bh + 2, sy - 1, ramp[1]);
      b.vline(x + 1, sy - bh, sy - bh + 1, ramp[2]);
      b.set(x + 1, sy - bh - 1, R.wood[1]);
      b.set(x, sy - bh + 3, ramp[4]);
      x += rng.int(4, 6);
    }
  }
  b.selOutline();
  return b;
}

/** Shop paperwork: two pinned scrolls and the ledger hanging off a nail. */
export function ledgerBoard(): PixelBuffer {
  const b = new PixelBuffer(25, 21);
  for (const [sx, sh] of [
    [1, 15],
    [8, 11],
  ] as [number, number][]) {
    b.fillRect(sx, 1, 6, sh, R.paper[3]);
    b.vline(sx, 1, sh, R.paper[2]);
    b.vline(sx + 5, 1, sh, R.paper[2]);
    b.hline(sx, sx + 5, 1, R.paper[4]);
    for (let i = 4; i < sh - 1; i += 3) b.hline(sx + 1, sx + 4, i, R.night[2]);
    // The curl at the foot, and the pin at the head.
    b.hline(sx, sx + 5, sh, R.wood[1]);
    b.set(sx + 2, 0, R.metal[3]);
  }
  b.vline(19, 0, 2, R.metal[1]);
  b.fillRect(16, 3, 8, 11, R.red[1]);
  b.fillRect(17, 4, 6, 9, R.paper[3]);
  b.vline(20, 4, 12, R.red[2]);
  for (let i = 6; i < 13; i += 2) {
    b.hline(17, 19, i, R.night[2]);
    b.hline(21, 22, i, R.night[2]);
  }
  b.selOutline();
  return b;
}

/** Horseshoes nailed up in the forge. */
export function horseshoes(): PixelBuffer {
  const b = new PixelBuffer(24, 17);
  const shoe = (cx: number, cy: number, r: number): void => {
    // A U, never an O — the open heel is the whole silhouette.
    for (let y = -r - 1; y <= r + 1; y++) {
      for (let x = -r - 1; x <= r + 1; x++) {
        const d = Math.hypot(x, y);
        if (d > r + 0.5 || d < r - 1.2) continue;
        if (y > r * 0.4) continue;
        b.set(cx + x, cy + y, x < 0 || y < 0 ? R.metal[3] : R.metal[1]);
      }
    }
    b.set(cx - r + 1, cy - 1, R.night[1]);
    b.set(cx + r - 1, cy - 1, R.night[1]);
    b.vline(cx, cy - r - 3, cy - r, R.metal[1]);
    b.set(cx, cy - r - 3, R.metal[4]);
  };
  shoe(6, 11, 4);
  shoe(17, 9, 5);
  b.selOutline();
  return b;
}

/** The smith's tools, hung where he can reach them without looking. */
export function toolRack(): PixelBuffer {
  const b = new PixelBuffer(31, 24);
  pegRail(b, 0, 30, 0, [5, 12, 19, 26]);
  // Hammer: haft hanging down, head crossing the top of it.
  b.vline(5, 3, 17, R.wood[2]);
  b.set(6, 7, R.wood[1]);
  b.fillRect(2, 3, 7, 4, R.metal[1]);
  b.hline(2, 8, 3, R.metal[3]);
  b.fillRect(9, 4, 2, 2, R.metal[2]);
  // Tongs: two legs off one rivet.
  b.line(12, 3, 9, 19, R.metal[2]);
  b.line(12, 3, 14, 19, R.metal[1]);
  b.set(12, 6, R.metal[4]);
  b.set(9, 19, R.metal[0]);
  b.set(14, 19, R.metal[0]);
  // File: a bar with a cut face and a wooden tang.
  b.fillRect(18, 3, 3, 12, R.metal[2]);
  b.vline(18, 3, 14, R.metal[3]);
  for (let y = 5; y < 15; y += 2) b.set(19, y, R.metal[0]);
  b.fillRect(18, 15, 3, 5, R.wood[2]);
  b.hline(18, 20, 15, R.wood[3]);
  // Nippers.
  b.line(26, 3, 24, 15, R.metal[1]);
  b.line(26, 3, 28, 15, R.metal[2]);
  b.set(26, 5, R.metal[4]);
  b.fillRect(24, 15, 5, 3, R.metal[0]);
  b.hline(24, 28, 15, R.metal[2]);
  b.selOutline();
  return b;
}

/** The key board behind an inn desk: pigeon-holes, half of them empty. */
export function keyBoard(): PixelBuffer {
  const b = new PixelBuffer(27, 21);
  b.fillRect(0, 0, 27, 21, R.wood[1]);
  b.fillRect(1, 1, 25, 19, R.wood[2]);
  b.hline(1, 25, 1, R.wood[3]);
  b.hline(1, 25, 19, R.wood[0]);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const x = 3 + c * 6;
      const y = 3 + r * 8;
      b.fillRect(x, y, 5, 6, R.night[0]);
      b.hline(x, x + 4, y + 6, R.wood[3]);
      b.vline(x - 1, y, y + 5, R.wood[1]);
      // Keys in some holes, never all: a full board is a grid, and a grid is
      // texture rather than a thing.
      if ((r * 4 + c) % 3 !== 1) {
        // Bow, shaft, bit. A shaft with one pixel kicked out at the foot —
        // the first version — is an L, not a key: the ring at the top is what
        // the eye actually recognises.
        b.set(x + 1, y + 1, R.gold[4]);
        b.set(x + 2, y + 1, R.gold[3]);
        b.set(x + 1, y + 2, R.gold[3]);
        b.set(x + 2, y + 2, R.gold[2]);
        b.vline(x + 2, y + 3, y + 4, R.gold[2]);
        b.set(x + 3, y + 4, R.gold[3]);
      }
    }
  }
  b.selOutline();
  return b;
}

/** A string of dried onions hung across a shop window. */
export function dryGoods(seed: number): PixelBuffer {
  const rng = new RNG(seed * 41 + 11);
  const b = new PixelBuffer(30, 20);
  // The sag is the point: a straight cord reads as a shelf.
  const cordY = (x: number): number => 1 + Math.round(Math.sin((x / 29) * Math.PI) * 3);
  for (let x = 0; x < 30; x++) {
    b.set(x, cordY(x), R.wood[2]);
    b.set(x, cordY(x) + 1, R.wood[0]);
  }
  for (let i = 0; i < 5; i++) {
    const x = 3 + i * 6;
    const y = cordY(x) + 3;
    const ramp: Ramp = i % 2 ? R.gold : R.red;
    const rr = 2 + rng.next() * 0.9;
    b.vline(x, y - 2, y, ramp[1]);
    b.ellipse(x, y + 3, rr, rr + 0.8, ramp[2]);
    b.ellipse(x - 1, y + 2, 1.2, 1.4, ramp[3]);
    b.set(x, y + 6, ramp[1]);
    b.set(x + 2, y + 4, ramp[1]);
  }
  b.selOutline();
  return b;
}

/**
 * A candle sconce. What changes between frames is the flame's *shape*, not its
 * brightness — a flame that only pulses in value reads as a blinking lamp.
 */
export function sconceClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 3; f++) {
    const b = new PixelBuffer(12, 18);
    // Bracket, in three unambiguous parts: a plate flat against the wall, an
    // arm sloping up off it, and a saucer wider than the candle. The first
    // version stacked two ellipses where the pan should be and the silhouette
    // came out as a small white bird.
    b.fillRect(0, 4, 2, 8, R.metal[1]);
    b.set(0, 4, R.metal[3]);
    b.set(1, 11, R.metal[0]);
    b.line(2, 11, 6, 10, R.metal[2]);
    b.hline(3, 10, 10, R.metal[3]);
    b.hline(4, 9, 11, R.metal[1]);
    // Candle stub, wax running down one side only.
    b.fillRect(5, 4, 3, 6, R.paper[3]);
    b.vline(5, 4, 9, R.paper[4]);
    b.vline(7, 4, 9, R.paper[2]);
    b.set(8, 8, R.paper[3]);
    b.selOutline();
    // Flame after the outline, or it comes back ringed in ink.
    const fh = 3 + (f === 1 ? 1 : 0);
    b.vline(6, 3 - fh, 3, R.fire[4]);
    b.set(6 + (f === 2 ? 1 : 0), 2 - fh, R.fire[3]);
    b.set(6, 3, R.gold[4]);
    b.set(5, 2, R.fire[2]);
    b.set(7, 2, R.fire[2]);
    frames.push(b);
  }
  return clip(bakeSheet(frames, 3, 17), [0, 1, 2, 1], 6);
}

/** An arched stained window: coloured lights held in a lead lattice. */
export function stainedGlass(): PixelBuffer {
  const b = new PixelBuffer(28, 36);
  const inArch = (x: number, y: number): boolean => {
    if (x < 2 || x > 25 || y > 34) return false;
    if (y >= 13) return true;
    const dx = (x - 14) / 12;
    const dy = (y - 13) / 11;
    return dx * dx + dy * dy <= 1;
  };
  for (let y = 0; y < 36; y++) for (let x = 0; x < 28; x++) if (inArch(x, y)) b.set(x, y, R.stone[1]);
  const tints: Ramp[] = [R.teal, R.red, R.gold, R.purple, R.leaf];
  for (let y = 0; y < 36; y++) {
    for (let x = 0; x < 28; x++) {
      // Two pixels of stone reveal all round the glass.
      if (!inArch(x, y)) continue;
      let open = true;
      for (let oy = -2; oy <= 2 && open; oy++) for (let ox = -2; ox <= 2; ox++) if (!inArch(x + ox, y + oy)) open = false;
      if (!open) continue;
      const lead = (x - 4) % 5 === 0 || (y - 4) % 6 === 0;
      if (lead) {
        b.set(x, y, R.night[1]);
        continue;
      }
      const cell = Math.floor((x - 4) / 5) + Math.floor((y - 4) / 6) * 3;
      const ramp = tints[((cell % tints.length) + tints.length) % tints.length];
      b.set(x, y, ramp[hash2(x, y) > 0.72 ? 4 : 3]);
    }
  }
  // A pale roundel at the centre so the window has a focus rather than being
  // an even chequer of colour.
  b.ellipse(14, 15, 4, 4, R.paper[4]);
  b.ellipse(14, 15, 4, 4, R.gold[3], false);
  b.ellipse(13, 14, 1.6, 1.6, R.gold[4]);
  // Sill.
  b.fillRect(0, 33, 28, 3, R.stone[2]);
  b.hline(0, 27, 33, R.stone[3]);
  b.hline(0, 27, 35, R.stone[0]);
  b.selOutline();
  return b;
}

/** A horse collar and its straps, hung on a barn wall. */
export function harness(): PixelBuffer {
  const b = new PixelBuffer(21, 27);
  b.set(10, 0, R.metal[4]);
  b.vline(10, 1, 3, R.metal[1]);
  for (let y = -7; y <= 7; y++) {
    for (let x = -6; x <= 6; x++) {
      const d = (x / 6) ** 2 + (y / 7) ** 2;
      if (d > 1 || d < 0.3) continue;
      b.set(10 + x, 11 + y, x < 0 || y < 0 ? R.wood[2] : R.wood[1]);
    }
  }
  b.set(6, 7, R.wood[3]);
  b.set(8, 5, R.wood[3]);
  // Straps trailing off it. They have to be *wide* and carry real buckles —
  // 1px cords under a ring just read as the tail of a letter, and the whole
  // thing comes out as an omega painted on the wall.
  b.fillRect(4, 16, 3, 9, R.wood[1]);
  b.vline(4, 16, 24, R.wood[2]);
  b.hline(4, 6, 24, R.wood[0]);
  b.fillRect(13, 16, 3, 8, R.wood[2]);
  b.vline(15, 16, 23, R.wood[0]);
  // Buckles: a bright frame with a dark tongue through it.
  b.fillRect(3, 20, 5, 4, R.metal[3]);
  b.fillRect(4, 21, 3, 2, R.wood[0]);
  b.set(3, 20, R.metal[4]);
  b.fillRect(12, 19, 5, 3, R.metal[2]);
  b.hline(12, 16, 19, R.metal[4]);
  b.selOutline();
  return b;
}

/** Cottage window: shuttered, dusk beyond it, and somebody's pot on the sill. */
export function sillWindow(): PixelBuffer {
  const b = new PixelBuffer(36, 27);
  b.fillRect(3, 0, 30, 22, R.wood[1]);
  b.fillRect(5, 2, 26, 18, R.night[1]);
  // Dusk in two flat bands with a hard horizon. Never a gradient.
  b.fillRect(5, 2, 26, 9, R.teal[1]);
  b.fillRect(5, 11, 26, 9, R.night[2]);
  b.hline(5, 30, 11, R.gold[1]);
  for (let i = 0; i < 5; i++) b.set(8 + i * 5, 4 + ((i * 3) % 5), R.paper[4]);
  // Glazing bars and the frame.
  b.vline(17, 2, 19, R.wood[2]);
  b.hline(5, 30, 9, R.wood[2]);
  b.strokeRect(5, 2, 26, 18, R.wood[2]);
  b.hline(5, 30, 2, R.wood[3]);
  // Sill, proud of the frame on both sides.
  b.fillRect(0, 20, 36, 3, R.wood[2]);
  b.hline(0, 35, 20, R.wood[3]);
  b.hline(0, 35, 22, R.wood[0]);
  // The pot that makes it somebody's window rather than a hole.
  b.fillRect(23, 15, 7, 5, R.red[2]);
  b.hline(22, 30, 15, R.red[3]);
  b.hline(23, 29, 19, R.red[1]);
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i / 4) * Math.PI;
    b.capsule(26, 15, 26 + Math.cos(a) * 4, 15 + Math.sin(a) * 5, 1, R.leaf[1 + (i % 2)]);
  }
  b.set(24, 10, R.gold[4]);
  b.set(28, 11, R.red[3]);
  b.set(26, 9, R.purple[3]);
  b.selOutline();
  return b;
}

// ---------------------------------------------------------------------------
// Table and floor clutter
//
// Everything here is under 13px, so per rule 8 it is hand-dotted rather than
// assembled out of ellipses: an ellipse bowl is a coloured smudge. These are
// the objects that stop a table being a slab and a floor being a plane.
// ---------------------------------------------------------------------------

// The spoon has to touch the rim. Floated a pixel clear of it — the first
// version — it stops being a spoon and becomes a speck of screen dirt.
const BOWL_ART = [
  '.....s..',
  '..LLLs..',
  '.LppppL.',
  '.LpPPpL.',
  '.DwwwwD.',
  '..DDDD..',
];

const PLATES_ART = [
  '..pppp..',
  '.pPPPPp.',
  '.dppppd.',
  '.eeeeee.',
  '.deeeed.',
  '..eeee..',
];

const MUG_ART = [
  '.MMMM..',
  '.MffM.h',
  '.MffMhh',
  '.MaaMh.',
  '.MaaM..',
  '.MAAM..',
  '..MM...',
];

const CANDLE_ART = [
  '..f..',
  '..F..',
  '..n..',
  '.wWw.',
  '.wWw.',
  '.wWw.',
  'sssss',
  '.SSS.',
];

// Closed, and mostly cover. Drawn open at 11x6 the two pale pages read as a
// pair of glowing tiles — at this size the *page edges* down one side are the
// only detail that says "book" without also saying "domino".
const BOOK_ART = [
  '.rrrrrrrr.',
  'rRRRRRRRRe',
  'rRRRRRRRRP',
  'rRRRRRRRRP',
  'rRRRRRRRRe',
  '.rrrrrrrr.',
];

const SEWING_ART = [
  '....rr...',
  '...rRRr..',
  '...rrrr..',
  '.bbbbbbb.',
  'bBbBbBbBb',
  'bbBbBbBbb',
  '.bbbbbbb.',
  '..bbbbb..',
];

const BREAD_ART = [
  '..dddd..',
  '.dLLLLd.',
  'dLWWsLLd',
  'dLsLLLLd',
  '.dLLLLd.',
  '..dddd..',
];

const LEDGER_ART = [
  '.........q',
  '.......qQ.',
  '.rrrrrrq..',
  'rPPPPPPr..',
  'rPPPPPPr..',
  '.rrrrrrr..',
];

const CLUTTER_MAP: Record<string, RGBA> = {
  L: R.wood[3],
  D: R.wood[1],
  w: R.wood[2],
  s: R.wood[4],
  p: R.paper[3],
  P: R.paper[4],
  d: R.paper[1],
  e: R.paper[2],
  n: R.night[2],
  r: R.red[1],
  R: R.red[3],
  M: R.metal[2],
  h: R.metal[1],
  f: R.paper[4],
  a: R.gold[2],
  A: R.gold[1],
  F: R.gold[4],
  b: R.wood[1],
  B: R.wood[3],
  q: R.paper[4],
  Q: R.paper[2],
  W: R.sand[4],
  S: R.metal[1],
};

/** The bread loaf borrows the sand ramp; everything else shares one map. */
const BREAD_MAP: Record<string, RGBA> = {
  d: R.sand[1],
  L: R.sand[3],
  W: R.sand[4],
  s: R.sand[1],
};

const CANDLE_MAP: Record<string, RGBA> = {
  f: R.fire[3],
  F: R.gold[4],
  n: R.night[1],
  w: R.paper[3],
  W: R.paper[4],
  s: R.metal[2],
  S: R.metal[1],
};

function clutter(rows: string[], map: Record<string, RGBA> = CLUTTER_MAP, outline = true): PixelBuffer {
  const b = parseArt(rows, map);
  if (outline) b.selOutline();
  return b;
}

/** The balance a shopkeeper weighs by; one pan hangs lower, so it is in use. */
export function scales(): PixelBuffer {
  const b = new PixelBuffer(19, 17);
  b.groundShadow(9, 15, 7, 1.6, 90);
  b.fillRect(8, 4, 2, 9, R.metal[1]);
  b.vline(8, 4, 12, R.metal[2]);
  b.hline(2, 16, 4, R.metal[2]);
  b.hline(2, 16, 5, R.metal[0]);
  b.set(9, 3, R.metal[4]);
  for (const x of [3, 15]) {
    b.vline(x, 6, 8, R.metal[1]);
    b.set(x, 6, R.metal[3]);
  }
  b.ellipse(3, 9, 3, 1.4, R.metal[2]);
  b.hline(1, 5, 10, R.metal[1]);
  b.ellipse(15, 10, 3, 1.4, R.metal[2]);
  b.hline(13, 17, 11, R.metal[1]);
  // Brass weights, in the pan that has dropped.
  b.fillRect(14, 8, 3, 2, R.gold[2]);
  b.hline(14, 16, 8, R.gold[4]);
  // Base.
  b.fillRect(5, 13, 8, 2, R.wood[2]);
  b.hline(5, 12, 13, R.wood[3]);
  b.hline(4, 13, 15, R.wood[0]);
  b.selOutline();
  return b;
}

/** Firewood stacked end-on against a wall, with a split billet at its foot. */
export function logPile(seed: number): PixelBuffer {
  const rng = new RNG(seed * 53 + 9);
  const b = new PixelBuffer(30, 21);
  b.groundShadow(15, 19, 13, 2.2, 110);
  const logAt = (cx: number, cy: number, r: number): void => {
    // Dark bark ring, *pale* sawn face. Both halves are load-bearing: without
    // the ring the discs merge into one lumpy mass, and without the pale face
    // the stack is a honeycomb of brown holes. A cut end is the brightest
    // thing on a log, and that contrast is the whole read at this size.
    b.ellipse(cx, cy, r, r, R.wood[0]);
    b.ellipse(cx, cy - 0.4, r - 1, r - 1, R.wood[3]);
    b.ellipse(cx - 0.8, cy - 1, r - 2.4, r - 2.4, R.wood[4]);
    // Heart and one radial split. Concentric rings would just be noise here.
    b.set(cx, cy, R.wood[2]);
    b.line(cx, cy, cx + r - 2, cy - r + 2, R.wood[2]);
  };
  for (let i = 0; i < 3; i++) logAt(6 + i * 8, 15, 4);
  for (let i = 0; i < 2; i++) logAt(10 + i * 8, 8, 4);
  // A split billet lying across the foot, so the stack is not only discs.
  b.capsule(2, 18, 18, 19, 1.6, R.wood[1]);
  b.hline(2, 18, 17, R.wood[2]);
  b.set(19, 19, R.wood[0]);
  for (let i = 0; i < 4; i++) b.set(21 + rng.int(0, 5), 17 + rng.int(0, 2), R.wood[1]);
  b.selOutline();
  return b;
}

/** A basket of split firewood for a hearthside. */
export function woodBasket(): PixelBuffer {
  const b = new PixelBuffer(19, 21);
  b.groundShadow(9, 19, 8, 2, 110);
  // Billets first, so the basket rim overlaps their bottoms.
  for (let i = 0; i < 4; i++) {
    const x = 4 + i * 3;
    const hh = 8 + ((i * 5) % 4);
    b.fillRect(x, 13 - hh, 3, hh, i % 2 ? R.wood[1] : R.wood[2]);
    b.hline(x, x + 2, 13 - hh, R.wood[3]);
    b.set(x + 1, 15 - hh, R.wood[0]);
  }
  // Woven band: a checker, which at this size is what "wicker" looks like.
  b.fillRect(2, 11, 15, 8, R.wood[1]);
  for (let y = 11; y < 19; y++) for (let x = 2; x < 17; x++) if ((x + y) % 2 === 0) b.set(x, y, R.wood[2]);
  b.hline(2, 16, 11, R.wood[3]);
  b.hline(2, 16, 18, R.wood[0]);
  b.vline(1, 12, 16, R.wood[2]);
  b.vline(17, 12, 16, R.wood[1]);
  b.selOutline();
  return b;
}

/** The smith's quench tub, still steaming, with the tongs stood in it. */
export function quenchTubClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 4; f++) {
    const b = new PixelBuffer(22, 28);
    b.groundShadow(11, 26, 9, 2, 110);
    b.fillRect(3, 9, 16, 16, R.wood[1]);
    for (let x = 4; x < 19; x += 3) b.vline(x, 10, 24, R.wood[0]);
    b.hline(3, 18, 24, R.wood[0]);
    for (const y of [12, 21]) {
      b.hline(3, 18, y - 1, R.metal[2]);
      b.hline(3, 18, y, R.metal[1]);
    }
    // Water: an inset surface with flat highlight strokes, not a gradient.
    b.ellipse(11, 9, 8, 3, R.wood[2]);
    b.ellipse(11, 9, 7, 2.2, R.water[1]);
    b.hline(6, 12, 8, R.water[3]);
    b.hline(12, 15, 10, R.water[2]);
    // Tongs left standing in the water.
    b.line(14, 9, 16, 1, R.metal[2]);
    b.line(15, 9, 17, 1, R.metal[1]);
    b.selOutline();
    // Steam after the outline: 2px dashes climbing and thinning. Single
    // pixels here would read as screen dirt.
    for (let i = 0; i < 3; i++) {
      const t = ((f + i * 1.3) % 4) / 4;
      const sy = 7 - Math.round(t * 7);
      const sx = 6 + i * 4 + Math.round(Math.sin(t * 6 + i) * 1.6);
      b.hline(sx, sx + 1, sy, t > 0.55 ? R.stone[3] : R.paper[4]);
    }
    frames.push(b);
  }
  return clip(bakeSheet(frames, 11, 27), [0, 1, 2, 3], 5);
}

/** The forge's coal heap: facets and a couple of live embers. */
export function coalPile(seed: number): PixelBuffer {
  const rng = new RNG(seed * 61 + 17);
  const b = new PixelBuffer(24, 15);
  b.groundShadow(12, 13, 10, 2, 120);
  // A heap reads through its silhouette and a few flat faces, not through
  // speckle: build it out of overlapping lumps and let the gaps be the form.
  b.ellipse(12, 11, 10, 3, R.night[0]);
  b.ellipse(11, 9, 8, 2.8, R.night[1]);
  b.ellipse(9, 6, 4.5, 2.2, R.night[1]);
  for (let i = 0; i < 12; i++) {
    const x = 3 + rng.int(0, 17);
    const y = 4 + rng.int(0, 8);
    if (b.alphaAt(x, y) < 100) continue;
    b.set(x, y, R.night[2]);
    if (rng.chance(0.4)) b.set(x + 1, y, R.night[2]);
  }
  // Lit top faces, keyed top-left only.
  b.hline(6, 11, 5, R.night[3]);
  b.hline(4, 8, 8, R.night[2]);
  b.selOutline();
  // Embers after the outline so they are not ringed in ink.
  b.set(14, 8, R.fire[3]);
  b.set(15, 8, R.fire[2]);
  b.set(8, 10, R.fire[2]);
  return b;
}

/** Bar stock on the forge floor: two crossed bars and a billet on end. */
export function ironStock(): PixelBuffer {
  const b = new PixelBuffer(26, 13);
  b.groundShadow(13, 11, 11, 2, 100);
  // Crossed, not parallel — parallel bars read as a ladder.
  b.capsule(4, 9, 21, 7, 2, R.metal[1]);
  b.hline(4, 21, 6, R.metal[3]);
  b.capsule(6, 5, 23, 6, 1.8, R.metal[2]);
  b.hline(6, 22, 4, R.metal[4]);
  b.set(23, 6, R.metal[0]);
  b.fillRect(1, 5, 3, 5, R.metal[2]);
  b.hline(1, 3, 5, R.metal[4]);
  b.hline(1, 3, 9, R.metal[0]);
  b.selOutline();
  return b;
}

/**
 * A standing candlestick for a chancel.
 *
 * It used to be 33px from foot to flame — the same height as a person, because
 * `FIGURE_H` is 30. Nothing else in the room was measured against the figure,
 * so two of these standing either side of the lectern read as a pair of
 * parishioners made of brass. At 13px it is furniture again: about knee height,
 * which is what a floor candlestick is. Foot, knop, drip pan, candle — four
 * widths, one pixel of change between each, because at this size the *profile*
 * is the entire object.
 */
export function candleStandClip(): Clip {
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 3; f++) {
    const b = new PixelBuffer(11, 15);
    b.groundShadow(5, 13, 4, 1.4, 110);
    // Foot: rim, then the top face one row up — the same trick the stool and
    // the millstone use to say "this disc has thickness".
    b.ellipse(5, 13, 4, 1.5, R.gold[1]);
    b.ellipse(5, 12, 3, 1.2, R.gold[2]);
    b.set(3, 12, R.gold[3]);
    // Stem, lit down the left edge only.
    b.fillRect(4, 8, 2, 4, R.gold[1]);
    b.vline(4, 8, 11, R.gold[3]);
    // Knop, and the drip pan above it.
    b.hline(3, 7, 10, R.gold[2]);
    b.set(3, 10, R.gold[4]);
    b.ellipse(5, 8, 3, 1.2, R.gold[1]);
    b.ellipse(5, 7, 3, 1.1, R.gold[3]);
    // Candle stub: wax running down the shaded side only.
    b.fillRect(4, 3, 3, 4, R.paper[3]);
    b.vline(4, 3, 6, R.paper[4]);
    b.vline(6, 3, 6, R.paper[2]);
    b.set(7, 5, R.paper[2]);
    b.selOutline();
    // Flame after the outline, or it comes back ringed in ink.
    const fh = 2 + (f === 1 ? 1 : 0);
    b.vline(5, 2 - fh, 2, R.fire[4]);
    b.set(5 + (f === 2 ? 1 : 0), 1 - fh, R.fire[3]);
    b.set(5, 2, R.gold[4]);
    b.set(4, 1, R.fire[2]);
    b.set(6, 1, R.fire[2]);
    frames.push(b);
  }
  return clip(bakeSheet(frames, 5, 14), [0, 1, 2, 1], 6);
}

/**
 * A church bench.
 *
 * The old one drew a dark board and a light board lying in the same plane, four
 * pixels apart, and eight of those read as planking stacked on the flagstones.
 * A bench is not two boards — it is three *planes* and a shadow, and the planes
 * have to turn. You look down on the seat, so it takes the lit face; you look
 * straight at the front edge of the seat board and at the back panel, so both
 * of those drop a step; and the flags underneath take a contact shadow, without
 * which the whole thing floats however well it is shaded (rule 11).
 */
export function pew(w: number): PixelBuffer {
  const b = new PixelBuffer(w, 26);
  // The shadow the bench sits in. Tight to the feet: a wide soft pool would
  // read as a stain on the flags.
  b.groundShadow(w / 2, 23.5, w / 2 - 2, 1.7, 130);
  // --- Back panel: a vertical face, so it is a step below the seat ---------
  b.fillRect(3, 1, w - 6, 9, R.wood[1]);
  b.hline(3, w - 4, 0, R.wood[3]); // the capping rail catches the lamps
  b.hline(3, w - 4, 1, R.wood[2]);
  b.hline(3, w - 4, 9, R.wood[0]);
  for (let x = 9; x < w - 8; x += 9) b.vline(x, 2, 8, R.wood[0]); // board seams
  b.vline(3, 0, 9, R.wood[2]);
  b.vline(w - 4, 0, 9, R.wood[0]);
  // Standards carrying the back down through the seat.
  for (const ux of [4, w - 7]) b.fillRect(ux, 9, 3, 3, R.wood[0]);
  // The gap between back and seat — the pew's only negative space, and the
  // reason the eye reads two surfaces meeting rather than one board over
  // another.
  b.hline(0, w - 1, 10, R.night[1]);
  b.hline(0, w - 1, 11, R.night[0]);
  // --- Seat: the horizontal face, so it is the lit one --------------------
  b.fillRect(0, 12, w, 6, R.wood[3]);
  b.hline(0, w - 1, 12, R.wood[4]); // far arris
  b.hline(0, w - 1, 17, R.wood[2]);
  // The turn to vertical. This 3px band *is* the thickness of the seat board.
  b.fillRect(0, 18, w, 3, R.wood[1]);
  b.hline(0, w - 1, 20, R.wood[0]);
  // --- Legs, held apart so the floor shows between them -------------------
  for (const ex of [1, w - 5]) {
    b.fillRect(ex, 21, 4, 3, R.wood[1]);
    b.vline(ex, 21, 23, R.wood[2]);
    b.hline(ex, ex + 3, 23, R.wood[0]);
  }
  // Stretcher between them, a step back in value so it sits behind the legs.
  b.hline(6, w - 7, 21, R.wood[1]);
  b.hline(6, w - 7, 22, R.wood[0]);
  b.selOutline();
  return b;
}

/** The reading desk a chapel is arranged around. */
export function lectern(): PixelBuffer {
  const b = new PixelBuffer(24, 30);
  b.groundShadow(12, 28, 9, 2.2, 110);
  // A stepped foot, not a saucer: one wide plinth with a narrower block on it.
  // The first version put a splayed disc under a bulging knop and the whole
  // stem read as an hourglass.
  b.fillRect(3, 25, 18, 3, R.wood[1]);
  b.hline(3, 20, 25, R.wood[2]);
  b.hline(3, 20, 27, R.wood[0]);
  b.fillRect(6, 22, 12, 3, R.wood[2]);
  b.hline(6, 17, 22, R.wood[3]);
  // Shaft: a plain square column, lit down one edge only.
  b.fillRect(9, 13, 6, 10, R.wood[1]);
  b.vline(9, 13, 22, R.wood[2]);
  b.vline(14, 13, 22, R.wood[0]);
  b.fillRect(7, 17, 10, 2, R.wood[2]);
  b.hline(7, 16, 17, R.wood[3]);
  // Desk: a wedge, deep at the front lip and thin at the back, so the book on
  // it is visibly tilted towards the reader.
  for (let i = 0; i < 7; i++) b.hline(2 + i, 21 - i, 6 + i, R.wood[2]);
  b.hline(2, 21, 6, R.wood[3]);
  b.fillRect(2, 11, 20, 2, R.wood[1]);
  b.hline(2, 21, 12, R.wood[0]);
  // The open book on it, spine down the middle.
  b.fillRect(4, 5, 8, 6, R.paper[3]);
  b.fillRect(12, 5, 8, 6, R.paper[4]);
  b.vline(11, 5, 10, R.paper[1]);
  b.hline(4, 19, 4, R.paper[4]);
  for (let y = 7; y < 11; y += 2) {
    b.hline(5, 10, y, R.night[2]);
    b.hline(13, 18, y, R.night[2]);
  }
  b.selOutline();
  return b;
}

/** A prised-open crate with the packing straw and two jars still in it. */
export function openCrate(seed: number): PixelBuffer {
  const rng = new RNG(seed * 71 + 13);
  const b = new PixelBuffer(28, 24);
  b.groundShadow(14, 22, 12, 2.2, 110);
  // The lid, levered off and leaning against the box.
  b.fillRect(0, 9, 7, 12, R.wood[1]);
  b.hline(0, 6, 9, R.wood[3]);
  for (let y = 11; y < 21; y += 3) b.hline(1, 6, y, R.wood[0]);
  // Box.
  b.fillRect(7, 7, 19, 14, R.wood[2]);
  b.hline(7, 25, 6, R.wood[3]);
  b.hline(7, 25, 20, R.wood[0]);
  b.vline(7, 6, 20, R.wood[3]);
  b.vline(25, 6, 20, R.wood[1]);
  b.fillRect(9, 11, 15, 2, R.wood[1]);
  b.line(9, 19, 24, 9, R.wood[1]);
  // Packing straw proud of the rim, then what came out of it.
  b.hline(9, 23, 5, R.sand[3]);
  for (let i = 0; i < 7; i++) b.set(9 + rng.int(0, 14), 4 + rng.int(0, 2), R.sand[2]);
  for (const [jx, ramp] of [
    [11, R.teal],
    [18, R.gold],
  ] as [number, Ramp][]) {
    b.fillRect(jx, 0, 4, 6, ramp[2]);
    b.vline(jx, 0, 5, ramp[3]);
    b.vline(jx + 3, 0, 5, ramp[1]);
    b.hline(jx, jx + 3, 0, ramp[1]);
    b.set(jx + 1, 2, ramp[4]);
  }
  b.selOutline();
  return b;
}

/** Three tied sacks heaped up, with meal spilt at their foot. */
export function sackStack(seed: number): PixelBuffer {
  const rng = new RNG(seed * 83 + 19);
  const b = new PixelBuffer(28, 28);
  b.groundShadow(14, 26, 12, 2.4, 120);
  const sack = (cx: number, cy: number, rw: number, hh: number): void => {
    b.ellipse(cx, cy - hh / 2, rw, hh / 2, R.sand[1]);
    b.ellipse(cx - 1, cy - hh / 2 - 1, rw - 1, hh / 2 - 1, R.sand[2]);
    b.ellipse(cx - 2, cy - hh / 2 - 2, Math.max(1, rw - 3), Math.max(1, hh / 2 - 3), R.sand[3]);
    // The gathered, corded neck. Without it a sack is a boulder.
    b.fillRect(cx - 1, cy - hh, 3, 3, R.sand[2]);
    b.hline(cx - 2, cx + 2, cy - hh + 1, R.wood[1]);
    b.set(cx - 1, cy - hh, R.sand[3]);
  };
  sack(8, 26, 6, 13);
  sack(20, 25, 6, 12);
  sack(14, 15, 6, 11);
  b.selOutline();
  for (let i = 0; i < 4; i++) {
    const x = 4 + i * 5 + rng.int(0, 2);
    b.hline(x, x + 1, 26 + (i % 2), R.paper[3]);
  }
  return b;
}

/** Loose straw on a barn floor: clustered 2-4px strokes, flat, no shadow. */
export function strawScatter(seed: number): PixelBuffer {
  const rng = new RNG(seed * 97 + 23);
  const b = new PixelBuffer(28, 15);
  for (let c = 0; c < 3; c++) {
    const cx = 5 + c * 8 + rng.int(0, 3);
    const cy = 5 + rng.int(0, 5);
    for (let i = 0; i < 5; i++) {
      const x = cx + rng.int(-3, 3);
      const y = cy + rng.int(-3, 3);
      const len = rng.int(2, 4);
      b.line(x, y, x + len, y + (rng.chance(0.3) ? 1 : 0), R.sand[rng.chance(0.5) ? 3 : 4]);
    }
  }
  return b;
}

/** A bedside table with a candle on it. */
export function nightstand(): PixelBuffer {
  const b = new PixelBuffer(15, 19);
  b.groundShadow(7, 17, 6, 1.8, 100);
  b.fillRect(2, 15, 2, 3, R.wood[0]);
  b.fillRect(10, 15, 2, 3, R.wood[0]);
  b.fillRect(1, 7, 12, 9, R.wood[1]);
  b.fillRect(1, 6, 12, 2, R.wood[3]);
  b.hline(1, 12, 5, R.wood[4]);
  b.hline(1, 12, 15, R.wood[0]);
  b.fillRect(3, 10, 8, 4, R.wood[2]);
  b.hline(3, 10, 10, R.wood[3]);
  b.set(7, 12, R.gold[3]);
  // Candle in a dish.
  b.ellipse(7, 5, 3, 1.2, R.metal[2]);
  b.fillRect(6, 1, 2, 4, R.paper[3]);
  b.vline(6, 1, 4, R.paper[4]);
  b.selOutline();
  b.set(6, 0, R.gold[4]);
  b.set(7, 0, R.fire[3]);
  return b;
}

export interface InteriorAssets {
  counterShop: Sheet;
  counterBar: Sheet;
  shelves: Sheet[];
  fireplace: Clip;
  anvil: Clip;
  wallLamp: Clip;
  stool: Sheet;
  keg: Sheet;
  paintings: Sheet[];
  plant: Sheet;
  sacks: Sheet;
  rugs: Sheet[];
  mat: Sheet;
  innerDoor: Sheet;
  stairs: Sheet;
  /** Mill fittings. */
  millstone: Clip;
  flourChute: Sheet;
  /** Barn fittings. */
  hayBales: Sheet[];
  trough: Sheet;
  /** Wall furniture: what tells you whose room you are standing in. */
  panRack: Sheet;
  herbs: Sheet[];
  bottleShelf: Sheet;
  ledgerBoard: Sheet;
  horseshoes: Sheet;
  toolRack: Sheet;
  keyBoard: Sheet;
  dryGoods: Sheet;
  stainedGlass: Sheet;
  harness: Sheet;
  sillWindow: Sheet;
  sconce: Clip;
  /** Small clutter: bowls, mugs, books. Bottom-centre anchored. */
  bowl: Sheet;
  plates: Sheet;
  mug: Sheet;
  candle: Sheet;
  book: Sheet;
  sewing: Sheet;
  bread: Sheet;
  ledger: Sheet;
  /** Floor-standing extras. */
  scales: Sheet;
  logPile: Sheet;
  woodBasket: Sheet;
  quenchTub: Clip;
  coalPile: Sheet;
  ironStock: Sheet;
  candleStand: Clip;
  pew: Sheet;
  lectern: Sheet;
  openCrate: Sheet;
  sackStack: Sheet;
  straw: Sheet[];
  nightstand: Sheet;
}

export function bakeInteriors(): InteriorAssets {
  return {
    counterShop: still(counter(70, R.leaf), 35, 21),
    counterBar: still(counter(96, R.red), 48, 21),
    shelves: [still(shelfUnit(46, 2), 23, 33), still(shelfUnit(34, 8), 17, 33)],
    fireplace: fireplaceClip(),
    anvil: anvilClip(),
    wallLamp: wallLampClip(),
    stool: still(stool(), 6, 13),
    keg: still(barrelKeg(), 10, 17),
    paintings: [still(painting(1), 11, 17), still(painting(4), 11, 17)],
    plant: still(potPlant(), 8, 21),
    sacks: still(sacks(3), 12, 17),
    rugs: [
      still(roomRug(60, 40, R.red, 3), 30, 20),
      still(roomRug(48, 34, R.purple, 11), 24, 17),
      still(roomRug(56, 36, R.gold, 19), 28, 18),
      still(roomRug(30, 20, R.teal, 27), 15, 10),
    ],
    mat: still(doorMat(), 14, 11),
    innerDoor: still(innerDoor(), 12, 29),
    stairs: still(stairsUp(), 14, 29),
    millstone: millstoneClip(),
    flourChute: still(flourChute(), 11, 29),
    hayBales: [still(hayBale(5), 11, 15), still(hayBale(12), 11, 15)],
    trough: still(waterTrough(), 13, 15),
    panRack: still(panRack(), 14, 21),
    herbs: [still(herbBundle(2), 7, 20), still(herbBundle(9), 7, 20)],
    bottleShelf: still(bottleShelf(44, 4), 22, 23),
    ledgerBoard: still(ledgerBoard(), 12, 20),
    horseshoes: still(horseshoes(), 12, 16),
    toolRack: still(toolRack(), 15, 23),
    keyBoard: still(keyBoard(), 13, 20),
    dryGoods: still(dryGoods(6), 15, 19),
    stainedGlass: still(stainedGlass(), 14, 35),
    harness: still(harness(), 10, 26),
    sillWindow: still(sillWindow(), 18, 23),
    sconce: sconceClip(),
    bowl: still(clutter(BOWL_ART), 4, 5),
    plates: still(clutter(PLATES_ART), 4, 5),
    mug: still(clutter(MUG_ART), 3, 6),
    candle: still(clutter(CANDLE_ART, CANDLE_MAP), 2, 7),
    book: still(clutter(BOOK_ART), 5, 5),
    sewing: still(clutter(SEWING_ART), 4, 7),
    bread: still(clutter(BREAD_ART, BREAD_MAP), 4, 5),
    ledger: still(clutter(LEDGER_ART), 4, 5),
    scales: still(scales(), 9, 16),
    logPile: still(logPile(3), 15, 20),
    woodBasket: still(woodBasket(), 9, 20),
    quenchTub: quenchTubClip(),
    coalPile: still(coalPile(7), 12, 14),
    ironStock: still(ironStock(), 13, 12),
    candleStand: candleStandClip(),
    pew: still(pew(42), 21, 24),
    lectern: still(lectern(), 12, 29),
    openCrate: still(openCrate(11), 14, 23),
    sackStack: still(sackStack(13), 14, 27),
    straw: [still(strawScatter(1), 14, 7), still(strawScatter(4), 14, 7), still(strawScatter(8), 14, 7)],
    nightstand: still(nightstand(), 7, 18),
  };
}

void P;

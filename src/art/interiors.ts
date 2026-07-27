/**
 * Interior fittings.
 *
 * Rooms are drawn in the same 3/4 projection as the outdoors: you look down at
 * the floor and straight at the back wall. So a room needs three things the
 * outdoor set never had — a wall surface with a skirting and a top edge, floor
 * materials that tile seamlessly, and furniture that reads *against a wall*
 * rather than standing free on grass.
 */
import { PixelBuffer, rgba, shade, type RGBA } from './pixel';
import { P, R, type Ramp } from './palette';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';
import { RNG, hash2 } from '../engine/rng';

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export type FloorKind = 'plank' | 'tile' | 'stone' | 'straw';

/** Paint a floor directly into a room bitmap. Tiles seamlessly by construction. */
export function paintFloor(b: PixelBuffer, x0: number, y0: number, w: number, h: number, kind: FloorKind): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      const y = y0 + j;
      let c: RGBA;
      if (kind === 'plank') {
        // Floorboards: long strips with a seam and a lit top edge. The first
        // version also drew staggered end joints every 41px, which turned the
        // floor into a brick lattice — a floor seen from above is boards, and
        // boards are long.
        // Long boards, seam + lit edge, and *no vertical joints at all*. The
        // joints were what turned the floor into brickwork; a floor seen from
        // above is boards running the length of the room.
        const board = Math.floor(j / 10);
        const within = j % 10;
        let step = 3;
        if (within === 0) step = 2; // seam
        else if (within === 1) step = 4; // lit edge of the board
        else if (within === 9) step = 2;
        if (hash2(i, board) > 0.985) step = Math.max(2, step - 1); // knot
        c = R.wood[step];
      } else if (kind === 'tile') {
        const tx = Math.floor(i / 12);
        const ty = Math.floor(j / 12);
        const lx = i % 12;
        const ly = j % 12;
        const alt = (tx + ty) % 2 === 0;
        let step = alt ? 3 : 2;
        if (lx === 0 || ly === 0) step = 1;
        else if (lx === 1 || ly === 1) step += 1;
        else if (lx === 11 || ly === 11) step -= 1;
        c = R.stone[Math.max(0, Math.min(4, step))];
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
      if (fromBottom < 4) {
        // Skirting board.
        c = fromBottom === 3 ? R.wood[3] : fromBottom === 0 ? R.wood[0] : R.wood[1];
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

export function stool(): PixelBuffer {
  const b = new PixelBuffer(12, 14);
  b.groundShadow(6, 12, 5, 1.6, 100);
  b.fillRect(2, 9, 2, 4, R.wood[1]);
  b.fillRect(8, 9, 2, 4, R.wood[1]);
  b.ellipse(6, 8, 5, 2.4, R.wood[2]);
  b.ellipse(6, 7, 5, 2.4, R.wood[3]);
  b.ellipse(6, 6.5, 3, 1.4, R.wood[4]);
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

/** A rug that sits under furniture; flat, no shadow. */
export function roomRug(w: number, h: number, ramp: Ramp): PixelBuffer {
  const b = new PixelBuffer(w, h);
  b.fillRect(0, 0, w, h, ramp[1]);
  b.fillRect(1, 1, w - 2, h - 2, ramp[2]);
  b.fillRect(4, 3, w - 8, h - 6, ramp[1]);
  b.fillRect(6, 4, w - 12, h - 8, ramp[3]);
  b.fillRect(Math.round(w / 2) - 3, Math.round(h / 2) - 2, 6, 4, ramp[1]);
  for (let x = 1; x < w - 1; x += 3) {
    b.set(x, 0, ramp[0]);
    b.set(x, h - 1, ramp[0]);
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

export function stairsUp(): PixelBuffer {
  const b = new PixelBuffer(28, 26);
  for (let i = 0; i < 6; i++) {
    const y = 22 - i * 4;
    b.fillRect(2 + i, y, 24 - i * 2, 4, R.wood[2]);
    b.hline(2 + i, 25 - i, y, R.wood[3]);
    b.hline(2 + i, 25 - i, y + 3, R.wood[0]);
  }
  b.fillRect(0, 0, 28, 4, R.night[0]);
  b.selOutline();
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
    rugs: [still(roomRug(60, 40, R.red), 30, 20), still(roomRug(48, 34, R.purple), 24, 17)],
    mat: still(doorMat(), 14, 11),
    innerDoor: still(innerDoor(), 12, 29),
    stairs: still(stairsUp(), 14, 25),
  };
}

void P;

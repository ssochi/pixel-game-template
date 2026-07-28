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
    b.ellipse(cx, 15, 15, 7, R.stone[0]);
    b.ellipse(cx, 13, 15, 7, R.stone[2]);
    b.ellipse(cx - 1, 12.5, 13, 6, R.stone[3]);
    // Runner stone: smaller and higher, so the pair reads as two stones.
    b.ellipse(cx, 10, 11, 5.5, R.stone[1]);
    b.ellipse(cx, 8, 11, 5.5, R.stone[3]);
    b.ellipse(cx - 1, 7.5, 9.5, 4.5, R.stone[4]);
    // Dressing furrows, straight grooves radiating from the eye. Squashed on
    // the vertical axis by the same amount as the disc.
    const rot = f * (Math.PI / 6);
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a) * 0.5;
      b.line(cx + ca * 3, 8 + sa * 3, cx + ca * 9, 8 + sa * 9, R.stone[1]);
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
    // Meal spilt round the base.
    for (let i = 0; i < 7; i++) b.set(7 + i * 3, 26 + ((i + f) % 2), R.paper[f ? 3 : 4]);
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
    stairs: still(stairsUp(), 14, 29),
    millstone: millstoneClip(),
    flourChute: still(flourChute(), 11, 29),
    hayBales: [still(hayBale(5), 11, 15), still(hayBale(12), 11, 15)],
    trough: still(waterTrough(), 13, 15),
  };
}

void P;

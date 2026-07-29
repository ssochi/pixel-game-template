/**
 * Enterable rooms.
 *
 * Each building on the map owns a Room, built lazily the first time the player
 * walks into its doorway. A Room is a miniature version of the outdoor scene —
 * a baked floor/wall bitmap, y-sorted props, solids, lights and its own NPCs —
 * so the renderer draws it with exactly the same pipeline. The only differences
 * are that a room has fixed ambient light instead of a day/night cycle, and
 * that the camera centres a room smaller than the viewport instead of clamping.
 *
 * Because of that centring, the baked bitmap is deliberately *bigger* than the
 * playable room: every room is surrounded by its own wall seen in cross-section
 * and by the dark outside that wall (`paintSurround`). Without it the viewport
 * filled the leftover space with flat black and the room read as a card
 * floating in a void rather than as the inside of a building. The playable
 * rectangle is unchanged — the surround is scenery the player can never reach.
 */
import type { Assets } from '../art/assets';
import {
  aisleBand,
  floorPatches,
  floorStain,
  glassSpill,
  paintFloor,
  paintWall,
  wearPath,
  type FloorKind,
  type WallKind,
} from '../art/interiors';
import { P, R, type Ramp } from '../art/palette';
import { bayer, PixelBuffer } from '../art/pixel';
import { clip, type Clip, type Sheet } from '../art/sheet';
import { hash2, RNG } from '../engine/rng';
import { GAME_H, GAME_W } from '../engine/screen';
import type { Light } from './lighting';
import type { Deco, Solid } from './scene';

export type RoomKind = 'cottage' | 'shop' | 'tavern' | 'inn' | 'smithy' | 'chapel' | 'mill' | 'barn';

export interface RoomNpc {
  x: number;
  y: number;
  skin: number;
  /** Stands behind a counter and turns about. */
  role: string;
  /**
   * Id in `CAST` when this is a named villager at their own workplace. Without
   * it the figure behind the counter is an anonymous extra, so friendship,
   * gifts and the shop menu all silently do nothing.
   */
  cast?: string;
}

export interface Room {
  kind: RoomKind;
  w: number;
  h: number;
  ground: HTMLCanvasElement;
  decos: Deco[];
  solids: Solid[];
  lights: Light[];
  npcs: RoomNpc[];
  /** Where the player appears on entering, and the exit trigger. */
  spawnX: number;
  spawnY: number;
  exit: { x: number; y: number; w: number; h: number };
  /** Walls: the player is confined to this rectangle. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  ambient: [number, number, number];
  /** Where the player can sleep, if this room has a bed. */
  bed?: { x: number; y: number };
}

interface RoomSpec {
  w: number;
  h: number;
  floor: FloorKind;
  wall: WallKind;
  ambient: [number, number, number];
}

const SPEC: Record<RoomKind, RoomSpec> = {
  cottage: { w: 208, h: 156, floor: 'plank', wall: 'plaster', ambient: [150, 132, 120] },
  shop: { w: 248, h: 172, floor: 'plank', wall: 'plaster', ambient: [160, 146, 128] },
  tavern: { w: 296, h: 196, floor: 'plank', wall: 'log', ambient: [138, 116, 100] },
  inn: { w: 272, h: 188, floor: 'plank', wall: 'plaster', ambient: [148, 130, 116] },
  smithy: { w: 224, h: 164, floor: 'stone', wall: 'brick', ambient: [112, 96, 92] },
  chapel: { w: 216, h: 208, floor: 'tile', wall: 'stone', ambient: [140, 140, 158] },
  mill: { w: 232, h: 168, floor: 'stone', wall: 'stone', ambient: [128, 124, 118] },
  barn: { w: 256, h: 176, floor: 'straw', wall: 'log', ambient: [132, 122, 104] },
};

/** Wall band height at the top of the room. */
const WALL_H = 44;

/**
 * The surround: how thick the wall is where it is cut through, how deep its
 * outer face sits in shadow, and the least amount of outside drawn beyond it.
 *
 * `MIN_MARGIN` only bites on the one axis of the one room (the chapel's height)
 * that is nearly as large as the viewport already; everywhere else the margin
 * grows until the baked bitmap covers the screen, so there is no frame in which
 * the renderer's clear colour is visible at all.
 */
const WALL_T = 3;
const EAVE_T = 2;
const MIN_MARGIN = 24;

/** What the wall is made of where it is cut through, per `WallKind`. */
const WALL_MAT: Record<WallKind, Ramp> = {
  plaster: R.stone,
  stone: R.stone,
  brick: R.red,
  log: R.wood,
};

/** Margin on one side of an axis: enough to cover the viewport where possible. */
function margin(size: number, view: number): number {
  return Math.max(MIN_MARGIN, Math.ceil((view - size) / 2));
}

/**
 * Shift a finished room's every coordinate by the same amount.
 *
 * `furnish` places props in room-local pixels — `room.w - 34`, `wallY + 42` —
 * and there are a couple of hundred of them. Rather than teach each one about
 * the surround, the room is built and dressed at its own origin and then moved
 * bodily into the padded bitmap. Everything the game reads afterwards is listed
 * here; miss one and a lamp lights the wrong wall or the player spawns in the
 * masonry.
 */
function offsetRoom(room: Room, dx: number, dy: number): void {
  for (const d of room.decos) {
    d.x += dx;
    d.y += dy;
    d.sortY += dy;
  }
  for (const s of room.solids) {
    s.x += dx;
    s.y += dy;
  }
  for (const l of room.lights) {
    l.x += dx;
    l.y += dy;
  }
  for (const n of room.npcs) {
    n.x += dx;
    n.y += dy;
  }
  room.spawnX += dx;
  room.spawnY += dy;
  room.exit.x += dx;
  room.exit.y += dy;
  room.bounds.x0 += dx;
  room.bounds.x1 += dx;
  room.bounds.y0 += dy;
  room.bounds.y1 += dy;
  if (room.bed) {
    room.bed.x += dx;
    room.bed.y += dy;
  }
}

export class RoomBuilder {
  private cache = new Map<string, Room>();

  constructor(private a: Assets) {}

  get(kind: RoomKind, seed: number): Room {
    const key = `${kind}:${seed}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const room = this.build(kind, seed);
    this.cache.set(key, room);
    return room;
  }

  private build(kind: RoomKind, seed: number): Room {
    const spec = SPEC[kind];
    const rng = new RNG(seed * 7919 + 13);
    const buf = new PixelBuffer(spec.w, spec.h);
    const dw = 24;
    const dx = Math.round(spec.w / 2 - dw / 2);

    // Floor first, then the floor's own history, then the wall band over the
    // top of both.
    paintFloor(buf, 0, 0, spec.w, spec.h, spec.floor);
    this.dressFloor(buf, kind, spec, seed);
    paintWall(buf, 0, 0, spec.w, WALL_H, spec.wall);
    // Side walls, seen edge-on as narrow dark strips.
    for (const sx of [0, spec.w - 6]) {
      buf.fillRect(sx, WALL_H, 6, spec.h - WALL_H, R.night[1]);
      buf.fillRect(sx === 0 ? 5 : spec.w - 6, WALL_H, 1, spec.h - WALL_H, R.night[2]);
    }
    // Bottom wall: a thin lip so the room reads as enclosed — with the doorway
    // you came in through cut into it. The first version instead stood a whole
    // door sprite in the middle of the floor, always drawn on top; the player
    // spawned half-hidden behind it and the thing read as furniture, not exit.
    buf.fillRect(0, spec.h - 5, spec.w, 5, R.night[1]);
    buf.hline(0, spec.w - 1, spec.h - 5, R.night[2]);
    // The opening: floor runs out through the gap.
    buf.fillRect(dx, spec.h - 5, dw, 5, R.wood[1]);
    buf.hline(dx, dx + dw - 1, spec.h - 5, R.wood[2]);
    // Door jambs on either side of the gap.
    for (const jx of [dx - 2, dx + dw]) {
      buf.fillRect(jx, spec.h - 6, 2, 6, R.wood[2]);
      buf.fillRect(jx, spec.h - 6, 2, 1, R.wood[3]);
    }
    // The wall's contact shadow on the floor. A hard first line then a short
    // falloff — this is what makes the floor read as receding away from the
    // wall rather than as more wall.
    buf.fillRect(6, WALL_H, spec.w - 12, 1, [10, 10, 20, 190]);
    for (let y = WALL_H + 1; y < WALL_H + 10; y++) {
      const a = 120 * (1 - (y - WALL_H) / 10);
      buf.fillRect(6, y, spec.w - 12, 1, [10, 10, 20, a]);
    }

    // The building from outside, and the room dropped into the middle of it.
    // Built before the Room so the bitmap is only flattened to a canvas once;
    // the room is dressed at its own origin and moved into place at the end.
    const padX = margin(spec.w, GAME_W);
    const padY = margin(spec.h, GAME_H);
    const outer = new PixelBuffer(spec.w + padX * 2, spec.h + padY * 2);
    this.paintSurround(outer, spec, padX, padY, dx, dw, rng);
    outer.blit(buf, padX, padY);

    const room: Room = {
      kind,
      w: spec.w,
      h: spec.h,
      ground: outer.toCanvas(),
      decos: [],
      solids: [],
      lights: [],
      npcs: [],
      spawnX: spec.w / 2,
      spawnY: spec.h - 22,
      exit: { x: spec.w / 2 - 16, y: spec.h - 18, w: 32, h: 14 },
      bounds: { x0: 12, y0: WALL_H + 6, x1: spec.w - 12, y1: spec.h - 8 },
      ambient: spec.ambient,
    };

    this.furnish(room, kind, rng);

    // The mat just inside the doorway. The doorway itself is part of the
    // bottom wall, baked into the ground bitmap above.
    this.add(room, this.a.interiors.mat, room.w / 2, room.h - 8, { layer: 'ground' });

    // Everything above was authored in room-local pixels. Move it all into the
    // padded bitmap in one go — including `bounds`, which is what keeps the
    // player off the wall and out of the dark beyond it.
    offsetRoom(room, padX, padY);
    room.w = outer.w;
    room.h = outer.h;

    room.decos.sort((p, q) => p.sortY - q.sortY);
    return room;
  }

  /**
   * The wall in cross-section, and the outside beyond it.
   *
   * A room smaller than the viewport gets centred, and the renderer fills what
   * is left over with flat black — so every interior read as a lit card hung in
   * a void. The fix is not a bigger room (the room's size is what all the
   * furniture is placed against) but a bigger *bitmap*: cut the wall through
   * and show its thickness from above, drop its outer face into shadow, and let
   * the rest fall away into the darkest neutral on the palette instead of into
   * nothing. Four bands, outward from the floor:
   *
   *   1. `WALL_T` px of masonry/timber top surface, lit on the inside edge
   *      where the room's own lamps reach it, coursed so it reads as built.
   *   2. `EAVE_T` px of the same material at the bottom of its ramp: the
   *      outside face of the wall, which nothing indoors lights.
   *   3. A dithered falloff from `night[1]` to `night[0]` — near the building
   *      is fractionally less dark than far from it.
   *   4. The far field, with very sparse rubble clusters so a third of the
   *      screen is not one dead flat colour.
   *
   * The doorway is cut clean through all of it, so the way out still reads as
   * a way out and not as a scuff on the skirting.
   */
  private paintSurround(
    b: PixelBuffer,
    spec: RoomSpec,
    padX: number,
    padY: number,
    doorX: number,
    doorW: number,
    rng: RNG,
  ): void {
    const mat = WALL_MAT[spec.wall];
    const x0 = padX;
    const y0 = padY;
    const x1 = padX + spec.w - 1;
    const y1 = padY + spec.h - 1;
    const shell = WALL_T + EAVE_T;
    /** Chebyshev distance outside the room rectangle; <= 0 means inside it. */
    const out = (x: number, y: number): number => Math.max(x0 - x, x - x1, y0 - y, y - y1);

    b.fill(R.night[0]);

    // Band 3: one step up close to the building, dithered out over 20px. The
    // wall has to sit against *something* or its outer face is invisible.
    const reach = 20;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const d = out(x, y);
        if (d <= shell) continue;
        const t = 1 - (d - shell) / reach;
        if (t > 0 && t > bayer(x, y)) b.set(x, y, R.night[1]);
      }
    }

    // Band 4: rubble. Clusters of two or three, never single pixels — a spray
    // of lone dots reads as dirt on the screen rather than as ground.
    const clusters = Math.round((b.w * b.h) / 3400);
    for (let i = 0; i < clusters; i++) {
      const px = rng.int(2, b.w - 3);
      const py = rng.int(2, b.h - 3);
      if (out(px, py) < shell + reach * 0.5) continue;
      const core = rng.chance(0.25) ? R.night[2] : R.night[1];
      b.set(px, py, core);
      b.set(px + rng.int(-1, 1), py + 1, R.night[1]);
      if (rng.chance(0.5)) b.set(px + rng.int(0, 1), py - 1, R.night[1]);
    }

    // Bands 1 and 2: the wall itself.
    for (let y = y0 - shell; y <= y1 + shell; y++) {
      for (let x = x0 - shell; x <= x1 + shell; x++) {
        const d = out(x, y);
        if (d <= 0 || d > shell) continue;
        if (d > WALL_T) {
          b.set(x, y, mat[0]);
          continue;
        }
        // Coursing runs along the wall, so the run direction depends on which
        // side of the building this is; corners take the horizontal courses.
        const along = y < y0 || y > y1 ? x : y;
        // Joints stagger between the inner and outer courses.
        const joint = (along + (d > 1 ? 6 : 0)) % 11 === 0;
        let c = joint ? mat[0] : d === 1 ? mat[2] : mat[1];
        if (!joint && hash2(along >> 1, d) > 0.86) c = d === 1 ? mat[3] : mat[2];
        b.set(x, y, c);
      }
    }

    // The threshold, cut through the bottom wall under the doorway and running
    // a few pixels out into the dark so the exit doesn't stop at a hard line.
    const dx0 = x0 + doorX;
    for (let x = dx0; x < dx0 + doorW; x++) {
      for (let d = 1; d <= shell; d++) b.set(x, y1 + d, d <= WALL_T ? R.wood[1] : R.wood[0]);
      for (let d = shell + 1; d <= shell + 6; d++) {
        const t = 1 - (d - shell) / 7;
        if (t > bayer(x, y1 + d)) b.set(x, y1 + d, R.wood[0]);
      }
    }
  }

  // -------------------------------------------------------------------------

  private add(
    room: Room,
    c: Clip | Sheet,
    x: number,
    y: number,
    opts: { layer?: Deco['layer']; solid?: number; flip?: boolean; sortY?: number; phase?: number } = {},
  ): void {
    const cl: Clip = 'sheet' in c ? (c as Clip) : clip(c as Sheet, [0], 1);
    room.decos.push({
      clip: cl,
      x: Math.round(x),
      y: Math.round(y),
      phase: opts.phase ?? Math.random() * 4,
      flip: opts.flip ?? false,
      layer: opts.layer ?? 'sorted',
      sortY: opts.sortY ?? y,
      solid: opts.solid ?? 0,
      label: '',
    });
    if (opts.solid) room.solids.push({ x: Math.round(x), y: Math.round(y) - 2, r: opts.solid });
  }

  /**
   * Everything that happens to the floor before a single prop stands on it.
   *
   * "The rooms feel empty" is almost never a furniture problem. It is the
   * floor: one flat, unbroken, factory-fresh plane covering two thirds of the
   * screen, and no amount of props standing on top of it fixes that. Patch
   * boards, the track worn between the door and the counter, soot in front of
   * the hearth, flour under the meal spout — one ramp step each, and the room
   * has been lived in before anybody walks into it.
   *
   * All of this runs *before* `paintWall`, so it can never leak up onto the
   * back wall, and it stops short of the bottom lip for the same reason.
   */
  private dressFloor(buf: PixelBuffer, kind: RoomKind, spec: RoomSpec, seed: number): void {
    const y0 = WALL_H + 2;
    const fh = spec.h - 7 - y0;
    const cx = Math.round(spec.w / 2);
    const door: [number, number] = [cx, spec.h - 16];
    floorPatches(buf, 8, y0, spec.w - 16, fh, spec.floor, seed * 3 + kind.length);
    switch (kind) {
      case 'tavern':
        wearPath(buf, [door, [cx + 34, spec.h - 66], [spec.w - 80, WALL_H + 66]], 8);
        floorStain(buf, 48, WALL_H + 24, 26, 12);
        break;
      case 'shop':
        wearPath(buf, [door, [cx + 22, spec.h - 58], [cx + 40, WALL_H + 62]], 7);
        break;
      case 'inn':
        wearPath(buf, [door, [cx - 40, spec.h - 62], [76, WALL_H + 62]], 7);
        floorStain(buf, cx + 30, WALL_H + 24, 24, 11);
        break;
      case 'smithy':
        wearPath(buf, [door, [cx + 6, WALL_H + 72], [66, WALL_H + 40]], 8);
        floorStain(buf, 52, WALL_H + 24, 30, 14);
        floorStain(buf, 88, WALL_H + 66, 14, 8);
        break;
      case 'chapel':
        // The nave. Four centuries of feet down one line is the whole reason a
        // church floor doesn't read as a warehouse floor.
        aisleBand(buf, cx, WALL_H + 30, spec.h - 8, 15);
        // The pool of light the window throws goes where a rug used to be. A
        // purple hearth-rug under a pulpit was the chapel's most domestic
        // object; a lozenge of coloured light is the same shape doing the
        // opposite job.
        glassSpill(buf, cx, WALL_H + 40, 27, 13);
        break;
      case 'mill':
        wearPath(buf, [door, [cx - 16, WALL_H + 82], [96, WALL_H + 66]], 7);
        floorStain(buf, 126, WALL_H + 76, 22, 11, 1);
        floorStain(buf, 86, WALL_H + 70, 18, 9, 1);
        break;
      case 'barn':
        // Straw is already busy; a wear track in it would just be mud. The
        // trodden-flat patches from `floorPatches` are enough.
        break;
      default:
        wearPath(buf, [door, [cx - 18, spec.h - 60], [cx - 24, spec.h - 74]], 7);
        floorStain(buf, cx - 46, WALL_H + 24, 22, 11);
        break;
    }
  }

  private lamp(room: Room, x: number, y: number, radius = 60, colour: [number, number, number] = [255, 208, 150]): void {
    this.add(room, this.a.interiors.wallLamp, x, y, { sortY: 0 });
    room.lights.push({
      x,
      y: y - 8,
      radius,
      color: [colour[0], colour[1], colour[2], 255],
      intensity: 0.9,
      flicker: 0.12,
      seed: x * 0.37,
    });
  }

  /** A candle sconce: a small, warm, fast-flickering pool between the lamps. */
  private sconce(room: Room, x: number, y: number): void {
    this.add(room, this.a.interiors.sconce, x, y, { sortY: 0 });
    room.lights.push({
      x,
      y: y - 10,
      radius: 38,
      color: [255, 196, 128, 255],
      intensity: 0.72,
      flicker: 0.24,
      seed: x * 0.61 + 4,
    });
  }

  private furnish(room: Room, kind: RoomKind, rng: RNG): void {
    const I = this.a.interiors;
    const p = this.a.props;
    const cx = room.w / 2;
    const wallY = WALL_H;

    // Lamps in the two back corners. They used to sit at x=34, which put them
    // squarely behind the first shelf unit in half the rooms — the light was
    // there but the fitting was never visible. The wall between them is now
    // reserved for the trade-specific gear that gives a room its name.
    this.lamp(room, 22, wallY - 6);
    this.lamp(room, room.w - 22, wallY - 6);

    switch (kind) {
      case 'tavern': {
        // A bar along the back-right, stools in front, kegs behind.
        this.add(room, I.counterBar, room.w - 74, wallY + 42, { solid: 22 });
        for (let i = 0; i < 4; i++) this.add(room, I.stool, room.w - 118 + i * 24, wallY + 58, { solid: 5 });
        this.add(room, I.keg, room.w - 40, wallY + 16, { solid: 8 });
        this.add(room, I.keg, room.w - 62, wallY + 14, { solid: 8 });
        // Bottles behind the bar rather than a general-goods shelf: what is on
        // the wall behind a counter is the fastest way to name the trade.
        this.add(room, I.bottleShelf, room.w - 74, wallY - 4, { sortY: 0 });
        // Served drinks left on the bar top. The counter's top surface is five
        // rows above its anchor, so anything standing on it goes at -14.
        this.add(room, I.mug, room.w - 106, wallY + 28, { sortY: wallY + 43 });
        this.add(room, I.mug, room.w - 98, wallY + 30, { sortY: wallY + 43 });
        this.add(room, I.plates, room.w - 46, wallY + 29, { sortY: wallY + 43 });
        // The kitchen end of the wall: pans, drying herbs, and a candle.
        this.add(room, I.panRack, 150, wallY - 6, { sortY: 0 });
        this.add(room, I.herbs[0], 78, wallY - 8, { sortY: 0 });
        this.add(room, I.herbs[1], 92, wallY - 4, { sortY: 0 });
        this.sconce(room, 182, wallY - 10);
        // Hearth on the left of the back wall, with its firewood beside it.
        this.add(room, I.fireplace, 48, wallY + 2, { sortY: 0 });
        room.lights.push({ x: 48, y: wallY - 12, radius: 108, color: P.fire, intensity: 1.25, flicker: 0.3, seed: 3 });
        this.add(room, I.logPile, 88, wallY + 26, { solid: 9 });
        // Tables with chairs, on a rug, each laid with something.
        this.add(room, I.rugs[0], 96, room.h - 56, { layer: 'ground' });
        // Both tables are held clear of the strip of floor directly above the
        // doorway. One of them used to sit 20px in front of the mat, so the
        // very first thing the player did on entering was walk into it.
        for (const [tx, ty] of [
          [78, room.h - 68],
          [200, room.h - 44],
        ] as [number, number][]) {
          this.add(room, p.table, tx, ty, { solid: 13 });
          this.add(room, p.chairL, tx - 26, ty + 2, { solid: 5 });
          this.add(room, p.chairR, tx + 26, ty + 2, { solid: 5, flip: true });
        }
        this.add(room, I.bowl, 72, room.h - 80, { sortY: room.h - 67 });
        this.add(room, I.bread, 86, room.h - 80, { sortY: room.h - 67 });
        this.add(room, I.mug, 192, room.h - 56, { sortY: room.h - 43 });
        this.add(room, I.plates, 208, room.h - 56, { sortY: room.h - 43 });
        // The quiet corner opposite: a keg somebody rolled out and never put
        // back, and a stool pulled up to it.
        this.add(room, I.keg, 40, room.h - 44, { solid: 8 });
        this.add(room, I.stool, 66, room.h - 32, { solid: 5 });
        this.add(room, I.keg, 262, room.h - 34, { solid: 8 });
        this.add(room, I.paintings[0], 112, wallY - 12, { sortY: 0 });
        room.npcs.push({ x: room.w - 74, y: wallY + 26, skin: 0, role: 'innkeeper', cast: 'orin' });
        room.npcs.push({ x: 106, y: room.h - 70, skin: 7, role: 'drinker' });
        room.npcs.push({ x: 168, y: room.h - 40, skin: 5, role: 'drinker' });
        break;
      }
      case 'shop': {
        this.add(room, I.counterShop, cx + 42, wallY + 44, { solid: 18 });
        // What is on the counter is the shop: a balance and the day book.
        this.add(room, I.scales, cx + 22, wallY + 30, { sortY: wallY + 45 });
        this.add(room, I.ledger, cx + 64, wallY + 30, { sortY: wallY + 45 });
        this.add(room, I.shelves[0], 70, wallY - 4, { sortY: 0 });
        this.add(room, I.shelves[1], 116, wallY - 4, { sortY: 0 });
        this.add(room, I.ledgerBoard, 152, wallY - 6, { sortY: 0 });
        this.add(room, I.dryGoods, 196, wallY - 8, { sortY: 0 });
        // Stock on the floor between the shelves — a shop that keeps all its
        // goods above waist height has nothing to walk around.
        this.add(room, I.sackStack, 46, wallY + 46, { solid: 11 });
        this.add(room, I.openCrate, 98, wallY + 48, { solid: 9 });
        // Off the door-to-counter diagonal. Parked on the centre line it was
        // the first thing the player walked into on the way to the shopkeeper.
        this.add(room, p.barrels[0], 210, wallY + 74, { solid: 8 });
        this.add(room, I.openCrate, 62, room.h - 36, { solid: 9 });
        this.add(room, I.sacks, room.w - 30, wallY + 48, { solid: 10 });
        this.add(room, p.crates[0], room.w - 54, room.h - 42, { solid: 9 });
        this.add(room, I.plant, room.w - 26, room.h - 26, { solid: 6 });
        this.add(room, I.rugs[1], cx - 40, room.h - 48, { layer: 'ground' });
        room.npcs.push({ x: cx + 42, y: wallY + 28, skin: 2, role: 'shopkeeper', cast: 'mara' });
        room.npcs.push({ x: cx - 44, y: room.h - 52, skin: 6, role: 'customer' });
        break;
      }
      case 'inn': {
        this.add(room, I.counterShop, 70, wallY + 42, { solid: 18 });
        // The key board is the one object that says "inn" and not "shop".
        this.add(room, I.keyBoard, 70, wallY - 6, { sortY: 0 });
        this.add(room, I.book, 52, wallY + 30, { sortY: wallY + 45 });
        this.add(room, I.candle, 90, wallY + 29, { sortY: wallY + 45 });
        // Hard against the right-hand wall: a flight of stairs floating in the
        // middle of the back wall reads as a decal, not as a way upstairs.
        this.add(room, I.stairs, room.bounds.x1 - 16, wallY + 34, { solid: 14 });
        this.add(room, I.fireplace, cx + 30, wallY + 2, { sortY: 0 });
        room.lights.push({ x: cx + 30, y: wallY - 12, radius: 100, color: P.fire, intensity: 1.15, flicker: 0.28, seed: 9 });
        this.add(room, I.logPile, cx + 66, wallY + 26, { solid: 9 });
        this.add(room, p.bed, 48, room.h - 34, { solid: 12 });
        this.add(room, p.bed, 104, room.h - 34, { solid: 12 });
        // A candle by each bed. Guests go up in the dark otherwise — and both
        // stands stay left of the doorway lane, since a 5px solid parked
        // directly in front of the mat is the one place nothing may stand.
        this.add(room, I.nightstand, 76, room.h - 38, { solid: 5 });
        this.add(room, I.nightstand, 24, room.h - 38, { solid: 5 });
        room.bed = { x: 48, y: room.h - 34 };
        // Warm underfoot: the red rug read as the tavern's, so the inn gets
        // its own in the gold ramp.
        this.add(room, I.rugs[2], cx + 20, room.h - 46, { layer: 'ground' });
        this.add(room, I.paintings[1], 128, wallY - 12, { sortY: 0 });
        this.sconce(room, 104, wallY - 10);
        this.sconce(room, 196, wallY - 10);
        this.add(room, I.sillWindow, 228, wallY - 4, { sortY: 0 });
        // Somewhere for a guest to sit. The right-hand third of the common
        // room was bare boards from the stairs all the way to the door.
        this.add(room, p.table, 198, room.h - 52, { solid: 13 });
        this.add(room, I.mug, 192, room.h - 64, { sortY: room.h - 51 });
        this.add(room, I.candle, 206, room.h - 64, { sortY: room.h - 51 });
        this.add(room, I.stool, 172, room.h - 48, { solid: 5 });
        this.add(room, I.stool, 224, room.h - 48, { solid: 5 });
        this.add(room, I.plant, room.w - 22, room.h - 30, { solid: 6 });
        // No `cast` here on purpose. ORIN works the tavern (`work: 'tavern'`
        // in CAST) and this figure would put him behind two counters at once;
        // the desk clerk is an anonymous extra instead.
        room.npcs.push({ x: 70, y: wallY + 26, skin: 0, role: 'innkeeper' });
        break;
      }
      case 'smithy': {
        this.add(room, I.fireplace, 52, wallY + 2, { sortY: 0 });
        room.lights.push({ x: 52, y: wallY - 10, radius: 122, color: P.fire, intensity: 1.5, flicker: 0.36, seed: 5 });
        this.add(room, I.anvil, cx + 8, room.h - 52, { solid: 10 });
        // The forge's own kit. The shelf of coloured jars that used to be here
        // belonged in an apothecary: a smith hangs his tools where his hand
        // already is, and keeps coal, water and stock within one pace.
        this.add(room, I.toolRack, 152, wallY - 6, { sortY: 0 });
        this.add(room, I.horseshoes, 96, wallY - 6, { sortY: 0 });
        this.sconce(room, 124, wallY - 10);
        this.add(room, I.coalPile, 46, wallY + 32, { solid: 8 });
        this.add(room, I.quenchTub, 84, wallY + 62, { solid: 8 });
        this.add(room, I.ironStock, 158, room.h - 32, { solid: 8 });
        this.add(room, p.barrels[1], room.w - 34, wallY + 40, { solid: 8 });
        this.add(room, p.crates[1], 40, room.h - 34, { solid: 9 });
        this.add(room, I.sacks, room.w - 44, room.h - 28, { solid: 9 });
        room.npcs.push({ x: cx + 8, y: room.h - 68, skin: 3, role: 'smith', cast: 'brann' });
        break;
      }
      case 'chapel': {
        // The window is the altarpiece. A little framed landscape over the
        // chancel was the reason this room read as somebody's parlour.
        this.add(room, I.stainedGlass, cx, wallY - 6, { sortY: 0 });
        this.add(room, I.lectern, cx, wallY + 44, { solid: 8 });
        this.add(room, I.candleStand, cx - 32, wallY + 48, { solid: 5 });
        this.add(room, I.candleStand, cx + 32, wallY + 48, { solid: 5 });
        room.lights.push({ x: cx - 32, y: wallY + 22, radius: 46, color: [255, 214, 150, 255], intensity: 0.8, flicker: 0.2, seed: 14 });
        room.lights.push({ x: cx + 32, y: wallY + 22, radius: 46, color: [255, 214, 150, 255], intensity: 0.8, flicker: 0.2, seed: 19 });
        // Pews, not trestle tables. A bench without a back is a table, and
        // eight tables in rows is a refectory.
        for (let i = 0; i < 4; i++) {
          const y = wallY + 72 + i * 26;
          this.add(room, I.pew, cx - 46, y, { solid: 12 });
          this.add(room, I.pew, cx + 46, y, { solid: 12 });
        }
        this.add(room, I.book, cx - 34, wallY + 64, { sortY: wallY + 73 });
        this.add(room, I.book, cx + 56, wallY + 116, { sortY: wallY + 125 });
        this.add(room, p.brazier, cx - 62, wallY + 26, { solid: 7 });
        this.add(room, p.brazier, cx + 62, wallY + 26, { solid: 7 });
        room.lights.push({ x: cx - 62, y: wallY + 4, radius: 92, color: P.fire, intensity: 1, flicker: 0.25, seed: 2 });
        room.lights.push({ x: cx + 62, y: wallY + 4, radius: 92, color: P.fire, intensity: 1, flicker: 0.25, seed: 6 });
        this.sconce(room, cx - 46, wallY - 10);
        this.sconce(room, cx + 46, wallY - 10);
        room.npcs.push({ x: cx, y: wallY + 26, skin: 8, role: 'priest' });
        break;
      }
      case 'mill': {
        // The mill had no mill in it: shelves and sacks are dressing, the stone
        // is the machine the building exists for. It goes centre-left, with the
        // meal spout beside it so the grain visibly goes somewhere.
        this.add(room, I.millstone, 86, wallY + 64, { solid: 15 });
        this.add(room, I.flourChute, 126, wallY + 70, { solid: 9 });
        // Sacks: a stacked heap by the door, loose ones round the walls. Was a
        // bookshelf once — a miller stores grain, not novels.
        this.add(room, I.sackStack, 44, wallY + 52, { solid: 11 });
        this.add(room, I.sacks, room.w - 50, room.h - 34, { solid: 10 });
        this.add(room, I.sacks, cx + 60, wallY + 38, { solid: 10 });
        // Everything that leaves this building is weighed on the way out.
        this.add(room, I.scales, 196, wallY + 62, { solid: 6 });
        this.add(room, I.openCrate, 62, room.h - 34, { solid: 9 });
        this.add(room, p.crates[0], 144, wallY + 22, { solid: 9 });
        this.sconce(room, 150, wallY - 10);
        // Spilt grain round the stone, on the ground layer so it sits flat.
        this.add(room, I.straw[0], 108, wallY + 84, { layer: 'ground' });
        this.add(room, I.straw[1], 66, wallY + 76, { layer: 'ground' });
        this.add(room, I.stairs, room.bounds.x1 - 16, wallY + 34, { solid: 14 });
        room.npcs.push({ x: 150, y: room.h - 46, skin: 4, role: 'miller', cast: 'halder' });
        break;
      }
      case 'barn': {
        // A barn with nothing alive in it is a shed. Three animals on the straw,
        // bodies staggered in both axes so they read as separate silhouettes.
        this.add(room, I.stairs, room.bounds.x0 + 16, wallY + 34, { solid: 14 });
        this.add(room, I.hayBales[0], 60, wallY + 26, { solid: 9 });
        this.add(room, I.hayBales[1], 86, wallY + 36, { solid: 9, flip: true });
        this.add(room, I.hayBales[0], 46, wallY + 58, { solid: 9, flip: true });
        for (let i = 0; i < 3; i++) {
          this.add(room, p.fence, 142 + i * 20, wallY + 24, { solid: 6 });
        }
        // Tack on the wall: the one thing that says this is a working barn and
        // not a shed with animals parked in it.
        this.add(room, I.harness, 112, wallY - 6, { sortY: 0 });
        this.add(room, I.harness, 206, wallY - 8, { sortY: 0, flip: true });
        this.add(room, I.sacks, room.w - 38, wallY + 40, { solid: 10 });
        this.add(room, I.sackStack, 66, room.h - 34, { solid: 11 });
        this.add(room, p.crates[1], room.w - 28, room.h - 58, { solid: 9 });
        this.add(room, I.trough, 196, room.h - 40, { solid: 10 });
        // Loose straw where it actually falls. Only two of these, and only
        // where the floor has been trodden dark: scattered over bright straw
        // the decal is invisible, and four of them was three wasted draws.
        this.add(room, I.straw[0], 150, room.h - 26, { layer: 'ground' });
        this.add(room, I.straw[2], 214, wallY + 52, { layer: 'ground' });
        // The milking stool and the feed bowl: the two objects that say the
        // animals in here are worked rather than parked.
        this.add(room, I.stool, 146, wallY + 58, { solid: 5 });
        this.add(room, I.bowl, 108, room.h - 36, { sortY: room.h - 36 });
        // Nothing goes in the bottom-centre strip: that is the lane from the
        // doorway the player spawns in.
        this.add(room, I.hayBales[1], 224, room.h - 26, { solid: 9 });
        const an = this.a.animals;
        this.add(room, an.cow.idle, 124, wallY + 56, { solid: 10 });
        this.add(room, an.sheep.graze, 166, wallY + 84, { solid: 9, flip: true });
        this.add(room, an.chicken.graze, 96, room.h - 38, { solid: 8 });
        break;
      }
      default: {
        // A home: hearth, table, bed, dresser — and the traces of the evening
        // somebody just spent in it.
        this.add(room, I.fireplace, cx - 46, wallY + 2, { sortY: 0 });
        room.lights.push({ x: cx - 46, y: wallY - 12, radius: 96, color: P.fire, intensity: 1.1, flicker: 0.28, seed: 11 });
        this.add(room, I.woodBasket, cx - 14, wallY + 24, { solid: 6 });
        this.add(room, p.bookshelf, cx + 52, wallY + 30, { solid: 12 });
        this.add(room, p.bed, room.w - 34, room.h - 40, { solid: 12 });
        room.bed = { x: room.w - 34, y: room.h - 40 };
        this.add(room, I.rugs[rng.int(0, 1)], cx - 24, room.h - 52, { layer: 'ground' });
        // A bedside mat, because a bed on bare boards reads as a bunk.
        this.add(room, I.rugs[3], room.w - 62, room.h - 30, { layer: 'ground' });
        this.add(room, p.table, cx - 24, room.h - 56, { solid: 13 });
        this.add(room, I.bowl, cx - 32, room.h - 68, { sortY: room.h - 55 });
        this.add(room, I.bread, cx - 16, room.h - 68, { sortY: room.h - 55 });
        this.add(room, I.stool, cx - 50, room.h - 52, { solid: 5 });
        this.add(room, I.stool, cx + 2, room.h - 52, { solid: 5 });
        // Somebody's mending, left on the stool by the fire.
        this.add(room, I.sewing, cx - 50, room.h - 59, { sortY: room.h - 51 });
        this.add(room, I.plant, 26, room.h - 26, { solid: 6 });
        // The household chest, against the left wall: every other object in
        // here is a table or a seat, and the left third had nothing on it.
        this.add(room, p.chestClosed, 38, room.h - 62, { solid: 9 });
        this.add(room, I.sillWindow, cx + 14, wallY - 4, { sortY: 0 });
        this.add(room, I.paintings[rng.int(0, 1)], cx - 16, wallY - 12, { sortY: 0 });
        this.sconce(room, cx + 66, wallY - 10);
        break;
      }
    }
  }
}

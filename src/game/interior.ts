/**
 * Enterable rooms.
 *
 * Each building on the map owns a Room, built lazily the first time the player
 * walks into its doorway. A Room is a miniature version of the outdoor scene —
 * a baked floor/wall bitmap, y-sorted props, solids, lights and its own NPCs —
 * so the renderer draws it with exactly the same pipeline. The only differences
 * are that a room has fixed ambient light instead of a day/night cycle, and
 * that the camera centres a room smaller than the viewport instead of clamping.
 */
import type { Assets } from '../art/assets';
import { paintFloor, paintWall, type FloorKind, type WallKind } from '../art/interiors';
import { P, R } from '../art/palette';
import { PixelBuffer } from '../art/pixel';
import { clip, type Clip, type Sheet } from '../art/sheet';
import { RNG } from '../engine/rng';
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

    // Floor first, then the wall band over the top of it.
    paintFloor(buf, 0, 0, spec.w, spec.h, spec.floor);
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
    const dw = 24;
    const dx = Math.round(spec.w / 2 - dw / 2);
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

    const room: Room = {
      kind,
      w: spec.w,
      h: spec.h,
      ground: buf.toCanvas(),
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

    room.decos.sort((p, q) => p.sortY - q.sortY);
    return room;
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

  private furnish(room: Room, kind: RoomKind, rng: RNG): void {
    const I = this.a.interiors;
    const p = this.a.props;
    const cx = room.w / 2;
    const wallY = WALL_H;

    // Lamps on the back wall, in every room.
    this.lamp(room, 34, wallY - 6);
    this.lamp(room, room.w - 34, wallY - 6);

    switch (kind) {
      case 'tavern': {
        // A bar along the back-right, stools in front, kegs behind.
        this.add(room, I.counterBar, room.w - 74, wallY + 42, { solid: 22 });
        for (let i = 0; i < 4; i++) this.add(room, I.stool, room.w - 118 + i * 24, wallY + 58, { solid: 5 });
        this.add(room, I.keg, room.w - 40, wallY + 16, { solid: 8 });
        this.add(room, I.keg, room.w - 62, wallY + 14, { solid: 8 });
        this.add(room, I.shelves[0], room.w - 74, wallY - 4, { sortY: 0 });
        // Hearth on the left of the back wall.
        this.add(room, I.fireplace, 48, wallY + 2, { sortY: 0 });
        room.lights.push({ x: 48, y: wallY - 12, radius: 108, color: P.fire, intensity: 1.25, flicker: 0.3, seed: 3 });
        // Tables with chairs, on a rug.
        this.add(room, I.rugs[0], 96, room.h - 56, { layer: 'ground' });
        for (const [tx, ty] of [
          [80, room.h - 66],
          [150, room.h - 44],
        ] as [number, number][]) {
          this.add(room, p.table, tx, ty, { solid: 13 });
          this.add(room, p.chairL, tx - 26, ty + 2, { solid: 5 });
          this.add(room, p.chairR, tx + 26, ty + 2, { solid: 5, flip: true });
        }
        this.add(room, I.paintings[0], 112, wallY - 12, { sortY: 0 });
        room.npcs.push({ x: room.w - 74, y: wallY + 26, skin: 0, role: 'innkeeper', cast: 'orin' });
        room.npcs.push({ x: 106, y: room.h - 70, skin: 7, role: 'drinker' });
        room.npcs.push({ x: 168, y: room.h - 40, skin: 5, role: 'drinker' });
        break;
      }
      case 'shop': {
        this.add(room, I.counterShop, cx + 42, wallY + 44, { solid: 18 });
        this.add(room, I.shelves[0], 44, wallY - 4, { sortY: 0 });
        this.add(room, I.shelves[1], 96, wallY - 4, { sortY: 0 });
        this.add(room, I.shelves[0], room.w - 44, wallY - 4, { sortY: 0 });
        this.add(room, I.sacks, 46, wallY + 40, { solid: 10 });
        this.add(room, p.crates[0], 92, wallY + 44, { solid: 9 });
        this.add(room, p.barrels[0], 118, wallY + 48, { solid: 8 });
        this.add(room, I.plant, room.w - 26, room.h - 26, { solid: 6 });
        this.add(room, I.rugs[1], cx - 40, room.h - 48, { layer: 'ground' });
        room.npcs.push({ x: cx + 42, y: wallY + 28, skin: 2, role: 'shopkeeper', cast: 'mara' });
        room.npcs.push({ x: cx - 44, y: room.h - 52, skin: 6, role: 'customer' });
        break;
      }
      case 'inn': {
        this.add(room, I.counterShop, 70, wallY + 42, { solid: 18 });
        // Hard against the right-hand wall: a flight of stairs floating in the
        // middle of the back wall reads as a decal, not as a way upstairs.
        this.add(room, I.stairs, room.bounds.x1 - 16, wallY + 34, { solid: 14 });
        this.add(room, I.fireplace, cx + 30, wallY + 2, { sortY: 0 });
        room.lights.push({ x: cx + 30, y: wallY - 12, radius: 100, color: P.fire, intensity: 1.15, flicker: 0.28, seed: 9 });
        this.add(room, p.bed, 48, room.h - 34, { solid: 12 });
        this.add(room, p.bed, 104, room.h - 34, { solid: 12 });
        room.bed = { x: 48, y: room.h - 34 };
        this.add(room, I.rugs[0], cx + 20, room.h - 46, { layer: 'ground' });
        this.add(room, I.paintings[1], 150, wallY - 12, { sortY: 0 });
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
        this.add(room, p.barrels[1], room.w - 34, wallY + 40, { solid: 8 });
        this.add(room, I.shelves[1], room.w - 60, wallY - 4, { sortY: 0 });
        this.add(room, p.crates[1], 40, room.h - 34, { solid: 9 });
        this.add(room, I.sacks, room.w - 44, room.h - 28, { solid: 9 });
        room.npcs.push({ x: cx + 8, y: room.h - 68, skin: 3, role: 'smith', cast: 'brann' });
        break;
      }
      case 'chapel': {
        this.add(room, I.rugs[1], cx, wallY + 46, { layer: 'ground' });
        for (let i = 0; i < 4; i++) {
          const y = wallY + 72 + i * 26;
          this.add(room, p.table, cx - 46, y, { solid: 12 });
          this.add(room, p.table, cx + 46, y, { solid: 12 });
        }
        this.add(room, p.brazier, cx - 62, wallY + 26, { solid: 7 });
        this.add(room, p.brazier, cx + 62, wallY + 26, { solid: 7 });
        room.lights.push({ x: cx - 62, y: wallY + 4, radius: 92, color: P.fire, intensity: 1, flicker: 0.25, seed: 2 });
        room.lights.push({ x: cx + 62, y: wallY + 4, radius: 92, color: P.fire, intensity: 1, flicker: 0.25, seed: 6 });
        this.add(room, I.paintings[0], cx, wallY - 14, { sortY: 0 });
        room.npcs.push({ x: cx, y: wallY + 40, skin: 8, role: 'priest' });
        break;
      }
      case 'mill': {
        // The mill had no mill in it: shelves and sacks are dressing, the stone
        // is the machine the building exists for. It goes centre-left, with the
        // meal spout beside it so the grain visibly goes somewhere.
        this.add(room, I.millstone, 86, wallY + 64, { solid: 15 });
        this.add(room, I.flourChute, 126, wallY + 70, { solid: 9 });
        this.add(room, I.sacks, 40, wallY + 36, { solid: 10 });
        this.add(room, I.sacks, 64, wallY + 52, { solid: 10 });
        this.add(room, I.sacks, room.w - 50, room.h - 34, { solid: 10 });
        // Was a bookshelf — a miller stores grain, not novels.
        this.add(room, I.sacks, cx + 60, wallY + 38, { solid: 10 });
        this.add(room, p.crates[0], 144, wallY + 22, { solid: 9 });
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
        for (let i = 0; i < 3; i++) {
          this.add(room, p.fence, 142 + i * 20, wallY + 24, { solid: 6 });
        }
        this.add(room, I.sacks, room.w - 38, wallY + 40, { solid: 10 });
        this.add(room, p.crates[1], room.w - 28, room.h - 58, { solid: 9 });
        this.add(room, I.trough, 196, room.h - 40, { solid: 10 });
        const an = this.a.animals;
        this.add(room, an.cow.idle, 124, wallY + 56, { solid: 10 });
        this.add(room, an.sheep.graze, 166, wallY + 84, { solid: 9, flip: true });
        this.add(room, an.chicken.graze, 96, room.h - 38, { solid: 8 });
        break;
      }
      default: {
        // A home: hearth, table, bed, dresser.
        this.add(room, I.fireplace, cx - 46, wallY + 2, { sortY: 0 });
        room.lights.push({ x: cx - 46, y: wallY - 12, radius: 96, color: P.fire, intensity: 1.1, flicker: 0.28, seed: 11 });
        this.add(room, p.bookshelf, cx + 52, wallY + 30, { solid: 12 });
        this.add(room, p.bed, room.w - 34, room.h - 40, { solid: 12 });
        room.bed = { x: room.w - 34, y: room.h - 40 };
        this.add(room, I.rugs[rng.int(0, 1)], cx - 24, room.h - 52, { layer: 'ground' });
        this.add(room, p.table, cx - 24, room.h - 56, { solid: 13 });
        this.add(room, I.stool, cx - 50, room.h - 52, { solid: 5 });
        this.add(room, I.stool, cx + 2, room.h - 52, { solid: 5 });
        this.add(room, I.plant, 26, room.h - 26, { solid: 6 });
        this.add(room, I.paintings[rng.int(0, 1)], cx + 10, wallY - 12, { sortY: 0 });
        break;
      }
    }
  }
}

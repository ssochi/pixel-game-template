/**
 * Riverside town.
 *
 * Buildings line the streets defined in `terrain.ts`, the market square sits on
 * the main crossroads, the mill straddles the river with its wheel in the
 * current, and the farms and paddock occupy the outskirts. Everything that
 * emits light (windows, lamps, forge, hearths) registers a light here so the
 * lighting pass has the whole town to work with at dusk.
 */
import type { Assets } from '../art/assets';
import type { Building } from '../art/buildings';
import type { Clip, Sheet } from '../art/sheet';
import { clip } from '../art/sheet';
import { P, R } from '../art/palette';
import { bakeSheet } from '../art/sheet';
import { RNG } from '../engine/rng';
import type { Light } from './lighting';
import type { Area, ScheduleSlot } from './npc';
import { FARM } from './farm';
import {
  BRIDGE,
  FIELDS,
  MILL,
  PADDOCK,
  PLAZA,
  WORLD_H,
  WORLD_W,
  isWater,
  riverCenter,
  riverHalf,
} from './terrain';
import type { WaterObstacle } from './water';

export type Layer = 'ground' | 'sorted' | 'canopy';

export interface Deco {
  clip: Clip;
  x: number;
  y: number;
  phase: number;
  flip: boolean;
  layer: Layer;
  sortY: number;
  /** Collision radius in px; 0 means walk-through. */
  solid: number;
  label: string;
  /** Skipped by every draw pass. Foraged plants set this until they regrow. */
  hidden?: boolean;
}

export interface Solid {
  x: number;
  y: number;
  r: number;
}

/** A doorway the player can walk into. */
export interface Door {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  seed: number;
  label: string;
}

export interface SmokeSource {
  x: number;
  y: number;
  rate: number;
}

/** Where villagers and animals are allowed to roam. */
export interface Spawn {
  kind: string;
  x: number;
  y: number;
  home: Area;
  stationary?: boolean;
  schedule?: ScheduleSlot[];
}

export class Scene {
  readonly decos: Deco[] = [];
  readonly lights: Light[] = [];
  readonly solids: Solid[] = [];
  readonly waterObstacles: WaterObstacle[] = [];
  readonly smoke: SmokeSource[] = [];
  readonly doors: Door[] = [];
  readonly villagerSpawns: Spawn[] = [];
  readonly animalSpawns: Spawn[] = [];
  readonly duckSpawns: Spawn[] = [];
  chest!: Deco;
  /** The shipping bin on the player's plot: `E` on it sells the day's produce. */
  bin!: Deco;
  /** The notice board on the square, where quests are taken and handed in. */
  board!: Deco;
  /** Doorsteps of the houses, used as villagers' homes. */
  readonly homes: Area[] = [];
  /** Named work areas, so the cast in `social.ts` can be posted to them. */
  readonly areas: Record<string, Area> = {};
  /** Wild pickings: mushrooms, flowers and fallen wood you can gather. */
  readonly forage: { deco: Deco; item: string; gone: number }[] = [];
  private lightSeed = 0;
  private doorSeed = 1;
  private rng = new RNG(20260727);

  constructor(private a: Assets) {
    this.build();
    this.decos.sort((p, q) => p.sortY - q.sortY);
  }

  private still(sheet: Sheet): Clip {
    return clip(sheet, [0], 1);
  }

  private add(
    c: Clip | Sheet,
    x: number,
    y: number,
    opts: Partial<Pick<Deco, 'layer' | 'solid' | 'flip' | 'sortY' | 'label'>> & { phase?: number } = {},
  ): Deco {
    const cl: Clip = 'sheet' in c ? (c as Clip) : this.still(c as Sheet);
    const d: Deco = {
      clip: cl,
      x: Math.round(x),
      y: Math.round(y),
      phase: opts.phase ?? this.rng.range(0, 4),
      flip: opts.flip ?? false,
      layer: opts.layer ?? 'sorted',
      sortY: opts.sortY ?? y,
      solid: opts.solid ?? 0,
      label: opts.label ?? '',
    };
    this.decos.push(d);
    if (d.solid > 0) this.solids.push({ x: d.x, y: d.y - 2, r: d.solid });
    return d;
  }

  private light(l: Omit<Light, 'seed'> & { seed?: number }): void {
    this.lights.push({ seed: l.seed ?? this.lightSeed++ * 13.7, ...l });
  }

  // -------------------------------------------------------------------------

  /**
   * Place a building: sprite, a wall of collision circles across its footprint,
   * a warm light behind each window and smoke from the chimney.
   */
  private placeBuilding(
    bld: Building,
    x: number,
    y: number,
    label: string,
    sign?: Sheet,
    interior?: string,
  ): void {
    const sheet = bakeSheet([bld.buffer], bld.ax, bld.ay);
    this.add(sheet, x, y, { label, sortY: y });
    // Collision: a row of circles along the wall base, so the player slides
    // along the frontage instead of catching on one big circle.
    const n = Math.max(2, Math.round(bld.solidW / 7));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const sx = x - bld.solidW + t * bld.solidW * 2;
      // Leave a gap in the wall where the door is, or the trigger is
      // unreachable and the building can never be entered.
      if (interior && Math.abs(sx - x) < 12) continue;
      this.solids.push({ x: sx, y: y - 8, r: 9 });
    }
    // One light per window, kept deliberately weak: a building has three or
    // four of them and they stack, so anything stronger blows the facade out
    // to white at night.
    for (const w of bld.windows) {
      this.light({
        x: x + w.x,
        y: y + w.y,
        radius: 38,
        color: [255, 196, 120, 255],
        intensity: 0.32,
        flicker: 0.07,
        bloom: false,
      });
    }
    if (bld.chimney) this.smoke.push({ x: x + bld.chimney.x, y: y + bld.chimney.y, rate: 5 });
    if (sign) this.add(sign, x + bld.solidW - 4, y - 20, { sortY: y + 1, label: `${label} sign` });
    // The patch of street just outside the door: where residents go to sleep.
    this.homes.push({ x0: x - 12, y0: y + 6, x1: x + 12, y1: y + 16 });
    if (interior) {
      // The doorway itself: a narrow trigger sitting on the threshold. The
      // collision circles above leave this gap, so you can only reach it by
      // walking straight at the door.
      this.doors.push({ x: x - 7, y: y - 6, w: 14, h: 10, kind: interior, seed: this.doorSeed++, label });
    }
  }

  /**
   * A day: out to work at dawn, into the square and the tavern in the evening,
   * home at night. Keyed to the same day fraction the lighting uses, so the
   * town empties as it gets dark.
   */
  private dayFor(work: Area, activity: 'work' | 'wander'): ScheduleSlot[] {
    const home = this.homes.length
      ? this.homes[this.rng.int(0, this.homes.length - 1)]
      : { x0: 540, y0: 500, x1: 590, y1: 520 };
    const square: Area = { x0: PLAZA.x0 + 20, y0: PLAZA.y0 + 20, x1: PLAZA.x1 - 20, y1: PLAZA.y1 - 20 };
    return [
      { from: 0, area: home, activity: 'sleep' },
      { from: 0.26 + this.rng.range(0, 0.04), area: work, activity },
      { from: 0.72 + this.rng.range(0, 0.05), area: square, activity: 'socialise' },
      // Staggered, so the whole town doesn't turn in on the same tick.
      { from: 0.84 + this.rng.range(0, 0.06), area: home, activity: 'sleep' },
    ];
  }

  private build(): void {
    this.buildStreets();
    this.buildMarket();
    this.buildMill();
    this.buildFarms();
    this.buildFarmPlot();
    this.buildRiver();
    this.buildWilds();
  }

  // --- the town ------------------------------------------------------------

  private buildStreets(): void {
    const b = this.a.buildings;
    const MAIN = 565;

    // High street, west side: inn and tavern face the square.
    this.placeBuilding(b.inn, MAIN - 118, 448, 'inn', b.signs.inn, 'inn');
    this.placeBuilding(b.tavern, MAIN + 130, 452, 'tavern', b.signs.tavern, 'tavern');
    this.placeBuilding(b.shop, MAIN - 122, 600, 'general store', b.signs.shop, 'shop');
    this.placeBuilding(b.smithy, MAIN + 128, 604, 'smithy', b.signs.smith, 'smithy');

    this.areas.forge = { x0: MAIN + 108, y0: 614, x1: MAIN + 152, y1: 632 };
    this.areas.shop = { x0: MAIN - 142, y0: 610, x1: MAIN - 98, y1: 628 };
    this.areas.tavern = { x0: MAIN + 108, y0: 462, x1: MAIN + 156, y1: 480 };

    // Forge fire spilling out of the smithy door.
    this.light({ x: MAIN + 128, y: 596, radius: 92, color: P.fire, intensity: 1.15, flicker: 0.35 });
    this.smoke.push({ x: MAIN + 150, y: 566, rate: 9 });

    // Cottages up and down the main street.
    const rows: [number, number, number][] = [
      [MAIN - 116, 300, 0],
      [MAIN - 120, 210, 1],
      [MAIN + 122, 300, 2],
      [MAIN + 118, 208, 3],
      [MAIN - 118, 720, 1],
      [MAIN + 124, 716, 0],
      [MAIN - 122, 820, 3],
      [MAIN + 120, 824, 2],
    ];
    for (const [x, y, kind] of rows) {
      this.placeBuilding(b.cottages[kind], x, y, 'cottage', undefined, 'cottage');
    }

    // Chapel on its own lane to the north-east.
    this.placeBuilding(b.chapel, 860, 214, 'chapel', undefined, 'chapel');

    // Street lamps down the main street and along the high street.
    for (const [x, y] of [
      [MAIN - 26, 360],
      [MAIN + 26, 560],
      [MAIN - 26, 660],
      [MAIN + 26, 250],
      [760, 486],
      [400, 486],
      [960, 490],
    ] as [number, number][]) {
      this.add(b.lamppost, x, y, { solid: 4, label: 'lamppost' });
      this.light({ x, y: y - 34, radius: 78, color: [255, 208, 140, 255], intensity: 1, flicker: 0.12 });
    }

    // A cart and barrels outside the tavern, crates outside the store.
    this.add(b.cart, MAIN + 76, 470, { solid: 12, label: 'cart' });
    this.add(this.a.props.barrels[0], MAIN + 96, 486, { solid: 8, label: 'barrel' });
    this.add(this.a.props.barrels[1], MAIN + 106, 494, { solid: 8, label: 'barrel' });
    this.add(this.a.props.crates[0], MAIN - 84, 614, { solid: 8, label: 'crate' });
    this.add(this.a.props.crates[1], MAIN - 74, 622, { solid: 8, label: 'crate' });
    this.add(this.a.props.sign, MAIN - 40, 520, { solid: 4, label: 'signpost' });
  }

  private buildMarket(): void {
    const b = this.a.buildings;
    const p = this.a.props;
    const cx = (PLAZA.x0 + PLAZA.x1) / 2;
    const cy = (PLAZA.y0 + PLAZA.y1) / 2;

    // Well at the centre of the square — the classic town focal point.
    this.add(p.well, cx, cy + 6, { solid: 14, label: 'town well' });

    // Stalls around it, each with a stallholder.
    const stalls: [number, number, number][] = [
      [cx - 84, cy - 46, 0],
      [cx + 80, cy - 42, 1],
      [cx - 78, cy + 62, 2],
      [cx + 84, cy + 58, 0],
    ];
    stalls.forEach(([x, y, kind], i) => {
      this.add(b.stalls[kind], x, y, { solid: 12, label: 'market stall' });
      this.light({ x, y: y - 20, radius: 44, color: [255, 220, 170, 255], intensity: 0.5 });
      this.villagerSpawns.push({
        kind: 'merchant',
        x: x + (i % 2 ? 14 : -14),
        y: y + 10,
        home: { x0: x - 16, y0: y + 6, x1: x + 16, y1: y + 14 },
        stationary: true,
      });
    });

    // The quest board: the town's notice board, on the square.
    this.board = this.add(p.sign, cx - 6, cy - 88, { solid: 5, label: 'notice board' });

    // A brazier for warmth and a couple of crates of goods.
    this.add(p.brazier, cx - 40, cy + 78, { solid: 7, label: 'brazier' });
    this.light({ x: cx - 40, y: cy + 54, radius: 100, color: P.fire, intensity: 1.05, flicker: 0.28 });
    this.add(p.crates[1], cx + 44, cy + 80, { solid: 8, label: 'crate' });
    this.add(b.cart, cx + 6, cy - 74, { solid: 12, label: 'cart' });

    // Banners on poles at the square's corners.
    for (const [x, y] of [
      [PLAZA.x0 + 12, PLAZA.y0 + 10],
      [PLAZA.x1 - 12, PLAZA.y0 + 10],
    ] as [number, number][]) {
      this.add(p.pillar, x, y, { solid: 8, label: 'pillar' });
      this.add(p.banner, x, y - 34, { sortY: y - 1, label: 'banner' });
    }

    // Townsfolk milling about the square.
    const square: Area = { x0: PLAZA.x0 + 20, y0: PLAZA.y0 + 20, x1: PLAZA.x1 - 20, y1: PLAZA.y1 - 20 };
    this.areas.square = square;
    for (let i = 0; i < 7; i++) {
      this.villagerSpawns.push({
        kind: 'townsfolk',
        x: this.rng.range(PLAZA.x0 + 30, PLAZA.x1 - 30),
        y: this.rng.range(PLAZA.y0 + 30, PLAZA.y1 - 30),
        home: square,
        schedule: this.dayFor(square, 'wander'),
      });
    }
    // …and a few walking the streets.
    const street: Area = { x0: 545, y0: 180, x1: 590, y1: 880 };
    this.areas.street = street;
    for (let i = 0; i < 5; i++) {
      this.villagerSpawns.push({
        kind: 'walker',
        x: 565 + this.rng.range(-12, 12),
        y: this.rng.range(200, 860),
        home: street,
        schedule: this.dayFor(street, 'wander'),
      });
    }
    const high: Area = { x0: 330, y0: 492, x1: 980, y1: 518 };
    for (let i = 0; i < 3; i++) {
      this.villagerSpawns.push({
        kind: 'walker',
        x: this.rng.range(340, 960),
        y: 504 + this.rng.range(-10, 10),
        home: high,
        schedule: this.dayFor(high, 'wander'),
      });
    }
  }

  private buildMill(): void {
    const b = this.a.buildings;
    const mx = MILL.x;
    const my = MILL.y;
    this.placeBuilding(b.mill, mx, my, 'watermill', undefined, 'mill');

    // The wheel hangs off the river side of the mill, its bottom in the water.
    const wheelX = mx + 44;
    this.add(b.waterWheel, wheelX, my - 6, { sortY: my + 2, label: 'water wheel' });
    this.waterObstacles.push({ x: wheelX + 6, y: my - 20, r: 10 });
    // Constant spray where the paddles enter the current.
    this.smoke.push({ x: wheelX + 4, y: my - 12, rate: 0 });

    // A sluice of stacked planks leading the water to the wheel, plus sacks.
    this.add(this.a.props.crates[0], mx - 34, my + 12, { solid: 8, label: 'grain sack' });
    this.add(this.a.props.crates[1], mx - 22, my + 18, { solid: 8, label: 'grain sack' });
    this.add(b.cart, mx - 56, my - 6, { solid: 12, label: 'cart' });
    const millYard: Area = { x0: mx - 60, y0: my + 10, x1: mx + 20, y1: my + 40 };
    this.areas.mill = millYard;
    this.villagerSpawns.push({
      kind: 'miller',
      x: mx - 20,
      y: my + 24,
      home: millYard,
      schedule: this.dayFor(millYard, 'work'),
    });
  }

  private buildFarms(): void {
    const b = this.a.buildings;
    const p = this.a.props;

    // Barn beside the paddock.
    this.placeBuilding(b.barn, 380, 800, 'barn', undefined, 'barn');

    // Crops, laid in rows that follow each field's furrows.
    for (const f of FIELDS) {
      if (f.crop === 'fallow') continue;
      const set = f.crop === 'wheat' ? b.wheat : b.cabbage;
      const stepX = f.vertical ? 14 : 16;
      const stepY = f.vertical ? 16 : 14;
      for (let y = f.y0 + 10; y < f.y1 - 6; y += stepY) {
        for (let x = f.x0 + 10; x < f.x1 - 6; x += stepX) {
          if (isWater(x, y)) continue;
          this.add(set[this.rng.int(0, set.length - 1)], x, y, {
            layer: 'sorted',
            label: f.crop,
            phase: this.rng.range(0, 4),
          });
        }
      }
      // Scarecrow and haystacks on the headland.
      this.add(b.scarecrow, (f.x0 + f.x1) / 2, f.y0 + 6, { solid: 5, label: 'scarecrow' });
    }
    this.add(b.haystacks[0], 330, 300, { solid: 12, label: 'haystack' });
    this.add(b.haystacks[1], 150, 470, { solid: 12, label: 'haystack' });
    this.add(b.haystacks[0], 300, 776, { solid: 12, label: 'haystack', flip: true });

    // Paddock fence, with a gap for a gate on the north side.
    const step = 16;
    for (let x = PADDOCK.x0; x <= PADDOCK.x1; x += step) {
      if (Math.abs(x - (PADDOCK.x0 + PADDOCK.x1) / 2) < 20) continue;
      this.add(p.fence, x, PADDOCK.y0, { solid: 6, label: 'fence' });
      this.add(p.fence, x, PADDOCK.y1, { solid: 6, label: 'fence' });
    }
    for (let y = PADDOCK.y0; y <= PADDOCK.y1; y += step) {
      this.add(p.fence, PADDOCK.x0, y, { solid: 6, label: 'fence' });
      this.add(p.fence, PADDOCK.x1, y, { solid: 6, label: 'fence' });
    }

    // Livestock in the paddock, poultry loose around the farmyard.
    const pad: Area = { x0: PADDOCK.x0 + 20, y0: PADDOCK.y0 + 20, x1: PADDOCK.x1 - 20, y1: PADDOCK.y1 - 20 };
    for (let i = 0; i < 3; i++)
      this.animalSpawns.push({ kind: 'cow', x: this.rng.range(pad.x0, pad.x1), y: this.rng.range(pad.y0, pad.y1), home: pad });
    for (let i = 0; i < 4; i++)
      this.animalSpawns.push({ kind: 'sheep', x: this.rng.range(pad.x0, pad.x1), y: this.rng.range(pad.y0, pad.y1), home: pad });
    for (let i = 0; i < 2; i++)
      this.animalSpawns.push({ kind: 'goat', x: this.rng.range(pad.x0, pad.x1), y: this.rng.range(pad.y0, pad.y1), home: pad });

    const yard: Area = { x0: 330, y0: 760, x1: 470, y1: 850 };
    for (let i = 0; i < 3; i++)
      this.animalSpawns.push({ kind: 'pig', x: this.rng.range(yard.x0, yard.x1), y: this.rng.range(yard.y0, yard.y1), home: yard });
    for (let i = 0; i < 6; i++)
      this.animalSpawns.push({ kind: 'chicken', x: this.rng.range(yard.x0, yard.x1), y: this.rng.range(yard.y0, yard.y1), home: yard });

    // Farmers working the fields.
    for (const f of FIELDS.slice(0, 3)) {
      const plot: Area = { x0: f.x0 + 12, y0: f.y0 + 12, x1: f.x1 - 12, y1: f.y1 - 12 };
      if (!this.areas.field) this.areas.field = plot;
      this.villagerSpawns.push({
        kind: 'farmer',
        x: (f.x0 + f.x1) / 2,
        y: (f.y0 + f.y1) / 2,
        home: plot,
        schedule: this.dayFor(plot, 'work'),
      });
    }
    // A herder living with the animals.
    const padArea: Area = { x0: PADDOCK.x0 + 24, y0: PADDOCK.y0 + 24, x1: PADDOCK.x1 - 24, y1: PADDOCK.y1 - 24 };
    this.areas.paddock = padArea;
    this.villagerSpawns.push({
      kind: 'herder',
      x: (PADDOCK.x0 + PADDOCK.x1) / 2,
      y: PADDOCK.y0 + 40,
      home: padArea,
      schedule: this.dayFor(padArea, 'work'),
    });
  }

  /** The player's own plot: fenced, with a shipping bin and a scarecrow. */
  private buildFarmPlot(): void {
    const p = this.a.props;
    const step = 16;
    for (let x = FARM.x0 - 8; x <= FARM.x1 + 8; x += step) {
      // Gap on the west side, facing the town, so you can walk in.
      if (Math.abs(x - (FARM.x0 - 8)) < 1) continue;
      this.add(p.fence, x, FARM.y0 - 8, { solid: 6, label: 'fence' });
      this.add(p.fence, x, FARM.y1 + 8, { solid: 6, label: 'fence' });
    }
    for (let y = FARM.y0 - 8; y <= FARM.y1 + 8; y += step) {
      if (Math.abs(y - (FARM.y0 + 56)) < 10) continue; // gateway
      this.add(p.fence, FARM.x0 - 8, y, { solid: 6, label: 'fence' });
      this.add(p.fence, FARM.x1 + 8, y, { solid: 6, label: 'fence' });
    }
    this.bin = this.add(p.chestClosed, FARM.x0 - 20, FARM.y0 + 40, { solid: 8, label: 'shipping bin' });
    this.add(this.a.buildings.scarecrow, FARM.x1 - 24, FARM.y0 + 8, { solid: 5, label: 'scarecrow' });
    this.add(p.sign, FARM.x0 - 22, FARM.y0 + 70, { solid: 4, label: 'plot sign' });
  }

  private buildRiver(): void {
    const n = this.a.nature;
    const p = this.a.props;
    const rng = new RNG(2024);

    // Bridge deck and rails.
    for (let y = BRIDGE.y0; y < BRIDGE.y1; y += 16) {
      for (let x = BRIDGE.x0; x < BRIDGE.x1; x += 16) {
        this.add(p.bridgeTiles[rng.int(0, p.bridgeTiles.length - 1)], x + 8, y + 16, {
          layer: 'ground',
          label: 'bridge deck',
        });
      }
    }
    for (let x = BRIDGE.x0; x < BRIDGE.x1; x += 16) {
      this.add(p.bridgeRail, x + 8, BRIDGE.y0 + 3, { sortY: BRIDGE.y0 - 6, label: 'bridge rail' });
      this.add(p.bridgeRail, x + 8, BRIDGE.y1 + 6, { sortY: BRIDGE.y1 + 6, label: 'bridge rail' });
    }
    for (const x of [BRIDGE.x0 + 4, BRIDGE.x1 - 4]) {
      this.add(p.torch, x, BRIDGE.y1 + 8, { sortY: BRIDGE.y1 + 7, label: 'torch' });
      this.light({ x, y: BRIDGE.y1 - 16, radius: 86, color: P.fire, intensity: 1, flicker: 0.3 });
    }

    // Reeds and lilies along the banks.
    for (let y = 30; y < WORLD_H - 30; y += 9) {
      const c = riverCenter(y);
      const h = riverHalf(y);
      for (const side of [-1, 1] as const) {
        if (!rng.chance(0.5)) continue;
        const x = c + side * (h + rng.range(2, 10));
        if (Math.abs(y - BRIDGE.cy) < 32) continue;
        if (Math.abs(y - MILL.y) < 40 && side < 0) continue;
        this.add(n.reeds[rng.int(0, 1)], x, y, { flip: side > 0, label: 'reed', phase: rng.range(0, 4) });
      }
      if (rng.chance(0.14) && Math.abs(y - BRIDGE.cy) > 36) {
        this.add(n.lily, c + rng.range(-h * 0.6, h * 0.6), y, {
          layer: 'ground',
          label: 'lily pad',
          phase: rng.range(0, 4),
        });
      }
    }

    // Rocks standing in the current.
    for (const y of [140, 260, 360, 640, 700, 880]) {
      const c = riverCenter(y);
      const h = riverHalf(y);
      const x = c + rng.range(-h * 0.5, h * 0.5);
      const idx = rng.int(0, 2);
      this.add(n.rocks[idx], x, y, { solid: 8, label: 'river rock' });
      this.waterObstacles.push({ x, y: y - 4, r: idx === 2 ? 12 : 8 });
    }

    // Ducks on the water, upstream of the bridge.
    for (let i = 0; i < 5; i++) {
      const y = this.rng.range(120, 420);
      this.duckSpawns.push({
        kind: 'duck',
        x: riverCenter(y) + this.rng.range(-20, 20),
        y,
        home: { x0: 0, y0: 110, x1: 0, y1: 440 },
      });
    }

    // A fisherman on the east bank.
    const bank: Area = {
      x0: riverCenter(600) + riverHalf(600) + 10,
      y0: 580,
      x1: riverCenter(600) + riverHalf(600) + 30,
      y1: 640,
    };
    this.areas.river = bank;
    this.villagerSpawns.push({
      kind: 'fisher',
      x: bank.x0 + 6,
      y: 600,
      home: bank,
      schedule: this.dayFor(bank, 'work'),
    });
  }

  private buildWilds(): void {
    const n = this.a.nature;
    const rng = new RNG(90210);

    const free = (x: number, y: number, margin: number): boolean => {
      if (x < 24 || y < 24 || x > WORLD_W - 24 || y > WORLD_H - 24) return false;
      if (x > PLAZA.x0 - 24 && x < PLAZA.x1 + 24 && y > PLAZA.y0 - 24 && y < PLAZA.y1 + 24) return false;
      if (y > BRIDGE.y0 - 34 && y < BRIDGE.y1 + 34 && x > BRIDGE.x0 - 24 && x < BRIDGE.x1 + 24) return false;
      for (const f of FIELDS) if (x > f.x0 - 10 && x < f.x1 + 10 && y > f.y0 - 10 && y < f.y1 + 10) return false;
      if (x > FARM.x0 - 26 && x < FARM.x1 + 26 && y > FARM.y0 - 26 && y < FARM.y1 + 26) return false;
      if (x > PADDOCK.x0 - 12 && x < PADDOCK.x1 + 12 && y > PADDOCK.y0 - 12 && y < PADDOCK.y1 + 12) return false;
      // Keep the streets clear.
      if (Math.abs(x - 565) < 46 && y > 120 && y < 900) return false;
      if (Math.abs(y - 504) < 44 && x > 280 && x < 1010) return false;
      for (let dy = -margin; dy <= margin; dy += margin) {
        for (let dx = -margin; dx <= margin; dx += margin) {
          if (isWater(x + dx, y + dy)) return false;
        }
      }
      for (const s of this.solids) if (Math.hypot(s.x - x, s.y - y) < s.r + margin) return false;
      return true;
    };

    const place = (count: number, margin: number, fn: (x: number, y: number) => void): void => {
      let tries = 0;
      let made = 0;
      while (made < count && tries < count * 70) {
        tries++;
        const x = rng.range(20, WORLD_W - 20);
        const y = rng.range(20, WORLD_H - 20);
        if (!free(x, y, margin)) continue;
        fn(x, y);
        made++;
      }
    };

    place(44, 20, (x, y) => {
      const roll = rng.next();
      const c = roll < 0.6 ? n.trees[rng.int(0, 1)] : roll < 0.85 ? n.pine : n.deadTree;
      this.add(c, x, y, { solid: 7, flip: rng.chance(0.5), label: 'tree', phase: rng.range(0, 4) });
    });
    place(26, 14, (x, y) =>
      this.add(n.bushes[rng.int(0, 1)], x, y, { solid: 7, flip: rng.chance(0.5), label: 'bush', phase: rng.range(0, 4) }),
    );
    place(20, 12, (x, y) => {
      const i = rng.int(0, n.rocks.length - 1);
      this.add(n.rocks[i], x, y, { solid: i === 2 ? 12 : 7, flip: rng.chance(0.5), label: 'rock' });
    });
    place(240, 4, (x, y) =>
      this.add(n.grass[rng.int(0, 2)], x, y, {
        layer: 'ground',
        flip: rng.chance(0.5),
        label: 'grass',
        phase: rng.range(0, 4),
      }),
    );
    place(52, 5, (x, y) => {
      const d = this.add(n.flowers[rng.int(0, 2)], x, y, { flip: rng.chance(0.5), label: 'flower', phase: rng.range(0, 4) });
      this.forage.push({ deco: d, item: 'flower', gone: -1 });
    });
    place(14, 6, (x, y) => {
      const d = this.add(n.mushrooms[0], x, y, { label: 'mushroom' });
      this.forage.push({ deco: d, item: 'mushroom', gone: -1 });
    });
    place(5, 12, (x, y) => this.add(n.log, x, y, { solid: 10, flip: rng.chance(0.5), label: 'log' }));
    place(6, 10, (x, y) => this.add(n.stump, x, y, { solid: 8, label: 'stump' }));

    // A crystal outcrop and glowing mushrooms in the woods across the river.
    const gx = 1330;
    const gy = 300;
    this.add(n.crystal, gx, gy, { solid: 8, label: 'crystal' });
    this.light({ x: gx, y: gy - 14, radius: 96, color: P.magic, intensity: 1, pulse: 0.45, pulseSpeed: 1.6 });
    for (const [x, y] of [
      [gx - 24, gy + 18],
      [gx + 22, gy + 14],
      [gx + 12, gy + 32],
    ] as [number, number][]) {
      this.add(n.mushrooms[1], x, y, { label: 'glowing mushroom' });
      this.light({ x, y: y - 6, radius: 34, color: P.magic, intensity: 0.55, pulse: 0.5, pulseSpeed: 2.4 });
    }

    // A campfire camp on the far bank, and the chest.
    this.add(this.a.props.campfire, 1290, 640, { solid: 9, label: 'campfire' });
    this.light({ x: 1290, y: 630, radius: 122, color: P.fire, intensity: 1.2, flicker: 0.26 });
    this.smoke.push({ x: 1290, y: 622, rate: 4 });
    this.add(n.log, 1290, 668, { solid: 9, label: 'log' });
    this.chest = this.add(this.a.props.chestClosed, 1256, 626, { solid: 8, label: 'chest (E to open)' });
    this.add(this.a.props.potions[1], 1316, 618, { label: 'potion' });
    this.add(this.a.props.coin, 1274, 660, { label: 'coin' });
    this.add(this.a.props.gems[0], 1330, 656, { label: 'gem' });
    this.light({ x: 1330, y: 652, radius: 30, color: P.magic, intensity: 0.5, pulse: 0.5, pulseSpeed: 3 });

    // Old ruins in the north-west corner, reusing the wall pieces.
    for (let i = 0; i < 8; i++) {
      this.add(this.a.props.ruinedWalls[i % 2], 120 + i * 16, 96, { solid: 9, label: 'ruined wall' });
    }
    for (let i = 0; i < 4; i++) {
      this.add(this.a.props.ruinedWalls[i % 2], 120, 96 + i * 26, { solid: 9, label: 'ruined wall' });
    }
    this.add(this.a.props.archDoor, 200, 100, { label: 'ruined arch' });
    void R;
  }
}

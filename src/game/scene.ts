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

  /**
   * One bay of fence.
   *
   * All the irregularity lives in the sprite variants (see `fenceSegment` in
   * `buildings.ts`), so a run is just this in a loop — but because the bay is
   * drawn at random the run never repeats one picket.
   *
   * `mode` matters as much as the jitter does. An east or west side of an
   * enclosure runs *away* from the camera, and building it out of the same
   * front-facing bay lays a horizontal rail across the screen every 16px: that
   * is the ladder. Those runs take `'side'`, whose rails are foreshortened to a
   * plank running back up the line.
   */
  private fenceBay(rng: RNG, x: number, y: number, mode: 'run' | 'side' | 'corner' = 'run'): void {
    const f = this.a.buildings.fence;
    const sheet =
      mode === 'corner'
        ? f.corner
        : mode === 'side'
          ? f.sides[rng.int(0, f.sides.length - 1)]
          : rng.chance(0.07)
            ? f.broken
            : f.bays[rng.int(0, f.bays.length - 1)];
    this.add(sheet, x, y, { solid: 6, label: 'fence' });
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
      // unreachable and the building can never be entered. The gap tracks the
      // 16px doorway below.
      if (interior && Math.abs(sx - x) < 14) continue;
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
    // The sign hangs off the bracket the facade drew for it, up at the head of
    // the ground floor — on a 40px storey the old fixed `y - 20` put it at
    // waist height, level with the barrels.
    if (sign) this.add(sign, x + bld.sign.x, y + bld.sign.y, { sortY: y + 1, label: `${label} sign` });
    // The patch of street just outside the door: where residents go to sleep.
    this.homes.push({ x0: x - 14, y0: y + 6, x1: x + 14, y1: y + 16 });
    if (interior) {
      // The doorway itself: a narrow trigger sitting on the threshold. The
      // collision circles above leave this gap, so you can only reach it by
      // walking straight at the door.
      this.doors.push({ x: x - 8, y: y - 6, w: 16, h: 10, kind: interior, seed: this.doorSeed++, label });
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

  /**
   * The street frontages.
   *
   * These coordinates are hand-written, so they had to be re-cut when the
   * buildings were rescaled to the 30px villager — a cottage went from 58px of
   * sprite to 106 and the inn from 88 to 152, which at the old spacing put
   * every roof through the doorstep of the house above it. Three rules drive
   * the numbers below:
   *
   *  - **Vertical pitch.** Consecutive frontages on one side of a street are
   *    spaced by at least the upper one's sprite height plus a margin, so no
   *    roof lands on the neighbour's threshold.
   *  - **Roads carry collision, not pixels.** A facade may *draw* over the road
   *    behind it — that is just correct occlusion — but no building's collision
   *    band (y-17..y+1) may sit on a carriageway, or the street is blocked.
   *  - **The south-east block is narrow.** Between the main street's east kerb
   *    (x 580) and the player's plot fence (x 696) there are 116px, so only the
   *    slimmer frontages go there.
   */
  private buildStreets(): void {
    const b = this.a.buildings;
    const WEST = 437;
    const EAST = 697;
    /** The pinched block between the high street and the farm gate. */
    const EAST_LOW = 636;

    // High street: inn and tavern face the square from either side of it.
    this.placeBuilding(b.inn, WEST, 470, 'inn', b.signs.inn, 'inn');
    this.placeBuilding(b.tavern, EAST, 478, 'tavern', b.signs.tavern, 'tavern');
    // The store sits east of the inn, hard against the street: at the old
    // x=437 the rescaled block would have stood in the middle of field 3
    // (330..470 x 640..760) with wheat growing through its front door.
    this.placeBuilding(b.shop, 500, 636, 'general store', b.signs.shop, 'shop');
    this.placeBuilding(b.smithy, EAST_LOW, 614, 'smithy', b.signs.smith, 'smithy');

    this.areas.forge = { x0: EAST_LOW - 22, y0: 624, x1: EAST_LOW + 22, y1: 642 };
    this.areas.shop = { x0: 478, y0: 646, x1: 522, y1: 664 };
    this.areas.tavern = { x0: EAST - 24, y0: 488, x1: EAST + 24, y1: 506 };

    // Forge fire spilling out of the smithy door, and its flue.
    this.light({ x: EAST_LOW, y: 606, radius: 92, color: P.fire, intensity: 1.15, flicker: 0.35 });
    this.smoke.push({ x: EAST_LOW + 20, y: 556, rate: 9 });

    // Cottages up and down the main street, plus two on the high street.
    //
    // The pair that used to sit at (443,820) and (447,720) are gone from there:
    // those coordinates are inside the paddock and inside field 3, which a 58px
    // sprite got away with and a 106px one does not — the cottage ended up
    // standing among the cows. They have moved to the high street instead, west
    // of the square and east of the tavern, where there is real frontage.
    const rows: [number, number, number][] = [
      [WEST, 170, 2],
      [WEST, 300, 0],
      [345, 592, 1],
      [830, 468, 3],
      [EAST, 180, 0],
      [EAST, 330, 2],
      [EAST_LOW, 760, 1],
      [EAST_LOW, 885, 3],
    ];
    for (const [x, y, kind] of rows) {
      this.placeBuilding(b.cottages[kind], x, y, 'cottage', undefined, 'cottage');
    }

    // Chapel on its own lane to the north-east, standing back from the verge so
    // its footprint leaves the lane open.
    this.placeBuilding(b.chapel, 866, 182, 'chapel', undefined, 'chapel');

    // Street lamps down the main street and along the high street.
    for (const [x, y] of [
      [539, 360],
      [591, 560],
      [539, 660],
      [591, 250],
      [772, 492],
      [392, 492],
      [960, 490],
    ] as [number, number][]) {
      this.add(b.lamppost, x, y, { solid: 4, label: 'lamppost' });
      this.light({ x, y: y - 34, radius: 78, color: [255, 208, 140, 255], intensity: 1, flicker: 0.12 });
    }

    // A cart and barrels outside the tavern, crates outside the store. All of
    // them stand clear of the widened frontages.
    this.add(b.cart, 606, 458, { solid: 12, label: 'cart' });
    this.add(this.a.props.barrels[0], 612, 480, { solid: 8, label: 'barrel' });
    this.add(this.a.props.barrels[1], 604, 490, { solid: 8, label: 'barrel' });
    // Well clear of the store's doorway: stacked on the threshold they walled
    // the shop off completely.
    this.add(this.a.props.crates[0], 536, 660, { solid: 8, label: 'crate' });
    this.add(this.a.props.crates[1], 546, 670, { solid: 8, label: 'crate' });
    this.add(this.a.props.sign, 530, 468, { solid: 4, label: 'signpost' });
  }

  private buildMarket(): void {
    const b = this.a.buildings;
    const p = this.a.props;
    const cx = (PLAZA.x0 + PLAZA.x1) / 2;
    const cy = (PLAZA.y0 + PLAZA.y1) / 2;

    // Well at the centre of the square — the classic town focal point.
    this.add(p.well, cx, cy + 6, { solid: 14, label: 'town well' });

    // Stalls in a diamond around it, each with a stallholder.
    //
    // They used to sit on the four corners of the square. The rescaled inn,
    // tavern, store and forge each reach 60-90px into those corners now, and a
    // deco whose sortY is *above* a building's base gets drawn behind it — so
    // the old corner stalls simply vanished into the walls. Every position here
    // is either clear of all four sprite footprints or in front of one.
    const stalls: [number, number, number][] = [
      [cx, cy - 53, 0],
      [cx - 60, cy, 1],
      [cx + 63, cy, 2],
      [cx + 8, cy + 65, 0],
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
    this.board = this.add(p.sign, cx - 40, cy - 77, { solid: 5, label: 'notice board' });

    // A brazier for warmth and a couple of crates of goods.
    this.add(p.brazier, cx - 40, cy + 78, { solid: 7, label: 'brazier' });
    this.light({ x: cx - 40, y: cy + 54, radius: 100, color: P.fire, intensity: 1.05, flicker: 0.28 });
    this.add(p.crates[1], cx - 25, cy + 91, { solid: 8, label: 'crate' });
    this.add(b.cart, cx - 45, cy + 45, { solid: 12, label: 'cart' });

    // Banners on poles across the head of the square, straddling the main
    // street like a gateway. They used to stand on the corners of the square,
    // which the inn's and the tavern's roofs now cover.
    for (const [x, y] of [
      [cx - 40, PLAZA.y0 + 5],
      [cx + 27, PLAZA.y0 + 5],
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
    // `MILL.x` in terrain.ts is measured to the old, narrower mill. The rescaled
    // block is 12px wider on each side, so it is pulled back off the bank by
    // that much: the point of the thing is that the wheel dips in the current,
    // and the wall has to stay on the west bank for that to read.
    const mx = MILL.x - 12;
    const my = MILL.y;
    this.placeBuilding(b.mill, mx, my, 'watermill', undefined, 'mill');

    // The wheel hangs off the river side of the mill, its left rim against the
    // gable wall (which now ends at mx+43) and its bottom blades in the current
    // — the west bank runs at about x 1150 through here.
    const wheelX = mx + 66;
    this.add(b.waterWheel, wheelX, my - 4, { sortY: my + 2, label: 'water wheel' });
    this.waterObstacles.push({ x: wheelX + 6, y: my - 20, r: 10 });
    // Constant spray where the paddles enter the current.
    this.smoke.push({ x: wheelX + 4, y: my - 12, rate: 0 });

    // A sluice of stacked planks leading the water to the wheel, plus sacks.
    this.add(this.a.props.crates[0], mx - 40, my + 22, { solid: 8, label: 'grain sack' });
    this.add(this.a.props.crates[1], mx - 28, my + 28, { solid: 8, label: 'grain sack' });
    this.add(b.cart, mx - 74, my + 26, { solid: 12, label: 'cart' });
    const millYard: Area = { x0: mx - 60, y0: my + 12, x1: mx + 20, y1: my + 42 };
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

    // Barn on the farm track west of the paddock. It used to stand at (380,800)
    // — inside the paddock, straddling its own north fence — which the rescaled
    // 110x116 block turned from a niggle into an obstruction. Here it clears
    // field 2 above it (y1 740) and the paddock's west fence (x0 300).
    this.placeBuilding(b.barn, 232, 872, 'barn', undefined, 'barn');

    // Crops, laid in rows that follow each field's furrows.
    //
    // Not one stamp tiled across a rectangle — that is the single thing that
    // made these fields read as wallpaper at 4x. A sown field is irregular in
    // four ways, and none of them costs anything:
    //
    //  - **rows wander.** Each row carries its own cross-row offset and its own
    //    start phase along the row, so no two rows line up into a grid.
    //  - **no two plants match.** Height comes from the tall/short variants,
    //    orientation from a coin flip.
    //  - **the edges are ragged.** A plant's chance of existing falls away over
    //    the last 16px on every side, so the block ends in a broken fringe
    //    instead of a guillotined line, and the baulk between two fields comes
    //    out irregular for free.
    //  - **things go wrong.** Whole stretches of a row are simply missing (a
    //    drill that blocked), and near the margins the odd plant has been
    //    flattened by the wind.
    const crops = new RNG(4801);
    for (const f of FIELDS) {
      if (f.crop === 'fallow') continue;
      const upright = f.crop === 'wheat' ? b.wheat : b.cabbage;
      const lodged = f.crop === 'wheat' ? b.wheatLodged : b.cabbageLodged;
      const stepX = f.vertical ? 14 : 16;
      const stepY = f.vertical ? 16 : 14;
      for (let y = f.y0 + 10; y < f.y1 - 6; y += stepY) {
        const rowOff = crops.int(-2, 2);
        const phase = crops.range(0, stepX);
        // Every third row or so has a bare stretch somewhere along it.
        const gapAt = crops.chance(0.35) ? crops.range(f.x0, f.x1) : -1e9;
        const gapW = crops.range(14, 34);
        for (let x = f.x0 + 10 + phase; x < f.x1 - 6; x += stepX) {
          if (isWater(x, y)) continue;
          if (Math.abs(x - gapAt) < gapW / 2) continue;
          const edge = Math.min(x - f.x0, f.x1 - x, y - f.y0, f.y1 - y);
          if (edge < 16 && crops.next() > 0.25 + (edge / 16) * 0.75) continue;
          const set = edge < 22 && crops.chance(0.12) ? lodged : upright;
          this.add(set[crops.int(0, set.length - 1)], x + crops.int(-2, 2), y + rowOff + crops.int(-1, 1), {
            layer: 'sorted',
            label: f.crop,
            flip: crops.chance(0.5),
            phase: crops.range(0, 4),
          });
        }
      }
      // Scarecrow on the headland, off-centre so the three of them don't line
      // up with each other across the valley.
      this.add(b.scarecrow, (f.x0 + f.x1) / 2 + crops.int(-14, 14), f.y0 + 6, { solid: 5, label: 'scarecrow' });
    }
    this.add(b.haystacks[0], 352, 300, { solid: 12, label: 'haystack' });
    this.add(b.haystacks[1], 150, 470, { solid: 12, label: 'haystack' });
    this.add(b.haystacks[0], 500, 760, { solid: 12, label: 'haystack', flip: true });

    // Paddock fence, with a gap for a gate on the north side. Corners last, so
    // the heavy post is drawn over the ends of both runs meeting there.
    const fences = new RNG(5150);
    const step = 16;
    for (let x = PADDOCK.x0 + step; x < PADDOCK.x1; x += step) {
      if (Math.abs(x - (PADDOCK.x0 + PADDOCK.x1) / 2) < 20) continue;
      this.fenceBay(fences, x, PADDOCK.y0);
      this.fenceBay(fences, x, PADDOCK.y1);
    }
    for (let y = PADDOCK.y0 + step; y < PADDOCK.y1; y += step) {
      this.fenceBay(fences, PADDOCK.x0, y, 'side');
      this.fenceBay(fences, PADDOCK.x1, y, 'side');
    }
    for (const [cx, cy] of [
      [PADDOCK.x0, PADDOCK.y0],
      [PADDOCK.x1, PADDOCK.y0],
      [PADDOCK.x0, PADDOCK.y1],
      [PADDOCK.x1, PADDOCK.y1],
    ] as [number, number][]) {
      this.fenceBay(fences, cx, cy, 'corner');
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

  /**
   * The player's own plot.
   *
   * This is the first thing anyone sees, and until now it was a fenced
   * rectangle of bare lawn — which reads as a building plot for sale, not as a
   * farm. Two halves fix that: `farm.ts` presets a broken-in corner of tilled
   * soil with something growing on it, and everything below is the clutter that
   * goes with it. The plot has to read as somebody's yard on their second day.
   */
  private buildFarmPlot(): void {
    const p = this.a.props;
    const b = this.a.buildings;
    const fences = new RNG(7311);
    const step = 16;
    const X0 = FARM.x0 - 8;
    const X1 = FARM.x1 + 8;
    const Y0 = FARM.y0 - 8;
    const Y1 = FARM.y1 + 8;
    for (let x = X0 + step; x < X1; x += step) {
      this.fenceBay(fences, x, Y0);
      this.fenceBay(fences, x, Y1);
    }
    for (let y = Y0 + step; y < Y1; y += step) {
      // The gateway, on the west side facing the town.
      if (Math.abs(y - (FARM.y0 + 56)) < 10) continue;
      this.fenceBay(fences, X0, y, 'side');
      this.fenceBay(fences, X1, y, 'side');
    }
    // Corners last, so the heavy post covers the ends of both runs meeting it.
    for (const [cx, cy] of [
      [X0, Y0],
      [X1, Y0],
      [X0, Y1],
      [X1, Y1],
    ] as [number, number][]) {
      this.fenceBay(fences, cx, cy, 'corner');
    }

    this.bin = this.add(p.chestClosed, FARM.x0 - 20, FARM.y0 + 40, { solid: 8, label: 'shipping bin' });
    this.add(b.scarecrow, FARM.x1 - 24, FARM.y0 + 8, { solid: 5, label: 'scarecrow' });
    this.add(p.sign, FARM.x0 - 22, FARM.y0 + 70, { solid: 4, label: 'plot sign' });

    // Work in progress. All of it sits clear of the tilled corner (cols 1-3,
    // rows 2-5 of the grid — x 720..772, y 624..692) so nothing stands on a
    // tile the player is meant to be able to hoe.
    this.add(b.haystacks[0], FARM.x1 - 30, FARM.y1 - 12, { solid: 11, label: 'haystack' });
    this.add(b.haystacks[1], FARM.x1 - 56, FARM.y1 - 2, { solid: 11, label: 'haystack', flip: true });
    this.add(p.crates[0], FARM.x0 + 18, FARM.y1 - 6, { solid: 8, label: 'seed crate' });
    this.add(p.crates[1], FARM.x0 + 33, FARM.y1 - 1, { solid: 8, label: 'seed crate' });
    this.add(p.barrels[0], FARM.x1 - 10, FARM.y0 + 20, { solid: 8, label: 'water butt' });
    // Tools left propped against the west fence, either side of the gateway.
    // They sit *on* the fence line rather than out on the grass: a 16px tool
    // alone in the middle of a field reads as a dropped pickup, but the same
    // sprite against a post reads as something somebody put down. No collision
    // — the gateway is the one place the player has to be able to get through.
    this.add(this.a.farm.tools.hoe, FARM.x0 - 6, FARM.y0 + 26, { sortY: FARM.y0 + 30, label: 'hoe' });
    this.add(this.a.farm.tools.can, FARM.x0 - 5, FARM.y0 + 82, { sortY: FARM.y0 + 86, label: 'watering can' });
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
      // Doorways are deliberately a hole in the collision wall, so the scatter
      // used to be free to plant a pine squarely in front of a door and lock
      // the building. Keep the approach to every threshold clear.
      for (const d of this.doors)
        if (x > d.x - 18 && x < d.x + d.w + 18 && y > d.y - 14 && y < d.y + d.h + 42) return false;
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

    // Somebody's camp on the far bank: a fire, a log to sit on, a crate and a
    // chest with their kit in it.
    //
    // What used to be here as well was a potion bottle, a loose gem and a coin
    // hovering over the grass — display pieces left over from the shooter this
    // engine started life as. In a farming game they state nothing: there is no
    // pick-up, no drop table and nothing that makes loose treasure lying in a
    // field mean anything. The *sprites* all still exist and are still in the
    // gallery (`props.ts` is untouched); they are simply no longer furniture in
    // the world. The fire, the log and the chest stay, because together those
    // three do say something — someone sleeps out here.
    this.add(this.a.props.campfire, 1290, 640, { solid: 9, label: 'campfire' });
    this.light({ x: 1290, y: 630, radius: 122, color: P.fire, intensity: 1.2, flicker: 0.26 });
    this.smoke.push({ x: 1290, y: 622, rate: 4 });
    this.add(n.log, 1290, 668, { solid: 9, label: 'log' });
    this.chest = this.add(this.a.props.chestClosed, 1256, 626, { solid: 8, label: 'chest (E to open)' });
    this.add(this.a.props.crates[0], 1322, 622, { solid: 8, label: 'crate' });
    this.add(this.a.props.barrels[1], 1266, 600, { solid: 8, label: 'barrel' });

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

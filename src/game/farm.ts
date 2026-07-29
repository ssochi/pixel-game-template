/**
 * The farm plot.
 *
 * A 16px tile grid laid over one rectangle of the world. Each tile carries its
 * own state — untilled, tilled, watered, planted, and how far the crop has
 * grown — and the whole grid advances one step every time the player sleeps.
 * This is the core loop of the game: till, plant, water, sleep, harvest.
 */
import type { CropKind } from '../art/farm';
import { TILE } from '../art/farm';

export const FARM = { x0: 704, y0: 592, x1: 896, y1: 720 };

export const COLS = Math.floor((FARM.x1 - FARM.x0) / TILE);
export const ROWS = Math.floor((FARM.y1 - FARM.y0) / TILE);

export interface CropDef {
  kind: CropKind;
  /** Days between growth stages. */
  days: number;
  /** What harvesting yields, and what it sells for. */
  yieldItem: string;
  price: number;
  seedItem: string;
}

export const CROPS: Record<string, CropDef> = {
  turnip: { kind: 'turnip', days: 1, yieldItem: 'turnip', price: 35, seedItem: 'turnipSeeds' },
  pumpkin: { kind: 'pumpkin', days: 2, yieldItem: 'pumpkin', price: 90, seedItem: 'pumpkinSeeds' },
  wheat: { kind: 'wheat', days: 1, yieldItem: 'wheat', price: 25, seedItem: 'wheatSeeds' },
};

export const enum Soil {
  Wild = 0,
  Tilled = 1,
}

export interface Tile {
  soil: Soil;
  watered: boolean;
  crop: string | null;
  /** 0..3; 3 is ready to harvest. */
  stage: number;
  /** Growth progress towards the next stage, in watered days. */
  progress: number;
}

/**
 * What is already in the ground on day one, as `[col, row]` on the grid.
 *
 * An empty fenced lawn is the first thing the player sees, and it reads as a
 * building plot for sale rather than as a farm. So the corner nearest the gate
 * (which is on the west side, level with row 3) has already been broken in.
 * The patch is deliberately *not* a clean rectangle — two tiles are missing out
 * of the 3x4 block — because nothing dug by hand ever is.
 */
const STARTING_TILLED: readonly [number, number][] = [
  [1, 2],
  [2, 2],
  [1, 3],
  [2, 3],
  [3, 3],
  [1, 4],
  [2, 4],
  [3, 4],
  [2, 5],
  [3, 5],
];

/** `[col, row, crop, stage]`. Every one of these sits on a tile tilled above. */
const STARTING_CROPS: readonly [number, number, string, number][] = [
  [1, 3, 'turnip', 2],
  [2, 3, 'turnip', 2],
  [2, 4, 'wheat', 2],
  [3, 4, 'pumpkin', 1],
];

export class Farm {
  readonly tiles: Tile[] = [];

  constructor() {
    for (let i = 0; i < COLS * ROWS; i++) {
      this.tiles.push({ soil: Soil.Wild, watered: false, crop: null, stage: 0, progress: 0 });
    }
    this.seedStartingPlot();
  }

  /**
   * Day one.
   *
   * The crops go in with `progress` at zero and `watered` true, which is
   * exactly the state a crop the player planted and watered would be in: the
   * first `newDay()` then advances them one stage by the ordinary path. Seeding
   * a `progress` at or past the crop's `days`, or a `stage` above 3, would
   * either skip a stage or push `stage` past the end of the four-sprite array
   * the moment the player first slept — which is the one way preset data here
   * can break the game.
   */
  private seedStartingPlot(): void {
    const at = (cx: number, cy: number): Tile | null =>
      cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS ? null : this.tiles[cy * COLS + cx];
    for (const [cx, cy] of STARTING_TILLED) {
      const t = at(cx, cy);
      if (t) t.soil = Soil.Tilled;
    }
    for (const [cx, cy, crop, stage] of STARTING_CROPS) {
      const t = at(cx, cy);
      if (!t || t.soil !== Soil.Tilled || !CROPS[crop]) continue;
      t.crop = crop;
      t.stage = Math.max(0, Math.min(3, stage));
      t.progress = 0;
      // Watered, so the planted tiles read a step darker than the bare ones
      // beside them and the patch has some tonal structure rather than being
      // one flat slab of brown.
      t.watered = true;
    }
  }

  /** World position -> tile index, or -1 if outside the plot. */
  indexAt(x: number, y: number): number {
    const cx = Math.floor((x - FARM.x0) / TILE);
    const cy = Math.floor((y - FARM.y0) / TILE);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return -1;
    return cy * COLS + cx;
  }

  tileOrigin(i: number): { x: number; y: number } {
    return { x: FARM.x0 + (i % COLS) * TILE, y: FARM.y0 + Math.floor(i / COLS) * TILE };
  }

  contains(x: number, y: number): boolean {
    return x >= FARM.x0 && y >= FARM.y0 && x < FARM.x0 + COLS * TILE && y < FARM.y0 + ROWS * TILE;
  }

  // --- actions -------------------------------------------------------------

  till(i: number): boolean {
    const t = this.tiles[i];
    if (t.soil !== Soil.Wild) return false;
    t.soil = Soil.Tilled;
    return true;
  }

  water(i: number): boolean {
    const t = this.tiles[i];
    if (t.soil !== Soil.Tilled || t.watered) return false;
    t.watered = true;
    return true;
  }

  plant(i: number, crop: string): boolean {
    const t = this.tiles[i];
    if (t.soil !== Soil.Tilled || t.crop) return false;
    t.crop = crop;
    t.stage = 0;
    t.progress = 0;
    return true;
  }

  /** Returns the yielded item id, or null if there was nothing to take. */
  harvest(i: number): string | null {
    const t = this.tiles[i];
    if (!t.crop || t.stage < 3) return null;
    const def = CROPS[t.crop];
    t.crop = null;
    t.stage = 0;
    t.progress = 0;
    // Harvesting leaves the soil tilled and ready to replant.
    return def.yieldItem;
  }

  /** Clear a tile back to wild ground (the scythe on an empty tilled tile). */
  clear(i: number): boolean {
    const t = this.tiles[i];
    if (t.crop || t.soil !== Soil.Tilled) return false;
    t.soil = Soil.Wild;
    t.watered = false;
    return true;
  }

  /**
   * Overnight. Watered crops advance; unwatered ones stall, which is the whole
   * reason the watering can exists. Everything dries out by morning.
   */
  newDay(): void {
    for (const t of this.tiles) {
      if (t.crop && t.watered && t.stage < 3) {
        t.progress += 1;
        if (t.progress >= CROPS[t.crop].days) {
          t.progress = 0;
          t.stage += 1;
        }
      }
      t.watered = false;
    }
  }
}

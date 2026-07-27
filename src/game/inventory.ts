/**
 * Tools, seeds, produce and the hotbar.
 *
 * One flat item table drives everything: what an item looks like in the hotbar,
 * whether it is a tool or a stack, what it does when used, and what it sells
 * for. Adding a crop is one entry here plus one in `CROPS`.
 */
import type { Assets } from '../art/assets';
import type { Sheet } from '../art/sheet';

export type ItemUse = 'till' | 'water' | 'chop' | 'mine' | 'cut' | 'plant' | 'none';

export interface ItemDef {
  id: string;
  name: string;
  use: ItemUse;
  /** Seeds carry the crop they plant. */
  crop?: string;
  /** Stackable goods have a sale price; tools do not. */
  price?: number;
  tool: boolean;
}

export const ITEMS: Record<string, ItemDef> = {
  hoe: { id: 'hoe', name: 'HOE', use: 'till', tool: true },
  can: { id: 'can', name: 'WATERING CAN', use: 'water', tool: true },
  axe: { id: 'axe', name: 'AXE', use: 'chop', tool: true },
  pick: { id: 'pick', name: 'PICKAXE', use: 'mine', tool: true },
  scythe: { id: 'scythe', name: 'SCYTHE', use: 'cut', tool: true },

  turnipSeeds: { id: 'turnipSeeds', name: 'TURNIP SEEDS', use: 'plant', crop: 'turnip', price: 8, tool: false },
  pumpkinSeeds: { id: 'pumpkinSeeds', name: 'PUMPKIN SEEDS', use: 'plant', crop: 'pumpkin', price: 25, tool: false },
  wheatSeeds: { id: 'wheatSeeds', name: 'WHEAT SEEDS', use: 'plant', crop: 'wheat', price: 6, tool: false },

  turnip: { id: 'turnip', name: 'TURNIP', use: 'none', price: 35, tool: false },
  pumpkin: { id: 'pumpkin', name: 'PUMPKIN', use: 'none', price: 90, tool: false },
  wheat: { id: 'wheat', name: 'WHEAT', use: 'none', price: 25, tool: false },
  wood: { id: 'wood', name: 'WOOD', use: 'none', price: 4, tool: false },
  stone: { id: 'stone', name: 'STONE', use: 'none', price: 4, tool: false },
  fibre: { id: 'fibre', name: 'FIBRE', use: 'none', price: 2, tool: false },
};

export interface Slot {
  item: string | null;
  count: number;
}

export const HOTBAR_SIZE = 8;

export class Inventory {
  readonly slots: Slot[] = Array.from({ length: HOTBAR_SIZE }, () => ({ item: null, count: 0 }));
  selected = 0;
  gold = 500;

  constructor() {
    this.slots[0] = { item: 'hoe', count: 1 };
    this.slots[1] = { item: 'can', count: 1 };
    this.slots[2] = { item: 'axe', count: 1 };
    this.slots[3] = { item: 'pick', count: 1 };
    this.slots[4] = { item: 'scythe', count: 1 };
    this.slots[5] = { item: 'turnipSeeds', count: 12 };
    this.slots[6] = { item: 'wheatSeeds', count: 8 };
  }

  get held(): ItemDef | null {
    const s = this.slots[this.selected];
    return s.item ? ITEMS[s.item] : null;
  }

  select(i: number): void {
    this.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  }

  cycle(d: number): void {
    this.select(this.selected + d);
  }

  /** Add to an existing stack, else the first free slot. Returns false if full. */
  add(item: string, n = 1): boolean {
    if (ITEMS[item]?.tool) {
      const free = this.slots.find((s) => !s.item);
      if (!free) return false;
      free.item = item;
      free.count = 1;
      return true;
    }
    const stack = this.slots.find((s) => s.item === item);
    if (stack) {
      stack.count += n;
      return true;
    }
    const free = this.slots.find((s) => !s.item);
    if (!free) return false;
    free.item = item;
    free.count = n;
    return true;
  }

  /** Consume one of the selected stack (tools are never consumed). */
  consumeSelected(): void {
    const s = this.slots[this.selected];
    if (!s.item || ITEMS[s.item].tool) return;
    s.count -= 1;
    if (s.count <= 0) {
      s.item = null;
      s.count = 0;
    }
  }

  count(item: string): number {
    return this.slots.filter((s) => s.item === item).reduce((a, s) => a + s.count, 0);
  }

  /** Sell everything sellable; tools and seeds are kept. */
  sellProduce(): number {
    let total = 0;
    for (const s of this.slots) {
      if (!s.item) continue;
      const def = ITEMS[s.item];
      if (def.tool || def.use === 'plant' || !def.price) continue;
      total += def.price * s.count;
      s.item = null;
      s.count = 0;
    }
    this.gold += total;
    return total;
  }
}

/** Icon for an item: tools have their own, produce reuses the crop sprite. */
export function iconFor(a: Assets, id: string): Sheet | null {
  const def = ITEMS[id];
  if (!def) return null;
  if (def.tool) return a.farm.tools[id] ?? null;
  if (def.use === 'plant') return a.farm.tools.seeds;
  switch (id) {
    case 'turnip':
      return a.farm.crops.turnip[3];
    case 'pumpkin':
      return a.farm.crops.pumpkin[3];
    case 'wheat':
      return a.farm.crops.wheat[3];
    case 'wood':
      return a.nature.log;
    case 'stone':
      return a.nature.rocks[0];
    case 'fibre':
      return a.nature.grass[0].sheet;
    default:
      return null;
  }
}

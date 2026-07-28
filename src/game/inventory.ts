/**
 * Tools, seeds, produce and the hotbar.
 *
 * One flat item table drives everything: what an item looks like in the hotbar,
 * whether it is a tool or a stack, what it does when used, and what it sells
 * for. Adding a crop is one entry here plus one in `CROPS`.
 */
import type { Assets } from '../art/assets';
import type { CropKind } from '../art/farm';
import type { Sheet } from '../art/sheet';
import { FISH } from './fishing';

export type ItemUse = 'till' | 'water' | 'chop' | 'mine' | 'cut' | 'plant' | 'fish' | 'none';

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
  rod: { id: 'rod', name: 'FISHING ROD', use: 'fish', tool: true },

  turnipSeeds: { id: 'turnipSeeds', name: 'TURNIP SEEDS', use: 'plant', crop: 'turnip', price: 8, tool: false },
  pumpkinSeeds: { id: 'pumpkinSeeds', name: 'PUMPKIN SEEDS', use: 'plant', crop: 'pumpkin', price: 25, tool: false },
  wheatSeeds: { id: 'wheatSeeds', name: 'WHEAT SEEDS', use: 'plant', crop: 'wheat', price: 6, tool: false },

  turnip: { id: 'turnip', name: 'TURNIP', use: 'none', price: 35, tool: false },
  pumpkin: { id: 'pumpkin', name: 'PUMPKIN', use: 'none', price: 90, tool: false },
  wheat: { id: 'wheat', name: 'WHEAT', use: 'none', price: 25, tool: false },
  wood: { id: 'wood', name: 'WOOD', use: 'none', price: 4, tool: false },
  stone: { id: 'stone', name: 'STONE', use: 'none', price: 4, tool: false },
  fibre: { id: 'fibre', name: 'FIBRE', use: 'none', price: 2, tool: false },
  mushroom: { id: 'mushroom', name: 'MUSHROOM', use: 'none', price: 18, tool: false },
  flower: { id: 'flower', name: 'WILD FLOWER', use: 'none', price: 14, tool: false },
};

// Every species from the fishing table becomes an ordinary sellable, giftable
// stack. Declaring them here rather than by hand keeps one source of truth for
// prices — the fishing table sets them, the shipping bin reads them.
for (const f of Object.values(FISH)) {
  ITEMS[f.id] = { id: f.id, name: f.name, use: 'none', price: f.price, tool: false };
}

export interface Slot {
  item: string | null;
  count: number;
}

/** 10 slots: keys 1-9 and 0. Eight was one short once the rod arrived. */
export const HOTBAR_SIZE = 10;

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
    this.slots[5] = { item: 'rod', count: 1 };
    this.slots[6] = { item: 'turnipSeeds', count: 12 };
    this.slots[7] = { item: 'wheatSeeds', count: 8 };
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

  /** Spend gold on a stack. Returns false if you cannot afford it or are full. */
  buy(item: string, price: number, n = 1): boolean {
    if (this.gold < price * n) return false;
    if (!this.add(item, n)) return false;
    this.gold -= price * n;
    return true;
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

/** What Mara sells. Seed prices are deliberately well under the crop's value. */
export const SHOP_STOCK: { item: string; price: number }[] = [
  { item: 'turnipSeeds', price: 12 },
  { item: 'wheatSeeds', price: 9 },
  { item: 'pumpkinSeeds', price: 40 },
];

/** Icon for an item: tools have their own, produce reuses the crop sprite. */
export function iconFor(a: Assets, id: string): Sheet | null {
  const def = ITEMS[id];
  if (!def) return null;
  if (id === 'rod') return a.fishing.rod;
  if (def.tool) return a.farm.tools[id] ?? null;
  if (def.use === 'plant') return def.crop ? a.farm.seeds[def.crop as CropKind] : a.farm.tools.seeds;
  // Everything stackable has a purpose-drawn icon. World sprites scaled into a
  // slot were unreadable — a 35px fish at 40% is a smear, not a pike.
  return a.icons[id] ?? null;
}

/**
 * One save slot, written when the player sleeps.
 *
 * The rule that shapes this whole file: **a bad save must never break the
 * boot path.** A save is player-editable text in `localStorage` that may also
 * have been written by an older build, so every value that comes back out is
 * treated as hostile — parsed inside a `try`, checked for shape, and clamped
 * into the range the game can actually render. Anything that fails is not
 * repaired and not reported as an error; it simply means "there is no save",
 * and the player gets a new game instead of a crash.
 *
 * What is *not* in here matters as much as what is. The world — terrain,
 * `scene.decos`, colliders, lights, baked interiors — is generated from fixed
 * seeds at boot, so it is reproduced rather than stored. Serialising it would
 * add hundreds of kilobytes and weld the save to one build of the art code.
 *
 * Shape (v1), abbreviated for size because the farm alone is 96 tiles:
 *
 * ```json
 * {
 *   "version": 1,
 *   "day": 3, "dayT": 0.26, "energy": 1,
 *   "px": 690, "py": 650,
 *   "tiles": [[1,0,"turnip",3,0], [0,0,null,0,0], ...96 entries...],
 *   "inv": { "selected": 0, "gold": 640,
 *            "slots": [["hoe",1], ["can",1], null, ...10 entries...] },
 *   "bonds": [["mara",34,3,2,1], ["brann",0,-1,-1,0], ...],
 *   "quests": [[1,1],[1,0],[0,0],[0,0],[0,0]],
 *   "forage": [-1,-1,2,-1,...]
 * }
 * ```
 *
 * Tiles are `[soil, watered, crop, stage, progress]`, slots `[item, count]`,
 * bonds `[id, points, lastTalkDay, lastGiftDay, met]`, quests `[taken, done]`,
 * forage the day each pick-up was taken (`-1` = still there). Booleans travel
 * as 0/1 — with 96 tiles and 10 slots, `false` vs `0` is real bytes.
 */
import { CROPS, Farm, Soil, type Tile } from './farm';
import { HOTBAR_SIZE, ITEMS, Inventory } from './inventory';
import { CAST, QUESTS, Social, resetQuests } from './social';
import { WORLD_H, WORLD_W } from './terrain';

export const SAVE_KEY = 'rivervale.save.v1';

/**
 * Bump this whenever the shape below changes. Old saves are then rejected
 * outright and the player starts fresh — there is no migration code yet, and
 * the version number exists precisely so that adding some later is possible
 * without having to guess what an unlabelled blob meant.
 */
export const SAVE_VERSION = 1;

/** Day one, in one place: the boot spawn and what NEW GAME resets to. */
export const NEW_GAME: { day: number; dayT: number; energy: number; x: number; y: number } = {
  day: 1,
  dayT: 0.79,
  energy: 1,
  x: 690,
  y: 650,
};

/** A pick-up on the map. Only the two fields the save touches are named. */
export interface ForageEntry {
  gone: number;
  deco: { hidden?: boolean };
}

/**
 * Everything the save reads and writes.
 *
 * The scalars live as loose `let`s in `main.ts`'s closure, so they travel as
 * plain fields here: `main.ts` fills the object, hands it over, and copies the
 * scalars back afterwards. The class references are shared, so `apply` mutates
 * those in place.
 */
export interface GameState {
  day: number;
  dayT: number;
  energy: number;
  /**
   * Where the player stands when the overworld comes back. While indoors this
   * must be the doorstep outside, never `player.x/y` — interior coordinates
   * are room-local and would drop the player somewhere arbitrary in the valley.
   */
  px: number;
  py: number;
  farm: Farm;
  inv: Inventory;
  social: Social;
  forage: ForageEntry[];
}

type TileRow = [number, number, string | null, number, number];
type SlotRow = [string, number] | null;
type BondRow = [string, number, number, number, number];
type QuestRow = [number, number];

export interface SaveData {
  version: number;
  day: number;
  dayT: number;
  energy: number;
  px: number;
  py: number;
  tiles: TileRow[];
  inv: { selected: number; gold: number; slots: SlotRow[] };
  bonds: BondRow[];
  quests: QuestRow[];
  forage: number[];
}

// --- writing ---------------------------------------------------------------

export function serialize(s: GameState): SaveData {
  return {
    version: SAVE_VERSION,
    day: s.day,
    dayT: s.dayT,
    energy: s.energy,
    px: Math.round(s.px),
    py: Math.round(s.py),
    tiles: s.farm.tiles.map(
      (t): TileRow => [t.soil, t.watered ? 1 : 0, t.crop, t.stage, t.progress],
    ),
    inv: {
      selected: s.inv.selected,
      gold: s.inv.gold,
      slots: s.inv.slots.map((sl): SlotRow => (sl.item ? [sl.item, sl.count] : null)),
    },
    // Only the named cast is stored. `Social.get` will happily mint a bond for
    // any id, so writing the map wholesale would let one stray entry persist
    // forever; the cast list is the authority on who exists.
    bonds: CAST.map((c): BondRow => {
      const f = s.social.get(c.id);
      return [c.id, f.points, f.lastTalkDay, f.lastGiftDay, f.met ? 1 : 0];
    }),
    quests: QUESTS.map((q): QuestRow => [q.taken ? 1 : 0, q.done ? 1 : 0]),
    forage: s.forage.map((f) => f.gone),
  };
}

/**
 * Write the slot. Returns false instead of throwing: `localStorage` is denied
 * outright in some privacy modes and throws `QuotaExceededError` when full,
 * and neither is worth losing the running game over.
 */
export function save(s: GameState): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(s)));
    return true;
  } catch {
    return false;
  }
}

export function wipe(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to do: if we cannot reach storage there is nothing to erase */
  }
}

// --- validation primitives -------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Finite number clamped into range, or `fb` for anything else (incl. NaN). */
function num(v: unknown, lo: number, hi: number, fb: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fb;
}

function int(v: unknown, lo: number, hi: number, fb: number): number {
  return Math.round(num(v, lo, hi, fb));
}

/** 1 and `true` both read as true; everything else, including junk, is false. */
function flag(v: unknown): boolean {
  return v === true || v === 1;
}

/** A saved row is a fixed-length tuple; anything else is not that row. */
function row(v: unknown, len: number): unknown[] | null {
  return Array.isArray(v) && v.length === len ? v : null;
}

// --- reading ---------------------------------------------------------------

/**
 * Turn whatever came out of storage into a `SaveData`, or null.
 *
 * Rejection is deliberately blunt at the top — wrong type, wrong version, or a
 * farm that is not exactly the current grid means the save was written by a
 * different game and there is nothing safe to salvage. Below that everything is
 * best-effort: a missing bond, a short quest list or an unknown item id costs
 * that one value, not the whole save.
 */
function normalize(raw: unknown, farm: Farm, forageCount: number): SaveData | null {
  if (!isObj(raw)) return null;
  if (raw.version !== SAVE_VERSION) return null;
  if (!Array.isArray(raw.tiles) || raw.tiles.length !== farm.tiles.length) return null;

  const day = int(raw.day, 1, 1e6, NEW_GAME.day);

  const tiles: TileRow[] = raw.tiles.map((r): TileRow => {
    const t = row(r, 5);
    if (!t) return [Soil.Wild, 0, null, 0, 0];
    const soil = int(t[0], 0, 1, Soil.Wild) === Soil.Tilled ? Soil.Tilled : Soil.Wild;
    // Only tilled ground can hold a crop, so a crop id on wild soil is not a
    // state the game can reach — drop it rather than render a turnip on turf.
    const crop = soil === Soil.Tilled && typeof t[2] === 'string' && CROPS[t[2]] ? t[2] : null;
    // `stage` indexes a four-sprite array. Out of range here is the one field
    // that would throw on the very first frame it is drawn.
    const stage = crop ? int(t[3], 0, 3, 0) : 0;
    const progress = crop ? int(t[4], 0, 99, 0) : 0;
    const watered = soil === Soil.Tilled && flag(t[1]) ? 1 : 0;
    return [soil, watered, crop, stage, progress];
  });

  const rawInv = isObj(raw.inv) ? raw.inv : {};
  const rawSlots = Array.isArray(rawInv.slots) ? rawInv.slots : [];
  const slots: SlotRow[] = [];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const r = row(rawSlots[i], 2);
    const id = r && typeof r[0] === 'string' ? r[0] : null;
    if (!id || !ITEMS[id]) {
      slots.push(null);
      continue;
    }
    // Tools do not stack; produce with a count of zero is an empty slot.
    const count = ITEMS[id].tool ? 1 : int(r?.[1], 0, 1e6, 0);
    slots.push(count > 0 ? [id, count] : null);
  }

  const rawBonds = Array.isArray(raw.bonds) ? raw.bonds : [];
  const known = new Set(CAST.map((c) => c.id));
  const bonds: BondRow[] = [];
  for (const b of rawBonds) {
    const r = row(b, 5);
    if (!r || typeof r[0] !== 'string' || !known.has(r[0])) continue;
    bonds.push([
      r[0],
      int(r[1], 0, 1e6, 0),
      // -1 is the "never" sentinel; a day in the future would silently lock
      // out talking or gifting until the calendar caught up.
      int(r[2], -1, day, -1),
      int(r[3], -1, day, -1),
      flag(r[4]) ? 1 : 0,
    ]);
  }

  const rawQuests = Array.isArray(raw.quests) ? raw.quests : [];
  const quests: QuestRow[] = QUESTS.map((_, i) => {
    const r = row(rawQuests[i], 2);
    if (!r) return [0, 0];
    // A finished quest was necessarily taken, whatever the file says.
    const done = flag(r[1]) ? 1 : 0;
    return [done || flag(r[0]) ? 1 : 0, done];
  });

  const rawForage = Array.isArray(raw.forage) ? raw.forage : [];
  const forage: number[] = [];
  for (let i = 0; i < forageCount; i++) {
    const v = rawForage[i];
    // `gone` is the day it was picked; past `day` it would never regrow.
    forage.push(typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), day) : -1);
  }

  return {
    version: SAVE_VERSION,
    day,
    dayT: num(raw.dayT, 0, 1, NEW_GAME.dayT),
    energy: num(raw.energy, 0, 1, 1),
    px: num(raw.px, 0, WORLD_W, NEW_GAME.x),
    py: num(raw.py, 0, WORLD_H, NEW_GAME.y),
    tiles,
    inv: {
      selected: int(rawInv.selected, 0, HOTBAR_SIZE - 1, 0),
      gold: int(rawInv.gold, 0, 1e9, 0),
      slots,
    },
    bonds,
    quests,
    forage,
  };
}

/** The raw slot contents, or null if storage is unreachable or the text is not JSON. */
function readRaw(): unknown {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * What the title screen needs before the player has chosen anything: the day
 * number of a save that would actually load, or null if there isn't one.
 * Runs the same validation as `load`, so CONTINUE can never offer a save that
 * then fails to open.
 */
export function peek(farm: Farm, forageCount: number): { day: number } | null {
  const data = normalize(readRaw(), farm, forageCount);
  return data ? { day: data.day } : null;
}

/**
 * Push `raw` into the live game. Returns false — having touched nothing — for
 * any save that does not validate.
 */
export function apply(raw: unknown, s: GameState): boolean {
  const d = normalize(raw, s.farm, s.forage.length);
  if (!d) return false;

  s.day = d.day;
  s.dayT = d.dayT;
  s.energy = d.energy;
  s.px = d.px;
  s.py = d.py;

  for (let i = 0; i < s.farm.tiles.length; i++) {
    const [soil, watered, crop, stage, progress] = d.tiles[i];
    const t: Tile = s.farm.tiles[i];
    t.soil = soil;
    t.watered = watered === 1;
    t.crop = crop;
    t.stage = stage;
    t.progress = progress;
  }

  s.inv.selected = d.inv.selected;
  s.inv.gold = d.inv.gold;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const sl = s.inv.slots[i];
    const row2 = d.inv.slots[i];
    sl.item = row2 ? row2[0] : null;
    sl.count = row2 ? row2[1] : 0;
  }

  // Everyone starts from the stranger default, then the save overwrites who it
  // knows about — otherwise a save missing a villager would inherit whatever
  // the previous session felt about them.
  for (const c of CAST) {
    const f = s.social.get(c.id);
    f.points = 0;
    f.lastTalkDay = -1;
    f.lastGiftDay = -1;
    f.met = false;
  }
  for (const [id, points, talkDay, giftDay, met] of d.bonds) {
    const f = s.social.get(id);
    f.points = points;
    f.lastTalkDay = talkDay;
    f.lastGiftDay = giftDay;
    f.met = met === 1;
  }

  // `QUESTS` is module state, not per-session state (see the note on its
  // declaration): loading has to write it and NEW GAME has to clear it.
  for (let i = 0; i < QUESTS.length; i++) {
    QUESTS[i].taken = d.quests[i][0] === 1;
    QUESTS[i].done = d.quests[i][1] === 1;
  }

  for (let i = 0; i < s.forage.length; i++) {
    const f = s.forage[i];
    f.gone = d.forage[i];
    f.deco.hidden = f.gone >= 0;
  }
  return true;
}

/** Read the slot and apply it. False means "there was no usable save". */
export function load(s: GameState): boolean {
  return apply(readRaw(), s);
}

/**
 * Day one, without reloading the page.
 *
 * Every long-lived object is reset by copying a freshly constructed one over
 * it, so the starting layout stays defined in exactly one place (`Farm`'s
 * preset plot, `Inventory`'s starting kit) and cannot drift out of sync with a
 * second copy here.
 */
export function newGame(s: GameState): void {
  s.day = NEW_GAME.day;
  s.dayT = NEW_GAME.dayT;
  s.energy = NEW_GAME.energy;
  s.px = NEW_GAME.x;
  s.py = NEW_GAME.y;

  const farm = new Farm();
  for (let i = 0; i < s.farm.tiles.length; i++) {
    Object.assign(s.farm.tiles[i], farm.tiles[i]);
  }

  const inv = new Inventory();
  s.inv.selected = inv.selected;
  s.inv.gold = inv.gold;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    s.inv.slots[i].item = inv.slots[i].item;
    s.inv.slots[i].count = inv.slots[i].count;
  }

  const social = new Social();
  s.social.bonds.clear();
  for (const [id, f] of social.bonds) s.social.bonds.set(id, { ...f });

  resetQuests();

  for (const f of s.forage) {
    f.gone = -1;
    f.deco.hidden = false;
  }
}

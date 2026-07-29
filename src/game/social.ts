/**
 * The people of the valley: who they are, how they feel about you, and what
 * they want.
 *
 * A named cast is what turns a crowd into a town. Each villager has a job, a
 * place they work, things they like, and dialogue that changes as you get to
 * know them. Talking once a day earns a little goodwill; a gift they like earns
 * a lot. The quest board on the square strings a few of them together into
 * something resembling a story.
 */
import type { Area } from './npc';

export interface VillagerDef {
  id: string;
  name: string;
  /** Shown under the name in dialogue. */
  job: string;
  /** Index into the baked NPC skin list. */
  skin: number;
  /** Where they spend the working day. */
  work: 'square' | 'field' | 'mill' | 'river' | 'paddock' | 'forge' | 'shop' | 'tavern' | 'street';
  activity: 'work' | 'wander';
  /** Items that delight them. Anything else is merely polite. */
  likes: string[];
  /** Dialogue by friendship tier: 0 = stranger, 1 = friendly, 2 = close. */
  lines: [string[][], string[][], string[][]];
}

export const CAST: VillagerDef[] = [
  {
    id: 'mara',
    name: 'MARA',
    job: 'SHOPKEEPER',
    skin: 2,
    work: 'shop',
    activity: 'work',
    likes: ['pumpkin', 'turnip', 'flower'],
    lines: [
      [
        ['SO YOU TOOK THE OLD PLOT.', 'BRAVE. IT HAS BEEN FALLOW', 'SINCE BEFORE I CAME HERE.'],
        ['SEEDS ARE CHEAP THIS MONTH.', 'THE GROUND WILL TAKE THEM.'],
      ],
      [
        ['YOUR TURNIPS LOOK BETTER', 'THAN THE ONES I SHIP IN.'],
        ['IF THE BOARD HAS WORK ON IT,', 'TAKE IT. THE PAY IS HONEST.'],
      ],
      [
        ['I KEPT THE GOOD SEED BACK', 'FOR YOU. DO NOT TELL ANYONE.'],
        ['MY FATHER RAN THIS SHOP.', 'HE WOULD HAVE LIKED YOU.'],
      ],
    ],
  },
  {
    id: 'brann',
    name: 'BRANN',
    job: 'BLACKSMITH',
    skin: 3,
    work: 'forge',
    activity: 'work',
    likes: ['stone', 'wood'],
    lines: [
      [
        ['MIND THE SPARKS.', 'I DO NOT STOP FOR VISITORS.'],
        ['BRING ME STONE AND I WILL', 'SEE WHAT I CAN DO WITH IT.'],
      ],
      [
        ['YOUR TOOLS ARE HOLDING UP.', 'YOU LOOK AFTER THEM. GOOD.'],
        ['THE MILL WHEEL NEEDS A NEW', 'PIN. HALDER KEEPS PUTTING IT OFF.'],
      ],
      [
        ['I MADE THIS HAMMER AT', 'SIXTEEN. STILL TRUE.'],
        ['ANY IRON YOU FIND, BRING IT.', 'NO CHARGE FOR THE WORK.'],
      ],
    ],
  },
  {
    id: 'halder',
    name: 'HALDER',
    job: 'MILLER',
    skin: 4,
    work: 'mill',
    activity: 'work',
    likes: ['wheat'],
    lines: [
      [
        ['THE WHEEL HAS TURNED SINCE', 'MY GRANDFATHER SET IT.'],
        ['WHEAT IN, FLOUR OUT.', 'SIMPLE ENOUGH LIFE.'],
      ],
      [
        ['GROW ME WHEAT AND I WILL', 'ALWAYS HAVE WORK FOR YOU.'],
        ['THE RIVER IS LOW THIS YEAR.', 'THE WHEEL FEELS IT.'],
      ],
      [
        ['COME UP TO THE LOFT SOMETIME.', 'YOU CAN SEE THE WHOLE VALLEY.'],
      ],
    ],
  },
  {
    id: 'senna',
    name: 'SENNA',
    job: 'FARMER',
    skin: 1,
    work: 'field',
    activity: 'work',
    likes: ['turnip', 'wheat', 'flower'],
    lines: [
      [
        ['NEW HANDS IN THE VALLEY.', 'ABOUT TIME.'],
        ['WATER EVERY DAY. THAT IS THE', 'WHOLE SECRET, REALLY.'],
      ],
      [
        ['YOUR ROWS ARE STRAIGHTER', 'THAN MINE WERE AT THE START.'],
        ['IF THE RAIN COMES YOU GET', 'THE DAY OFF. REMEMBER THAT.'],
      ],
      [
        ['WE SHOULD TAKE A STALL', 'TOGETHER AT THE MARKET.'],
      ],
    ],
  },
  {
    id: 'orin',
    name: 'ORIN',
    job: 'INNKEEPER',
    skin: 0,
    work: 'tavern',
    activity: 'work',
    likes: ['pumpkin'],
    lines: [
      [
        ['A BED AND A HOT MEAL.', 'THAT IS ALL ANYONE NEEDS.'],
        ['STAY OUT OF THE EAST WOODS', 'AFTER DARK. THINGS MOVE THERE.'],
      ],
      [
        ['THE WHOLE TOWN PASSES', 'THROUGH HERE EVENTUALLY.'],
        ['ASK ME ABOUT ANYONE.', 'I WILL KNOW.'],
      ],
      [
        ['FIRST DRINK IS ON THE HOUSE.', 'DO NOT MAKE A HABIT OF IT.'],
      ],
    ],
  },
  {
    id: 'wick',
    name: 'WICK',
    job: 'FISHERMAN',
    skin: 5,
    work: 'river',
    activity: 'work',
    likes: ['pike', 'eel', 'trout', 'wood'],
    lines: [
      [['QUIET. YOU WILL SCARE THEM.'], ['THE BIG ONES SIT UNDER', 'THE BRIDGE AT DUSK.']],
      [['THE RIVER USED TO RUN HIGHER.', 'EVERYONE SAYS SO. NOBODY KNOWS WHY.']],
      [['THERE IS SOMETHING IN THE', 'DEEP POOL PAST THE MILL.', 'I HAVE FELT IT TAKE THE LINE.']],
    ],
  },
  {
    id: 'tessa',
    name: 'TESSA',
    job: 'HERDER',
    skin: 6,
    work: 'paddock',
    activity: 'work',
    likes: ['wheat', 'flower', 'mushroom'],
    lines: [
      [['THE BROWN COW GOT OUT AGAIN.', 'MIND THE GATE.']],
      [['SHEEP ARE SIMPLE COMPANY.', 'I PREFER IT MOST DAYS.']],
      [['COME BY AT SHEARING.', 'I COULD USE THE HANDS.']],
    ],
  },
  {
    id: 'peth',
    name: 'PETH',
    job: 'WANDERER',
    skin: 8,
    work: 'street',
    activity: 'wander',
    likes: ['mushroom', 'stone'],
    lines: [
      [['...'], ['YOU ARE NOT FROM THE VALLEY', 'EITHER. I CAN TELL.']],
      [['I WALKED HERE FROM THE COAST.', 'IT TOOK A SEASON.']],
      [['THE RUINS NORTH OF TOWN', 'ARE OLDER THAN THE TOWN.', 'SOMEONE BUILT THEM. NOT US.']],
    ],
  },
];

export interface Friendship {
  points: number;
  lastTalkDay: number;
  lastGiftDay: number;
  met: boolean;
}

const MAX_HEARTS = 5;
const POINTS_PER_HEART = 20;

export class Social {
  readonly bonds = new Map<string, Friendship>();

  constructor() {
    for (const v of CAST) {
      this.bonds.set(v.id, { points: 0, lastTalkDay: -1, lastGiftDay: -1, met: false });
    }
  }

  get(id: string): Friendship {
    let f = this.bonds.get(id);
    if (!f) {
      f = { points: 0, lastTalkDay: -1, lastGiftDay: -1, met: false };
      this.bonds.set(id, f);
    }
    return f;
  }

  hearts(id: string): number {
    return Math.min(MAX_HEARTS, Math.floor(this.get(id).points / POINTS_PER_HEART));
  }

  tier(id: string): 0 | 1 | 2 {
    const h = this.hearts(id);
    return h >= 4 ? 2 : h >= 2 ? 1 : 0;
  }

  /** Returns the lines to show, and whether this was the day's first chat. */
  talk(def: VillagerDef, day: number): { lines: string[]; fresh: boolean } {
    const f = this.get(def.id);
    const fresh = f.lastTalkDay !== day;
    if (fresh) {
      f.lastTalkDay = day;
      f.points += 4;
    }
    if (!f.met) {
      f.met = true;
      return { lines: def.lines[0][0], fresh };
    }
    const pool = def.lines[this.tier(def.id)];
    return { lines: pool[Math.floor(Math.random() * pool.length)], fresh };
  }

  /** Give an item. Liked items are worth far more, and only once a day. */
  gift(def: VillagerDef, item: string, day: number): { lines: string[]; accepted: boolean } {
    const f = this.get(def.id);
    if (f.lastGiftDay === day) {
      return { lines: ['YOU HAVE ALREADY GIVEN ME', 'SOMETHING TODAY. SAVE IT.'], accepted: false };
    }
    f.lastGiftDay = day;
    if (def.likes.includes(item)) {
      f.points += 25;
      return { lines: ['OH — THIS IS EXACTLY WHAT', 'I WANTED. THANK YOU.'], accepted: true };
    }
    f.points += 8;
    return { lines: ['THAT IS KIND OF YOU.', 'I WILL FIND A USE FOR IT.'], accepted: true };
  }
}

// ---------------------------------------------------------------------------
// The quest board
// ---------------------------------------------------------------------------

export interface Quest {
  id: string;
  from: string;
  title: string;
  brief: string[];
  /** item -> count */
  need: Record<string, number>;
  rewardGold: number;
  rewardFriend: string;
  /** Quests appear in order; each unlocks when the previous is done. */
  done: boolean;
  taken: boolean;
}

/**
 * The quest chain, in order.
 *
 * **This is module state, and `taken`/`done` are written straight onto these
 * objects.** Unlike `Social`, which is rebuilt by `new Social()`, this array
 * lives as long as the page does — so nothing resets it implicitly. Anything
 * that starts a run has to deal with it explicitly at both ends: the save has
 * to store the flags (or the quest chain is lost on reload), and a new game has
 * to call `resetQuests()` (or it inherits the last run's progress). See
 * `game/save.ts`.
 */
export const QUESTS: Quest[] = [
  {
    id: 'firstHarvest',
    from: 'MARA',
    title: 'FIRST HARVEST',
    brief: ['MARA WANTS TO SEE WHETHER', 'THE OLD PLOT STILL GIVES.', 'BRING HER 3 TURNIPS.'],
    need: { turnip: 3 },
    rewardGold: 150,
    rewardFriend: 'mara',
    done: false,
    taken: false,
  },
  {
    id: 'millPin',
    from: 'BRANN',
    title: 'THE MILL PIN',
    brief: ['THE WHEEL PIN IS WORN THROUGH.', 'BRANN NEEDS 8 STONE AND', '5 WOOD TO FORGE A NEW ONE.'],
    need: { stone: 8, wood: 5 },
    rewardGold: 260,
    rewardFriend: 'brann',
    done: false,
    taken: false,
  },
  {
    id: 'winterStore',
    from: 'HALDER',
    title: 'WINTER STORE',
    brief: ['THE MILL STANDS IDLE WITHOUT', 'GRAIN. HALDER ASKS FOR', '10 WHEAT BEFORE THE FROST.'],
    need: { wheat: 10 },
    rewardGold: 400,
    rewardFriend: 'halder',
    done: false,
    taken: false,
  },
  {
    id: 'deepPool',
    from: 'WICK',
    title: 'WHAT TAKES THE LINE',
    brief: [
      'SOMETHING IN THE DEEP POOL',
      'PAST THE MILL KEEPS TAKING',
      "WICK'S LINE. GO AND SEE.",
    ],
    need: { riverking: 1 },
    rewardGold: 500,
    rewardFriend: 'wick',
    done: false,
    taken: false,
  },
  {
    id: 'harvestFeast',
    from: 'ORIN',
    title: 'THE HARVEST FEAST',
    brief: ['ORIN WANTS TO PUT ON A FEAST', 'FOR THE WHOLE VALLEY.', 'HE NEEDS 4 PUMPKINS.'],
    need: { pumpkin: 4 },
    rewardGold: 600,
    rewardFriend: 'orin',
    done: false,
    taken: false,
  },
];

/** Put the board back to day one. Required by NEW GAME; see the note above. */
export function resetQuests(): void {
  for (const q of QUESTS) {
    q.taken = false;
    q.done = false;
  }
}

/** The quest currently on the board: the first one not yet finished. */
export function activeQuest(): Quest | null {
  return QUESTS.find((q) => !q.done) ?? null;
}

export function questProgress(q: Quest, count: (item: string) => number): string[] {
  return Object.entries(q.need).map(([item, n]) => `${item.toUpperCase()} ${Math.min(count(item), n)}/${n}`);
}

/** Where each cast member works. Resolved against the scene's areas. */
export function workArea(kind: VillagerDef['work'], areas: Record<string, Area>): Area {
  return areas[kind] ?? areas.square;
}

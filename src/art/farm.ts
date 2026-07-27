/**
 * Farming art: tilled soil, crop growth stages and tool icons.
 *
 * Soil and crops are drawn on a 16px tile grid so they line up with the farm
 * plot's data grid exactly. Crops are anchored at the bottom centre of their
 * tile, which is what lets a tall plant overhang the tile above it without
 * breaking the y-sort.
 */
import { PixelBuffer, parseArt, rgba, type RGBA } from './pixel';
import { R, type Ramp } from './palette';
import { bakeSheet, type Sheet } from './sheet';
import { hash2 } from '../engine/rng';

export const TILE = 16;

/** Tilled earth: raised furrow ridges running left-right. */
function soilTile(watered: boolean, variant: number): PixelBuffer {
  const b = new PixelBuffer(TILE, TILE);
  const ramp: Ramp = R.dirt;
  // Broken earth, not boards: short offset furrow dashes and scattered clods
  // over a flat base. Continuous full-width ridge lines every few rows read as
  // planking, which is exactly what the first version looked like.
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let step = 1;
      const row = Math.floor(y / 4);
      const dash = Math.floor((x + row * 5) / 6);
      const withinDash = (x + row * 5) % 6;
      if (y % 4 === 0 && withinDash < 4 && hash2(dash, row + variant) > 0.35) step = 2;
      if (y % 4 === 1 && withinDash < 4 && hash2(dash, row + variant) > 0.35) step = 0;
      const h = hash2(x + variant * 31, y);
      if (h > 0.94) step = 2;
      else if (h < 0.06) step = 0;
      let c: RGBA = ramp[step];
      if (watered) {
        // Wet soil is darker and shifts cool.
        c = [Math.round(c[0] * 0.6), Math.round(c[1] * 0.64), Math.round(c[2] * 0.88), 255];
      }
      b.set(x, y, c);
    }
  }
  return b;
}

export type CropKind = 'turnip' | 'pumpkin' | 'wheat';

/** Four growth stages plus a harvested-looking stub. */
const SPROUT = ['..g..', '.ggg.', '..g..', '..s..'];
const YOUNG = ['.g.g.', 'gGgGg', '.gGg.', '..s..', '..s..'];

function cropStage(kind: CropKind, stage: number): PixelBuffer {
  const b = new PixelBuffer(16, 26);
  const cx = 8;
  const baseY = 24;
  const leaf = R.leaf;
  const map = { g: leaf[2], G: leaf[3], s: leaf[1] };

  if (stage === 0) {
    const a = parseArt(SPROUT, map);
    b.blit(a, cx - 2, baseY - 4);
    b.selOutline();
    return b;
  }
  if (stage === 1) {
    const a = parseArt(YOUNG, map);
    b.blit(a, cx - 2, baseY - 5);
    b.selOutline();
    return b;
  }

  // Stage 2+: a bushy plant. Stage 3 carries the crop itself.
  const h = stage === 2 ? 9 : 12;
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 5) * Math.PI;
    b.capsule(cx, baseY - 1, cx + Math.cos(a) * 5, baseY - 1 + Math.sin(a) * h * 0.8, 1.4, i % 2 ? leaf[1] : leaf[2]);
  }
  b.ellipse(cx, baseY - h + 2, 5, 3.4, leaf[2]);
  b.ellipse(cx - 1, baseY - h + 1, 3.6, 2.4, leaf[3]);

  if (stage >= 3) {
    if (kind === 'turnip') {
      b.ellipse(cx, baseY - 3, 4, 3.4, R.purple[3]);
      b.ellipse(cx - 1, baseY - 4, 2.4, 1.8, R.purple[4]);
      b.ellipse(cx, baseY - 1, 3.4, 1.6, R.paper[4]);
    } else if (kind === 'pumpkin') {
      b.ellipse(cx, baseY - 4, 6, 4.4, R.fire[2]);
      b.ellipse(cx - 2, baseY - 5, 3, 2.6, R.fire[3]);
      b.vline(cx - 3, baseY - 7, baseY - 1, R.fire[1]);
      b.vline(cx + 3, baseY - 7, baseY - 1, R.fire[1]);
      b.fillRect(cx - 1, baseY - 10, 2, 3, R.leaf[1]);
    } else {
      for (let i = 0; i < 4; i++) {
        const x = cx - 3 + i * 2;
        b.vline(x, baseY - 13, baseY - 2, R.sand[2]);
        b.fillRect(x - 1, baseY - 16, 3, 4, R.gold[3]);
        b.set(x - 1, baseY - 16, R.gold[4]);
      }
    }
  }
  b.selOutline();
  return b;
}

// ---------------------------------------------------------------------------
// Tool icons — 16x16, drawn for the hotbar and held in hand.
// ---------------------------------------------------------------------------

const TOOL_ART: Record<string, string[]> = {
  hoe: [
    '..........WW....',
    '.........WWW....',
    '........WWW.....',
    '.......WWW......',
    '......WWW.......',
    '.....WWW........',
    '....WWW.........',
    '...WWW..........',
    '..WWW...........',
    '.MMM............',
    'MMMM............',
    'MMM.............',
    '................',
    '................',
    '................',
    '................',
  ],
  can: [
    '................',
    '....MMMMMM......',
    '...MmmmmmmM.....',
    '..MmmmmmmmmM..S.',
    '..MmmmmmmmmM.S..',
    '..MmmmmmmmmMS...',
    '..MmmmmmmmmM....',
    '..MmmmmmmmmM....',
    '...MmmmmmmM.....',
    '....MMMMMM......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  axe: [
    '.........WWWW...',
    '........WWWWWW..',
    '.......WWWWWWW..',
    '......WWWWWWW...',
    '.....WWWWWW.....',
    '....MMM.........',
    '...MMM..........',
    '..MMM...........',
    '.MMM............',
    'MMM.............',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  pick: [
    '..W..........W..',
    '..WW........WW..',
    '...WWW....WWW...',
    '.....WWWWWW.....',
    '.......MM.......',
    '.......MM.......',
    '.......MM.......',
    '.......MM.......',
    '.......MM.......',
    '.......MM.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  scythe: [
    '.....WWWWWW.....',
    '...WW......WW...',
    '..W..........W..',
    '.W..............',
    '................',
    '.......MM.......',
    '......MM........',
    '.....MM.........',
    '....MM..........',
    '...MM...........',
    '..MM............',
    '.MM.............',
    '................',
    '................',
    '................',
    '................',
  ],
  seeds: [
    '................',
    '....SSSSSS......',
    '...SssssssS.....',
    '..SssgsgssS.....',
    '..SsgsgsgsS.....',
    '..SssgsgssS.....',
    '..SsgsgsgsS.....',
    '..SssssssS......',
    '...SSSSSS.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
};

function toolIcon(kind: string, seedColour?: RGBA): PixelBuffer {
  const map: Record<string, RGBA> = {
    W: R.metal[3],
    w: R.metal[4],
    M: R.wood[2],
    m: R.metal[2],
    S: R.sand[2],
    s: R.sand[3],
    // The grain inside a seed packet takes the colour of what it grows into,
    // so three packets side by side in the shop are told apart at a glance.
    g: seedColour ?? R.leaf[2],
  };
  const b = parseArt(TOOL_ART[kind], map);
  const out = new PixelBuffer(16, 16);
  out.blit(b, 0, 0);
  out.selOutline();
  return out;
}

export interface FarmAssets {
  soilDry: Sheet;
  soilWet: Sheet;
  /** [kind][stage] */
  crops: Record<CropKind, Sheet[]>;
  tools: Record<string, Sheet>;
  /** A seed packet per crop, tinted with what it grows. */
  seeds: Record<CropKind, Sheet>;
  seedBag: Sheet;
}

/** The grain colour on each crop's seed packet. */
const SEED_TINT: Record<CropKind, RGBA> = {
  turnip: R.purple[3],
  pumpkin: R.fire[2],
  wheat: R.gold[3],
};

function still(b: PixelBuffer, ax: number, ay: number): Sheet {
  return bakeSheet([b], ax, ay);
}

export function bakeFarm(): FarmAssets {
  const crops = {} as Record<CropKind, Sheet[]>;
  for (const kind of ['turnip', 'pumpkin', 'wheat'] as CropKind[]) {
    crops[kind] = [0, 1, 2, 3].map((st) => still(cropStage(kind, st), 8, 24));
  }
  const tools: Record<string, Sheet> = {};
  for (const k of Object.keys(TOOL_ART)) tools[k] = still(toolIcon(k), 8, 8);
  const seeds = {} as Record<CropKind, Sheet>;
  for (const kind of ['turnip', 'pumpkin', 'wheat'] as CropKind[]) {
    seeds[kind] = still(toolIcon('seeds', SEED_TINT[kind]), 8, 8);
  }
  return {
    soilDry: still(soilTile(false, 1), 0, 0),
    soilWet: still(soilTile(true, 1), 0, 0),
    crops,
    tools,
    seeds,
    seedBag: tools.seeds,
  };
}

void rgba;

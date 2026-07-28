/**
 * Inventory icons.
 *
 * An icon is not a shrunken sprite, and it is not a small painting either. It
 * has one job: be named without reading the label, in a 20px slot, sitting on
 * whatever colour the slot happens to be. So every icon here is built the same
 * way — one big silhouette that fills the frame, a hard 1px dark keyline all
 * the way round it (a sticker edge, not a selective outline: icons have to pop
 * off any background, including the dark hotbar and the pale shop panel), and
 * at most three value steps inside. No 1px speckle, no clusters of same-value
 * shapes touching each other. Detail that survives at 1x is detail that is at
 * least 2px thick.
 *
 * 14x14 because the hotbar scales anything over 16px down, and 12x12 left the
 * shapes too small to hold both a silhouette and a keyline. The art below is
 * authored 12x12 and blitted at (1,1) so the outline has a row to live in.
 */
import { R, type Ramp } from './palette';
import { PixelBuffer, parseArt, type RGBA } from './pixel';
import { bakeSheet, type Sheet } from './sheet';
import { FISH_ART } from './fishing';

const MAP: Record<string, RGBA> = {
  // purple (turnip bulb)
  P: R.purple[3],
  Q: R.purple[4],
  p: R.purple[2],
  // leaf greens
  L: R.leaf[3],
  l: R.leaf[2],
  d: R.leaf[1],
  // fire oranges (pumpkin)
  H: R.fire[4],
  O: R.fire[3],
  r: R.fire[1],
  // gold (wheat ears)
  Y: R.gold[4],
  G: R.gold[3],
  g: R.gold[2],
  // wood browns (logs, twine)
  b: R.wood[4],
  W: R.wood[3],
  w: R.wood[2],
  k: R.wood[1],
  // stone greys
  S: R.stone[3],
  s: R.stone[2],
  z: R.stone[1],
  // red (mushroom cap, flower petals)
  M: R.red[3],
  m: R.red[2],
  // paper whites
  C: R.paper[4],
  c: R.paper[3],
  // sand (straw stems) — a step darker than the ears, or the whole sheaf reads
  // as one pale blob and the tie disappears into it.
  T: R.sand[2],
};

/**
 * 12x12 glyphs, one per stackable. Each one is a single readable object, not a
 * miniature of the world sprite — a turnip in the bag is a fat purple ball with
 * two leaves, whatever the plant in the field looks like.
 */
const ART: Record<string, string[]> = {
  // Fat purple ball, two thick leaves, white root tip.
  turnip: [
    '...LL...LL..',
    '..dLLL.LLLd.',
    '...dLL.LLd..',
    '.....dd.....',
    '..PPPPPPPP..',
    '.PQQPPPPPPP.',
    '.PQQPPPPPPp.',
    '.PPPPPPPppp.',
    '..PPPPPPpp..',
    '...PPPPPp...',
    '....CCCC....',
    '.....CC.....',
  ],
  // Squat and wide — 12 across, 9 tall — with four dark ribs and a thick stem.
  pumpkin: [
    '............',
    '....ldd.....',
    '....ldd.....',
    '...rHHOOr...',
    '.rOrHHOOrOr.',
    'OrOrHHOOrOrO',
    'OrOrOHOOrOrO',
    'OrOrOOOOrOrO',
    '.rOrOOOOrOr.',
    '..OrOOOOrO..',
    '............',
    '............',
  ],
  // A sheaf: three 3px-thick gold ears over darker straw, tied at the waist.
  // The tie is wood, two rows, the lower one near-black — a tie the same value
  // as the straw is not a tie, it is a smudge.
  wheat: [
    '....GGG.....',
    '....YGG.....',
    '.GG.YGG.GG..',
    'YGG.YGG.YGG.',
    'YGG.YGG.YGG.',
    'GGg.GGg.GGg.',
    '.Gg.GGg.Gg..',
    '..TTTTTTT...',
    '...wwwww....',
    '...kkkkk....',
    '...TTTTT....',
    '..TT.T.TT...',
  ],
  // Two logs stacked and offset. Each end face is a 5px disc — pale sapwood
  // rim, a ring inside it, dark pith — because the end grain is the only thing
  // that separates a log from a plank at this size.
  wood: [
    '............',
    '.bbb.kkkkkk.',
    'bWWWbWWWWWW.',
    'bWkWbwwwwww.',
    'bWWWbwwwwww.',
    '.bbb.kkkkkk.',
    '..bbb.kkkkkk',
    '.bWWWbWWWWWW',
    '.bWkWbwwwwww',
    '.bWWWbwwwwww',
    '..bbb.kkkkkk',
    '............',
  ],
  // One boulder lit from the left with its whole right half in shadow, and a
  // pebble at its foot. The 1px gap between them becomes a keyline.
  stone: [
    '...SSSSS....',
    '..SSSSSSSs..',
    '.SSSSSSSsszz',
    '.SSSSSSsszzz',
    '.SSSSSszzzzz',
    '.SSSSszzzzzz',
    '..SSSszzzzz.',
    '...sssszzz..',
    'SSs.........',
    'SSSs........',
    'SSSss.......',
    '.Sszz.......',
  ],
  // A bound bundle, not loose blades. The fan is one solid mass with three
  // notched tips; loose 1px strands read as a spider, which is what the first
  // pass looked like.
  fibre: [
    '.....LL.....',
    '..LL.LL.LL..',
    '.LLL.LL.LLL.',
    '.LLLLLLLLLL.',
    '.lLLLLLLLLl.',
    '..lLLLLLLl..',
    '..llLLLLll..',
    '...llLLll...',
    '...wwwwww...',
    '...kkkkkk...',
    '..dd.dd.dd..',
    '............',
  ],
  // Storybook toadstool: red cap over two thirds of the height, 2x2 white
  // spots (a 1px spot is dirt, not a spot), white stalk.
  mushroom: [
    '...MMMMMM...',
    '.MMMMMMCCMM.',
    'MMCCMMMCCMMM',
    'MMCCMMMMMMMM',
    'MMMMMCCMMMMM',
    '.MMMMCCMMMM.',
    '..mmmmmmmm..',
    '....CCcc....',
    '....CCcc....',
    '....CCcc....',
    '...CCCccc...',
    '............',
  ],
  // One big bloom, 11px across, five petals cut by notches at the shoulders
  // and the hem, gold eye, short stem with a leaf.
  flower: [
    '....MMM.....',
    '.MM.MMM.MM..',
    'MMMmMMMmMMM.',
    'MMMMMMMMMMM.',
    'MMMMYYYMMMM.',
    '.MMMYGYMMM..',
    '.MMMYYYMMm..',
    'MMMmMMMmmmm.',
    '.MMMM.mmmm..',
    '..MM...mm...',
    '.......ll...',
    '....LLlll...',
  ],
};

/** Icon frame size: 12x12 of art plus a row of keyline on every side. */
const ICON = 14;

/**
 * A fish reduced to its glyph: deep forked tail, oval body, one big eye. The
 * species keeps its ramp, so the pike is still green and the carp still gold in
 * the bag. 15x9 — long enough that the fork reads as a fork rather than as a
 * frayed end.
 */
function fishGlyph(ramp: Ramp): PixelBuffer {
  const b = new PixelBuffer(15, 9);
  // Tail first: two lobes spreading to the full depth of the frame, meeting at
  // a pinched peduncle. This is the shape that says "fish" before the body does.
  b.vline(1, 1, 2, ramp[2]);
  b.vline(1, 6, 7, ramp[2]);
  b.vline(2, 2, 3, ramp[2]);
  b.vline(2, 5, 6, ramp[2]);
  b.vline(3, 3, 5, ramp[1]);
  b.vline(4, 2, 6, ramp[2]);
  // Body: one solid oval, then two flat bands — dark back, pale belly.
  b.ellipse(9, 4, 4.4, 2.6, ramp[3]);
  b.hline(6, 10, 1, ramp[2]);
  b.hline(6, 12, 2, ramp[2]);
  b.hline(6, 12, 6, ramp[4]);
  b.hline(8, 10, 7, ramp[4]);
  // Eye: 2x2 with a highlight, so it survives at 1x.
  b.fillRect(10, 3, 2, 2, R.night[0]);
  b.set(10, 3, R.paper[4]);
  // Mouth notch at the snout.
  b.set(13, 5, ramp[1]);
  b.outline(R.night[0]);
  return b;
}

export function bakeIcons(): Record<string, Sheet> {
  const icons: Record<string, Sheet> = {};
  for (const [id, rows] of Object.entries(ART)) {
    const b = new PixelBuffer(ICON, ICON);
    b.blit(parseArt(rows, MAP), 1, 1);
    b.outline(R.night[0]);
    icons[id] = bakeSheet([b], ICON / 2, ICON / 2);
  }
  for (const [id, art] of Object.entries(FISH_ART)) {
    const b = fishGlyph(art.ramp);
    icons[id] = bakeSheet([b], Math.round(b.w / 2), Math.round(b.h / 2));
  }
  return icons;
}

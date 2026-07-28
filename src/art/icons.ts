/**
 * Inventory icons.
 *
 * An icon is not a shrunken sprite. A 26px crop plant scaled into a 20px slot
 * turns into unreadable mush, and every sheet's anchor lands somewhere
 * different, so nothing even sits in the middle of its slot. Icons are their
 * own drawings: 12x12, one silhouette each, drawn at the size they are shown,
 * centre-anchored so the hotbar and shop can place them with one rule.
 */
import { R, type Ramp } from './palette';
import { PixelBuffer, parseArt, type RGBA } from './pixel';
import { bakeSheet, type Sheet } from './sheet';
import { FISH_ART } from './fishing';

const MAP: Record<string, RGBA> = {
  // purple (turnip)
  P: R.purple[3],
  Q: R.purple[4],
  // leaf greens
  L: R.leaf[3],
  l: R.leaf[2],
  d: R.leaf[1],
  // fire oranges (pumpkin)
  O: R.fire[3],
  o: R.fire[2],
  r: R.fire[1],
  // gold (wheat)
  G: R.gold[3],
  Y: R.gold[4],
  g: R.gold[2],
  // wood browns
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
  // sand (stems)
  T: R.sand[3],
};

/** 12x12, one glyph per stackable. Drawn to read at 1x in a 20px slot. */
const ART: Record<string, string[]> = {
  turnip: [
    '....L..L....',
    '...dL.Ld....',
    '....LdL.....',
    '...PPPPP....',
    '..PQQPPPP...',
    '..PQPPPPP...',
    '..PPPPPPP...',
    '...PPPPP....',
    '....CCC.....',
    '.....C......',
    '............',
    '............',
  ],
  pumpkin: [
    '.....dd.....',
    '.....d......',
    '..oOOOOOo...',
    '.oOrOOOrOo..',
    '.OOrOOOrOO..',
    '.OOrOOOrOO..',
    '.oOrOOOrOo..',
    '..oOOOOOo...',
    '...ooooo....',
    '............',
    '............',
    '............',
  ],
  wheat: [
    '...G..Y.....',
    '..GYG.G.Y...',
    '..GG.GYG.G..',
    '...G.GG.GG..',
    '...T..T.T...',
    '....T.T.T...',
    '....T.TT....',
    '.....TT.....',
    '.....T......',
    '............',
    '............',
    '............',
  ],
  wood: [
    '............',
    '..kkkkkkkW..',
    '..wwwwwwwW..',
    '..kkkkkkkk..',
    '.Wkkkkkkk...',
    '.Wwwwwwww...',
    '.kkkkkkkk...',
    '............',
    '............',
    '............',
    '............',
    '............',
  ],
  stone: [
    '............',
    '....sss.....',
    '..ssSSSs....',
    '.sSSSSSSs...',
    '.sSSSSSSSz..',
    '.zSSSSSSz...',
    '..zzSSzz....',
    '...zzzz.....',
    '............',
    '............',
    '............',
    '............',
  ],
  fibre: [
    '............',
    '..L...l..L..',
    '..l.L.L.l...',
    '...l.Ll.l...',
    '...dl.l.d...',
    '....dLld....',
    '.....Ll.....',
    '............',
    '............',
    '............',
    '............',
    '............',
  ],
  mushroom: [
    '....MMMM....',
    '..MMCMMMM...',
    '..MMMMMCM...',
    '.MMCMMMMMM..',
    '..mmmmmmm...',
    '.....CC.....',
    '.....CC.....',
    '....cCCc....',
    '............',
    '............',
    '............',
    '............',
  ],
  flower: [
    '....C.C.....',
    '...CCMCC....',
    '....MGM.....',
    '...CCMCC....',
    '....C.C.....',
    '.....l......',
    '....Ll......',
    '.....l......',
    '............',
    '............',
    '............',
    '............',
  ],
};

/**
 * A fish reduced to its glyph: oval body, forked tail, eye. The species keeps
 * its ramp, so the pike is still green and the carp still gold in the bag.
 */
function fishGlyph(ramp: Ramp): PixelBuffer {
  const b = new PixelBuffer(13, 9);
  // Forked tail on the left.
  b.vline(2, 2, 3, ramp[2]);
  b.vline(2, 5, 6, ramp[2]);
  b.vline(3, 3, 5, ramp[1]);
  // Body: back dark, flank mid, belly light.
  b.ellipse(8, 4, 4.4, 2.6, ramp[3]);
  b.hline(5, 10, 3, ramp[2]);
  b.hline(5, 10, 6, ramp[4]);
  // Eye and mouth tip.
  b.set(10, 3, R.night[0]);
  b.set(12, 5, ramp[1]);
  b.selOutline();
  return b;
}

export function bakeIcons(): Record<string, Sheet> {
  const icons: Record<string, Sheet> = {};
  for (const [id, rows] of Object.entries(ART)) {
    const b = new PixelBuffer(12, 12);
    b.blit(parseArt(rows, MAP), 0, 0);
    b.selOutline();
    icons[id] = bakeSheet([b], 6, 6);
  }
  for (const [id, art] of Object.entries(FISH_ART)) {
    const b = fishGlyph(art.ramp);
    icons[id] = bakeSheet([b], Math.round(b.w / 2), Math.round(b.h / 2));
  }
  return icons;
}

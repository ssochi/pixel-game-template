/**
 * Speech and thought bubbles.
 *
 * A villager standing still is furniture; a villager standing still with a
 * bubble over their head is doing something. These are the cheapest possible
 * readable behaviour — five 13x12 sprites — and they carry the whole "the town
 * is alive" read from across the screen.
 */
import { PixelBuffer, parseArt } from './pixel';
import { R } from './palette';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';

export type EmoteKind = 'talk' | 'idea' | 'sleep' | 'work' | 'note' | 'buy';

/** `W` bubble fill, `.` transparent, `k` glyph ink, plus per-emote accents. */
const BODY = [
  '.WWWWWWWWW.',
  'WWWWWWWWWWW',
  'WWWWWWWWWWW',
  'WWWWWWWWWWW',
  'WWWWWWWWWWW',
  '.WWWWWWWWW.',
  '..WW.......',
  '.W.........',
];

const GLYPHS: Record<EmoteKind, string[]> = {
  // three dots
  talk: ['...........', '..k..k..k..', '...........'],
  // exclamation / bulb
  idea: ['....k......', '....k......', '....k......'],
  // Z
  sleep: ['..kkkkk....', '....kk.....', '..kkkkk....'],
  // hammer
  work: ['..kkkk.....', '....k......', '....k......'],
  // musical note
  note: ['.....kk....', '...kkk.....', '...kk......'],
  // coin
  buy: ['...kkkk....', '...k..k....', '...kkkk....'],
};

function bubble(kind: EmoteKind, flip: boolean): PixelBuffer {
  const map = {
    W: R.paper[4],
    k: kind === 'sleep' ? R.metal[1] : kind === 'buy' ? R.gold[1] : R.night[1],
  };
  const b = parseArt(BODY, map);
  const glyph = parseArt(GLYPHS[kind], map);
  const out = new PixelBuffer(13, 12);
  out.blit(b, 1, 1, { flipX: flip });
  out.blit(glyph, 1, 3);
  out.selOutline(0.85, 0.7);
  return out;
}

export interface EmoteAssets {
  sheet: Sheet;
  /** kind -> frame index (two frames each: bubble tail left / right). */
  index: Record<EmoteKind, number>;
  clipOf(kind: EmoteKind, flip: boolean): Clip;
}

export function bakeEmotes(): EmoteAssets {
  const kinds: EmoteKind[] = ['talk', 'idea', 'sleep', 'work', 'note', 'buy'];
  const frames: PixelBuffer[] = [];
  const index = {} as Record<EmoteKind, number>;
  for (const k of kinds) {
    index[k] = frames.length;
    frames.push(bubble(k, false));
    frames.push(bubble(k, true));
  }
  const sheet = bakeSheet(frames, 6, 13);
  return {
    sheet,
    index,
    clipOf(kind, flip) {
      return clip(sheet, [index[kind] + (flip ? 1 : 0)], 1);
    },
  };
}

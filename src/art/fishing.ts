/**
 * Fish, float and rod.
 *
 * A fish at this scale is four shapes — body, tail, fin, eye — and the whole
 * character of a species lives in the proportions between them, not in detail.
 * A chub is a fat short oval; a pike is long and shallow; a trout sits between
 * them with spots. So the drawing is parametric: one function takes a length,
 * a depth, a colour and a marking, and the species table does the rest. That
 * keeps every fish on the same palette and the same outline treatment, which
 * is what makes a row of them read as one set.
 *
 * The float is animated rather than static: three frames of bob for the wait,
 * and a fourth pulled under for the bite. That single sunk frame is the whole
 * "you have one" signal, so it is drawn as a much bigger change than the bob.
 */
import { R, type Ramp } from './palette';
import { PixelBuffer, parseArt, type RGBA } from './pixel';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';
import { hash2 } from '../engine/rng';

export type Marking = 'plain' | 'spots' | 'stripes' | 'gold';

export interface FishArt {
  /** Nose-to-tail length in px, including the tail fin. */
  len: number;
  /** Body depth at the thickest point. */
  depth: number;
  ramp: Ramp;
  marking: Marking;
}

/**
 * Side view, nose pointing right. The body is an ellipse squashed towards the
 * tail, which is what stops every fish reading as a rugby ball.
 */
function drawFish(art: FishArt, seed: number): PixelBuffer {
  const pad = 3;
  const w = art.len + pad * 2;
  const h = art.depth + 10;
  const b = new PixelBuffer(w, h);
  const cy = Math.round(h / 2);
  const nose = pad + art.len - 1;
  const tailX = pad + 4;
  const ramp = art.ramp;

  // Caudal fin. Drawn as a *forked* tail, not a solid wedge: the first version
  // filled the whole triangle and read as a detached rectangle stuck to the
  // back of the fish. The notch that opens up as the fin spreads is the entire
  // difference between "fish" and "block with an eye".
  const tailLen = 4;
  for (let i = 0; i <= tailLen; i++) {
    const k = i / tailLen;
    const spread = Math.max(1, Math.round(1 + k * art.depth * 0.55));
    // The notch cuts in from the trailing edge, so the fin only splits at the
    // tip and stays joined where it meets the body.
    const notch = Math.round(k * k * art.depth * 0.34);
    const c = i === tailLen ? ramp[2] : ramp[1];
    if (notch <= 0) {
      b.vline(tailX - i, cy - spread, cy + spread, c);
    } else {
      b.vline(tailX - i, cy - spread, cy - notch, c);
      b.vline(tailX - i, cy + notch, cy + spread, c);
    }
  }

  // Body. Sampling the ellipse per column lets the profile taper towards the
  // tail instead of being symmetric about the centre.
  for (let x = tailX; x <= nose; x++) {
    const t = (x - tailX) / Math.max(1, nose - tailX); // 0 at tail, 1 at nose
    // Fat just behind the head, tapering hard to the peduncle.
    const profile = Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.98 + t * 0.06;
    const half = Math.max(1, Math.round((art.depth / 2) * profile));
    for (let dy = -half; dy <= half; dy++) {
      const v = dy / half; // -1 top, +1 belly
      // Lit from above: back is dark, flank mid, belly pale.
      const step = v < -0.45 ? 1 : v < 0.15 ? 2 : v < 0.62 ? 3 : 4;
      let c: RGBA = ramp[step];
      if (art.marking === 'spots' && hash2(x * 3 + seed, dy * 7 + seed) > 0.86 && v < 0.3) {
        c = ramp[0];
      } else if (art.marking === 'stripes' && (x + seed) % 6 < 2 && v < 0.35) {
        c = ramp[1];
      } else if (art.marking === 'gold' && v > -0.5 && v < 0.3 && (x + dy + seed) % 5 === 0) {
        c = R.gold[3];
      }
      b.set(x, cy + dy, c);
    }
  }

  // Dorsal fin on the back, anal fin under the belly, both set behind centre.
  const midX = Math.round(tailX + (nose - tailX) * 0.52);
  const finTop = Math.max(1, Math.round(art.depth * 0.3));
  for (let i = 0; i < 6; i++) {
    const x = midX - 2 + i;
    if (x >= nose - 1) break;
    const up = Math.round(finTop * Math.sin(((i + 0.5) / 6) * Math.PI));
    const half = Math.max(1, Math.round((art.depth / 2) * 0.9));
    b.vline(x, cy - half - up, cy - half, ramp[1]);
  }
  for (let i = 0; i < 4; i++) {
    const x = midX - 1 + i;
    const half = Math.max(1, Math.round((art.depth / 2) * 0.72));
    b.vline(x, cy + half, cy + half + Math.round(finTop * 0.45), ramp[1]);
  }
  // Pectoral fin: a short dab low on the flank near the head.
  b.capsule(nose - 6, cy + 1, nose - 9, cy + 3, 0.8, ramp[1]);

  // Gill line and eye.
  b.vline(nose - 5, cy - Math.round(art.depth * 0.3), cy + Math.round(art.depth * 0.28), ramp[1]);
  b.set(nose - 3, cy - 1, R.night[0]);
  b.set(nose - 2, cy - 1, R.paper[4]);
  // Mouth.
  b.set(nose, cy + 1, ramp[1]);

  b.selOutline();
  return b;
}

// ---------------------------------------------------------------------------
// The float
// ---------------------------------------------------------------------------

const FLOAT_ART = [
  '..rr..',
  '.rRRr.',
  '.rRRr.',
  '.wwww.',
  '..ww..',
  '..ss..',
];

function floatFrame(sink: number): PixelBuffer {
  const b = new PixelBuffer(10, 12);
  const map: Record<string, RGBA> = {
    r: R.red[1],
    R: R.red[3],
    w: R.paper[4],
    s: R.paper[2],
  };
  const a = parseArt(FLOAT_ART, map);
  // `sink` is how many rows of the float are under water. The ring of ripple
  // widens as it goes down, so a pulled-under float reads as a strike and not
  // just as a sprite one pixel lower.
  const top = 2 + sink;
  b.blit(a, 2, top);
  const ry = top + 4;
  const rw = 3 + sink;
  b.hline(5 - rw, 4 + rw, ry, R.water[4]);
  if (sink > 0) {
    b.hline(5 - rw - 1, 4 + rw + 1, ry + 1, R.water[3]);
  }
  // Erase whatever sank below the waterline.
  for (let y = ry + 1; y < b.h; y++) for (let x = 0; x < b.w; x++) if (y > ry + 1) b.set(x, y, [0, 0, 0, 0]);
  b.selOutline();
  return b;
}

/**
 * The strike marker: a hard "!" over the float. Deliberately not the ordinary
 * speech bubble — a bite is a reflex prompt, so it wants a shape you can read
 * without parsing it, in the alarm colour nothing else on screen uses.
 */
const ALERT_ART = [
  '..bbbbb..',
  '.bbwwwbb.',
  'bbwwwwwbb',
  'bwwrrrwwb',
  'bwwrrrwwb',
  'bwwrrrwwb',
  'bwwrrrwwb',
  'bwwwwwwwb',
  'bwwwwwwwb',
  'bwwrrrwwb',
  'bwwrrrwwb',
  'bbwwwwwbb',
  '.bbwwwbb.',
  '..bbbbb..',
  '...bb....',
  '..bb.....',
];

function alertMark(): PixelBuffer {
  return parseArt(ALERT_ART, {
    b: R.night[0],
    w: R.paper[4],
    r: R.red[3],
  });
}

// ---------------------------------------------------------------------------
// The rod, drawn in the hotbar and held while casting
// ---------------------------------------------------------------------------

const ROD_ART = [
  '..............ww',
  '.............ww.',
  '............ww..',
  '...........ww...',
  '..........ww....',
  '.........ww.....',
  '........ww......',
  '.......ww.......',
  '......ww........',
  '.....MM.........',
  '....MM..........',
  '...MM...........',
  '..MM............',
  '.CC.............',
  'CC..............',
  '................',
];

function rodIcon(): PixelBuffer {
  const b = parseArt(ROD_ART, {
    w: R.sand[3],
    M: R.wood[2],
    C: R.metal[3],
  });
  const out = new PixelBuffer(16, 16);
  out.blit(b, 0, 0);
  out.selOutline();
  return out;
}

// ---------------------------------------------------------------------------

export interface FishingAssets {
  /** Species id -> a single still frame. */
  fish: Record<string, Sheet>;
  rod: Sheet;
  /** 3 bobbing frames; frame 3 is the sunk "bite" pose. */
  float: Clip;
  floatBite: Clip;
  /** Flashing "!" shown over the float during the strike window. */
  alert: Clip;
}

export const FISH_ART: Record<string, FishArt> = {
  minnow: { len: 13, depth: 6, ramp: R.teal, marking: 'plain' },
  chub: { len: 17, depth: 11, ramp: R.sand, marking: 'plain' },
  perch: { len: 19, depth: 10, ramp: R.leaf, marking: 'stripes' },
  trout: { len: 23, depth: 10, ramp: R.purple, marking: 'spots' },
  pike: { len: 30, depth: 9, ramp: R.grass, marking: 'stripes' },
  carp: { len: 25, depth: 14, ramp: R.gold, marking: 'plain' },
  eel: { len: 32, depth: 5, ramp: R.dirt, marking: 'stripes' },
  riverking: { len: 36, depth: 15, ramp: R.magic, marking: 'gold' },
};

export function bakeFishing(): FishingAssets {
  const fish: Record<string, Sheet> = {};
  let seed = 3;
  for (const [id, art] of Object.entries(FISH_ART)) {
    const b = drawFish(art, (seed += 17));
    fish[id] = bakeSheet([b], Math.round(b.w / 2), Math.round(b.h / 2));
  }
  const bob = [floatFrame(0), floatFrame(1), floatFrame(0), floatFrame(1)];
  const floatSheet = bakeSheet([...bob, floatFrame(4)], 5, 8);
  // Two frames: the mark and nothing, so it blinks rather than sits there.
  const mark = alertMark();
  const blank = new PixelBuffer(mark.w, mark.h);
  const alertSheet = bakeSheet([mark, blank], Math.round(mark.w / 2), mark.h);
  return {
    fish,
    rod: bakeSheet([rodIcon()], 8, 8),
    float: clip(floatSheet, [0, 1, 2, 3], 3),
    floatBite: clip(floatSheet, [4, 3], 9),
    alert: clip(alertSheet, [0, 0, 0, 1], 9),
  };
}

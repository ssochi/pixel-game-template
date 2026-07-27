/**
 * Palette: hue-shifted ramps, and nothing else.
 *
 * Two rules drive everything here, and they are the difference between art
 * that reads as pixel art and art that reads as a low-res photo:
 *
 *  1. **Hue shifting.** A shadow is not "the colour, but darker" — it is lit by
 *     ambient sky, so it shifts towards blue-violet. A highlight is lit by a
 *     warm key light, so it shifts towards yellow. Every ramp below rotates its
 *     hue along the value axis instead of just scaling brightness, which is
 *     what keeps dark tones from going muddy and grey.
 *
 *  2. **A closed set of colours.** Assets may only paint with these swatches.
 *     Continuous blending invents hundreds of near-identical colours that blur
 *     into each other at 1px; `quantize()` in `pixel.ts` snaps every baked
 *     sprite back onto this list so that can't happen by accident.
 *
 * Ramps run dark -> light, 5 steps each. Index 0 is the shadow/outline tone,
 * 2 is the base colour, 4 is the highlight.
 */

export type RGBA = [number, number, number, number];

// --- HSL plumbing ----------------------------------------------------------

function hsl(h: number, s: number, l: number): RGBA {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), 255];
}

/** Rotate `from` towards `to` by `amount` degrees along the shorter arc. */
function towards(from: number, to: number, amount: number): number {
  let d = ((to - from + 540) % 360) - 180;
  const step = Math.sign(d) * Math.min(Math.abs(d), amount);
  return from + step;
}

/** Shadows drift towards this; highlights drift towards WARM. */
const COOL = 250;
const WARM = 48;

/** Degrees of hue rotation per ramp step, dark -> light. */
const SHIFT = [30, 17, 0, 13, 24];
/** Saturation multiplier per step: peaks just below the middle. */
const SAT = [0.92, 1.0, 1.0, 0.84, 0.6];
const LIT = [0.16, 0.28, 0.42, 0.58, 0.76];

export type Ramp = readonly [RGBA, RGBA, RGBA, RGBA, RGBA];

interface RampOpts {
  lit?: number[];
  /** Per-step saturation multipliers; defaults to a mid-peaked curve. */
  sat?: number[];
  shiftScale?: number;
}

function makeRamp(hue: number, sat: number, opts: RampOpts = {}): Ramp {
  const lit = opts.lit ?? LIT;
  const satCurve = opts.sat ?? SAT;
  const shiftScale = opts.shiftScale ?? 1;
  const out = LIT.map((_, i) => {
    const target = i < 2 ? COOL : i > 2 ? WARM : hue;
    const h = towards(hue, target, SHIFT[i] * shiftScale);
    return hsl(h, Math.min(1, sat * satCurve[i]), lit[i]);
  });
  return out as unknown as Ramp;
}

// --- The ramps -------------------------------------------------------------

const DARKER = [0.1, 0.19, 0.3, 0.44, 0.6];
const BRIGHT = [0.3, 0.45, 0.58, 0.72, 0.88];
const FLAT = [0.22, 0.33, 0.45, 0.58, 0.73];
/** Emissive materials keep their saturation at the bright end instead of
 *  washing out to white — otherwise flames read as pale grey blobs. */
const HOT_SAT = [1, 1, 1, 0.98, 0.92];

export const R = {
  /**
   * Ground cover. Deliberately duller and darker than foliage: it is the
   * largest surface on screen, so if it is as saturated as the props, nothing
   * standing on it reads.
   */
  grass: makeRamp(104, 0.3, { lit: [0.15, 0.22, 0.3, 0.39, 0.5] }),
  leaf: makeRamp(112, 0.42, { lit: [0.14, 0.23, 0.33, 0.45, 0.58] }),
  dirt: makeRamp(28, 0.32, { lit: [0.15, 0.22, 0.31, 0.41, 0.54] }),
  sand: makeRamp(42, 0.34, { lit: [0.24, 0.34, 0.45, 0.56, 0.68] }),
  stone: makeRamp(226, 0.1, { lit: FLAT }),
  wood: makeRamp(26, 0.42),
  metal: makeRamp(218, 0.14, { lit: FLAT }),
  gold: makeRamp(44, 0.72, { lit: BRIGHT, sat: HOT_SAT }),
  skin: makeRamp(24, 0.5, { lit: [0.24, 0.38, 0.55, 0.7, 0.84] }),
  hair: makeRamp(22, 0.44, { lit: DARKER }),
  teal: makeRamp(192, 0.44),
  red: makeRamp(4, 0.58, { sat: HOT_SAT }),
  purple: makeRamp(272, 0.4),
  water: makeRamp(203, 0.52, { lit: [0.18, 0.27, 0.37, 0.5, 0.68] }),
  fire: makeRamp(22, 0.95, { lit: [0.32, 0.44, 0.53, 0.63, 0.76], sat: HOT_SAT }),
  magic: makeRamp(188, 0.76, { lit: BRIGHT, sat: HOT_SAT }),
  blood: makeRamp(354, 0.55, { lit: DARKER, sat: HOT_SAT }),
  /** Neutral darks: outlines, night ambient, cast shadow. */
  night: makeRamp(236, 0.26, { lit: [0.06, 0.11, 0.17, 0.26, 0.38] }),
  /** Off-white — never use pure #fff, it burns next to everything else. */
  paper: makeRamp(44, 0.14, { lit: [0.5, 0.62, 0.74, 0.85, 0.94] }),
} satisfies Record<string, Ramp>;

export type RampName = keyof typeof R;

/**
 * Named swatches. These are all *indices into the ramps above* — no asset
 * defines a colour of its own, which is what makes a procedurally generated
 * set still look like it was drawn by one person.
 */
export const P = {
  ink: R.night[0],
  inkSoft: R.night[1],
  shadow: R.night[0],

  skin: R.skin[3],
  skinMid: R.skin[2],
  skinDark: R.skin[1],

  hair: R.hair[2],
  hairDark: R.hair[0],
  hairLight: R.hair[3],

  coat: R.teal[2],
  coatLight: R.teal[3],
  coatDark: R.teal[1],
  scarf: R.red[2],
  scarfDark: R.red[1],
  pants: R.night[3],
  pantsDark: R.night[2],
  boot: R.wood[1],
  bootDark: R.wood[0],

  steel: R.metal[3],
  steelDark: R.metal[1],
  steelLight: R.metal[4],
  gold: R.gold[3],
  goldDark: R.gold[1],
  copper: R.wood[3],

  wood: R.wood[2],
  woodLight: R.wood[3],
  woodDark: R.wood[1],
  woodPale: R.wood[4],

  stone: R.stone[2],
  stoneLight: R.stone[3],
  stoneDark: R.stone[1],
  stoneDeep: R.stone[0],
  moss: R.leaf[1],

  dirt: R.dirt[2],
  dirtDark: R.dirt[1],
  sand: R.sand[3],
  sandDark: R.sand[2],

  leaf: R.leaf[2],
  leafLight: R.leaf[3],
  leafDark: R.leaf[1],
  leafDeep: R.leaf[0],
  flowerA: R.red[3],
  flowerB: R.gold[4],
  flowerC: R.purple[3],

  water: R.water[2],
  waterDeep: R.water[1],
  waterLight: R.water[3],
  waterFoam: R.water[4],

  fire: R.fire[3],
  fireHot: R.fire[4],
  fireDeep: R.fire[1],
  magic: R.magic[3],
  magicDeep: R.magic[1],
  blood: R.blood[2],
  bloodDark: R.blood[0],

  white: R.paper[4],
  ui: R.stone[4],
  uiDim: R.stone[2],
} satisfies Record<string, RGBA>;

export type PaletteKey = keyof typeof P;

/** Every swatch, for the sprite quantiser. */
export const ALL_COLORS: RGBA[] = (() => {
  const seen = new Set<number>();
  const out: RGBA[] = [];
  for (const ramp of Object.values(R)) {
    for (const c of ramp) {
      const k = (c[0] << 16) | (c[1] << 8) | c[2];
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
})();

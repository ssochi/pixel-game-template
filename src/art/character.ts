/**
 * Humanoid character baker.
 *
 * The body is a tiny skeleton (hip, shoulder, head, two arms, two legs) rendered
 * with pixel capsules, and every animation is a function returning a Pose per
 * frame — so idle / walk / run / attack / death / tool swings all share one
 * drawing routine and stay on-model.
 *
 * Frame layout: 32x36, anchor at the feet (16, 30).
 *
 * Proportions (30px of visible figure, measured from the anchor up):
 *
 *   y  0..10  head, 11px including hair   (hand-authored bitmap)
 *   y  11     neck, 1px of bright skin — the value break that keeps the head
 *             from welding onto the collar
 *   y  12..20 torso, 9px, belt on the last row
 *   y  21..29 legs, 9px: 6 of trouser, 3 of boot
 *
 * The three views are *drawn differently*, not just re-eyed. A profile is a
 * narrower body (7-8px against the front view's 9), one shoulder, one visible
 * arm, no chest strap, and a hand-pointed face with a nose bump — drawing a
 * front torso and moving the eye to one side is what makes a sprite read as
 * "head facing one way, body facing another".
 */
import { PixelBuffer, parseArt, rgba, shade, type RGBA } from './pixel';
import { P, R, type Ramp } from './palette';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';

export const FRAME_W = 32;
export const FRAME_H = 36;
export const ANCHOR_X = 16;
export const ANCHOR_Y = 30;

const TAU = Math.PI * 2;

/** Bottom pixel row of the feet. The anchor row itself is the floor. */
const GROUND = ANCHOR_Y - 1;
/** Hip / belt row when standing at rest. */
const HIP_Y = GROUND - 9;
/** Rows spanned by the torso, shoulder row to belt row inclusive. */
const TORSO_ROWS = 9;

/** 0 = facing camera, 1 = facing right (mirror for left), 2 = facing away. */
export type Dir = 0 | 1 | 2;

export interface Skin {
  skin: RGBA;
  skinDark: RGBA;
  hair: RGBA;
  hairDark: RGBA;
  coat: RGBA;
  coatLight: RGBA;
  coatDark: RGBA;
  accent: RGBA;
  accentDark: RGBA;
  pants: RGBA;
  pantsDark: RGBA;
  boot: RGBA;
  bootDark: RGBA;
  ink: RGBA;
  /** Draws a hood instead of hair, and hides the face. */
  hooded?: boolean;
  scarf?: boolean;
  cape?: boolean;
  /** A flared coat below the belt that swings with the stride. */
  coatTail?: boolean;
}

/**
 * Boots are picked from a *different colour family* than the trousers on
 * purpose. Trousers, boots and the cast shadow used to all sit in the bottom
 * two swatches of the ramp, so the legs merged into one dark blob and the
 * stride was invisible. Warm mid-brown leather over cool dark cloth (or the
 * reverse where the trousers are already warm) puts a hue *and* a value break
 * at the ankle without either tone leaving the palette.
 */
const BOOT_LEATHER = { boot: R.wood[2], bootDark: R.wood[1] };
const BOOT_DARK = { boot: R.night[3], bootDark: R.night[2] };

export const HERO_SKIN: Skin = {
  skin: P.skin,
  skinDark: P.skinMid,
  hair: P.hair,
  hairDark: P.hairDark,
  coat: P.coat,
  coatLight: P.coatLight,
  coatDark: P.coatDark,
  accent: P.scarf,
  accentDark: P.scarfDark,
  pants: R.night[3],
  pantsDark: R.night[2],
  ...BOOT_LEATHER,
  ink: P.ink,
  scarf: true,
  coatTail: true,
};

export const ROGUE_SKIN: Skin = {
  skin: P.skin,
  skinDark: P.skinMid,
  hair: P.hairDark,
  hairDark: R.hair[0],
  coat: R.purple[2],
  coatLight: R.purple[3],
  coatDark: R.purple[1],
  accent: P.gold,
  accentDark: P.goldDark,
  pants: R.night[3],
  pantsDark: R.night[2],
  ...BOOT_LEATHER,
  ink: P.ink,
  hooded: true,
  cape: true,
  coatTail: true,
};

/**
 * Townsfolk. Same rig, different cloth — which is the point of building the
 * character as a parametric skeleton in the first place: a new villager costs
 * eight colours, not a sprite sheet.
 */
function villager(
  coat: Ramp,
  pants: Ramp,
  accent: Ramp,
  hair: Ramp,
  opts: Partial<Skin> = {},
): Skin {
  return {
    skin: P.skin,
    skinDark: P.skinMid,
    hair: hair[2],
    hairDark: hair[0],
    coat: coat[2],
    coatLight: coat[3],
    coatDark: coat[1],
    accent: accent[2],
    accentDark: accent[1],
    pants: pants[2],
    pantsDark: pants[1],
    ...BOOT_LEATHER,
    ink: P.ink,
    ...opts,
  };
}

/**
 * Ten villagers. Each one's boots are chosen against its trousers, not by
 * habit: dark cloth gets tan leather, warm or light cloth gets dark leather.
 * Anything else and the whole lower half of the sprite flattens out.
 */
export const NPC_SKINS: Skin[] = [
  villager(R.red, R.night, R.gold, R.hair), // innkeeper
  villager(R.leaf, R.sand, R.dirt, R.wood, BOOT_DARK), // farmer — canvas trousers
  villager(R.purple, R.night, R.gold, R.night), // merchant
  villager(R.metal, R.night, R.red, R.hair, { cape: true }), // guard
  villager(R.sand, R.dirt, R.red, R.wood), // baker
  villager(R.teal, R.night, R.paper, R.hair), // fisher
  villager(R.paper, R.purple, R.teal, R.gold, BOOT_DARK), // townswoman
  villager(R.dirt, R.night, R.leaf, R.hair, { scarf: true }), // labourer
  villager(R.night, R.night, R.metal, R.night, { hooded: true }), // stranger
  villager(R.gold, R.wood, R.red, R.hair, { ...BOOT_DARK, scarf: true }), // herald
];

export interface Pose {
  /** Vertical hip travel. Positive sinks the hips; the feet stay planted. */
  bob: number;
  crouch: number;
  /** Forward (+x) shift of the torso relative to the hips. */
  lean: number;
  /** Sideways shift of the whole pelvis — the weight transfer in a walk. */
  hipX: number;
  /** Shoulder-only lift, for breathing. Negative raises the chest. */
  breath: number;
  headX: number;
  headY: number;
  /** Eyes shut this frame. */
  blink: number;
  /** Leg A is the near leg: screen-right in front view, closest in profile. */
  legAX: number;
  legAY: number;
  /** Knee bend in px. A swinging leg folds; a supporting leg stays straight. */
  legAKnee: number;
  /** Foot pitch: +1 heel raised (push-off), -1 toe raised (heel strike). */
  legAPitch: number;
  legBX: number;
  legBY: number;
  legBKnee: number;
  legBPitch: number;
  armAX: number;
  armAY: number;
  armBX: number;
  armBY: number;
  /** Shoulder twist, in px — swings the shoulder line against the hips. */
  twist: number;
  /** Coat-tail swing, in px. Trails the hips so the cloth follows through. */
  tail: number;
}

const REST: Pose = {
  bob: 0,
  crouch: 0,
  lean: 0,
  hipX: 0,
  breath: 0,
  headX: 0,
  headY: 0,
  blink: 0,
  legAX: 0,
  legAY: 0,
  legAKnee: 0,
  legAPitch: 0,
  legBX: 0,
  legBY: 0,
  legBKnee: 0,
  legBPitch: 0,
  armAX: 0,
  armAY: 0,
  armBX: 0,
  armBY: 0,
  twist: 0,
  tail: 0,
};

function pose(p: Partial<Pose>): Pose {
  return { ...REST, ...p };
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/**
 * Move a colour `n` whole steps along its own ramp.
 *
 * `shade()` takes a continuous amount and rounds to `t * 3.2` steps, so 0.31
 * per step is the value that lands exactly one swatch away — going through this
 * helper keeps every limb on the ramp instead of drifting off it.
 */
function step(c: RGBA, n: number): RGBA {
  return n === 0 ? c : shade(c, n * 0.31);
}

/** One ramp step down, for limbs on the far side of the body. */
function back(c: RGBA): RGBA {
  return step(c, -1);
}

/**
 * Cylinder-shade a limb drawn in isolation: brightest column on the lit (left)
 * edge, darkest on the right.
 *
 * Limbs are drawn into their own buffer and shaded before they are composited,
 * which is the only way a sleeve painted in the coat colour can sit *on top of*
 * a torso painted in the same colour and still read as a separate arm. The
 * previous rig drew arms straight onto the body in flat coat tone, and the
 * result was a sprite with no visible arms at all.
 */
function shadeLimb(b: PixelBuffer, lit: RGBA, dark: RGBA): void {
  for (let y = 0; y < b.h; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < b.w; x++) {
      if (b.alphaAt(x, y) > 128) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (x0 < 0) continue;
    b.set(x0, y, lit);
    if (x1 > x0) b.set(x1, y, dark);
  }
}

// ---------------------------------------------------------------------------
// Body parts
// ---------------------------------------------------------------------------

/**
 * Boot: three rows of hand-placed pixels, not the end of the trouser tube.
 *
 * In profile the toe points along the facing and the sole tilts with the foot
 * pitch, so the rear foot pushes off on its toe and the leading foot lands on
 * its heel. That single detail is the difference between "walking" and
 * "sliding".
 */
function drawBoot(
  buf: PixelBuffer,
  fx: number,
  fy: number,
  dir: Dir,
  outward: number,
  pitch: number,
  s: Skin,
  tone: number,
): void {
  const b = step(s.boot, tone);
  const d = step(s.bootDark, tone);
  const lit = step(s.boot, tone + 1);
  const x = Math.round(fx);
  const y = Math.round(fy);
  const row = (a: number, z: number, dy: number, c: RGBA): void => {
    for (let i = a; i <= z; i++) buf.set(x + i, y + dy, c);
  };

  if (dir === 1) {
    if (pitch > 0.45) {
      // Push-off: heel up, only the toe on the floor. Three short runs stepping
      // down and forward — spread any wider and the boot reads as a flipper.
      row(-1, 1, -2, b);
      row(0, 2, -1, b);
      row(1, 3, 0, d);
      buf.set(x - 1, y - 2, lit);
    } else if (pitch < -0.45) {
      // Heel strike: toe raised, heel planted.
      row(0, 2, -2, b);
      row(-2, 2, -1, b);
      row(-2, 0, 0, d);
      buf.set(x, y - 2, lit);
    } else {
      row(-1, 1, -2, b);
      row(-2, 2, -1, b);
      row(-2, 3, 0, d);
      buf.set(x - 1, y - 2, lit);
    }
    return;
  }

  // Front / back: a squat 4px boot angled slightly outward, so the pair reads
  // as a stance instead of as two identical bricks.
  const o = outward >= 0 ? 1 : -1;
  row(-1, 1, -2, b);
  if (o > 0) {
    row(-1, 2, -1, b);
    row(-1, 2, 0, d);
    buf.set(x - 1, y - 1, lit);
  } else {
    row(-2, 1, -1, b);
    row(-2, 1, 0, d);
    buf.set(x - 2, y - 1, lit);
  }
  buf.set(x - 1, y - 2, lit);
}

/**
 * One leg, drawn as two segments with a knee between them.
 *
 * A straight capsule from hip to floor cannot express a stride: both legs read
 * as the same rigid stick at every phase. Splitting at the knee lets the
 * supporting leg stay straight while the swinging leg folds, which is where
 * almost all of the walk's silhouette comes from.
 */
function drawLeg(
  buf: PixelBuffer,
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
  s: Skin,
  dir: Dir,
  outward: number,
  tone: number,
  knee: number,
  pitch: number,
): void {
  const pants = step(s.pants, tone);
  const ankleY = footY - 2;
  const bendDir = dir === 1 ? 1 : outward * 0.4;
  const kneeX = (hipX + footX) / 2 + bendDir * (0.5 + knee * 0.55);
  const kneeY = (hipY + ankleY) / 2 + 0.4;
  const rThigh = dir === 1 ? 1.7 : 1.5;
  const rShin = dir === 1 ? 1.5 : 1.3;

  const tmp = new PixelBuffer(FRAME_W, FRAME_H);
  tmp.capsule(hipX, hipY - 1, kneeX, kneeY, rThigh, pants);
  tmp.capsule(kneeX, kneeY, footX, ankleY + 0.5, rShin, pants);
  shadeLimb(tmp, step(pants, 1), step(pants, -1));
  buf.blit(tmp, 0, 0);

  drawBoot(buf, footX, footY, dir, outward, pitch, s, tone);
}

/**
 * Sleeve + cuff + hand.
 *
 * `overTorso` adds a one-pixel dark rim under the sleeve: in profile the near
 * arm hangs in front of a torso painted in the same cloth, and without an inner
 * outline the two merge into one slab.
 */
function drawArm(
  buf: PixelBuffer,
  sx: number,
  sy: number,
  hx: number,
  hy: number,
  s: Skin,
  isBack: boolean,
  overTorso: boolean,
): void {
  const coat = isBack ? back(s.coat) : s.coat;
  const lit = isBack ? back(s.coatLight) : s.coatLight;
  const dark = isBack ? back(s.coatDark) : s.coatDark;
  const ex = (sx + hx) / 2 + (hx - sx) * 0.12;
  const ey = (sy + hy) / 2 + 0.4;

  if (overTorso) {
    // Exactly one pixel of rim. Two reads as a black bar strapped to the chest.
    buf.capsule(sx, sy, ex, ey, 1.9, dark);
    buf.capsule(ex, ey, hx, hy, 1.7, dark);
  }
  const tmp = new PixelBuffer(FRAME_W, FRAME_H);
  tmp.capsule(sx, sy, ex, ey, 1.5, coat);
  tmp.capsule(ex, ey, hx, hy, 1.3, coat);
  shadeLimb(tmp, lit, dark);
  buf.blit(tmp, 0, 0);

  // The cuff is a two-pixel bright line off the shirt's own ramp and the hand a
  // deliberate 2x2 block. Painting the cuff in the accent colour put a bar of
  // saturated red at both wrists, which at this size read as a second belt
  // slung across the hips rather than as trim.
  const cuff = step(s.coatLight, 1);
  const hxi = Math.round(hx);
  const hyi = Math.round(hy);
  buf.hline(hxi - 1, hxi, hyi, isBack ? back(cuff) : cuff);
  buf.fillRect(hxi - 1, hyi + 1, 2, 2, isBack ? back(s.skin) : s.skin);
  buf.set(hxi, hyi + 2, isBack ? back(s.skinDark) : s.skinDark);
}

/**
 * Torso silhouettes, as (left, right) offsets from the body centre per row.
 *
 * Nine rows, shoulders to belt. The profile is a *different table*, not the
 * front one with the eyes moved: 7-8px deep against 9px wide, one shoulder, the
 * chest carried forward and the waist tucked back.
 */
const TORSO_FRONT: readonly (readonly [number, number])[] = [
  [-3, 3],
  [-4, 4],
  [-4, 4],
  [-4, 4],
  [-4, 4],
  [-4, 4],
  [-3, 3],
  [-3, 3],
  [-3, 3],
];

const TORSO_SIDE: readonly (readonly [number, number])[] = [
  [-2, 2],
  [-3, 3],
  [-3, 4],
  [-3, 4],
  [-3, 3],
  [-3, 3],
  [-3, 3],
  [-3, 2],
  [-3, 2],
];

function drawTorso(
  buf: PixelBuffer,
  cx: number,
  shY: number,
  s: Skin,
  dir: Dir,
  twist: number,
  tailSwing: number,
): void {
  const table = dir === 1 ? TORSO_SIDE : TORSO_FRONT;
  const belt = table.length - 1;
  const hipY = shY + belt;

  for (let i = 0; i < table.length; i++) {
    const y = shY + i;
    // The shoulder rows rotate against the hips; the waist stays put.
    const tw = i <= 3 ? twist * 0.4 : 0;
    const x0 = Math.round(cx + table[i][0] + tw);
    const x1 = Math.round(cx + table[i][1] + tw);
    if (i === belt) {
      for (let x = x0; x <= x1; x++) {
        buf.set(x, y, x === x0 ? step(s.boot, 1) : x === x1 ? s.bootDark : s.boot);
      }
      buf.set(Math.round(cx + (dir === 1 ? 1 : 0)), y, P.gold);
      continue;
    }
    // Two flat value plateaus, not a gradient: lit chest, shaded belly. The old
    // torso painted its right-hand *two* columns dark, which read as a grey
    // post strapped to the character's back. The shaded band never steps below
    // `coatDark` either — one swatch further is the ramp's outline tone, and a
    // column of it inside the silhouette reads as a hole.
    const low = i >= belt - 2;
    const base = low ? s.coatDark : s.coat;
    const lit = low ? s.coat : s.coatLight;
    for (let x = x0; x <= x1; x++) {
      buf.set(x, y, x === x0 ? lit : x === x1 ? s.coatDark : base);
    }
  }

  if (dir === 0) {
    buf.line(Math.round(cx - 3), shY + 1, Math.round(cx + 1), shY + 6, s.accentDark);
  } else if (dir === 2) {
    buf.line(Math.round(cx + 3), shY + 1, Math.round(cx - 1), shY + 6, s.accentDark);
  }
  // Nothing crosses the chest in profile: a strap drawn there is the single
  // loudest "this is a front view" cue there is.

  if (s.coatTail) {
    // Two rows of flared hem below the belt, swinging opposite the stride.
    // Longer than this and the coat buries the legs and the walk stops reading.
    const sw = tailSwing * 0.5;
    for (let i = 0; i < 2; i++) {
      const y = hipY + 1 + i;
      const half = (dir === 1 ? 2.6 : 3.4) + i * 0.5;
      const off = Math.round((sw * (i + 1)) / 2);
      const x0 = Math.round(cx - half) + off;
      const x1 = Math.round(cx + half) + off;
      const base = i === 0 ? s.coat : s.coatDark;
      for (let x = x0; x <= x1; x++) {
        buf.set(x, y, x === x0 ? step(base, 1) : x === x1 ? s.coatDark : base);
      }
    }
  }
}

function drawCape(buf: PixelBuffer, cx: number, shY: number, hipY: number, s: Skin, dir: Dir): void {
  if (!s.cape) return;
  const c = step(s.coatDark, -1);
  const lit = s.coatDark;
  if (dir === 2) {
    for (let y = shY + 1; y <= hipY + 2; y++) {
      const half = y > hipY - 2 ? 5 : 4;
      for (let x = cx - half; x <= cx + half; x++) buf.set(x, y, x === cx - half ? lit : c);
    }
  } else if (dir === 1) {
    for (let y = shY + 1; y <= hipY + 3; y++) {
      buf.set(cx - 5, y, c);
      buf.set(cx - 4, y, lit);
    }
  } else {
    for (let y = shY + 1; y <= hipY + 2; y++) {
      buf.set(cx - 5, y, lit);
      buf.set(cx + 5, y, c);
    }
  }
}

function drawNeck(buf: PixelBuffer, cx: number, y: number, s: Skin, dir: Dir): void {
  const lit = s.hooded ? s.coat : s.skin;
  const dark = s.hooded ? s.coatDark : s.skinDark;
  const x0 = dir === 1 ? cx : cx - 1;
  const x1 = dir === 1 ? cx + 2 : cx + 1;
  for (let x = x0; x <= x1; x++) buf.set(x, y, x === x1 ? dark : lit);
}

function drawScarf(buf: PixelBuffer, cx: number, shY: number, s: Skin, dir: Dir, flap: number): void {
  if (!s.scarf) return;
  const x0 = cx - 3;
  const x1 = dir === 1 ? cx + 2 : cx + 3;
  for (let x = x0; x <= x1; x++) {
    buf.set(x, shY, x === x0 ? step(s.accent, 1) : s.accent);
    buf.set(x, shY + 1, x === x1 ? step(s.accentDark, -1) : s.accentDark);
  }
  // The tail streams *behind* the direction of travel. One pixel wide in
  // profile: drawn as a capsule it turned into a red bale strapped to the
  // shoulders, which at this size is louder than the entire head.
  if (dir === 1) {
    const drift = Math.round(Math.abs(flap) * 0.5);
    for (let i = 0; i < 3; i++) {
      const x = cx - 4 - (i > 0 ? drift : 0);
      buf.set(x, shY + 1 + i, i === 2 ? s.accentDark : s.accent);
    }
    return;
  }
  const ty = shY + 4 + Math.abs(flap) * 0.3;
  buf.capsule(cx + 3, shY + 1, cx + 3 + 1 + Math.abs(flap) * 0.6, ty, 1, s.accent);
  buf.set(Math.round(cx + 4 + Math.abs(flap) * 0.6), Math.round(ty), s.accentDark);
}

// ---------------------------------------------------------------------------
// Heads — authored, never generated
// ---------------------------------------------------------------------------

/**
 * Eleven rows, nine columns, every pixel placed by hand.
 *
 * L/H/D = hair light / mid / dark, b = brow, S/s = skin / skin shade,
 * e = pupil, w = eye white, m = mouth, C/c/k/g = hood / hood dark / cavity /
 * eye glow.
 */
const HEAD_DOWN = [
  '...HHH...',
  '.LLHHHHD.',
  'LLHHHHHHD',
  'LHHHHHHHD',
  'LHHHHHHHD',
  'LHSSSSSsD',
  'LHSSSSSsD',
  'HHSeSeSsD',
  '.HSSmSSs.',
  '..SSSSS..',
  '...sSs...',
];

const HEAD_DOWN_BLINK = [
  ...HEAD_DOWN.slice(0, 7),
  'HHSsSsSsD',
  ...HEAD_DOWN.slice(8),
];

/**
 * The profile.
 *
 * Read the right-hand edge column by column: the crown pulls back at rows 2-3,
 * the brow comes forward at row 4, and rows 5-6 push one pixel further than
 * anything else — that is the nose, and it is the whole reason this silhouette
 * reads as a face in profile rather than as a head turned to the camera with an
 * eye slid sideways. The eye is a hard 1px white against a 1px ink pupil; at
 * nine pixels across nothing softer survives. The hair carries a pixel of extra
 * mass at the nape (rows 4-8 reach further back than the skull does) so the
 * hairstyle has a back to it.
 */
const HEAD_SIDE = [
  '..LHHH...',
  '.LLHHHH..',
  '.LHHHHHD.',
  '.LHHHHHD.',
  'LHHHHbSs.',
  'LHHHweSSs',
  'LHHHSSSSS',
  'HHHDsSSs.',
  'HHHDsSmS.',
  '.HDDsSSs.',
  '..DsSSs..',
];

const HEAD_SIDE_BLINK = [
  ...HEAD_SIDE.slice(0, 5),
  'LHHHSsSSs',
  ...HEAD_SIDE.slice(6),
];

const HEAD_UP = [
  '...HHH...',
  '.LLHHHHD.',
  'LLHHHHHHD',
  'LHHHHHHHD',
  'LHHHHHHHD',
  'LHHHHHHHD',
  'HHHHHHHHD',
  'HHHDDDHHD',
  '.HHDDDHH.',
  '..HHHHH..',
  '...sSs...',
];

const HOOD_DOWN = [
  '...CCC...',
  '.CCCCCCC.',
  'CCCCCCCCc',
  'CCCkkkCCc',
  'CCkkkkkCc',
  'CCkkkkkCc',
  'CCkgkgkCc',
  'CCkkkkkCc',
  '.CCkkkCC.',
  '..CCCCC..',
  '...ccc...',
];

const HOOD_SIDE = [
  '..CCCC...',
  '.CCCCCCC.',
  '.CCCCCCc.',
  '.CCCCCCc.',
  'CCCCkkkc.',
  'CCCkkkkkc',
  'CCCkkgkkc',
  'CCCkkkkc.',
  'CCCCkkkc.',
  '.CCCCCCc.',
  '..CCCCc..',
];

const HOOD_UP = [
  '...CCC...',
  '.CCCCCCC.',
  'CCCCCCCCc',
  'CCCCCCCCc',
  'CCCCCCCCc',
  'CCCCCCCCc',
  'CCCCCCCCc',
  'CCCCCCCCc',
  '.CCCCCCC.',
  '..CCCCC..',
  '...ccc...',
];

function headArt(s: Skin, dir: Dir, blink: boolean): PixelBuffer {
  if (s.hooded) {
    const rows = dir === 0 ? HOOD_DOWN : dir === 1 ? HOOD_SIDE : HOOD_UP;
    return parseArt(rows, {
      C: s.coat,
      c: s.coatDark,
      k: shade(s.coatDark, -0.6),
      g: P.magic,
    });
  }
  const rows =
    dir === 0
      ? blink
        ? HEAD_DOWN_BLINK
        : HEAD_DOWN
      : dir === 1
        ? blink
          ? HEAD_SIDE_BLINK
          : HEAD_SIDE
        : HEAD_UP;
  return parseArt(rows, {
    L: step(s.hair, 1),
    H: s.hair,
    // One step down, not all the way to the ramp's outline tone: `hairDark` is
    // the swatch `selOutline` builds the key line from, so painting the hair's
    // own shading with it punched what looked like holes in the silhouette.
    D: step(s.hair, -1),
    b: s.hairDark,
    S: s.skin,
    s: s.skinDark,
    e: s.ink,
    w: P.white,
    m: step(s.skinDark, -1),
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Renders one posed frame of a humanoid into a fresh buffer (no outline yet). */
export function drawHumanoid(s: Skin, dir: Dir, p: Pose, flap = 0): PixelBuffer {
  const buf = new PixelBuffer(FRAME_W, FRAME_H);
  const cx = ANCHOR_X;
  const profile = dir === 1;

  const hipY = HIP_Y + p.bob + p.crouch;
  const shY = hipY - (TORSO_ROWS - 1) + p.breath;
  const neckY = shY - 1;
  const headTop = shY - 12 + p.headY;

  const hipCX = cx + p.hipX;
  const torsoCX = hipCX + p.lean;
  const headCX = torsoCX + p.headX + (profile ? 1 : 0);

  // In profile the legs stack instead of straddling, so the pair is barely
  // offset and the read comes from the stride and the tone break instead.
  const legSpread = profile ? 0.6 : 2;
  const armSpread = profile ? 1.2 : 4.2;

  // --- far side ------------------------------------------------------------
  drawLeg(
    buf,
    hipCX - legSpread,
    hipY,
    hipCX - legSpread + p.legBX,
    GROUND + p.legBY,
    s,
    dir,
    -1,
    profile ? -1 : 0,
    p.legBKnee,
    p.legBPitch,
  );
  drawArm(
    buf,
    torsoCX - armSpread + p.twist,
    shY + 1,
    torsoCX - armSpread + p.armBX,
    shY + 6 + p.armBY,
    s,
    true,
    false,
  );

  // --- near leg ------------------------------------------------------------
  drawLeg(
    buf,
    hipCX + legSpread,
    hipY,
    hipCX + legSpread + p.legAX,
    GROUND + p.legAY,
    s,
    dir,
    1,
    0,
    p.legAKnee,
    p.legAPitch,
  );
  if (!profile) {
    // Front and back views: cut a one-pixel dark seam wherever the legs have
    // actually run together, or they merge into a single trouser-shaped mass.
    // Only where the row is solid on *both* sides — cutting unconditionally put
    // a black stripe down the inside of whichever leg happened to straddle the
    // centre line after the hip shift.
    const seam = Math.round(hipCX);
    for (let y = Math.round(hipY) + 1; y <= GROUND; y++) {
      if (
        buf.alphaAt(seam, y) > 200 &&
        buf.alphaAt(seam - 1, y) > 200 &&
        buf.alphaAt(seam + 1, y) > 200
      ) {
        buf.set(seam, y, step(s.pantsDark, -1));
      }
    }
  }

  if (dir !== 2) drawCape(buf, torsoCX, shY, hipY, s, dir);
  drawNeck(buf, Math.round(torsoCX), neckY, s, dir);
  drawTorso(buf, torsoCX, shY, s, dir, p.twist, p.tail);
  if (dir === 2) drawCape(buf, torsoCX, shY, hipY, s, dir);
  drawScarf(buf, Math.round(torsoCX), shY, s, dir, flap);

  // --- near arm, on top of the torso --------------------------------------
  drawArm(
    buf,
    torsoCX + armSpread,
    shY + 1,
    torsoCX + armSpread + p.armAX,
    shY + 6 + p.armAY,
    s,
    false,
    profile,
  );

  buf.blit(headArt(s, dir, p.blink > 0), Math.round(headCX) - 4, Math.round(headTop));
  return buf;
}

function finish(buf: PixelBuffer): PixelBuffer {
  buf.selOutline();
  buf.rimLight(P.white, 0.16);
  return buf;
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

/** Four poses: rest, inhale, top of the breath, and a blink. */
function idlePoses(): Pose[] {
  return [
    pose({}),
    pose({ breath: -1, armAY: 0.3, armBY: 0.3 }),
    pose({ breath: -1, headY: -1, armAY: 0.4, armBY: 0.4 }),
    pose({ blink: 1 }),
  ];
}

const IDLE_ORDER = [0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 3];

interface LegTrack {
  x: number;
  lift: number;
  knee: number;
  pitch: number;
}

/**
 * Where one foot is at phase `ph` of the cycle.
 *
 * Stance runs from 0 to pi with the foot flat on the floor; swing runs from pi
 * to 2pi with the foot lifted and the knee folded. `pitch = -cos(ph)` falls out
 * of the same phase: at the front of the stride (`ph = 0`, foot forward) it is
 * -1, so the toe is up and the heel lands first; at the back (`ph = pi`) it is
 * +1, so the heel is up and the toe pushes off. Get that pair the wrong way
 * round and the sprite reads as walking backwards no matter what the rest of
 * the body does.
 */
function legTrack(ph: number, amp: number, stride: number, run: boolean): LegTrack {
  const t = ((ph % TAU) + TAU) % TAU;
  const swing = t > Math.PI;
  const k = swing ? Math.sin(t - Math.PI) : 0;
  // A run has an airborne phase: at the pass both feet leave the floor.
  const float = run ? Math.max(0, -Math.cos(2 * t)) * 1.4 : 0;
  return {
    x: Math.cos(t) * stride,
    lift: -(k * 3 * amp + float),
    knee: swing ? k * 3.4 * amp : 0.3,
    pitch: -Math.cos(t),
  };
}

/**
 * Walk cycle.
 *
 * Two *contacts* (legs at full stride, hips at their lowest) and two *passing*
 * poses (legs together, hips at their highest) per cycle, so the vertical bob
 * runs at twice the frequency of the leg swing and in antiphase with it. The
 * feet are pinned to the floor and only the hips ride the bob — the body moves
 * over the standing leg instead of the whole sprite hovering above its own
 * shadow.
 *
 * The profile carries a ±4px stride, a bent swing knee and a ±3px counter-swing
 * on the near arm, which is what makes the contact and passing frames read as
 * two completely different silhouettes at 8x. The front and back views cannot
 * use stride length at all — a leg swinging towards the camera does not get
 * longer — so they get a 1px hip shift onto the standing leg and a 2px vertical
 * offset between the boots instead.
 */
function walkPoses(frames: number, amp: number, dir: Dir): Pose[] {
  const out: Pose[] = [];
  const run = amp > 1.2;
  const profile = dir === 1;
  const legAmp = profile ? amp : amp * 0.6;
  const stride = (profile ? 4 : 1.2) * amp;
  const lag = 0.12; // fraction of a cycle the head/tail trail the hips by
  const bobAmp = run ? 2 : 1;

  for (let i = 0; i < frames; i++) {
    const ph = (i / frames) * TAU;
    const a = legTrack(ph, legAmp, stride, run);
    const b = legTrack(ph + Math.PI, legAmp, stride, run);
    const sLag = Math.sin(ph - lag * TAU);
    const swing = Math.cos(ph);

    out.push(
      pose({
        // 0 at the pass (tallest), +bobAmp at contact (lowest).
        bob: (Math.cos(2 * ph) + 1) * 0.5 * bobAmp,
        crouch: run ? 1 : 0,
        lean: profile ? (run ? 2 : 1) : 0,
        hipX: profile ? 0 : swing * 0.7,
        legAX: a.x,
        legAY: a.lift,
        legAKnee: a.knee,
        legAPitch: profile ? a.pitch : 0,
        legBX: b.x,
        legBY: b.lift,
        legBKnee: b.knee,
        legBPitch: profile ? b.pitch : 0,
        // Arms counter-swing the legs on the same side.
        armAX: -swing * (profile ? 3 : 1.3) * amp,
        armAY: profile ? -Math.abs(swing) * 0.5 : -swing * 0.9,
        armBX: swing * (profile ? 3 : 1.3) * amp,
        armBY: profile ? -Math.abs(swing) * 0.5 : swing * 0.9,
        // Head and cloth lag the hips, so they follow through.
        headX: sLag * (profile ? 0.6 : 0.4) * amp,
        headY: (Math.abs(sLag) - 0.5) * (run ? 1 : 0.6),
        twist: (profile ? Math.sin(ph) : swing) * 0.9 * amp,
        tail: -sLag * 2.2 * amp,
      }),
    );
  }
  return out;
}

/**
 * A generic work loop: raise, swing down, follow through, reset. Used by NPCs
 * at a forge, a field or a market stall — from a distance the same motion
 * reads as hammering, hoeing or kneading depending on what they stand next to.
 */
function workPoses(): Pose[] {
  return [
    pose({ armAX: 1, armAY: -4, lean: -0.6, twist: -0.6, headY: -0.4 }),
    pose({ armAX: 2, armAY: -5.5, lean: -1, twist: -1, breath: -1 }),
    pose({ armAX: 3.5, armAY: 1, lean: 1.4, twist: 1.2, bob: 1, crouch: 1 }),
    pose({ armAX: 2.5, armAY: 0.5, lean: 1, twist: 0.8, bob: 1 }),
    pose({ armAX: 1, armAY: -1.5, lean: 0, twist: 0 }),
  ];
}

function attackPoses(): Pose[] {
  // Wind up, thrust, hold, recover.
  return [
    pose({ lean: -1.5, armAX: -2.5, armAY: -1, twist: -1, crouch: 1 }),
    pose({ lean: -2, armAX: -3.5, armAY: -2, twist: -1.5, crouch: 1, headX: -1 }),
    pose({ lean: 2, armAX: 5, armAY: -2, twist: 2, legAX: 2, legAKnee: 1, bob: -1 }),
    pose({ lean: 2.5, armAX: 6, armAY: -1, twist: 2.2, legAX: 2.5, legAKnee: 1 }),
    pose({ lean: 1, armAX: 3, armAY: 0, twist: 1, legAX: 1 }),
    pose({ lean: 0, armAX: 1, armAY: 0, twist: 0 }),
  ];
}

/**
 * Tool actions.
 *
 * One generic punch for every implement made the hoe, the axe, the can and the
 * scythe indistinguishable — the tool sprite rode a different arc but the body
 * underneath did the same thing, so nothing read as *work*. These are four
 * six-frame sets on the same duration as the attack clip, so `Player` can swap
 * one in for another purely on what is in hand.
 *
 * They are matched frame-for-frame to the tool arcs in `player.ts`: the impact
 * frame of the overhead chop is frame 3, which is where the blade reaches the
 * ground, and that frame is the only one that sinks (`crouch` + `bob`).
 */

/** Overhead chop — hoe, axe, pick. Wind up over the head, drop it, recover. */
function overheadPoses(): Pose[] {
  return [
    pose({ lean: -1, armAX: 1, armAY: -4.5, twist: -1, headX: -0.4, headY: -0.5, breath: -1 }),
    pose({ lean: -2, armAX: 0.5, armAY: -6, twist: -1.6, headX: -1, headY: -0.5, breath: -1 }),
    pose({ lean: 0.5, armAX: 3, armAY: -3, twist: 0.6, legAX: 0.5 }),
    // Impact: the whole body drops onto the blow.
    pose({
      lean: 2,
      armAX: 4.5,
      armAY: 1.5,
      twist: 1.8,
      legAX: 1.5,
      legAKnee: 1.5,
      crouch: 1,
      bob: 1,
      headY: 0.5,
    }),
    pose({ lean: 1.5, armAX: 4, armAY: 1, twist: 1.2, legAX: 1, legAKnee: 1, crouch: 1, bob: 0.5 }),
    pose({ lean: 0.5, armAX: 2, armAY: -0.5, twist: 0.4 }),
  ];
}

/**
 * Watering. Deliberately almost still: you do not swing a full can, you hold it
 * out and wait. All the motion in this action belongs to the water.
 */
function waterPoses(): Pose[] {
  return [
    pose({ lean: 0.6, armAX: 2, armAY: -1.5, twist: 0.4 }),
    pose({ lean: 1.2, armAX: 3.5, armAY: -1, twist: 0.8, headY: 0.5 }),
    pose({ lean: 1.4, armAX: 4, armAY: -0.5, twist: 1, headY: 0.5, crouch: 1 }),
    pose({ lean: 1.4, armAX: 4, armAY: -0.5, twist: 1, headY: 0.5, crouch: 1 }),
    pose({ lean: 1.3, armAX: 3.8, armAY: -0.5, twist: 1, headY: 0.5, crouch: 1 }),
    pose({ lean: 0.9, armAX: 3, armAY: -1, twist: 0.6 }),
  ];
}

/**
 * Scythe. A flat horizontal pass: the hips and shoulders lead, the arm stays
 * low the whole way and there is no vertical drop at all — the difference
 * between reaping and chopping is entirely in the plane of the swing.
 */
function sweepPoses(): Pose[] {
  return [
    pose({ lean: -1, armAX: -3, armAY: 2, twist: -2, headX: -0.6 }),
    pose({ lean: -1.2, armAX: -3.5, armAY: 2.2, twist: -2.2, headX: -1, crouch: 1 }),
    pose({ lean: 0.5, armAX: 0.5, armAY: 2.5, twist: 0, crouch: 1 }),
    pose({ lean: 1.5, armAX: 4, armAY: 2.2, twist: 2, legAX: 1, legAKnee: 1, crouch: 1 }),
    pose({ lean: 1.2, armAX: 4.5, armAY: 1.5, twist: 2.2, legAX: 1, legAKnee: 1 }),
    pose({ lean: 0.4, armAX: 2, armAY: 0.5, twist: 0.8 }),
  ];
}

/** Casting a rod: load back over the shoulder for two frames, then whip. */
function castPoses(): Pose[] {
  return [
    pose({ lean: -2, armAX: -2, armAY: -4, twist: -1.5, headX: -0.5 }),
    pose({ lean: -2.5, armAX: -3, armAY: -4.5, twist: -2, headX: -1, legBX: -1, legBKnee: 1 }),
    pose({ lean: 2, armAX: 4, armAY: -3, twist: 1.5, legAX: 1, legAKnee: 1 }),
    pose({ lean: 2.5, armAX: 5, armAY: -2.5, twist: 2, legAX: 1.5, legAKnee: 1, bob: -0.5 }),
    pose({ lean: 1.5, armAX: 4, armAY: -2, twist: 1.2, legAX: 1 }),
    pose({ lean: 0.8, armAX: 3, armAY: -1.5, twist: 0.6 }),
  ];
}

/** Death = collapse pose interpolation + a rotate/squash transform + blood. */
function bakeDeath(s: Skin, dir: Dir): PixelBuffer[] {
  const frames: PixelBuffer[] = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const ease = t * t;
    const body = drawHumanoid(
      s,
      dir,
      pose({
        crouch: 3 * ease,
        lean: -2 * ease,
        headX: -1.5 * ease,
        headY: 1.5 * ease,
        legAX: 3 * ease,
        legAY: -1 * ease,
        legAKnee: 2 * ease,
        legBX: -2.5 * ease,
        legBKnee: 1.5 * ease,
        armAX: 3.5 * ease,
        armAY: -2 * ease,
        armBX: -3.5 * ease,
        armBY: -1.5 * ease,
        twist: -2 * ease,
        blink: ease > 0.5 ? 1 : 0,
      }),
    );
    finish(body);

    const f = new PixelBuffer(FRAME_W, FRAME_H);
    // Blood pool spreads underneath as the body settles.
    if (t > 0.35) {
      const g = (t - 0.35) / 0.65;
      f.ellipse(ANCHOR_X - 1, ANCHOR_Y - 1, 3 + g * 7, 1.5 + g * 3, rgba(P.bloodDark, 200));
      f.ellipse(ANCHOR_X - 1, ANCHOR_Y - 1.5, 2 + g * 5, 1 + g * 2, rgba(P.blood, 220));
      f.ellipse(ANCHOR_X - 3 - g * 3, ANCHOR_Y - 2, 1 + g, 0.8 + g * 0.6, rgba(P.blood, 200));
    }
    const angle = -(Math.PI / 2) * ease * 1.02;
    f.blitTransformed(body, ANCHOR_X, ANCHOR_Y - 1 + ease * 2, {
      angle,
      scaleY: 1 - 0.12 * ease,
      scaleX: 1 + 0.05 * ease,
      pivotX: ANCHOR_X,
      pivotY: ANCHOR_Y,
      alpha: 1,
      tint: P.shadow,
      tintAmount: 0.25 * ease,
    });
    frames.push(f);
  }
  return frames;
}

function bake(s: Skin, dir: Dir, poses: Pose[], flapScale = 0): Sheet {
  const frames = poses.map((p, i) => {
    const flap = flapScale === 0 ? 0 : Math.sin((i / poses.length) * TAU) * flapScale;
    return finish(drawHumanoid(s, dir, p, flap));
  });
  return bakeSheet(frames, ANCHOR_X, ANCHOR_Y);
}

export interface CharacterAnims {
  idle: Clip[];
  walk: Clip[];
  run: Clip[];
  attack: Clip[];
  death: Clip[];
  /** Present on NPCs: a looping work motion. */
  work?: Clip[];
  /**
   * Per-tool swing variants, indexed by dir like every other set. They all run
   * for exactly as long as `attack`, so the caller can substitute one without
   * touching any of the timing that hangs off the attack clip.
   */
  swings?: Record<SwingKind, Clip[]>;
  /** Every baked sheet, for the asset gallery. */
  sheets: { name: string; dir: Dir; sheet: Sheet }[];
}

/** The four shapes a tool action can take. */
export type SwingKind = 'over' | 'water' | 'sweep' | 'cast';

/**
 * Villagers only ever idle and walk, so baking their run/attack/death sets
 * would triple the boot cost of a crowded town for frames nothing plays.
 * Those slots alias the walk clips.
 */
export function bakeNpc(s: Skin): CharacterAnims {
  const dirs: Dir[] = [0, 1, 2];
  const idleP = idlePoses();
  const workP = workPoses();
  const idle: Clip[] = [];
  const walk: Clip[] = [];
  const work: Clip[] = [];
  const sheets: { name: string; dir: Dir; sheet: Sheet }[] = [];
  for (const d of dirs) {
    const si = bake(s, d, idleP, 0.6);
    const sw = bake(s, d, walkPoses(8, 1, d), 1.4);
    const sk = bake(s, d, workP, 0.8);
    idle[d] = clip(si, IDLE_ORDER, 8);
    walk[d] = clip(sw, range(sw.count), 12);
    work[d] = clip(sk, range(sk.count), 9);
    sheets.push({ name: 'idle', dir: d, sheet: si }, { name: 'walk', dir: d, sheet: sw });
  }
  return { idle, walk, run: walk, attack: idle, death: idle, work, sheets };
}

export function bakeCharacter(s: Skin): CharacterAnims {
  const dirs: Dir[] = [0, 1, 2];
  const idleP = idlePoses();
  const atkP = attackPoses();
  const swingP: Record<SwingKind, Pose[]> = {
    over: overheadPoses(),
    water: waterPoses(),
    sweep: sweepPoses(),
    cast: castPoses(),
  };

  const idle: Clip[] = [];
  const walk: Clip[] = [];
  const run: Clip[] = [];
  const attack: Clip[] = [];
  const death: Clip[] = [];
  const swings: Record<SwingKind, Clip[]> = { over: [], water: [], sweep: [], cast: [] };
  const sheets: { name: string; dir: Dir; sheet: Sheet }[] = [];

  for (const d of dirs) {
    const si = bake(s, d, idleP, 0.6);
    const sw = bake(s, d, walkPoses(8, 1, d), 1.4);
    const sr = bake(s, d, walkPoses(8, 1.45, d), 2.6);
    const sa = bake(s, d, atkP, 1.2);
    const sd = bakeSheet(bakeDeath(s, d), ANCHOR_X, ANCHOR_Y);
    idle[d] = clip(si, IDLE_ORDER, 8);
    walk[d] = clip(sw, range(sw.count), 12);
    run[d] = clip(sr, range(sr.count), 16);
    attack[d] = clip(sa, range(sa.count), 16, false);
    death[d] = clip(sd, range(sd.count), 11, false);
    sheets.push(
      { name: 'idle', dir: d, sheet: si },
      { name: 'walk', dir: d, sheet: sw },
      { name: 'run', dir: d, sheet: sr },
      { name: 'attack', dir: d, sheet: sa },
      { name: 'death', dir: d, sheet: sd },
    );
    for (const k of Object.keys(swingP) as SwingKind[]) {
      // Same frame count and fps as `attack`: `Player` swaps these in for it.
      const ss = bake(s, d, swingP[k], k === 'water' ? 0.4 : 1.2);
      swings[k][d] = clip(ss, range(ss.count), 16, false);
      // Front and profile only in the gallery — twelve more back views would
      // bury the sets you actually inspect.
      if (d !== 2) sheets.push({ name: `swing ${k}`, dir: d, sheet: ss });
    }
  }
  return { idle, walk, run, attack, death, swings, sheets };
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

// ---------------------------------------------------------------------------
// Weapon — drawn separately so it can aim independently of the body facing,
// the way twin-stick shooters do it.
// ---------------------------------------------------------------------------

export function bakeGun(): Sheet {
  const frames: PixelBuffer[] = [];
  // frame 0: idle, frame 1: fired (recoiled + smoke)
  for (let i = 0; i < 2; i++) {
    const b = new PixelBuffer(16, 10);
    const ox = i === 1 ? -1 : 0;
    // barrel
    b.fillRect(5 + ox, 3, 8, 2, P.steelDark);
    b.fillRect(5 + ox, 3, 8, 1, P.steel);
    b.fillRect(11 + ox, 2, 2, 3, P.steel);
    // body / receiver
    b.fillRect(2 + ox, 3, 4, 4, P.woodDark);
    b.fillRect(2 + ox, 3, 4, 1, P.wood);
    // grip
    b.fillRect(3 + ox, 6, 2, 3, P.woodDark);
    // sight
    b.set(9 + ox, 2, P.steelLight);
    if (i === 1) {
      b.set(13, 2, P.fireHot);
      b.set(14, 3, P.fire);
    }
    b.selOutline();
    frames.push(b);
  }
  // Anchor at the grip so it pivots in the hand.
  return bakeSheet(frames, 3, 5);
}

export function bakeMuzzleFlash(): Sheet {
  const frames: PixelBuffer[] = [];
  for (let i = 0; i < 3; i++) {
    const b = new PixelBuffer(14, 12);
    const cy = 6;
    const k = 1 - i * 0.3;
    b.ellipse(3, cy, 3.4 * k, 3 * k, rgba(P.fireHot, 235));
    b.ellipse(5.5, cy, 4.2 * k, 2.2 * k, rgba(P.fire, 220));
    b.ellipse(8 * k + 2, cy, 2.6 * k, 1.4 * k, rgba(P.fireHot, 240));
    // spark rays
    b.line(3, cy, 3 + 7 * k, cy - 3 * k, rgba(P.fire, 180));
    b.line(3, cy, 3 + 7 * k, cy + 3 * k, rgba(P.fire, 180));
    b.line(3, cy, 3 + 9 * k, cy, rgba(P.fireHot, 200));
    frames.push(b);
  }
  return bakeSheet(frames, 2, 6);
}

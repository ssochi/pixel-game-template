/**
 * Humanoid character baker.
 *
 * Instead of hand-drawing ~100 frames, the body is a tiny skeleton (hip,
 * shoulder, head, two arms, two legs) rendered with pixel capsules. Every
 * animation is a function that returns a Pose per frame, so idle / walk / run /
 * attack / death all share one drawing routine and stay on-model.
 *
 * Frame layout: 32x36, anchor at the feet (16, 30).
 */
import { PixelBuffer, mix, parseArt, rgba, shade, type RGBA } from './pixel';
import { P, R, type Ramp } from './palette';
import { bakeSheet, clip, type Clip, type Sheet } from './sheet';

export const FRAME_W = 32;
export const FRAME_H = 36;
export const ANCHOR_X = 16;
export const ANCHOR_Y = 30;

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
  pants: P.pants,
  pantsDark: P.pantsDark,
  boot: P.boot,
  bootDark: P.bootDark,
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
  pants: R.night[2],
  pantsDark: R.night[1],
  boot: R.wood[1],
  bootDark: R.wood[0],
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
    boot: R.wood[1],
    bootDark: R.wood[0],
    ink: P.ink,
    ...opts,
  };
}

export const NPC_SKINS: Skin[] = [
  villager(R.red, R.night, R.gold, R.hair), // innkeeper
  villager(R.leaf, R.dirt, R.sand, R.wood), // farmer
  villager(R.purple, R.night, R.gold, R.night), // merchant
  villager(R.metal, R.metal, R.red, R.hair, { cape: true }), // guard
  villager(R.sand, R.wood, R.red, R.wood), // baker
  villager(R.teal, R.dirt, R.paper, R.hair), // fisher
  villager(R.paper, R.purple, R.teal, R.gold), // townswoman
  villager(R.dirt, R.night, R.leaf, R.hair, { scarf: true }), // labourer
  villager(R.night, R.night, R.metal, R.night, { hooded: true }), // stranger
  villager(R.gold, R.wood, R.red, R.hair, { scarf: true }), // herald
];

export interface Pose {
  bob: number;
  crouch: number;
  lean: number;
  headX: number;
  headY: number;
  /** Leg A is the character's right leg (screen-left in front view). */
  legAX: number;
  legAY: number;
  legBX: number;
  legBY: number;
  armAX: number;
  armAY: number;
  armBX: number;
  armBY: number;
  /** Shoulder twist, in px — pushes the far shoulder in. */
  twist: number;
  /** Coat-tail swing, in px. Trails the hips so the cloth follows through. */
  tail: number;
}

const REST: Pose = {
  bob: 0,
  crouch: 0,
  lean: 0,
  headX: 0,
  headY: 0,
  legAX: 0,
  legAY: 0,
  legBX: 0,
  legBY: 0,
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
// Body drawing
// ---------------------------------------------------------------------------

/** Darken a colour for limbs that sit behind the torso. */
function back(c: RGBA): RGBA {
  return shade(c, -0.28);
}

function drawLeg(
  buf: PixelBuffer,
  hx: number,
  hy: number,
  fx: number,
  fy: number,
  s: Skin,
  isBack: boolean,
): void {
  const pants = isBack ? back(s.pants) : s.pants;
  const boot = isBack ? back(s.boot) : s.boot;
  const kneeX = (hx + fx) / 2 + (fx - hx) * 0.15;
  const kneeY = (hy + fy) / 2;
  buf.capsule(hx, hy, kneeX, kneeY, 1.6, pants);
  buf.capsule(kneeX, kneeY, fx, fy - 1, 1.4, pants);
  // Boot: a cuffed top, a body and a heel. Three bands in five pixels is
  // enough to read as footwear rather than as the end of the trouser.
  const bx = Math.round(fx);
  const by = Math.round(fy);
  const bootDark = isBack ? back(s.bootDark) : s.bootDark;
  buf.fillRect(bx - 2, by - 3, 4, 1, isBack ? back(s.boot) : s.boot); // cuff
  buf.fillRect(bx - 2, by - 2, 5, 2, boot);
  buf.hline(bx - 2, bx + 2, by - 1, bootDark);
  buf.set(bx - 2, by - 2, bootDark);
}

function drawArm(
  buf: PixelBuffer,
  sx: number,
  sy: number,
  hx: number,
  hy: number,
  s: Skin,
  isBack: boolean,
): void {
  const coat = isBack ? back(s.coat) : s.coat;
  const skin = isBack ? back(s.skin) : s.skin;
  const elbowX = (sx + hx) / 2;
  const elbowY = (sy + hy) / 2 + 0.5;
  buf.capsule(sx, sy, elbowX, elbowY, 1.5, coat);
  buf.capsule(elbowX, elbowY, hx, hy, 1.3, coat);
  // The cuff is one pixel of trim and the hand a deliberate 2x2 block. A
  // blended dab here just reads as a stray coloured pixel at this size.
  const hxi = Math.round(hx);
  const hyi = Math.round(hy);
  buf.set(hxi, hyi, isBack ? back(s.accentDark) : s.accentDark);
  buf.fillRect(hxi - 1, hyi + 1, 2, 2, skin);
  buf.set(hxi, hyi + 2, isBack ? back(s.skinDark) : s.skinDark);
}

function drawTorso(
  buf: PixelBuffer,
  cx: number,
  shY: number,
  hipY: number,
  s: Skin,
  dir: Dir,
  twist: number,
  tailSwing: number,
): void {
  const shHalf = dir === 1 ? 3.2 : 4.6;
  const hipHalf = dir === 1 ? 2.6 : 3.2;
  const rows = Math.max(1, Math.round(hipY - shY));
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const y = Math.round(shY + i);
    const half = shHalf + (hipHalf - shHalf) * t;
    const x0 = Math.round(cx - half + (dir === 1 ? -twist * 0.3 : 0));
    const x1 = Math.round(cx + half + (dir === 1 ? twist * 0.3 : 0));
    for (let x = x0; x <= x1; x++) {
      // Light comes from the upper-left: bright rim left, shade right.
      let c = s.coat;
      if (x >= x1 - 1) c = s.coatDark;
      else if (x <= x0) c = mix(s.coat, s.coatLight, 0.6);
      if (t > 0.82) c = shade(c, -0.15);
      buf.set(x, y, c);
    }
  }
  // Belt
  const beltY = Math.round(hipY);
  buf.fillRect(Math.round(cx - hipHalf), beltY - 1, Math.round(hipHalf * 2) + 1, 2, s.bootDark);
  buf.set(Math.round(cx), beltY - 1, P.gold);

  if (dir !== 2) {
    // Chest strap running shoulder -> opposite hip.
    buf.line(Math.round(cx - shHalf + 1), Math.round(shY + 1), Math.round(cx + 1), beltY - 2, s.accentDark);
  }
  if (s.coatTail) {
    // A short flared coat below the belt. It swings opposite to the stride,
    // which is most of what makes the walk feel like it has weight.
    // Three rows only. Six turned the coat into a full-length skirt and buried
    // the legs — the walk cycle stopped reading entirely.
    const sw = Math.round(tailSwing * 0.5);
    for (let i = 0; i < 3; i++) {
      const y = beltY + 1 + i;
      const half = hipHalf - 0.2 + i * 0.5;
      const off = Math.round((sw * i) / 2);
      const x0 = Math.round(cx - half) + off;
      const x1 = Math.round(cx + half) + off;
      for (let x = x0; x <= x1; x++) {
        let c = s.coatDark;
        if (x <= x0) c = s.coat;
        else if (x >= x1 - 1) c = shade(s.coatDark, -0.3);
        buf.set(x, y, c);
      }
    }
  }
  if (s.cape) {
    // A short cape peeking out behind the shoulders.
    buf.fillRect(Math.round(cx - shHalf - 1), Math.round(shY), 2, rows, shade(s.coatDark, -0.2));
    buf.fillRect(Math.round(cx + shHalf), Math.round(shY), 2, rows, shade(s.coatDark, -0.2));
  }
}

/**
 * The head is authored, not generated.
 *
 * It is nine pixels across and carries the whole read of the character, so
 * every pixel is placed by hand: the skull silhouette uses the canonical
 * 5-7-9-9-9-9-9-7-5 circle run, the hair highlight sits on the upper-left
 * (following the key light) instead of banding straight across the brow, and
 * the eyes and mouth are single deliberate pixels rather than blended dabs.
 *
 * L/H/D = hair light / mid / dark, S/s = skin / skin shade, e = eye, m = mouth,
 * C/c/k/g = hood light / dark / cavity / eye-glow.
 */
const HEAD_DOWN = [
  '..LLHHH..',
  '.LLHHHHD.',
  'LLHHHHHHD',
  'LHHHHHHHD',
  'LHSSSSSsD',
  'HHSeSeSsD',
  'HHSSmSSsD',
  '.HsSSSss.',
  '..sSSSs..',
];

const HEAD_SIDE = [
  '..LLHHH..',
  '.LLHHHHH.',
  'LLHHHHHHD',
  'LHHHHHSSD',
  'LHHSSSSSs',
  'HHSSSeSSs',
  'HHSSSmSss',
  '.HsSSSss.',
  '..sSSSs..',
];

const HEAD_UP = [
  '..LLHHH..',
  '.LLHHHHD.',
  'LLHHHHHHD',
  'LHHHHHHHD',
  'LHHHHHHHD',
  'HHHHHHHHD',
  'HHHDDDHHD',
  '.HHDDDHH.',
  '..HHHHH..',
];

const HOOD_DOWN = [
  '..CCCCC..',
  '.CCCCCCC.',
  'CCCCCCCCc',
  'CCCkkkCCc',
  'CCkkkkkCc',
  'CCkgkgkCc',
  'CCkkkkkCc',
  '.CCkkkCC.',
  '..CCCCC..',
];

const HOOD_SIDE = [
  '..CCCCC..',
  '.CCCCCCC.',
  'CCCCCCCCc',
  'CCCCkkkCc',
  'CCCkkkkkc',
  'CCCkkgkkc',
  'CCCkkkkkc',
  '.CCCkkkC.',
  '..CCCCC..',
];

const HOOD_UP = [
  '..CCCCC..',
  '.CCCCCCC.',
  'CCCCCCCCc',
  'CCCCCCCCc',
  'CCCCCCCCc',
  'CCCCCCCCc',
  'CCCCCCCCc',
  '.CCCCCCC.',
  '..CCCCC..',
];

function headArt(s: Skin, dir: Dir): PixelBuffer {
  if (s.hooded) {
    const rows = dir === 0 ? HOOD_DOWN : dir === 1 ? HOOD_SIDE : HOOD_UP;
    return parseArt(rows, {
      C: s.coat,
      c: s.coatDark,
      k: shade(s.coatDark, -0.6),
      g: P.magic,
    });
  }
  const rows = dir === 0 ? HEAD_DOWN : dir === 1 ? HEAD_SIDE : HEAD_UP;
  return parseArt(rows, {
    L: mix(s.hair, P.hairLight, 0.55),
    H: s.hair,
    D: s.hairDark,
    S: s.skin,
    s: s.skinDark,
    e: s.ink,
    m: s.skinDark,
  });
}

function drawScarf(buf: PixelBuffer, cx: number, shY: number, s: Skin, dir: Dir, flap: number): void {
  if (!s.scarf) return;
  buf.fillRect(Math.round(cx - 4), Math.round(shY - 1), 9, 2, s.accent);
  buf.hline(cx - 4, cx + 4, Math.round(shY), s.accentDark);
  // Trailing tail, blown by movement.
  const tx = cx + (dir === 1 ? -4 : 3);
  buf.capsule(tx, shY, tx - flap, shY + 3 + Math.abs(flap) * 0.4, 1.2, s.accent);
  buf.set(Math.round(tx - flap), Math.round(shY + 4 + Math.abs(flap) * 0.4), s.accentDark);
}

/** Renders one posed frame of a humanoid into a fresh buffer (no outline yet). */
export function drawHumanoid(s: Skin, dir: Dir, p: Pose, flap = 0): PixelBuffer {
  const buf = new PixelBuffer(FRAME_W, FRAME_H);
  const cx = ANCHOR_X;
  const footY = ANCHOR_Y + p.bob;
  const hipY = footY - 9 + p.crouch;
  const shY = hipY - 7;
  const headY = shY - 5 + p.headY;
  const headX = cx + p.lean * 0.6 + p.headX;

  const legSpread = dir === 1 ? 1.2 : 2.4;
  const armSpread = dir === 1 ? 2.2 : 4.6;

  // Back limbs first.
  drawLeg(
    buf,
    cx - legSpread,
    hipY,
    cx - legSpread + p.legBX,
    footY + p.legBY,
    s,
    true,
  );
  drawArm(
    buf,
    cx - armSpread + p.twist,
    shY + 1,
    cx - armSpread + p.armBX,
    shY + 5 + p.armBY,
    s,
    true,
  );

  // Front leg + torso.
  drawLeg(buf, cx + legSpread, hipY, cx + legSpread + p.legAX, footY + p.legAY, s, false);
  if (dir !== 1) {
    // Front and back views: cut a one-pixel dark seam between the legs, or
    // they merge into a single trouser-shaped mass.
    for (let y = Math.round(hipY) + 2; y <= Math.round(footY) - 2; y++) {
      if (buf.alphaAt(cx, y) > 200) buf.set(cx, y, s.pantsDark);
    }
  }
  drawTorso(buf, cx + p.lean, shY, hipY, s, dir, p.twist, p.tail);
  drawScarf(buf, cx + p.lean, shY, s, dir, flap);
  drawArm(
    buf,
    cx + armSpread + p.lean,
    shY + 1,
    cx + armSpread + p.armAX + p.lean,
    shY + 5 + p.armAY,
    s,
    false,
  );
  // Head: authored pixel art, blitted so it lands on whole pixels.
  buf.blit(headArt(s, dir), Math.round(headX) - 4, Math.round(headY) - 4);
  return buf;
}

function finish(buf: PixelBuffer): PixelBuffer {
  buf.selOutline();
  buf.rimLight(P.white, 0.2);
  return buf;
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

function idlePoses(): Pose[] {
  const out: Pose[] = [];
  for (let i = 0; i < 4; i++) {
    const ph = (i / 4) * Math.PI * 2;
    const breath = Math.sin(ph);
    out.push(
      pose({
        bob: breath > 0.5 ? -1 : 0,
        headY: breath > 0.9 ? -1 : 0,
        armAY: breath * 0.6,
        armBY: -breath * 0.6,
        crouch: breath > 0.5 ? 1 : 0,
      }),
    );
  }
  return out;
}

/**
 * Walk cycle.
 *
 * The timing is the whole animation. A walk has two *contacts* (legs at full
 * stride, body at its lowest) and two *passing* poses (legs together, body at
 * its highest) per cycle — so the vertical bob runs at **twice** the frequency
 * of the leg swing and is in antiphase with the stride. The first version used
 * `bob = -|sin|` against `legX = sin`, which lifted the body exactly when the
 * legs were furthest apart: the character appeared to bounce upward as it
 * lunged, which is why it read as floaty.
 *
 * The head and the coat tail also lag the body by a fraction of a cycle, so
 * they follow through instead of moving as one rigid piece.
 */
function walkPoses(frames = 8, amp = 1): Pose[] {
  const out: Pose[] = [];
  const lag = 0.12; // fraction of a cycle the head/tail trail the hips by
  for (let i = 0; i < frames; i++) {
    const ph = (i / frames) * Math.PI * 2;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    const sLag = Math.sin(ph - lag * Math.PI * 2);
    // +1 at contact (legs apart), -1 at passing (legs together).
    const stride = Math.abs(s);
    const run = amp > 1;
    out.push(
      pose({
        // Down on contact, up on the pass.
        bob: (stride - 0.5) * (run ? 2.4 : 1.5),
        crouch: run ? 1 : 0,
        lean: run ? 1.6 : 0.4,
        legAX: s * 2.8 * amp,
        // The trailing leg lifts its heel just after it leaves the ground.
        legAY: -Math.max(0, Math.sin(ph - 0.6)) * 2.1 * amp,
        legBX: -s * 2.8 * amp,
        legBY: -Math.max(0, Math.sin(ph + Math.PI - 0.6)) * 2.1 * amp,
        armAX: -s * 2 * amp,
        armAY: -stride * 0.9,
        armBX: s * 2 * amp,
        armBY: -stride * 0.9,
        // Head lags the hips and dips slightly on each contact.
        headX: sLag * 0.5 * amp,
        headY: (Math.abs(sLag) - 0.5) * (run ? 1.2 : 0.7),
        twist: c * 0.9 * amp,
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
    pose({ armAX: 2, armAY: -5.5, lean: -1, twist: -1 }),
    pose({ armAX: 3.5, armAY: 1, lean: 1.4, twist: 1.2, bob: 1, crouch: 1 }),
    pose({ armAX: 2.5, armAY: 0.5, lean: 1, twist: 0.8, bob: 0.5 }),
    pose({ armAX: 1, armAY: -1.5, lean: 0, twist: 0 }),
  ];
}

function attackPoses(): Pose[] {
  // Wind up, thrust, hold, recover.
  return [
    pose({ lean: -1.5, armAX: -2.5, armAY: -1, twist: -1, crouch: 1 }),
    pose({ lean: -2, armAX: -3.5, armAY: -2, twist: -1.5, crouch: 1, headX: -1 }),
    pose({ lean: 2, armAX: 5, armAY: -2, twist: 2, legAX: 2, bob: -1 }),
    pose({ lean: 2.5, armAX: 6, armAY: -1, twist: 2.2, legAX: 2.5 }),
    pose({ lean: 1, armAX: 3, armAY: 0, twist: 1, legAX: 1 }),
    pose({ lean: 0, armAX: 1, armAY: 0, twist: 0 }),
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
        legBX: -2.5 * ease,
        armAX: 3.5 * ease,
        armAY: -2 * ease,
        armBX: -3.5 * ease,
        armBY: -1.5 * ease,
        twist: -2 * ease,
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
    const flap = flapScale === 0 ? 0 : Math.sin((i / poses.length) * Math.PI * 2) * flapScale;
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
  /** Every baked sheet, for the asset gallery. */
  sheets: { name: string; dir: Dir; sheet: Sheet }[];
}

/**
 * Villagers only ever idle and walk, so baking their run/attack/death sets
 * would triple the boot cost of a crowded town for frames nothing plays.
 * Those slots alias the walk clips.
 */
export function bakeNpc(s: Skin): CharacterAnims {
  const dirs: Dir[] = [0, 1, 2];
  const idleP = idlePoses();
  const walkP = walkPoses(8, 1);
  const workP = workPoses();
  const idle: Clip[] = [];
  const walk: Clip[] = [];
  const work: Clip[] = [];
  const sheets: { name: string; dir: Dir; sheet: Sheet }[] = [];
  for (const d of dirs) {
    const si = bake(s, d, idleP, 0.6);
    const sw = bake(s, d, walkP, 1.4);
    const sk = bake(s, d, workP, 0.8);
    idle[d] = clip(si, range(si.count), 6);
    walk[d] = clip(sw, range(sw.count), 12);
    work[d] = clip(sk, range(sk.count), 9);
    sheets.push({ name: 'idle', dir: d, sheet: si }, { name: 'walk', dir: d, sheet: sw });
  }
  return { idle, walk, run: walk, attack: idle, death: idle, work, sheets };
}

export function bakeCharacter(s: Skin): CharacterAnims {
  const dirs: Dir[] = [0, 1, 2];
  const idleP = idlePoses();
  const walkP = walkPoses(8, 1);
  const runP = walkPoses(8, 1.75);
  const atkP = attackPoses();

  const idle: Clip[] = [];
  const walk: Clip[] = [];
  const run: Clip[] = [];
  const attack: Clip[] = [];
  const death: Clip[] = [];
  const sheets: { name: string; dir: Dir; sheet: Sheet }[] = [];

  for (const d of dirs) {
    const si = bake(s, d, idleP, 0.6);
    const sw = bake(s, d, walkP, 1.4);
    const sr = bake(s, d, runP, 2.6);
    const sa = bake(s, d, atkP, 1.2);
    const sd = bakeSheet(
      bakeDeath(s, d).map((f) => f),
      ANCHOR_X,
      ANCHOR_Y,
    );
    idle[d] = clip(si, range(si.count), 6);
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
  }
  return { idle, walk, run, attack, death, sheets };
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

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
import { PixelBuffer, mix, rgba, shade, type RGBA } from './pixel';
import { P, R } from './palette';
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
};

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
  // Boot: a stubby foot pointing "down-screen".
  buf.fillRect(Math.round(fx) - 2, Math.round(fy) - 2, 4, 2, boot);
  buf.blend(Math.round(fx) - 2, Math.round(fy) - 1, isBack ? back(s.bootDark) : s.bootDark);
  buf.blend(Math.round(fx) + 1, Math.round(fy) - 1, isBack ? back(s.bootDark) : s.bootDark);
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
  // Cuff + hand
  buf.capsule(hx, hy, hx, hy, 1.3, isBack ? back(s.accentDark) : s.accentDark);
  buf.ellipse(hx, hy + 1, 1.4, 1.4, skin);
}

function drawTorso(buf: PixelBuffer, cx: number, shY: number, hipY: number, s: Skin, dir: Dir, twist: number): void {
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
  if (s.cape) {
    // A short cape peeking out behind the shoulders.
    buf.fillRect(Math.round(cx - shHalf - 1), Math.round(shY), 2, rows, shade(s.coatDark, -0.2));
    buf.fillRect(Math.round(cx + shHalf), Math.round(shY), 2, rows, shade(s.coatDark, -0.2));
  }
}

function drawHead(buf: PixelBuffer, cx: number, cy: number, s: Skin, dir: Dir): void {
  const faceShift = dir === 1 ? 1 : 0;
  // Skull. Deliberately oversized relative to the body — a chunky head is what
  // keeps a 22px-tall character readable when it is 3 screen-pixels wide.
  buf.ellipse(cx, cy, 4.5, 4.6, s.skin);
  // Jaw shading
  for (let y = Math.floor(cy); y <= Math.ceil(cy + 4); y++) {
    for (let x = Math.floor(cx - 5); x <= Math.ceil(cx + 5); x++) {
      const dx = (x - cx) / 4.5;
      const dy = (y - cy) / 4.6;
      if (dx * dx + dy * dy <= 1 && y >= cy + 2) buf.blend(x, y, rgba(s.skinDark, 150));
    }
  }
  if (s.hooded) {
    // Hood: full cowl with a dark face hole.
    buf.ellipse(cx, cy - 0.5, 4.6, 4.8, s.coat);
    buf.ellipse(cx - 4.4, cy + 1, 1.6, 2.2, s.coatDark);
    buf.ellipse(cx + 4.4, cy + 1, 1.6, 2.2, s.coatDark);
    if (dir !== 2) {
      buf.ellipse(cx + faceShift, cy + 1.2, 2.6, 2.4, shade(s.coatDark, -0.55));
      if (dir === 0) {
        buf.set(Math.round(cx - 1), Math.round(cy + 1), P.magic);
        buf.set(Math.round(cx + 1), Math.round(cy + 1), P.magic);
      } else {
        buf.set(Math.round(cx + 1), Math.round(cy + 1), P.magic);
      }
    }
    return;
  }
  // Hair cap, then carve the face back out.
  buf.ellipse(cx, cy - 1.3, 4.8, 4.1, s.hair);
  buf.ellipse(cx, cy - 2.2, 4.5, 2.7, mix(s.hair, P.hairLight, 0.45));
  if (dir !== 2) {
    buf.ellipse(cx + faceShift, cy + 1.3, 3.7, 3.4, s.skin);
    for (let y = Math.floor(cy + 2); y <= Math.ceil(cy + 5); y++)
      for (let x = Math.floor(cx - 4); x <= Math.ceil(cx + 5); x++) {
        const dx = (x - cx - faceShift) / 3.7;
        const dy = (y - cy - 1.3) / 3.4;
        if (dx * dx + dy * dy <= 1) buf.blend(x, y, rgba(s.skinDark, 110));
      }
    // Fringe sitting on the brow, plus sideburns.
    buf.hline(cx - 3, cx + 3, Math.round(cy - 1), s.hair);
    buf.set(Math.round(cx - 4), Math.round(cy), s.hair);
    buf.set(Math.round(cx + 4), Math.round(cy), s.hair);
    buf.set(Math.round(cx - 2), Math.round(cy - 1), mix(s.hair, P.hairLight, 0.5));
    // Eyes
    if (dir === 0) {
      buf.set(Math.round(cx - 2), Math.round(cy + 1), s.ink);
      buf.set(Math.round(cx + 2), Math.round(cy + 1), s.ink);
      buf.blend(Math.round(cx), Math.round(cy + 3), rgba(s.skinDark, 200));
    } else {
      buf.set(Math.round(cx + 2), Math.round(cy + 1), s.ink);
      buf.blend(Math.round(cx + 3), Math.round(cy + 2), rgba(s.skinDark, 190));
    }
  } else {
    // Back of the head: hair all over, with a small tuft.
    buf.ellipse(cx, cy + 0.6, 3.6, 3.2, s.hair);
    buf.set(Math.round(cx), Math.round(cy + 4), s.hairDark);
  }
  // Hair outline shadow under the cap
  buf.hline(cx - 4, cx + 4, Math.round(cy - 4), s.hairDark);
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
  drawTorso(buf, cx + p.lean, shY, hipY, s, dir, p.twist);
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
  drawHead(buf, headX, headY, s, dir);
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

function walkPoses(frames = 8, amp = 1): Pose[] {
  const out: Pose[] = [];
  for (let i = 0; i < frames; i++) {
    const ph = (i / frames) * Math.PI * 2;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    out.push(
      pose({
        bob: -Math.abs(s) * (amp > 1 ? 1.6 : 1),
        crouch: amp > 1 ? 1 : 0,
        lean: amp > 1 ? 1.2 : 0,
        legAX: s * 2.6 * amp,
        legAY: -Math.max(0, s) * 2 * amp,
        legBX: -s * 2.6 * amp,
        legBY: -Math.max(0, -s) * 2 * amp,
        armAX: -s * 1.8 * amp,
        armAY: -Math.abs(s) * 0.8,
        armBX: s * 1.8 * amp,
        armBY: -Math.abs(s) * 0.8,
        twist: c * 0.8 * amp,
      }),
    );
  }
  return out;
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
  /** Every baked sheet, for the asset gallery. */
  sheets: { name: string; dir: Dir; sheet: Sheet }[];
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

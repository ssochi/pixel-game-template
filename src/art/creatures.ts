/**
 * A non-humanoid creature, to show that the animation pipeline is not tied to
 * the character rig: the slime is pure squash-and-stretch maths.
 */
import { PixelBuffer, mix, rgba, shade, type RGBA } from './pixel';
import { P } from './palette';
import { bakeSheet, clip, type Clip } from './sheet';
import { RNG } from '../engine/rng';

const FW = 28;
const FH = 26;
const AX = 14;
const AY = 22;

function slimeFrame(squash: number, stretch: number, lift: number, color: RGBA, alpha = 1, splat = 0): PixelBuffer {
  const b = new PixelBuffer(FW, FH);
  const rx = 8 * squash;
  const ry = 6.5 * stretch;
  const cy = AY - ry + 0.5 - lift;

  b.groundShadow(AX, AY - 1, rx * (1 - lift * 0.02), 2.4, 110);

  if (splat > 0) {
    // Death: a spreading puddle instead of a body.
    const s = splat;
    b.ellipse(AX, AY - 2, 5 + s * 9, 2 + s * 3.6, rgba(shade(color, -0.35), 220 * alpha));
    b.ellipse(AX - 2, AY - 2.5, 3 + s * 6, 1.4 + s * 2.4, rgba(color, 200 * alpha));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.ellipse(AX + Math.cos(a) * (6 + s * 8), AY - 2 + Math.sin(a) * (2 + s * 3), 1.4, 1, rgba(color, 180 * alpha));
    }
    if (alpha >= 1) b.selOutline();
    else b.outline(rgba(P.ink, 200 * alpha));
    return b;
  }

  // Body
  b.ellipse(AX, cy, rx, ry, rgba(shade(color, -0.3), 235 * alpha));
  b.ellipse(AX, cy + 0.5, rx - 1, ry - 1, rgba(color, 225 * alpha));
  // Translucent belly + highlight
  b.ellipse(AX - rx * 0.3, cy - ry * 0.35, rx * 0.4, ry * 0.35, rgba(mix(color, P.white, 0.55), 200 * alpha));
  b.set(Math.round(AX - rx * 0.55), Math.round(cy - ry * 0.5), rgba(P.white, 220 * alpha));
  // Drips along the bottom edge
  const rng = new RNG(4);
  for (let i = 0; i < 3; i++) {
    const dx = rng.range(-rx * 0.7, rx * 0.7);
    b.ellipse(AX + dx, cy + ry - 0.5, 1.4, 1.8 + rng.range(0, 1), rgba(shade(color, -0.2), 220 * alpha));
  }
  // Eyes: a 2x2 white with a single dark pupil pixel. Anything softer turns
  // into a grey smear once the sprite is quantised.
  const ey = Math.round(cy - ry * 0.1);
  for (const ex of [AX - 3, AX + 2]) {
    b.fillRect(ex, ey - 1, 2, 3, rgba(P.white, 240 * alpha));
    b.set(ex + (ex < AX ? 0 : 1), ey, rgba(P.ink, 255 * alpha));
  }
  if (alpha >= 1) b.selOutline();
  else b.outline(rgba(P.ink, 235 * alpha));
  b.rimLight(P.white, 0.25);
  return b;
}

export interface SlimeAnims {
  idle: Clip;
  move: Clip;
  attack: Clip;
  death: Clip;
}

export function bakeSlime(color: RGBA = P.leafLight): SlimeAnims {
  const mk = (frames: PixelBuffer[], fps: number, loop = true): Clip =>
    clip(bakeSheet(frames, AX, AY), frames.map((_, i) => i), fps, loop);

  const idle = mk(
    Array.from({ length: 6 }, (_, i) => {
      const t = (i / 6) * Math.PI * 2;
      const s = Math.sin(t);
      return slimeFrame(1 + s * 0.07, 1 - s * 0.09, 0, color);
    }),
    8,
  );

  const move = mk(
    Array.from({ length: 8 }, (_, i) => {
      const t = i / 8;
      // Crouch, launch, float, land.
      const hop = Math.max(0, Math.sin(t * Math.PI * 2));
      const crouch = t < 0.18 || t > 0.86 ? 1 : 0;
      return slimeFrame(1 + crouch * 0.22 - hop * 0.14, 1 - crouch * 0.28 + hop * 0.22, hop * 7, color);
    }),
    12,
  );

  const attack = mk(
    [
      slimeFrame(1.28, 0.7, 0, color),
      slimeFrame(1.3, 0.68, 0, color),
      slimeFrame(0.78, 1.4, 5, color),
      slimeFrame(0.86, 1.28, 2, color),
      slimeFrame(1.16, 0.86, 0, color),
      slimeFrame(1, 1, 0, color),
    ],
    14,
    false,
  );

  const death = mk(
    Array.from({ length: 7 }, (_, i) => {
      const t = i / 6;
      if (t < 0.3) return slimeFrame(1 + t * 0.8, 1 - t * 0.9, 0, color, 1);
      const s = (t - 0.3) / 0.7;
      return slimeFrame(1, 1, 0, color, 1 - s * 0.55, s);
    }),
    10,
    false,
  );

  return { idle, move, attack, death };
}

/**
 * Farm animals.
 *
 * Two rigs cover the whole barnyard: a quadruped (cow, pig, sheep, goat) and a
 * bird (chicken, duck). Both are posed the same way the humanoid is — a pose
 * function per frame feeding one drawing routine — so a new animal is a colour
 * scheme and four numbers, not a new sprite sheet.
 *
 * Side view only, mirrored for the other direction. Livestock read fine that
 * way from above and it halves the frame count.
 */
import { PixelBuffer, type RGBA } from './pixel';
import { P, R, type Ramp } from './palette';
import { bakeSheet, clip, type Clip } from './sheet';

export interface AnimalAnims {
  idle: Clip;
  walk: Clip;
  /** Eating / pecking at the ground. */
  graze: Clip;
}

// ---------------------------------------------------------------------------
// Quadrupeds
// ---------------------------------------------------------------------------

export interface QuadOpts {
  bodyW: number;
  bodyH: number;
  legH: number;
  coat: Ramp;
  /** Woolly outline (sheep) instead of a smooth one. */
  fluffy?: boolean;
  horns?: boolean;
  ears?: 'flop' | 'perk';
  /** Patches of a second colour (cows). */
  patches?: Ramp;
  tail?: 'tuft' | 'curl' | 'none';
  snout?: 'blunt' | 'round';
  frameW?: number;
  frameH?: number;
}

interface QuadPose {
  legFront: number;
  legBack: number;
  bob: number;
  headDrop: number;
  headX: number;
  tail: number;
}

function drawQuad(o: QuadOpts, p: QuadPose): PixelBuffer {
  const fw = o.frameW ?? 32;
  const fh = o.frameH ?? 26;
  const b = new PixelBuffer(fw, fh);
  const groundY = fh - 3;
  const bodyBottom = groundY - o.legH + p.bob;
  const bodyTop = bodyBottom - o.bodyH;
  const cx = Math.round(fw / 2);
  const x0 = cx - Math.round(o.bodyW / 2);
  const x1 = x0 + o.bodyW;

  b.groundShadow(cx, groundY, o.bodyW * 0.5, 2, 110);

  // Four legs: a fore/hind pair on the near side and the same pair on the far
  // side, offset and one value darker. Placing them at fixed fractions of the
  // body rather than fixed pixel insets is what stops the pairs collapsing on
  // top of each other on the smaller animals.
  const foreX = x1 - 5;
  const hindX = x0 + 2;
  const drawLeg = (lx: number, swing: number, dark: boolean): void => {
    const c = dark ? o.coat[1] : o.coat[2];
    const hoof = dark ? R.night[1] : R.night[2];
    const x = lx + Math.round(swing);
    b.fillRect(x, bodyBottom - 2, 3, o.legH + 2, c);
    b.vline(x, bodyBottom - 2, groundY - 1, dark ? o.coat[0] : o.coat[1]);
    b.fillRect(x, groundY - 2, 3, 2, hoof);
  };
  // Far pair, behind the body.
  drawLeg(hindX + 2, -p.legBack, true);
  drawLeg(foreX - 2, -p.legFront, true);

  // Barrel body: a rounded slab, lit along the spine.
  b.ellipse(cx, (bodyTop + bodyBottom) / 2, o.bodyW / 2, o.bodyH / 2, o.coat[2]);
  b.fillRect(x0 + 1, bodyTop + 1, o.bodyW - 2, o.bodyH - 2, o.coat[2]);
  b.fillRect(x0 + 1, bodyTop, o.bodyW - 2, 2, o.coat[3]);
  // Spine highlight over the middle only — running it the full length reads as
  // a plank laid along the animal's back.
  b.hline(x0 + Math.round(o.bodyW * 0.3), x1 - Math.round(o.bodyW * 0.3), bodyTop, o.coat[4]);
  b.fillRect(x0 + 1, bodyBottom - 2, o.bodyW - 2, 2, o.coat[1]);

  if (o.patches) {
    // Two big irregular patches — a cow is not speckled, it is blotched.
    b.ellipse(x0 + 6, bodyTop + 4, 4, 3, o.patches[1]);
    b.ellipse(x1 - 8, bodyTop + o.bodyH - 5, 5, 3, o.patches[1]);
    b.ellipse(x0 + 5, bodyTop + 3, 2.4, 1.6, o.patches[2]);
  }
  if (o.fluffy) {
    // Woolly silhouette: bumps around the top and sides.
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      b.ellipse(x0 + 2 + t * (o.bodyW - 4), bodyTop + 1, 3, 2.6, o.coat[3]);
    }
    for (let i = 0; i < 3; i++) b.ellipse(x0 + 1, bodyTop + 3 + i * 3, 2.4, 2.2, o.coat[3]);
    for (let i = 0; i < 3; i++) b.ellipse(x1 - 2, bodyTop + 3 + i * 3, 2.4, 2.2, o.coat[2]);
  }

  // Near pair, in front of the body.
  drawLeg(hindX, p.legBack, false);
  drawLeg(foreX, p.legFront, false);

  // Tail
  if (o.tail === 'tuft') {
    const ty = bodyTop + 2;
    b.line(x0, ty, x0 - 3 + p.tail, ty + 6, o.coat[1]);
    b.ellipse(x0 - 3 + p.tail, ty + 7, 1.6, 2, o.coat[1]);
  } else if (o.tail === 'curl') {
    b.set(x0 - 1, bodyTop + 2, o.coat[1]);
    b.set(x0 - 2, bodyTop + 3, o.coat[1]);
    b.set(x0 - 1, bodyTop + 4, o.coat[1]);
  }

  // Head: a block with a snout, on a short neck so it doesn't merge into the
  // barrel of the body. Drops to the ground when grazing.
  const hx = x1 - 1 + p.headX;
  const hy = bodyTop + 1 + p.headDrop;
  const headW = Math.max(7, Math.round(o.bodyW * 0.34));
  const headH = Math.max(6, Math.round(o.bodyH * 0.75));
  b.capsule(x1 - 3, bodyTop + 2, hx + 2, hy + 2, 2, o.coat[2]);
  b.fillRect(hx, hy, headW, headH, o.coat[2]);
  b.fillRect(hx, hy, headW, 2, o.coat[3]);
  b.vline(hx, hy, hy + headH - 1, o.coat[3]);
  b.vline(hx + headW - 1, hy, hy + headH - 1, o.coat[1]);
  b.fillRect(hx + headW - 3, hy + headH - 3, 3, 3, o.snout === 'round' ? R.skin[2] : o.coat[1]);
  b.set(hx + headW - 2, hy + headH - 2, R.night[1]);
  // Eye
  b.set(hx + headW - 4, hy + 2, P.ink);
  if (o.ears === 'flop') {
    b.fillRect(hx - 1, hy + 1, 2, 4, o.coat[1]);
  } else if (o.ears === 'perk') {
    b.set(hx + 1, hy - 1, o.coat[3]);
    b.set(hx + headW - 3, hy - 1, o.coat[3]);
  }
  if (o.horns) {
    b.set(hx + 1, hy - 1, R.paper[3]);
    b.set(hx, hy - 2, R.paper[4]);
    b.set(hx + headW - 2, hy - 1, R.paper[3]);
    b.set(hx + headW - 1, hy - 2, R.paper[4]);
  }

  b.selOutline();
  return b;
}

export function bakeQuadruped(o: QuadOpts): AnimalAnims {
  const fw = o.frameW ?? 32;
  const fh = o.frameH ?? 26;
  const ax = Math.round(fw / 2);
  const ay = fh - 3;
  const mk = (frames: PixelBuffer[], fps: number): Clip =>
    clip(bakeSheet(frames, ax, ay), frames.map((_, i) => i), fps);

  const idle = mk(
    [0, 1, 2, 3].map((i) => {
      const s = Math.sin((i / 4) * Math.PI * 2);
      return drawQuad(o, { legFront: 0, legBack: 0, bob: s > 0.5 ? -1 : 0, headDrop: 0, headX: 0, tail: s > 0 ? 1 : 0 });
    }),
    4,
  );

  const walk = mk(
    [0, 1, 2, 3, 4, 5].map((i) => {
      const ph = (i / 6) * Math.PI * 2;
      const s = Math.sin(ph);
      return drawQuad(o, {
        legFront: s * 2,
        legBack: -s * 2,
        bob: -Math.abs(s) * 1,
        headDrop: 0,
        headX: Math.round(s * 0.6),
        tail: Math.round(Math.cos(ph) * 1.5),
      });
    }),
    8,
  );

  const graze = mk(
    [0, 1, 2, 3].map((i) => {
      const drop = i === 0 ? 2 : o.bodyH - 1;
      return drawQuad(o, { legFront: 0, legBack: 0, bob: 0, headDrop: drop, headX: 1, tail: i % 2 });
    }),
    3,
  );

  return { idle, walk, graze };
}

// ---------------------------------------------------------------------------
// Birds
// ---------------------------------------------------------------------------

export interface BirdOpts {
  body: Ramp;
  comb?: RGBA;
  beak: RGBA;
  tailUp?: boolean;
  size?: number;
  /** Sits low in the water instead of standing on legs. */
  swims?: boolean;
  /** Separate head colour — a mallard's green head against a pale body. */
  headRamp?: Ramp;
}

interface BirdPose {
  headDrop: number;
  legSwing: number;
  bob: number;
  wing: number;
}

function drawBird(o: BirdOpts, p: BirdPose): PixelBuffer {
  const s = o.size ?? 1;
  const fw = 18;
  const fh = 18;
  const b = new PixelBuffer(fw, fh);
  const groundY = fh - 3;
  const legH = o.swims ? 0 : Math.round(3 * s);
  const bodyW = Math.round(9 * s);
  const bodyH = Math.round(7 * s);
  const cx = 8;
  const bodyBottom = groundY - legH + p.bob;
  const bodyTop = bodyBottom - bodyH;

  if (!o.swims) b.groundShadow(cx, groundY, bodyW * 0.5, 1.6, 100);

  // Legs
  if (!o.swims) {
    for (const [lx, sw] of [
      [cx - 2, p.legSwing],
      [cx + 1, -p.legSwing],
    ] as [number, number][]) {
      b.vline(lx + sw, bodyBottom - 1, groundY - 1, o.beak);
      b.hline(lx + sw - 1, lx + sw + 1, groundY - 1, o.beak);
    }
  }

  // Body
  b.ellipse(cx, (bodyTop + bodyBottom) / 2, bodyW / 2, bodyH / 2, o.body[2]);
  b.ellipse(cx - 1, (bodyTop + bodyBottom) / 2 - 1, bodyW / 2 - 1, bodyH / 2 - 1, o.body[3]);
  // Wing: a shaped block, not a smudge.
  b.ellipse(cx + 1, (bodyTop + bodyBottom) / 2 + p.wing, bodyW / 3, bodyH / 3.4, o.body[1]);
  // Tail
  if (o.tailUp) {
    b.fillRect(cx - bodyW / 2 - 2, bodyTop, 3, 2, o.body[1]);
    b.set(cx - bodyW / 2 - 3, bodyTop - 1, o.body[2]);
  } else {
    b.fillRect(cx - bodyW / 2 - 2, bodyTop + 2, 3, 2, o.body[1]);
  }

  // Head + neck
  const hx = cx + Math.round(bodyW / 2) - 1;
  const hy = bodyTop - Math.round(3 * s) + p.headDrop;
  const head = o.headRamp ?? o.body;
  b.capsule(hx - 1, bodyTop + 1, hx, hy + 2, 1.4, head[2]);
  b.ellipse(hx, hy + 1, 2 * s, 2 * s, head[3]);
  b.set(hx + 1, hy, P.ink);
  // Beak
  b.fillRect(hx + 2, hy + 1, 2, 1, o.beak);
  if (o.comb) {
    b.set(hx - 1, hy - 2, o.comb);
    b.set(hx, hy - 2, o.comb);
    b.set(hx + 1, hy - 1, o.comb);
    b.set(hx + 1, hy + 3, o.comb); // wattle
  }
  b.selOutline();

  if (o.swims) {
    // A little bow-wave in front of a swimming bird.
    b.hline(cx - 5, cx + 5, groundY - 1, rgba(R.water[4], 170));
    b.hline(cx - 3, cx + 3, groundY, rgba(R.water[3], 140));
  }
  return b;
}

function rgba(c: RGBA, a: number): RGBA {
  return [c[0], c[1], c[2], a];
}

export function bakeBird(o: BirdOpts): AnimalAnims {
  const mk = (frames: PixelBuffer[], fps: number): Clip =>
    clip(bakeSheet(frames, 8, 15), frames.map((_, i) => i), fps);

  const idle = mk(
    [0, 1, 2, 1].map((i) => drawBird(o, { headDrop: 0, legSwing: 0, bob: i === 2 ? -1 : 0, wing: i === 1 ? 1 : 0 })),
    4,
  );
  const walk = mk(
    [0, 1, 2, 3].map((i) => {
      const s = Math.sin((i / 4) * Math.PI * 2);
      return drawBird(o, { headDrop: Math.round(s), legSwing: Math.round(s * 2), bob: -Math.abs(s), wing: 0 });
    }),
    8,
  );
  // Pecking: down, down, up, look around.
  const graze = mk(
    [5, 6, 6, 2, 0].map((d) => drawBird(o, { headDrop: d, legSwing: 0, bob: 0, wing: 0 })),
    5,
  );
  return { idle, walk, graze };
}

// ---------------------------------------------------------------------------

export interface AnimalAssets {
  cow: AnimalAnims;
  pig: AnimalAnims;
  sheep: AnimalAnims;
  goat: AnimalAnims;
  chicken: AnimalAnims;
  duck: AnimalAnims;
}

export function bakeAnimals(): AnimalAssets {
  return {
    cow: bakeQuadruped({
      bodyW: 20,
      bodyH: 11,
      legH: 7,
      coat: R.paper,
      patches: R.night,
      ears: 'flop',
      horns: true,
      tail: 'tuft',
      snout: 'round',
      frameW: 36,
      frameH: 28,
    }),
    pig: bakeQuadruped({
      bodyW: 15,
      bodyH: 9,
      legH: 4,
      coat: R.red,
      ears: 'flop',
      tail: 'curl',
      snout: 'round',
      frameW: 28,
      frameH: 22,
    }),
    sheep: bakeQuadruped({
      bodyW: 15,
      bodyH: 9,
      legH: 5,
      coat: R.paper,
      fluffy: true,
      ears: 'flop',
      tail: 'none',
      frameW: 28,
      frameH: 24,
    }),
    goat: bakeQuadruped({
      bodyW: 13,
      bodyH: 8,
      legH: 6,
      coat: R.sand,
      horns: true,
      ears: 'perk',
      tail: 'tuft',
      frameW: 26,
      frameH: 24,
    }),
    chicken: bakeBird({ body: R.paper, comb: R.red[3], beak: R.gold[3], tailUp: true, size: 1 }),
    // Mallard: pale body, green head, orange bill.
    duck: bakeBird({ body: R.paper, headRamp: R.leaf, beak: R.gold[3], size: 1.15, swims: true }),
  };
}

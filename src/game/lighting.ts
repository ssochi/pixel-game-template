/**
 * 2D pixel lighting.
 *
 * The scene is drawn fully lit, then a light map (ambient colour + additive
 * radial lights) is multiplied over it, then the bright cores are added back
 * on top as a bloom pass. Every gradient uses stepped colour stops so the
 * falloff bands like an old 16-bit game instead of looking like a soft
 * Photoshop glow.
 */
import type { RGBA } from '../art/pixel';
import { mix } from '../art/pixel';
import { hash2 } from '../engine/rng';

export interface Light {
  x: number;
  y: number;
  radius: number;
  color: RGBA;
  intensity: number;
  /** 0..1 — random per-frame brightness jitter (torches). */
  flicker?: number;
  /** 0..1 — smooth sine breathing (crystals, magic). */
  pulse?: number;
  pulseSpeed?: number;
  /** Stable per-light seed for the flicker noise. */
  seed?: number;
  /** Cone lights: direction (rad) + half-angle. Omit for omni. */
  dir?: number;
  cone?: number;
  /** Set false to skip the additive bloom pass for this light. */
  bloom?: boolean;
}

/** Ambient colour presets for the day/night cycle (0 = midnight). */
const SKY: { t: number; c: RGBA; s: number }[] = [
  { t: 0.0, c: [38, 46, 84, 255], s: 0.28 },
  { t: 0.18, c: [64, 66, 104, 255], s: 0.42 },
  { t: 0.26, c: [168, 132, 122, 255], s: 0.72 },
  { t: 0.35, c: [226, 220, 200, 255], s: 0.95 },
  { t: 0.55, c: [255, 250, 235, 255], s: 1.0 },
  { t: 0.7, c: [240, 206, 168, 255], s: 0.9 },
  { t: 0.78, c: [198, 130, 110, 255], s: 0.66 },
  { t: 0.86, c: [96, 82, 122, 255], s: 0.44 },
  { t: 1.0, c: [38, 46, 84, 255], s: 0.28 },
];

export function ambientAt(dayT: number): { color: RGBA; strength: number } {
  const t = ((dayT % 1) + 1) % 1;
  for (let i = 0; i < SKY.length - 1; i++) {
    const a = SKY[i];
    const b = SKY[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t);
      return { color: mix(a.c, b.c, k), strength: a.s + (b.s - a.s) * k };
    }
  }
  return { color: SKY[0].c, strength: SKY[0].s };
}

function css(c: RGBA, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** Clamp to the 0..1 range. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class Lighting {
  enabled = true;
  bloom = true;

  private map: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;

  constructor(w: number, h: number) {
    this.map = document.createElement('canvas');
    this.map.width = w;
    this.map.height = h;
    this.mctx = this.map.getContext('2d')!;
  }

  resize(w: number, h: number): void {
    if (this.map.width === w && this.map.height === h) return;
    this.map.width = w;
    this.map.height = h;
  }

  private lightAlpha(l: Light, time: number): number {
    let a = l.intensity;
    if (l.flicker) {
      // Two out-of-phase noise samples: a fast twitch plus a slow surge.
      const s = l.seed ?? 0;
      const fast = hash2(Math.floor(time * 22) + s, s * 7 + 3);
      const slow = Math.sin(time * 3.1 + s) * 0.5 + 0.5;
      a *= 1 - l.flicker * (0.55 * fast + 0.45 * (1 - slow));
    }
    if (l.pulse) {
      a *= 1 - l.pulse * (0.5 + 0.5 * Math.sin(time * (l.pulseSpeed ?? 2) + (l.seed ?? 0)));
    }
    return a;
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    l: Light,
    x: number,
    y: number,
    alpha: number,
    scale: number,
    gain: number,
  ): void {
    const r = Math.max(1, l.radius * scale);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    // Continuous quadratic falloff: alpha ~ (1-t)^2. The pixel look comes
    // from the light map itself being a 448x252 low-res buffer, not from
    // banding the gradient into hard rings.
    const QUAD_STOPS = 5;
    for (let i = 0; i <= QUAD_STOPS; i++) {
      const t = i / QUAD_STOPS;
      const fall = (1 - t) * (1 - t);
      g.addColorStop(t, css(l.color, alpha * fall * gain));
    }
    ctx.fillStyle = g;
    if (l.cone !== undefined && l.dir !== undefined) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, l.dir - l.cone, l.dir + l.cone);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Interiors: a fixed ambient tint instead of the day/night curve. A room has
   * no sky, so its base level comes from the room itself and the lamps and
   * hearth do the rest.
   */
  renderInterior(
    ctx: CanvasRenderingContext2D,
    lights: Light[],
    camX: number,
    camY: number,
    w: number,
    h: number,
    time: number,
    ambient: [number, number, number],
  ): void {
    if (!this.enabled) return;
    const m = this.mctx;
    m.globalCompositeOperation = 'source-over';
    m.globalAlpha = 1;
    m.fillStyle = `rgb(${ambient[0]},${ambient[1]},${ambient[2]})`;
    m.fillRect(0, 0, w, h);
    m.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      this.paint(m, l, Math.round(l.x - camX), Math.round(l.y - camY), this.lightAlpha(l, time), 1, 1);
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.map, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (!this.bloom) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (l.bloom === false) continue;
      this.paint(ctx, l, Math.round(l.x - camX), Math.round(l.y - camY), this.lightAlpha(l, time) * 0.3, 0.55, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Composite the light map over an already-rendered scene.
   * `ctx` must be the internal-resolution game context, untransformed.
   */
  render(
    ctx: CanvasRenderingContext2D,
    lights: Light[],
    camX: number,
    camY: number,
    w: number,
    h: number,
    time: number,
    dayT: number,
  ): void {
    if (!this.enabled) return;
    const amb = ambientAt(dayT);
    const m = this.mctx;
    m.globalCompositeOperation = 'source-over';
    m.fillStyle = css(amb.color, 1);
    m.globalAlpha = 1;
    m.fillRect(0, 0, w, h);

    // Ambient strength: scale the base level down at night so lights matter.
    m.globalCompositeOperation = 'multiply';
    m.fillStyle = css([255, 255, 255, 255], 1);
    m.globalAlpha = 1;
    const k = amb.strength;
    m.fillStyle = `rgb(${(255 * k) | 0},${(255 * k) | 0},${(255 * k) | 0})`;
    m.fillRect(0, 0, w, h);

    // Ambient darkness factor: lights fully fade out in broad daylight and
    // reach full strength once dusk gets going, so the player's own lamp
    // isn't a visible halo at high noon.
    const dayK = clamp01((1 - amb.strength) * 2.4);

    m.globalCompositeOperation = 'lighter';
    if (dayK > 0) {
      for (const l of lights) {
        const x = Math.round(l.x - camX);
        const y = Math.round(l.y - camY);
        if (x < -l.radius || y < -l.radius || x > w + l.radius || y > h + l.radius) continue;
        this.paint(m, l, x, y, this.lightAlpha(l, time) * dayK, 1, 1);
      }
    }

    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.map, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    if (!this.bloom || dayK <= 0) return;
    // Additive core glow, strongest when the scene is dark.
    const bloomK = Math.max(0, 1 - amb.strength) * 0.85 + 0.12;
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (l.bloom === false) continue;
      const x = Math.round(l.x - camX);
      const y = Math.round(l.y - camY);
      if (x < -l.radius || y < -l.radius || x > w + l.radius || y > h + l.radius) continue;
      this.paint(ctx, l, x, y, this.lightAlpha(l, time) * dayK * bloomK * 0.5, 0.55, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

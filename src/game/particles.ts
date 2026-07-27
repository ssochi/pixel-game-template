/** Chunky single-pixel particles: dust, sparks, splashes, blood, embers. */
import type { RGBA } from '../art/pixel';
import { P, R } from '../art/palette';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Height above the ground, for a cheap fake Z. */
  z: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  colors: RGBA[];
  gravity: number;
  drag: number;
  /** Renders additively — used for sparks and embers. */
  glow?: boolean;
}

export class Particles {
  readonly list: Particle[] = [];

  spawn(p: Partial<Particle> & { x: number; y: number }): void {
    if (this.list.length > 900) this.list.shift();
    this.list.push({
      vx: 0,
      vy: 0,
      z: 0,
      vz: 0,
      life: 0.5,
      maxLife: 0.5,
      size: 1,
      colors: [P.white],
      gravity: 0,
      drag: 2,
      ...p,
    });
  }

  dust(x: number, y: number, dirX: number, dirY: number): void {
    for (let i = 0; i < 3; i++) {
      const a = Math.atan2(-dirY, -dirX) + (Math.random() - 0.5) * 1.2;
      const s = 8 + Math.random() * 18;
      this.spawn({
        x: x + (Math.random() - 0.5) * 4,
        y: y - 1,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.5,
        vz: 4 + Math.random() * 12,
        gravity: 40,
        drag: 3,
        life: 0.35 + Math.random() * 0.25,
        maxLife: 0.6,
        size: Math.random() < 0.35 ? 2 : 1,
        colors: [P.sand, P.sandDark, P.dirt],
      });
    }
  }

  splash(x: number, y: number, power = 1): void {
    for (let i = 0; i < 10 * power; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const s = (18 + Math.random() * 34) * power;
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.35,
        vz: 20 + Math.random() * 40 * power,
        gravity: 150,
        drag: 0.6,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.8,
        size: Math.random() < 0.3 ? 2 : 1,
        colors: [P.waterFoam, P.waterLight, P.water],
      });
    }
  }

  sparks(x: number, y: number, dir: number, n = 6): void {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * 1.1;
      const s = 40 + Math.random() * 90;
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: Math.random() * 8,
        gravity: 90,
        drag: 3.5,
        life: 0.12 + Math.random() * 0.2,
        maxLife: 0.3,
        size: 1,
        colors: [P.fireHot, P.fire, P.white],
        glow: true,
      });
    }
  }

  blood(x: number, y: number, dir: number): void {
    for (let i = 0; i < 12; i++) {
      const a = dir + (Math.random() - 0.5) * 2;
      const s = 20 + Math.random() * 70;
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.6,
        vz: 10 + Math.random() * 30,
        gravity: 170,
        drag: 1.2,
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1,
        size: Math.random() < 0.4 ? 2 : 1,
        colors: [P.blood, P.bloodDark],
      });
    }
  }

  /** Chimney and forge smoke: slow, rising, fading from warm grey to nothing. */
  smoke(x: number, y: number): void {
    this.spawn({
      x: x + (Math.random() - 0.5) * 3,
      y,
      vx: (Math.random() - 0.5) * 4 + 3,
      vy: -1,
      vz: 9 + Math.random() * 6,
      gravity: -2,
      drag: 0.35,
      life: 1.6 + Math.random() * 1.4,
      maxLife: 3,
      size: Math.random() < 0.5 ? 2 : 1,
      colors: [R.night[3], R.stone[2], R.stone[3]],
    });
  }

  ember(x: number, y: number): void {
    this.spawn({
      x: x + (Math.random() - 0.5) * 6,
      y,
      vx: (Math.random() - 0.5) * 6,
      vy: -2 - Math.random() * 4,
      vz: 8 + Math.random() * 14,
      gravity: -6,
      drag: 0.8,
      life: 0.8 + Math.random() * 1.2,
      maxLife: 2,
      size: 1,
      colors: [P.fireHot, P.fire, P.fireDeep],
      glow: true,
    });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.35;
        p.vx *= 0.6;
        p.vy *= 0.6;
        if (Math.abs(p.vz) < 4) p.vz = 0;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    // Two passes so glowing particles composite additively on top.
    for (const pass of [0, 1]) {
      if (pass === 1) ctx.globalCompositeOperation = 'lighter';
      for (const p of this.list) {
        if ((p.glow ? 1 : 0) !== pass) continue;
        // `life` can start slightly above `maxLife` for randomised spawns, so
        // the ramp position has to be clamped at both ends.
        const t = 1 - p.life / p.maxLife;
        const idx = Math.max(0, Math.min(p.colors.length - 1, Math.floor(t * p.colors.length)));
        const c = p.colors[idx];
        const a = p.life < 0.12 ? p.life / 0.12 : 1;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(2)})`;
        ctx.fillRect(Math.round(p.x - camX), Math.round(p.y - p.z - camY), p.size, p.size);
      }
      if (pass === 1) ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Soft shadows for airborne particles keep them readable over water. */
  drawShadows(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    ctx.fillStyle = 'rgba(8,8,16,0.28)';
    for (const p of this.list) {
      if (p.z < 2) continue;
      ctx.fillRect(Math.round(p.x - camX), Math.round(p.y - camY), p.size, 1);
    }
  }
}

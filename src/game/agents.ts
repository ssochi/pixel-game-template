/**
 * Slimes: wandering targets that exercise the creature animation set
 * (idle -> move -> attack -> death) inside the live scene.
 */
import type { Assets } from '../art/assets';
import { P } from '../art/palette';
import { clipFinished, drawClip, type Clip } from '../art/sheet';
import type { Light } from './lighting';
import type { Particles } from './particles';
import type { Player } from './player';
import type { Solid } from './scene';
import { blocksMovement, isWater, onBridge } from './terrain';

/** True where a step would land in the river outside the bridge deck. */
function blockedByWater(x: number, y: number): boolean {
  return isWater(x, y) && !onBridge(x, y);
}

type SlimeState = 'idle' | 'move' | 'attack' | 'death';

export class Slime {
  x: number;
  y: number;
  private vx = 0;
  private vy = 0;
  private state: SlimeState = 'idle';
  private t = 0;
  private think = 0;
  private homeX: number;
  private homeY: number;
  private respawn = 0;
  dead = false;

  constructor(
    private a: Assets,
    x: number,
    y: number,
  ) {
    this.x = x;
    this.y = y;
    this.homeX = x;
    this.homeY = y;
    this.think = Math.random() * 2;
  }

  private clip(): Clip {
    return this.state === 'idle'
      ? this.a.slime.idle
      : this.state === 'move'
        ? this.a.slime.move
        : this.state === 'attack'
          ? this.a.slime.attack
          : this.a.slime.death;
  }

  private set(s: SlimeState): void {
    if (this.state === s) return;
    this.state = s;
    this.t = 0;
  }

  hit(fx: Particles, dirX: number, dirY: number): void {
    if (this.dead) return;
    this.dead = true;
    this.set('death');
    this.respawn = 6;
    fx.blood(this.x, this.y - 6, Math.atan2(dirY, dirX));
  }

  update(dt: number, player: Player, solids: Solid[]): void {
    this.t += dt;
    if (this.dead) {
      this.respawn -= dt;
      if (this.respawn <= 0) {
        this.dead = false;
        this.x = this.homeX;
        this.y = this.homeY;
        this.set('idle');
      }
      return;
    }

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (this.state === 'attack') {
      if (!clipFinished(this.a.slime.attack, this.t)) {
        // Lunge forward during the middle of the clip.
        const k = this.t < 0.22 ? 0 : 60;
        this.vx = (dx / (dist || 1)) * k;
        this.vy = (dy / (dist || 1)) * k;
        this.step(dt, solids);
        return;
      }
      this.set('idle');
    }

    this.think -= dt;
    if (dist < 96 && player.state !== 'death') {
      if (dist < 22) {
        this.set('attack');
        return;
      }
      this.set('move');
      this.vx = (dx / dist) * 34;
      this.vy = (dy / dist) * 34;
    } else if (this.think <= 0) {
      this.think = 1.2 + Math.random() * 2;
      if (Math.random() < 0.45) {
        this.set('idle');
        this.vx = 0;
        this.vy = 0;
      } else {
        this.set('move');
        const a = Math.random() * Math.PI * 2;
        // Drift back towards home so slimes don't wander off the map.
        const hx = this.homeX - this.x;
        const hy = this.homeY - this.y;
        const pull = Math.min(1, Math.hypot(hx, hy) / 90);
        this.vx = Math.cos(a) * 22 * (1 - pull) + (hx / (Math.hypot(hx, hy) || 1)) * 22 * pull;
        this.vy = Math.sin(a) * 22 * (1 - pull) + (hy / (Math.hypot(hx, hy) || 1)) * 22 * pull;
      }
    }
    this.step(dt, solids);
  }

  private step(dt: number, solids: Solid[]): void {
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (!blocksMovement(nx, this.y) && !blockedByWater(nx, this.y) && !this.hitsSolid(nx, this.y, solids)) this.x = nx;
    else this.vx *= -1;
    if (!blocksMovement(this.x, ny) && !blockedByWater(this.x, ny) && !this.hitsSolid(this.x, ny, solids)) this.y = ny;
    else this.vy *= -1;
  }

  private hitsSolid(x: number, y: number, solids: Solid[]): boolean {
    for (const s of solids) if (Math.hypot(s.x - x, s.y - y) < s.r + 5) return true;
    return false;
  }

  light(out: Light[]): void {
    if (this.dead) return;
    out.push({ x: this.x, y: this.y - 6, radius: 26, color: P.leafLight, intensity: 0.35, bloom: false });
  }

  get sortY(): number {
    return this.y;
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    drawClip(ctx, this.clip(), this.t, Math.round(this.x - camX), Math.round(this.y - camY), this.vx < 0);
  }
}

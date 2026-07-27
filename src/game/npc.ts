/**
 * Townsfolk and livestock.
 *
 * Both are the same shape of agent: pick a destination inside a home area,
 * walk there, stand around for a while, repeat. Villagers use the humanoid
 * animation set; animals use the quadruped/bird set and also graze. Neither
 * needs pathfinding — they steer around solids and give up on a blocked
 * destination, which at this scale is indistinguishable from the real thing.
 */
import type { AnimalAnims } from '../art/animals';
import { bakeNpc, type CharacterAnims, type Dir, type Skin } from '../art/character';
import { drawClip, type Clip } from '../art/sheet';
import { RNG } from '../engine/rng';
import type { Solid } from './scene';
import { blocksMovement } from './terrain';

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type AgentState = 'idle' | 'walk' | 'graze';

abstract class Agent {
  x: number;
  y: number;
  protected vx = 0;
  protected vy = 0;
  protected state: AgentState = 'idle';
  protected t = 0;
  protected wait = 0;
  protected tx = 0;
  protected ty = 0;
  protected flip = false;
  protected rng: RNG;

  constructor(
    x: number,
    y: number,
    protected home: Area,
    seed: number,
  ) {
    this.x = x;
    this.y = y;
    this.tx = x;
    this.ty = y;
    this.rng = new RNG(seed);
    this.wait = this.rng.range(0, 3);
  }

  get sortY(): number {
    return this.y;
  }

  protected abstract speed: number;
  protected abstract idleTime: [number, number];
  /** Chance of picking the grazing idle instead of standing. */
  protected grazes = false;

  protected pickDestination(): void {
    for (let i = 0; i < 8; i++) {
      const nx = this.rng.range(this.home.x0, this.home.x1);
      const ny = this.rng.range(this.home.y0, this.home.y1);
      if (blocksMovement(nx, ny)) continue;
      this.tx = nx;
      this.ty = ny;
      this.state = 'walk';
      return;
    }
    this.state = 'idle';
  }

  update(dt: number, solids: Solid[]): void {
    this.t += dt;
    if (this.state !== 'walk') {
      this.wait -= dt;
      this.vx = 0;
      this.vy = 0;
      if (this.wait <= 0) this.pickDestination();
      return;
    }

    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 3) {
      this.state = this.grazes && this.rng.chance(0.55) ? 'graze' : 'idle';
      this.t = 0;
      this.wait = this.rng.range(this.idleTime[0], this.idleTime[1]);
      return;
    }
    this.vx = (dx / dist) * this.speed;
    this.vy = (dy / dist) * this.speed;
    if (this.vx !== 0) this.flip = this.vx < 0;

    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    const blockedX = blocksMovement(nx, this.y) || this.hits(nx, this.y, solids);
    const blockedY = blocksMovement(this.x, ny) || this.hits(this.x, ny, solids);
    if (!blockedX) this.x = nx;
    if (!blockedY) this.y = ny;
    if (blockedX && blockedY) {
      // Wedged; give up on this destination rather than grinding into a wall.
      this.state = 'idle';
      this.wait = this.rng.range(0.5, 1.5);
    }
  }

  private hits(x: number, y: number, solids: Solid[]): boolean {
    for (const s of solids) if (Math.hypot(s.x - x, s.y - y) < s.r + 4) return true;
    return false;
  }
}

// ---------------------------------------------------------------------------

export class Villager extends Agent {
  protected speed = 26;
  protected idleTime: [number, number] = [1.5, 6];
  private anims: CharacterAnims;
  private dir: Dir = 0;
  /** Villagers posted at a stall or forge stay put and just turn about. */
  readonly stationary: boolean;
  readonly name: string;

  constructor(
    anims: CharacterAnims,
    x: number,
    y: number,
    home: Area,
    seed: number,
    name: string,
    stationary = false,
  ) {
    super(x, y, home, seed);
    this.anims = anims;
    this.name = name;
    this.stationary = stationary;
    if (stationary) this.state = 'idle';
  }

  override update(dt: number, solids: Solid[]): void {
    if (this.stationary) {
      this.t += dt;
      this.wait -= dt;
      if (this.wait <= 0) {
        this.wait = this.rng.range(2, 6);
        this.dir = this.rng.pick([0, 0, 1, 2]) as Dir;
        this.flip = this.rng.chance(0.5);
      }
      return;
    }
    super.update(dt, solids);
    if (this.state === 'walk') {
      const a = Math.atan2(this.vy, this.vx);
      const abs = Math.abs(a);
      if (abs < Math.PI * 0.3) {
        this.dir = 1;
        this.flip = false;
      } else if (abs > Math.PI * 0.7) {
        this.dir = 1;
        this.flip = true;
      } else if (a > 0) {
        this.dir = 0;
        this.flip = false;
      } else {
        this.dir = 2;
        this.flip = false;
      }
    }
  }

  private clip(): Clip {
    return this.state === 'walk' ? this.anims.walk[this.dir] : this.anims.idle[this.dir];
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const px = Math.round(this.x - camX);
    const py = Math.round(this.y - camY);
    ctx.fillStyle = 'rgba(8,8,18,0.3)';
    ctx.beginPath();
    ctx.ellipse(px, py - 1, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    drawClip(ctx, this.clip(), this.t, px, py, this.flip);
  }
}

export class Critter extends Agent {
  protected speed: number;
  protected idleTime: [number, number] = [2, 8];
  protected override grazes = true;
  private anims: AnimalAnims;

  constructor(anims: AnimalAnims, x: number, y: number, home: Area, seed: number, speed = 16) {
    super(x, y, home, seed);
    this.anims = anims;
    this.speed = speed;
  }

  private clip(): Clip {
    return this.state === 'walk' ? this.anims.walk : this.state === 'graze' ? this.anims.graze : this.anims.idle;
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    // Animals are drawn side-on; `flip` follows the direction of travel.
    drawClip(ctx, this.clip(), this.t, Math.round(this.x - camX), Math.round(this.y - camY), this.flip);
  }
}

/** Ducks paddle inside the river instead of avoiding it. */
export class Duck extends Critter {
  override update(dt: number, _solids: Solid[]): void {
    this.t += dt;
    if (this.state !== 'walk') {
      this.wait -= dt;
      if (this.wait <= 0) this.pickDestination();
      return;
    }
    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      this.state = 'idle';
      this.wait = this.rng.range(2, 6);
      return;
    }
    // Slow drift, plus the current carrying them downstream.
    this.x += (dx / dist) * 9 * dt;
    this.y += (dy / dist) * 9 * dt + 4 * dt;
    this.flip = dx < 0;
    if (this.y > this.home.y1) this.y = this.home.y0;
  }
}

export function bakeNpcAnims(skins: Skin[]): CharacterAnims[] {
  return skins.map((s) => bakeNpc(s));
}

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
import type { EmoteAssets, EmoteKind } from '../art/emote';
import { drawClip, drawFrame, type Clip } from '../art/sheet';
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

/** What a villager does once it has arrived somewhere. */
export type Activity = 'wander' | 'work' | 'socialise' | 'sleep';

export interface ScheduleSlot {
  /** Day fraction this slot starts at; slots are searched in order. */
  from: number;
  area: Area;
  activity: Activity;
}

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

/**
 * A townsperson with a day.
 *
 * The schedule is the behaviour: a list of (time, place, activity) slots keyed
 * to the same day fraction that drives the lighting, so at dawn the villagers
 * head for their work areas, in the evening they drift to the square and the
 * tavern, and at night they go home. On arrival the activity decides what they
 * actually do — potter about, work a tool, chat, or sleep.
 *
 * Two villagers who end up standing near each other strike up a conversation:
 * they turn to face one another and trade speech bubbles. It costs almost
 * nothing and it is the single thing that makes a crowd look like a town
 * rather than like a screensaver.
 */
export class Villager extends Agent {
  protected speed = 26;
  protected idleTime: [number, number] = [1.5, 6];
  private anims: CharacterAnims;
  private dir: Dir = 0;
  /** Villagers posted at a stall or forge stay put and just turn about. */
  readonly stationary: boolean;
  readonly name: string;
  /** Set for the named cast; empty for background extras. */
  castId = '';
  /**
   * True while this villager is considered to be inside a building. Their
   * interior copy is the one you meet, so the outdoor figure stops drawing and
   * stops answering — otherwise the shopkeeper is visibly in two places.
   */
  indoors = false;
  readonly schedule: ScheduleSlot[];
  private slot = -1;
  activity: Activity = 'wander';
  /** Non-null while in conversation. */
  private chatWith: Villager | null = null;
  private chatT = 0;
  emote: EmoteKind | null = null;
  private emoteT = 0;

  constructor(
    anims: CharacterAnims,
    x: number,
    y: number,
    home: Area,
    seed: number,
    name: string,
    stationary = false,
    schedule: ScheduleSlot[] = [],
  ) {
    super(x, y, home, seed);
    this.anims = anims;
    this.name = name;
    this.stationary = stationary;
    this.schedule = schedule;
    if (stationary) this.state = 'idle';
  }

  /** Pick the slot covering `dayT` and re-home if it changed. */
  private applySchedule(dayT: number): void {
    if (!this.schedule.length) return;
    const t = ((dayT % 1) + 1) % 1;
    let idx = 0;
    for (let i = 0; i < this.schedule.length; i++) if (t >= this.schedule[i].from) idx = i;
    if (idx === this.slot) return;
    this.slot = idx;
    const s = this.schedule[idx];
    this.home = s.area;
    this.activity = s.activity;
    // Head off immediately rather than waiting out the current idle.
    this.pickDestination();
    if (this.activity === 'sleep') this.showEmote('sleep', 3);
    else if (this.activity === 'work') this.showEmote('work', 3);
  }

  showEmote(kind: EmoteKind, seconds: number): void {
    this.emote = kind;
    this.emoteT = seconds;
  }

  /** Called by the crowd pass when two idle villagers are close enough. */
  startChat(other: Villager): void {
    if (this.chatWith || other.chatWith) return;
    this.chatWith = other;
    other.chatWith = this;
    this.chatT = other.chatT = 4 + this.rng.range(0, 4);
    this.faceTowards(other.x, other.y);
    other.faceTowards(this.x, this.y);
    this.showEmote('talk', 2);
    other.showEmote(other.rng.chance(0.3) ? 'note' : 'talk', 3.4);
  }

  get chatting(): boolean {
    return this.chatWith !== null;
  }

  get available(): boolean {
    return !this.chatWith && this.state !== 'walk' && this.activity !== 'sleep';
  }

  private faceTowards(x: number, y: number): void {
    const a = Math.atan2(y - this.y, x - this.x);
    const abs = Math.abs(a);
    if (abs < Math.PI * 0.3) {
      this.dir = 1;
      this.flip = false;
    } else if (abs > Math.PI * 0.7) {
      this.dir = 1;
      this.flip = true;
    } else {
      this.dir = a > 0 ? 0 : 2;
    }
  }

  override update(dt: number, solids: Solid[], dayT = 0.5): void {
    this.applySchedule(dayT);
    if (this.emoteT > 0) {
      this.emoteT -= dt;
      if (this.emoteT <= 0) this.emote = null;
    }

    if (this.chatWith) {
      this.t += dt;
      this.chatT -= dt;
      // Trade bubbles back and forth.
      if (this.emoteT <= 0 && this.rng.chance(dt * 1.2)) this.showEmote(this.rng.chance(0.25) ? 'idea' : 'talk', 1.8);
      if (this.chatT <= 0) {
        this.chatWith.chatWith = null;
        this.chatWith = null;
        this.wait = this.rng.range(1, 3);
      }
      return;
    }

    if (this.stationary) {
      this.t += dt;
      this.wait -= dt;
      if (this.wait <= 0) {
        this.wait = this.rng.range(2, 6);
        this.dir = this.rng.pick([0, 0, 1, 2]) as Dir;
        this.flip = this.rng.chance(0.5);
        if (this.rng.chance(0.4)) this.showEmote(this.rng.pick(['buy', 'talk', 'work']) as EmoteKind, 2.5);
      }
      return;
    }

    // Workers stand at their spot and swing a tool instead of pacing about.
    if (this.activity === 'work' && this.state !== 'walk') {
      this.t += dt;
      this.wait -= dt;
      if (this.wait <= 0) {
        // Occasionally move to a different spot in the work area.
        if (this.rng.chance(0.35)) this.pickDestination();
        else this.wait = this.rng.range(3, 7);
        if (this.rng.chance(0.3)) this.showEmote('work', 2);
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
    if (this.state === 'walk') return this.anims.walk[this.dir];
    if (this.activity === 'work' && this.anims.work) return this.anims.work[this.dir];
    return this.anims.idle[this.dir];
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, emotes?: EmoteAssets): void {
    const px = Math.round(this.x - camX);
    const py = Math.round(this.y - camY);
    ctx.fillStyle = 'rgba(8,8,18,0.3)';
    ctx.beginPath();
    ctx.ellipse(px, py - 1, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    drawClip(ctx, this.clip(), this.t, px, py, this.flip);
    if (this.emote && emotes) {
      // Bob the bubble so it doesn't sit dead still over a dead-still NPC.
      const bobY = Math.sin(this.t * 5) > 0.4 ? -1 : 0;
      drawFrame(ctx, emotes.sheet, emotes.index[this.emote] + (this.flip ? 1 : 0), px + 6, py - 30 + bobY);
    }
  }
}

/**
 * Pair up idle neighbours into conversations. Run once per frame over the whole
 * crowd; it is O(n^2) but n is a few dozen.
 */
export function gossip(villagers: Villager[], dt: number): void {
  for (let i = 0; i < villagers.length; i++) {
    const a = villagers[i];
    if (!a.available || Math.random() > dt * 0.5) continue;
    for (let j = i + 1; j < villagers.length; j++) {
      const b = villagers[j];
      if (!b.available) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 26) {
        a.startChat(b);
        break;
      }
    }
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

/**
 * Fishing: cast, wait, strike, reel.
 *
 * The whole point of a fishing minigame is that the *waiting* is cheap and the
 * *catching* is a skill check, so the loop is:
 *
 *   cast -> wait (random, unskippable) -> bite (a short window you can miss)
 *        -> reel (hold to raise a bar, keep it over the fish) -> keep or lose
 *
 * The reel is the Stardew shape and it is the right one: you hold a button to
 * fight gravity, the fish darts about, and progress only fills while the two
 * overlap. It reads instantly, it has a skill ceiling, and the difficulty knob
 * is just "how erratic is the fish" — which is exactly the knob a rarity table
 * wants to turn.
 *
 * Where you fish matters: the deep pool below the mill has its own table with
 * the rare fish in it, so the river is not one uniform surface to grind.
 */
import { MILL, riverSDF } from './terrain';

export interface FishDef {
  id: string;
  name: string;
  price: number;
  /** Relative chance within its water. */
  weight: number;
  /** How far the fish darts, and how often. Higher = harder to track. */
  dart: number;
  /** Fraction of the bar the catch box covers. Smaller = harder. */
  box: number;
}

export const FISH: Record<string, FishDef> = {
  minnow: { id: 'minnow', name: 'MINNOW', price: 12, weight: 26, dart: 0.5, box: 0.3 },
  chub: { id: 'chub', name: 'CHUB', price: 30, weight: 22, dart: 0.7, box: 0.27 },
  perch: { id: 'perch', name: 'PERCH', price: 48, weight: 18, dart: 0.9, box: 0.25 },
  trout: { id: 'trout', name: 'TROUT', price: 75, weight: 12, dart: 1.15, box: 0.22 },
  carp: { id: 'carp', name: 'CARP', price: 60, weight: 10, dart: 0.6, box: 0.24 },
  pike: { id: 'pike', name: 'PIKE', price: 120, weight: 7, dart: 1.5, box: 0.19 },
  eel: { id: 'eel', name: 'EEL', price: 95, weight: 6, dart: 1.7, box: 0.2 },
  riverking: { id: 'riverking', name: 'THE RIVER KING', price: 900, weight: 3, dart: 2.1, box: 0.15 },
};

/** Species you can hook in ordinary river water. */
const SHALLOW = ['minnow', 'chub', 'perch', 'carp', 'trout'];
/** The deep pool below the mill. Everything shallow, plus what Wick talks about. */
const DEEP = ['chub', 'perch', 'trout', 'carp', 'pike', 'eel', 'riverking'];

/**
 * The deep pool: downstream of the mill, in the middle of the channel. Wick's
 * tier-3 line points straight at it, so it needs to be somewhere a player who
 * listened to him would actually go.
 */
export function isDeepWater(x: number, y: number): boolean {
  return y > MILL.y + 20 && riverSDF(x, y) < -22;
}

function pick(pool: string[], rand: () => number): FishDef {
  const total = pool.reduce((a, id) => a + FISH[id].weight, 0);
  let r = rand() * total;
  for (const id of pool) {
    r -= FISH[id].weight;
    if (r <= 0) return FISH[id];
  }
  return FISH[pool[0]];
}

/** Reel-bar feel. Terminal speeds are THRUST/DRAG up and GRAVITY/DRAG down. */
const THRUST = 1.9;
const GRAVITY = 1.4;
const DRAG = 1.6;
/**
 * Progress rates. Filling has to be comfortably faster than draining or the
 * game becomes a knife edge where holding the fish half the time still loses:
 * at these numbers ~35% contact breaks even and ~50% lands a fish in about
 * five seconds, which is the gradient a skill check wants.
 */
const FILL = 0.55;
const DRAIN = 0.28;

export type FishState = 'idle' | 'cast' | 'wait' | 'bite' | 'reel' | 'result';

export class Fishing {
  state: FishState = 'idle';
  /** Where the float landed, in world px. */
  floatX = 0;
  floatY = 0;
  /** Cast animation: the float travels from the rod tip to the target. */
  private fromX = 0;
  private fromY = 0;
  private t = 0;
  private duration = 0;

  /** Set from `bite` onward. */
  hooked: FishDef | null = null;
  deep = false;

  // --- reeling minigame -----------------------------------------------------
  /** Player's catch box centre, 0 (bottom) .. 1 (top). */
  barY = 0.5;
  private barV = 0;
  boxH = 0.25;
  /** The fish's position on the same axis. */
  fishY = 0.5;
  private fishTarget = 0.5;
  private fishTimer = 0;
  /** 0 .. 1; full lands the fish, empty loses it. */
  progress = 0.32;

  /** What to show after the attempt. */
  result: { fish: FishDef | null; caught: boolean } | null = null;

  constructor(private rand: () => number = Math.random) {}

  get active(): boolean {
    return this.state !== 'idle';
  }

  /** True if the point is water you can drop a float into. */
  static castable(x: number, y: number): boolean {
    return riverSDF(x, y) < -4;
  }

  /**
   * Start a cast from the player towards `aim`. Returns false if there is no
   * water within reach along that line.
   */
  cast(px: number, py: number, aim: number): boolean {
    if (this.state !== 'idle') return false;
    // Find the span of water the aim crosses, and drop the float in the middle
    // of it. Landing on the *first* water pixel instead would pin every cast to
    // the near bank, which would make the deep middle of the pool — the whole
    // reason the rare table exists — impossible to reach from dry land.
    let first = -1;
    let last = -1;
    for (let d = 12; d <= 110; d += 3) {
      const x = px + Math.cos(aim) * d;
      const y = py + Math.sin(aim) * d;
      if (!Fishing.castable(x, y)) {
        // Stop at the far bank rather than skipping over it to another channel.
        if (first >= 0) break;
        continue;
      }
      if (first < 0) first = d;
      last = d;
    }
    if (first < 0) return false;
    const d = (first + last) / 2;
    this.fromX = px;
    this.fromY = py - 12;
    this.floatX = px + Math.cos(aim) * d;
    this.floatY = py + Math.sin(aim) * d;
    this.deep = isDeepWater(this.floatX, this.floatY);
    this.state = 'cast';
    this.t = 0;
    this.duration = 0.34;
    this.hooked = null;
    this.result = null;
    return true;
  }

  /** Float position during the cast arc; equals the target once landed. */
  floatPos(): { x: number; y: number } {
    if (this.state !== 'cast') return { x: this.floatX, y: this.floatY };
    const k = this.t / this.duration;
    return {
      x: this.fromX + (this.floatX - this.fromX) * k,
      // A shallow lob, so the line reads as thrown rather than teleported.
      y: this.fromY + (this.floatY - this.fromY) * k - Math.sin(k * Math.PI) * 18,
    };
  }

  /** The player pressed the action key. Meaning depends on the state. */
  strike(): 'hooked' | 'missed' | 'none' {
    if (this.state === 'wait') {
      // Striking early spooks the fish and ends the cast.
      this.state = 'result';
      this.t = 0;
      this.duration = 1.1;
      this.result = { fish: null, caught: false };
      return 'missed';
    }
    if (this.state === 'bite') {
      this.state = 'reel';
      this.boxH = this.hooked!.box;
      this.barY = 0.25;
      this.barV = 0;
      this.fishY = 0.5;
      this.fishTarget = 0.5;
      this.fishTimer = 0;
      this.progress = 0.32;
      return 'hooked';
    }
    return 'none';
  }

  /** Give up mid-cast. */
  cancel(): void {
    this.state = 'idle';
    this.hooked = null;
    this.result = null;
  }

  /**
   * @param held true while the reel button is down
   * @returns an event when something worth reacting to happened
   */
  update(dt: number, held: boolean): 'bite' | 'caught' | 'lost' | 'escaped' | null {
    this.t += dt;
    switch (this.state) {
      case 'cast':
        if (this.t >= this.duration) {
          this.state = 'wait';
          this.t = 0;
          // Deep water bites sooner; that is the reward for the walk.
          this.duration = (this.deep ? 1.1 : 1.6) + this.rand() * (this.deep ? 3.2 : 4.4);
        }
        return null;

      case 'wait':
        if (this.t >= this.duration) {
          this.hooked = pick(this.deep ? DEEP : SHALLOW, this.rand);
          this.state = 'bite';
          this.t = 0;
          // The window is generous enough to be fair and short enough to matter.
          this.duration = 0.85;
          return 'bite';
        }
        return null;

      case 'bite':
        if (this.t >= this.duration) {
          this.state = 'result';
          this.t = 0;
          this.duration = 1.1;
          this.result = { fish: null, caught: false };
          return 'escaped';
        }
        return null;

      case 'reel': {
        const f = this.hooked!;
        // The player's box: held pushes up, gravity pulls down, and it bounces
        // softly off both ends rather than sticking to them.
        //
        // The damping term is what makes this playable. Without it the box is
        // pure acceleration — velocity grows until it hits a clamp, so holding
        // position means bang-banging a slab of ice and the whole minigame is a
        // coin flip. Damped, each input has a terminal speed (thrust/k up,
        // gravity/k down) and the box settles instead of overshooting.
        this.barV += (held ? THRUST : -GRAVITY) * dt;
        this.barV -= this.barV * Math.min(1, DRAG * dt);
        this.barY += this.barV * dt;
        if (this.barY < 0) {
          this.barY = 0;
          this.barV *= -0.28;
        }
        if (this.barY > 1) {
          this.barY = 1;
          this.barV *= -0.28;
        }

        // The fish picks a new spot every so often and eases towards it. Rarer
        // fish repick sooner and travel further, which is the whole difficulty
        // curve in two numbers.
        this.fishTimer -= dt;
        if (this.fishTimer <= 0) {
          this.fishTimer = 0.55 + this.rand() * 1.3 / f.dart;
          const spread = Math.min(0.5, 0.16 * f.dart);
          this.fishTarget = Math.max(0.04, Math.min(0.96, this.fishY + (this.rand() * 2 - 1) * spread * 2));
        }
        this.fishY += (this.fishTarget - this.fishY) * Math.min(1, dt * (1.6 + f.dart));

        const half = this.boxH / 2;
        const on = Math.abs(this.fishY - this.barY) <= half;
        this.progress += (on ? FILL : -DRAIN) * dt;
        if (this.progress >= 1) {
          this.state = 'result';
          this.t = 0;
          this.duration = 1.9;
          this.result = { fish: f, caught: true };
          return 'caught';
        }
        if (this.progress <= 0) {
          this.state = 'result';
          this.t = 0;
          this.duration = 1.2;
          this.result = { fish: f, caught: false };
          return 'lost';
        }
        return null;
      }

      case 'result':
        if (this.t >= this.duration) this.cancel();
        return null;

      default:
        return null;
    }
  }
}

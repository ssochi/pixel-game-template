/**
 * The player-controlled character.
 *
 * Twin-stick style: WASD moves, the mouse aims. The body faces the aim
 * direction (so the walk cycle can read as strafing) and the gun is a separate
 * sprite pivoted in the hand, which is why it can point anywhere without
 * needing 8 more baked directions.
 */
import type { Assets } from '../art/assets';
import type { Dir } from '../art/character';
import { P } from '../art/palette';
import { clipFinished, drawClip, drawFrame, type Clip } from '../art/sheet';
import type { Input } from '../engine/input';
import type { Camera } from '../engine/screen';
import type { Light } from './lighting';
import type { Particles } from './particles';
import type { Solid } from './scene';
import { blocksMovement, isWater, onBridge } from './terrain';

export type PlayerState = 'idle' | 'walk' | 'run' | 'attack' | 'death';

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  prevX: number;
  prevY: number;
}

const WALK_SPEED = 62;
const RUN_SPEED = 112;
const FIRE_COOLDOWN = 0.16;

export class Player {
  x = 250;
  y = 300;
  vx = 0;
  vy = 0;
  radius = 5;

  state: PlayerState = 'idle';
  dir: Dir = 0;
  flip = false;
  aim = 0;
  stateT = 0;
  animT = 0;

  fireT = 0;
  muzzleT = -1;
  gunRecoil = 0;
  deathT = 0;
  /** Set by the debug panel to force one animation for inspection. */
  forced: PlayerState | null = null;

  /** Inside a room the world terrain must not be consulted at all. */
  indoors = false;
  readonly bullets: Bullet[] = [];
  private stepT = 0;
  private splashT = 0;

  constructor(private a: Assets) {}

  get clip(): Clip {
    const s = this.forced ?? this.state;
    const set =
      s === 'idle'
        ? this.a.hero.idle
        : s === 'walk'
          ? this.a.hero.walk
          : s === 'run'
            ? this.a.hero.run
            : s === 'attack'
              ? this.a.hero.attack
              : this.a.hero.death;
    return set[this.dir];
  }

  private setState(s: PlayerState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    if (s === 'attack' || s === 'death') this.animT = 0;
  }

  kill(): void {
    if (this.state === 'death') return;
    this.setState('death');
    this.deathT = 0;
  }

  /** Kill all momentum — used when teleporting through a doorway. */
  stop(): void {
    this.vx = 0;
    this.vy = 0;
    this.setState('idle');
  }

  revive(): void {
    this.setState('idle');
    this.deathT = 0;
  }

  update(dt: number, input: Input, camX: number, camY: number, solids: Solid[], fx: Particles, _cam: Camera): void {
    this.stateT += dt;
    this.animT += dt;

    // Aim always tracks the cursor, even while dead (harmless, keeps the gun
    // sprite from snapping when you respawn).
    const mx = input.mouseX + camX;
    const my = input.mouseY + camY;
    this.aim = Math.atan2(my - (this.y - 14), mx - this.x);

    if (this.state === 'death') {
      this.deathT += dt;
      this.vx = 0;
      this.vy = 0;
      if (input.pressed('r') || this.deathT > 3.2) this.revive();
      return;
    }

    // --- input -------------------------------------------------------------
    let ix = 0;
    let iy = 0;
    if (input.isDown('a', 'arrowleft')) ix -= 1;
    if (input.isDown('d', 'arrowright')) ix += 1;
    if (input.isDown('w', 'arrowup')) iy -= 1;
    if (input.isDown('s', 'arrowdown')) iy += 1;
    const len = Math.hypot(ix, iy);
    if (len > 0) {
      ix /= len;
      iy /= len;
    }
    const running = input.isDown('shift') && len > 0;
    const speed = running ? RUN_SPEED : WALK_SPEED;

    // Smooth acceleration keeps the walk cycle from stuttering on tap-inputs.
    const accel = len > 0 ? 900 : 1400;
    this.vx += (ix * speed - this.vx) * Math.min(1, accel * dt * 0.012);
    this.vy += (iy * speed - this.vy) * Math.min(1, accel * dt * 0.012);
    if (Math.abs(this.vx) < 1) this.vx = 0;
    if (Math.abs(this.vy) < 1) this.vy = 0;

    this.moveAxis(this.vx * dt, 0, solids);
    this.moveAxis(0, this.vy * dt, solids);

    // --- facing from the aim direction --------------------------------------
    const a = this.aim;
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

    // --- shooting ----------------------------------------------------------
    this.fireT -= dt;
    this.gunRecoil = Math.max(0, this.gunRecoil - dt * 26);
    if (this.muzzleT >= 0) this.muzzleT += dt;
    // Firing is driven by the tool system now, not held straight off the mouse.

    // --- state -------------------------------------------------------------
    const moving = Math.hypot(this.vx, this.vy) > 8;
    if (this.state === 'attack' && !clipFinished(this.a.hero.attack[this.dir], this.animT)) {
      // hold the attack pose
    } else if (moving) {
      this.setState(running ? 'run' : 'walk');
    } else {
      this.setState('idle');
    }

    // --- footstep fx -------------------------------------------------------
    if (moving) {
      this.stepT -= dt * (running ? 1.7 : 1);
      if (this.stepT <= 0) {
        this.stepT = 0.26;
        const nx = this.vx / Math.hypot(this.vx, this.vy);
        const ny = this.vy / Math.hypot(this.vx, this.vy);
        if (!this.indoors && !onBridge(this.x, this.y)) fx.dust(this.x, this.y, nx, ny);
      }
    }
    // Walking along the waterline kicks up spray.
    this.splashT -= dt;
    if (moving && this.splashT <= 0 && this.nearWater()) {
      this.splashT = 0.12;
      fx.splash(this.x, this.y, 0.4);
    }
  }

  private nearWater(): boolean {
    if (this.indoors || onBridge(this.x, this.y)) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (isWater(this.x + Math.cos(a) * 9, this.y + Math.sin(a) * 9)) return true;
    }
    return false;
  }

  /** Play the tool-swing animation. Called when a tool is used. */
  swing(): void {
    this.setState('attack');
    this.animT = 0;
  }

  /** Fire the gun — kept for the combat slot; not bound to the mouse. */
  shoot(fx: Particles, cam: Camera): void {
    if (this.fireT > 0) return;
    this.fire(fx, cam);
  }

  private fire(fx: Particles, cam: Camera): void {
    this.fireT = FIRE_COOLDOWN;
    this.muzzleT = 0;
    this.gunRecoil = 3;
    this.setState('attack');
    this.animT = 0;
    const sx = this.x + Math.cos(this.aim) * 11;
    const sy = this.y - 14 + Math.sin(this.aim) * 11;
    const spread = (Math.random() - 0.5) * 0.06;
    const sp = 300;
    this.bullets.push({
      x: sx,
      y: sy,
      prevX: sx,
      prevY: sy,
      vx: Math.cos(this.aim + spread) * sp,
      vy: Math.sin(this.aim + spread) * sp,
      life: 1.1,
    });
    fx.sparks(sx, sy, this.aim, 4);
    cam.shake(1.2, 0.09);
    // Recoil nudge
    this.vx -= Math.cos(this.aim) * 26;
    this.vy -= Math.sin(this.aim) * 26;
  }

  updateBullets(dt: number, solids: Solid[], fx: Particles): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.prevX = b.x;
      b.prevY = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let hit = b.life <= 0;
      if (!hit) {
        for (const s of solids) {
          if (Math.hypot(s.x - b.x, s.y - b.y) < s.r) {
            hit = true;
            fx.sparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 7);
            break;
          }
        }
      }
      if (!hit && !this.indoors && isWater(b.x, b.y) && !onBridge(b.x, b.y)) {
        fx.splash(b.x, b.y, 0.6);
        hit = true;
      }
      if (hit) this.bullets.splice(i, 1);
    }
  }

  private moveAxis(dx: number, dy: number, solids: Solid[]): void {
    const nx = this.x + dx;
    const ny = this.y + dy;
    if (!this.indoors && (blocksMovement(nx, ny) || blocksMovement(nx, ny - 4))) {
      if (dx !== 0) this.vx = 0;
      else this.vy = 0;
      return;
    }
    for (const s of solids) {
      const d = Math.hypot(s.x - nx, s.y - ny);
      if (d < s.r + this.radius) {
        if (dx !== 0) this.vx = 0;
        else this.vy = 0;
        return;
      }
    }
    this.x = nx;
    this.y = ny;
  }

  /** Lights carried by the player: a lantern glow plus the muzzle flash. */
  lights(out: Light[]): void {
    out.push({
      x: this.x,
      y: this.y - 12,
      radius: 74,
      color: [255, 226, 176, 255],
      intensity: 0.85,
      flicker: 0.1,
      seed: 3.3,
    });
    if (this.muzzleT >= 0 && this.muzzleT < 0.06) {
      out.push({
        x: this.x + Math.cos(this.aim) * 12,
        y: this.y - 14 + Math.sin(this.aim) * 12,
        radius: 120,
        color: P.fireHot,
        intensity: 1.5,
        seed: 9.1,
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const px = Math.round(this.x - camX);
    const py = Math.round(this.y - camY);

    // Ground shadow (skipped once the body is on the floor).
    if (this.state !== 'death' || this.deathT < 0.4) {
      ctx.fillStyle = 'rgba(8,8,18,0.35)';
      ctx.beginPath();
      ctx.ellipse(px, py - 1, 6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const aimingUp = this.dir === 2;
    if (aimingUp) this.drawGun(ctx, px, py);
    drawClip(ctx, this.clip, this.animT, px, py, this.flip);
    if (!aimingUp) this.drawGun(ctx, px, py);
  }

  /** Set by the inventory: the gun is only drawn when it is the held item. */
  showGun = false;

  private drawGun(ctx: CanvasRenderingContext2D, px: number, py: number): void {
    if (this.state === 'death' || !this.showGun) return;
    const handY = py - 14;
    const back = this.gunRecoil;
    ctx.save();
    ctx.translate(px + Math.cos(this.aim) * (3 - back), handY + Math.sin(this.aim) * (3 - back));
    ctx.rotate(this.aim);
    // Mirror vertically when aiming left so the gun never renders upside down.
    if (Math.abs(this.aim) > Math.PI / 2) ctx.scale(1, -1);
    drawFrame(ctx, this.a.gun, this.muzzleT >= 0 && this.muzzleT < 0.07 ? 1 : 0, 0, 0);
    if (this.muzzleT >= 0 && this.muzzleT < 0.09) {
      const f = Math.min(this.a.muzzle.count - 1, Math.floor((this.muzzleT / 0.09) * this.a.muzzle.count));
      drawFrame(ctx, this.a.muzzle, f, 12, 0);
    }
    ctx.restore();
  }

  drawBullets(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bullets) {
      const x = Math.round(b.x - camX);
      const y = Math.round(b.y - camY);
      ctx.strokeStyle = 'rgba(255,190,90,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(b.prevX - camX) + 0.5, Math.round(b.prevY - camY) + 0.5);
      ctx.lineTo(x + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillStyle = '#ffe08a';
      ctx.fillRect(x - 1, y - 1, 2, 2);
      ctx.fillStyle = 'rgba(255,154,60,0.7)';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  bulletLights(out: Light[]): void {
    for (const b of this.bullets) {
      out.push({ x: b.x, y: b.y, radius: 34, color: P.fire, intensity: 0.7, bloom: false });
    }
  }
}

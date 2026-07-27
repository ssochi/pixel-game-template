/**
 * Fixed low internal resolution + integer upscale.
 *
 * The canvas backing store stays at GAME_W x GAME_H; CSS stretches it by a
 * whole-number factor with `image-rendering: pixelated`, so one game pixel is
 * always an exact square block of screen pixels and nothing ever blurs.
 */
export const GAME_W = 448;
export const GAME_H = 252;

export class Screen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  scale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = GAME_W;
    canvas.height = GAME_H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.fit();
    window.addEventListener('resize', () => this.fit());
  }

  fit(): void {
    const pad = 8;
    const sx = (window.innerWidth - pad) / GAME_W;
    const sy = (window.innerHeight - pad) / GAME_H;
    this.scale = Math.max(1, Math.floor(Math.min(sx, sy)));
    this.canvas.style.width = `${GAME_W * this.scale}px`;
    this.canvas.style.height = `${GAME_H * this.scale}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  toInternal(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) / this.scale,
      y: (clientY - r.top) / this.scale,
    };
  }
}

export class Camera {
  x = 0;
  y = 0;
  private tx = 0;
  private ty = 0;
  shakeT = 0;
  shakeAmp = 0;

  follow(px: number, py: number, worldW: number, worldH: number, dt: number, snap = false): void {
    this.tx = px - GAME_W / 2;
    this.ty = py - GAME_H / 2;
    // A world smaller than the viewport (an interior) is centred rather than
    // clamped to zero, which would pin it to the top-left with black beside it.
    this.tx =
      worldW <= GAME_W ? -(GAME_W - worldW) / 2 : Math.max(0, Math.min(worldW - GAME_W, this.tx));
    this.ty =
      worldH <= GAME_H ? -(GAME_H - worldH) / 2 : Math.max(0, Math.min(worldH - GAME_H, this.ty));
    const k = snap ? 1 : 1 - Math.pow(0.0008, dt);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
  }

  shake(amp: number, time = 0.25): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, time);
  }

  update(dt: number): void {
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
  }

  /** Integer camera position — sub-pixel scrolling would shimmer. */
  get ix(): number {
    const j = this.shakeT > 0 ? (Math.random() - 0.5) * 2 * this.shakeAmp : 0;
    return Math.round(this.x + j);
  }

  get iy(): number {
    const j = this.shakeT > 0 ? (Math.random() - 0.5) * 2 * this.shakeAmp : 0;
    return Math.round(this.y + j);
  }
}

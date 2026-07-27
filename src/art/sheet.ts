/**
 * Sprite sheets & animation clips.
 *
 * Every baked asset ends up here: a horizontal strip of equal-size frames on a
 * single canvas, so the render loop only ever issues `drawImage` calls.
 */
import { PixelBuffer } from './pixel';

export interface Sheet {
  canvas: HTMLCanvasElement;
  fw: number;
  fh: number;
  count: number;
  /** Anchor inside a frame: where the sprite "stands" (feet / base centre). */
  ax: number;
  ay: number;
}

export function bakeSheet(frames: PixelBuffer[], ax: number, ay: number): Sheet {
  const fw = frames[0].w;
  const fh = frames[0].h;
  const cv = document.createElement('canvas');
  cv.width = fw * frames.length;
  cv.height = fh;
  const ctx = cv.getContext('2d')!;
  frames.forEach((f, i) => ctx.drawImage(f.toCanvas(), i * fw, 0));
  return { canvas: cv, fw, fh, count: frames.length, ax, ay };
}

export interface Clip {
  sheet: Sheet;
  /** Frame indices into the sheet, in play order. */
  order: number[];
  fps: number;
  loop: boolean;
}

export function clip(sheet: Sheet, order: number[], fps: number, loop = true): Clip {
  return { sheet, order, fps, loop };
}

export function clipDuration(c: Clip): number {
  return c.order.length / c.fps;
}

export function frameAt(c: Clip, t: number): number {
  const i = Math.floor(t * c.fps);
  if (c.loop) return c.order[((i % c.order.length) + c.order.length) % c.order.length];
  return c.order[Math.min(i, c.order.length - 1)];
}

export function clipFinished(c: Clip, t: number): boolean {
  return !c.loop && t >= c.order.length / c.fps;
}

/** Draw one frame with its anchor placed at (x, y) in screen pixels. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  frame: number,
  x: number,
  y: number,
  flipX = false,
): void {
  const sx = frame * sheet.fw;
  const dx = Math.round(x - sheet.ax);
  const dy = Math.round(y - sheet.ay);
  if (!flipX) {
    ctx.drawImage(sheet.canvas, sx, 0, sheet.fw, sheet.fh, dx, dy, sheet.fw, sheet.fh);
    return;
  }
  ctx.save();
  ctx.translate(Math.round(x), 0);
  ctx.scale(-1, 1);
  ctx.drawImage(
    sheet.canvas,
    sx,
    0,
    sheet.fw,
    sheet.fh,
    -(sheet.fw - sheet.ax),
    dy,
    sheet.fw,
    sheet.fh,
  );
  ctx.restore();
}

export function drawClip(
  ctx: CanvasRenderingContext2D,
  c: Clip,
  t: number,
  x: number,
  y: number,
  flipX = false,
): void {
  drawFrame(ctx, c.sheet, frameAt(c, t), x, y, flipX);
}

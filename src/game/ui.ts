/** HUD, help panel and the full-screen asset gallery. */
import type { GalleryGroup } from '../art/assets';
import { drawClip, type Clip } from '../art/sheet';
import { drawText, textWidth } from '../engine/font';
import { GAME_H, GAME_W } from '../engine/screen';

export interface HudState {
  fps: number;
  dayT: number;
  lighting: boolean;
  bloom: boolean;
  paused: boolean;
  playerState: string;
  forced: string | null;
  entities: number;
  particles: number;
  showHelp: boolean;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a = 0.72): void {
  ctx.fillStyle = `rgba(10,12,20,${a})`;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(90,110,145,0.55)';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

function clock(dayT: number): string {
  const total = ((dayT % 1) + 1) % 1 * 24 * 60;
  const hh = Math.floor(total / 60);
  const mm = Math.floor(total % 60);
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

const HELP: string[] = [
  'WASD / ARROWS  MOVE',
  'SHIFT          RUN',
  'MOUSE          AIM',
  'LMB / SPACE    SHOOT',
  'K / R          DIE / REVIVE',
  'E              USE CHEST',
  '1-5 / 0        FORCE ANIM',
  'TAB            ASSET GALLERY',
  'L B            LIGHT / BLOOM',
  '[ ] T          TIME  -  + PAUSE',
  'G C            GRID / COLLIDERS',
  'H              HIDE THIS',
];

export function drawHud(ctx: CanvasRenderingContext2D, s: HudState): void {
  // Top bar
  panel(ctx, 2, 2, 128, 9, 0.6);
  drawText(ctx, `FPS ${s.fps.toString().padStart(3, ' ')}  ${clock(s.dayT)}${s.paused ? ' *' : ''}`, 5, 4, '#cfe0f5');
  drawText(ctx, `E:${s.entities} P:${s.particles}`, 82, 4, '#7f92b0');

  // Status line
  const st = `${s.forced ? 'FORCED ' : ''}${(s.forced ?? s.playerState).toUpperCase()}`;
  panel(ctx, 2, 13, textWidth(st) + 6, 9, 0.6);
  drawText(ctx, st, 5, 15, s.forced ? '#f0c261' : '#8fd0a0');

  const flags = `${s.lighting ? 'LIGHT' : 'light'} ${s.bloom ? 'BLOOM' : 'bloom'}`;
  drawText(ctx, flags, GAME_W - textWidth(flags) - 4, 4, '#7f92b0');

  if (s.showHelp) {
    const w = 92;
    const h = HELP.length * 7 + 8;
    panel(ctx, 2, GAME_H - h - 2, w, h);
    HELP.forEach((line, i) => drawText(ctx, line, 6, GAME_H - h + 2 + i * 7, i === 0 ? '#cfe0f5' : '#93a7c6'));
  } else {
    drawText(ctx, 'H = HELP', 4, GAME_H - 9, '#5c6a85');
  }
}

export function drawInspect(ctx: CanvasRenderingContext2D, label: string, x: number, y: number): void {
  if (!label) return;
  const w = textWidth(label) + 6;
  panel(ctx, x - w / 2, y - 12, w, 9, 0.8);
  drawText(ctx, label, x - w / 2 + 3, y - 10, '#cfe0f5');
}

const CELL = 60;
const CELL_H = 66;

export class Gallery {
  open = false;
  scroll = 0;
  private maxScroll = 0;
  private t = 0;

  constructor(private groups: GalleryGroup[]) {}

  update(dt: number, dScroll: number): void {
    this.t += dt;
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + dScroll));
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0b0e16';
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    const cols = Math.floor((GAME_W - 8) / CELL);
    const left = Math.floor((GAME_W - cols * CELL) / 2);
    let y = 16 - this.scroll;

    for (const g of this.groups) {
      if (y > -12 && y < GAME_H) {
        drawText(ctx, `- ${g.title} -`, left, y, '#f0c261');
        ctx.fillStyle = 'rgba(120,140,180,0.25)';
        ctx.fillRect(left, y + 7, cols * CELL - 6, 1);
      }
      y += 12;
      for (let i = 0; i < g.entries.length; i += cols) {
        const rowY = y;
        if (rowY > -CELL_H && rowY < GAME_H) {
          for (let c = 0; c < cols && i + c < g.entries.length; c++) {
            this.cell(ctx, g.entries[i + c], left + c * CELL, rowY);
          }
        }
        y += CELL_H;
      }
      y += 6;
    }
    this.maxScroll = Math.max(0, y + this.scroll - GAME_H + 16);

    // Header + scrollbar
    ctx.fillStyle = 'rgba(11,14,22,0.95)';
    ctx.fillRect(0, 0, GAME_W, 13);
    drawText(ctx, 'ASSET GALLERY   TAB=BACK   WHEEL/W-S=SCROLL', 4, 4, '#cfe0f5');
    if (this.maxScroll > 0) {
      const h = Math.max(8, (GAME_H * GAME_H) / (GAME_H + this.maxScroll));
      const t = this.scroll / this.maxScroll;
      ctx.fillStyle = 'rgba(60,74,100,0.8)';
      ctx.fillRect(GAME_W - 3, 13, 2, GAME_H - 13);
      ctx.fillStyle = '#8fa8cc';
      ctx.fillRect(GAME_W - 3, 13 + t * (GAME_H - 13 - h), 2, h);
    }
  }

  private cell(ctx: CanvasRenderingContext2D, e: { name: string; clip: Clip }, x: number, y: number): void {
    // Checkerboard so transparent edges are visible.
    for (let cy = 0; cy < 44; cy += 4)
      for (let cx = 0; cx < CELL - 4; cx += 4) {
        ctx.fillStyle = ((cx + cy) / 4) % 2 === 0 ? '#171c28' : '#141824';
        ctx.fillRect(x + cx, y + cy, 4, 4);
      }
    ctx.fillStyle = 'rgba(90,110,145,0.35)';
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 5, 43);

    const sheet = e.clip.sheet;
    const cx = x + (CELL - 4) / 2;
    // Anchor sits on a baseline near the bottom of the cell.
    const baseY = y + 38;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, CELL - 6, 42);
    ctx.clip();
    const scale = sheet.fh > 42 || sheet.fw > CELL - 8 ? 0.5 : 1;
    if (scale !== 1) {
      ctx.translate(cx, baseY);
      ctx.scale(scale, scale);
      drawClip(ctx, e.clip, this.t, 0, 0);
    } else {
      drawClip(ctx, e.clip, this.t, cx, baseY);
    }
    ctx.restore();

    drawText(ctx, e.name.slice(0, 13), x + 1, y + 46, '#a8bcd8');
    drawText(ctx, `${sheet.fw}X${sheet.fh} ${sheet.count}F`, x + 1, y + 53, '#5c6a85');
  }
}

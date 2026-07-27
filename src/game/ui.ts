/** HUD, hotbar, dialogue box, help panel and the full-screen asset gallery. */
import type { Assets, GalleryGroup } from '../art/assets';
import { drawClip, drawFrame, type Clip } from '../art/sheet';
import { drawText, textWidth } from '../engine/font';
import { GAME_H, GAME_W } from '../engine/screen';
import { HOTBAR_SIZE, ITEMS, iconFor, type Inventory } from './inventory';

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
  /** OUTSIDE, or the name of the room the player is standing in. */
  place: string;
  day: number;
  gold: number;
  energy: number;
  /** One-line reminder of the job on the notice board. */
  quest: string | null;
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
  'LMB / SPACE    USE TOOL',
  '1-8 / WHEEL    SELECT ITEM',
  'E              TALK / USE',
  'ENTER ON BED   SLEEP',
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
  drawText(ctx, s.place, GAME_W - textWidth(s.place) - 4, 13, '#f0c261');

  // Day / money, top-right under the flags.
  const day = `DAY ${s.day}`;
  drawText(ctx, day, GAME_W - textWidth(day) - 4, 22, '#cfe0f5');
  const gold = `${s.gold}G`;
  drawText(ctx, gold, GAME_W - textWidth(gold) - 4, 31, '#f0c261');

  if (s.quest) {
    const q = s.quest.slice(0, 46);
    panel(ctx, 2, 24, textWidth(q) + 6, 9, 0.6);
    drawText(ctx, q, 5, 26, '#8fd0a0');
  }

  // Energy bar, bottom-right.
  const bw = 60;
  const bx = GAME_W - bw - 6;
  const by = GAME_H - 12;
  panel(ctx, bx - 2, by - 2, bw + 4, 8, 0.6);
  ctx.fillStyle = '#2a3346';
  ctx.fillRect(bx, by, bw, 4);
  const e = Math.max(0, Math.min(1, s.energy));
  ctx.fillStyle = e > 0.3 ? '#7fd07f' : '#e0713c';
  ctx.fillRect(bx, by, Math.round(bw * e), 4);

  if (s.showHelp) {
    const w = 92;
    const h = HELP.length * 7 + 8;
    panel(ctx, 2, GAME_H - h - 2, w, h);
    HELP.forEach((line, i) => drawText(ctx, line, 6, GAME_H - h + 2 + i * 7, i === 0 ? '#cfe0f5' : '#93a7c6'));
  } else {
    drawText(ctx, 'H = HELP', 4, GAME_H - 9, '#5c6a85');
  }
}

/** Hotbar across the bottom of the screen. */
export function drawHotbar(ctx: CanvasRenderingContext2D, a: Assets, inv: Inventory): void {
  const slot = 22;
  const w = HOTBAR_SIZE * slot;
  const x0 = Math.round((GAME_W - w) / 2);
  const y0 = GAME_H - slot - 3;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const x = x0 + i * slot;
    const sel = i === inv.selected;
    ctx.fillStyle = sel ? 'rgba(30,38,54,0.95)' : 'rgba(12,15,24,0.85)';
    ctx.fillRect(x, y0, slot - 2, slot - 2);
    ctx.fillStyle = sel ? '#f0c261' : 'rgba(90,110,145,0.6)';
    ctx.fillRect(x, y0, slot - 2, 1);
    ctx.fillRect(x, y0 + slot - 3, slot - 2, 1);
    ctx.fillRect(x, y0, 1, slot - 2);
    ctx.fillRect(x + slot - 3, y0, 1, slot - 2);

    const s = inv.slots[i];
    if (s.item) {
      const icon = iconFor(a, s.item);
      if (icon) {
        // Icons vary in size; scale the big ones down into the slot.
        const k = Math.min(1, 14 / Math.max(icon.fw, icon.fh));
        ctx.save();
        ctx.translate(x + (slot - 2) / 2, y0 + (slot - 2) / 2 + 2);
        if (k !== 1) ctx.scale(k, k);
        drawFrame(ctx, icon, 0, 0, icon.ay - icon.fh / 2 + (icon.fh * 0) + icon.fh / 2 - icon.ay + icon.fh / 2);
        ctx.restore();
      }
      if (!ITEMS[s.item].tool && s.count > 1) {
        const label = String(s.count);
        drawText(ctx, label, x + slot - 4 - textWidth(label), y0 + slot - 9, '#e8eef8');
      }
    }
    drawText(ctx, String(i + 1), x + 2, y0 + 2, sel ? '#f0c261' : '#54617a', null);
  }
  // Name of the held item, above the bar.
  const held = inv.held;
  if (held) {
    const n = held.name;
    drawText(ctx, n, Math.round((GAME_W - textWidth(n)) / 2), y0 - 9, '#cfe0f5');
  }
}

/** A Stardew-style dialogue box with a speaker name. */
export function drawDialogue(ctx: CanvasRenderingContext2D, speaker: string, lines: string[]): void {
  const h = 14 + lines.length * 8;
  const y = GAME_H - h - 30;
  panel(ctx, 12, y, GAME_W - 24, h, 0.92);
  drawText(ctx, speaker.toUpperCase(), 18, y + 3, '#f0c261');
  lines.forEach((l, i) => drawText(ctx, l, 18, y + 12 + i * 8, '#e8eef8'));
  drawText(ctx, 'E', GAME_W - 24, y + h - 9, '#7f92b0');
}

/** Mara's shop: a list of stock with prices, and your purse. */
export function drawShop(
  ctx: CanvasRenderingContext2D,
  a: Assets,
  stock: { item: string; price: number }[],
  index: number,
  gold: number,
): void {
  const w = 170;
  const rowH = 18;
  const h = 22 + stock.length * rowH;
  const x = Math.round((GAME_W - w) / 2);
  const y = Math.round((GAME_H - h) / 2);
  panel(ctx, x, y, w, h, 0.94);
  drawText(ctx, 'GENERAL STORE', x + 6, y + 4, '#f0c261');
  const purse = `${gold}G`;
  drawText(ctx, purse, x + w - textWidth(purse) - 6, y + 4, '#f0c261');

  stock.forEach((s, i) => {
    const ry = y + 16 + i * rowH;
    if (i === index) {
      ctx.fillStyle = 'rgba(60,74,100,0.8)';
      ctx.fillRect(x + 3, ry - 1, w - 6, rowH - 2);
    }
    const icon = iconFor(a, s.item);
    if (icon) {
      const k = Math.min(1, 12 / Math.max(icon.fw, icon.fh));
      ctx.save();
      ctx.translate(x + 12, ry + 7);
      if (k !== 1) ctx.scale(k, k);
      drawFrame(ctx, icon, 0, 0, icon.fh / 2);
      ctx.restore();
    }
    const def = ITEMS[s.item];
    drawText(ctx, def.name.slice(0, 16), x + 22, ry + 2, gold >= s.price ? '#e8eef8' : '#6b7690');
    const p = `${s.price}G`;
    drawText(ctx, p, x + w - textWidth(p) - 6, ry + 2, gold >= s.price ? '#f0c261' : '#6b7690');
  });
  drawText(ctx, 'W/S PICK   E BUY   TAB CLOSE', x + 6, y + h - 9, '#7f92b0');
}

/** Full-screen banner used for the day transition. */
export function drawDayCard(ctx: CanvasRenderingContext2D, day: number, alpha: number): void {
  ctx.fillStyle = `rgba(6,7,12,${alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, GAME_W, GAME_H);
  if (alpha < 0.55) return;
  const t = `DAY ${day}`;
  drawText(ctx, t, Math.round((GAME_W - textWidth(t) * 2) / 2), GAME_H / 2 - 8, '#f0c261');
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

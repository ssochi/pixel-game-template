/** HUD, hotbar, dialogue box, help panel and the full-screen asset gallery. */
import type { Assets, GalleryGroup } from '../art/assets';
import { drawClip, drawFrame, type Clip } from '../art/sheet';
import { ADVANCE, drawText, GLYPH_H, textWidth } from '../engine/font';
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
  /** Transient message — currently only "the save could not be written". */
  notice: string | null;
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
  '1-0 / WHEEL    SELECT ITEM',
  'E              TALK / USE',
  'ROD + SPACE    CAST / REEL',
  'ENTER ON BED   SLEEP',
  'TAB            ASSET GALLERY',
  'L B            LIGHT / BLOOM',
  '[ ] T          TIME  -  + PAUSE',
  'G C            GRID / COLLIDERS',
  'H              HIDE THIS',
];

/**
 * Top-left column geometry. The clock capsule and the quest banner are stacked,
 * both left-aligned on the same edge and each sized to its own text, so a short
 * notice stays a short bar. Every number here is a whole pixel: the frame is
 * 448x252 before scaling, and half a pixel is a smear.
 */
const COL_X = 2;
const COL_Y = 2;
/** Text inset inside a capsule, on every side. */
const CAP_PAD = 3;
/** 1px border + 1px air + glyph + 1px drop shadow + 1px air + 1px border. */
const CAP_H = GLYPH_H + 4;
/** Air between the clock capsule and the banner under it. */
const CAP_GAP = 2;

/** Widest a top-left capsule may get: it has to stay clear of the middle. */
const CAP_MAX_W = Math.floor(GAME_W / 2) - 16 - COL_X;

/** Longest string that fits `CAP_MAX_W` once the capsule padding is paid for. */
function capsuleFit(s: string): string {
  const n = Math.max(1, Math.floor((CAP_MAX_W - CAP_PAD * 2 + 1) / ADVANCE));
  return s.length <= n ? s : s.slice(0, n);
}

/** Draw one top-left capsule at `y`, sized to its text. Returns the next free y. */
function capsule(ctx: CanvasRenderingContext2D, text: string, y: number, color: string): number {
  panel(ctx, COL_X, y, textWidth(text) + CAP_PAD * 2, CAP_H, 0.6);
  drawText(ctx, text, COL_X + CAP_PAD, y + 2, color);
  return y + CAP_H + CAP_GAP;
}

export function drawHud(ctx: CanvasRenderingContext2D, s: HudState): void {
  // Clock, top of the left column. This is player-facing time, not a debug
  // readout, so it always shows.
  const clk = `${clock(s.dayT)}${s.paused ? ' *' : ''}`;
  const questY = capsule(ctx, clk, COL_Y, '#cfe0f5');

  // Place name, top-right.
  drawText(ctx, s.place, GAME_W - textWidth(s.place) - 4, 4, '#f0c261');

  // Day / money, top-right under the place name.
  const day = `DAY ${s.day}`;
  drawText(ctx, day, GAME_W - textWidth(day) - 4, 13, '#cfe0f5');
  const gold = `${s.gold}G`;
  drawText(ctx, gold, GAME_W - textWidth(gold) - 4, 22, '#f0c261');

  // The job on the notice board, directly under the clock, and under that any
  // one-off notice. They stack, so a notice never hides the quest line.
  let colY = questY;
  if (s.quest) colY = capsule(ctx, capsuleFit(s.quest), colY, '#8fd0a0');
  if (s.notice) capsule(ctx, capsuleFit(s.notice), colY, '#e06b6b');

  // Energy bar, bottom-right, with a small "STA" tag and a panel that clears
  // the screen edge by a few pixels either way.
  const staLabel = 'STA';
  const staW = textWidth(staLabel);
  const bw = 54;
  const bx = GAME_W - bw - 8;
  const by = GAME_H - 12;
  panel(ctx, bx - staW - 7, by - 2, bw + staW + 11, 8, 0.6);
  drawText(ctx, staLabel, bx - staW - 4, by - 1, '#7f92b0');
  ctx.fillStyle = '#2a3346';
  ctx.fillRect(bx, by, bw, 4);
  const e = Math.max(0, Math.min(1, s.energy));
  ctx.fillStyle = e > 0.3 ? '#7fd07f' : '#e0713c';
  ctx.fillRect(bx, by, Math.round(bw * e), 4);

  // Debug readouts (FPS, entity/particle counts, AI state, light/bloom
  // toggles) are dev info, not HUD — only surface them with the help panel.
  if (s.showHelp) {
    const dw = 92;
    const dbg = [
      `FPS ${s.fps.toString().padStart(3, ' ')}`,
      `E:${s.entities} P:${s.particles}`,
      `${s.forced ? 'FORCED ' : ''}${(s.forced ?? s.playerState).toUpperCase()}`,
      `${s.lighting ? 'LIGHT' : 'light'} ${s.bloom ? 'BLOOM' : 'bloom'}`,
    ];
    const dbgH = dbg.length * 7 + 8;
    const helpH = HELP.length * 7 + 8;
    const dbgY = GAME_H - helpH - dbgH - 4;
    panel(ctx, 2, dbgY, dw, dbgH, 0.6);
    dbg.forEach((line, i) =>
      drawText(ctx, line, 6, dbgY + 4 + i * 7, i === 2 ? (s.forced ? '#f0c261' : '#8fd0a0') : '#93a7c6'),
    );

    panel(ctx, 2, GAME_H - helpH - 2, dw, helpH);
    HELP.forEach((line, i) => drawText(ctx, line, 6, GAME_H - helpH + 2 + i * 7, i === 0 ? '#cfe0f5' : '#93a7c6'));
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
        // Scale oversized icons down, then centre the frame's bounding box on
        // the slot centre. Passing (ax - fw/2, ay - fh/2) to drawFrame puts the
        // box centre at the origin regardless of where the sheet's anchor is —
        // anchors vary (feet, centre, corner), so anything else drifts.
        const k = Math.min(1, 16 / Math.max(icon.fw, icon.fh));
        ctx.save();
        ctx.translate(x + (slot - 2) / 2, y0 + (slot - 2) / 2);
        if (k !== 1) ctx.scale(k, k);
        drawFrame(ctx, icon, 0, icon.ax - icon.fw / 2, icon.ay - icon.fh / 2);
        ctx.restore();
      }
      if (!ITEMS[s.item].tool && s.count > 1) {
        const label = String(s.count);
        drawText(ctx, label, x + slot - 4 - textWidth(label), y0 + slot - 9, '#e8eef8');
      }
    }
    // Slot 10 is bound to `0`, so label it with the key you actually press.
    drawText(ctx, i === 9 ? '0' : String(i + 1), x + 2, y0 + 2, sel ? '#f0c261' : '#54617a', null);
  }
  // Name of the held item, above the bar. It sits over the world (which can
  // be pale ground tiles), so it needs its own backing panel to stay legible.
  const held = inv.held;
  if (held) {
    const n = held.name;
    const tw = textWidth(n);
    const tx = Math.round((GAME_W - tw) / 2);
    const ty = y0 - 9;
    panel(ctx, tx - 3, ty - 3, tw + 6, GLYPH_H + 6, 0.6);
    drawText(ctx, n, tx, ty, '#cfe0f5');
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
  owned?: (item: string) => number,
): void {
  const w = 170;
  const rowH = 18;
  // Extra room below the last row so the control hint doesn't run into it.
  const footerGap = 8;
  const h = 22 + stock.length * rowH + footerGap;
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
      // One pixel short of the panel's inner border on the right.
      ctx.fillRect(x + 3, ry - 1, w - 7, rowH - 2);
    }
    const icon = iconFor(a, s.item);
    if (icon) {
      const k = Math.min(1, 13 / Math.max(icon.fw, icon.fh));
      ctx.save();
      ctx.translate(x + 12, ry + 6);
      if (k !== 1) ctx.scale(k, k);
      drawFrame(ctx, icon, 0, icon.ax - icon.fw / 2, icon.ay - icon.fh / 2);
      ctx.restore();
    }
    const def = ITEMS[s.item];
    drawText(ctx, def.name.slice(0, 16), x + 22, ry + 2, gold >= s.price ? '#e8eef8' : '#6b7690');
    const p = `${s.price}G`;
    const priceX = x + w - textWidth(p) - 6;
    drawText(ctx, p, priceX, ry + 2, gold >= s.price ? '#f0c261' : '#6b7690');
    if (owned) {
      const oc = `x${owned(s.item)}`;
      drawText(ctx, oc, priceX - textWidth(oc) - 6, ry + 2, '#5c6a85');
    }
  });
  drawText(ctx, 'W/S PICK   E BUY   TAB CLOSE', x + 6, y + h - 9, '#7f92b0');
}

/**
 * The reeling minigame: a vertical track with the fish on it and the player's
 * catch box over the top, plus a progress column beside it.
 *
 * It sits at the right edge rather than the centre so it never covers the
 * float — you want to see the water you are fishing while you fight the fish.
 */
export function drawReel(
  ctx: CanvasRenderingContext2D,
  a: Assets,
  f: { barY: number; boxH: number; fishY: number; progress: number; hooked: { id: string; name: string } | null },
): void {
  const trackH = 112;
  const trackW = 14;
  // Clear of the right edge and low enough to miss the top-right HUD block.
  const x = GAME_W - 58;
  const y = Math.round((GAME_H - trackH) / 2) + 6;

  panel(ctx, x - 7, y - 13, trackW + 30, trackH + 22, 0.9);

  // Track.
  ctx.fillStyle = 'rgba(24,40,62,0.95)';
  ctx.fillRect(x, y, trackW, trackH);

  // `barY` is 0 at the bottom, so screen y counts the other way.
  const toY = (v: number) => y + Math.round((1 - v) * trackH);

  // The player's catch box.
  const boxPx = Math.max(8, Math.round(f.boxH * trackH));
  const boxTop = Math.min(y + trackH - boxPx, Math.max(y, toY(f.barY) - boxPx / 2));
  const on = Math.abs(f.fishY - f.barY) <= f.boxH / 2;
  ctx.fillStyle = on ? 'rgba(120,200,120,0.5)' : 'rgba(140,160,190,0.28)';
  ctx.fillRect(x, boxTop, trackW, boxPx);
  ctx.fillStyle = on ? '#8ede8e' : '#7f92b0';
  ctx.fillRect(x, boxTop, trackW, 1);
  ctx.fillRect(x, boxTop + boxPx - 1, trackW, 1);

  // The fish itself, scaled down into the track.
  const icon = f.hooked ? a.fishing.fish[f.hooked.id] : null;
  if (icon) {
    const k = Math.min(1, (trackW - 2) / icon.fw);
    ctx.save();
    ctx.translate(x + trackW / 2, toY(f.fishY));
    if (k !== 1) ctx.scale(k, k);
    drawFrame(ctx, icon, 0, 0, 0);
    ctx.restore();
  }

  // Progress column: green filling from the bottom.
  const px = x + trackW + 3;
  ctx.fillStyle = 'rgba(24,40,62,0.95)';
  ctx.fillRect(px, y, 5, trackH);
  const ph = Math.round(f.progress * trackH);
  ctx.fillStyle = f.progress > 0.66 ? '#8ede8e' : f.progress > 0.3 ? '#f0c261' : '#e06b6b';
  ctx.fillRect(px, y + trackH - ph, 5, ph);

  if (f.hooked) {
    const n = f.hooked.name;
    drawText(ctx, n.slice(0, 11), x - 5, y - 11, '#cfe0f5');
  }
}

/** The "!" over the float, and the caught-fish banner. */
export function drawCatch(
  ctx: CanvasRenderingContext2D,
  a: Assets,
  fish: { id: string; name: string; price: number },
): void {
  const w = 140;
  const h = 44;
  const x = Math.round((GAME_W - w) / 2);
  const y = Math.round(GAME_H * 0.3);
  panel(ctx, x, y, w, h, 0.94);
  drawText(ctx, 'CAUGHT!', x + 6, y + 5, '#f0c261');
  const icon = a.fishing.fish[fish.id];
  if (icon) {
    const k = Math.min(1, 54 / icon.fw);
    ctx.save();
    ctx.translate(x + 40, y + 27);
    if (k !== 1) ctx.scale(k, k);
    drawFrame(ctx, icon, 0, 0, 0);
    ctx.restore();
  }
  drawText(ctx, fish.name.slice(0, 14), x + 74, y + 19, '#e8eef8');
  drawText(ctx, `${fish.price}G`, x + 74, y + 29, '#f0c261');
}

/** Full-screen banner used for the day transition. */
export function drawDayCard(ctx: CanvasRenderingContext2D, day: number, alpha: number): void {
  ctx.fillStyle = `rgba(6,7,12,${alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, GAME_W, GAME_H);
  if (alpha < 0.55) return;
  const t = `DAY ${day}`;
  drawText(ctx, t, Math.round((GAME_W - textWidth(t) * 2) / 2), GAME_H / 2 - 8, '#f0c261');
}

export interface TitleState {
  /** Day the save on disk left off on — the whole reason CONTINUE is offered. */
  saveDay: number;
  /** 0 = continue, 1 = new game. */
  index: number;
  /** True while the "are you sure" step is up. */
  confirming: boolean;
  /** 0 = keep the save, 1 = erase it. */
  confirmIndex: number;
}

/**
 * The boot menu, shown only when a save exists.
 *
 * It draws over the live valley rather than a black plate, so the first thing
 * you see is the place you are going back to. Everything is laid out on whole
 * pixels off the panel's own origin: at 448x252 a half-pixel is a smeared
 * glyph, and the panel is sized to its longest line so the confirm step — whose
 * options are much longer — does not need a second set of numbers.
 */
export function drawTitle(ctx: CanvasRenderingContext2D, s: TitleState): void {
  ctx.fillStyle = 'rgba(6,7,12,0.72)';
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  // The name, at a clean 2x. Integer translate + integer scale keeps the 3x5
  // font on the grid; anything fractional would resample it into mush.
  const name = 'RIVERVALE';
  ctx.save();
  ctx.translate(Math.round((GAME_W - textWidth(name) * 2) / 2), 56);
  ctx.scale(2, 2);
  drawText(ctx, name, 0, 0, '#f0c261');
  ctx.restore();

  const head = s.confirming ? ['ERASING THE SAVE CANNOT', 'BE UNDONE.'] : [];
  const opts = s.confirming
    ? ['NO - KEEP MY SAVE', 'YES - ERASE IT']
    : [`CONTINUE - DAY ${s.saveDay}`, 'NEW GAME'];
  const pick = s.confirming ? s.confirmIndex : s.index;
  const y0 = 84;

  const ROW = 12;
  const longest = [...head, ...opts].reduce((m, l) => Math.max(m, textWidth(l)), 0);
  const w = Math.max(150, longest + 24);
  // The first option's highlight bar starts 2px above its text, and the last
  // one ends 2px below: sizing the panel off `optY` keeps the air at the bottom
  // equal to the air at the top for both step counts.
  const optY = y0 + 6 + head.length * 8 + (head.length ? 4 : 0);
  const h = optY - y0 + opts.length * ROW;
  const x = Math.round((GAME_W - w) / 2);
  const y = y0;
  panel(ctx, x, y, w, h, 0.9);

  head.forEach((l, i) => drawText(ctx, l, x + Math.round((w - textWidth(l)) / 2), y + 5 + i * 8, '#cfe0f5'));
  opts.forEach((l, i) => {
    const ry = optY + i * ROW;
    const on = i === pick;
    if (on) {
      ctx.fillStyle = 'rgba(60,74,100,0.85)';
      ctx.fillRect(x + 3, ry - 2, w - 7, ROW - 2);
    }
    // The destructive option is the only red text on the screen, selected or
    // not, so it never gets picked by muscle memory.
    const danger = s.confirming && i === 1;
    const tx = x + Math.round((w - textWidth(l)) / 2);
    drawText(ctx, l, tx, ry, danger ? '#e06b6b' : on ? '#f0c261' : '#93a7c6');
  });

  const hint = s.confirming ? 'W/S PICK   E CONFIRM   Q BACK' : 'W/S PICK   E CONFIRM';
  drawText(ctx, hint, Math.round((GAME_W - textWidth(hint)) / 2), y + h + 6, '#7f92b0');
}

const CELL = 60;
const CELL_H = 66;

/**
 * Wrap a gallery entry's name to fit `maxW` pixels, breaking on the space
 * nearest the middle rather than hard-truncating (e.g. "HERO ATTACK DOWN"
 * becoming "HERO ATTACK D..."). Falls back to a single, unbroken line when
 * there's no space to break on.
 */
function wrapCellName(name: string, maxW: number): string[] {
  if (textWidth(name) <= maxW) return [name];
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === ' ') {
      const dist = Math.abs(i - name.length / 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
  }
  if (best === -1) return [name];
  return [name.slice(0, best), name.slice(best + 1)];
}

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

    const nameLines = wrapCellName(e.name, CELL - 6);
    nameLines.forEach((line, i) => drawText(ctx, line, x + 1, y + 46 + i * 7, '#a8bcd8'));
    drawText(ctx, `${sheet.fw}X${sheet.fh} ${sheet.count}F`, x + 1, y + 46 + nameLines.length * 7, '#5c6a85');
  }
}

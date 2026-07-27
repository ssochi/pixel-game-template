/**
 * Proof sheet: every sprite blown up with a pixel grid over it.
 *
 * Pixel art can only be judged at the pixel level — jaggies, doubles, stray
 * single pixels and broken curves are invisible at 1:1 but obvious at 8:1.
 * Open `/proof.html` while working on an asset.
 */
import { bakeAll } from './art/assets';
import { bakeSheet, type Sheet } from './art/sheet';
import { drawText } from './engine/font';

const ZOOM = 8;
const PAD = 10;

function main(): void {
  const assets = bakeAll();

  const items: { name: string; sheet: Sheet; frame: number }[] = [];
  const add = (name: string, sheet: Sheet, frames: number[] = [0]): void => {
    for (const f of frames) items.push({ name: frames.length > 1 ? `${name} ${f}` : name, sheet, frame: f });
  };

  const group = new URLSearchParams(location.search).get('g') ?? 'items';
  const p = assets.props;
  const n = assets.nature;

  if (group === 'items') {
    add('potion a', p.potions[0].sheet);
    add('potion b', p.potions[1].sheet);
    add('potion c', p.potions[2].sheet);
    add('coin', p.coin.sheet, [0, 1, 2, 3, 4, 5, 6, 7]);
    add('key', p.key.sheet);
    add('gem', p.gems[0].sheet);
    add('heart', p.heart.sheet);
    add('ammo', p.ammo);
    add('scroll', p.scroll);
    add('mushroom', n.mushrooms[0]);
    add('shroom glow', n.mushrooms[1]);
    add('flower', n.flowers[0].sheet);
  } else if (group === 'hero') {
    for (const s of assets.hero.sheets.filter((x) => x.name === 'idle' || x.name === 'walk')) {
      add(`${s.name} d${s.dir}`, s.sheet, [0, 2]);
    }
    add('gun', assets.gun, [0, 1]);
    add('slime', assets.slime.idle.sheet, [0, 3]);
  } else if (group === 'animals') {
    const an = assets.animals;
    add('cow idle', an.cow.idle.sheet, [0]);
    add('cow walk', an.cow.walk.sheet, [1, 4]);
    add('cow graze', an.cow.graze.sheet, [2]);
    add('sheep', an.sheep.walk.sheet, [0, 3]);
    add('pig', an.pig.walk.sheet, [0, 3]);
    add('goat', an.goat.walk.sheet, [0]);
    add('chicken', an.chicken.idle.sheet, [0]);
    add('chick peck', an.chicken.graze.sheet, [1]);
    add('duck', an.duck.idle.sheet, [0, 2]);
  } else if (group === 'fish') {
    const fi = assets.fishing;
    for (const [id, sh] of Object.entries(fi.fish)) add(id, sh, [0]);
    add('rod', fi.rod, [0]);
    add('float', fi.float.sheet, [0, 1, 4]);
    add('alert', fi.alert.sheet, [0]);
  } else if (group === 'town') {
    const bd = assets.buildings;
    const sheetOf = (b: { buffer: import('./art/pixel').PixelBuffer; ax: number; ay: number }) =>
      bakeSheet([b.buffer], b.ax, b.ay);
    add('cottage a', sheetOf(bd.cottages[0]));
    add('cottage b', sheetOf(bd.cottages[1]));
    add('tavern', sheetOf(bd.tavern));
    add('mill', sheetOf(bd.mill));
    add('wheel', bd.waterWheel.sheet, [0, 2]);
    add('haystack', bd.haystacks[0]);
    add('scarecrow', bd.scarecrow);
    add('stall', bd.stalls[0]);
    add('cart', bd.cart);
    add('sign', bd.signs.tavern);
    add('wheat', bd.wheat[0]);
    add('cow', assets.animals.cow.idle.sheet, [0]);
    add('sheep', assets.animals.sheep.walk.sheet, [0]);
    add('pig', assets.animals.pig.walk.sheet, [0]);
    add('chicken', assets.animals.chicken.idle.sheet, [0]);
    add('duck', assets.animals.duck.idle.sheet, [0]);
    add('npc', assets.npcs[2].idle[0].sheet, [0]);
  } else {
    add('barrel', p.barrels[0]);
    add('crate', p.crates[0]);
    add('chest', p.chestClosed);
    add('table', p.table);
    add('rock s', n.rocks[0]);
    add('rock m', n.rocks[1]);
    add('bush', n.bushes[0].sheet);
    add('grass', n.grass[0].sheet);
  }

  const cols = Math.max(1, Math.floor(1800 / (Math.max(...items.map((i) => i.sheet.fw)) * ZOOM + PAD * 2)));
  const cellW = Math.max(...items.map((i) => i.sheet.fw)) * ZOOM + PAD * 2;
  const cellH = Math.max(...items.map((i) => i.sheet.fh)) * ZOOM + PAD * 2 + 16;
  const rows = Math.ceil(items.length / cols);

  const cv = document.getElementById('proof') as HTMLCanvasElement;
  cv.width = cols * cellW;
  cv.height = rows * cellH;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0e16';
  ctx.fillRect(0, 0, cv.width, cv.height);

  items.forEach((it, i) => {
    const cx = (i % cols) * cellW;
    const cy = Math.floor(i / cols) * cellH;
    const w = it.sheet.fw * ZOOM;
    const h = it.sheet.fh * ZOOM;
    const x = cx + PAD;
    const y = cy + PAD;

    // Checkerboard so transparent pixels are unmistakable.
    for (let by = 0; by < h; by += ZOOM)
      for (let bx = 0; bx < w; bx += ZOOM) {
        ctx.fillStyle = ((bx + by) / ZOOM) % 2 === 0 ? '#1b2030' : '#151926';
        ctx.fillRect(x + bx, y + by, ZOOM, ZOOM);
      }

    ctx.drawImage(it.sheet.canvas, it.frame * it.sheet.fw, 0, it.sheet.fw, it.sheet.fh, x, y, w, h);

    // Pixel grid.
    ctx.strokeStyle = 'rgba(120,150,200,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx <= w; gx += ZOOM) {
      ctx.moveTo(x + gx + 0.5, y);
      ctx.lineTo(x + gx + 0.5, y + h);
    }
    for (let gy = 0; gy <= h; gy += ZOOM) {
      ctx.moveTo(x, y + gy + 0.5);
      ctx.lineTo(x + w, y + gy + 0.5);
    }
    ctx.stroke();

    // Anchor cross-hair, to check that sprites sit on their feet.
    ctx.strokeStyle = 'rgba(255,120,120,0.6)';
    ctx.beginPath();
    ctx.moveTo(x + it.sheet.ax * ZOOM + 0.5, y);
    ctx.lineTo(x + it.sheet.ax * ZOOM + 0.5, y + h);
    ctx.moveTo(x, y + it.sheet.ay * ZOOM + 0.5);
    ctx.lineTo(x + w, y + it.sheet.ay * ZOOM + 0.5);
    ctx.stroke();

    drawText(ctx, `${it.name} ${it.sheet.fw}X${it.sheet.fh}`, x, y + h + 4, '#a8bcd8', null);
  });
}

main();

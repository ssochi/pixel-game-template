/** 3x5 bitmap font, baked to a per-colour atlas so UI text stays on the pixel grid. */

const GLYPHS: Record<string, string> = {
  A: '###|#.#|###|#.#|#.#',
  B: '##.|#.#|##.|#.#|##.',
  C: '###|#..|#..|#..|###',
  D: '##.|#.#|#.#|#.#|##.',
  E: '###|#..|##.|#..|###',
  F: '###|#..|##.|#..|#..',
  G: '###|#..|#.#|#.#|###',
  H: '#.#|#.#|###|#.#|#.#',
  I: '###|.#.|.#.|.#.|###',
  J: '..#|..#|..#|#.#|###',
  K: '#.#|#.#|##.|#.#|#.#',
  L: '#..|#..|#..|#..|###',
  M: '#.#|###|###|#.#|#.#',
  N: '##.|#.#|#.#|#.#|#.#',
  O: '###|#.#|#.#|#.#|###',
  P: '###|#.#|###|#..|#..',
  Q: '###|#.#|#.#|###|..#',
  R: '###|#.#|##.|#.#|#.#',
  S: '###|#..|###|..#|###',
  T: '###|.#.|.#.|.#.|.#.',
  U: '#.#|#.#|#.#|#.#|###',
  V: '#.#|#.#|#.#|#.#|.#.',
  W: '#.#|#.#|###|###|#.#',
  X: '#.#|#.#|.#.|#.#|#.#',
  Y: '#.#|#.#|###|.#.|.#.',
  Z: '###|..#|.#.|#..|###',
  '0': '###|#.#|#.#|#.#|###',
  '1': '.#.|##.|.#.|.#.|###',
  '2': '###|..#|###|#..|###',
  '3': '###|..#|###|..#|###',
  '4': '#.#|#.#|###|..#|..#',
  '5': '###|#..|###|..#|###',
  '6': '###|#..|###|#.#|###',
  '7': '###|..#|..#|..#|..#',
  '8': '###|#.#|###|#.#|###',
  '9': '###|#.#|###|..#|###',
  ' ': '...|...|...|...|...',
  '.': '...|...|...|...|.#.',
  ',': '...|...|...|.#.|#..',
  ':': '...|.#.|...|.#.|...',
  '-': '...|...|###|...|...',
  '+': '...|.#.|###|.#.|...',
  '/': '..#|..#|.#.|#..|#..',
  '!': '.#.|.#.|.#.|...|.#.',
  '?': '###|..#|.#.|...|.#.',
  '(': '..#|.#.|.#.|.#.|..#',
  ')': '#..|.#.|.#.|.#.|#..',
  '[': '###|#..|#..|#..|###',
  ']': '###|..#|..#|..#|###',
  '<': '..#|.#.|#..|.#.|..#',
  '>': '#..|.#.|..#|.#.|#..',
  '=': '...|###|...|###|...',
  '%': '#.#|..#|.#.|#..|#.#',
  '*': '#.#|.#.|#.#|...|...',
  '#': '#.#|###|#.#|###|#.#',
  _: '...|...|...|...|###',
  "'": '.#.|.#.|...|...|...',
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const ADVANCE = 4;
export const LINE_H = 7;

const ORDER = Object.keys(GLYPHS);
const INDEX = new Map(ORDER.map((c, i) => [c, i]));
const atlasCache = new Map<string, HTMLCanvasElement>();

function atlas(color: string): HTMLCanvasElement {
  const cached = atlasCache.get(color);
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = ORDER.length * GLYPH_W;
  cv.height = GLYPH_H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = color;
  ORDER.forEach((ch, i) => {
    const rows = GLYPHS[ch].split('|');
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++)
        if (rows[y][x] === '#') ctx.fillRect(i * GLYPH_W + x, y, 1, 1);
  });
  atlasCache.set(color, cv);
  return cv;
}

export function textWidth(s: string): number {
  return s.length * ADVANCE - 1;
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color = '#a8bcd8',
  shadow: string | null = '#10121d',
): void {
  const up = s.toUpperCase();
  if (shadow) blit(ctx, up, x + 1, y + 1, shadow);
  blit(ctx, up, x, y, color);
}

function blit(ctx: CanvasRenderingContext2D, up: string, x: number, y: number, color: string): void {
  const a = atlas(color);
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of up) {
    const i = INDEX.get(ch);
    if (i !== undefined && ch !== ' ') {
      ctx.drawImage(a, i * GLYPH_W, 0, GLYPH_W, GLYPH_H, cx, cy, GLYPH_W, GLYPH_H);
    }
    cx += ADVANCE;
  }
}

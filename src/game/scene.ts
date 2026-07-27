/**
 * The asset test scene: a ruined riverside courtyard.
 *
 * Every asset category gets a home here — architecture and furniture in the
 * plaza, plants and rocks along the banks, light sources spread across the map
 * so the lighting pass has something to do, and the river cutting through the
 * middle with a bridge over it.
 */
import type { Assets } from '../art/assets';
import type { Clip, Sheet } from '../art/sheet';
import { clip } from '../art/sheet';
import { P } from '../art/palette';
import { RNG } from '../engine/rng';
import type { Light } from './lighting';
import { BRIDGE, PLAZA, WORLD_H, WORLD_W, isWater, riverCenter, riverHalf } from './terrain';
import type { WaterObstacle } from './water';

export type Layer = 'ground' | 'sorted' | 'canopy';

export interface Deco {
  clip: Clip;
  x: number;
  y: number;
  phase: number;
  flip: boolean;
  layer: Layer;
  sortY: number;
  /** Collision radius in px; 0 means walk-through. */
  solid: number;
  /** Label shown in inspect mode. */
  label: string;
}

export interface Solid {
  x: number;
  y: number;
  r: number;
}

export class Scene {
  readonly decos: Deco[] = [];
  readonly lights: Light[] = [];
  readonly solids: Solid[] = [];
  readonly waterObstacles: WaterObstacle[] = [];
  /** The interactable chest, kept around so `E` can swap it to its open clip. */
  chest!: Deco;
  private lightSeed = 0;

  constructor(private a: Assets) {
    this.build();
    this.decos.sort((p, q) => p.sortY - q.sortY);
  }

  private still(sheet: Sheet): Clip {
    return clip(sheet, [0], 1);
  }

  private add(
    c: Clip | Sheet,
    x: number,
    y: number,
    opts: Partial<Pick<Deco, 'layer' | 'solid' | 'flip' | 'sortY' | 'label'>> & { phase?: number } = {},
  ): Deco {
    const cl: Clip = 'sheet' in c ? (c as Clip) : this.still(c as Sheet);
    const d: Deco = {
      clip: cl,
      x: Math.round(x),
      y: Math.round(y),
      phase: opts.phase ?? Math.random() * 4,
      flip: opts.flip ?? false,
      layer: opts.layer ?? 'sorted',
      sortY: opts.sortY ?? y,
      solid: opts.solid ?? 0,
      label: opts.label ?? '',
    };
    this.decos.push(d);
    if (d.solid > 0) this.solids.push({ x: d.x, y: d.y - 2, r: d.solid });
    return d;
  }

  private light(l: Omit<Light, 'seed'> & { seed?: number }): void {
    this.lights.push({ seed: l.seed ?? this.lightSeed++ * 13.7, ...l });
  }

  // -------------------------------------------------------------------------

  private build(): void {
    this.buildPlaza();
    this.buildBridge();
    this.buildRiverBanks();
    this.buildWilds();
  }

  private buildPlaza(): void {
    const p = this.a.props;

    // --- north wall with the arch door in the middle -----------------------
    const wallY = PLAZA.y0;
    for (let x = PLAZA.x0; x <= PLAZA.x1; x += 16) {
      const mid = Math.abs(x - (PLAZA.x0 + PLAZA.x1) / 2) < 26;
      if (mid) continue;
      const ruined = x > PLAZA.x0 + 150 && ((x / 16) | 0) % 3 === 0;
      const sheet = ruined
        ? p.ruinedWalls[Math.floor(x / 16) % p.ruinedWalls.length]
        : p.walls[Math.floor(x / 16) % p.walls.length];
      this.add(sheet, x, wallY, { solid: 9, label: ruined ? 'ruined wall' : 'stone wall' });
    }
    this.add(p.archDoor, (PLAZA.x0 + PLAZA.x1) / 2, wallY + 6, { solid: 0, label: 'arch door' });
    this.add(p.banner, (PLAZA.x0 + PLAZA.x1) / 2 - 38, wallY + 2, { label: 'banner' });
    this.add(p.banner, (PLAZA.x0 + PLAZA.x1) / 2 + 38, wallY + 2, { label: 'banner', phase: 1.3 });

    // --- west wall ---------------------------------------------------------
    for (let y = PLAZA.y0 + 16; y <= PLAZA.y1; y += 26) {
      this.add(p.walls[Math.floor(y / 26) % p.walls.length], PLAZA.x0, y, { solid: 9, label: 'stone wall' });
    }

    // --- corner pillars, each carrying a torch -----------------------------
    const corners: [number, number][] = [
      [PLAZA.x0 + 10, PLAZA.y0 + 24],
      [PLAZA.x1 - 10, PLAZA.y0 + 24],
      [PLAZA.x0 + 10, PLAZA.y1 - 10],
      [PLAZA.x1 - 10, PLAZA.y1 - 10],
    ];
    for (const [x, y] of corners) {
      this.add(p.pillar, x, y, { solid: 8, label: 'pillar' });
      this.add(p.torch, x, y - 30, { sortY: y - 1, label: 'torch' });
      this.light({ x, y: y - 46, radius: 88, color: P.fire, intensity: 1.05, flicker: 0.3 });
    }

    // --- furniture ---------------------------------------------------------
    this.add(p.rug, 226, 214, { layer: 'ground', label: 'rug' });
    this.add(p.table, 226, 210, { solid: 12, label: 'table' });
    this.add(p.chairL, 196, 212, { solid: 5, label: 'chair' });
    this.add(p.chairR, 256, 212, { solid: 5, label: 'chair' });

    this.add(p.bookshelf, 140, 150, { solid: 12, label: 'bookshelf' });
    this.add(p.bed, 128, 232, { solid: 10, label: 'bed' });
    this.add(p.sign, 306, 268, { solid: 4, label: 'sign' });

    this.add(p.barrels[0], 300, 140, { solid: 8, label: 'barrel' });
    this.add(p.barrels[1], 316, 152, { solid: 8, label: 'barrel' });
    this.add(p.crates[0], 286, 156, { solid: 8, label: 'crate' });
    this.add(p.crates[1], 300, 168, { solid: 8, label: 'crate' });

    this.chest = this.add(p.chestClosed, 176, 268, { solid: 8, label: 'chest (E to open)' });
    this.add(p.cauldron, 330, 210, { solid: 9, label: 'cauldron' });
    this.light({ x: 330, y: 196, radius: 46, color: P.magic, intensity: 0.75, pulse: 0.35, pulseSpeed: 2.2 });

    // --- campfire circle ---------------------------------------------------
    this.add(p.campfire, 226, 128, { solid: 9, label: 'campfire' });
    this.light({ x: 226, y: 118, radius: 128, color: P.fire, intensity: 1.25, flicker: 0.26 });
    this.add(this.a.nature.stump, 198, 132, { solid: 7, label: 'stump' });
    this.add(this.a.nature.stump, 254, 134, { solid: 7, flip: true, label: 'stump' });
    this.add(this.a.nature.log, 226, 152, { solid: 9, label: 'log' });

    // --- well + braziers flanking the path ---------------------------------
    this.add(p.well, 300, 236, { solid: 14, label: 'well' });
    for (const [x, y] of [
      [352, 300],
      [404, 296],
    ] as [number, number][]) {
      this.add(p.brazier, x, y, { solid: 7, label: 'brazier' });
      this.light({ x, y: y - 24, radius: 96, color: P.fire, intensity: 1.0, flicker: 0.28 });
    }

    // --- items scattered around --------------------------------------------
    this.add(p.potions[0], 200, 190, { label: 'potion' });
    this.add(p.potions[1], 208, 196, { label: 'potion' });
    this.add(p.potions[2], 246, 192, { label: 'potion' });
    this.add(p.coin, 250, 250, { label: 'coin' });
    this.add(p.coin, 262, 258, { label: 'coin', phase: 0.4 });
    this.add(p.coin, 240, 262, { label: 'coin', phase: 0.8 });
    this.add(p.key, 168, 200, { label: 'key' });
    this.add(p.gems[0], 148, 288, { label: 'gem' });
    this.add(p.gems[1], 288, 128, { label: 'gem' });
    this.add(p.ammo, 190, 250, { label: 'ammo' });
    this.add(p.heart, 214, 286, { label: 'heart' });
    this.add(p.scroll, 260, 178, { label: 'scroll' });
    this.light({ x: 148, y: 284, radius: 34, color: P.magic, intensity: 0.6, pulse: 0.5, pulseSpeed: 3 });

    // --- fences along the plaza's south edge -------------------------------
    for (let x = PLAZA.x0 + 24; x < PLAZA.x1 - 40; x += 16) {
      if (x > 240 && x < 300) continue; // gateway
      this.add(p.fence, x, PLAZA.y1 + 4, { solid: 6, label: 'fence' });
    }
  }

  private buildBridge(): void {
    const p = this.a.props;
    const rng = new RNG(555);
    const y0 = BRIDGE.y0;
    const y1 = BRIDGE.y1;
    for (let y = y0; y < y1; y += 16) {
      for (let x = BRIDGE.x0; x < BRIDGE.x1; x += 16) {
        this.add(p.bridgeTiles[rng.int(0, p.bridgeTiles.length - 1)], x + 8, y + 16, {
          layer: 'ground',
          label: 'bridge deck',
        });
      }
    }
    // Rails: the far one sorts behind the player, the near one in front.
    for (let x = BRIDGE.x0; x < BRIDGE.x1; x += 16) {
      this.add(p.bridgeRail, x + 8, y0 + 3, { sortY: y0 - 6, label: 'bridge rail' });
      this.add(p.bridgeRail, x + 8, y1 + 6, { sortY: y1 + 6, label: 'bridge rail' });
    }
    // Lanterns on the bridge heads.
    for (const x of [BRIDGE.x0 + 4, BRIDGE.x1 - 4]) {
      this.add(p.torch, x, y1 + 8, { sortY: y1 + 7, label: 'torch' });
      this.light({ x, y: y1 - 16, radius: 84, color: P.fire, intensity: 1.0, flicker: 0.3 });
    }
  }

  private buildRiverBanks(): void {
    const n = this.a.nature;
    const rng = new RNG(2024);

    // Reeds and lily pads hugging the water line.
    for (let y = 20; y < WORLD_H - 20; y += 9) {
      const c = riverCenter(y);
      const h = riverHalf(y);
      for (const side of [-1, 1] as const) {
        if (!rng.chance(0.55)) continue;
        const x = c + side * (h + rng.range(2, 10));
        if (Math.abs(y - BRIDGE.cy) < 30) continue;
        this.add(n.reeds[rng.int(0, 1)], x, y, { flip: side > 0, label: 'reed', phase: rng.range(0, 4) });
      }
      if (rng.chance(0.16) && Math.abs(y - BRIDGE.cy) > 34) {
        const x = c + rng.range(-h * 0.6, h * 0.6);
        this.add(n.lily, x, y, { layer: 'ground', label: 'lily pad', phase: rng.range(0, 4) });
      }
    }

    // Rocks standing in the current — these carve foam and wakes in the water.
    for (const y of [110, 180, 246, 380, 452, 540]) {
      const c = riverCenter(y);
      const h = riverHalf(y);
      const x = c + rng.range(-h * 0.5, h * 0.5);
      const idx = rng.int(0, 2);
      this.add(n.rocks[idx], x, y, { solid: 8, label: 'river rock' });
      this.waterObstacles.push({ x, y: y - 4, r: idx === 2 ? 12 : 8 });
    }

    // Glowing mushrooms + a crystal cluster on the east bank.
    this.add(n.crystal, 700, 402, { solid: 8, label: 'crystal' });
    this.light({ x: 700, y: 388, radius: 92, color: P.magic, intensity: 1.0, pulse: 0.45, pulseSpeed: 1.6 });
    for (const [x, y] of [
      [676, 420],
      [722, 416],
      [712, 434],
    ] as [number, number][]) {
      this.add(n.mushrooms[1], x, y, { label: 'glowing mushroom' });
      this.light({ x, y: y - 6, radius: 34, color: P.magic, intensity: 0.55, pulse: 0.5, pulseSpeed: 2.4 });
    }
  }

  private buildWilds(): void {
    const n = this.a.nature;
    const rng = new RNG(90210);

    const free = (x: number, y: number, margin: number): boolean => {
      if (x < 24 || y < 24 || x > WORLD_W - 24 || y > WORLD_H - 24) return false;
      if (x > PLAZA.x0 - 20 && x < PLAZA.x1 + 20 && y > PLAZA.y0 - 20 && y < PLAZA.y1 + 20) return false;
      if (y > BRIDGE.y0 - 30 && y < BRIDGE.y1 + 30 && x > BRIDGE.x0 - 20 && x < BRIDGE.x1 + 20) return false;
      for (let dy = -margin; dy <= margin; dy += margin) {
        for (let dx = -margin; dx <= margin; dx += margin) {
          if (isWater(x + dx, y + dy)) return false;
        }
      }
      for (const s of this.solids) if (Math.hypot(s.x - x, s.y - y) < s.r + margin) return false;
      return true;
    };

    const place = (count: number, margin: number, fn: (x: number, y: number) => void): void => {
      let tries = 0;
      let made = 0;
      while (made < count && tries < count * 60) {
        tries++;
        const x = rng.range(20, WORLD_W - 20);
        const y = rng.range(20, WORLD_H - 20);
        if (!free(x, y, margin)) continue;
        fn(x, y);
        made++;
      }
    };

    // Trees: the big silhouettes go first so smaller things fill the gaps.
    place(26, 20, (x, y) => {
      const roll = rng.next();
      const c = roll < 0.6 ? n.trees[rng.int(0, 1)] : roll < 0.85 ? n.pine : n.deadTree;
      this.add(c, x, y, { solid: 7, flip: rng.chance(0.5), label: 'tree', phase: rng.range(0, 4) });
    });

    place(16, 14, (x, y) => {
      this.add(n.bushes[rng.int(0, 1)], x, y, { solid: 7, flip: rng.chance(0.5), label: 'bush', phase: rng.range(0, 4) });
    });

    place(14, 12, (x, y) => {
      const i = rng.int(0, n.rocks.length - 1);
      this.add(n.rocks[i], x, y, { solid: i === 2 ? 12 : 7, flip: rng.chance(0.5), label: 'rock' });
    });

    place(170, 4, (x, y) => {
      this.add(n.grass[rng.int(0, 2)], x, y, {
        layer: 'ground',
        flip: rng.chance(0.5),
        label: 'grass',
        phase: rng.range(0, 4),
      });
    });

    place(34, 5, (x, y) => {
      this.add(n.flowers[rng.int(0, 2)], x, y, { flip: rng.chance(0.5), label: 'flower', phase: rng.range(0, 4) });
    });

    place(12, 6, (x, y) => {
      this.add(n.mushrooms[0], x, y, { label: 'mushroom' });
    });

    place(3, 12, (x, y) => this.add(n.log, x, y, { solid: 10, flip: rng.chance(0.5), label: 'log' }));
    place(3, 10, (x, y) => this.add(n.stump, x, y, { solid: 8, label: 'stump' }));
  }
}

/** One bake pass for the entire asset set, plus a flat registry for the gallery. */
import { bakeCharacter, bakeGun, bakeMuzzleFlash, HERO_SKIN, ROGUE_SKIN, type CharacterAnims } from './character';
import { bakeSlime, type SlimeAnims } from './creatures';
import { bakeNature, type NatureAssets } from './nature';
import { bakeProps, type PropAssets } from './props';
import { P } from './palette';
import type { Clip, Sheet } from './sheet';
import { clip } from './sheet';

export interface Assets {
  hero: CharacterAnims;
  rogue: CharacterAnims;
  gun: Sheet;
  muzzle: Sheet;
  slime: SlimeAnims;
  nature: NatureAssets;
  props: PropAssets;
  /** name -> clip, used by the asset gallery screen. */
  gallery: GalleryGroup[];
}

export interface GalleryEntry {
  name: string;
  clip: Clip;
}

export interface GalleryGroup {
  title: string;
  entries: GalleryEntry[];
}

const DIR_NAME = ['down', 'side', 'up'];

function fromSheet(name: string, sheet: Sheet, fps = 8): GalleryEntry {
  return {
    name,
    clip: clip(
      sheet,
      Array.from({ length: sheet.count }, (_, i) => i),
      fps,
    ),
  };
}

export function bakeAll(): Assets {
  const hero = bakeCharacter(HERO_SKIN);
  const rogue = bakeCharacter(ROGUE_SKIN);
  const gun = bakeGun();
  const muzzle = bakeMuzzleFlash();
  const slime = bakeSlime(P.leafLight);
  const nature = bakeNature();
  const props = bakeProps();

  const charEntries: GalleryEntry[] = [];
  for (const s of hero.sheets) {
    const fps = s.name === 'idle' ? 6 : s.name === 'walk' ? 12 : s.name === 'run' ? 16 : s.name === 'attack' ? 14 : 10;
    charEntries.push(fromSheet(`hero ${s.name} ${DIR_NAME[s.dir]}`, s.sheet, fps));
  }
  const rogueEntries: GalleryEntry[] = rogue.sheets
    .filter((s) => s.dir === 0 || s.name === 'walk')
    .map((s) => fromSheet(`rogue ${s.name} ${DIR_NAME[s.dir]}`, s.sheet, s.name === 'idle' ? 6 : 12));

  const gallery: GalleryGroup[] = [
    { title: 'character - hero', entries: charEntries },
    {
      title: 'character - rogue / creature',
      entries: [
        ...rogueEntries,
        { name: 'slime idle', clip: slime.idle },
        { name: 'slime move', clip: slime.move },
        { name: 'slime attack', clip: slime.attack },
        { name: 'slime death', clip: slime.death },
      ],
    },
    {
      title: 'weapon + fx',
      entries: [fromSheet('gun', gun, 4), fromSheet('muzzle flash', muzzle, 14)],
    },
    {
      title: 'plants',
      entries: [
        ...nature.grass.map((c, i) => ({ name: `grass ${i + 1}`, clip: c })),
        ...nature.bushes.map((c, i) => ({ name: `bush ${i + 1}`, clip: c })),
        ...nature.flowers.map((c, i) => ({ name: `flower ${i + 1}`, clip: c })),
        ...nature.reeds.map((c, i) => ({ name: `reed ${i + 1}`, clip: c })),
        { name: 'lily pad', clip: nature.lily },
        ...nature.mushrooms.map((s, i) => fromSheet(`mushroom ${i + 1}`, s)),
      ],
    },
    {
      title: 'trees + rocks',
      entries: [
        ...nature.trees.map((c, i) => ({ name: `oak ${i + 1}`, clip: c })),
        { name: 'pine', clip: nature.pine },
        { name: 'dead tree', clip: nature.deadTree },
        ...nature.rocks.map((s, i) => fromSheet(`rock ${i + 1}`, s)),
        { name: 'crystal', clip: nature.crystal },
        fromSheet('stump', nature.stump),
        fromSheet('log', nature.log),
      ],
    },
    {
      title: 'furniture',
      entries: [
        fromSheet('table', props.table),
        fromSheet('chair l', props.chairL),
        fromSheet('chair r', props.chairR),
        ...props.barrels.map((s, i) => fromSheet(`barrel ${i + 1}`, s)),
        ...props.crates.map((s, i) => fromSheet(`crate ${i + 1}`, s)),
        fromSheet('bookshelf', props.bookshelf),
        fromSheet('rug', props.rug),
        fromSheet('bed', props.bed),
        fromSheet('sign', props.sign),
        fromSheet('chest closed', props.chestClosed),
        { name: 'chest open', clip: props.chestOpen },
        { name: 'cauldron', clip: props.cauldron },
      ],
    },
    {
      title: 'building',
      entries: [
        ...props.walls.map((s, i) => fromSheet(`wall ${i + 1}`, s)),
        ...props.ruinedWalls.map((s, i) => fromSheet(`ruin ${i + 1}`, s)),
        fromSheet('pillar', props.pillar),
        fromSheet('arch door', props.archDoor),
        fromSheet('fence', props.fence),
        fromSheet('well', props.well),
        ...props.bridgeTiles.map((s, i) => fromSheet(`bridge ${i + 1}`, s)),
        fromSheet('bridge rail', props.bridgeRail),
        { name: 'banner', clip: props.banner },
      ],
    },
    {
      title: 'light sources',
      entries: [
        { name: 'torch', clip: props.torch },
        { name: 'campfire', clip: props.campfire },
        { name: 'brazier', clip: props.brazier },
      ],
    },
    {
      title: 'items',
      entries: [
        ...props.potions.map((c, i) => ({ name: `potion ${i + 1}`, clip: c })),
        { name: 'coin', clip: props.coin },
        { name: 'key', clip: props.key },
        ...props.gems.map((c, i) => ({ name: `gem ${i + 1}`, clip: c })),
        fromSheet('ammo', props.ammo),
        { name: 'heart', clip: props.heart },
        fromSheet('scroll', props.scroll),
      ],
    },
  ];

  return { hero, rogue, gun, muzzle, slime, nature, props, gallery };
}

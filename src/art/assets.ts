/** One bake pass for the entire asset set, plus a flat registry for the gallery. */
import { bakeAnimals, type AnimalAssets } from './animals';
import { bakeBuildings, type BuildingAssets } from './buildings';
import { bakeCharacter, bakeNpc, bakeGun, bakeMuzzleFlash, HERO_SKIN, NPC_SKINS, ROGUE_SKIN, type CharacterAnims } from './character';
import { bakeSlime, type SlimeAnims } from './creatures';
import { bakeEmotes, type EmoteAssets } from './emote';
import { bakeFarm, type FarmAssets } from './farm';
import { bakeInteriors, type InteriorAssets } from './interiors';
import { bakeNature, type NatureAssets } from './nature';
import { bakeProps, type PropAssets } from './props';
import { P } from './palette';
import type { Clip, Sheet } from './sheet';
import { bakeSheet, clip } from './sheet';

export interface Assets {
  hero: CharacterAnims;
  rogue: CharacterAnims;
  gun: Sheet;
  muzzle: Sheet;
  slime: SlimeAnims;
  nature: NatureAssets;
  props: PropAssets;
  buildings: BuildingAssets;
  animals: AnimalAssets;
  /** One idle/walk/work set per townsfolk skin. */
  npcs: CharacterAnims[];
  emotes: EmoteAssets;
  interiors: InteriorAssets;
  farm: FarmAssets;
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
  const buildings = bakeBuildings();
  const animals = bakeAnimals();
  const npcs = NPC_SKINS.map((s) => bakeNpc(s));
  const emotes = bakeEmotes();
  const interiors = bakeInteriors();
  const farm = bakeFarm();

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
      title: 'buildings',
      entries: [
        ...buildings.cottages.map((b, i) => fromSheet(`cottage ${i + 1}`, bakeSheet([b.buffer], b.ax, b.ay))),
        fromSheet('tavern', bakeSheet([buildings.tavern.buffer], buildings.tavern.ax, buildings.tavern.ay)),
        fromSheet('inn', bakeSheet([buildings.inn.buffer], buildings.inn.ax, buildings.inn.ay)),
        fromSheet('smithy', bakeSheet([buildings.smithy.buffer], buildings.smithy.ax, buildings.smithy.ay)),
        fromSheet('shop', bakeSheet([buildings.shop.buffer], buildings.shop.ax, buildings.shop.ay)),
        fromSheet('chapel', bakeSheet([buildings.chapel.buffer], buildings.chapel.ax, buildings.chapel.ay)),
        fromSheet('mill', bakeSheet([buildings.mill.buffer], buildings.mill.ax, buildings.mill.ay)),
        fromSheet('barn', bakeSheet([buildings.barn.buffer], buildings.barn.ax, buildings.barn.ay)),
        { name: 'water wheel', clip: buildings.waterWheel },
      ],
    },
    {
      title: 'town dressing',
      entries: [
        ...Object.entries(buildings.signs).map(([k, sh]) => fromSheet(`sign ${k}`, sh)),
        ...buildings.stalls.map((s, i) => fromSheet(`stall ${i + 1}`, s)),
        fromSheet('cart', buildings.cart),
        { name: 'lamppost', clip: buildings.lamppost },
        ...buildings.haystacks.map((s, i) => fromSheet(`haystack ${i + 1}`, s)),
        fromSheet('scarecrow', buildings.scarecrow),
        ...buildings.wheat.map((s, i) => fromSheet(`wheat ${i + 1}`, s)),
        ...buildings.cabbage.map((s, i) => fromSheet(`cabbage ${i + 1}`, s)),
      ],
    },
    {
      title: 'animals',
      entries: [
        { name: 'cow idle', clip: animals.cow.idle },
        { name: 'cow walk', clip: animals.cow.walk },
        { name: 'cow graze', clip: animals.cow.graze },
        { name: 'pig walk', clip: animals.pig.walk },
        { name: 'sheep walk', clip: animals.sheep.walk },
        { name: 'sheep graze', clip: animals.sheep.graze },
        { name: 'goat walk', clip: animals.goat.walk },
        { name: 'chicken idle', clip: animals.chicken.idle },
        { name: 'chicken walk', clip: animals.chicken.walk },
        { name: 'chicken peck', clip: animals.chicken.graze },
        { name: 'duck idle', clip: animals.duck.idle },
      ],
    },
    {
      title: 'townsfolk',
      entries: npcs.flatMap((n, i) => [
        { name: `npc ${i + 1} idle`, clip: n.idle[0] },
        { name: `npc ${i + 1} walk`, clip: n.walk[1] },
      ]),
    },
    {
      title: 'farming',
      entries: [
        fromSheet('soil dry', farm.soilDry),
        fromSheet('soil wet', farm.soilWet),
        ...(['turnip', 'pumpkin', 'wheat'] as const).flatMap((k) =>
          farm.crops[k].map((sh, i) => fromSheet(`${k} ${i}`, sh)),
        ),
        ...Object.entries(farm.tools).map(([k, sh]) => fromSheet(k, sh)),
      ],
    },
    {
      title: 'interiors',
      entries: [
        fromSheet('shop counter', interiors.counterShop),
        fromSheet('bar', interiors.counterBar),
        ...interiors.shelves.map((sh, i) => fromSheet(`shelves ${i + 1}`, sh)),
        { name: 'fireplace', clip: interiors.fireplace },
        { name: 'anvil', clip: interiors.anvil },
        { name: 'wall lamp', clip: interiors.wallLamp },
        fromSheet('stool', interiors.stool),
        fromSheet('keg', interiors.keg),
        ...interiors.paintings.map((sh, i) => fromSheet(`painting ${i + 1}`, sh)),
        fromSheet('pot plant', interiors.plant),
        fromSheet('sacks', interiors.sacks),
        fromSheet('stairs', interiors.stairs),
        fromSheet('inner door', interiors.innerDoor),
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

  return { hero, rogue, gun, muzzle, slime, nature, props, buildings, animals, npcs, emotes, interiors, farm, gallery };
}

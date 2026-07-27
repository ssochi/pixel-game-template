/**
 * One shared palette for the whole asset set. Assets never invent colours —
 * they pick from here, which is what makes procedurally-baked sprites still
 * look like they belong to the same game.
 */
import { hex, type RGBA } from './pixel';

export const P = {
  // Ink / outlines
  ink: hex('#10121d'),
  inkSoft: hex('#1c2033'),
  shadow: hex('#0b0c14'),

  // Skin
  skin: hex('#e8b58a'),
  skinMid: hex('#c98d63'),
  skinDark: hex('#9c6242'),

  // Hair
  hair: hex('#6b4630'),
  hairDark: hex('#432a1d'),
  hairLight: hex('#8f6244'),

  // Hero coat (teal) + accents
  coat: hex('#2f6d7a'),
  coatLight: hex('#3f8f9c'),
  coatDark: hex('#1e454f'),
  scarf: hex('#c4453c'),
  scarfDark: hex('#8a2b28'),
  pants: hex('#3a3f57'),
  pantsDark: hex('#262a3c'),
  boot: hex('#5a3b2a'),
  bootDark: hex('#3a2519'),

  // Metals
  steel: hex('#9aa7bd'),
  steelDark: hex('#5b6880'),
  steelLight: hex('#cdd7e6'),
  gold: hex('#f0c261'),
  goldDark: hex('#a97c2c'),
  copper: hex('#c07a45'),

  // Wood
  wood: hex('#7a4f30'),
  woodLight: hex('#9c6a41'),
  woodDark: hex('#4e3220'),
  woodPale: hex('#b98d5c'),

  // Stone
  stone: hex('#6a6f80'),
  stoneLight: hex('#8b91a3'),
  stoneDark: hex('#454a5a'),
  stoneDeep: hex('#2e3240'),
  moss: hex('#4d6b3a'),

  // Ground
  dirt: hex('#5c452f'),
  dirtDark: hex('#3f2e20'),
  sand: hex('#b9986a'),
  sandDark: hex('#8e7148'),

  // Foliage
  leaf: hex('#4a8b3a'),
  leafLight: hex('#6fb04b'),
  leafDark: hex('#2f5f2a'),
  leafDeep: hex('#1e401f'),
  flowerA: hex('#e46a8b'),
  flowerB: hex('#f2d45c'),
  flowerC: hex('#8f6fd6'),

  // Water
  water: hex('#2a6f9e'),
  waterDeep: hex('#164a72'),
  waterLight: hex('#4fa3c9'),
  waterFoam: hex('#cfeaf5'),

  // Light / fx
  fire: hex('#ff9a3c'),
  fireHot: hex('#ffe08a'),
  fireDeep: hex('#d1462a'),
  magic: hex('#79e6ff'),
  magicDeep: hex('#2f7fd6'),
  blood: hex('#8e1f28'),
  bloodDark: hex('#5a1119'),
  white: hex('#ffffff'),
  ui: hex('#a8bcd8'),
  uiDim: hex('#5c6a85'),
} satisfies Record<string, RGBA>;

export type PaletteKey = keyof typeof P;

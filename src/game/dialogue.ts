/**
 * What the townsfolk say.
 *
 * Lines are keyed by the role the scene gave each villager, so a farmer talks
 * about the weather and the smith about iron. Each role has a small pool and
 * one is picked at random per conversation, which is enough to stop the town
 * feeling like a set of vending machines while the real dialogue system is
 * still to come.
 */

const LINES: Record<string, string[][]> = {
  merchant: [
    ['FRESH IN THIS MORNING.', 'TAKE A LOOK BEFORE IT GOES.'],
    ['THE ROAD FROM THE COAST', 'WAS BAD AGAIN. PRICES ARE UP.'],
    ['TURNIPS SELL WELL AT MARKET.', 'PLANT EARLY, HARVEST OFTEN.'],
  ],
  farmer: [
    ['SOIL IS GOOD DOWN BY THE RIVER.', 'TILL IT BEFORE YOU SOW.'],
    ['RAIN WOULD SAVE ME A DAY', 'OF HAULING WATER.'],
    ['A CROP WANTS WATER EVERY DAY.', 'FORGET ONE AND IT SULKS.'],
  ],
  miller: [
    ['THE WHEEL HAS RUN SINCE', 'MY GRANDFATHER SET IT.'],
    ['BRING ME WHEAT AND I WILL', 'GRIND IT BEFORE SUPPER.'],
  ],
  fisher: [
    ['THE BIG ONES SIT UNDER', 'THE BRIDGE AT DUSK.'],
    ['QUIET NOW. YOU WILL', 'SCARE THEM OFF.'],
  ],
  herder: [
    ['THE BROWN COW GOT OUT AGAIN.', 'MIND THE GATE.'],
    ['SHEEP ARE SIMPLE COMPANY.', 'I PREFER IT.'],
  ],
  smith: [
    ['IRON FROM THE HILLS IS', 'BETTER THAN ANYTHING SHIPPED IN.'],
    ['BRING ME STONE AND ORE.', 'I WILL SEE WHAT I CAN DO.'],
  ],
  innkeeper: [
    ['A BED AND A HOT MEAL,', 'THAT IS ALL ANYONE NEEDS.'],
    ['STAY OUT OF THE WOODS', 'AFTER DARK. THINGS MOVE THERE.'],
  ],
  shopkeeper: [
    ['SEEDS, TOOLS, ROPE.', 'IF I HAVE NOT GOT IT, NOBODY HAS.'],
    ['SELL ME YOUR HARVEST AND', 'I WILL SEE YOU RIGHT.'],
  ],
  drinker: [
    ['ONE MORE AND I AM HOME.', 'I SAID THAT AN HOUR AGO.'],
    ['THE MILLER TELLS THE SAME', 'STORY EVERY WEEK.'],
  ],
  priest: [
    ['THE CHAPEL IS OPEN', 'TO ANYONE WHO WALKS IN.'],
    ['WE KEEP THE OLD FEAST DAYS.', 'YOU WILL HEAR THE BELL.'],
  ],
  customer: [['THEIR PRICES ARE FAIR.', 'MOSTLY.']],
  townsfolk: [
    ['NEW FACE. WELCOME.', 'THE VALLEY IS QUIET, MOSTLY.'],
    ['THE MARKET IS BUSIEST', 'AROUND MIDDAY.'],
    ['MY GRANDMOTHER SAYS THE', 'RIVER USED TO RUN HIGHER.'],
  ],
  walker: [
    ['LOVELY DAY FOR IT.'],
    ['MIND THE CART ON THE HIGH STREET.'],
    ['I HEAR SOMEONE TOOK OVER', 'THE OLD FARM PLOT.'],
  ],
};

const FALLBACK = [['...'], ['GOOD DAY TO YOU.']];

export function linesFor(role: string): string[] {
  const pool = LINES[role] ?? FALLBACK;
  return pool[Math.floor(Math.random() * pool.length)];
}

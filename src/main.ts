/**
 * Pixel Asset Lab — a top-down asset test scene.
 *
 * Boot order: bake every sprite procedurally -> bake the ground bitmap ->
 * build the scene -> run the loop. Nothing is loaded from disk; the whole art
 * set is generated in `src/art` at startup.
 */
import { bakeAll } from './art/assets';
import { P } from './art/palette';
import { drawClip, drawFrame } from './art/sheet';
import { Input } from './engine/input';
import { Camera, GAME_H, GAME_W, Screen } from './engine/screen';
import { Slime } from './game/agents';
import { linesFor } from './game/dialogue';
import { CAST, Social, activeQuest, questProgress, workArea } from './game/social';
import { Critter, Duck, Villager, gossip } from './game/npc';
import { Lighting, type Light } from './game/lighting';
import { Particles } from './game/particles';
import { Player } from './game/player';
import { Farm, CROPS, FARM, Soil } from './game/farm';
import { Fishing } from './game/fishing';
import { TILE } from './art/farm';
import { Inventory, ITEMS, SHOP_STOCK } from './game/inventory';
import { RoomBuilder, type Room } from './game/interior';
import { Scene } from './game/scene';
import { BRIDGE, MILL, WORLD_H, WORLD_W, bakeGround } from './game/terrain';
import { Gallery, drawCatch, drawDayCard, drawDialogue, drawHotbar, drawHud, drawReel, drawShop } from './game/ui';
import { River } from './game/water';

const boot = document.getElementById('boot') as HTMLDivElement;
const screen = new Screen(document.getElementById('screen') as HTMLCanvasElement);
const ctx = screen.ctx;

function start(): void {
  const assets = bakeAll();
  const ground = bakeGround();
  const scene = new Scene(assets);
  const river = new River();
  river.obstacles.push(...scene.waterObstacles);

  const lighting = new Lighting(GAME_W, GAME_H);
  const camera = new Camera();
  const fx = new Particles();
  const player = new Player(assets);
  const gallery = new Gallery(assets.gallery);
  const input = new Input(screen.canvas, (x, y) => screen.toInternal(x, y));

  // Start at the gate of the player's own plot.
  player.x = 690;
  player.y = 650;
  camera.follow(player.x, player.y, WORLD_W, WORLD_H, 1, true);

  // Slimes only live in the woods across the river, away from the town.
  const slimes = [
    new Slime(assets, 1280, 200),
    new Slime(assets, 1330, 760),
    new Slime(assets, 1250, 880),
  ];

  // Background extras: unnamed, just there to fill the streets.
  const villagers = scene.villagerSpawns.map((sp, i) => {
    const anims = assets.npcs[i % assets.npcs.length];
    return new Villager(anims, sp.x, sp.y, sp.home, 1000 + i * 37, sp.kind, sp.stationary, sp.schedule);
  });

  /** Workplaces that are rooms you walk into rather than spots on the map. */
  const INDOOR_WORK = new Set<(typeof CAST)[number]['work']>(['shop', 'tavern', 'forge', 'mill']);

  // The named cast: each one posted to their own workplace with a full day.
  const social = new Social();
  const castOf = new Map<string, (typeof CAST)[number]>();
  CAST.forEach((def, i) => {
    const area = workArea(def.work, scene.areas);
    const home = scene.homes[i % Math.max(1, scene.homes.length)] ?? area;
    const square = scene.areas.square ?? area;
    const v = new Villager(
      assets.npcs[def.skin % assets.npcs.length],
      (area.x0 + area.x1) / 2,
      (area.y0 + area.y1) / 2,
      area,
      7000 + i * 101,
      def.name,
      false,
      [
        { from: 0, area: home, activity: 'sleep' },
        { from: 0.26 + i * 0.005, area, activity: def.activity },
        { from: 0.74 + i * 0.004, area: square, activity: 'socialise' },
        { from: 0.86 + i * 0.004, area: home, activity: 'sleep' },
      ],
    );
    v.castId = def.id;
    castOf.set(def.id, def);
    villagers.push(v);
  });

  const animalOf = (kind: string) =>
    kind === 'cow'
      ? assets.animals.cow
      : kind === 'pig'
        ? assets.animals.pig
        : kind === 'sheep'
          ? assets.animals.sheep
          : kind === 'goat'
            ? assets.animals.goat
            : assets.animals.chicken;
  const animals = scene.animalSpawns.map(
    (sp, i) => new Critter(animalOf(sp.kind), sp.x, sp.y, sp.home, 5000 + i * 53, sp.kind === 'chicken' ? 22 : 14),
  );
  const ducks = scene.duckSpawns.map(
    (sp, i) => new Duck(assets.animals.duck, sp.x, sp.y, sp.home, 9000 + i * 71, 9),
  );

  // --- farming, inventory, day -----------------------------------------------
  const farm = new Farm();
  const inv = new Inventory();
  let day = 1;
  let energy = 1;
  /** Non-null while a dialogue box is open. */
  let talk: { speaker: string; lines: string[] } | null = null;
  /** 0..1 sleep transition; when it peaks the day rolls over. */
  let sleepT = 0;
  let sleeping = false;
  let useCd = 0;
  /** Index into SHOP_STOCK while the shop menu is open. */
  let shopOpen = false;
  let shopIndex = 0;
  const fishing = new Fishing();

  function useTool(): void {
    const held = inv.held;
    if (!held || energy <= 0) return;
    if (held.use === 'fish') {
      // The rod owns the action button entirely: cast, then strike, then reel.
      // `update` handles the reel, so all this has to do is start things.
      if (fishing.state === 'idle') {
        if (!fishing.cast(player.x, player.y - 4, player.aim)) {
          talk = { speaker: 'YOU', lines: ['NO WATER WITHIN REACH.', 'GET CLOSER TO THE RIVER.'] };
        } else {
          player.swing();
          energy = Math.max(0, energy - 0.006);
        }
      }
      return;
    }
    // Act on the tile in front of the player.
    const reach = 14;
    const fx2 = player.x + Math.cos(player.aim) * reach;
    const fy2 = player.y - 4 + Math.sin(player.aim) * reach;
    const i = farm.indexAt(fx2, fy2);
    let did = false;
    if (i >= 0) {
      const t = farm.tiles[i];
      switch (held.use) {
        case 'till':
          did = farm.till(i);
          if (did) fx.dust(fx2, fy2 + 6, 0, -1);
          break;
        case 'water':
          did = farm.water(i);
          if (did) fx.splash(fx2, fy2 + 4, 0.3);
          break;
        case 'plant':
          if (held.crop && farm.plant(i, held.crop)) {
            inv.consumeSelected();
            did = true;
          }
          break;
        case 'cut': {
          // Peek before harvesting: `harvest` clears the tile, so taking the
          // crop with a full bag would destroy it outright.
          if (t.crop && t.stage >= 3 && !inv.add(CROPS[t.crop].yieldItem, 1)) {
            talk = { speaker: 'YOU', lines: ['NO ROOM FOR THE HARVEST.', 'SHIP SOMETHING FIRST.'] };
            break;
          }
          const got = farm.harvest(i);
          if (got) {
            fx.sparks(fx2, fy2, -Math.PI / 2, 6);
            did = true;
          } else if (t.crop) {
            // Cutting an immature crop just destroys it.
            t.crop = null;
            t.stage = 0;
            did = true;
          } else {
            did = farm.clear(i);
          }
          break;
        }
        default:
          break;
      }
    }
    // Chopping and mining work anywhere: they harvest scenery.
    if (!did && (held.use === 'chop' || held.use === 'mine')) {
      const want = held.use === 'chop' ? 'tree' : 'rock';
      for (const d of scene.decos) {
        if (d.solid <= 0) continue;
        if (Math.hypot(d.x - fx2, d.y - fy2) > 16) continue;
        const isTree = d.solid === 7 && d.clip.sheet.fh > 40;
        if ((want === 'tree') === isTree) {
          inv.add(want === 'tree' ? 'wood' : 'stone', 1);
          fx.sparks(d.x, d.y - 8, -Math.PI / 2, 5);
          did = true;
          break;
        }
      }
    }
    player.swing();
    if (did) energy = Math.max(0, energy - 0.012);
  }

  /** E: talk to whoever is closest, open the chest, or go to bed. */
  function interact(): void {
    if (talk) {
      talk = null;
      return;
    }
    const crowd = room ? roomVillagers : villagers;
    let best: Villager | null = null;
    // Wide enough to reach over a shop counter: the counter's own collision
    // radius holds you ~34px off the keeper standing behind it, so anything
    // tighter makes shopkeepers literally unreachable. Nearest still wins.
    let bestD = 44;
    for (const v of crowd) {
      if (v.indoors) continue;
      const d = Math.hypot(v.x - player.x, v.y - player.y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (best) {
      const def = best.castId ? castOf.get(best.castId) : undefined;
      if (def) {
        // Mara behind her own counter is a shop, not a person to hand turnips
        // to — this has to come before the gift check or you can never buy
        // anything while carrying produce.
        if (def.id === 'mara' && room?.kind === 'shop') {
          shopOpen = true;
          shopIndex = 0;
          return;
        }
        // Holding something they might want? Offer it as a gift.
        const held = inv.slots[inv.selected];
        const heldDef = held.item ? ITEMS[held.item] : null;
        if (heldDef && !heldDef.tool && heldDef.use !== 'plant') {
          const res = social.gift(def, held.item!, day);
          if (res.accepted) inv.consumeSelected();
          talk = { speaker: `${def.name}  ${hearts(def.id)}`, lines: res.lines };
          best.showEmote(res.accepted ? 'note' : 'talk', 2.5);
          return;
        }
        const res = social.talk(def, day);
        talk = { speaker: `${def.name} - ${def.job}  ${hearts(def.id)}`, lines: res.lines };
        best.showEmote('talk', 2.5);
        return;
      }
      talk = { speaker: best.name, lines: linesFor(best.name) };
      best.showEmote('talk', 2.5);
      return;
    }

    // The notice board: take the current job, or hand it in.
    if (!room && Math.hypot(scene.board.x - player.x, scene.board.y - player.y) < 26) {
      const q = activeQuest();
      if (!q) {
        talk = { speaker: 'NOTICE BOARD', lines: ['NOTHING POSTED.', 'THE VALLEY IS QUIET.'] };
        return;
      }
      if (!q.taken) {
        q.taken = true;
        talk = { speaker: `BOARD - ${q.title}`, lines: q.brief };
        return;
      }
      const have = Object.entries(q.need).every(([item, n]) => inv.count(item) >= n);
      if (!have) {
        talk = { speaker: `BOARD - ${q.title}`, lines: questProgress(q, (i) => inv.count(i)) };
        return;
      }
      for (const [item, n] of Object.entries(q.need)) {
        let left = n;
        for (const s2 of inv.slots) {
          if (s2.item !== item || left <= 0) continue;
          const take = Math.min(left, s2.count);
          s2.count -= take;
          left -= take;
          if (s2.count <= 0) {
            s2.item = null;
            s2.count = 0;
          }
        }
      }
      q.done = true;
      inv.gold += q.rewardGold;
      social.get(q.rewardFriend).points += 30;
      const next = activeQuest();
      talk = {
        speaker: `BOARD - ${q.title}`,
        lines: [
          `DONE. ${q.rewardGold}G AND THE`,
          `THANKS OF ${q.from}.`,
          next ? 'A NEW NOTICE IS UP.' : 'THE BOARD IS EMPTY NOW.',
        ],
      };
      return;
    }
    if (room && room.bed && Math.hypot(room.bed.x - player.x, room.bed.y - player.y) < 26) {
      sleeping = true;
      return;
    }
    if (!room) {
      // Wild pickings: mushrooms and flowers you can gather by hand.
      for (const f of scene.forage) {
        if (f.gone >= 0) continue;
        if (Math.hypot(f.deco.x - player.x, f.deco.y - player.y) > 20) continue;
        if (!inv.add(f.item, 1)) {
          talk = { speaker: 'YOU', lines: ['MY BAG IS FULL.'] };
          break;
        }
        f.gone = day;
        f.deco.hidden = true; // off the draw lists until it regrows
        fx.sparks(f.deco.x, f.deco.y - 6, -Math.PI / 2, 5);
        return;
      }

      // Shipping bin: sells everything sellable in one go.
      const bin = scene.bin;
      if (Math.hypot(bin.x - player.x, bin.y - player.y) < 26) {
        const earned = inv.sellProduce();
        bin.clip = assets.props.chestOpen;
        bin.phase = -time;
        fx.sparks(bin.x, bin.y - 14, -Math.PI / 2, 10);
        talk = {
          speaker: 'SHIPPING BIN',
          lines: earned > 0 ? [`SOLD FOR ${earned}G.`] : ['NOTHING TO SHIP TODAY.'],
        };
        return;
      }
      const c = scene.chest;
      if (Math.hypot(c.x - player.x, c.y - player.y) < 26) {
        c.clip = assets.props.chestOpen;
        c.phase = -time;
        fx.sparks(c.x, c.y - 14, -Math.PI / 2, 10);
      }
    }
  }

  /** Hearts as a little run of filled/empty pips for the dialogue header. */
  function hearts(id: string): string {
    const n = social.hearts(id);
    return '*'.repeat(n) + '-'.repeat(5 - n);
  }

  function nextDay(): void {
    day += 1;
    farm.newDay();
    energy = 1;
    dayT = 0.26;
    // Foraged plants grow back after a few days.
    for (const f of scene.forage) {
      if (f.gone >= 0 && day - f.gone >= 3) {
        f.gone = -1;
        f.deco.hidden = false;
      }
    }
  }

  // --- debug / display state ------------------------------------------------
  let dayT = 0.79; // start at dusk so the lights read immediately
  let dayPaused = false;
  let showGrid = false;
  let showColliders = false;
  let showHelp = true;
  let fps = 60;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let wheel = 0;

  window.addEventListener(
    'wheel',
    (e) => {
      wheel += e.deltaY * 0.5;
      if (gallery.open) e.preventDefault();
    },
    { passive: false },
  );

  // --- world / interior switching -------------------------------------------
  const rooms = new RoomBuilder(assets);
  let room: Room | null = null;
  /** Where to put the player back down when they step outside again. */
  let returnTo = { x: 0, y: 0 };
  /** 0 = fully in, 1 = fully black. Drives the doorway wipe. */
  let fade = 0;
  let fadeDir = 0;
  let pendingRoom: Room | null = null;
  let pendingExit = false;
  /** Interior NPCs, rebuilt whenever a room is entered. */
  let roomVillagers: Villager[] = [];

  function enterRoom(target: Room, doorX: number, doorY: number): void {
    pendingRoom = target;
    returnTo = { x: doorX, y: doorY + 14 };
    fadeDir = 1;
  }

  function leaveRoom(): void {
    pendingExit = true;
    fadeDir = 1;
  }

  /** Called at the darkest point of the wipe. */
  function applyTransition(): void {
    if (pendingRoom) {
      room = pendingRoom;
      pendingRoom = null;
      player.x = room.spawnX;
      player.y = room.spawnY;
      player.indoors = true;
      player.stop();
      roomVillagers = room.npcs.map((n, i) => {
        const area = { x0: n.x - 10, y0: n.y - 4, x1: n.x + 10, y1: n.y + 4 };
        const def = n.cast ? castOf.get(n.cast) : undefined;
        const v = new Villager(
          assets.npcs[(def ? def.skin : n.skin) % assets.npcs.length],
          n.x,
          n.y,
          area,
          4200 + i * 61,
          def ? def.name : n.role,
          true,
        );
        if (def) v.castId = def.id;
        return v;
      });
      camera.follow(player.x, player.y, room.w, room.h, 1, true);
    } else if (pendingExit) {
      pendingExit = false;
      room = null;
      roomVillagers = [];
      player.x = returnTo.x;
      player.y = returnTo.y;
      player.indoors = false;
      player.stop();
      camera.follow(player.x, player.y, WORLD_W, WORLD_H, 1, true);
    }
    fadeDir = -1;
  }

  const lights: Light[] = [];
  let time = 0;
  let last = performance.now();

  // Dev hook: lets a script (or the console) drop the player anywhere in the
  // world to look at a specific corner of it. Stripped from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as { game: unknown }).game = {
      player,
      camera,
      scene,
      villagers,
      farm,
      inv,
      useTool,
      warp(x: number, y: number) {
        player.x = x;
        player.y = y;
        camera.follow(x, y, WORLD_W, WORLD_H, 1, true);
      },
      setTime(t: number) {
        dayT = t;
        dayPaused = true;
      },
      /** Skip the walk and drop straight into an interior. */
      enter(kind: string, seed = 1) {
        const door = scene.doors.find((d) => d.kind === kind);
        enterRoom(rooms.get(kind as never, seed), door ? door.x + door.w / 2 : player.x, door ? door.y + door.h : player.y);
      },
      leave: leaveRoom,
      fishing,
      state() {
        return {
          room: room?.kind ?? null,
          shopOpen,
          shopIndex,
          gold: inv.gold,
          day,
          fish: fishing.state,
          hooked: fishing.hooked?.id ?? null,
          progress: fishing.progress,
        };
      },
    };
  }

  function update(dt: number): void {
    // The shop menu takes all input while it is open — before the gallery
    // toggle, or Tab would open the gallery on top of it instead of closing it.
    if (shopOpen) {
      if (input.pressed('tab') || input.pressed('escape') || input.pressed('q')) shopOpen = false;
      if (input.pressed('s', 'arrowdown')) shopIndex = (shopIndex + 1) % SHOP_STOCK.length;
      if (input.pressed('w', 'arrowup')) shopIndex = (shopIndex + SHOP_STOCK.length - 1) % SHOP_STOCK.length;
      if (input.pressed('e', 'enter')) {
        const pick = SHOP_STOCK[shopIndex];
        if (inv.buy(pick.item, pick.price, 1)) fx.sparks(player.x, player.y - 14, -Math.PI / 2, 4);
      }
      player.stop();
      wheel = 0;
      return;
    }

    if (input.pressed('tab')) gallery.open = !gallery.open;
    if (gallery.open) {
      const kb = (input.isDown('s', 'arrowdown') ? 1 : 0) - (input.isDown('w', 'arrowup') ? 1 : 0);
      gallery.update(dt, wheel + kb * 260 * dt);
      wheel = 0;
      return;
    }
    wheel = 0;

    if (input.pressed('l')) lighting.enabled = !lighting.enabled;
    if (input.pressed('b')) lighting.bloom = !lighting.bloom;
    if (input.pressed('g')) showGrid = !showGrid;
    if (input.pressed('c')) showColliders = !showColliders;
    if (input.pressed('h')) showHelp = !showHelp;
    if (input.pressed('t')) dayPaused = !dayPaused;
    if (input.isDown('[')) dayT -= dt * 0.09;
    if (input.isDown(']')) dayT += dt * 0.09;
    if (input.pressed('k')) player.kill();

    // Tick the tool cooldown before anything can return early, or a cast — which
    // holds the update loop for several seconds — leaves it frozen and the next
    // cast silently does nothing until the timer finally drains.
    useCd -= dt;

    // A live cast owns the action button: the same key casts, strikes and
    // reels, which is what keeps fishing a one-button activity.
    if (fishing.active) {
      const act = input.isDown(' ') || input.mouseDown;
      if (input.pressed(' ') || input.pressed('e')) {
        const r = fishing.strike();
        if (r === 'hooked') fx.splash(fishing.floatX, fishing.floatY, 0.6);
      }
      if (input.pressed('q') || input.pressed('escape')) fishing.cancel();
      const ev = fishing.update(dt, act);
      if (ev === 'bite') fx.splash(fishing.floatX, fishing.floatY, 0.45);
      else if (ev === 'caught' && fishing.result?.fish) {
        const f = fishing.result.fish;
        if (inv.add(f.id, 1)) {
          social.get('wick').points += f.id === 'riverking' ? 20 : 1;
          fx.sparks(player.x, player.y - 14, -Math.PI / 2, 10);
          energy = Math.max(0, energy - 0.02);
        } else {
          // Landing a fish you cannot carry used to bin it without a word.
          talk = { speaker: 'YOU', lines: ['YOUR BAG IS FULL.', 'IT SLIPS BACK INTO THE WATER.'] };
        }
      } else if (ev === 'lost' || ev === 'escaped') {
        fx.splash(fishing.floatX, fishing.floatY, 0.35);
      }
      // Movement still runs so the world stays alive, but you cannot walk off.
      player.stop();
      for (const v of villagers) v.update(dt, scene.solids, dayT);
      if (!dayPaused) dayT += dt / 150;
      return;
    }

    // Hotbar
    for (let i = 1; i <= 9; i++) if (input.pressed(String(i))) inv.select(i - 1);
    if (input.pressed('0')) inv.select(9);
    if (wheel !== 0) {
      inv.cycle(wheel > 0 ? 1 : -1);
      wheel = 0;
    }
    if (input.pressed('e')) interact();
    // Hold to keep working, on a cooldown — one swing per press is fiddly when
    // you are tilling a whole row.
    if (!talk && useCd <= 0 && (input.mouseDown || input.isDown(' '))) {
      useTool();
      useCd = 0.34;
    }
    player.showGun = false;

    if (!dayPaused) dayT += dt / 150; // one full day every 2.5 minutes

    // --- doorway wipe -------------------------------------------------------
    if (fadeDir !== 0) {
      fade += fadeDir * dt * 4.5;
      if (fade >= 1 && fadeDir > 0) {
        fade = 1;
        applyTransition();
      } else if (fade <= 0 && fadeDir < 0) {
        fade = 0;
        fadeDir = 0;
      }
    }

    // --- inside a building --------------------------------------------------
    if (room) {
      const r = room;
      for (const v of roomVillagers) v.update(dt, r.solids, dayT);
      fx.update(dt);
      player.update(dt, input, camera.ix, camera.iy, r.solids, fx, camera);
      player.updateBullets(dt, r.solids, fx);
      // Confine the player to the room.
      player.x = Math.max(r.bounds.x0, Math.min(r.bounds.x1, player.x));
      player.y = Math.max(r.bounds.y0, Math.min(r.bounds.y1, player.y));
      if (
        fadeDir === 0 &&
        player.x > r.exit.x &&
        player.x < r.exit.x + r.exit.w &&
        player.y > r.exit.y
      ) {
        leaveRoom();
      }
      camera.update(dt);
      camera.follow(player.x, player.y - 8, r.w, r.h, dt);
      return;
    }

    // Sleeping: fade right down, roll the day over, fade back up.
    if (sleeping) {
      sleepT += dt * 1.1;
      if (sleepT >= 1 && sleepT - dt * 1.1 < 1) nextDay();
      if (sleepT >= 2) {
        sleepT = 0;
        sleeping = false;
      }
      return;
    }

    for (const v of villagers) v.update(dt, scene.solids, dayT);
    // Shopkeeper, innkeeper, smith and miller work under a roof. While their
    // shift is on they are represented by the NPC inside that room instead.
    for (const v of villagers) {
      if (!v.castId) continue;
      const def = castOf.get(v.castId);
      v.indoors = !!def && INDOOR_WORK.has(def.work) && v.activity === 'work';
    }
    gossip(villagers, dt);
    for (const a of animals) a.update(dt, scene.solids);
    for (const d of ducks) d.update(dt, scene.solids);

    // Chimneys, the forge and the campfire all drift smoke.
    for (const sm of scene.smoke) {
      if (sm.rate > 0 && Math.random() < dt * sm.rate) fx.smoke(sm.x, sm.y);
    }
    // Spray thrown off the mill wheel where the paddles hit the water.
    if (Math.random() < dt * 14) fx.splash(scene.smoke[scene.smoke.length - 1].x, MILL.y - 10, 0.25);

    player.update(dt, input, camera.ix, camera.iy, scene.solids, fx, camera);
    player.updateBullets(dt, scene.solids, fx);

    // Walking into a doorway takes you inside.
    if (fadeDir === 0) {
      for (const d of scene.doors) {
        if (player.x > d.x && player.x < d.x + d.w && player.y > d.y && player.y < d.y + d.h) {
          enterRoom(rooms.get(d.kind as never, d.seed), d.x + d.w / 2, d.y + d.h);
          break;
        }
      }
    }

    // Bullets vs slimes
    for (const b of player.bullets) {
      for (const s of slimes) {
        if (s.dead) continue;
        if (Math.hypot(s.x - b.x, s.y - (b.y + 6)) < 10) {
          s.hit(fx, b.vx, b.vy);
          b.life = 0;
        }
      }
    }
    for (const s of slimes) s.update(dt, player, scene.solids);

    // Ambient embers drifting off the campfire and braziers.
    if (Math.random() < dt * 22) fx.ember(226, 118);
    if (Math.random() < dt * 8) fx.ember(352, 280);
    fx.update(dt);

    camera.update(dt);
    camera.follow(player.x, player.y - 8, WORLD_W, WORLD_H, dt);
  }

  function render(): void {
    const camX = camera.ix;
    const camY = camera.iy;

    if (gallery.open) {
      gallery.draw(ctx);
      return;
    }

    if (room) {
      renderRoom(room, camX, camY);
      drawFade();
      drawHud(ctx, hudState());
      drawHotbar(ctx, assets, inv);
      if (talk) drawDialogue(ctx, talk.speaker, talk.lines);
      if (fishing.state === 'reel') drawReel(ctx, assets, fishing);
    if (fishing.state === 'result' && fishing.result?.caught && fishing.result.fish) {
      drawCatch(ctx, assets, fishing.result.fish);
    }
    if (shopOpen) drawShop(ctx, assets, SHOP_STOCK, shopIndex, inv.gold);
      if (sleeping) drawDayCard(ctx, day, Math.min(1, sleepT < 1 ? sleepT : 2 - sleepT));
      return;
    }

    // 1. baked ground
    ctx.drawImage(ground, camX, camY, GAME_W, GAME_H, 0, 0, GAME_W, GAME_H);
    // 2. animated river
    river.render(ctx, camX, camY, GAME_W, GAME_H, time);

    // 3. flat decals: rugs, grass, lily pads, bridge deck
    const pad = 80;
    for (const d of scene.decos) {
      if (d.layer !== 'ground' || d.hidden) continue;
      if (d.x < camX - pad || d.x > camX + GAME_W + pad || d.y < camY - pad || d.y > camY + GAME_H + pad) continue;
      drawClip(ctx, d.clip, time + d.phase, d.x - camX, d.y - camY, d.flip);
    }

    // 3b. the farm plot: soil tiles are flat, crops sort with everything else.
    if (
      FARM.x1 > camX - 32 &&
      FARM.x0 < camX + GAME_W + 32 &&
      FARM.y1 > camY - 32 &&
      FARM.y0 < camY + GAME_H + 32
    ) {
      for (let i = 0; i < farm.tiles.length; i++) {
        const t = farm.tiles[i];
        if (t.soil === Soil.Wild) continue;
        const o = farm.tileOrigin(i);
        drawFrame(ctx, t.watered ? assets.farm.soilWet : assets.farm.soilDry, 0, o.x - camX, o.y - camY);
      }
    }

    // 4. y-sorted world
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    for (let i = 0; i < farm.tiles.length; i++) {
      const t = farm.tiles[i];
      if (!t.crop) continue;
      const o = farm.tileOrigin(i);
      const sheet = assets.farm.crops[CROPS[t.crop].kind][t.stage];
      const bx = o.x + TILE / 2;
      const by = o.y + TILE - 3;
      if (bx < camX - 32 || bx > camX + GAME_W + 32 || by < camY - 40 || by > camY + GAME_H + 40) continue;
      items.push({ y: by, draw: () => drawFrame(ctx, sheet, 0, bx - camX, by - camY) });
    }
    for (const d of scene.decos) {
      if (d.layer !== 'sorted' || d.hidden) continue;
      if (d.x < camX - pad || d.x > camX + GAME_W + pad || d.y < camY - pad || d.y > camY + GAME_H + pad) continue;
      items.push({
        y: d.sortY,
        draw: () => drawClip(ctx, d.clip, time + d.phase, d.x - camX, d.y - camY, d.flip),
      });
    }
    for (const s of slimes) items.push({ y: s.sortY, draw: () => s.draw(ctx, camX, camY) });
    for (const v of villagers) {
      if (v.indoors) continue;
      items.push({ y: v.sortY, draw: () => v.draw(ctx, camX, camY, assets.emotes) });
    }
    for (const a of animals) items.push({ y: a.sortY, draw: () => a.draw(ctx, camX, camY) });
    for (const d of ducks) items.push({ y: d.sortY, draw: () => d.draw(ctx, camX, camY) });
    items.push({ y: player.y, draw: () => player.draw(ctx, camX, camY) });
    // Float and line. The line is drawn from the rod hand to the float so the
    // cast reads as connected to the player rather than as a floating prop.
    if (fishing.active && fishing.state !== 'result') {
      const fp = fishing.floatPos();
      const biting = fishing.state === 'bite';
      items.push({
        y: fp.y + 200, // always over the water, never sorted behind a ripple
        draw: () => {
          ctx.strokeStyle = 'rgba(226,236,248,0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(player.x - camX) + 0.5, Math.round(player.y - 16 - camY) + 0.5);
          ctx.lineTo(Math.round(fp.x - camX) + 0.5, Math.round(fp.y - camY) + 0.5);
          ctx.stroke();
          drawClip(ctx, biting ? assets.fishing.floatBite : assets.fishing.float, time, fp.x - camX, fp.y - camY);
          if (biting) drawClip(ctx, assets.fishing.alert, time, fp.x - camX, fp.y - camY - 14);
        },
      });
    }
    items.sort((a, b) => a.y - b.y);

    fx.drawShadows(ctx, camX, camY);
    for (const it of items) it.draw();

    // 5. fx above the world
    fx.draw(ctx, camX, camY);
    player.drawBullets(ctx, camX, camY);

    // 6. lighting
    lights.length = 0;
    lights.push(...scene.lights);
    player.lights(lights);
    player.bulletLights(lights);
    for (const s of slimes) s.light(lights);
    lighting.render(ctx, lights, camX, camY, GAME_W, GAME_H, time, dayT);

    // 7. debug overlays
    if (showGrid) {
      ctx.strokeStyle = 'rgba(140,170,220,0.16)';
      ctx.beginPath();
      for (let x = -camX % 16; x < GAME_W; x += 16) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, GAME_H);
      }
      for (let y = -camY % 16; y < GAME_H; y += 16) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(GAME_W, y + 0.5);
      }
      ctx.stroke();
    }
    if (showColliders) {
      ctx.strokeStyle = 'rgba(255,90,110,0.8)';
      for (const s of scene.solids) {
        ctx.beginPath();
        ctx.arc(s.x - camX, s.y - camY, s.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(120,220,255,0.9)';
      ctx.beginPath();
      ctx.arc(player.x - camX, player.y - camY, player.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,80,0.6)';
      ctx.strokeRect(BRIDGE.x0 - camX, BRIDGE.y0 - camY, BRIDGE.x1 - BRIDGE.x0, BRIDGE.y1 - BRIDGE.y0);
    }

    drawFade();
    drawHud(ctx, hudState());
    drawHotbar(ctx, assets, inv);
    if (talk) drawDialogue(ctx, talk.speaker, talk.lines);
    if (fishing.state === 'reel') drawReel(ctx, assets, fishing);
    if (fishing.state === 'result' && fishing.result?.caught && fishing.result.fish) {
      drawCatch(ctx, assets, fishing.result.fish);
    }
    if (shopOpen) drawShop(ctx, assets, SHOP_STOCK, shopIndex, inv.gold);
    if (sleeping) drawDayCard(ctx, day, Math.min(1, sleepT < 1 ? sleepT : 2 - sleepT));
  }

  function hudState() {
    return {
      fps: Math.round(fps),
      dayT,
      lighting: lighting.enabled,
      bloom: lighting.bloom,
      paused: dayPaused,
      playerState: player.state,
      forced: player.forced,
      entities: room
        ? room.decos.length + roomVillagers.length + 1
        : scene.decos.length + slimes.length + villagers.length + animals.length + ducks.length + 1,
      particles: fx.list.length,
      showHelp,
      place: room ? room.kind.toUpperCase() : 'OUTSIDE',
      day,
      gold: inv.gold,
      energy,
      quest: (() => {
        const q = activeQuest();
        if (!q) return null;
        if (!q.taken) return `NOTICE: ${q.title}`;
        return `${q.title}  ${questProgress(q, (i) => inv.count(i)).join('  ')}`;
      })(),
    };
  }

  function drawFade(): void {
    if (fade <= 0) return;
    ctx.fillStyle = `rgba(6,7,12,${fade.toFixed(3)})`;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
  }

  /** Interiors reuse the outdoor pipeline: ground, y-sorted props, lighting. */
  function renderRoom(r: Room, camX: number, camY: number): void {
    ctx.fillStyle = '#06070c';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.drawImage(r.ground, camX, camY, GAME_W, GAME_H, 0, 0, GAME_W, GAME_H);

    for (const d of r.decos) {
      if (d.layer !== 'ground') continue;
      drawClip(ctx, d.clip, time + d.phase, d.x - camX, d.y - camY, d.flip);
    }
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    for (const d of r.decos) {
      if (d.layer !== 'sorted') continue;
      items.push({ y: d.sortY, draw: () => drawClip(ctx, d.clip, time + d.phase, d.x - camX, d.y - camY, d.flip) });
    }
    for (const v of roomVillagers) items.push({ y: v.sortY, draw: () => v.draw(ctx, camX, camY, assets.emotes) });
    items.push({ y: player.y, draw: () => player.draw(ctx, camX, camY) });
    // Float and line. The line is drawn from the rod hand to the float so the
    // cast reads as connected to the player rather than as a floating prop.
    if (fishing.active && fishing.state !== 'result') {
      const fp = fishing.floatPos();
      const biting = fishing.state === 'bite';
      items.push({
        y: fp.y + 200, // always over the water, never sorted behind a ripple
        draw: () => {
          ctx.strokeStyle = 'rgba(226,236,248,0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(player.x - camX) + 0.5, Math.round(player.y - 16 - camY) + 0.5);
          ctx.lineTo(Math.round(fp.x - camX) + 0.5, Math.round(fp.y - camY) + 0.5);
          ctx.stroke();
          drawClip(ctx, biting ? assets.fishing.floatBite : assets.fishing.float, time, fp.x - camX, fp.y - camY);
          if (biting) drawClip(ctx, assets.fishing.alert, time, fp.x - camX, fp.y - camY - 14);
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    fx.draw(ctx, camX, camY);

    lights.length = 0;
    lights.push(...r.lights);
    player.lights(lights);
    lighting.renderInterior(ctx, lights, camX, camY, GAME_W, GAME_H, time, r.ambient);
  }

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc > 0.4) {
      fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }
    update(dt);
    render();
    input.endFrame();
    requestAnimationFrame(frame);
  }

  boot.classList.add('hidden');
  requestAnimationFrame(frame);
}

// Give the browser one paint so the "baking" message is visible, then bake.
requestAnimationFrame(() => {
  setTimeout(() => {
    try {
      start();
    } catch (err) {
      boot.classList.remove('hidden');
      boot.textContent = `BOOT FAILED: ${(err as Error).message}`;
      throw err;
    }
  }, 16);
});

// Keep the palette import alive for tooling that tree-shakes aggressively.
void P;

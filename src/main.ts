/**
 * Pixel Asset Lab — a top-down asset test scene.
 *
 * Boot order: bake every sprite procedurally -> bake the ground bitmap ->
 * build the scene -> run the loop. Nothing is loaded from disk; the whole art
 * set is generated in `src/art` at startup.
 */
import { bakeAll } from './art/assets';
import { P } from './art/palette';
import { drawClip } from './art/sheet';
import { Input } from './engine/input';
import { Camera, GAME_H, GAME_W, Screen } from './engine/screen';
import { Slime } from './game/agents';
import { Critter, Duck, Villager, gossip } from './game/npc';
import { Lighting, type Light } from './game/lighting';
import { Particles } from './game/particles';
import { Player, type PlayerState } from './game/player';
import { Scene } from './game/scene';
import { BRIDGE, MILL, WORLD_H, WORLD_W, bakeGround } from './game/terrain';
import { Gallery, drawHud, drawInspect } from './game/ui';
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

  // Start on the high street, just west of the market square.
  player.x = 480;
  player.y = 505;
  camera.follow(player.x, player.y, WORLD_W, WORLD_H, 1, true);

  // Slimes only live in the woods across the river, away from the town.
  const slimes = [
    new Slime(assets, 1280, 200),
    new Slime(assets, 1330, 760),
    new Slime(assets, 1250, 880),
  ];

  // Townsfolk: each spawn gets a skin, cycled so neighbours don't match.
  const villagers = scene.villagerSpawns.map((sp, i) => {
    const anims = assets.npcs[i % assets.npcs.length];
    return new Villager(anims, sp.x, sp.y, sp.home, 1000 + i * 37, sp.kind, sp.stationary, sp.schedule);
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

  // --- debug / display state ------------------------------------------------
  let dayT = 0.79; // start at dusk so the lights read immediately
  let dayPaused = false;
  let showGrid = false;
  let showColliders = false;
  let showHelp = true;
  let inspect = true;
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
      warp(x: number, y: number) {
        player.x = x;
        player.y = y;
        camera.follow(x, y, WORLD_W, WORLD_H, 1, true);
      },
      setTime(t: number) {
        dayT = t;
        dayPaused = true;
      },
    };
  }

  function update(dt: number): void {
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
    if (input.pressed('i')) inspect = !inspect;
    if (input.pressed('t')) dayPaused = !dayPaused;
    if (input.isDown('[')) dayT -= dt * 0.09;
    if (input.isDown(']')) dayT += dt * 0.09;
    if (input.pressed('k')) player.kill();

    const forceMap: Record<string, PlayerState> = {
      '1': 'idle',
      '2': 'walk',
      '3': 'run',
      '4': 'attack',
      '5': 'death',
    };
    for (const k of Object.keys(forceMap)) if (input.pressed(k)) player.forced = forceMap[k];
    if (input.pressed('0')) player.forced = null;

    if (!dayPaused) dayT += dt / 150; // one full day every 2.5 minutes

    // Chest interaction
    if (input.pressed('e')) {
      const c = scene.chest;
      if (Math.hypot(c.x - player.x, c.y - player.y) < 26) {
        c.clip = assets.props.chestOpen;
        c.phase = -time;
        c.label = 'chest (opened)';
        fx.sparks(c.x, c.y - 14, -Math.PI / 2, 10);
      }
    }

    for (const v of villagers) v.update(dt, scene.solids, dayT);
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

    // 1. baked ground
    ctx.drawImage(ground, camX, camY, GAME_W, GAME_H, 0, 0, GAME_W, GAME_H);
    // 2. animated river
    river.render(ctx, camX, camY, GAME_W, GAME_H, time);

    // 3. flat decals: rugs, grass, lily pads, bridge deck
    const pad = 80;
    for (const d of scene.decos) {
      if (d.layer !== 'ground') continue;
      if (d.x < camX - pad || d.x > camX + GAME_W + pad || d.y < camY - pad || d.y > camY + GAME_H + pad) continue;
      drawClip(ctx, d.clip, time + d.phase, d.x - camX, d.y - camY, d.flip);
    }

    // 4. y-sorted world
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    for (const d of scene.decos) {
      if (d.layer !== 'sorted') continue;
      if (d.x < camX - pad || d.x > camX + GAME_W + pad || d.y < camY - pad || d.y > camY + GAME_H + pad) continue;
      items.push({
        y: d.sortY,
        draw: () => drawClip(ctx, d.clip, time + d.phase, d.x - camX, d.y - camY, d.flip),
      });
    }
    for (const s of slimes) items.push({ y: s.sortY, draw: () => s.draw(ctx, camX, camY) });
    for (const v of villagers) items.push({ y: v.sortY, draw: () => v.draw(ctx, camX, camY, assets.emotes) });
    for (const a of animals) items.push({ y: a.sortY, draw: () => a.draw(ctx, camX, camY) });
    for (const d of ducks) items.push({ y: d.sortY, draw: () => d.draw(ctx, camX, camY) });
    items.push({ y: player.y, draw: () => player.draw(ctx, camX, camY) });
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

    // 8. hover label for whatever the cursor is over
    if (inspect) {
      const mx = input.mouseX + camX;
      const my = input.mouseY + camY;
      let best: { d: number; label: string; x: number; y: number } | null = null;
      for (const d of scene.decos) {
        if (!d.label) continue;
        const dist = Math.hypot(d.x - mx, d.y - 8 - my);
        if (dist < 16 && (!best || dist < best.d)) best = { d: dist, label: d.label, x: d.x, y: d.y };
      }
      if (best) drawInspect(ctx, best.label, best.x - camX, best.y - camY - 12);
    }

    drawHud(ctx, {
      fps: Math.round(fps),
      dayT,
      lighting: lighting.enabled,
      bloom: lighting.bloom,
      paused: dayPaused,
      playerState: player.state,
      forced: player.forced,
      entities: scene.decos.length + slimes.length + villagers.length + animals.length + ducks.length + 1,
      particles: fx.list.length,
      showHelp,
    });
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

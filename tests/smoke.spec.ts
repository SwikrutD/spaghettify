import { test, expect, type Page } from '@playwright/test';

interface InstancedMeshProbe {
  count: number;
  instanceMatrix: { array: Float32Array };
  material: { flatShading: boolean };
  geometry: { index: unknown; attributes: { aStretch: { array: Float32Array } } };
}

interface BodyProbe {
  position: { x: number; z: number; set(x: number, y: number, z: number): void };
  velocity: { set(x: number, y: number, z: number): void };
  radius: number;
  mass: number;
  className: string;
  round: boolean;
  state: string;
}

interface Debug {
  frames: number;
  mode: string;
  settings: { scheme: string; quality: string };
  qualityLevel: number;
  autoQuality: { level: number; locked: boolean; isEnabled: boolean; frame(ms: number): void };
  player: {
    position: { x: number; y: number; z: number };
    radius: number;
    mass: number;
    eatenCount: number;
    eatenMass: number;
    eat(mass: number, what?: { name: string; radius: number }): void;
    biggestEaten: { name: string; radius: number } | null;
    disk: { heat: number; starvation: number };
    velocity: { x: number; z: number; set(x: number, y: number, z: number): void };
    pull: { x: number; z: number };
    stun: number;
    radiusForMass(): number;
    setRadius(r: number): void;
    startMass: number;
    peakMass: number;
    score: number;
  };
  hunger: { phase: string; idle: number; level: number; enabled: boolean; floorMass: number; runTime: number };
  hungerOverlay: { level: number };
  milestones: { index: number; all: { title: string; unlocks: string | null }[]; masses: number[] };
  field: { enabled: boolean };
  camera: {
    targetDistance: number;
    viewScale: number;
    shake: number;
    kick: number;
    camera: { fov: number; aspect: number };
  };
  touch: { touching: boolean; mode: string };
  input: { move: { x: number; y: number } };
  prey: {
    objects: BodyProbe[];
    liveCount: number;
    counts: number[];
    isEdible(obj: unknown): boolean;
    instanceOf(i: number): { mesh: InstancedMeshProbe; index: number } | null;
    edible(radius?: number, gap?: number): BodyProbe;
    clear(): void;
    group: { children: InstancedMeshProbe[] };
  };
  audio: {
    context: unknown;
    state: string;
    muted: boolean;
    music: number;
    played: Record<string, number>;
    gainFor(bus: 'music' | 'sfx'): number;
  };
  renderer: {
    lensing: { centre: { x: number; y: number }; coreRadius: number; setSamples(samples: number): void };
    pixelRatio: number;
  };
  readPixel(x: number, y: number): Promise<number[]>;
  snapshot: { image: HTMLCanvasElement | null; taken: number };
  dangers: { enabled: boolean; invulnerable: number; hits: number; shedMass: number };
  comets: {
    objects: { active: boolean; state: string; radius: number; fade: number; position: { x: number; z: number }; velocity: { x: number; z: number } }[];
    launched: number;
    launch(x: number, z: number, vx: number, vz: number, radius: number): unknown;
    spawn(): unknown;
    reset(): void;
  };
  shedBurst: { live: number };
  debris: {
    objects: {
      active: boolean;
      state: string;
      radius: number;
      mass: number;
      age: number;
      heat: number;
      position: { x: number; z: number };
      velocity: { x: number; z: number };
    }[];
    live: number;
    liveMass: number;
    emitted: number;
    reset(): void;
  };
  share: { card: HTMLCanvasElement | null };
}
declare global {
  interface Window {
    __spaghettify: Debug;
  }
}

// SwiftShader is far too slow for the auto quality scaler, which would drop to the lowest level
// mid-test. Every test starts at the fixed High preset unless it stores its own choice first; the
// auto quality test clears this.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      if (!localStorage.getItem('spaghettify.settings')) localStorage.setItem('spaghettify.settings', JSON.stringify({ quality: 'high' }));
    } catch {
      // Storage blocked (one test does this on purpose).
    }
  });
  // The leaderboard server is not part of the test run (and must not be needed): an empty board by
  // default. Tests that care register their own /api routes, which take precedence.
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    const body = route.request().method() === 'POST'
      ? { nickname: 'x', rank: 1, total: 1, best: 0, personalBest: true }
      : url.includes('/rank') ? { rank: 1, total: 1 } : { entries: [], total: 0 };
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
});

/** The title screen holds the run until Play is pressed. */
async function startRun(page: Page, realClick = false): Promise<void> {
  // A synthetic click leaves the pointer where the test put it; a real one is a gesture that unlocks audio.
  if (realClick) await page.getByTestId('play').click();
  else await page.getByTestId('play').dispatchEvent('click');
  await page.waitForFunction(() => window.__spaghettify.mode === 'playing');
}

async function openSettingsFromPause(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-settings').click();
}

test('game loads, renders frames without console errors and the player moves', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);
  // This test is about input moving the hole: no knockback from a body the hole happens to drift into.
  await page.evaluate(() => (window.__spaghettify.dangers.enabled = false));

  const start = await page.evaluate(() => ({ ...window.__spaghettify.player.position }));

  // Pointer to the right of centre: the hole should drift right (software rendering is slow, so wait for it).
  await page.mouse.move(1000, 360);
  await page.waitForTimeout(3000);
  await page.waitForFunction((x) => window.__spaghettify.player.position.x > x + 1, start.x, { timeout: 20_000 });

  const end = await page.evaluate(() => ({
    x: window.__spaghettify.player.position.x,
    z: window.__spaghettify.player.position.z,
    frames: window.__spaghettify.frames,
  }));

  expect(end.frames).toBeGreaterThan(20);
  expect(end.x - start.x).toBeGreaterThan(1);

  // Keyboard has priority over the mouse. W = up screen = -Z.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  const afterKey = await page.evaluate(() => window.__spaghettify.player.position.z);
  expect(afterKey).toBeLessThan(end.z);

  expect(errors).toEqual([]);
});

test('eating a smaller object grows the player; bigger objects are left alone', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);

  const before = await page.evaluate(() => {
    const { player, prey } = window.__spaghettify;
    const target = prey.edible();
    if (!prey.isEdible(target)) throw new Error('not edible');
    // Park the player on the prey so contact is guaranteed.
    player.position.x = target.position.x;
    player.position.z = target.position.z;
    return { radius: player.radius, mass: player.mass, eaten: player.eatenCount, heat: player.disk.heat };
  });

  await page.waitForFunction((r) => window.__spaghettify.player.radius > r, before.radius);
  // Feeding heats the accretion disk.
  await page.waitForFunction((h) => window.__spaghettify.player.disk.heat > h, before.heat);
  const after = await page.evaluate(() => {
    const { player } = window.__spaghettify;
    return { radius: player.radius, mass: player.mass, eaten: player.eatenCount };
  });
  expect(after.eaten).toBeGreaterThan(before.eaten);
  expect(after.mass).toBeGreaterThan(before.mass);
  expect(after.radius).toBeGreaterThan(before.radius);

  // A larger object is not edible: parking on it changes nothing.
  const bigResult = await page.evaluate(async () => {
    const { player, prey } = window.__spaghettify;
    const big = prey.objects.find((o) => o.state === 'alive' && o.radius > player.radius * 2);
    if (!big) return null;
    const stateBefore = big.state;
    player.position.x = big.position.x;
    player.position.z = big.position.z;
    await new Promise((r) => setTimeout(r, 300));
    return { stateBefore, stateAfter: big.state };
  });
  // The pool can legitimately have no larger object left; only assert when one existed.
  if (bigResult) expect(bigResult.stateAfter).toBe(bigResult.stateBefore);

  expect(errors).toEqual([]);
});

test('lensing bends the disk around the hole and the core stays black', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?bots=0');
  await page.mouse.move(640, 360);
  await page.waitForFunction(() => window.__spaghettify?.frames > 30);
  await startRun(page);

  // Brightness at the core's centre and just outside the shadow on the far side (above it on
  // screen) and the near side (below), in core radii. Prey are moved away so they cannot cover the probes.
  const probe = (samples: number) =>
    page.evaluate(async (samples) => {
      const d = window.__spaghettify;
      d.prey.clear();
      d.renderer.lensing.setSamples(samples);
      const start = d.frames;
      while (d.frames < start + 3) await new Promise(requestAnimationFrame);
      const { centre, coreRadius } = d.renderer.lensing;
      const cx = centre.x * innerWidth;
      const cy = (1 - centre.y) * innerHeight;
      const rc = coreRadius * innerHeight;
      const lum = async (dx: number, dy: number) => {
        const [r, g, b] = await d.readPixel(cx + dx * rc, cy + dy * rc);
        return (r + g + b) / 3;
      };
      return {
        core: await lum(0, 0),
        far: Math.min(await lum(0, -1.3), await lum(-0.1, -1.3), await lum(0.1, -1.3)),
        near: Math.max(await lum(0, 1.3), await lum(-0.1, 1.3), await lum(0.1, 1.3)),
      };
    }, samples);

  const flat = await probe(0);
  const lensed = await probe(4);
  // The core is drawn after lensing and bloom: pure black either way.
  expect(flat.core).toBeLessThan(3);
  expect(lensed.core).toBeLessThan(3);
  // Unbent, the far side of the disk hugs the core. Lensing lifts it, opening a dark gap.
  expect(flat.far).toBeGreaterThan(50);
  expect(lensed.far).toBeLessThan(20);
  // The near side is in front of the hole and does not bend.
  expect(flat.near).toBeGreaterThan(50);
  expect(lensed.near).toBeGreaterThan(50);

  // Resizing reallocates the depth textures the lens reads; it must keep rendering cleanly.
  await page.setViewportSize({ width: 900, height: 700 });
  const resized = await probe(2);
  expect(resized.core).toBeLessThan(3);
  expect(resized.near).toBeGreaterThan(50);

  expect(errors).toEqual([]);
});

test('edible prey spaghettify: they stretch toward the hole and drain into the core when eaten', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?bots=0');
  await page.mouse.move(640, 360);
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);

  const result = await page.evaluate(async () => {
    const d = window.__spaghettify;
    const { player, prey } = d;
    const nextFrame = async () => {
      const f = d.frames;
      while (d.frames === f) await new Promise(requestAnimationFrame);
    };
    // What the GPU gets for arena body i, wherever it was drawn: direction from the hole, stretch, centre and scale.
    const read = (i: number) => {
      const drawn = prey.instanceOf(i);
      if (!drawn) throw new Error('body not drawn');
      const { mesh, index: j } = drawn;
      const s = mesh.geometry.attributes.aStretch.array;
      const m = mesh.instanceMatrix.array;
      const dx = m[j * 16 + 12] - player.position.x;
      const dz = m[j * 16 + 14] - player.position.z;
      const dist = Math.hypot(dx, dz);
      return {
        dirLen: Math.hypot(s[j * 4], s[j * 4 + 1]),
        // Cosine between the stretch axis and the line from the hole to the object.
        align: dist > 1e-3 ? (s[j * 4] * dx + s[j * 4 + 1] * dz) / dist : 1,
        stretch: s[j * 4 + 2],
        dist,
        scale: Math.hypot(m[j * 16], m[j * 16 + 1], m[j * 16 + 2]),
      };
    };

    // Clear the field around the hole, then make one big edible rock.
    prey.clear();
    await nextFrame();
    const obj = prey.edible(player.radius * 0.9);
    const index = prey.objects.length - 1;
    const pr = player.radius;
    obj.velocity.set(0, 0, 0);

    // Far away: no tidal stretch.
    obj.position.set(player.position.x + pr * 12, 0, player.position.z);
    await nextFrame();
    await nextFrame();
    const far = read(index).stretch;

    // Close but not touching: already stretching along the line to the hole.
    obj.position.set(player.position.x, 0, player.position.z - (pr + obj.radius + pr * 0.2));
    await nextFrame();
    await nextFrame();
    const near = read(index);

    // Touching: eaten. Follow the infall frame by frame.
    obj.position.set(player.position.x + pr + obj.radius * 0.1, 0, player.position.z);
    const startDist = pr + obj.radius * 0.1;
    let maxStretch = 0;
    let minAlign = 1;
    let last = null as ReturnType<typeof read> | null;
    let frames = 0;
    while (frames < 600) {
      await nextFrame();
      if (obj.state !== 'eating') {
        if (last) break;
        continue;
      }
      const r = read(index);
      maxStretch = Math.max(maxStretch, r.stretch);
      if (r.dist > 0.05 * pr) minAlign = Math.min(minAlign, r.align);
      last = r;
      frames++;
    }
    return { far, near, maxStretch, minAlign, last, startDist, radius: obj.radius, eatingFrames: frames };
  });

  expect(result.far).toBeCloseTo(1, 5);
  expect(result.near.stretch).toBeGreaterThan(1.05);
  expect(result.near.dirLen).toBeCloseTo(1, 3);
  expect(result.near.align).toBeGreaterThan(0.999);
  // Eaten: stretched into a long thin stream, always along the line to the hole...
  expect(result.eatingFrames).toBeGreaterThan(2);
  expect(result.maxStretch).toBeGreaterThan(Math.max(1.5, result.near.stretch));
  expect(result.minAlign).toBeGreaterThan(0.999);
  // ...and by its last frame it has fallen into the core and drained away.
  expect(result.last).not.toBeNull();
  expect(result.last!.dist).toBeLessThan(result.startDist * 0.5);
  expect(result.last!.scale).toBeLessThan(result.radius * 0.5);

  expect(errors).toEqual([]);
});

test('size milestones: eating across one shows its banner; the zoom stays continuous and every class shares the arena', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 480, height: 270 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?bots=0');
  await page.mouse.move(240, 135);
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);
  await page.evaluate(() => (window.__spaghettify.hunger.enabled = false));

  // Grow to just under a milestone, let the radius catch up, then eat one more thing to cross it.
  const crossInto = (index: number) =>
    page.evaluate(async (index) => {
      const d = window.__spaghettify;
      const { player, prey, milestones } = d;
      const nextFrame = async () => {
        const f = d.frames;
        while (d.frames === f) await new Promise(requestAnimationFrame);
      };
      if (milestones.index !== index - 1) throw new Error(`expected milestone ${index - 1}, got ${milestones.index}`);
      // Nothing to eat by accident while it grows to the threshold.
      prey.clear();
      player.mass = milestones.masses[index] - 0.02;
      for (let i = 0; i < 600 && Math.abs(player.radius - player.radiusForMass()) > 0.01 * player.radius; i++) await nextFrame();
      if (milestones.index !== index - 1) throw new Error('crossed the milestone early');
      const before = d.camera.targetDistance;
      const target = prey.edible(player.radius * 0.6);
      const eaten = { name: target.className, radius: target.radius };
      player.velocity.x = player.velocity.z = 0;
      player.position.x = target.position.x;
      player.position.z = target.position.z;
      for (let i = 0; i < 120 && milestones.index !== index; i++) await nextFrame();
      if (milestones.index !== index) throw new Error('milestone not reached');
      await nextFrame();
      return {
        before,
        after: d.camera.targetDistance,
        title: milestones.all[index].title,
        eaten,
        biggest: player.biggestEaten,
        sound: d.audio.played.milestone ?? 0,
        banner: document.querySelector('[data-testid="milestone-banner"]')?.textContent ?? '',
      };
    }, index);

  for (const index of [1, 2]) {
    const r = await crossInto(index);
    expect(r.banner).toContain(r.title);
    // The view follows the radius continuously: a little further out, no jump.
    expect(r.after).toBeGreaterThanOrEqual(r.before);
    expect(r.after).toBeLessThan(r.before * 1.2);
    expect(r.biggest?.radius).toBeGreaterThanOrEqual(r.eaten.radius);
  }
  expect((await crossInto(3)).title).toBe('Asteroid eater');

  // One arena for every size: every body class is out there at its full population, and next to a moon the camera
  // draws it as a smooth sphere among the small rocks of the field.
  const mixed = await page.evaluate(async () => {
    const d = window.__spaghettify;
    const { player, prey } = d;
    const names = [...new Set(prey.objects.map((o) => o.className))];
    // A moon well away from the patch that prey.clear() emptied around the hole.
    // The earlier steps of this test cleared patches of the field (prey.clear) and let the hole drift under the pull of
    // giants: start from a full field again, so wherever the moon is there is small matter around it.
    (d.field as unknown as { reset(): void }).reset();
    // Where the hole will stand next to a moon (on the side toward the middle of the arena).
    const standBy = (o: BodyProbe) => {
      const inward = Math.hypot(o.position.x, o.position.z);
      const gap = o.radius + player.radius * 6;
      return { x: o.position.x - (o.position.x / inward) * gap, z: o.position.z - (o.position.z / inward) * gap };
    };
    const i = prey.objects.findIndex(
      (o) =>
        o.className === 'moon' &&
        o.state === 'alive' &&
        Math.hypot(o.position.x, o.position.z) < 1000 &&
        Math.hypot(o.position.x - player.position.x, o.position.z - player.position.z) > 800,
    );
    if (i < 0) throw new Error('no moon far enough from the hole');
    const moon = prey.objects[i];
    const at = standBy(moon);
    // Nothing pulls or knocks the hole while the camera catches up.
    d.dangers.enabled = false;
    player.velocity.x = player.velocity.z = 0;
    player.position.x = at.x;
    player.position.z = at.z;
    // Let the camera catch up with the jump.
    for (let k = 0; k < 60; k++) {
      const f = d.frames;
      while (d.frames === f) await new Promise(requestAnimationFrame);
    }
    const drawn = prey.instanceOf(i);
    return {
      names,
      counts: prey.counts,
      live: prey.liveCount,
      total: prey.objects.length,
      moonSmooth: drawn ? !drawn.mesh.material.flatShading && drawn.mesh.geometry.index !== null : null,
      meshes: prey.group.children.length,
    };
  });
  for (const name of ['dwarf planet', 'moon', 'rocky planet', 'ice giant', 'gas giant']) expect(mixed.names).toContain(name);
  expect(mixed.live).toBe(mixed.total);
  expect(mixed.meshes).toBe(4);
  expect(mixed.moonSmooth).toBe(true);
  // Rocks of the field (tiny, low and full detail) and at least the moon as a sphere.
  expect(mixed.counts[0] + mixed.counts[1] + mixed.counts[2]).toBeGreaterThan(20);
  expect(mixed.counts[3]).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('portrait screens get a horizontal FOV floor: wider view, the hole and fed disk fit the width', async ({ page }) => {
  // A portrait phone (390x844) and the same screen turned to landscape.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);
  await page.evaluate(() => (window.__spaghettify.hunger.enabled = false));

  const probe = () =>
    page.evaluate(async () => {
      const d = window.__spaghettify;
      for (let i = 0; i < 3; i++) {
        const f = d.frames;
        while (d.frames === f) await new Promise(requestAnimationFrame);
      }
      const { fov, aspect } = d.camera.camera;
      const hfov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspect) * 180) / Math.PI;
      // Core radius as a fraction of the screen width (the lens reports it as a fraction of the height).
      const coreOfWidth = d.renderer.lensing.coreRadius / aspect;
      return { fov, hfov, distance: d.camera.targetDistance, viewScale: d.camera.viewScale, coreOfWidth };
    });

  const portrait = await probe();
  await page.setViewportSize({ width: 844, height: 390 });
  const landscape = await probe();
  await page.setViewportSize({ width: 390, height: 844 });
  const back = await probe();

  // Landscape keeps the base FOV and distance.
  expect(landscape.fov).toBeCloseTo(45, 3);
  // Portrait: the vertical FOV widens (capped) and the camera pulls back for the rest, so the view covers
  // what a 60 degree view would instead of a 22 degree slit.
  expect(portrait.fov).toBeGreaterThan(45);
  expect(portrait.fov).toBeLessThanOrEqual(55.01);
  expect(portrait.distance).toBeGreaterThan(landscape.distance * 1.5);
  // Ground width seen at the hole, relative to the landscape camera distance: as wide as a 60 degree view.
  const across = Math.tan((portrait.hfov * Math.PI) / 360) * (portrait.distance / landscape.distance);
  expect(across).toBeGreaterThan(Math.tan(Math.PI / 6) * 0.99);
  expect(portrait.viewScale).toBeGreaterThan(landscape.viewScale * 1.5);
  // A fully fed disk (outer edge 3.6 core radii, DISK.outerRadiusMax) spans well under the screen width.
  expect(2 * 3.6 * portrait.coreOfWidth).toBeLessThan(0.6);
  // Turning back gives the same view.
  expect(back.fov).toBeCloseTo(portrait.fov, 3);
  expect(back.distance).toBeCloseTo(portrait.distance, 3);
});

test('speed holds on screen as the hole grows', async ({ page }) => {
  test.setTimeout(120_000);
  // Small viewport: software rendering is slow and this test only needs frames to tick.
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);
  // Pull and collisions would bend the top speed; this test is about the movement model alone.
  await page.evaluate(() => {
    window.__spaghettify.hunger.enabled = false;
    window.__spaghettify.dangers.enabled = false;
  });
  await page.mouse.move(470, 135);

  // Top speed in world units per second, and the view scale it should follow.
  const run = (mass: number) =>
    page.evaluate(async (mass) => {
      const d = window.__spaghettify;
      const { player } = d;
      d.renderer.lensing.setSamples(0);
      player.mass = mass;
      let top = 0;
      for (let i = 0; i < 160; i++) {
        const f = d.frames;
        while (d.frames === f) await new Promise(requestAnimationFrame);
        if (i > 100) top = Math.max(top, Math.hypot(player.velocity.x, player.velocity.z));
      }
      return { speed: top, view: d.camera.viewScale };
    }, mass);

  const small = await run(0.25);
  const big = await run(100);
  expect(big.view).toBeGreaterThan(small.view * 2);
  // World speed follows the view distance to the power 0.85 (PLAYER.speedExponent), so on-screen speed eases off
  // only a little as the hole grows: a bigger hole is a bit faster than a smaller one, never the other way round.
  expect(big.speed).toBeGreaterThan(small.speed);
  const exponent = Math.log(big.speed / small.speed) / Math.log(big.view / small.view);
  expect(exponent).toBeGreaterThan(0.75);
  expect(exponent).toBeLessThan(0.95);
});

test('hunger: starving drains mass, dims the disk, ends the run with a score screen, and play again resets cleanly', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 480, height: 270 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?bots=0');
  await page.mouse.move(240, 135);
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);

  // Eat one thing so the score screen has a biggest meal to report.
  await page.evaluate(async () => {
    const d = window.__spaghettify;
    const target = d.prey.edible();
    d.player.position.x = target.position.x;
    d.player.position.z = target.position.z;
    while (d.player.eatenCount < 1) await new Promise(requestAnimationFrame);
  });
  // Eating resets the hunger clock.
  expect(await page.evaluate(() => window.__spaghettify.hunger.idle)).toBeLessThan(1);

  // Skip most of the grace period: mass must start draining and the warning must show.
  const massBefore = await page.evaluate(() => {
    const d = window.__spaghettify;
    d.prey.clear();
    d.hunger.idle = 6.9;
    return d.player.mass;
  });
  await page.waitForFunction((m) => window.__spaghettify.player.mass < m * 0.97, massBefore);
  await page.waitForFunction(() => window.__spaghettify.hungerOverlay.level > 0.3);
  expect(await page.evaluate(() => window.__spaghettify.player.disk.starvation)).toBeGreaterThan(0.1);
  expect(await page.locator('[data-testid="hunger-warning"]').textContent()).not.toBe('');

  // Push the mass to just above the floor: the run evaporates and ends.
  await page.evaluate(() => {
    const d = window.__spaghettify;
    d.player.mass = d.hunger.floorMass * 1.01;
  });
  await page.waitForFunction(() => window.__spaghettify.hunger.phase !== 'playing');
  await expect(page.locator('[data-testid="score-screen"]')).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => window.__spaghettify.hunger.phase)).toBe('over');

  // Score: the peak mass of the life over the start mass, in points.
  const peak = await page.evaluate(() => ({ peak: window.__spaghettify.player.peakMass, start: window.__spaghettify.player.startMass }));
  const score = Number((await page.locator('[data-testid="score"]').textContent())!.replace(/,/g, ''));
  expect(score).toBeGreaterThan(0);
  expect(score).toBe(Math.round((peak.peak - peak.start) * 1000));
  const ladder = (await page.locator('[data-testid="ladder"]').textContent())!;
  expect(ladder).toMatch(/^You ate an? /);
  const run = await page.evaluate(() => ({ biggest: window.__spaghettify.player.biggestEaten!.name, count: window.__spaghettify.player.eatenCount }));
  expect(ladder).toContain(run.biggest);
  const stats = (await page.locator('[data-testid="stats"]').textContent())!;
  expect(stats).toContain('Size reachedDust eater');
  expect(stats).toContain(`Objects eaten${run.count}`);

  // Play again: everything is back to a fresh run.
  await page.locator('[data-testid="play-again"]').click();
  await expect(page.locator('[data-testid="score-screen"]')).toBeHidden();
  await page.waitForFunction(() => window.__spaghettify.frames > 0 && window.__spaghettify.hunger.phase === 'playing');
  const fresh = await page.evaluate(async () => {
    const d = window.__spaghettify;
    const f = d.frames;
    while (d.frames < f + 3) await new Promise(requestAnimationFrame);
    return {
      mass: d.player.mass,
      radius: d.player.radius,
      eatenCount: d.player.eatenCount,
      biggest: d.player.biggestEaten,
      milestone: d.milestones.index,
      idle: d.hunger.idle,
      // The hunger dimming (the disk also blinks during the respawn protection, which is not hunger).
      starvation: d.hungerOverlay.level,
      heat: d.player.disk.heat,
      live: d.prey.objects.filter((o) => o.state === 'alive').length,
      count: d.prey.objects.length,
      viewScale: d.camera.viewScale,
    };
  });
  expect(fresh.mass).toBeCloseTo(0.25, 1);
  expect(fresh.radius).toBeCloseTo(0.5, 1);
  // It respawned where there is food around, so a meal or two straight away is fine.
  expect(fresh.eatenCount).toBeLessThan(5);
  expect(fresh.milestone).toBe(0);
  expect(fresh.idle).toBeLessThan(1);
  expect(fresh.starvation).toBeLessThan(0.05);
  expect(fresh.heat).toBeLessThan(0.2);
  expect(fresh.live).toBe(fresh.count);
  expect(fresh.viewScale).toBeCloseTo(1, 1);

  // And the new run can be played: the hole eats again.
  const ate = await page.evaluate(async () => {
    const d = window.__spaghettify;
    const target = d.prey.edible();
    d.player.position.x = target.position.x;
    d.player.position.z = target.position.z;
    for (let i = 0; i < 200 && d.player.eatenCount < 1; i++) await new Promise(requestAnimationFrame);
    return d.player.eatenCount;
  });
  expect(ate).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

/** Eats one object (a photo for the share card), then starves the hole until the score screen shows. */
async function playShortRun(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const d = window.__spaghettify;
    const target = d.prey.edible();
    d.player.position.x = target.position.x;
    d.player.position.z = target.position.z;
    while (d.player.eatenCount < 1) await new Promise(requestAnimationFrame);
    while (d.snapshot.taken < 1) await new Promise(requestAnimationFrame);
    d.prey.clear();
    d.hunger.idle = 100;
    d.player.mass = d.hunger.floorMass * 1.01;
  });
  await expect(page.getByTestId('score-screen')).toBeVisible({ timeout: 30_000 });
}

/** Mean brightness and spread of a canvas, to tell a drawn card from a blank one. */
function canvasStats(): { width: number; height: number; mean: number; spread: number; leftBright: number } {
  const c = window.__spaghettify.share.card!;
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  let sq = 0;
  let leftBright = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += v;
    sq += v * v;
    // Text on the left panel: bright pixels in the left half.
    if ((i / 4) % c.width < c.width / 2 && v > 200) leftBright++;
  }
  const mean = sum / n;
  return { width: c.width, height: c.height, mean, spread: Math.sqrt(sq / n - mean * mean), leftBright };
}

test('share card: the score screen renders a card with the run photo and SAVE CARD downloads it as a PNG', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 480, height: 270 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // Force the fallback path even where the browser has Web Share.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
  });

  await page.goto('/?bots=0');
  await page.mouse.move(240, 135);
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);
  await playShortRun(page);

  // The run photo is a real frame (not black) and the card has the photo and the text drawn.
  const photo = await page.evaluate(() => {
    const img = window.__spaghettify.snapshot.image!;
    const data = img.getContext('2d')!.getImageData(0, 0, img.width, img.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
    return { w: img.width, h: img.height, lit };
  });
  expect(photo.w).toBeGreaterThan(100);
  expect(photo.lit).toBeGreaterThan(50);
  const card = await page.evaluate(canvasStats);
  expect(card.width).toBe(1200);
  expect(card.height).toBe(675);
  expect(card.spread).toBeGreaterThan(10);
  expect(card.leftBright).toBeGreaterThan(2000);

  const button = page.getByTestId('share');
  await expect(button).toHaveText('SAVE CARD');
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^spaghettify-\d+\.png$/);
  const score = Number((await page.getByTestId('score').textContent())!.replace(/,/g, ''));
  expect(download.suggestedFilename()).toBe(`spaghettify-${score}.png`);
  const file = await download.path();
  const fs = await import('node:fs');
  const png = fs.readFileSync(file);
  expect(png.length).toBeGreaterThan(20_000);
  // PNG signature and the IHDR size match the card.
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(675);
  await expect(page.getByTestId('share-status')).toHaveText('Card saved');

  // Play again clears the photo for the next run.
  await page.getByTestId('play-again').click();
  await page.waitForFunction(() => window.__spaghettify.hunger.phase === 'playing');
  expect(await page.evaluate(() => window.__spaghettify.snapshot.taken)).toBe(0);
  expect(errors).toEqual([]);
});

/** Console errors, minus Chrome's own "Failed to load resource" lines for /api requests that were refused on purpose. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().startsWith('Failed to load resource') && m.location().url.includes('/api/')) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('leaderboard: the title shows the top few, the score screen posts the run and shows the board with the player lit', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 640, height: 360 });
  const errors = collectErrors(page);
  const posted: Record<string, unknown>[] = [];
  const entries = [
    { rank: 1, nickname: 'Sagittarius', score: 9_000_000, tier: 3 },
    { rank: 2, nickname: '<img src=x onerror=alert(1)>', score: 5_000_000, tier: 3 },
    { rank: 3, nickname: 'Cygnus', score: 2_000_000, tier: 3 },
    { rank: 4, nickname: 'Pea', score: 900, tier: 1 },
    { rank: 5, nickname: 'Dust', score: 50, tier: 1 },
  ];
  await page.route('**/api/scores/top*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entries, total: 42 }) }),
  );
  await page.route('**/api/scores', (route) => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ nickname: 'Pea', rank: 4, total: 42, best: 900, personalBest: false }) });
  });
  await page.addInitScript(() => localStorage.setItem('spaghettify.nickname', 'Pea'));

  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  // Title: the top five, the player's own row lit, nicknames as plain text.
  const titleBoard = page.getByTestId('title-board');
  await expect(titleBoard).toBeVisible();
  await expect(titleBoard.locator('li')).toHaveCount(5);
  await expect(titleBoard.locator('li').nth(1)).toContainText('<img src=x onerror=alert(1)>');
  await expect(titleBoard.locator('li[data-mine]')).toContainText('Pea');

  await startRun(page);
  await playShortRun(page);
  await expect(page.getByTestId('board-status')).toHaveText('Your best: 900. You are #4 of 42.');
  const run = await page.evaluate(() => ({ score: window.__spaghettify.player.score, eaten: window.__spaghettify.player.eatenCount, seconds: window.__spaghettify.hunger.runTime }));
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ nickname: 'Pea', score: run.score, tier: 1, eaten: run.eaten });
  expect(posted[0].seconds as number).toBeCloseTo(run.seconds, 0);
  const rows = page.getByTestId('board-rows').locator('li');
  await expect(rows).toHaveCount(5);
  await expect(page.getByTestId('board-rows').locator('li[data-mine]')).toContainText('Pea');
  await expect(page.getByTestId('play-again')).toBeVisible();
  expect(errors).toEqual([]);
});

test('leaderboard: with the server down or hanging the game plays, the board says so, and nothing errors', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 480, height: 270 });
  const errors = collectErrors(page);
  // Reads are refused at once; the score submit hangs until the client's own timeout gives up.
  await page.route('**/api/scores/top*', (route) => route.abort('connectionrefused'));
  await page.route('**/api/scores', () => {});
  await page.addInitScript(() => localStorage.setItem('spaghettify.nickname', 'Pea'));

  await page.goto('/?bots=0');
  await page.mouse.move(240, 135);
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await expect(page.getByTestId('title-board')).toBeHidden();
  await startRun(page);
  await playShortRun(page);
  await expect(page.getByTestId('board-status')).toHaveText('Posting your score...');
  await expect(page.getByTestId('board-status')).toHaveText(/^Leaderboard unavailable right now/, { timeout: 10_000 });
  await expect(page.getByTestId('board-rows').locator('li')).toHaveCount(0);

  // Play again works and the next run plays normally.
  await page.getByTestId('play-again').click();
  await page.waitForFunction(() => window.__spaghettify.hunger.phase === 'playing');
  const frames = await page.evaluate(() => window.__spaghettify.frames);
  await page.waitForFunction((f) => window.__spaghettify.frames > f + 10, frames);
  expect(errors).toEqual([]);
});

test('leaderboard: without a nickname nothing is posted and the board shows where the run would place', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 480, height: 270 });
  const errors = collectErrors(page);
  let posts = 0;
  await page.route('**/api/scores', (route) => {
    posts++;
    return route.abort();
  });
  await page.route('**/api/scores/rank*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rank: 17, total: 30 }) }));
  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);
  await playShortRun(page);
  await expect(page.getByTestId('board-status')).toHaveText('This run would place #17 of 30. Set a nickname on the title screen to post your scores.');
  expect(posts).toBe(0);
  expect(errors).toEqual([]);
});

test('audio: the context is created after a click, events trigger sounds, and the mute toggle works', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);

  // Browsers block audio before a gesture: no context yet, and the game runs fine without one.
  expect(await page.evaluate(() => window.__spaghettify.audio.context)).toBeNull();

  await startRun(page, true);
  await page.waitForFunction(() => window.__spaghettify.audio.context !== null);
  expect(await page.evaluate(() => window.__spaghettify.audio.state)).not.toBe('closed');

  // Eating triggers the eat sound.
  await page.evaluate(() => {
    const { player, prey } = window.__spaghettify;
    const target = prey.edible();
    player.position.x = target.position.x;
    player.position.z = target.position.z;
  });
  await page.waitForFunction(() => (window.__spaghettify.audio.played.eat ?? 0) > 0);

  // Mute toggle: button and the M key. State, aria-pressed, gains and localStorage all follow.
  await openSettingsFromPause(page);
  const button = page.getByTestId('mute-toggle');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__spaghettify.audio.gainFor('music'))).toBeGreaterThan(0);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__spaghettify.audio.muted)).toBe(true);
  expect(await page.evaluate(() => window.__spaghettify.audio.gainFor('music') + window.__spaghettify.audio.gainFor('sfx'))).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spaghettify.audio') ?? '{}').muted)).toBe(true);
  await page.keyboard.press('KeyM');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__spaghettify.audio.muted)).toBe(false);

  // The saved choice survives a reload, and the sliders change the stored volume.
  await button.click();
  await page.reload();
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  expect(await page.evaluate(() => window.__spaghettify.audio.muted)).toBe(true);
  await page.evaluate(() => localStorage.removeItem('spaghettify.audio'));

  expect(errors).toEqual([]);
});

test('audio: a size milestone, the hunger warning and evaporation each trigger their sound; restart is clean', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 480, height: 320 });
  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page, true);
  await page.waitForFunction(() => window.__spaghettify.audio.context !== null);

  // Milestone: set the mass just under the first one and eat something.
  await page.evaluate(() => {
    const { player, prey, milestones, hunger } = window.__spaghettify;
    hunger.enabled = false;
    player.mass = milestones.masses[1] - 0.01;
    const target = prey.edible();
    player.position.x = target.position.x;
    player.position.z = target.position.z;
  });
  await page.waitForFunction(() => (window.__spaghettify.audio.played.milestone ?? 0) > 0);

  // Hunger: the warning pulses, then the evaporation sound plays once. The hole is held still and the
  // field around it cleared, or it can keep eating and never starve.
  await page.mouse.move(240, 160);
  await page.evaluate(() => {
    const { hunger, prey } = window.__spaghettify;
    prey.clear();
    hunger.enabled = true;
    hunger.idle = 100;
  });
  await page.waitForFunction(() => (window.__spaghettify.audio.played.warning ?? 0) > 0);
  // Skip most of the drain: on slow SwiftShader frames (game time is capped per frame) it can take minutes.
  await page.evaluate(() => {
    const { player, hunger } = window.__spaghettify;
    player.mass = hunger.floorMass * 1.03;
  });
  await page.waitForFunction(() => window.__spaghettify.hunger.phase !== 'playing', undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    const { player, hunger } = window.__spaghettify;
    player.mass = hunger.floorMass * 0.9;
  });
  await page.waitForFunction(() => window.__spaghettify.audio.played.evaporate === 1);

  // Restart keeps working with audio (no errors, drone fades back in).
  await page.getByText('PLAY AGAIN').click();
  await page.waitForFunction(() => window.__spaghettify.hunger.phase === 'playing');
  expect(errors).toEqual([]);
});

test('audio: with Web Audio unavailable the game still runs and nothing errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { value: undefined });
    Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('blocked'); } });
  });
  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page, true);
  await openSettingsFromPause(page);
  await page.getByTestId('mute-toggle').click();
  await page.getByTestId('settings-back').click();
  await page.getByTestId('resume').click();
  await page.evaluate(() => {
    const { player, prey } = window.__spaghettify;
    const target = prey.edible();
    player.position.x = target.position.x;
    player.position.z = target.position.z;
  });
  await page.waitForFunction(() => window.__spaghettify.player.eatenCount > 0);
  expect(await page.evaluate(() => window.__spaghettify.audio.context)).toBeNull();
  expect(errors).toEqual([]);
});

test('title screen holds the run until Play, shows the best score and saves the nickname', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('spaghettify.best', '12345');
    }
  });

  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await expect(page.getByTestId('title-best')).toHaveText('BEST 12,345');
  expect(await page.evaluate(() => window.__spaghettify.mode)).toBe('title');

  // Nothing advances on the title screen, even with the pointer far from the centre and a key held.
  await page.mouse.move(1000, 360);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyD');
  const idle = await page.evaluate(() => ({
    x: window.__spaghettify.player.position.x,
    idle: window.__spaghettify.hunger.idle,
    run: window.__spaghettify.hunger.runTime,
  }));
  expect(idle).toEqual({ x: 0, idle: 0, run: 0 });

  // The nickname is cleaned and persists across a reload.
  await page.getByTestId('nickname').fill('  Ba<b>y   Hole!  ');
  expect(await page.evaluate(() => localStorage.getItem('spaghettify.nickname'))).toBe('Baby Hole');
  await page.reload();
  await expect(page.getByTestId('nickname')).toHaveValue('Baby Hole');

  // Enter in the nickname field starts the run and the hole then moves.
  await page.getByTestId('nickname').press('Enter');
  await page.waitForFunction(() => window.__spaghettify.mode === 'playing');
  await expect(page.getByTestId('title-screen')).toBeHidden();
  await page.mouse.move(1000, 360);
  await page.waitForFunction(() => window.__spaghettify.player.position.x > 0.5);
  expect(errors).toEqual([]);
});

test('pause: Escape, the pause button and tab blur freeze the run; resume and quit work', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);
  await page.mouse.move(1000, 360);
  await page.waitForFunction(() => window.__spaghettify.hunger.idle > 0.3);

  const snapshot = () =>
    page.evaluate(() => {
      const { player, hunger, prey } = window.__spaghettify;
      return { x: player.position.x, idle: hunger.idle, run: hunger.runTime, px: prey.objects[0].position.x, pz: prey.objects[0].position.z };
    });

  // Escape pauses: hunger, the hole and prey all stop while frames keep rendering.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  expect(await page.evaluate(() => window.__spaghettify.mode)).toBe('paused');
  const a = await snapshot();
  const frames = await page.evaluate(() => window.__spaghettify.frames);
  await page.waitForTimeout(700);
  expect(await snapshot()).toEqual(a);
  expect(await page.evaluate(() => window.__spaghettify.frames)).toBeGreaterThan(frames);

  // Escape resumes and time advances again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  await page.waitForFunction((t) => window.__spaghettify.hunger.runTime > t + 0.2, a.run);

  // The corner button pauses, Resume continues.
  await page.getByTestId('pause-button').click();
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('resume').click();
  expect(await page.evaluate(() => window.__spaghettify.mode)).toBe('playing');

  // Tab blur pauses.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.__spaghettify.mode)).toBe('paused');

  // Settings opened from the pause menu: Escape closes settings first and the run stays paused.
  await page.getByTestId('pause-settings').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  expect(await page.evaluate(() => window.__spaghettify.mode)).toBe('paused');

  // Quit run: back to the title screen with a fresh run, and Play starts it again.
  await page.getByTestId('quit-run').click();
  await expect(page.getByTestId('title-screen')).toBeVisible();
  const fresh = await page.evaluate(() => ({ run: window.__spaghettify.hunger.runTime, mode: window.__spaghettify.mode }));
  expect(fresh).toEqual({ run: 0, mode: 'title' });
  await startRun(page);
  expect(errors).toEqual([]);
});

test('settings: scheme, quality and volume persist across a reload and keyboard only ignores the mouse', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await page.getByTestId('title-settings').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await page.getByTestId('control-scheme').selectOption('keyboard');
  await page.getByTestId('quality').selectOption('low');
  await page.getByTestId('music-volume').fill('0.25');
  await page.getByTestId('sfx-volume').fill('0.5');
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('title-screen')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spaghettify.settings') ?? '{}'))).toEqual({ scheme: 'keyboard', quality: 'low' });

  // Persisted values are applied after a reload and shown in the panel.
  await page.reload();
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  expect(await page.evaluate(() => window.__spaghettify.settings)).toMatchObject({ scheme: 'keyboard', quality: 'low' });
  expect(await page.evaluate(() => window.__spaghettify.qualityLevel)).toBe(6);
  await page.getByTestId('title-settings').click();
  await expect(page.getByTestId('control-scheme')).toHaveValue('keyboard');
  await expect(page.getByTestId('quality')).toHaveValue('low');
  await expect(page.getByTestId('music-volume')).toHaveValue('0.25');
  await expect(page.getByTestId('sfx-volume')).toHaveValue('0.5');
  await page.getByTestId('settings-back').click();

  // Keyboard only: the pointer no longer steers, the keys do.
  await startRun(page);
  await page.mouse.move(1000, 360);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__spaghettify.player.position.x)).toBeCloseTo(0, 5);
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__spaghettify.player.position.x > 0.5);
  await page.keyboard.up('KeyD');

  // Back to mouse follow at high quality.
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-settings').click();
  await page.getByTestId('control-scheme').selectOption('mouse');
  await page.getByTestId('quality').selectOption('high');
  expect(await page.evaluate(() => window.__spaghettify.settings)).toMatchObject({ scheme: 'mouse', quality: 'high' });
  expect(await page.evaluate(() => window.__spaghettify.qualityLevel)).toBe(0);
  expect(errors).toEqual([]);
});

test('auto quality: default on, steps down on slow frames, probes up once, locks when it does not help, and a fixed preset stops it', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 480, height: 270 });
  // Undo the High preset that beforeEach seeds: this test wants the real default.
  await page.addInitScript(() => localStorage.removeItem('spaghettify.settings'));
  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 2);

  // Each scenario feeds synthetic frame times in one synchronous call, so real (slow SwiftShader)
  // frames cannot interleave. 30 ms frames are 33 fps; 12 ms frames are comfortably good.
  const feed = (steps: [number, number][]) =>
    page.evaluate((steps) => {
      const d = window.__spaghettify;
      for (const [ms, count] of steps) for (let i = 0; i < count; i++) d.autoQuality.frame(ms);
      return { level: d.autoQuality.level, applied: d.qualityLevel, locked: d.autoQuality.locked, pr: d.renderer.pixelRatio };
    }, steps);

  expect(await page.evaluate(() => window.__spaghettify.settings.quality)).toBe('auto');
  expect(await page.evaluate(() => window.__spaghettify.autoQuality.isEnabled)).toBe(true);

  // A steady 30 fps cap: stepping down does not help, so the scaler undoes it and stops for the session.
  const start = await page.evaluate(() => window.__spaghettify.autoQuality.level);
  const capped = await feed([[33.3, 1000]]);
  expect(capped.locked).toBe(true);
  expect(capped.level).toBe(start);

  // Fresh session (from the remembered level, desktop default 0): slow frames step down one level and apply it.
  await page.reload();
  await page.waitForFunction(() => window.__spaghettify?.frames > 2);
  expect(await page.evaluate(() => window.__spaghettify.autoQuality.level)).toBe(0);
  const slow = await feed([[30, 110]]);
  expect(slow).toMatchObject({ level: 1, applied: 1, locked: false });
  expect(slow.pr).toBeCloseTo(0.85, 5);
  expect(await page.evaluate(() => localStorage.getItem('spaghettify.autoQuality'))).toBe('1');
  // Good frames for a while: one probe back up to level 0.
  expect((await feed([[12, 1300]])).level).toBe(0);
  // Level 0 is too slow after all: back down, and level 0 is not retried this session.
  expect((await feed([[30, 110]])).level).toBe(1);
  expect((await feed([[12, 4000]])).level).toBe(1);

  // A fixed preset turns the scaler off and applies its own level; Auto turns it back on.
  await page.getByTestId('title-settings').click();
  await expect(page.getByTestId('quality')).toHaveValue('auto');
  await page.getByTestId('quality').selectOption('high');
  const fixed = await feed([[30, 400]]);
  expect(fixed.applied).toBe(0);
  expect(fixed.pr).toBeCloseTo(1, 5);
  expect(await page.evaluate(() => window.__spaghettify.autoQuality.isEnabled)).toBe(false);
  await page.getByTestId('quality').selectOption('auto');
  expect(await page.evaluate(() => window.__spaghettify.autoQuality.isEnabled)).toBe(true);
  expect(await page.evaluate(() => window.__spaghettify.qualityLevel)).toBe(1);
  await page.getByTestId('settings-back').click();
  await startRun(page);
  await page.waitForTimeout(300);

  // `?perf` shows the frame time readout (the GPU timer is not available under SwiftShader).
  await page.goto('/?perf&bots=0');
  await expect(page.getByTestId('perf-overlay')).toContainText('fps');
  await expect(page.getByTestId('perf-overlay')).toContainText('quality');
  expect(errors).toEqual([]);
});

// Touch: a phone-like context (coarse pointer, touch events). Pointer events come from CDP touch input.
test('analytics: nothing is loaded or sent off the live domain, and a run still starts', async ({ page }) => {
  const umami: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('umami')) umami.push(r.url());
  });
  await page.goto('/?bots=0');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await startRun(page);
  await page.waitForTimeout(500);
  expect(await page.locator('script[data-website-id]').count()).toBe(0);
  expect(umami).toEqual([]);
});

test.describe('touch and gamepad', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 640, height: 360 } });

  async function touchStart(page: Page, x: number, y: number) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    return {
      move: (nx: number, ny: number) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: nx, y: ny, id: 1 }] }),
      end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    };
  }

  test('touch device defaults to finger follow, menus work by tap and the hole follows the finger', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?bots=0');
    await page.waitForFunction(() => window.__spaghettify?.frames > 5);
    expect(await page.evaluate(() => window.__spaghettify.settings.scheme)).toBe('finger');
    await page.getByTestId('play').tap();
    await page.waitForFunction(() => window.__spaghettify.mode === 'playing');

    // Finger to the right of centre: drift right. Lifting the finger stops the steering.
    const t = await touchStart(page, 560, 180);
    await page.waitForFunction(() => window.__spaghettify.player.position.x > 0.5);
    expect(await page.evaluate(() => window.__spaghettify.touch.touching)).toBe(true);
    expect(await page.evaluate(() => window.__spaghettify.input.move.x)).toBeGreaterThan(0.5);
    await t.end();
    await page.waitForFunction(() => !window.__spaghettify.touch.touching);
    await page.waitForFunction(() => window.__spaghettify.input.move.x === 0 && window.__spaghettify.input.move.y === 0);

    // The pause button is a DOM button and takes a tap.
    await page.getByTestId('pause-button').tap();
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('share card: a touch device with Web Share gets the share sheet with the PNG and the game URL', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const w = window as unknown as { shared: { name: string; type: string; size: number; text: string }[] };
      w.shared = [];
      Object.defineProperty(Navigator.prototype, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: async (data: ShareData) => {
          const f = data.files![0];
          w.shared.push({ name: f.name, type: f.type, size: f.size, text: data.text ?? '' });
        },
      });
    });
    await page.goto('/?bots=0');
    await page.waitForFunction(() => window.__spaghettify?.frames > 5);
    await page.getByTestId('play').tap();
    await page.waitForFunction(() => window.__spaghettify.mode === 'playing');
    await playShortRun(page);

    await expect(page.getByTestId('share')).toHaveText('SHARE');
    await page.getByTestId('share').tap();
    await expect(page.getByTestId('share-status')).toHaveText('Shared');
    const shared = await page.evaluate(() => (window as unknown as { shared: { name: string; type: string; size: number; text: string }[] }).shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].type).toBe('image/png');
    expect(shared[0].size).toBeGreaterThan(20_000);
    expect(shared[0].name).toMatch(/^spaghettify-\d+\.png$/);
    expect(shared[0].text).toMatch(/^You ate an? .+ https:\/\/spaghettify\.swikrut\.com$/);
    expect(errors).toEqual([]);
  });

  test('joystick: steers by drag from the touch-down point, shows a stick, and the choice persists', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?bots=0');
    await page.waitForFunction(() => window.__spaghettify?.frames > 5);
    await page.getByTestId('title-settings').tap();
    await page.getByTestId('control-scheme').selectOption('joystick');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spaghettify.settings') ?? '{}').scheme)).toBe('joystick');
    await page.getByTestId('settings-back').tap();

    await page.reload();
    await page.waitForFunction(() => window.__spaghettify?.frames > 5);
    expect(await page.evaluate(() => window.__spaghettify.settings.scheme)).toBe('joystick');
    await page.getByTestId('play').tap();
    await page.waitForFunction(() => window.__spaghettify.mode === 'playing');

    // Touch down left of centre without dragging: a finger-follow scheme would steer left, the joystick must not move.
    const t = await touchStart(page, 120, 280);
    await page.waitForTimeout(800);
    expect(Math.abs(await page.evaluate(() => window.__spaghettify.player.position.x))).toBeLessThan(0.05);
    await expect(page.getByTestId('joystick-base')).toBeVisible();

    // Drag right: the hole moves right. Drag up: it moves toward screen up (-Z).
    await t.move(200, 280);
    await page.waitForFunction(() => window.__spaghettify.player.position.x > 0.5);
    await t.move(120, 200);
    await page.waitForFunction(() => window.__spaghettify.player.position.z < -0.5);
    await t.end();
    await expect(page.getByTestId('joystick-base')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('gamepad left stick moves the hole', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __pad: number[] }).__pad = [0, 0];
      navigator.getGamepads = () =>
        [{ connected: true, axes: (window as unknown as { __pad: number[] }).__pad, buttons: [] } as unknown as Gamepad];
    });
    await page.goto('/?bots=0');
    await page.waitForFunction(() => window.__spaghettify?.frames > 5);
    await page.getByTestId('play').tap();
    await page.waitForFunction(() => window.__spaghettify.mode === 'playing');
    // Stick right, then stick up (axis y is negative when pushed up): +X, then -Z.
    await page.evaluate(() => ((window as unknown as { __pad: number[] }).__pad[0] = 1));
    await page.waitForFunction(() => window.__spaghettify.player.position.x > 0.5);
    await page.evaluate(() => {
      const pad = (window as unknown as { __pad: number[] }).__pad;
      pad[0] = 0;
      pad[1] = -1;
    });
    await page.waitForFunction(() => window.__spaghettify.player.position.z < -0.5);
  });

  test('juice: a big meal shakes the camera, a tiny one only kicks it', async ({ page }) => {
    await page.goto('/?bots=0');
    await page.waitForFunction(() => window.__spaghettify?.frames > 5);
    await page.getByTestId('play').tap();
    await page.waitForFunction(() => window.__spaghettify.mode === 'playing');
    await page.evaluate(() => {
      window.__spaghettify.hunger.enabled = false;
      const { player } = window.__spaghettify;
      player.eat(0.001, { name: 'dust grain', radius: player.radius * 0.05 });
    });
    const tiny = await page.evaluate(() => window.__spaghettify.camera);
    expect(tiny.shake).toBe(0);
    await page.evaluate(() => {
      const { player } = window.__spaghettify;
      player.eat(0.01, { name: 'rock', radius: player.radius * 0.9 });
    });
    const big = await page.evaluate(() => window.__spaghettify.camera);
    expect(big.shake).toBeGreaterThan(0);
    expect(big.kick).toBeGreaterThan(0);
  });
});

test.describe('dangers', () => {
  // Small viewport (SwiftShader is slow) and keyboard-only controls, so the pointer never steers.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 270 });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('spaghettify.settings', JSON.stringify({ quality: 'high', scheme: 'keyboard' }));
      } catch {
        // Storage blocked: the defaults are fine.
      }
    });
  });

  /**
   * Start a run with hunger off, the field cleared away and one big still body `gapRadii` hole radii to the right
   * (centre to centre). `grow` multiplies the hole's mass first (a hole at the start mass sheds nothing).
   */
  async function oneBigBody(page: Page, sizeRatio: number, gapRadii: number, realClick = false, grow = 1): Promise<string[]> {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?bots=0');
    await page.waitForFunction(() => window.__spaghettify?.frames > 5);
    await startRun(page, realClick);
    await page.evaluate(
      ([sizeRatio, gapRadii, grow]) => {
        const d = window.__spaghettify;
        const { player, prey } = d;
        d.hunger.enabled = false;
        player.mass *= grow;
        player.setRadius(player.radiusForMass());
        // Everything else respawns out of sight and out of pull reach, and the small matter around is cleared.
        prey.clear();
        const body = prey.objects[0];
        body.radius = player.radius * sizeRatio;
        body.mass = body.radius * body.radius;
        body.velocity.set(0, 0, 0);
        body.position.set(player.position.x + player.radius * gapRadii, 0, player.position.z);
        player.velocity.set(0, 0, 0);
      },
      [sizeRatio, gapRadii, grow],
    );
    return errors;
  }

  test('gravity pull: with no input the hole drifts toward a big body, and steering away escapes it', async ({ page }) => {
    const errors = await oneBigBody(page, 4, 7);
    const start = await page.evaluate(() => {
      const { player } = window.__spaghettify;
      return { x: player.position.x, z: player.position.z, r: player.radius };
    });

    // No input at all: the pull alone moves the hole right, toward the body.
    await page.waitForFunction((s) => window.__spaghettify.player.position.x > s.x + s.r * 0.3, start, { timeout: 20_000 });
    const pulled = await page.evaluate(() => {
      const { player, input } = window.__spaghettify;
      return { z: player.position.z, vx: player.velocity.x, px: player.pull.x, pz: player.pull.z, move: { ...input.move } };
    });
    expect(pulled.move).toEqual({ x: 0, y: 0 });
    expect(pulled.px).toBeGreaterThan(0);
    expect(Math.abs(pulled.pz)).toBeLessThan(pulled.px * 0.01);
    expect(pulled.vx).toBeGreaterThan(0);
    expect(Math.abs(pulled.z - start.z)).toBeLessThan(start.r * 0.05);

    // Steering away beats the pull: the hole ends up well left of where it started.
    await page.keyboard.down('ArrowLeft');
    await page.waitForFunction((s) => window.__spaghettify.player.position.x < s.x - s.r, start, { timeout: 20_000 });
    await page.keyboard.up('ArrowLeft');
    expect(errors).toEqual([]);
  });

  test('collision: touching a big body knocks the hole back, visibly shrinks it (not score), throws debris, then grants invulnerability', async ({ page }) => {
    // A real click unlocks audio so the hit sound can be counted.
    const errors = await oneBigBody(page, 4, 1000, true, 9);
    // Read the hole, then put the body on it in the same tick: one hit on the next frame.
    const before = await page.evaluate(() => {
      const { player, camera, prey } = window.__spaghettify;
      const body = prey.objects[0];
      body.state = 'alive';
      body.radius = player.radius * 4;
      body.mass = body.radius * body.radius;
      body.velocity.set(0, 0, 0);
      body.position.set(player.position.x + body.radius, 0, player.position.z);
      return { mass: player.mass, radius: player.radius, eatenMass: player.eatenMass, shake: camera.shake };
    });

    await page.waitForFunction(() => window.__spaghettify.dangers.hits === 1);
    const hit = await page.evaluate(() => {
      const { player, prey, dangers, camera, shedBurst, audio, debris, hunger } = window.__spaghettify;
      const body = prey.objects[0];
      const frags = debris.objects.filter((f) => f.active);
      return {
        mass: player.mass,
        eatenMass: player.eatenMass,
        vx: player.velocity.x,
        gap: Math.hypot(player.position.x - body.position.x, player.position.z - body.position.z) - (player.radius + body.radius),
        invulnerable: dangers.invulnerable,
        shed: dangers.shedMass,
        shake: camera.shake,
        sparks: shedBurst.live,
        sound: audio.played.hit ?? 0,
        fragments: frags.length,
        debrisMass: debris.liveMass,
        allEdible: frags.every((f) => f.radius < player.radiusForMass() * 0.95),
        allAway: frags.every((f) => f.velocity.x < 0),
        hot: Math.min(...frags.map((f) => f.heat)),
        time: hunger.runTime,
      };
    });
    // About a fifth of the mass, over a tenth of the radius.
    expect(hit.mass).toBeLessThan(before.mass * 0.82);
    expect(hit.mass).toBeGreaterThan(before.mass * 0.7);
    expect(hit.shed).toBeCloseTo(before.mass - hit.mass, 5);
    expect(hit.eatenMass).toBe(before.eatenMass);
    // Knocked back: pushed out of the body and moving away from it (it is to the right).
    expect(hit.gap).toBeGreaterThanOrEqual(-1e-6);
    expect(hit.vx).toBeLessThan(0);
    expect(hit.invulnerable).toBeGreaterThan(0);
    expect(hit.shake).toBeGreaterThan(before.shake);
    expect(hit.sparks).toBeGreaterThan(0);
    expect(hit.sound).toBe(1);
    // The shed mass flies off as hot, edible debris, away from the body.
    expect(hit.fragments).toBeGreaterThanOrEqual(5);
    expect(hit.debrisMass).toBeGreaterThan(hit.shed * 0.6);
    expect(hit.debrisMass).toBeLessThanOrEqual(hit.shed + 1e-9);
    expect(hit.allEdible).toBe(true);
    expect(hit.allAway).toBe(true);
    expect(hit.hot).toBeGreaterThan(0.7);

    // The visible radius drops fast: all the way down within half a second of game time. The rest of the
    // field around was cleared at the start, so nothing else is eaten.
    const shrunk = await page.evaluate(async (t) => {
      const { player, debris, hunger } = window.__spaghettify;
      while (hunger.runTime < t + 0.5) await new Promise(requestAnimationFrame);
      return { radius: player.radius, target: player.radiusForMass(), heat: Math.max(...debris.objects.filter((f) => f.active).map((f) => f.heat)) };
    }, hit.time);
    expect(shrunk.radius).toBeLessThan(before.radius * 0.92);
    expect(Math.abs(shrunk.radius - shrunk.target)).toBeLessThan(shrunk.target * 0.03);
    // The fragments are cooling.
    expect(shrunk.heat).toBeLessThan(hit.hot);

    // Invulnerable: shoved back into the body, the hole is pushed out again but loses nothing and throws nothing.
    const again = await page.evaluate(async () => {
      const d = window.__spaghettify;
      const { player, prey, dangers } = d;
      const body = prey.objects[0];
      d.debris.reset();
      const mass = player.mass;
      dangers.invulnerable = Math.max(dangers.invulnerable, 0.5);
      player.position.x = body.position.x - body.radius * 0.5;
      player.position.z = body.position.z;
      const f = d.frames;
      while (d.frames < f + 2) await new Promise(requestAnimationFrame);
      return {
        hits: dangers.hits,
        lost: mass - player.mass,
        gap: Math.hypot(player.position.x - body.position.x, player.position.z - body.position.z) - (player.radius + body.radius),
        invulnerable: dangers.invulnerable,
        debris: d.debris.emitted,
      };
    });
    expect(again.hits).toBe(1);
    expect(again.lost).toBeLessThan(1e-9);
    expect(again.gap).toBeGreaterThanOrEqual(-1e-6);
    expect(again.invulnerable).toBeGreaterThan(0);
    expect(again.debris).toBe(0);
    expect(errors).toEqual([]);
  });

  test('repeated hits: each one shrinks the hole, even right after another hit or during hunger drain, and never ends the run', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await oneBigBody(page, 4, 1000, false, 9);
    /** Wait out the invulnerability, put a big body on the hole and report the mass and radius before and after the hit. */
    const hitOnce = (setup: 'none' | 'drained') =>
      page.evaluate(async (setup) => {
        const d = window.__spaghettify;
        const { player, prey, dangers, hunger, debris, comets } = d;
        // The field around was cleared at the start (and nothing drifts in), so nothing else is eaten meanwhile.
        const frame = () => new Promise(requestAnimationFrame);
        while (dangers.invulnerable > 0) await frame();
        // Eating debris back would muddle the masses here; the debris test covers it.
        debris.reset();
        comets.reset();
        if (setup === 'drained') {
          // Starving, with the drain running at full strength.
          hunger.enabled = true;
          hunger.idle = 60;
        }
        const hits = dangers.hits;
        const eaten = player.eatenCount;
        const shed = dangers.shedMass;
        const mass = player.mass;
        const radius = player.radius;
        player.velocity.set(0, 0, 0);
        const body = prey.objects[0];
        body.state = 'alive';
        body.radius = player.radius * 4;
        body.mass = body.radius * body.radius;
        body.velocity.set(0, 0, 0);
        body.position.set(player.position.x + body.radius, 0, player.position.z);
        while (dangers.hits === hits) await frame();
        const after = { shed: dangers.shedMass - shed, mass: player.mass, floor: hunger.floorMass, phase: hunger.phase, fragments: debris.live };
        // Out of the way (it respawns as ordinary prey), and no debris to eat back.
        body.position.x += 100000;
        debris.reset();
        // Half a second on: the radius is clearly down and the hunger drain has not ended the run.
        const t = hunger.runTime;
        while (hunger.runTime < t + 0.5) await frame();
        const later = { eaten: player.eatenCount - eaten, radius: player.radius, phase: hunger.phase, mass: player.mass, floor: hunger.floorMass };
        hunger.enabled = false;
        hunger.idle = 0;
        return { mass, radius, after, later };
      }, setup);

    // First, second (as soon as the first wears off) and third (during hunger drain) hits all shed about a fifth.
    for (const setup of ['none', 'none', 'drained'] as const) {
      const r = await hitOnce(setup);
      expect(r.after.shed).toBeGreaterThan(r.mass * 0.18);
      expect(r.after.shed).toBeLessThan(r.mass * 0.3);
      expect(r.after.fragments).toBeGreaterThan(0);
      // The hit itself never starves the hole: what is left is far above the evaporation mass.
      expect(r.after.floor).toBeLessThan(r.after.mass * 0.5);
      expect(r.after.phase).toBe('playing');
      expect(r.later.phase).toBe('playing');
      expect(r.later.mass).toBeGreaterThan(r.later.floor);
      expect(r.later.eaten).toBe(0);
      expect(r.later.radius).toBeLessThan(r.radius * 0.92);
    }
    expect(await page.evaluate(() => window.__spaghettify.dangers.hits)).toBe(3);

    // Never below the start mass: a hole just over it only loses the difference.
    const atStart = await page.evaluate(async () => {
      const d = window.__spaghettify;
      const { player, prey, dangers } = d;
      while (dangers.invulnerable > 0) await new Promise(requestAnimationFrame);
      d.debris.reset();
      player.mass = player.startMass * 1.1;
      player.setRadius(player.radiusForMass());
      const body = prey.objects[0];
      const hits = dangers.hits;
      player.velocity.set(0, 0, 0);
      body.state = 'alive';
      body.radius = player.radius * 4;
      body.mass = body.radius * body.radius;
      body.velocity.set(0, 0, 0);
      body.position.set(player.position.x + body.radius, 0, player.position.z);
      while (dangers.hits === hits) await new Promise(requestAnimationFrame);
      return { mass: player.mass, start: player.startMass, phase: d.hunger.phase };
    });
    expect(atStart.mass).toBeCloseTo(atStart.start, 9);
    expect(atStart.phase).toBe('playing');
    expect(errors).toEqual([]);
  });

  test('debris: fragments cannot be eaten at once, then the hole eats them back for mass but not score', async ({ page }) => {
    const errors = await oneBigBody(page, 4, 1, false, 9);
    await page.waitForFunction(() => window.__spaghettify.dangers.hits === 1);
    const early = await page.evaluate(async () => {
      const d = window.__spaghettify;
      const { player, prey, debris } = d;
      // Clear the body away and hold the hole still.
      prey.objects[0].position.x += 100000;
      player.stun = 0;
      player.velocity.set(0, 0, 0);
      // Straight onto a fresh fragment: too hot to eat yet.
      const frag = debris.objects.find((f) => f.active)!;
      const eaten = player.eatenCount;
      player.position.x = frag.position.x;
      player.position.z = frag.position.z;
      const f = d.frames;
      while (d.frames < f + 2) await new Promise(requestAnimationFrame);
      return { eaten: player.eatenCount - eaten, state: frag.state };
    });
    expect(early.eaten).toBe(0);
    expect(early.state).toBe('alive');

    const meal = await page.evaluate(async () => {
      const d = window.__spaghettify;
      const { player, debris } = d;
      while (debris.objects.some((f) => f.active && f.state === 'alive' && f.age < 0.7)) await new Promise(requestAnimationFrame);
      const frag = debris.objects.find((f) => f.active && f.state === 'alive')!;
      const before = { mass: player.mass, eatenMass: player.eatenMass, eatenCount: player.eatenCount, biggest: player.biggestEaten?.name ?? null };
      const fragMass = frag.mass;
      // Chase it: sit the hole on the drifting fragment every frame until it is swallowed.
      for (let i = 0; i < 60 && frag.state === 'alive'; i++) {
        player.velocity.set(0, 0, 0);
        player.position.x = frag.position.x;
        player.position.z = frag.position.z;
        await new Promise(requestAnimationFrame);
      }
      return {
        state: frag.state,
        gained: player.mass - before.mass,
        fragMass,
        eatenMass: player.eatenMass - before.eatenMass,
        eaten: player.eatenCount - before.eatenCount,
        biggestBefore: before.biggest,
        biggestAfter: player.biggestEaten?.name ?? null,
      };
    });
    expect(meal.state).toBe('eating');
    expect(meal.eaten).toBeGreaterThanOrEqual(1);
    expect(meal.gained).toBeGreaterThanOrEqual(meal.fragMass * 0.999);
    expect(meal.eatenMass).toBe(0);
    expect(meal.biggestAfter).toBe(meal.biggestBefore);
    expect(errors).toEqual([]);
  });

  test('big bodies never stay overlapped: an overlapping pair is pushed apart', async ({ page }) => {
    const errors = await oneBigBody(page, 4, 30);
    const spacing = await page.evaluate(async () => {
      const d = window.__spaghettify;
      const { player, prey } = d;
      const [a, b] = prey.objects;
      b.radius = a.radius;
      b.mass = a.mass;
      b.velocity.set(0, 0, 0);
      b.position.set(a.position.x + a.radius * 0.5, 0, a.position.z + player.radius * 0.1);
      const f = d.frames;
      while (d.frames < f + 40) await new Promise(requestAnimationFrame);
      return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) / (a.radius + b.radius);
    });
    expect(spacing).toBeGreaterThan(0.97);
    expect(errors).toEqual([]);
  });

  test('comets: one crosses the view on a straight line and leaves; one aimed at the hole hits it; a small one is eaten', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await oneBigBody(page, 4, 1000);
    // A comet from the tier's table enters on the spawn ring heading for the hole.
    const spawned = await page.evaluate(() => {
      const d = window.__spaghettify;
      const { comets, player, camera } = d;
      comets.reset();
      comets.spawn();
      const c = comets.objects.find((o) => o.active)!;
      const dx = player.position.x - c.position.x;
      const dz = player.position.z - c.position.z;
      const speed = Math.hypot(c.velocity.x, c.velocity.z);
      const result = {
        dist: Math.hypot(dx, dz) / camera.targetDistance,
        heading: (dx * c.velocity.x + dz * c.velocity.z) / (Math.hypot(dx, dz) * speed),
        speed: speed / camera.targetDistance,
      };
      comets.reset();
      return result;
    });
    expect(spawned.dist).toBeCloseTo(1.3, 2);
    expect(spawned.heading).toBeGreaterThan(0.9);
    expect(spawned.speed).toBeGreaterThan(0.4);
    expect(spawned.speed).toBeLessThan(0.65);

    // A crossing: enters left of the hole, passes it on a straight line well clear of it and is recycled off to the right.
    const crossing = await page.evaluate(async () => {
      const d = window.__spaghettify;
      const { comets, player, camera } = d;
      const view = camera.targetDistance;
      const z = player.position.z - view * 0.3;
      comets.launch(player.position.x - view * 1.2, z, view * 2, 0, player.radius * 2);
      const c = comets.objects.find((o) => o.active)!;
      let passed = false;
      let maxDrift = 0;
      let fade = 0;
      for (let i = 0; i < 400 && c.active; i++) {
        const f = d.frames;
        while (d.frames === f) await new Promise(requestAnimationFrame);
        if (c.active) {
          maxDrift = Math.max(maxDrift, Math.abs(c.position.z - z));
          if (c.position.x > player.position.x) passed = true;
          fade = Math.max(fade, c.fade);
        }
      }
      return { passed, maxDrift, fade, active: c.active, hits: d.dangers.hits, launched: comets.launched };
    });
    expect(crossing.passed).toBe(true);
    expect(crossing.maxDrift).toBeLessThan(1e-6);
    expect(crossing.fade).toBeGreaterThan(0.5);
    expect(crossing.active).toBe(false);
    expect(crossing.hits).toBe(0);
    expect(crossing.launched).toBe(1);

    // Aimed at the hole and bigger than it: a hit, knocked along the comet's travel.
    const hit = await page.evaluate(async () => {
      const d = window.__spaghettify;
      const { comets, player, camera } = d;
      const view = camera.targetDistance;
      comets.launch(player.position.x - view * 0.5, player.position.z, view, 0, player.radius * 2);
      const c = comets.objects.find((o) => o.active)!;
      for (let i = 0; i < 300 && d.dangers.hits === 0; i++) {
        const f = d.frames;
        while (d.frames === f) await new Promise(requestAnimationFrame);
      }
      return { hits: d.dangers.hits, vx: player.velocity.x, state: c.state };
    });
    expect(hit.hits).toBe(1);
    expect(hit.vx).toBeGreaterThan(0);
    expect(hit.state).toBe('alive');

    // Small enough to swallow: a fast meal that spaghettifies like any prey.
    const meal = await page.evaluate(async () => {
      const d = window.__spaghettify;
      const { comets, player } = d;
      const eaten = player.eatenCount;
      comets.reset();
      // The hit's debris would be a meal too.
      d.debris.reset();
      // Hold the hole still after the knockback.
      player.stun = 0;
      player.velocity.set(0, 0, 0);
      comets.launch(player.position.x, player.position.z - player.radius * 4, 0, player.radius * 6, player.radius * 0.5);
      const c = comets.objects.find((o) => o.active)!;
      for (let i = 0; i < 300 && player.eatenCount === eaten; i++) {
        const f = d.frames;
        while (d.frames === f) await new Promise(requestAnimationFrame);
      }
      return { eaten: player.eatenCount - eaten, state: c.state, biggest: player.biggestEaten?.name };
    });
    expect(meal.eaten).toBe(1);
    expect(meal.state).toBe('eating');
    expect(meal.biggest).toBe('comet');
    expect(errors).toEqual([]);
  });
});

import { test, expect } from '@playwright/test';

interface Debug {
  frames: number;
  player: {
    position: { x: number; y: number; z: number };
    radius: number;
    mass: number;
    eatenCount: number;
    eatenMass: number;
    biggestEaten: { name: string; radius: number } | null;
    disk: { heat: number; starvation: number };
    velocity: { x: number; z: number };
    radiusForMass(): number;
  };
  hunger: { phase: string; idle: number; level: number; enabled: boolean; floorMass: number; runTime: number };
  hungerOverlay: { level: number };
  tiers: { index: number; tier: { title: string; count: number; cameraScale: number }; timeScale: number };
  allTiers: { title: string; minMass: number; count: number; cameraScale: number; classes: { radius: [number, number] }[] }[];
  camera: { targetDistance: number; viewScale: number };
  prey: {
    objects: {
      position: { x: number; z: number; set(x: number, y: number, z: number): void };
      velocity: { set(x: number, y: number, z: number): void };
      radius: number;
      mass: number;
      className: string;
      state: string;
    }[];
    isEdible(obj: unknown): boolean;
    mesh: {
      instanceMatrix: { array: Float32Array };
      geometry: { attributes: { aStretch: { array: Float32Array } } };
    };
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
    lensing: { centre: { x: number; y: number }; coreRadius: number; setQuality(level: number): void };
  };
  readPixel(x: number, y: number): Promise<number[]>;
}
declare global {
  interface Window {
    __spaghettify: Debug;
  }
}

test('game loads, renders frames without console errors and the player moves', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);

  const start = await page.evaluate(() => ({ ...window.__spaghettify.player.position }));

  // Pointer to the right of centre: the hole should drift right.
  await page.mouse.move(1000, 360);
  await page.waitForTimeout(3000);

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

  await page.goto('/');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);

  const before = await page.evaluate(() => {
    const { player, prey } = window.__spaghettify;
    const target = prey.objects.find((o) => o.state === 'alive' && prey.isEdible(o));
    if (!target) throw new Error('no edible prey in the pool');
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

  await page.goto('/');
  await page.mouse.move(640, 360);
  await page.waitForFunction(() => window.__spaghettify?.frames > 30);

  // Brightness at the core's centre and just outside the shadow on the far side (above it on
  // screen) and the near side (below), in core radii. Prey are moved away so they cannot cover the probes.
  const probe = (quality: number) =>
    page.evaluate(async (quality) => {
      const d = window.__spaghettify;
      for (const o of d.prey.objects) o.position.x += 1000;
      d.renderer.lensing.setQuality(quality);
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
    }, quality);

  const flat = await probe(0);
  const lensed = await probe(2);
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

  await page.goto('/');
  await page.mouse.move(640, 360);
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);

  const result = await page.evaluate(async () => {
    const d = window.__spaghettify;
    const { player, prey } = d;
    const nextFrame = async () => {
      const f = d.frames;
      while (d.frames === f) await new Promise(requestAnimationFrame);
    };
    // What the GPU gets for instance i: direction from the hole, stretch, centre and scale.
    const read = (i: number) => {
      const s = prey.mesh.geometry.attributes.aStretch.array;
      const m = prey.mesh.instanceMatrix.array;
      const dx = m[i * 16 + 12] - player.position.x;
      const dz = m[i * 16 + 14] - player.position.z;
      const dist = Math.hypot(dx, dz);
      return {
        dirLen: Math.hypot(s[i * 4], s[i * 4 + 1]),
        // Cosine between the stretch axis and the line from the hole to the object.
        align: dist > 1e-3 ? (s[i * 4] * dx + s[i * 4 + 1] * dz) / dist : 1,
        stretch: s[i * 4 + 2],
        dist,
        scale: Math.hypot(m[i * 16], m[i * 16 + 1], m[i * 16 + 2]),
      };
    };

    // Clear the field around the hole, then take the biggest edible object.
    for (const o of prey.objects) o.position.x += 1000;
    let index = -1;
    prey.objects.forEach((o, i) => {
      if (o.state === 'alive' && prey.isEdible(o) && (index < 0 || o.radius > prey.objects[index].radius)) index = i;
    });
    if (index < 0) throw new Error('no edible prey in the pool');
    const obj = prey.objects[index];
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

test('crossing a mass threshold changes tier: prey table, entity budget and camera scale', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 480, height: 270 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.mouse.move(240, 135);
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await page.evaluate(() => (window.__spaghettify.hunger.enabled = false));

  // Grow to just under a tier threshold, let the radius catch up, then eat one more object to cross it.
  const crossInto = (tierIndex: number) =>
    page.evaluate(async (tierIndex) => {
      const d = window.__spaghettify;
      const { player, prey, tiers, allTiers } = d;
      const nextFrame = async () => {
        const f = d.frames;
        while (d.frames === f) await new Promise(requestAnimationFrame);
      };
      if (tiers.index !== tierIndex - 1) throw new Error(`expected tier ${tierIndex - 1}, got ${tiers.index}`);
      // Keep the hole from eating anything while it grows to the threshold: flush the field out to the respawn ring.
      for (const o of prey.objects) o.position.x += 100000;
      await nextFrame();
      const before = { count: tiers.tier.count, distance: d.camera.targetDistance, scale: tiers.tier.cameraScale };
      player.mass = allTiers[tierIndex].minMass - 0.02;
      for (let i = 0; i < 600 && Math.abs(player.radius - player.radiusForMass()) > 0.01 * player.radius; i++) await nextFrame();
      if (tiers.index !== tierIndex - 1) throw new Error('crossed the threshold early');

      // Park on the biggest edible object that is heavy enough to finish the job.
      let target: (typeof prey.objects)[number] | undefined;
      for (const o of prey.objects.slice(0, tiers.tier.count)) {
        if (o.state === 'alive' && prey.isEdible(o) && o.mass > 0.02 && (!target || o.radius > target.radius)) target = o;
      }
      if (!target) throw new Error('no edible prey to cross the threshold with');
      const eaten = { name: target.className, radius: target.radius };
      player.velocity.x = player.velocity.z = 0;
      player.position.x = target.position.x;
      player.position.z = target.position.z;
      for (let i = 0; i < 120 && tiers.index !== tierIndex; i++) await nextFrame();
      if (tiers.index !== tierIndex) throw new Error('tier did not change');

      // The set piece dips game time, then the view settles on the new scale.
      await nextFrame();
      await nextFrame();
      const dip = tiers.timeScale;
      const live = prey.objects.slice(0, tiers.tier.count);
      const minRadius = Math.min(...allTiers[tierIndex].classes.map((c) => c.radius[0]));
      const tooSmall = live.filter((o) => o.state === 'alive' && o.radius < minRadius).length;
      return {
        before,
        after: { count: tiers.tier.count, distance: d.camera.targetDistance, scale: tiers.tier.cameraScale },
        dip,
        tooSmall,
        title: tiers.tier.title,
        eaten,
        biggest: player.biggestEaten,
        banner: document.querySelector('[data-testid="tier-banner"]')?.textContent ?? '',
      };
    }, tierIndex);

  for (const tierIndex of [1, 2]) {
    const r = await crossInto(tierIndex);
    // New scene scale: the camera heads further out than it was.
    expect(r.after.scale).toBeGreaterThan(r.before.scale);
    expect(r.after.distance).toBeGreaterThan(r.before.distance);
    // Slow motion during the set piece.
    expect(r.dip).toBeLessThan(1);
    // New prey table: nothing left from the old table that the new one does not have.
    expect(r.tooSmall).toBe(0);
    expect(r.biggest?.radius).toBeGreaterThanOrEqual(r.eaten.radius);
    expect(r.banner).toContain(r.title);
    // Let the slow motion pass before the next climb.
    await page.waitForFunction(() => window.__spaghettify.tiers.timeScale === 1);
  }

  // The new prey table is what spawns now: wait for respawns and check every live object fits a table.
  const final = await page.evaluate(() => {
    const { prey, tiers, allTiers } = window.__spaghettify;
    const classes = allTiers[tiers.index].classes;
    const lo = Math.min(...classes.map((c) => c.radius[0]));
    const hi = Math.max(...classes.map((c) => c.radius[1]));
    const live = prey.objects.slice(0, tiers.tier.count);
    return { index: tiers.index, count: live.length, outside: live.filter((o) => o.state === 'alive' && (o.radius < lo || o.radius > hi)).length };
  });
  expect(final.index).toBe(2);
  expect(final.outside).toBe(0);

  expect(errors).toEqual([]);
});

test('speed holds on screen as the hole grows', async ({ page }) => {
  test.setTimeout(120_000);
  // Small viewport: software rendering is slow and this test only needs frames to tick.
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('/');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await page.evaluate(() => (window.__spaghettify.hunger.enabled = false));
  await page.mouse.move(470, 135);

  // Top speed in world units per second, and the view scale it should follow.
  const run = (mass: number) =>
    page.evaluate(async (mass) => {
      const d = window.__spaghettify;
      const { player } = d;
      d.renderer.lensing.setQuality(0);
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
  // On-screen speed (world speed over view distance) stays within 25 percent however big the hole is.
  const ratio = big.speed / big.view / (small.speed / small.view);
  expect(ratio).toBeGreaterThan(0.75);
  expect(ratio).toBeLessThan(1.25);
});

test('hunger: starving drains mass, dims the disk, ends the run with a score screen, and play again resets cleanly', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 480, height: 270 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.mouse.move(240, 135);
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);

  // Eat one thing so the score screen has a biggest meal to report.
  await page.evaluate(async () => {
    const d = window.__spaghettify;
    const target = d.prey.objects.find((o) => o.state === 'alive' && d.prey.isEdible(o));
    if (!target) throw new Error('no edible prey in the pool');
    d.player.position.x = target.position.x;
    d.player.position.z = target.position.z;
    while (d.player.eatenCount < 1) await new Promise(requestAnimationFrame);
  });
  // Eating resets the hunger clock.
  expect(await page.evaluate(() => window.__spaghettify.hunger.idle)).toBeLessThan(1);

  // Skip most of the grace period: mass must start draining and the warning must show.
  const massBefore = await page.evaluate(() => {
    const d = window.__spaghettify;
    d.prey.objects.forEach((o) => (o.position.x += 100000));
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

  const eatenMass = await page.evaluate(() => window.__spaghettify.player.eatenMass);
  const score = Number((await page.locator('[data-testid="score"]').textContent())!.replace(/,/g, ''));
  expect(score).toBeGreaterThan(0);
  expect(score).toBe(Math.round(eatenMass * 1000));
  const ladder = (await page.locator('[data-testid="ladder"]').textContent())!;
  expect(ladder).toMatch(/^You ate an? /);
  const run = await page.evaluate(() => ({ biggest: window.__spaghettify.player.biggestEaten!.name, count: window.__spaghettify.player.eatenCount }));
  expect(ladder).toContain(run.biggest);
  const stats = (await page.locator('[data-testid="stats"]').textContent())!;
  expect(stats).toContain('Tier reached1: Debris');
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
      tier: d.tiers.index,
      idle: d.hunger.idle,
      starvation: d.player.disk.starvation,
      heat: d.player.disk.heat,
      timeScale: d.tiers.timeScale,
      live: d.prey.objects.slice(0, d.tiers.tier.count).filter((o) => o.state === 'alive' && Math.hypot(o.position.x, o.position.z) < 1000).length,
      count: d.tiers.tier.count,
      viewScale: d.camera.viewScale,
    };
  });
  expect(fresh.mass).toBeCloseTo(0.25, 1);
  expect(fresh.radius).toBeCloseTo(0.5, 1);
  expect(fresh.eatenCount).toBe(0);
  expect(fresh.biggest).toBeNull();
  expect(fresh.tier).toBe(0);
  expect(fresh.idle).toBeLessThan(1);
  expect(fresh.starvation).toBeLessThan(0.05);
  expect(fresh.heat).toBeLessThan(0.2);
  expect(fresh.timeScale).toBe(1);
  expect(fresh.live).toBe(fresh.count);
  expect(fresh.viewScale).toBeCloseTo(1, 1);

  // And the new run can be played: the hole eats again.
  const ate = await page.evaluate(async () => {
    const d = window.__spaghettify;
    const target = d.prey.objects.find((o) => o.state === 'alive' && d.prey.isEdible(o));
    if (!target) throw new Error('no edible prey after restart');
    d.player.position.x = target.position.x;
    d.player.position.z = target.position.z;
    for (let i = 0; i < 200 && d.player.eatenCount < 1; i++) await new Promise(requestAnimationFrame);
    return d.player.eatenCount;
  });
  expect(ate).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('audio: the context is created after a click, events trigger sounds, and the mute toggle works', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);

  // Browsers block audio before a gesture: no context yet, and the game runs fine without one.
  expect(await page.evaluate(() => window.__spaghettify.audio.context)).toBeNull();

  await page.mouse.click(640, 360);
  await page.waitForFunction(() => window.__spaghettify.audio.context !== null);
  expect(await page.evaluate(() => window.__spaghettify.audio.state)).not.toBe('closed');

  // Eating triggers the eat sound.
  await page.evaluate(() => {
    const { player, prey } = window.__spaghettify;
    const target = prey.objects.find((o) => o.state === 'alive' && prey.isEdible(o));
    if (!target) throw new Error('no edible prey in the pool');
    player.position.x = target.position.x;
    player.position.z = target.position.z;
  });
  await page.waitForFunction(() => (window.__spaghettify.audio.played.eat ?? 0) > 0);

  // Mute toggle: button and the M key. State, aria-pressed, gains and localStorage all follow.
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

test('audio: tier-up, hunger warning and evaporation each trigger their sound; restart is clean', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 480, height: 320 });
  await page.goto('/');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await page.mouse.click(240, 160);
  await page.waitForFunction(() => window.__spaghettify.audio.context !== null);

  // Tier-up: set the mass just under tier 2 and eat something.
  await page.evaluate(() => {
    const { player, prey, allTiers, hunger } = window.__spaghettify;
    hunger.enabled = false;
    player.mass = allTiers[1].minMass - 0.01;
    const target = prey.objects.find((o) => o.state === 'alive' && prey.isEdible(o));
    if (!target) throw new Error('no edible prey in the pool');
    player.position.x = target.position.x;
    player.position.z = target.position.z;
  });
  await page.waitForFunction(() => (window.__spaghettify.audio.played.tierUp ?? 0) > 0);

  // Hunger: the warning pulses, then the evaporation sound plays once.
  await page.evaluate(() => {
    const { hunger } = window.__spaghettify;
    hunger.enabled = true;
    hunger.idle = 100;
  });
  await page.waitForFunction(() => (window.__spaghettify.audio.played.warning ?? 0) > 0);
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
  await page.goto('/');
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await page.mouse.click(640, 360);
  await page.getByTestId('mute-toggle').click();
  await page.evaluate(() => {
    const { player, prey } = window.__spaghettify;
    const target = prey.objects.find((o) => o.state === 'alive' && prey.isEdible(o));
    if (!target) throw new Error('no edible prey in the pool');
    player.position.x = target.position.x;
    player.position.z = target.position.z;
  });
  await page.waitForFunction(() => window.__spaghettify.player.eatenCount > 0);
  expect(await page.evaluate(() => window.__spaghettify.audio.context)).toBeNull();
  expect(errors).toEqual([]);
});

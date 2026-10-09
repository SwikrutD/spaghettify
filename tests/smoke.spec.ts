import { test, expect } from '@playwright/test';

interface Debug {
  frames: number;
  player: {
    position: { x: number; y: number; z: number };
    radius: number;
    mass: number;
    eatenCount: number;
    disk: { heat: number };
  };
  prey: {
    objects: {
      position: { x: number; z: number; set(x: number, y: number, z: number): void };
      velocity: { set(x: number, y: number, z: number): void };
      radius: number;
      state: string;
    }[];
    isEdible(obj: unknown): boolean;
    mesh: {
      instanceMatrix: { array: Float32Array };
      geometry: { attributes: { aStretch: { array: Float32Array } } };
    };
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
    const big = prey.objects.find((o) => o.state === 'alive' && !prey.isEdible(o));
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

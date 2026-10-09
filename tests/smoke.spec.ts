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
    objects: { position: { x: number; z: number }; radius: number; state: string }[];
    isEdible(obj: unknown): boolean;
  };
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

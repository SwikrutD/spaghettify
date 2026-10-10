import { test, expect, type Page } from '@playwright/test';

/** What the tests read of a sim hole through the debug handle. */
interface HoleProbe {
  id: number;
  name: string;
  radius: number;
  mass: number;
  startMass: number;
  phase: string;
  protection: number;
  gen: number;
  hits: number;
  holesEaten: number;
  eatenBy: number;
  eatenByName: string;
  eatProgress: number;
  position: { x: number; z: number };
  bot: { mode: string } | null;
  biggestEaten: { name: string; radius: number; hole?: boolean } | null;
  hunger: { enabled: boolean };
  radiusForMass(): number;
}

interface Debug {
  frames: number;
  world: { holes: HoleProbe[]; focus: HoleProbe; time: number; botTarget: number };
  bots: HoleProbe[];
  holes: {
    drawn: unknown[];
    lensExtras: unknown[];
    local: { group: { scale: { x: number; y: number; z: number } } };
  };
  player: HoleProbe & { setRadius(r: number): void };
  hunger: { phase: string; enabled: boolean };
  dangers: { enabled: boolean };
}
declare global {
  interface Window {
    __spaghettify: Debug;
  }
}

// Same defaults as smoke.spec.ts: the High preset (SwiftShader is far too slow for the auto scaler) and no real
// leaderboard server.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      if (!localStorage.getItem('spaghettify.settings')) localStorage.setItem('spaghettify.settings', JSON.stringify({ quality: 'high' }));
    } catch {
      // Storage blocked.
    }
  });
  await page.route('**/api/**', (route) => {
    const post = route.request().method() === 'POST';
    const url = route.request().url();
    const body = post ? { nickname: 'x', rank: 1, total: 1, best: 0, personalBest: true } : url.includes('/rank') ? { rank: 1, total: 1 } : { entries: [], total: 0 };
    return route.fulfill({ status: post ? 201 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
});

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

/** Open the game on a seeded arena with `bots` bots and press Play. */
async function enterArena(page: Page, bots: number, seed: number): Promise<void> {
  await page.goto(`/?bots=${bots}&seed=${seed}`);
  await page.waitForFunction(() => window.__spaghettify?.frames > 5);
  await page.getByTestId('play').dispatchEvent('click');
  await page.waitForFunction(() => window.__spaghettify.frames > 8);
}

test('bots fill the arena with named holes, the live board lists the biggest and names show over the holes in view', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 640, height: 360 });
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.setItem('spaghettify.nickname', 'Pea'));
  await enterArena(page, 11, 21);
  const info = await page.evaluate(() => {
    const d = window.__spaghettify;
    const bots = d.bots;
    return { count: bots.length, names: new Set(bots.map((b) => b.name)).size, holes: d.world.holes.length, local: d.player.name, botsPlaying: bots.filter((b) => b.phase === 'playing').length };
  });
  expect(info).toMatchObject({ count: 11, names: 11, holes: 12, botsPlaying: 11, local: 'Pea' });

  // Stand the local hole next to a mid-size bot (calm, so nothing interferes) and give it a few frames to draw.
  const near = await page.evaluate(async () => {
    const d = window.__spaghettify;
    const local = d.world.focus;
    d.hunger.enabled = false;
    d.dangers.enabled = false;
    local.protection = 1e6;
    const sorted = [...d.bots].sort((a, b) => a.radius - b.radius);
    const bot = sorted[Math.floor(sorted.length / 2)];
    bot.protection = 1e6;
    d.player.mass = bot.mass * 3;
    d.player.setRadius(local.radiusForMass());
    local.position.x = bot.position.x + local.radius * 6;
    local.position.z = bot.position.z + local.radius * 4;
    for (let i = 0; i < 40; i++) await new Promise(requestAnimationFrame);
    const tags = [...document.querySelectorAll<HTMLElement>('[data-testid="name-tag"]')].filter((t) => t.style.display !== 'none').map((t) => t.textContent);
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="hud-row"]')].map((r) => ({ text: r.textContent ?? '', bold: r.style.fontWeight === '700' }));
    return { bot: bot.name, tags, rows, drawn: d.holes.drawn.length };
  });
  // Both holes carry their nicknames; the board lists at least the top ten with the local player lit.
  expect(near.tags).toContain('Pea');
  expect(near.tags).toContain(near.bot);
  expect(near.drawn).toBeGreaterThanOrEqual(2);
  expect(near.rows.length).toBeGreaterThanOrEqual(10);
  expect(near.rows.some((r) => r.bold && r.text.includes('Pea'))).toBe(true);
  expect(near.rows.some((r) => r.text.includes(near.bot as string))).toBe(true);
  expect(errors).toEqual([]);
});

test('a bigger hole swallows the player: spaghettified into it, "Eaten by <name>" on the score screen, only the player posts, play again respawns in the running arena', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 480, height: 270 });
  const errors = collectErrors(page);
  const posted: Record<string, unknown>[] = [];
  await page.route('**/api/scores', (route) => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ nickname: 'Pea', rank: 1, total: 1, best: 0, personalBest: true }) });
  });
  await page.addInitScript(() => localStorage.setItem('spaghettify.nickname', 'Pea'));
  await enterArena(page, 4, 33);

  const setup = await page.evaluate(() => {
    const d = window.__spaghettify;
    const local = d.world.focus;
    d.hunger.enabled = false;
    const bots = d.bots;
    const eater = bots[0];
    for (const b of bots) b.protection = 0;
    local.protection = 0;
    // A hole far bigger than the player, right on top of it.
    eater.mass = 2000;
    eater.radius = eater.radiusForMass();
    eater.position.x = local.position.x + local.radius * 0.4;
    eater.position.z = local.position.z;
    return { eater: eater.name, botsBefore: bots.length, died: { x: local.position.x, z: local.position.z }, gen: local.gen, time: d.world.time };
  });

  // It spaghettifies on the way in: stretched along the line to the eater while the infall runs.
  const stretched = await page.evaluate(async () => {
    const d = window.__spaghettify;
    let best = 1;
    for (let i = 0; i < 400 && d.hunger.phase !== 'over'; i++) {
      await new Promise(requestAnimationFrame);
      const s = d.holes.local.group.scale;
      if (d.hunger.phase === 'eaten') best = Math.max(best, s.x / s.y);
    }
    return best;
  });
  expect(stretched).toBeGreaterThan(1.5);

  // The score screen names the eater; the life's score is the player's own and is the only thing posted.
  await expect(page.getByTestId('score-screen')).toBeVisible();
  await expect(page.getByTestId('cause')).toContainText(`Eaten by ${setup.eater}`);
  await expect(page.getByTestId('ladder')).toContainText('You ate');
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ nickname: 'Pea' });
  const dead = await page.evaluate(() => {
    const local = window.__spaghettify.world.focus;
    return { phase: local.phase, eatenBy: local.eatenByName, bots: window.__spaghettify.bots.length };
  });
  expect(dead).toMatchObject({ phase: 'over', eatenBy: setup.eater, bots: setup.botsBefore });

  // Play again drops the hole back into the arena as it is running: a fresh pea somewhere else, protected for a
  // moment, the same bots, the clock not reset.
  await page.getByTestId('play-again').click();
  await expect(page.getByTestId('score-screen')).toBeHidden();
  await page.waitForFunction(() => window.__spaghettify.hunger.phase === 'playing');
  const back = await page.evaluate(async () => {
    const d = window.__spaghettify;
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    const local = d.world.focus;
    return {
      mass: local.mass,
      gen: local.gen,
      protection: local.protection,
      x: local.position.x,
      z: local.position.z,
      time: d.world.time,
      holes: d.world.holes.length,
      name: local.name,
    };
  });
  expect(back.mass).toBeCloseTo(0.25, 1);
  expect(back.gen).toBe(setup.gen + 1);
  expect(back.protection).toBeGreaterThan(0);
  expect(Math.hypot(back.x - setup.died.x, back.z - setup.died.z)).toBeGreaterThan(30);
  expect(back.time).toBeGreaterThan(setup.time);
  expect(back.holes).toBe(5);
  expect(back.name).toBe('Pea');
  expect(errors).toEqual([]);
});

test('the player swallows a smaller hole: its mass transfers on the hole curve, the feed says so and the score screen counts it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 480, height: 270 });
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.setItem('spaghettify.nickname', 'Pea'));
  await enterArena(page, 3, 44);
  const before = await page.evaluate(() => {
    const d = window.__spaghettify;
    const local = d.world.focus;
    d.hunger.enabled = false;
    d.dangers.enabled = false;
    for (const b of d.bots) b.protection = 0;
    local.protection = 0;
    const prey = d.bots[0];
    prey.hunger.enabled = false;
    // The prey holds still (no brain); the others (every bot left: the prey is no longer one) are far away, and
    // nothing else is near to eat. The player is clearly bigger and covers its centre.
    prey.bot = null;
    for (const b of d.bots) {
      b.position.x = 5000;
      b.position.z = 5000;
    }
    d.player.mass = 400;
    d.player.setRadius(local.radiusForMass());
    d.prey.clear();
    prey.mass = 100;
    prey.radius = prey.radiusForMass();
    prey.position.x = local.position.x + local.radius * 0.4;
    prey.position.z = local.position.z;
    return { prey: prey.name, preyMass: prey.mass, mass: local.mass };
  });
  await page.waitForFunction(() => window.__spaghettify.world.focus.holesEaten === 1);
  const after = await page.evaluate(() => {
    const d = window.__spaghettify;
    const local = d.world.focus;
    return {
      mass: local.mass,
      meal: local.biggestEaten,
      victimPhase: d.world.holes.find((h) => h.eatenBy === local.id)?.phase ?? '',
      feed: document.querySelector('[data-testid="hud-feed"]')?.textContent ?? '',
    };
  });
  // Most of its mass came across (on the hole curve: not its radius squared), and it is the ladder's biggest meal.
  // (A little more than that is the small matter it ate on the way.)
  expect(after.mass).toBeGreaterThanOrEqual(before.mass + before.preyMass * 0.8 - 1e-6);
  expect(after.mass).toBeLessThan(before.mass + before.preyMass * 0.8 + 20);
  expect(after.meal).toMatchObject({ name: before.prey, hole: true });
  expect(['eaten', 'over']).toContain(after.victimPhase);
  expect(after.feed).toContain(`Pea ate ${before.prey}`);

  // End the life by hand to see it on the score screen: it counts, and the ladder names the hole.
  await page.evaluate(() => {
    const d = window.__spaghettify;
    d.hunger.enabled = true;
    d.player.mass = 0.13;
    d.player.setRadius(d.world.focus.radiusForMass());
  });
  await expect(page.getByTestId('score-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('cause')).toContainText('EVAPORATED');
  await expect(page.getByTestId('stats')).toContainText('Holes eaten1');
  await expect(page.getByTestId('ladder')).toHaveText(`You ate ${before.prey}`);
  expect(errors).toEqual([]);
});

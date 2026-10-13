import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type AddressInfo } from 'node:net';
import { constants, setPriority } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/src/app.ts';
import type { ArenaOptions } from '../server/src/arena/Rooms.ts';
import { PROTOCOL_VERSION, rulesHash } from '../src/protocol/messages.ts';
import { holeMassForRadius } from '../src/sim/Hole.ts';

/** What the tests read through the debug handle. */
interface HoleProbe {
  id: number;
  gen: number;
  name: string;
  radius: number;
  phase: string;
  position: { x: number; z: number };
}
interface Debug {
  frames: number;
  mode: string;
  world: { holes: HoleProbe[] };
  bots: HoleProbe[];
  player: HoleProbe;
  net: {
    state: string;
    note: string;
    lastEnd: string | null;
    rtt: number | null;
    offlineWorld: unknown;
    arena: { local: HoleProbe; world: { holes: HoleProbe[] }; prediction: { lead: number | null; snaps: number } } | null;
  };
}
declare global {
  interface Window {
    __spaghettify: Debug;
  }
}

/**
 * The server runs in this test worker. SwiftShader's threads (in every worker's browser) can starve a normal priority
 * process for seconds on Windows, which freezes the server's rooms: this worker runs above them. Called once the
 * browser runs, so the browser (and the other workers) keep their own priority.
 */
function raisePriority(): void {
  try {
    setPriority(constants.priority.PRIORITY_HIGH);
  } catch {
    // Not allowed here: the tests run at normal priority.
  }
}

// The game joins the test's own server through `?server=` (honoured by the dev build only), so these need the Vite
// dev server, not a production container.
test.skip(!!process.env.BASE_URL, 'the ?server= override is dev only');

/** The real game server (leaderboard and online arena) on a free port, in this process: the test can reach into its rooms. */
async function startServer(arena: Partial<ArenaOptions>): Promise<{ app: FastifyInstance; port: number }> {
  const app = await buildApp({ dbPath: ':memory:', submitPerMinute: 1000, requestsPerMinute: 10000, arena });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, port: (app.server.address() as AddressInfo).port };
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

interface Client {
  page: Page;
  errors: string[];
  /** Score submissions the page made (an online life must never be posted by the game). */
  posts: string[];
}

/** Browser contexts a test opened (closed after it: their pages keep rendering otherwise). */
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

/**
 * A player in a browser of their own (a context: its own storage) with a nickname, on the title screen. The page's
 * /api goes to `app` (players online, the leaderboard), or answers 503 without one.
 */
async function openClient(browser: Browser, url: string, nickname: string, app: FastifyInstance | null): Promise<Client> {
  const context = await browser.newContext({ viewport: { width: 480, height: 270 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.addInitScript((nick) => {
    // The Low preset (no lens or bloom: these tests are about the connection, and SwiftShader is slow enough with
    // two pages) and the nickname.
    if (!localStorage.getItem('spaghettify.settings')) localStorage.setItem('spaghettify.settings', JSON.stringify({ quality: 'low' }));
    localStorage.setItem('spaghettify.nickname', nick);
  }, nickname);
  const posts: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (request.method() === 'POST') posts.push(target.pathname);
    const down = () => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' });
    if (!app) return down();
    try {
      const res = await app.inject({ method: request.method() as 'GET' | 'POST', url: target.pathname + target.search, payload: request.postData() ?? undefined, headers: { 'content-type': 'application/json' } });
      return route.fulfill({ status: res.statusCode, contentType: 'application/json', body: res.body });
    } catch {
      // The server was closed (the test took it down).
      return down();
    }
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The browser reports a refused WebSocket connection and a failed /api request itself; the game copes with both.
    if (m.text().startsWith('WebSocket connection to')) return;
    if (m.text().startsWith('Failed to load resource') && m.location().url.includes('/api/')) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__spaghettify?.frames > 3);
  return { page, errors, posts };
}

/** Press Play and wait until the game plays in the online room. */
async function joinRoom(page: Page): Promise<number> {
  await page.getByTestId('play').dispatchEvent('click');
  // Playing, online or (if the join failed) offline with a note saying why.
  await page.waitForFunction(() => window.__spaghettify.mode === 'playing' && window.__spaghettify.net.state !== 'joining', undefined, { timeout: 40_000 });
  const joined = await page.evaluate(() => ({ state: window.__spaghettify.net.state, note: window.__spaghettify.net.note, lastEnd: window.__spaghettify.net.lastEnd }));
  expect(joined.state, JSON.stringify(joined)).toBe('online');
  return page.evaluate(() => window.__spaghettify.net.arena!.local.id);
}

/** Names over the holes on screen. */
function tags(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="name-tag"]')].filter((t) => t.style.display !== 'none').map((t) => t.textContent ?? ''));
}

test('online: two players in one room see each other, one eats the other (the server scores and posts that life), play again, and when the server goes down the other carries on offline', async ({ browser }) => {
  test.setTimeout(180_000);
  raisePriority();
  const { app, port } = await startServer({ population: 0 });
  let closed = false;
  try {
    const url = `/?server=ws://127.0.0.1:${port}/ws`;
    const a = await openClient(browser, url, 'Alpha', app);
    const b = await openClient(browser, url, 'Beta', app);
    // (Refreshed every 10 s: a first answer lost to a busy test machine comes with the next.)
    await expect(a.page.getByTestId('title-online')).toHaveText('0 PLAYERS ONLINE', { timeout: 15_000 });
    const ida = await joinRoom(a.page);
    const idb = await joinRoom(b.page);
    expect(app.arena.rooms).toHaveLength(1);
    expect(app.arena.players).toBe(2);
    await expect(a.page.getByTestId('net-status')).toContainText('ONLINE');
    // The status line gets the players in the room from the live board and the round trip from the pings.
    await expect(a.page.getByTestId('net-status')).toContainText(/2 PLAYERS · \d+ MS/, { timeout: 10_000 });

    // They spawned out of each other's sight: bring Beta near Alpha on the server, Alpha well bigger.
    const room = app.arena.rooms[0];
    const ha = room.world.hole(ida)!;
    const hb = room.world.hole(idb)!;
    ha.hunger.enabled = hb.hunger.enabled = false;
    ha.mass = ha.peakMass = holeMassForRadius(6);
    hb.mass = hb.peakMass = holeMassForRadius(1.5);
    ha.protection = hb.protection = 0;
    hb.position.x = ha.position.x + 14;
    hb.position.z = ha.position.z;
    // Each sees the other, by name, and the board lists both.
    await expect.poll(() => tags(a.page), { timeout: 20_000 }).toContain('Beta');
    await expect.poll(() => tags(b.page), { timeout: 20_000 }).toContain('Alpha');
    await expect(a.page.getByTestId('hud-board')).toContainText('Beta');
    await expect(a.page.getByTestId('hud-board')).toContainText('Alpha');
    const seen = await a.page.evaluate((id) => window.__spaghettify.net.arena!.world.holes.find((h) => h.id === id)?.position.x ?? null, idb);
    expect(seen! - ha.position.x).toBeGreaterThan(8);

    // Alpha swallows Beta: Beta's score screen names Alpha while Alpha's feed says so (a feed line lasts a few seconds).
    hb.position.x = ha.position.x + 1;
    await Promise.all([
      expect(b.page.getByTestId('score-screen')).toBeVisible({ timeout: 20_000 }),
      expect(a.page.getByTestId('hud-feed')).toContainText('Alpha ate Beta', { timeout: 20_000 }),
    ]);
    await expect(b.page.getByTestId('cause')).toContainText('Eaten by Alpha');
    await expect(b.page.getByTestId('stats')).toContainText('ArenaOnline');
    expect(await a.page.evaluate(() => (window.__spaghettify.net.arena!.local as unknown as { holesEaten: number }).holesEaten)).toBe(1);
    // The server scored the life and posted it under Beta's nickname; the score screen shows its rank. Neither game
    // posted anything itself.
    await expect(b.page.getByTestId('board-status')).toHaveText(/You are #1 of 1\./);
    const top = (await app.inject({ method: 'GET', url: '/api/scores/top' })).json() as { entries: { nickname: string }[] };
    expect(top.entries.map((e) => e.nickname)).toEqual(['Beta']);
    expect(a.posts).toEqual([]);
    expect(b.posts).toEqual([]);

    // Play again: a new life in the same room (still online after the life ended).
    const still = await b.page.evaluate(() => ({ state: window.__spaghettify.net.state, lastEnd: window.__spaghettify.net.lastEnd }));
    expect(still).toEqual({ state: 'online', lastEnd: null });
    const gen = await b.page.evaluate(() => window.__spaghettify.net.arena!.local.gen);
    await b.page.getByTestId('play-again').click();
    await expect(b.page.getByTestId('score-screen')).toBeHidden();
    await b.page.waitForFunction((g) => {
      const local = window.__spaghettify.net.arena?.local;
      return local !== undefined && local.gen === g + 1 && local.phase === 'playing';
    }, gen);
    expect(room.world.hole(idb)!.phase).toBe('playing');

    // The server goes down: Alpha's life carries on in the offline arena, at its size, and the game says so.
    const radius = await a.page.evaluate(() => window.__spaghettify.net.arena!.local.radius);
    await app.close();
    closed = true;
    await a.page.waitForFunction(() => window.__spaghettify.net.state === 'offline', undefined, { timeout: 20_000 });
    const after = await a.page.evaluate(() => {
      const d = window.__spaghettify;
      return { offline: d.world === d.net.offlineWorld, radius: d.player.radius, phase: d.player.phase, mode: d.mode, name: d.player.name, note: d.net.note };
    });
    expect(after).toMatchObject({ offline: true, phase: 'playing', mode: 'playing', name: 'Alpha' });
    expect(after.radius).toBeCloseTo(radius, 0);
    expect(after.note).toContain('offline arena');
    await expect(a.page.getByTestId('net-status')).toHaveText('OFFLINE ARENA');
    const frames = await a.page.evaluate(() => window.__spaghettify.frames);
    await a.page.waitForFunction((f) => window.__spaghettify.frames > f + 10, frames);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  } finally {
    if (!closed) await app.close();
  }
});

test('online: Play falls back to the offline arena when the server is unreachable or full, and says so', async ({ browser }) => {
  test.setTimeout(120_000);
  raisePriority();
  // Nothing listening: the bots' arena, with a note.
  const down = await openClient(browser, `/?server=ws://127.0.0.1:${await closedPort()}/ws`, 'Pea', null);
  await expect(down.page.getByTestId('title-online')).toHaveText('SERVER UNREACHABLE: OFFLINE ARENA');
  await down.page.getByTestId('play').dispatchEvent('click');
  await down.page.waitForFunction(() => window.__spaghettify.mode === 'playing', undefined, { timeout: 20_000 });
  const offline = await down.page.evaluate(() => {
    const d = window.__spaghettify;
    return { state: d.net.state, offline: d.world === d.net.offlineWorld, bots: d.bots.length, note: d.net.note, name: d.player.name };
  });
  expect(offline).toMatchObject({ state: 'offline', offline: true, bots: 11, name: 'Pea' });
  expect(offline.note).toContain('Could not reach the server');
  await expect(down.page.getByTestId('net-status')).toHaveText('OFFLINE ARENA');
  // It plays: the hole follows the pointer.
  const x0 = await down.page.evaluate(() => window.__spaghettify.player.position.x);
  await down.page.mouse.move(470, 135);
  await down.page.waitForFunction((x) => window.__spaghettify.player.position.x > x + 0.5, x0, { timeout: 20_000 });
  expect(down.errors).toEqual([]);
  await down.page.context().close();

  // A server whose only room is taken: told it is full, the game plays offline.
  const { app, port } = await startServer({ population: 0, maxPlayers: 1, maxRooms: 1 });
  try {
    const taken = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve) => taken.addEventListener('open', resolve));
    const welcomed = new Promise((resolve) => taken.addEventListener('message', resolve));
    taken.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, rules: rulesHash(), name: 'First' }));
    await welcomed;
    const full = await openClient(browser, `/?server=ws://127.0.0.1:${port}/ws`, 'Pea', app);
    await expect(full.page.getByTestId('title-online')).toHaveText('1 PLAYER ONLINE', { timeout: 15_000 });
    await full.page.getByTestId('play').dispatchEvent('click');
    await full.page.waitForFunction(() => window.__spaghettify.mode === 'playing', undefined, { timeout: 20_000 });
    const note = await full.page.evaluate(() => ({ note: window.__spaghettify.net.note, state: window.__spaghettify.net.state }));
    expect(note.state).toBe('offline');
    expect(note.note).toContain('full');
    expect(full.errors).toEqual([]);
    taken.close();
  } finally {
    await app.close();
  }
});

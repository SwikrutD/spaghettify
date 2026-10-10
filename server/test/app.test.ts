import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, type AppOptions } from '../src/app.ts';
import { MILESTONES } from '../../src/config/index.ts';
import { checkRun, cleanNickname, isProfane, maxScore, minScore, type RunSubmission } from '../../src/leaderboard/rules.ts';

const run = (over: Partial<RunSubmission> = {}): RunSubmission => ({ nickname: 'Pea', score: 1200, tier: 1, seconds: 40, eaten: 30, ...over });

async function app(options: Partial<AppOptions> = {}) {
  return buildApp({ dbPath: ':memory:', submitPerMinute: 1000, requestsPerMinute: 10000, ...options });
}

describe('rules', () => {
  test('cleanNickname keeps letters, digits and separators, trims and caps at 16', () => {
    assert.equal(cleanNickname('  Event<b>  Horizon!! '), 'Eventb Horizon');
    assert.equal(cleanNickname('a'.repeat(40)).length, 16);
    assert.equal(cleanNickname('Ünïcode_ok-1.2'), 'Ünïcode_ok-1.2');
  });

  test('profanity filter catches disguised words and spares ordinary ones', () => {
    for (const bad of ['fuck', 'FuuUck', 'f.u.c.k', 'sh1t', 'b!tch', 'Big Ass', 'ass', 'n1gg3r', 'Hitler88']) assert.ok(isProfane(bad), bad);
    for (const ok of ['Pea', 'Class Act', 'Scunthorpe', 'Peacock', 'grape', 'Torpedo', 'Cassini', 'Shiitake', 'Hancock', 'Spicy', 'Assassin']) {
      assert.ok(!isProfane(ok), ok);
    }
  });

  test('caps follow the milestone ladder and the run time', () => {
    assert.equal(minScore(1), 0);
    // Each milestone needs more peak mass than the one before.
    for (let m = 2; m <= MILESTONES.length; m++) assert.ok(minScore(m) > minScore(m - 1));
    // Rock eater: a hole that can swallow the largest rock (radius 0.85 / 0.95), from the start mass 0.25.
    assert.ok(minScore(2) > 700 && minScore(2) < 1000);
    assert.ok(maxScore(10) > maxScore(5));
    // A few seconds cannot hold an asteroid eater's mass; long lives hit the arena-wide cap.
    assert.ok(maxScore(3) < minScore(4));
    assert.equal(maxScore(3600), maxScore(600));
  });

  test('checkRun accepts a plausible run and rejects edited ones', () => {
    assert.deepEqual(checkRun(run({ nickname: '  Pea  ' })), { ok: true, run: run() });
    assert.equal(checkRun(null).ok, false);
    const reason = (r: unknown) => {
      const c = checkRun(r);
      return c.ok ? 'ok' : c.reason;
    };
    assert.equal(reason({ ...run(), score: -1 }), 'invalid');
    assert.equal(reason({ ...run(), score: 1.5 }), 'invalid');
    assert.equal(reason({ ...run(), tier: MILESTONES.length + 1 }), 'invalid');
    assert.equal(reason({ ...run(), tier: 0 }), 'invalid');
    assert.equal(reason({ ...run(), tier: '1' }), 'invalid');
    assert.equal(reason({ ...run(), seconds: Number.NaN }), 'invalid');
    assert.equal(reason({ ...run(), nickname: 'x'.repeat(65) }), 'invalid');
    assert.equal(reason(run({ nickname: '!!!' })), 'nickname');
    assert.equal(reason(run({ nickname: 'shithead' })), 'nickname');
    assert.equal(reason(run({ seconds: 1 })), 'implausible');
    assert.equal(reason(run({ score: maxScore(40) + 1 })), 'implausible');
    assert.equal(reason(run({ seconds: 4, score: 10_000 })), 'implausible');
    assert.equal(reason(run({ eaten: 5000 })), 'implausible');
    // Claims milestone 3 without the mass it takes to get there.
    assert.equal(reason(run({ tier: 3, score: 5000 })), 'implausible');
    assert.equal(reason(run({ tier: 3, score: minScore(3) + 1000, seconds: 200, eaten: 400 })), 'ok');
  });
});

describe('api', () => {
  test('submit stores a run and returns the rank by best run', async () => {
    const a = await app();
    const post = (body: unknown) => a.inject({ method: 'POST', url: '/api/scores', payload: body as object });
    let res = await post(run({ nickname: 'Alpha', score: 3000 }));
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.json(), { nickname: 'Alpha', rank: 1, total: 1, best: 3000, personalBest: true });
    assert.equal(res.headers['cache-control'], 'no-store');

    res = await post(run({ nickname: 'Beta', score: 5000 }));
    assert.deepEqual(res.json(), { nickname: 'Beta', rank: 1, total: 2, best: 5000, personalBest: true });
    // A worse run keeps the player's best and rank; names match case-insensitively.
    res = await post(run({ nickname: 'alpha', score: 1000 }));
    assert.deepEqual(res.json(), { nickname: 'alpha', rank: 2, total: 2, best: 3000, personalBest: false });
    res = await post(run({ nickname: 'ALPHA', score: 9000, seconds: 120, eaten: 100 }));
    assert.deepEqual(res.json(), { nickname: 'ALPHA', rank: 1, total: 2, best: 9000, personalBest: true });
    await a.close();
  });

  test('top list: best run per player, highest first, limited to 50', async () => {
    const a = await app();
    for (let i = 0; i < 60; i++) {
      await a.inject({ method: 'POST', url: '/api/scores', payload: run({ nickname: `P${i}`, score: 100 * (i + 1) }) });
    }
    await a.inject({ method: 'POST', url: '/api/scores', payload: run({ nickname: 'p59', score: 50 }) });
    let res = await a.inject({ method: 'GET', url: '/api/scores/top' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { entries: { rank: number; nickname: string; score: number; tier: number }[]; total: number };
    assert.equal(body.total, 60);
    assert.equal(body.entries.length, 50);
    assert.deepEqual(body.entries[0], { rank: 1, nickname: 'P59', score: 6000, tier: 1 });
    assert.equal(body.entries[49].score, 1100);
    assert.ok(body.entries.every((e, i) => i === 0 || e.score <= body.entries[i - 1].score));

    res = await a.inject({ method: 'GET', url: '/api/scores/top?limit=5' });
    assert.equal((res.json() as { entries: unknown[] }).entries.length, 5);
    res = await a.inject({ method: 'GET', url: '/api/scores/top?limit=9999' });
    assert.equal((res.json() as { entries: unknown[] }).entries.length, 50);

    // Where a score would place without submitting it.
    res = await a.inject({ method: 'GET', url: '/api/scores/rank?score=5950' });
    assert.deepEqual(res.json(), { rank: 2, total: 61 });
    res = await a.inject({ method: 'GET', url: '/api/scores/rank?score=abc' });
    assert.equal(res.statusCode, 400);
    await a.close();
  });

  test('rejected runs are not stored: bad body, blocked nickname, implausible score', async () => {
    const a = await app();
    const post = (payload: unknown) => a.inject({ method: 'POST', url: '/api/scores', payload: payload as object });
    let res = await post({ nickname: 'Pea' });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: 'invalid' });
    res = await post(run({ nickname: 'fuckface' }));
    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.json(), { error: 'nickname' });
    res = await post(run({ score: 10 ** 12 }));
    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.json(), { error: 'implausible' });
    res = await a.inject({ method: 'POST', url: '/api/scores', headers: { 'content-type': 'application/json' }, payload: '{"nickname":"' + 'x'.repeat(2000) + '"}' });
    assert.equal(res.statusCode, 413);
    res = await a.inject({ method: 'GET', url: '/api/scores/top' });
    assert.deepEqual(res.json(), { entries: [], total: 0 });
    await a.close();
  });

  test('rate limit: submissions per IP per minute, other IPs unaffected', async () => {
    const a = await app({ submitPerMinute: 3 });
    const post = (ip: string) => a.inject({ method: 'POST', url: '/api/scores', payload: run(), remoteAddress: ip });
    for (let i = 0; i < 3; i++) assert.equal((await post('203.0.113.7')).statusCode, 201);
    assert.equal((await post('203.0.113.7')).statusCode, 429);
    assert.equal((await post('203.0.113.8')).statusCode, 201);
    // Behind the proxies (private addresses) the client comes from X-Forwarded-For.
    const viaProxy = (client: string) =>
      a.inject({ method: 'POST', url: '/api/scores', payload: run(), remoteAddress: '172.18.0.3', headers: { 'x-forwarded-for': client } });
    for (let i = 0; i < 3; i++) assert.equal((await viaProxy('198.51.100.1')).statusCode, 201);
    assert.equal((await viaProxy('198.51.100.1')).statusCode, 429);
    assert.equal((await viaProxy('198.51.100.2')).statusCode, 201);
    // A client cannot dodge the limit by sending its own X-Forwarded-For from a public address.
    const spoof = await a.inject({ method: 'POST', url: '/api/scores', payload: run(), remoteAddress: '203.0.113.7', headers: { 'x-forwarded-for': '192.0.2.99' } });
    assert.equal(spoof.statusCode, 429);
    await a.close();
  });

  test('health', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: '/api/health' });
    assert.deepEqual(res.json(), { ok: true });
    await a.close();
  });
});

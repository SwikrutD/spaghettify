/**
 * Network probe for a deployed arena: where the time goes between this machine and the server. Not part of
 * `npm test`; run by hand:
 *
 *   npm run probe -- [https://spaghettify.swikrut.com] [--seconds 30]
 *
 * Prints the Cloudflare datacenter that answers (`colo` from /cdn-cgi/trace; skipped when the host is not behind
 * Cloudflare), the round trip on a warm connection to that edge alone and to the api behind it (/api/health), then
 * joins quick play as an anonymous player (never posted) and reports the WebSocket ping (as the game's corner line
 * shows it), the gaps between snapshots and the snapshot bandwidth. Steady 50 ms gaps with a high ping mean the time
 * is spent on the way, not in the server.
 */
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { NET } from '../../src/config/index.ts';
import { encodeInput, PROTOCOL_VERSION, rulesHash, type ServerMessage } from '../../src/protocol/messages.ts';
import { Writer } from '../../src/protocol/wire.ts';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'https://spaghettify.swikrut.com').replace(/\/$/, '');
const secondsAt = args.indexOf('--seconds');
const seconds = secondsAt >= 0 ? Number(args[secondsAt + 1]) : 30;

/** Milliseconds per request on one kept-alive connection (the first request also pays the handshakes). */
async function timed(url: string, times: number): Promise<{ ms: number[]; body: string }> {
  const ms: number[] = [];
  let body = '';
  for (let i = 0; i < times; i++) {
    const t = performance.now();
    const res = await fetch(url);
    body = await res.text();
    ms.push(performance.now() - t);
  }
  return { ms, body };
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

const f0 = (v: number) => v.toFixed(0);
const warm = (ms: number[]) => f0(quantile(ms.slice(1), 0.5));

const trace = await timed(`${base}/cdn-cgi/trace`, 5).catch(() => null);
const colo = trace?.body.match(/^colo=(\w+)/m)?.[1];
if (colo) {
  console.log(`Cloudflare datacenter ${colo} (visitor ${trace!.body.match(/^loc=(\w+)/m)?.[1] ?? '?'})`);
  console.log(`edge only (warm)    ${warm(trace!.ms)} ms`);
} else {
  console.log('not behind Cloudflare (no /cdn-cgi/trace)');
}
const health = await timed(`${base}/api/health`, 5);
console.log(`edge + api (warm)   ${warm(health.ms)} ms`);

const pings: number[] = [];
const gaps: number[] = [];
let bytes = 0;
let last = 0;
let started = 0;
const socket = new WebSocket(base.replace(/^http/, 'ws') + NET.path);
socket.binaryType = 'nodebuffer';
socket.on('open', () => socket.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, rules: rulesHash(), reach: 1.6 })));
socket.on('close', (code) => {
  if (!started) console.log(`closed before the welcome (${code}): another build or rules on the server?`);
});
socket.on('message', (data: Buffer, isBinary: boolean) => {
  const now = performance.now();
  if (isBinary) {
    bytes += data.length;
    if (last) gaps.push(now - last);
    last = now;
    return;
  }
  const m = JSON.parse(data.toString()) as ServerMessage;
  if (m.t === 'pong') pings.push(now - m.n);
  else if (m.t === 'over') socket.send(JSON.stringify({ t: 'play' }));
  else if (m.t === 'welcome') start(m.room);
});

function start(room: number): void {
  started = performance.now();
  console.log(`joined room ${room}, measuring for ${seconds} s`);
  const w = new Writer();
  let seq = 0;
  let angle = 0;
  // Input 15 times a second (a wandering hole) and a ping 4 times a second: under the server's message limit.
  const input = setInterval(() => {
    angle += Math.sin(seq * 0.05) * 0.2;
    socket.send(encodeInput(w, ++seq, Math.cos(angle), Math.sin(angle)));
  }, 1000 / 15);
  const ping = setInterval(() => socket.send(JSON.stringify({ t: 'ping', n: performance.now() })), 250);
  setTimeout(() => {
    clearInterval(input);
    clearInterval(ping);
    const span = (performance.now() - started) / 1000;
    console.log(`ws ping             p10 ${f0(quantile(pings, 0.1))}  p50 ${f0(quantile(pings, 0.5))}  p90 ${f0(quantile(pings, 0.9))}  max ${f0(quantile(pings, 1))} ms`);
    console.log(`snapshot gaps       p50 ${f0(quantile(gaps, 0.5))}  p99 ${f0(quantile(gaps, 0.99))}  max ${f0(quantile(gaps, 1))} ms`);
    console.log(`snapshots           ${(bytes / 1024 / span).toFixed(1)} KB/s`);
    socket.close(1000, 'left');
  }, seconds * 1000);
}

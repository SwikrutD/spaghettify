import { NET, NET_CLIENT } from '../config';
import { CLOSE, PROTOCOL_VERSION, rulesHash, type ClientMessage, type ServerMessage, type WelcomeMessage } from '../protocol/messages.ts';
import { readSnapshot } from '../protocol/snapshot.ts';
import type { Incoming, ServerLink } from './OnlineArena.ts';

/** Why a connection ended (or never got going): a CLOSE code name, or what the client saw. */
export type NetEnd = keyof typeof CLOSE | 'unreachable' | 'dropped' | 'stalled' | 'left';

const CLOSE_NAMES = new Map<number, keyof typeof CLOSE>(Object.entries(CLOSE).map(([name, code]) => [code, name as keyof typeof CLOSE]));

/**
 * The arena's WebSocket URL: NET.path on this host (Caddy proxies it in production, the Vite dev server in dev). In
 * a dev build `?server=ws://host:port/ws` points it at another server (the online Playwright tests run their own).
 */
export function arenaUrl(): string {
  const override = import.meta.env.DEV ? new URLSearchParams(location.search).get('server') : null;
  if (override) return override;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${NET.path}`;
}

/**
 * The game's connection to the online arena: a WebSocket that joins quick play, hands every server message on
 * (snapshots decoded) with its arrival time, sends input and control messages, pings once a second for the round
 * trip time and gives up on a connection that goes quiet. `connect` resolves once welcomed, or with why not.
 */
export class NetClient implements ServerLink {
  readonly socket: WebSocket;
  /** Smoothed round trip time in milliseconds (null until the first pong). */
  rtt: number | null = null;
  /** Bytes received (tests and tuning). */
  bytes = 0;
  /** The connection ended after the welcome (not called for close()). */
  onEnd: ((why: NetEnd) => void) | null = null;
  private handler: ((message: Incoming, nowMs: number) => void) | null = null;
  /** What came before anyone listened (right after the welcome). */
  private readonly early: [Incoming, number][] = [];
  private open = true;
  private lastHeard = performance.now();
  /** When the ping timer last ran (a timer that runs late means the page was busy or hidden, not the link). */
  private lastPing = performance.now();
  private pingTimer = 0;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.onmessage = (e) => this.receive(e.data as ArrayBuffer | string);
    socket.onclose = (e) => this.end(CLOSE_NAMES.get(e.code) ?? 'dropped');
    socket.onerror = null;
    this.pingTimer = window.setInterval(() => this.ping(), NET_CLIENT.pingSeconds * 1000);
    this.ping();
  }

  /**
   * Open the arena socket at `url` and join quick play. Resolves with the client and its welcome, or with why not:
   * 'full', 'version', 'unreachable' (no connection, no answer in NET_CLIENT.connectSeconds) and so on.
   */
  static connect(url: string, name: string, reach: number): Promise<{ client: NetClient; welcome: WelcomeMessage } | { failed: NetEnd }> {
    return new Promise((resolve) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        resolve({ failed: 'unreachable' });
        return;
      }
      socket.binaryType = 'arraybuffer';
      let done = false;
      let said: NetEnd | null = null;
      const finish = (result: { client: NetClient; welcome: WelcomeMessage } | { failed: NetEnd }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish({ failed: 'unreachable' });
        socket.onclose = null;
        socket.close();
      }, NET_CLIENT.connectSeconds * 1000);
      socket.onopen = () => {
        const join: ClientMessage = { t: 'join', v: PROTOCOL_VERSION, rules: rulesHash(), name, reach };
        socket.send(JSON.stringify(join));
      };
      socket.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const m = parse(e.data);
        if (m?.t === 'error') said = m.code;
        if (m?.t !== 'welcome') return;
        finish({ client: new NetClient(socket), welcome: m });
      };
      socket.onclose = (e) => finish({ failed: CLOSE_NAMES.get(e.code) ?? said ?? 'unreachable' });
    });
  }

  get connected(): boolean {
    return this.open;
  }

  /** Where the server's messages go from now on (anything that came since the welcome first). */
  listen(handler: (message: Incoming, nowMs: number) => void): void {
    this.handler = handler;
    for (const [m, at] of this.early.splice(0)) handler(m, at);
  }

  sendBinary(bytes: Uint8Array): void {
    // Writer.bytes() copies into a fresh ArrayBuffer, never a shared one.
    if (this.open && this.socket.readyState === WebSocket.OPEN) this.socket.send(bytes as Uint8Array<ArrayBuffer>);
  }

  send(message: ClientMessage): void {
    if (this.open && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /** Leave: the server scores a life still going as it stands. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    window.clearInterval(this.pingTimer);
    this.socket.onclose = null;
    this.socket.close(1000, 'left');
  }

  private receive(data: ArrayBuffer | string): void {
    const now = performance.now();
    this.lastHeard = now;
    if (typeof data === 'string') {
      this.bytes += data.length;
      const m = parse(data);
      if (!m) return;
      if (m.t === 'pong') {
        const sample = now - m.n;
        if (sample >= 0) this.rtt = this.rtt === null ? sample : this.rtt + (sample - this.rtt) * 0.25;
        return;
      }
      this.deliver(m, now);
      return;
    }
    this.bytes += data.byteLength;
    let snapshot;
    try {
      snapshot = readSnapshot(new Uint8Array(data));
    } catch {
      // A snapshot this build cannot read: the arena cannot be mirrored any more.
      this.socket.close(CLOSE.policy, 'bad snapshot');
      return;
    }
    this.deliver(snapshot, now);
  }

  private deliver(message: Incoming, now: number): void {
    if (this.handler) this.handler(message, now);
    else this.early.push([message, now]);
  }

  private ping(): void {
    if (!this.open) return;
    const now = performance.now();
    // Late itself (a long frame, a hidden tab): what came meanwhile may still be queued behind this timer, so the
    // silence is this page's, not the connection's. Count from now.
    if (now - this.lastPing > NET_CLIENT.pingSeconds * 2000) this.lastHeard = now;
    this.lastPing = now;
    if (now - this.lastHeard > NET_CLIENT.stallSeconds * 1000) {
      this.socket.onclose = null;
      this.socket.close();
      this.end('stalled');
      return;
    }
    this.send({ t: 'ping', n: performance.now() });
  }

  private end(why: NetEnd): void {
    if (!this.open) return;
    this.open = false;
    window.clearInterval(this.pingTimer);
    this.onEnd?.(why);
  }
}

/** A server's JSON text frame, or null if it is not one. */
function parse(text: string): ServerMessage | null {
  try {
    const m = JSON.parse(text) as ServerMessage;
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

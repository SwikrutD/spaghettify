import type { Hole } from '../sim/Hole.ts';
import { FONT } from './dom';

/** Rows in the live board. */
const ROWS = 10;
/** Seconds between rebuilds of the board. */
const BOARD_INTERVAL = 0.25;
const FEED_LIFETIME = 6000;
const FEED_MAX = 4;

/** "950", "12.4k", "3.1M". */
export function shortNumber(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
}

/** A hole's points as shown on the live board: the mass it has grown by over its start. */
export function liveScore(hole: Hole): number {
  return hole.livePoints;
}

/** One row of the live board. */
interface BoardRow {
  place: number;
  name: string;
  points: number;
  own: boolean;
}

/**
 * In-run HUD: the live top 10 of the arena in the top right corner (under the pause button) with the local player
 * lit and, past the tenth place, their own row below, and a short feed of who ate whom at the bottom left. Offline
 * the board is worked out from the world's holes; online it is the server's (setBoard), since a client only knows
 * the holes near it. Plain DOM above the canvas; names go in with textContent.
 */
export class Hud {
  private readonly root = document.createElement('div');
  private readonly board = document.createElement('div');
  private readonly feed = document.createElement('div');
  private since = BOARD_INTERVAL;
  private readonly sorted: Hole[] = [];
  private readonly rows: BoardRow[] = [];

  constructor(parent: HTMLElement = document.body) {
    Object.assign(this.root.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '4', fontFamily: FONT, color: '#fff', display: 'none' });
    Object.assign(this.board.style, {
      position: 'absolute',
      top: '56px',
      right: '12px',
      width: 'min(210px, 44vw)',
      padding: '8px 10px',
      background: 'rgba(0, 0, 0, 0.42)',
      borderRadius: '6px',
      font: `12px/1.5 ${FONT}`,
      fontVariantNumeric: 'tabular-nums',
    });
    this.board.dataset.testid = 'hud-board';
    Object.assign(this.feed.style, {
      position: 'absolute',
      left: '12px',
      bottom: '14px',
      maxWidth: 'min(320px, 60vw)',
      font: `12px/1.5 ${FONT}`,
      textShadow: '0 0 4px #000, 0 1px 2px #000',
    });
    this.feed.dataset.testid = 'hud-feed';
    this.root.append(this.board, this.feed);
    parent.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  /** One line in the feed ("Quiet Void ate Kerr-7"); `mine` lights it when the local player is in it. */
  addFeed(text: string, mine: boolean): void {
    const line = document.createElement('div');
    line.textContent = text;
    line.dataset.testid = 'hud-feed-line';
    line.style.color = mine ? '#ffd9a0' : '#dfe6f5';
    line.style.transition = 'opacity 0.6s';
    this.feed.append(line);
    while (this.feed.childElementCount > FEED_MAX) this.feed.firstElementChild?.remove();
    setTimeout(() => (line.style.opacity = '0'), FEED_LIFETIME - 600);
    setTimeout(() => line.remove(), FEED_LIFETIME);
  }

  /** Empty the feed (a new arena). */
  clearFeed(): void {
    this.feed.replaceChildren();
  }

  /** Rebuild the board a few times a second from the holes in play, biggest first. */
  update(dt: number, holes: readonly Hole[], local: Hole): void {
    this.since += dt;
    if (this.since < BOARD_INTERVAL) return;
    this.since = 0;
    const sorted = this.sorted;
    sorted.length = 0;
    for (const hole of holes) if (hole.phase === 'playing' || (hole === local && hole.phase !== 'over')) sorted.push(hole);
    sorted.sort((a, b) => b.mass - a.mass);
    const rows = this.rows;
    rows.length = 0;
    const row = (place: number, hole: Hole) => rows.push({ place, name: hole.name, points: liveScore(hole), own: hole === local });
    for (let i = 0; i < Math.min(ROWS, sorted.length); i++) row(i + 1, sorted[i]);
    const place = sorted.indexOf(local);
    if (place >= ROWS) row(place + 1, local);
    this.render(rows);
  }

  /**
   * The server's live board (online): [hole id, name, points] best first, and the player's own place and points (null
   * while their life is over). `local` is the player's hole.
   */
  setBoard(top: readonly [number, string, number][], you: readonly [number, number] | null, local: Hole): void {
    const rows = this.rows;
    rows.length = 0;
    top.slice(0, ROWS).forEach(([id, name, points], i) => rows.push({ place: i + 1, name, points, own: id === local.id }));
    if (you && you[0] > ROWS) rows.push({ place: you[0], name: local.name, points: you[1], own: true });
    this.render(rows);
  }

  private render(rows: readonly BoardRow[]): void {
    const children: HTMLElement[] = [];
    const title = document.createElement('div');
    title.textContent = 'BIGGEST HOLES';
    Object.assign(title.style, { fontSize: '10px', letterSpacing: '0.25em', opacity: '0.6', marginBottom: '2px' });
    children.push(title);
    for (const r of rows) {
      const el = document.createElement('div');
      el.dataset.testid = 'hud-row';
      Object.assign(el.style, { display: 'flex', gap: '6px', color: r.own ? '#ffd9a0' : '#dfe6f5', fontWeight: r.own ? '700' : '400' });
      const place = document.createElement('span');
      place.textContent = String(r.place);
      Object.assign(place.style, { width: '1.6em', opacity: '0.6' });
      const name = document.createElement('span');
      name.textContent = r.name;
      Object.assign(name.style, { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
      const score = document.createElement('span');
      score.textContent = shortNumber(r.points);
      el.append(place, name, score);
      children.push(el);
    }
    this.board.replaceChildren(...children);
  }
}

import { NET_CLIENT } from '../config';
import { FONT } from './dom';

const PING_COLORS = { good: '#7fe08a', fair: '#ffd27a', poor: '#ff8f7d' } as const;

/**
 * The connection on screen while playing: a small line in the top left corner (online with the players in the room
 * and the round trip time, or the offline arena), and a note across the top for a moment when something changes
 * (fell back to the offline arena, the nickname was refused). Plain DOM above the canvas.
 */
export class NetStatus {
  private readonly line = document.createElement('div');
  private readonly dot = document.createElement('span');
  private readonly text = document.createElement('span');
  private readonly note = document.createElement('div');
  private shown = '';
  private noteTimer = 0;

  /** `top` moves the line down (the ?perf readout sits in the corner). */
  constructor(parent: HTMLElement = document.body, top = 12) {
    Object.assign(this.line.style, {
      position: 'fixed',
      top: `${top}px`,
      left: '12px',
      display: 'none',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 8px',
      borderRadius: '10px',
      background: 'rgba(0, 0, 0, 0.35)',
      color: '#dfe6f5',
      font: `11px/1.4 ${FONT}`,
      letterSpacing: '0.12em',
      pointerEvents: 'none',
      zIndex: '4',
    });
    this.line.dataset.testid = 'net-status';
    Object.assign(this.dot.style, { width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block' });
    this.line.append(this.dot, this.text);
    Object.assign(this.note.style, {
      position: 'fixed',
      top: '56px',
      left: '50%',
      transform: 'translateX(-50%)',
      maxWidth: 'min(520px, 86vw)',
      padding: '8px 14px',
      borderRadius: '8px',
      background: 'rgba(8, 12, 28, 0.82)',
      border: '1px solid rgba(160, 180, 230, 0.35)',
      color: '#fff',
      font: `14px/1.4 ${FONT}`,
      textAlign: 'center',
      pointerEvents: 'none',
      zIndex: '15',
      opacity: '0',
      transition: 'opacity 0.4s',
    });
    this.note.dataset.testid = 'net-note';
    parent.append(this.line, this.note);
  }

  setVisible(visible: boolean): void {
    this.line.style.display = visible ? 'flex' : 'none';
  }

  /** Online: players in the room (null until the first board) and the round trip in milliseconds (null until measured). */
  online(players: number | null, rtt: number | null): void {
    const who = players === null ? '' : ` · ${players} ${players === 1 ? 'PLAYER' : 'PLAYERS'}`;
    const ping = rtt === null ? '' : ` · ${Math.round(rtt)} MS`;
    const color = rtt === null || rtt < NET_CLIENT.pingGood ? PING_COLORS.good : rtt < NET_CLIENT.pingFair ? PING_COLORS.fair : PING_COLORS.poor;
    this.set(`ONLINE${who}${ping}`, color);
  }

  offline(): void {
    this.set('OFFLINE ARENA', 'rgba(223, 230, 245, 0.45)');
  }

  connecting(): void {
    this.set('CONNECTING...', PING_COLORS.fair);
  }

  /** A note for a few seconds. */
  showNote(text: string): void {
    this.note.textContent = text;
    this.note.style.opacity = '1';
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => (this.note.style.opacity = '0'), NET_CLIENT.noteSeconds * 1000);
  }

  /** The note on screen right now ('' when none: tests). */
  get noteText(): string {
    return this.note.style.opacity === '1' ? (this.note.textContent ?? '') : '';
  }

  private set(text: string, color: string): void {
    const key = `${text}|${color}`;
    if (key === this.shown) return;
    this.shown = key;
    this.text.textContent = text;
    this.dot.style.background = color;
  }
}

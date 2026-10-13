import type { BoardEntry } from '../leaderboard/api';
import { FONT } from './dom';

/** A compact leaderboard table with a status line, used on the score screen and the title screen. */
export class LeaderboardPanel {
  readonly root = document.createElement('div');
  private readonly heading = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly list = document.createElement('ol');

  constructor(testid: string, title: string) {
    this.root.dataset.testid = testid;
    Object.assign(this.root.style, {
      boxSizing: 'border-box',
      width: 'min(320px, 86vw)',
      padding: '16px 18px',
      fontFamily: FONT,
      textAlign: 'left',
      background: 'rgba(8, 12, 28, 0.55)',
      border: '1px solid rgba(160, 180, 230, 0.25)',
      borderRadius: '10px',
    });
    this.heading.textContent = title;
    Object.assign(this.heading.style, { fontSize: '12px', letterSpacing: '0.35em', opacity: '0.7', marginBottom: '10px' });
    Object.assign(this.status.style, { fontSize: '14px', lineHeight: '1.4', opacity: '0.85' });
    this.status.dataset.testid = `${testid}-status`;
    Object.assign(this.list.style, { listStyle: 'none', margin: '0', padding: '0', fontSize: '14px' });
    this.list.dataset.testid = `${testid}-rows`;
    this.root.append(this.heading, this.list, this.status);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
    this.status.style.marginTop = this.list.childElementCount && text ? '10px' : '0';
  }

  /**
   * Show the first `rows` entries. The row whose nickname matches `highlight` is lit; if that player is
   * below the cut, their own row (`own`) is added after a gap.
   */
  setEntries(entries: BoardEntry[], rows: number, highlight = '', own: BoardEntry | null = null): void {
    this.list.replaceChildren();
    const key = highlight.toLowerCase();
    const shown = entries.slice(0, rows);
    for (const e of shown) this.list.append(this.row(e, !!key && e.nickname.toLowerCase() === key));
    if (own && key && !shown.some((e) => e.nickname.toLowerCase() === key)) {
      const gap = document.createElement('li');
      gap.textContent = '...';
      Object.assign(gap.style, { opacity: '0.5', padding: '0 0 2px 4px' });
      this.list.append(gap, this.row(own, true));
    }
  }

  clear(): void {
    this.list.replaceChildren();
    this.setStatus('');
  }

  private row(e: BoardEntry, mine: boolean): HTMLLIElement {
    const li = document.createElement('li');
    Object.assign(li.style, {
      display: 'grid',
      gridTemplateColumns: '3.2em 1fr auto',
      gap: '8px',
      padding: '3px 6px',
      borderRadius: '6px',
      background: mine ? 'rgba(255, 150, 70, 0.22)' : 'transparent',
      color: mine ? '#ffe6cc' : '#fff',
    });
    if (mine) li.dataset.mine = 'true';
    const rank = document.createElement('span');
    rank.textContent = `#${e.rank}`;
    rank.style.opacity = '0.6';
    const name = document.createElement('span');
    // textContent, never innerHTML: nicknames come from other players.
    name.textContent = e.nickname;
    Object.assign(name.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
    if (e.offline) {
      // The best run was played in an offline arena (bots only).
      const tag = document.createElement('span');
      tag.textContent = ' OFFLINE';
      tag.title = 'Played in the offline arena';
      tag.dataset.testid = 'offline-tag';
      Object.assign(tag.style, { fontSize: '10px', letterSpacing: '0.15em', opacity: '0.5' });
      name.append(tag);
    }
    const score = document.createElement('span');
    score.textContent = e.score.toLocaleString('en-US');
    score.style.fontVariantNumeric = 'tabular-nums';
    li.append(rank, name, score);
    return li;
  }
}

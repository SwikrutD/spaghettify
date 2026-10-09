import { LeaderboardPanel } from './LeaderboardPanel';
import { ladderLine } from './milestones';

export interface RunStats {
  score: number;
  best: number;
  newBest: boolean;
  biggest: { name: string } | null;
  tierNumber: number;
  tierTitle: string;
  eatenCount: number;
  seconds: number;
}

/** End-of-run screen: stats, the milestone ladder line and a play again button. Plain DOM above the canvas. */
export class ScoreScreen {
  /** Called when the player asks for a new run. */
  onRestart: (() => void) | null = null;
  /** Called when the player asks to share the run (the share card). */
  onShare: (() => void) | null = null;
  private readonly root = document.createElement('div');
  private readonly body = document.createElement('div');
  /** Global leaderboard beside the stats (below them on narrow screens). Filled by main. */
  readonly board = new LeaderboardPanel('board', 'LEADERBOARD');
  private readonly layout = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly shareButton = document.createElement('button');
  private readonly status = document.createElement('div');
  private visible = false;

  constructor(parent: HTMLElement = document.body) {
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.55), rgba(0,0,0,0.9))',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center',
      zIndex: '10',
      // Short landscape phones: scroll instead of clipping the buttons. The layout centres itself with margin auto.
      overflowY: 'auto',
    });
    this.root.dataset.testid = 'score-screen';
    Object.assign(this.body.style, { padding: '24px 12px', maxWidth: '90vw' });
    Object.assign(this.layout.style, {
      margin: 'auto',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      columnGap: '40px',
      padding: '12px 0 24px',
    });
    Object.assign(this.button.style, {
      marginTop: '28px',
      padding: '14px 40px',
      fontSize: '18px',
      letterSpacing: '0.2em',
      fontWeight: '700',
      color: '#fff',
      background: 'rgba(255, 150, 70, 0.18)',
      border: '2px solid rgba(255, 170, 100, 0.9)',
      borderRadius: '8px',
      cursor: 'pointer',
    });
    this.button.textContent = 'PLAY AGAIN';
    this.button.dataset.testid = 'play-again';
    this.button.addEventListener('click', () => this.restart());
    Object.assign(this.shareButton.style, {
      display: 'block',
      margin: '12px auto 0',
      padding: '10px 28px',
      fontSize: '14px',
      letterSpacing: '0.2em',
      fontWeight: '700',
      color: '#fff',
      background: 'rgba(160, 180, 230, 0.08)',
      border: '2px solid rgba(160, 180, 230, 0.4)',
      borderRadius: '8px',
      cursor: 'pointer',
    });
    this.shareButton.dataset.testid = 'share';
    this.shareButton.addEventListener('click', () => {
      if (this.visible) this.onShare?.();
    });
    Object.assign(this.status.style, { minHeight: '18px', marginTop: '8px', fontSize: '13px', opacity: '0.7' });
    this.status.dataset.testid = 'share-status';
    window.addEventListener('keydown', (e) => {
      if (this.visible && e.code === 'Enter') this.restart();
    });
    this.layout.append(this.body, this.board.root);
    this.root.append(this.layout);
    parent.append(this.root);
  }

  show(stats: RunStats): void {
    const row = (label: string, value: string): string =>
      `<div style="display:flex;justify-content:space-between;gap:32px;padding:4px 0"><span style="opacity:0.7">${label}</span><span>${value}</span></div>`;
    const mins = Math.floor(stats.seconds / 60);
    const secs = String(Math.floor(stats.seconds % 60)).padStart(2, '0');
    const best = stats.newBest ? 'NEW BEST' : `BEST ${stats.best.toLocaleString('en-US')}`;
    this.body.innerHTML =
      `<div style="font-size:14px;letter-spacing:0.4em;opacity:0.7">YOU EVAPORATED</div>` +
      `<div data-testid="score" style="font-size:clamp(44px,10vw,88px);font-weight:700;margin:8px 0 0">${stats.score.toLocaleString('en-US')}</div>` +
      `<div style="font-size:14px;letter-spacing:0.3em;opacity:0.7">${best}</div>` +
      `<div data-testid="ladder" style="font-size:clamp(22px,4vw,34px);margin:28px 0 20px;text-shadow:0 0 24px rgba(255,190,120,0.8)">${ladderLine(stats.biggest)}</div>` +
      `<div style="display:inline-block;min-width:260px;font-size:16px;text-align:left" data-testid="stats">` +
      row('Tier reached', `${stats.tierNumber}: ${stats.tierTitle}`) +
      row('Objects eaten', String(stats.eatenCount)) +
      row('Time', `${mins}:${secs}`) +
      `</div>`;
    this.status.textContent = '';
    this.body.append(document.createElement('div'), this.button, this.shareButton, this.status);
    this.root.style.display = 'flex';
    this.visible = true;
  }

  /** Share button label ('SHARE' or 'SAVE CARD') and whether it can be pressed right now. */
  setShare(label: string, enabled: boolean): void {
    this.shareButton.textContent = label;
    this.shareButton.disabled = !enabled;
    this.shareButton.style.opacity = enabled ? '1' : '0.5';
  }

  /** Short feedback under the buttons ("Card saved"). */
  setStatus(text: string): void {
    this.status.textContent = text;
  }

  hide(): void {
    this.root.style.display = 'none';
    this.visible = false;
  }

  private restart(): void {
    if (!this.visible) return;
    this.hide();
    this.onRestart?.();
  }
}

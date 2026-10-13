import { MENU, STORAGE } from '../config';
import { cleanNickname } from '../leaderboard/rules';
import { button, FONT, overlay, show } from './dom';
import { LeaderboardPanel } from './LeaderboardPanel';


export function loadBest(): number {
  try {
    return Number(localStorage.getItem(STORAGE.best)) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(STORAGE.best, String(score));
  } catch {
    // Storage can be blocked; the best score is a convenience.
  }
}

/**
 * Title screen: name, best score, nickname entry, play, settings and a line when the game will play the offline
 * arena (no player count). Shown before the first run and after quitting a run.
 */
export class TitleScreen {
  onPlay: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  /** Called each time the title shows, so main can refresh the top few from the leaderboard. */
  onShow: (() => void) | null = null;
  /** Top few players, shown only when the leaderboard answers. Filled by main. */
  readonly board = new LeaderboardPanel('title-board', 'TOP BLACK HOLES');
  private readonly root = overlay('title-screen', 20);
  private readonly best = document.createElement('div');
  private readonly nickname = document.createElement('input');
  private readonly playButton: HTMLButtonElement;
  private readonly online = document.createElement('div');
  private connecting = false;
  private visible = false;

  constructor(parent: HTMLElement = document.body) {
    const box = document.createElement('div');
    Object.assign(box.style, { padding: '24px', width: 'min(320px, 86vw)', margin: 'auto' });
    // With the leaderboard the title can be taller than a landscape phone: scroll rather than clip.
    this.root.style.overflowY = 'auto';

    const title = document.createElement('div');
    title.textContent = 'SPAGHETTIFY';
    Object.assign(title.style, {
      fontSize: 'clamp(36px, 9vw, 72px)',
      fontWeight: '700',
      letterSpacing: '0.18em',
      textShadow: '0 0 28px rgba(255, 170, 100, 0.7)',
      // The spaced-out title is wider than the box: a centred flex row overflows evenly on both sides.
      display: 'flex',
      justifyContent: 'center',
    });
    const tag = document.createElement('div');
    tag.textContent = 'Start as a pea-sized black hole. Eat everything.';
    Object.assign(tag.style, { fontSize: '14px', opacity: '0.7', margin: '8px 0 28px' });

    Object.assign(this.best.style, { fontSize: '14px', letterSpacing: '0.3em', opacity: '0.8', marginBottom: '20px' });
    this.best.dataset.testid = 'title-best';

    this.nickname.type = 'text';
    this.nickname.maxLength = MENU.nicknameMaxLength;
    this.nickname.placeholder = 'Nickname';
    this.nickname.autocomplete = 'off';
    this.nickname.spellcheck = false;
    this.nickname.setAttribute('aria-label', 'Nickname');
    this.nickname.dataset.testid = 'nickname';
    Object.assign(this.nickname.style, {
      boxSizing: 'border-box',
      width: '100%',
      padding: '10px 12px',
      fontSize: '16px',
      fontFamily: FONT,
      textAlign: 'center',
      color: '#fff',
      background: 'rgba(8, 12, 28, 0.6)',
      border: '1px solid rgba(160, 180, 230, 0.4)',
      borderRadius: '8px',
    });
    this.nickname.value = this.loadNickname();
    this.nickname.addEventListener('input', () => this.saveNickname());
    this.nickname.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') this.play();
    });

    const play = button('PLAY', 'play', true);
    play.style.marginTop = '20px';
    play.addEventListener('click', () => this.play());
    this.playButton = play;
    Object.assign(this.online.style, { fontSize: '12px', letterSpacing: '0.25em', opacity: '0.7', margin: '10px 0 0', minHeight: '15px' });
    this.online.dataset.testid = 'title-online';
    const settings = button('SETTINGS', 'title-settings');
    settings.addEventListener('click', () => this.onSettings?.());

    this.board.root.style.display = 'none';
    this.board.root.style.margin = '24px auto 0';
    box.append(title, tag, this.best, this.nickname, play, this.online, settings, this.board.root);
    this.root.append(box);
    parent.append(this.root);

    // Enter starts the run unless focus is on a control of its own (the nickname field has its own handler).
    window.addEventListener('keydown', (e) => {
      if (this.visible && e.code === 'Enter' && !this.root.contains(document.activeElement)) this.play();
    });
  }

  get nicknameValue(): string {
    return cleanNickname(this.nickname.value);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** The line under Play: empty, or that the game plays the offline arena. */
  setOnline(text: string): void {
    this.online.textContent = text;
  }

  /** While joining the online arena Play waits (and says so). */
  setConnecting(on: boolean): void {
    this.connecting = on;
    this.playButton.textContent = on ? 'CONNECTING...' : 'PLAY';
    this.playButton.disabled = on;
    this.playButton.style.opacity = on ? '0.6' : '1';
  }

  show(): void {
    this.best.textContent = `BEST ${loadBest().toLocaleString('en-US')}`;
    show(this.root, true);
    this.visible = true;
    this.onShow?.();
  }

  hide(): void {
    show(this.root, false);
    this.visible = false;
    this.nickname.blur();
  }

  private play(): void {
    if (!this.visible || this.connecting) return;
    this.saveNickname();
    this.onPlay?.();
  }

  private loadNickname(): string {
    try {
      return cleanNickname(localStorage.getItem(STORAGE.nickname) ?? '');
    } catch {
      return '';
    }
  }

  private saveNickname(): void {
    try {
      localStorage.setItem(STORAGE.nickname, this.nicknameValue);
    } catch {
      // Nickname is a convenience; ignore blocked storage.
    }
  }
}

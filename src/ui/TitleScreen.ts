import { MENU, STORAGE } from '../config';
import { button, FONT, overlay, show } from './dom';

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

/** Keep letters, digits, spaces and a few separators; trim and cap the length. */
export function cleanNickname(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MENU.nicknameMaxLength);
}

/** Title screen: name, best score, nickname entry, play and settings. Shown before the first run and after quitting a run. */
export class TitleScreen {
  onPlay: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  private readonly root = overlay('title-screen', 20);
  private readonly best = document.createElement('div');
  private readonly nickname = document.createElement('input');
  private visible = false;

  constructor(parent: HTMLElement = document.body) {
    const box = document.createElement('div');
    Object.assign(box.style, { padding: '24px', width: 'min(320px, 86vw)' });

    const title = document.createElement('div');
    title.textContent = 'SPAGHETTIFY';
    Object.assign(title.style, {
      fontSize: 'clamp(36px, 9vw, 72px)',
      fontWeight: '700',
      letterSpacing: '0.18em',
      textShadow: '0 0 28px rgba(255, 170, 100, 0.7)',
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
    const settings = button('SETTINGS', 'title-settings');
    settings.addEventListener('click', () => this.onSettings?.());

    box.append(title, tag, this.best, this.nickname, play, settings);
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

  show(): void {
    this.best.textContent = `BEST ${loadBest().toLocaleString('en-US')}`;
    show(this.root, true);
    this.visible = true;
  }

  hide(): void {
    show(this.root, false);
    this.visible = false;
    this.nickname.blur();
  }

  private play(): void {
    if (!this.visible) return;
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

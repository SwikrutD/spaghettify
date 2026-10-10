import { button, FONT, overlay, show } from './dom';

/**
 * Pause menu (resume, settings, quit run) plus the small corner pause button shown while a run is live. Online there is
 * no pause: the same menu opens over the running arena, and quitting leaves the arena.
 */
export class PauseMenu {
  onResume: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  /** The corner button asks for a pause. */
  onPauseRequest: (() => void) | null = null;
  private readonly root = overlay('pause-menu', 20);
  private readonly corner = document.createElement('button');
  private readonly title = document.createElement('div');
  private readonly note = document.createElement('div');
  private readonly quit: HTMLButtonElement;

  constructor(parent: HTMLElement = document.body) {
    const box = document.createElement('div');
    Object.assign(box.style, { padding: '24px', width: 'min(280px, 86vw)' });
    const title = this.title;
    title.textContent = 'PAUSED';
    Object.assign(title.style, { fontSize: '32px', fontWeight: '700', letterSpacing: '0.3em', marginBottom: '14px' });
    this.note.textContent = 'The arena keeps running.';
    Object.assign(this.note.style, { fontSize: '13px', opacity: '0.7', margin: '-6px 0 8px', display: 'none' });
    const resume = button('RESUME', 'resume', true);
    const settings = button('SETTINGS', 'pause-settings');
    const quit = button('QUIT RUN', 'quit-run');
    this.quit = quit;
    resume.addEventListener('click', () => this.onResume?.());
    settings.addEventListener('click', () => this.onSettings?.());
    quit.addEventListener('click', () => this.onQuit?.());
    box.append(title, this.note, resume, settings, quit);
    this.root.append(box);

    this.corner.textContent = 'II';
    this.corner.title = 'Pause (Esc)';
    this.corner.setAttribute('aria-label', 'Pause');
    this.corner.dataset.testid = 'pause-button';
    Object.assign(this.corner.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      border: '1px solid rgba(160, 180, 230, 0.4)',
      background: 'rgba(8, 12, 28, 0.6)',
      color: '#b8c4e0',
      fontFamily: FONT,
      fontSize: '13px',
      fontWeight: '700',
      cursor: 'pointer',
      padding: '0',
      display: 'none',
      zIndex: '5',
    });
    this.corner.addEventListener('click', () => {
      this.corner.blur();
      this.onPauseRequest?.();
    });
    parent.append(this.root, this.corner);
  }

  /** Online the menu opens over the running arena (nothing pauses) and quitting leaves the arena. */
  setOnline(online: boolean): void {
    this.title.textContent = online ? 'MENU' : 'PAUSED';
    this.note.style.display = online ? 'block' : 'none';
    this.quit.textContent = online ? 'LEAVE ARENA' : 'QUIT RUN';
    this.corner.title = online ? 'Menu (Esc)' : 'Pause (Esc)';
    this.corner.setAttribute('aria-label', online ? 'Menu' : 'Pause');
  }

  /** Show the menu while paused, or the corner button while a run is live and not paused. */
  setState(paused: boolean, runLive: boolean): void {
    show(this.root, paused);
    this.corner.style.display = runLive && !paused ? 'block' : 'none';
  }
}

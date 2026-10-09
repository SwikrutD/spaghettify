import type { AudioEngine } from '../audio/AudioEngine';

/**
 * Small corner control: a speaker button (mute toggle, also the M key) that opens music and SFX sliders.
 * Plain DOM. The full settings panel arrives in a later M7 part and can reuse the engine setters.
 */
export class AudioPanel {
  private readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly sliders = document.createElement('div');
  private readonly music = slider('Music');
  private readonly sfx = slider('SFX');

  constructor(private readonly audio: AudioEngine, parent: HTMLElement = document.body) {
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      color: '#b8c4e0',
      zIndex: '5',
    });
    this.root.dataset.testid = 'audio-panel';

    Object.assign(this.button.style, {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      border: '1px solid rgba(160, 180, 230, 0.4)',
      background: 'rgba(8, 12, 28, 0.6)',
      color: 'inherit',
      cursor: 'pointer',
      fontSize: '16px',
      padding: '0',
    });
    this.button.dataset.testid = 'mute-toggle';
    this.button.addEventListener('click', () => {
      this.audio.toggleMute();
      this.button.blur();
    });
    // The slider drawer opens on hover or keyboard focus and stays open while a slider is held.
    this.button.addEventListener('contextmenu', (e) => e.preventDefault());

    Object.assign(this.sliders.style, {
      display: 'none',
      gap: '12px',
      padding: '6px 12px',
      borderRadius: '18px',
      background: 'rgba(8, 12, 28, 0.6)',
      border: '1px solid rgba(160, 180, 230, 0.25)',
    });
    this.sliders.append(this.music.label, this.sfx.label);
    this.root.append(this.sliders, this.button);
    parent.append(this.root);

    this.root.addEventListener('pointerenter', () => (this.sliders.style.display = 'flex'));
    this.root.addEventListener('pointerleave', () => {
      if (!this.root.contains(document.activeElement) || document.activeElement === this.button) this.sliders.style.display = 'none';
    });
    this.music.input.addEventListener('input', () => this.audio.setMusic(Number(this.music.input.value)));
    this.sfx.input.addEventListener('input', () => this.audio.setSfx(Number(this.sfx.input.value)));
    // Releasing a slider hands the keyboard back to the game.
    for (const s of [this.music, this.sfx]) s.input.addEventListener('change', () => s.input.blur());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.audio.toggleMute();
    });

    this.audio.onChange = () => this.sync();
    this.sync();
  }

  private sync(): void {
    const a = this.audio;
    this.music.input.value = String(a.music);
    this.sfx.input.value = String(a.sfxVolume);
    this.button.textContent = a.muted ? '\u{1F507}' : '\u{1F50A}';
    this.button.setAttribute('aria-pressed', String(a.muted));
    this.button.setAttribute('aria-label', a.muted ? 'Unmute (M)' : 'Mute (M)');
    this.button.title = a.muted ? 'Unmute (M)' : 'Mute (M)';
    this.music.input.disabled = a.muted;
    this.sfx.input.disabled = a.muted;
  }
}

function slider(name: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement('label');
  label.style.display = 'flex';
  label.style.alignItems = 'center';
  label.style.gap = '6px';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.style.width = '80px';
  input.setAttribute('aria-label', `${name} volume`);
  input.dataset.testid = `${name.toLowerCase()}-volume`;
  label.append(name, input);
  return { label, input };
}

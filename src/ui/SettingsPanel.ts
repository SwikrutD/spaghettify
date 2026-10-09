import type { AudioEngine } from '../audio/AudioEngine';
import { MENU } from '../config';
import type { ControlScheme, Settings } from '../settings/Settings';
import { button, FONT, overlay, show } from './dom';

/** Settings: music and SFX volume, mute, control scheme and quality. Reachable from the title screen and the pause menu. */
export class SettingsPanel {
  onClose: (() => void) | null = null;
  private readonly root = overlay('settings-panel', 30);
  private readonly music = slider('Music');
  private readonly sfx = slider('SFX');
  private readonly mute = button('', 'mute-toggle');
  private readonly scheme = document.createElement('select');
  private readonly quality = document.createElement('select');
  private visible = false;

  constructor(
    private readonly audio: AudioEngine,
    private readonly settings: Settings,
    parent: HTMLElement = document.body,
  ) {
    const box = document.createElement('div');
    Object.assign(box.style, { padding: '24px', width: 'min(340px, 88vw)', textAlign: 'left' });
    const title = document.createElement('div');
    title.textContent = 'SETTINGS';
    Object.assign(title.style, { fontSize: '28px', fontWeight: '700', letterSpacing: '0.3em', marginBottom: '16px', textAlign: 'center' });

    for (const [value, label] of [['mouse', 'Mouse follow'], ['keyboard', 'Keyboard only']] as const) {
      this.scheme.append(new Option(label, value));
    }
    MENU.qualityNames.forEach((name, i) => this.quality.append(new Option(name, String(i))));
    this.scheme.dataset.testid = 'control-scheme';
    this.quality.dataset.testid = 'quality';
    this.scheme.setAttribute('aria-label', 'Controls');
    this.quality.setAttribute('aria-label', 'Quality');
    for (const s of [this.scheme, this.quality]) {
      Object.assign(s.style, {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#fff',
        background: 'rgba(8, 12, 28, 0.9)',
        border: '1px solid rgba(160, 180, 230, 0.4)',
        borderRadius: '6px',
        padding: '4px 8px',
      });
    }

    this.mute.style.margin = '14px 0 0';
    this.mute.addEventListener('click', () => {
      this.audio.toggleMute();
      this.mute.blur();
    });
    this.music.input.addEventListener('input', () => this.audio.setMusic(Number(this.music.input.value)));
    this.sfx.input.addEventListener('input', () => this.audio.setSfx(Number(this.sfx.input.value)));
    this.scheme.addEventListener('change', () => this.settings.setScheme(this.scheme.value as ControlScheme));
    this.quality.addEventListener('change', () => this.settings.setQuality(Number(this.quality.value)));

    const back = button('BACK', 'settings-back', true);
    back.addEventListener('click', () => this.onClose?.());

    box.append(title, this.music.row, this.sfx.row, this.mute, row('Controls', this.scheme), row('Quality', this.quality), back);
    this.root.append(box);
    parent.append(this.root);

    this.audio.onChange = () => this.sync();
    this.settings.onChange = () => this.sync();
    this.sync();
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(): void {
    this.sync();
    show(this.root, true);
    this.visible = true;
  }

  close(): void {
    show(this.root, false);
    this.visible = false;
  }

  private sync(): void {
    const a = this.audio;
    this.music.input.value = String(a.music);
    this.sfx.input.value = String(a.sfxVolume);
    this.mute.textContent = a.muted ? 'UNMUTE (M)' : 'MUTE (M)';
    this.mute.setAttribute('aria-pressed', String(a.muted));
    this.scheme.value = this.settings.scheme;
    this.quality.value = String(this.settings.quality);
  }
}

function row(name: string, control: HTMLElement): HTMLElement {
  const label = document.createElement('label');
  Object.assign(label.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '14px', fontSize: '14px' });
  label.append(name, control);
  return label;
}

function slider(name: string): { row: HTMLElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.style.width = '160px';
  input.setAttribute('aria-label', `${name} volume`);
  input.dataset.testid = `${name.toLowerCase()}-volume`;
  return { row: row(name, input), input };
}

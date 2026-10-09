import { MENU, QUALITY, STORAGE, type QualityChoice } from '../config';

export type ControlScheme = 'mouse' | 'keyboard' | 'finger' | 'joystick';

const SCHEMES: readonly ControlScheme[] = ['mouse', 'keyboard', 'finger', 'joystick'];

interface Stored {
  scheme: ControlScheme;
  quality: QualityChoice;
}

/** Quality was stored as a number (0 low, 1 medium, 2 high) before the auto scaler existed. */
const LEGACY_QUALITY: readonly QualityChoice[] = ['low', 'medium', 'high'];

/** Control scheme and quality choice, persisted in localStorage. Audio keeps its own store in AudioEngine. */
export class Settings {
  scheme: ControlScheme = isTouchFirst() ? MENU.defaultTouchScheme : MENU.defaultScheme;
  /** 'auto' lets the frame time scaler pick the level; the others are fixed presets. */
  quality: QualityChoice = QUALITY.defaultChoice;
  /** Called after any change (the apply hooks in main and the panel listen). */
  onChange: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE.settings);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Stored>;
      if (s.scheme && SCHEMES.includes(s.scheme)) this.scheme = s.scheme;
      const q: unknown = s.quality;
      if (typeof q === 'number') this.quality = LEGACY_QUALITY[Math.round(q)] ?? this.quality;
      else if (QUALITY.choices.includes(q as QualityChoice)) this.quality = q as QualityChoice;
    } catch {
      // Storage blocked or corrupt: defaults are fine.
    }
  }

  setScheme(scheme: ControlScheme): void {
    this.scheme = scheme;
    this.changed();
  }

  setQuality(choice: QualityChoice): void {
    if (!QUALITY.choices.includes(choice)) return;
    this.quality = choice;
    this.changed();
  }

  private changed(): void {
    try {
      const s: Stored = { scheme: this.scheme, quality: this.quality };
      localStorage.setItem(STORAGE.settings, JSON.stringify(s));
    } catch {
      // Settings are a convenience; ignore blocked storage.
    }
    this.onChange?.();
  }
}

/** A phone or tablet: the primary pointer is coarse and there is no hover. */
export function isTouchFirst(): boolean {
  try {
    return window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  } catch {
    return false;
  }
}

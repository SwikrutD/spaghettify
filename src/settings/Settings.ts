import { LENSING, MENU, STORAGE } from '../config';

export type ControlScheme = 'mouse' | 'keyboard' | 'finger' | 'joystick';

const SCHEMES: readonly ControlScheme[] = ['mouse', 'keyboard', 'finger', 'joystick'];

interface Stored {
  scheme: ControlScheme;
  quality: number;
}

/** Control scheme and quality level, persisted in localStorage. Audio keeps its own store in AudioEngine. */
export class Settings {
  scheme: ControlScheme = isTouchFirst() ? MENU.defaultTouchScheme : MENU.defaultScheme;
  quality: number = LENSING.quality;
  /** Called after any change (the apply hooks in main and the panel listen). */
  onChange: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE.settings);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Stored>;
      if (s.scheme && SCHEMES.includes(s.scheme)) this.scheme = s.scheme;
      if (typeof s.quality === 'number') this.quality = clampQuality(s.quality);
    } catch {
      // Storage blocked or corrupt: defaults are fine.
    }
  }

  setScheme(scheme: ControlScheme): void {
    this.scheme = scheme;
    this.changed();
  }

  setQuality(level: number): void {
    this.quality = clampQuality(level);
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

function clampQuality(level: number): number {
  return Math.min(LENSING.samples.length - 1, Math.max(0, Math.round(level)));
}

/** A phone or tablet: the primary pointer is coarse and there is no hover. */
function isTouchFirst(): boolean {
  try {
    return window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  } catch {
    return false;
  }
}

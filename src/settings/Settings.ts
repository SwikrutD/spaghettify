import { MENU, QUALITY, STORAGE, type QualityChoice } from '../config';

export type ControlScheme = 'mouse' | 'keyboard' | 'finger' | 'joystick';

const SCHEMES: readonly ControlScheme[] = ['mouse', 'keyboard', 'finger', 'joystick'];

/** Version of the stored settings: 2 since the touch default became the joystick (M22). */
const VERSION = 2;

interface Stored {
  v: number;
  scheme: ControlScheme;
  quality: QualityChoice;
  showPlayers: boolean;
}

/** Quality was stored as a number (0 low, 1 medium, 2 high) before the auto scaler existed. */
const LEGACY_QUALITY: readonly QualityChoice[] = ['low', 'medium', 'high'];

/** Control scheme, quality choice and the players online line, persisted in localStorage. Audio keeps its own store in AudioEngine. */
export class Settings {
  scheme: ControlScheme = isTouchFirst() ? MENU.defaultTouchScheme : MENU.defaultScheme;
  /** 'auto' lets the frame time scaler pick the level; the others are fixed presets. */
  quality: QualityChoice = QUALITY.defaultChoice;
  /** Online: the players in the room on the status line while playing (off by default; never on the title). */
  showPlayers: boolean = MENU.showPlayersDefault;
  /** Called after any change (the apply hooks in main and the panel listen). */
  onChange: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE.settings);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Stored>;
      if (s.scheme && SCHEMES.includes(s.scheme)) this.scheme = s.scheme;
      // Stored before the joystick became the touch default: finger follow was then only the default, not a choice.
      if (!s.v && s.scheme === 'finger') this.scheme = 'joystick';
      const q: unknown = s.quality;
      if (typeof q === 'number') this.quality = LEGACY_QUALITY[Math.round(q)] ?? this.quality;
      else if (QUALITY.choices.includes(q as QualityChoice)) this.quality = q as QualityChoice;
      if (typeof s.showPlayers === 'boolean') this.showPlayers = s.showPlayers;
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

  setShowPlayers(on: boolean): void {
    this.showPlayers = on;
    this.changed();
  }

  private changed(): void {
    try {
      const s: Stored = { v: VERSION, scheme: this.scheme, quality: this.quality, showPlayers: this.showPlayers };
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

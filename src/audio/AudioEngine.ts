import { AUDIO, PLAYER } from '../config';
import { Drone } from './Drone';
import { Sfx } from './Sfx';

interface Stored {
  music: number;
  sfx: number;
  muted: boolean;
}

/**
 * Web Audio entry point. The AudioContext is created on the first user gesture (browsers block it before),
 * and every call is safe when audio is blocked or unavailable: the engine just stays silent.
 *
 *   music bus (drone) -> musicGain -> master -> out
 *   sfx bus           -> sfxGain   -> master -> out
 *
 * Mute zeroes the master gain. Volumes and mute persist in localStorage.
 */
export class AudioEngine {
  context: AudioContext | null = null;
  music: number = AUDIO.defaultMusic;
  sfxVolume: number = AUDIO.defaultSfx;
  muted = false;
  /** How many times each effect was triggered this page load (debug and tests). */
  readonly played: Record<string, number> = {};
  /** Called when volume or mute changes (the UI listens). */
  onChange: (() => void) | null = null;

  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private drone: Drone | null = null;
  private sfx: Sfx | null = null;
  private failed = false;
  private warnTimer = 0;
  private lastGrowRadius: number = PLAYER.startRadius;
  private evaporating = false;

  constructor() {
    this.load();
    // Any gesture unlocks audio; keep listening so a context the browser re-suspended is resumed.
    const unlock = (): void => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
      window.addEventListener(type, unlock, { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      const ctx = this.context;
      if (!ctx) return;
      if (document.hidden) void ctx.suspend().catch(() => undefined);
      else void ctx.resume().catch(() => undefined);
    });
  }

  /** True once a context exists. */
  get ready(): boolean {
    return this.context !== null;
  }

  get state(): string {
    return this.context?.state ?? 'none';
  }

  private unlock(): void {
    if (this.failed) return;
    try {
      if (!this.context) this.create();
      if (this.context && this.context.state !== 'running' && !document.hidden) {
        void this.context.resume().catch(() => undefined);
      }
    } catch {
      this.failed = true;
    }
  }

  private create(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.failed = true;
      return;
    }
    const ctx = new Ctor();
    this.context = ctx;
    this.master = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.master.connect(ctx.destination);
    this.applyGains(true);
    this.drone = new Drone(ctx, this.musicGain);
    this.sfx = new Sfx(ctx, this.sfxGain);
  }

  setMusic(v: number): void {
    this.music = clamp01(v);
    this.applyGains(false);
    this.save();
    this.onChange?.();
  }

  setSfx(v: number): void {
    this.sfxVolume = clamp01(v);
    this.applyGains(false);
    this.save();
    this.onChange?.();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGains(false);
    this.save();
    this.onChange?.();
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  /** Gain actually applied to the music or sfx bus right now (0 when muted). */
  gainFor(bus: 'music' | 'sfx'): number {
    if (this.muted) return 0;
    const v = bus === 'music' ? this.music : this.sfxVolume;
    return Math.pow(v, AUDIO.volumeCurve) * (bus === 'music' ? AUDIO.musicLevel : AUDIO.sfxLevel);
  }

  private applyGains(immediate: boolean): void {
    const ctx = this.context;
    if (!ctx || !this.master || !this.musicGain || !this.sfxGain) return;
    const t = ctx.currentTime;
    const k = AUDIO.volumeSmoothing;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, immediate ? 0.001 : k);
    this.musicGain.gain.setTargetAtTime(Math.pow(this.music, AUDIO.volumeCurve) * AUDIO.musicLevel, t, immediate ? 0.001 : k);
    this.sfxGain.gain.setTargetAtTime(Math.pow(this.sfxVolume, AUDIO.volumeCurve) * AUDIO.sfxLevel, t, immediate ? 0.001 : k);
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(AUDIO.storageKey);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Stored>;
      if (typeof s.music === 'number') this.music = clamp01(s.music);
      if (typeof s.sfx === 'number') this.sfxVolume = clamp01(s.sfx);
      if (typeof s.muted === 'boolean') this.muted = s.muted;
    } catch {
      // Storage blocked or corrupt: defaults are fine.
    }
  }

  private save(): void {
    try {
      const s: Stored = { music: this.music, sfx: this.sfxVolume, muted: this.muted };
      localStorage.setItem(AUDIO.storageKey, JSON.stringify(s));
    } catch {
      // Volume is a convenience; ignore blocked storage.
    }
  }

  // ---- game events ---------------------------------------------------------------------------------

  /** A meal. `preyRadius` and `holeRadius` set the pitch: bigger prey sound lower. */
  eat(preyRadius: number, holeRadius: number): void {
    this.guard(() => this.sfx?.eat(preyRadius / Math.max(1e-6, holeRadius)), 'eat');
  }

  milestone(): void {
    this.guard(() => this.sfx?.milestone(), 'milestone');
  }

  /** A collision with a body or comet. */
  hit(): void {
    this.guard(() => this.sfx?.hit(), 'hit');
  }

  /** Fresh run: the drone comes back and the warning and growth trackers restart. */
  reset(radius: number): void {
    this.evaporating = false;
    this.warnTimer = 0;
    this.lastGrowRadius = radius;
    this.guard(() => this.drone?.fadeIn());
  }

  /**
   * Per-frame update. `hunger` is the smoothed 0..1 hunger level, `phase` the run phase, `dt` real seconds.
   */
  update(dt: number, radius: number, hunger: number, phase: 'playing' | 'evaporating' | 'over'): void {
    if (!this.context || !this.drone || !this.sfx) return;
    this.guard(() => {
      if (phase === 'evaporating' && !this.evaporating) {
        this.evaporating = true;
        this.sfx?.evaporate();
        this.count('evaporate');
        this.drone?.fadeOut();
      }
      this.drone?.update(radius, hunger);

      if (radius > this.lastGrowRadius * AUDIO.grow.radiusStep) {
        this.lastGrowRadius = radius;
        if (phase === 'playing') {
          this.sfx?.grow();
          this.count('grow');
        }
      } else if (radius < this.lastGrowRadius / AUDIO.grow.radiusStep) {
        // Shrunk from hunger: the next growth step counts from here.
        this.lastGrowRadius = radius;
      }

      // Hunger warning: a low pulse that speeds up as the hole gets hungrier.
      if (phase === 'playing' && hunger > AUDIO.warning.startLevel) {
        this.warnTimer -= dt;
        if (this.warnTimer <= 0) {
          const t = Math.min(1, (hunger - AUDIO.warning.startLevel) / (1 - AUDIO.warning.startLevel));
          this.warnTimer = AUDIO.warning.periodSlow + (AUDIO.warning.periodFast - AUDIO.warning.periodSlow) * t;
          this.sfx?.warning(t);
          this.count('warning');
        }
      } else {
        this.warnTimer = 0;
      }
    });
  }

  private count(event: string): void {
    this.played[event] = (this.played[event] ?? 0) + 1;
  }

  /** Audio must never break the game: swallow any error from the Web Audio calls. */
  private guard(fn: () => void, event?: string): void {
    try {
      fn();
      if (event && this.sfx) this.count(event);
    } catch {
      this.failed = true;
    }
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

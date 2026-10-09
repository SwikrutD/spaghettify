import { HUNGER } from '../config';

/** Hunger warning: a dark red vignette that closes in and a short line of text. Plain DOM above the canvas. */
export class HungerOverlay {
  private readonly vignette = document.createElement('div');
  private readonly text = document.createElement('div');
  /** Smoothed 0..1 level that the disk dimming also follows. */
  level = 0;

  constructor(parent: HTMLElement = document.body) {
    Object.assign(this.vignette.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      opacity: '0',
      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(70,6,20,0.55) 75%, rgba(0,0,0,0.95) 100%)',
    });
    Object.assign(this.text.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      bottom: '14%',
      textAlign: 'center',
      color: '#ffb4a0',
      fontFamily: 'system-ui, sans-serif',
      fontSize: 'clamp(14px, 2.4vw, 22px)',
      letterSpacing: '0.3em',
      textShadow: '0 0 14px rgba(255, 70, 40, 0.8)',
      pointerEvents: 'none',
      opacity: '0',
    });
    this.text.dataset.testid = 'hunger-warning';
    parent.append(this.vignette, this.text);
  }

  /** `target` is the raw hunger level; the displayed level follows it smoothly. */
  update(dt: number, target: number): void {
    this.level += (target - this.level) * (1 - Math.exp(-HUNGER.levelRate * dt));
    const l = this.level;
    // A slow pulse that quickens as the hole gets hungrier.
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.001 * (3 + 6 * l));
    this.vignette.style.opacity = String(Math.min(1, l * HUNGER.vignetteMax * pulse));
    const showText = l > HUNGER.warnTextLevel;
    this.text.textContent = showText ? (l > 0.75 ? 'EVAPORATING' : 'HAWKING RADIATION: EAT') : '';
    this.text.style.opacity = showText ? String(Math.min(1, (l - HUNGER.warnTextLevel) * 3) * pulse) : '0';
  }

  /** Clear instantly (new run). */
  reset(): void {
    this.level = 0;
    this.vignette.style.opacity = '0';
    this.text.style.opacity = '0';
    this.text.textContent = '';
  }
}

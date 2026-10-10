import { MILESTONE_FX } from '../config';

/** Size milestone overlay: a white flash and a title that fades out. Plain DOM above the canvas. */
export class MilestoneBanner {
  private readonly flashEl = document.createElement('div');
  private readonly bannerEl = document.createElement('div');
  private readonly kickerEl = document.createElement('div');
  private readonly titleEl = document.createElement('div');
  private hideAt = 0;

  constructor(parent: HTMLElement = document.body) {
    Object.assign(this.flashEl.style, {
      position: 'fixed',
      inset: '0',
      background: '#fff',
      opacity: '0',
      pointerEvents: 'none',
    });
    Object.assign(this.bannerEl.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      top: '18%',
      textAlign: 'center',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif',
      textShadow: '0 0 24px rgba(255, 190, 120, 0.8)',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.5s',
    });
    Object.assign(this.kickerEl.style, { fontSize: '14px', letterSpacing: '0.4em', opacity: '0.8' });
    Object.assign(this.titleEl.style, { fontSize: 'clamp(28px, 6vw, 56px)', fontWeight: '700', letterSpacing: '0.08em' });
    this.bannerEl.append(this.kickerEl, this.titleEl);
    this.bannerEl.dataset.testid = 'milestone-banner';
    parent.append(this.flashEl, this.bannerEl);
  }

  /** `kicker` is the small line above the title (what the milestone means). */
  show(kicker: string, title: string): void {
    this.kickerEl.textContent = kicker;
    this.titleEl.textContent = title;
    this.bannerEl.style.opacity = '1';
    this.hideAt = performance.now() + MILESTONE_FX.bannerTime * 1000;
  }

  /** Hide at once (new run). */
  reset(): void {
    this.bannerEl.style.opacity = '0';
    this.hideAt = 0;
  }

  update(flash: number): void {
    this.flashEl.style.opacity = String(flash * MILESTONE_FX.flashPeak);
    if (this.hideAt && performance.now() > this.hideAt) {
      this.bannerEl.style.opacity = '0';
      this.hideAt = 0;
    }
  }
}

import type { Renderer } from '../render/Renderer';
import { FONT } from './dom';

/**
 * Debug readout for performance checks on real devices (open the game with `?perf`): fps, frame and
 * CPU time, render size, quality level and, where the browser has the timer extension (desktop
 * Chrome; most phones do not), GPU milliseconds per render pass.
 */
export class PerfOverlay {
  private readonly el = document.createElement('div');
  private time = 0;
  private frames = 0;
  private worst = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly level: () => number,
  ) {
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '8px',
      top: '8px',
      zIndex: '50',
      padding: '6px 8px',
      font: `11px/1.35 ${FONT}`,
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'pre',
      color: '#cfe',
      background: 'rgba(0, 0, 0, 0.6)',
      borderRadius: '4px',
      pointerEvents: 'none',
    });
    this.el.dataset.testid = 'perf-overlay';
    document.body.append(this.el);
    renderer.enableProfiling();
  }

  frame(ms: number, cpuMs: number): void {
    if (ms > 1000) return;
    this.time += ms;
    this.frames++;
    this.worst = Math.max(this.worst, ms);
    if (this.time < 500) return;
    const gl = this.renderer.gl.getContext();
    const lines = [
      `${((this.frames * 1000) / this.time).toFixed(0)} fps  ${(this.time / this.frames).toFixed(1)} ms  worst ${this.worst.toFixed(0)}`,
      `cpu ${cpuMs.toFixed(2)} ms`,
      `quality ${this.level()}  ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} @${this.renderer.pixelRatio.toFixed(2)}`,
    ];
    const timer = this.renderer.timer;
    if (timer) {
      let total = 0;
      for (const [label, value] of Object.entries(timer.ms)) {
        total += value;
        lines.push(`${label.padEnd(7)}${value.toFixed(2)} ms`);
      }
      lines.push(`gpu    ${total.toFixed(2)} ms`);
    } else {
      lines.push('gpu timer n/a');
    }
    this.el.textContent = lines.join('\n');
    this.time = 0;
    this.frames = 0;
    this.worst = 0;
  }
}

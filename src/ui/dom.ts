/** Shared DOM helpers for the menus. Plain DOM above the canvas, same look as the score screen. */

export const FONT = 'system-ui, sans-serif';

export function overlay(testid: string, z: number): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.55), rgba(0,0,0,0.9))',
    color: '#fff',
    fontFamily: FONT,
    textAlign: 'center',
    zIndex: String(z),
  });
  el.dataset.testid = testid;
  return el;
}

export function button(text: string, testid: string, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.dataset.testid = testid;
  Object.assign(b.style, {
    display: 'block',
    width: '100%',
    margin: '10px 0 0',
    padding: primary ? '14px 40px' : '10px 28px',
    fontSize: primary ? '18px' : '14px',
    letterSpacing: '0.2em',
    fontWeight: '700',
    fontFamily: FONT,
    color: '#fff',
    background: primary ? 'rgba(255, 150, 70, 0.18)' : 'rgba(160, 180, 230, 0.08)',
    border: `2px solid ${primary ? 'rgba(255, 170, 100, 0.9)' : 'rgba(160, 180, 230, 0.4)'}`,
    borderRadius: '8px',
    cursor: 'pointer',
  });
  return b;
}

export function show(el: HTMLElement, visible: boolean): void {
  el.style.display = visible ? 'flex' : 'none';
}

/** Text made safe to put inside innerHTML (nicknames come from players). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

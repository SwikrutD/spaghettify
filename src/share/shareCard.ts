import { SHARE } from '../config';
import { ladderLine } from '../ui/milestones';
import type { RunStats } from '../ui/ScoreScreen';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** The game URL without the scheme, as printed on the card. */
export function displayUrl(): string {
  return SHARE.url.replace(/^https?:\/\//, '');
}

/** Text that goes with the image in the share sheet. */
export function shareText(stats: RunStats): string {
  const score = stats.score.toLocaleString('en-US');
  const holes = stats.holesEaten > 0 ? ` and swallowed ${stats.holesEaten} ${stats.holesEaten === 1 ? 'black hole' : 'black holes'}` : '';
  return `${ladderLine(stats.biggest)} as a baby black hole in Spaghettify${holes} and scored ${score}. ${SHARE.url}`;
}

export function cardFileName(stats: RunStats): string {
  return `${SHARE.filePrefix}-${stats.score}.png`;
}

/**
 * Draws the share card: the run screenshot with the hole on the right, and on the left the score, the
 * biggest object eaten, the size milestone reached and the game URL. Returns a fresh canvas of SHARE.width x height.
 */
export function renderShareCard(stats: RunStats, snapshot: HTMLCanvasElement | null): HTMLCanvasElement {
  const W = SHARE.width;
  const H = SHARE.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#02030a';
  ctx.fillRect(0, 0, W, H);
  if (snapshot && snapshot.width > 1 && snapshot.height > 1) drawSnapshot(ctx, snapshot, W, H);
  else drawStars(ctx, W, H);

  // Text panel: the left side fades to near black so the text reads over any scene.
  const shade = ctx.createLinearGradient(0, 0, W * 0.62, 0);
  shade.addColorStop(0, 'rgba(2, 3, 10, 0.92)');
  shade.addColorStop(0.55, 'rgba(2, 3, 10, 0.7)');
  shade.addColorStop(1, 'rgba(2, 3, 10, 0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  const vignette = ctx.createRadialGradient(W * SHARE.holeX, H / 2, H * 0.4, W * SHARE.holeX, H / 2, W * 0.75);
  vignette.addColorStop(0, 'rgba(2, 3, 10, 0)');
  vignette.addColorStop(1, 'rgba(2, 3, 10, 0.6)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  const x = 64;
  const maxText = W * 0.5;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  text(ctx, 'SPAGHETTIFY', x, 92, `700 30px ${FONT}`, '#ffffff', 0.3, maxText);
  ctx.fillStyle = 'rgba(255, 170, 100, 0.9)';
  ctx.fillRect(x, 112, 72, 3);

  text(ctx, 'SCORE', x, 196, `600 20px ${FONT}`, 'rgba(255, 255, 255, 0.65)', 0.35, maxText);
  const score = stats.score.toLocaleString('en-US');
  ctx.shadowColor = 'rgba(255, 170, 100, 0.55)';
  ctx.shadowBlur = 28;
  text(ctx, score, x - 4, 300, fitFont(ctx, score, 700, 112, maxText), '#ffffff', 0, maxText);
  ctx.shadowBlur = 0;
  if (stats.newBest) text(ctx, 'NEW BEST', x, 340, `700 20px ${FONT}`, 'rgba(255, 190, 120, 1)', 0.35, maxText);

  const ladder = ladderLine(stats.biggest);
  ctx.shadowColor = 'rgba(255, 190, 120, 0.8)';
  ctx.shadowBlur = 20;
  text(ctx, ladder, x, 420, fitFont(ctx, ladder, 600, 46, maxText), '#ffe6cc', 0, maxText);
  ctx.shadowBlur = 0;

  const size = stats.milestoneTitle.toUpperCase();
  text(ctx, size, x, 470, `600 22px ${FONT}`, 'rgba(255, 255, 255, 0.8)', 0.2, maxText);
  const mins = Math.floor(stats.seconds / 60);
  const secs = String(Math.floor(stats.seconds % 60)).padStart(2, '0');
  const eaten = `${stats.eatenCount.toLocaleString('en-US')} ${stats.eatenCount === 1 ? 'object' : 'objects'} spaghettified in ${mins}:${secs}`;
  text(ctx, eaten, x, 504, `400 20px ${FONT}`, 'rgba(255, 255, 255, 0.6)', 0, maxText);
  // Arena lines: the holes swallowed, who ended the life and which arena it was.
  const arena: string[] = [];
  if (stats.holesEaten > 0) arena.push(`${stats.holesEaten} ${stats.holesEaten === 1 ? 'black hole' : 'black holes'} swallowed`);
  if (stats.eatenBy) arena.push(`eaten by ${stats.eatenBy}`);
  // A long nickname shrinks the line's font rather than squeezing its letters.
  const arenaLine = arena.join(', ');
  if (arena.length) text(ctx, arenaLine, x, 538, fitFont(ctx, arenaLine, 400, 20, maxText), 'rgba(255, 190, 120, 0.9)', 0, maxText);
  text(ctx, stats.online ? 'ONLINE ARENA' : 'OFFLINE ARENA', x, 134 + 14, `600 13px ${FONT}`, 'rgba(255, 255, 255, 0.45)', 0.35, maxText);

  text(ctx, 'How big can you grow?', x, H - 92, `400 22px ${FONT}`, 'rgba(255, 255, 255, 0.75)', 0, maxText);
  text(ctx, displayUrl(), x, H - 56, `700 26px ${FONT}`, 'rgba(255, 190, 120, 1)', 0.05, maxText);
  return canvas;
}

/**
 * The screenshot scaled to cover the card, with its centre (the hole) moved to SHARE.holeX. Shifting it
 * right can leave a strip on the left uncovered; the dark text panel sits there anyway, so the photo is
 * not zoomed further just to fill it.
 */
function drawSnapshot(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, W: number, H: number): void {
  const cx = W * SHARE.holeX;
  const scale = Math.max(H / img.height, W / img.width, (2 * (W - cx)) / img.width);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, cx - w / 2, (H - h) / 2, w, h);
}

/** Fallback backdrop when the run has no screenshot: a seeded star field. */
function drawStars(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 420; i++) {
    const r = rand() < 0.08 ? 1.6 : 0.8;
    ctx.fillStyle = `rgba(220, 230, 255, ${0.25 + rand() * 0.6})`;
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * H, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  font: string,
  color: string,
  spacingEm: number,
  maxWidth: number,
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 16);
  // letterSpacing is missing in older browsers; the card still reads without it.
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacingEm * size}px`;
  ctx.fillText(value, x, y, maxWidth);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

/** Largest font up to `maxPx` at which `value` fits in `maxWidth`. */
function fitFont(ctx: CanvasRenderingContext2D, value: string, weight: number, maxPx: number, maxWidth: number): string {
  let px = maxPx;
  ctx.font = `${weight} ${px}px ${FONT}`;
  const width = ctx.measureText(value).width;
  if (width > maxWidth) px = Math.max(12, Math.floor((px * maxWidth) / width));
  return `${weight} ${px}px ${FONT}`;
}

/** PNG blob of a canvas (null if the browser cannot encode it). */
export function cardBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

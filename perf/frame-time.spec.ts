/**
 * Frame time probe (not part of `npm test`). Run with `npm run perf` on a machine with a GPU.
 * Uses the real GPU through ANGLE D3D11 with vsync and the frame rate limit off, so frames run
 * uncapped, and times each render pass with EXT_disjoint_timer_query_webgl2 (Renderer.enableProfiling).
 * Prints GPU ms per pass, CPU ms per frame and uncapped fps for each viewport and variant.
 *
 * A mid-range phone GPU has very roughly 1/8 of a GTX 1070 Ti's ALU and bandwidth, so a phone
 * viewport frame should stay well under ~2 ms GPU here to have a chance at 60 fps on the phone.
 */
import { test, type Page } from '@playwright/test';

interface Viewport {
  name: string;
  width: number;
  height: number;
  dpr: number;
}

const VIEWPORTS: Viewport[] = [
  { name: 'laptop 1280x720 @1', width: 1280, height: 720, dpr: 1 },
  { name: 'desktop 1920x1080 @2', width: 1920, height: 1080, dpr: 2 },
  { name: 'phone 412x915 @2.625', width: 412, height: 915, dpr: 2.625 },
];

/** Page-side setup per variant (`d` is the debug handle). Each runs on a fresh page. */
const VARIANTS: Record<string, string> = {
  'level 0': 'd.forceQuality(0);',
  'no disk': 'd.forceQuality(0); d.player.disk.group.children[0].visible = false;',
  'no prey': 'd.forceQuality(0); d.prey.mesh.visible = false;',
  'no stars': 'd.forceQuality(0); d.player.group.parent.children.find((o) => o.isPoints).visible = false;',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`level ${i}`, `d.forceQuality(${i});`])),
};

async function measure(page: Page, setup: string): Promise<Record<string, number>> {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __spaghettify?: { frames: number } }).__spaghettify?.frames ?? 0 > 10);
  await page.getByTestId('play').dispatchEvent('click');
  return page.evaluate(async (setup) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (window as any).__spaghettify;
    d.hunger.enabled = false;
    // Fully fed disk (the widest, brightest case) for the whole sample.
    d.player.disk.activity = 1e6;
    new Function('d', setup)(d);
    if (!d.renderer.enableProfiling()) throw new Error('no timer query extension');
    await new Promise((r) => setTimeout(r, 1500));
    d.renderer.timer.clear();
    const f0 = d.frames;
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 2500));
    const fps = ((d.frames - f0) * 1000) / (performance.now() - t0);
    const ms: Record<string, number> = { ...d.renderer.timer.ms };
    const gpu = Object.values(ms).reduce((a, b) => a + b, 0);
    const gl = d.renderer.gl.getContext();
    // Draw calls per frame, counted over a few frames (the composer renders several times per frame).
    const info = d.renderer.gl.info;
    info.autoReset = false;
    info.reset();
    const f1 = d.frames;
    await new Promise((r) => setTimeout(r, 300));
    const calls = info.render.calls / (d.frames - f1);
    return { ...ms, gpu, cpu: d.cpuMs, fps, calls, w: gl.drawingBufferWidth, h: gl.drawingBufferHeight };
  }, setup);
}

const fmt = (n: number | undefined) => (n === undefined ? '-' : n.toFixed(3));

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });
    test('frame time', async ({ page }) => {
      const rows: string[] = [];
      for (const [name, setup] of Object.entries(VARIANTS)) {
        const m = await measure(page, setup);
        rows.push(
          `${name.padEnd(10)} ${m.w}x${m.h}  gpu ${fmt(m.gpu)}  scene ${fmt(m.scene)}  lens ${fmt(m.lens)}  hole ${fmt(m.hole)}  noise ${fmt(m.noise)}  bloom ${fmt(m.bloom)}  core ${fmt(m.core)}  output ${fmt(m.output)}  cpu ${fmt(m.cpu)}  fps ${m.fps.toFixed(0)}  calls ${m.calls.toFixed(0)}`,
        );
      }
      console.log(`\n== ${vp.name}\n${rows.join('\n')}`);
    });
  });
}

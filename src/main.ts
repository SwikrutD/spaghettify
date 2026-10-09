import * as THREE from 'three';
import { DANGER, HUNGER, JUICE, LIGHTING, QUALITY, RENDER, TIERS, type Tier } from './config';
import { initAnalytics, scoreBand, track } from './analytics/analytics';
import { AudioEngine } from './audio/AudioEngine';
import { objectView, poolView } from './debug/debugViews';
import { ShedBurst } from './effects/ShedBurst';
import { TierSetPiece } from './effects/TierSetPiece';
import { CometFieldMesh } from './entities/CometFieldMesh';
import { DebrisMesh } from './entities/DebrisMesh';
import { PreyFieldMesh } from './entities/PreyFieldMesh';
import type { BodyFrame } from './entities/PreyMesh';
import { InputManager } from './input/InputManager';
import { GamepadInput } from './input/GamepadInput';
import { KeyboardInput } from './input/KeyboardInput';
import { MouseInput } from './input/MouseInput';
import { TouchInput } from './input/TouchInput';
import { blink, HoleMesh } from './player/HoleMesh';
import { AutoQuality } from './render/AutoQuality';
import { GameCamera } from './render/GameCamera';
import { Renderer } from './render/Renderer';
import { createStarfield } from './scene/Starfield';
import { RunSnapshot } from './share/RunSnapshot';
import { deliverCard, shareMethod } from './share/share';
import { cardBlob, cardFileName, renderShareCard, shareText } from './share/shareCard';
import { isTouchFirst, Settings } from './settings/Settings';
import { canSwallow } from './sim/body.ts';
import type { AteEvent } from './sim/events.ts';
import type { Meal } from './sim/Hole.ts';
import { World } from './sim/World.ts';
import { HungerOverlay } from './ui/HungerOverlay';
import { postRunToBoard, refreshTitleBoard } from './ui/leaderboardFlow';
import { PauseMenu } from './ui/PauseMenu';
import { PerfOverlay } from './ui/PerfOverlay';
import { ScoreScreen, type RunStats } from './ui/ScoreScreen';
import { SettingsPanel } from './ui/SettingsPanel';
import { TierBanner } from './ui/TierBanner';
import { loadBest, saveBest, TitleScreen } from './ui/TitleScreen';

initAnalytics();
const canvas = document.getElementById('game') as HTMLCanvasElement;

// The game state and rules (src/sim). The local player is the world's focus hole, steered by the input vector.
const world = new World({ seed: (Math.random() * 2 ** 32) >>> 0 });
const local = world.focus;

// What the world looks like. These only read the sim state and react to its events.
const scene = new THREE.Scene();
const holeMesh = new HoleMesh();
const preyMesh = new PreyFieldMesh(world.prey);
const cometMesh = new CometFieldMesh(world.comets);
const debrisMesh = new DebrisMesh(world.debris);
const shedBurst = new ShedBurst();
const starfield = createStarfield();
const keyLight = new THREE.DirectionalLight(LIGHTING.keyColor, LIGHTING.key);
keyLight.position.set(...LIGHTING.keyPosition);
scene.add(starfield.points, holeMesh.group, preyMesh.group, cometMesh.group, debrisMesh.object3d, shedBurst.points, new THREE.AmbientLight(0xffffff, LIGHTING.ambient), keyLight);
const bodyFrame: BodyFrame = { world, alpha: 1, dt: 0, hole: holeMesh };
const gameCamera = new GameCamera(local.view, holeMesh.position);
const setPiece = new TierSetPiece();

const audio = new AudioEngine();
const settings = new Settings();
const snapshot = new RunSnapshot();
const banner = new TierBanner();
const hungerOverlay = new HungerOverlay();
const scoreScreen = new ScoreScreen();

/** The local hole ate: the disk heats; a new biggest meal is the share card's photo; the camera kicks (and shakes for big ones). */
function onAte(e: AteEvent): void {
  holeMesh.disk.feed(e.gained / e.holeMass);
  if (!e.what) return;
  // Taken a moment later, while it spaghettifies.
  if (e.biggest) snapshot.request();
  audio.eat(e.what.radius, e.holeRadius);
  const ratio = e.what.radius / e.holeRadius;
  gameCamera.addKick(ratio * JUICE.kickPerRatio);
  if (ratio >= JUICE.shakeMinRatio) gameCamera.addShake(Math.min(JUICE.shakeMax, ratio * JUICE.shakePerRatio));
}

/** The local hole reached a new tier (the sim already swapped the prey table and dips time): flash, banner, sound, shake. */
function onTier(tier: Tier, index: number): void {
  setPiece.start();
  banner.show(index + 1, tier.title);
  audio.tierUp();
  gameCamera.addShake(JUICE.tierShake);
}

/** React to what the world did since the last frame. Other holes' events are not drawn yet. */
function handleEvents(): void {
  for (const e of world.events) {
    if (e.hole !== local.id) continue;
    switch (e.type) {
      case 'ate':
        onAte(e);
        break;
      case 'bumped':
        // A hit: shake, thud and a spray of sparks (the sim throws the shed mass out as debris).
        gameCamera.addShake(DANGER.hitShake);
        audio.hit();
        shedBurst.emit(e.x, e.z, e.nx, e.nz, e.radius);
        break;
      case 'shed':
        holeMesh.squash();
        break;
      case 'tier':
        onTier(TIERS[e.index], e.index);
        break;
      case 'died':
        endRun();
        break;
    }
  }
  world.clearEvents();
}

// Life over: score = mass eaten (scaled to points), shown with the biggest meal and the tier reached.
function endRun(): void {
  const score = Math.round(local.eatenMass * HUNGER.pointsPerMass);
  const previous = loadBest();
  const newBest = score > previous;
  if (newBest) saveBest(score);
  const stats: RunStats = {
    score,
    best: Math.max(score, previous),
    newBest,
    biggest: local.biggestEaten,
    tierNumber: local.tier + 1,
    tierTitle: TIERS[local.tier].title,
    eatenCount: local.eatenCount,
    seconds: local.hunger.runTime,
  };
  scoreScreen.show(stats);
  prepareShare(stats);
  void postRunToBoard(scoreScreen.board, stats, title.nicknameValue);
  track('run-end', {
    band: scoreBand(score),
    tier: local.tier + 1,
    seconds: Math.round(local.hunger.runTime),
    eaten: local.eatenCount,
    newBest,
  });
  refreshMenus();
}

// Share card: rendered as the score screen opens, so the button can hand it to the share sheet at once
// (Web Share needs the tap's user activation).
const share = { stats: null as RunStats | null, card: null as HTMLCanvasElement | null, blob: null as Promise<Blob | null> | null };
const method = shareMethod();
function prepareShare(stats: RunStats): void {
  share.stats = stats;
  share.card = renderShareCard(stats, snapshot.image);
  share.blob = cardBlob(share.card);
  scoreScreen.setShare(method === 'share' ? 'SHARE' : 'SAVE CARD', true);
}
let sharing = false;
scoreScreen.onShare = async () => {
  const stats = share.stats;
  if (!stats || !share.blob || sharing) return;
  sharing = true;
  try {
    const blob = await share.blob;
    if (!blob) {
      scoreScreen.setStatus('Could not make the card');
      return;
    }
    const used = await deliverCard(blob, cardFileName(stats), shareText(stats), method);
    if (!used) return;
    scoreScreen.setStatus(used === 'download' ? 'Card saved' : 'Shared');
    track('share', { method: used, band: scoreBand(stats.score), tier: stats.tierNumber });
  } finally {
    sharing = false;
  }
};

/** Steps not yet run: real seconds carried over to the next frame. */
let pending = 0;

/** Draw the world as of `alpha` (0..1) between its last two steps. `dt` is game seconds since the last frame. */
function renderWorld(dt: number, alpha: number): void {
  holeMesh.update(dt, local, alpha);
  bodyFrame.alpha = alpha;
  bodyFrame.dt = dt;
  preyMesh.update(bodyFrame);
  cometMesh.update(bodyFrame);
  debrisMesh.update(bodyFrame);
  shedBurst.update(dt);
}

// Fresh run: the world (hole, tier, prey pool, comets, debris, hunger), then the camera and everything drawn from it.
function resetRun(): void {
  world.reset();
  pending = 0;
  holeMesh.reset(local);
  gameCamera.reset(holeMesh.position);
  shedBurst.reset();
  setPiece.reset();
  hungerOverlay.reset();
  banner.reset();
  audio.reset(local.radius);
  snapshot.reset();
  renderWorld(0, 1);
}

const renderer = new Renderer(canvas, scene, gameCamera.camera, holeMesh);
renderer.onBeforeRender = (gl) => holeMesh.disk.prepare(gl);
const touch = new TouchInput(canvas);
const input = new InputManager([
  { id: 'keyboard', source: new KeyboardInput() },
  { id: 'gamepad', source: new GamepadInput() },
  { id: 'touch', source: touch },
  { id: 'mouse', source: new MouseInput(canvas) },
]);

// Menus and run state. The run does not advance in 'title' or 'paused'; the scene keeps rendering behind the menus.
type Mode = 'title' | 'playing' | 'paused';
let mode: Mode = 'title';
const title = new TitleScreen();
const pauseMenu = new PauseMenu();
const settingsPanel = new SettingsPanel(audio, settings);
let settingsReturn: 'title' | 'pause' = 'title';

// Render quality: a fixed preset, or Auto, where the scaler picks a level from the frame time.
const autoQuality = new AutoQuality(isTouchFirst());
function qualityLevel(): number {
  return settings.quality === 'auto' ? autoQuality.level : QUALITY.presets[settings.quality];
}
function applyQuality(index = qualityLevel()): void {
  const level = QUALITY.levels[index];
  renderer.setQuality(level);
  holeMesh.disk.setDetail(level.diskLayers, level.diskOctaves);
  holeMesh.disk.setRenderHeight(renderer.bufferHeight);
  shedBurst.setViewport(renderer.bufferHeight, gameCamera.camera.fov);
}
autoQuality.onChange = () => applyQuality();

function applySettings(): void {
  input.setEnabled('mouse', settings.scheme === 'mouse');
  const touchScheme = settings.scheme === 'finger' || settings.scheme === 'joystick';
  input.setEnabled('touch', touchScheme);
  if (touchScheme) touch.setMode(settings.scheme as 'finger' | 'joystick');
  else touch.release();
  autoQuality.setEnabled(settings.quality === 'auto');
  applyQuality();
}
const syncSettingsPanel = settings.onChange;
settings.onChange = () => {
  syncSettingsPanel?.();
  applySettings();
};
applySettings();

function runLive(): boolean {
  return mode === 'playing' && local.phase !== 'over';
}
function refreshMenus(): void {
  pauseMenu.setState(mode === 'paused', runLive());
}
function setMode(next: Mode): void {
  mode = next;
  if (next !== 'playing') touch.release();
  refreshMenus();
}
function pause(): void {
  if (runLive()) setMode('paused');
}
function resume(): void {
  if (mode === 'paused') setMode('playing');
}
function openSettings(from: 'title' | 'pause'): void {
  settingsReturn = from;
  settingsPanel.open();
}
function closeSettings(): void {
  settingsPanel.close();
  if (settingsReturn === 'title') title.show();
}

title.onPlay = () => {
  title.hide();
  setMode('playing');
  track('run-start', { from: 'title' });
};
title.onShow = () => void refreshTitleBoard(title.board, title.nicknameValue);
title.onSettings = () => {
  title.hide();
  openSettings('title');
};
pauseMenu.onResume = resume;
pauseMenu.onPauseRequest = pause;
pauseMenu.onSettings = () => openSettings('pause');
pauseMenu.onQuit = () => {
  resetRun();
  setMode('title');
  title.show();
};
settingsPanel.onClose = closeSettings;
scoreScreen.onRestart = () => {
  resetRun();
  refreshMenus();
  track('run-start', { from: 'restart' });
};

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape') {
    if (settingsPanel.isOpen) closeSettings();
    else if (mode === 'playing') pause();
    else if (mode === 'paused') resume();
  } else if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) {
    audio.toggleMute();
  }
});
// Losing focus or hiding the tab pauses a live run.
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
title.show();

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h);
  holeMesh.disk.setRenderHeight(renderer.bufferHeight);
  gameCamera.resize(w, h);
  shedBurst.setViewport(renderer.bufferHeight, gameCamera.camera.fov);
}
window.addEventListener('resize', resize);
resize();
renderWorld(0, 1);

// Debug handle used by the Playwright smoke test and the console. Sim objects are shown through views whose
// {x, z} vectors behave like THREE.Vector3 (see debugViews); writes go straight into the sim.
const pixelReads: { x: number; y: number; resolve: (rgb: number[]) => void }[] = [];
const debug = {
  frames: 0,
  /** Smoothed CPU milliseconds per frame (simulation steps, drawing and issuing the draw calls). */
  cpuMs: 0,
  world,
  player: objectView(local, {
    disk: holeMesh.disk,
    group: holeMesh.group,
    setRadius(r: number) {
      local.radius = local.prevRadius = r;
    },
    /** Credit a meal straight away, with all its feedback (the event is handled at once). */
    eat(mass: number, what?: Meal) {
      world.eat(local, mass, what ?? null);
      handleEvents();
    },
  }),
  prey: {
    get objects() {
      return poolView(world.prey.objects);
    },
    get liveCount() {
      return world.prey.liveCount;
    },
    /** True if the local hole is big enough to eat this object. */
    isEdible: (obj: { radius: number }) => canSwallow(obj.radius, local.radius),
    meshOf: (i: number) => preyMesh.meshOf(i),
    group: preyMesh.group,
  },
  comets: {
    get objects() {
      return poolView(world.comets.objects);
    },
    get launched() {
      return world.comets.launched;
    },
    launch: (x: number, z: number, vx: number, vz: number, radius: number) => world.comets.launch(x, z, vx, vz, radius),
    spawn: () => world.comets.spawn(),
    reset: (tier: Tier) => world.comets.reset(tier),
  },
  debris: {
    get objects() {
      return poolView(world.debris.objects);
    },
    get live() {
      return world.debris.live;
    },
    get liveMass() {
      return world.debris.liveMass;
    },
    get emitted() {
      return world.debris.emitted;
    },
    reset: () => world.debris.reset(),
  },
  dangers: {
    get enabled() {
      return world.dangers.enabled;
    },
    set enabled(on: boolean) {
      world.dangers.enabled = on;
    },
    get invulnerable() {
      return local.invulnerable;
    },
    set invulnerable(seconds: number) {
      local.invulnerable = seconds;
    },
    get hits() {
      return local.hits;
    },
    get shedMass() {
      return local.shedMass;
    },
  },
  tiers: {
    get index() {
      return local.tier;
    },
    get tier() {
      return TIERS[local.tier];
    },
    get timeScale() {
      return world.timeScale;
    },
  },
  get hunger() {
    return local.hunger;
  },
  shedBurst,
  hungerOverlay,
  audio,
  settings,
  touch,
  input,
  get mode() {
    return mode;
  },
  allTiers: TIERS,
  camera: gameCamera,
  renderer,
  snapshot,
  share,
  autoQuality,
  get qualityLevel() {
    return qualityLevel();
  },
  /** Profiling: stop the scaler and render at one level until the next settings change. */
  forceQuality(index: number) {
    autoQuality.setEnabled(false);
    applyQuality(index);
  },
  /** Final RGB at a canvas pixel (CSS pixels, y down), read right after the next frame renders. */
  readPixel: (x: number, y: number) => new Promise<number[]>((resolve) => pixelReads.push({ x, y, resolve })),
};
(window as unknown as { __spaghettify: typeof debug }).__spaghettify = debug;

// `?perf` in the URL shows frame time, GPU time per pass (where the browser allows it) and the quality level.
const perfOverlay = new URLSearchParams(location.search).has('perf') ? new PerfOverlay(renderer, () => qualityLevel()) : null;

function drawFrame(start: number): void {
  renderer.render();
  snapshot.afterRender(canvas);
  for (const read of pixelReads.splice(0)) read.resolve(renderer.readPixel(read.x, read.y));
  debug.frames++;
  debug.cpuMs += (performance.now() - start - debug.cpuMs) * 0.05;
  requestAnimationFrame(frame);
}

let last = performance.now();
function frame(now: number): void {
  const start = performance.now();
  const frameMs = now - last;
  const realDt = Math.min(frameMs / 1000, RENDER.maxFrameDt);
  last = now;
  autoQuality.frame(frameMs);
  perfOverlay?.frame(frameMs, debug.cpuMs);
  if (mode !== 'playing') {
    drawFrame(start);
    return;
  }
  input.update();
  // Screen up is -Z on the play plane. The sim ignores input once the hole is out of play.
  local.input.x = input.move.x;
  local.input.z = -input.move.y;
  setPiece.update(realDt);
  // Fixed steps of real time; whatever is left over carries to the next frame and the drawing interpolates into it.
  pending += realDt;
  while (pending >= world.dt) {
    world.step();
    pending -= world.dt;
  }
  handleEvents();
  const alpha = pending / world.dt;
  // Game time (slowed during the tier-up) for everything animated; the camera and overlays run on real time.
  const dt = realDt * world.timeScale;
  snapshot.update(realDt);
  // A run with no photo yet gets one as the hole starts to evaporate.
  if (local.phase === 'evaporating') snapshot.ensure();
  hungerOverlay.update(realDt, local.hunger.level);
  // The disk dims as the hole starves and blinks while it is invulnerable after a hit.
  holeMesh.disk.starvation = Math.max(hungerOverlay.level, blink(local));
  renderWorld(dt, alpha);
  audio.update(realDt, local.radius, hungerOverlay.level, local.phase);
  gameCamera.punch = setPiece.punch;
  gameCamera.update(realDt, holeMesh.position);
  starfield.update(holeMesh.position, local.view.viewScale);
  banner.update(setPiece.flash);
  drawFrame(start);
}
requestAnimationFrame(frame);

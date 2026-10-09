import * as THREE from 'three';
import { DANGER, HUNGER, JUICE, LIGHTING, QUALITY, RENDER, TIERS } from './config';
import { initAnalytics, scoreBand, track } from './analytics/analytics';
import { AudioEngine } from './audio/AudioEngine';
import { Dangers } from './dangers/Dangers';
import { ShedBurst } from './effects/ShedBurst';
import { CometField } from './entities/CometField';
import { PreyField } from './entities/PreyField';
import { InputManager } from './input/InputManager';
import { GamepadInput } from './input/GamepadInput';
import { KeyboardInput } from './input/KeyboardInput';
import { MouseInput } from './input/MouseInput';
import { TouchInput } from './input/TouchInput';
import { Hunger } from './player/Hunger';
import { Player } from './player/Player';
import { AutoQuality } from './render/AutoQuality';
import { GameCamera } from './render/GameCamera';
import { Renderer } from './render/Renderer';
import { createStarfield } from './scene/Starfield';
import { RunSnapshot } from './share/RunSnapshot';
import { deliverCard, shareMethod } from './share/share';
import { cardBlob, cardFileName, renderShareCard, shareText } from './share/shareCard';
import { isTouchFirst, Settings } from './settings/Settings';
import { TierDirector } from './spawning/TierDirector';
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

const scene = new THREE.Scene();
const player = new Player();
const tiers = new TierDirector();
const gameCamera = new GameCamera(player.position, player.radius, tiers.tier.cameraScale);
const prey = new PreyField(player, gameCamera, tiers.tier);
const comets = new CometField(player, gameCamera, tiers.tier);
const shedBurst = new ShedBurst();
const starfield = createStarfield();
const keyLight = new THREE.DirectionalLight(LIGHTING.keyColor, LIGHTING.key);
keyLight.position.set(...LIGHTING.keyPosition);
scene.add(starfield.points, player.group, prey.group, comets.group, shedBurst.points, new THREE.AmbientLight(0xffffff, LIGHTING.ambient), keyLight);

const audio = new AudioEngine();
const settings = new Settings();
const snapshot = new RunSnapshot();
player.onEat = (_mass, what) => {
  if (!what) return;
  // A new biggest meal is the share card's photo: taken a moment later, while it spaghettifies.
  if (player.biggestEaten === what) snapshot.request();
  audio.eat(what.radius, player.radius);
  // Eat feedback: every meal kicks the camera in a little, big ones also shake it.
  const ratio = what.radius / player.radius;
  gameCamera.addKick(ratio * JUICE.kickPerRatio);
  if (ratio >= JUICE.shakeMinRatio) gameCamera.addShake(Math.min(JUICE.shakeMax, ratio * JUICE.shakePerRatio));
};

const banner = new TierBanner();
// Crossing a mass threshold: new prey table and entity budget, camera scale eases out, flash and banner.
tiers.onTierUp = (tier, index) => {
  gameCamera.setTierScale(tier.cameraScale);
  prey.setTier(tier);
  comets.setTier(tier);
  banner.show(index + 1, tier.title);
  audio.tierUp();
  gameCamera.addShake(JUICE.tierShake);
};
const hunger = new Hunger(player);
const dangers = new Dangers(player, prey, comets, hunger);
// A hit: shake, thud and a spray of the shed disk matter.
dangers.onHit = (hit) => {
  gameCamera.addShake(DANGER.hitShake);
  audio.hit();
  shedBurst.emit(player.position.x, player.position.z, hit.nx, hit.nz, player.radius);
};
const hungerOverlay = new HungerOverlay();
const scoreScreen = new ScoreScreen();

// Run over: score = mass eaten (scaled to points), shown with the biggest meal and the tier reached.
hunger.onEnd = () => {
  const score = Math.round(player.eatenMass * HUNGER.pointsPerMass);
  const previous = loadBest();
  const newBest = score > previous;
  if (newBest) saveBest(score);
  const stats: RunStats = {
    score,
    best: Math.max(score, previous),
    newBest,
    biggest: player.biggestEaten,
    tierNumber: tiers.index + 1,
    tierTitle: tiers.tier.title,
    eatenCount: player.eatenCount,
    seconds: hunger.runTime,
  };
  scoreScreen.show(stats);
  prepareShare(stats);
  void postRunToBoard(scoreScreen.board, stats, title.nicknameValue);
  track('run-end', {
    band: scoreBand(score),
    tier: tiers.index + 1,
    seconds: Math.round(hunger.runTime),
    eaten: player.eatenCount,
    newBest,
  });
  refreshMenus();
};

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

// Fresh run: player, tier, camera, prey pool, hunger and overlays. The camera resets before the prey (spawn distances follow it).
function resetRun(): void {
  player.reset();
  tiers.reset();
  gameCamera.reset(player.position, player.radius, tiers.tier.cameraScale);
  prey.reset(tiers.tier);
  comets.reset(tiers.tier);
  hunger.reset();
  dangers.reset();
  shedBurst.reset();
  hungerOverlay.reset();
  banner.reset();
  audio.reset(player.radius);
  snapshot.reset();
}

const renderer = new Renderer(canvas, scene, gameCamera.camera, player);
renderer.onBeforeRender = (gl) => player.disk.prepare(gl);
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
  player.disk.setDetail(level.diskLayers, level.diskOctaves);
  player.disk.setRenderHeight(renderer.bufferHeight);
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
  return mode === 'playing' && hunger.phase !== 'over';
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
  player.disk.setRenderHeight(renderer.bufferHeight);
  gameCamera.resize(w, h);
  shedBurst.setViewport(renderer.bufferHeight, gameCamera.camera.fov);
}
window.addEventListener('resize', resize);
resize();

// Debug handle used by the Playwright smoke test.
const pixelReads: { x: number; y: number; resolve: (rgb: number[]) => void }[] = [];
const debug = {
  frames: 0,
  /** Smoothed CPU milliseconds per frame (game update plus issuing the draw calls). */
  cpuMs: 0,
  player,
  prey,
  comets,
  dangers,
  shedBurst,
  tiers,
  hunger,
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

const NO_MOVE = { x: 0, y: 0 };
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
  tiers.update(realDt, player.mass);
  // Game time dips into slow motion during the tier-up; the camera and overlays run on real time.
  const dt = realDt * tiers.timeScale;
  // Big bodies pull the hole and push it out on contact (a hit sheds mass), before it moves.
  dangers.update(dt, gameCamera.viewScale);
  // Input only steers while the run is live; during and after the evaporation the hole just drifts.
  player.update(dt, hunger.phase === 'playing' ? input.move : NO_MOVE, gameCamera.viewScale);
  hunger.update(dt, realDt);
  snapshot.update(realDt);
  // A run with no photo yet gets one as the hole starts to evaporate.
  if (hunger.phase === 'evaporating') snapshot.ensure();
  player.canEat = hunger.phase === 'playing';
  hungerOverlay.update(realDt, hunger.level);
  // The disk dims as the hole starves and blinks while it is invulnerable after a hit.
  player.disk.starvation = Math.max(hungerOverlay.level, dangers.blink);
  prey.update(dt);
  comets.update(dt);
  shedBurst.update(dt);
  audio.update(realDt, player.radius, hungerOverlay.level, hunger.phase);
  gameCamera.punch = tiers.punch;
  gameCamera.update(realDt, player.position, player.radius);
  starfield.update(player.position, gameCamera.viewScale);
  banner.update(tiers.flash);
  drawFrame(start);
}
requestAnimationFrame(frame);

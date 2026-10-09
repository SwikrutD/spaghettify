import * as THREE from 'three';
import { HUNGER, JUICE, LIGHTING, RENDER, TIERS } from './config';
import { AudioEngine } from './audio/AudioEngine';
import { PreyField } from './entities/PreyField';
import { InputManager } from './input/InputManager';
import { GamepadInput } from './input/GamepadInput';
import { KeyboardInput } from './input/KeyboardInput';
import { MouseInput } from './input/MouseInput';
import { TouchInput } from './input/TouchInput';
import { Hunger } from './player/Hunger';
import { Player } from './player/Player';
import { GameCamera } from './render/GameCamera';
import { Renderer } from './render/Renderer';
import { createStarfield } from './scene/Starfield';
import { Settings } from './settings/Settings';
import { TierDirector } from './spawning/TierDirector';
import { HungerOverlay } from './ui/HungerOverlay';
import { PauseMenu } from './ui/PauseMenu';
import { ScoreScreen } from './ui/ScoreScreen';
import { SettingsPanel } from './ui/SettingsPanel';
import { TierBanner } from './ui/TierBanner';
import { loadBest, saveBest, TitleScreen } from './ui/TitleScreen';

const canvas = document.getElementById('game') as HTMLCanvasElement;

const scene = new THREE.Scene();
const player = new Player();
const tiers = new TierDirector();
const gameCamera = new GameCamera(player.position, player.radius, tiers.tier.cameraScale);
const prey = new PreyField(player, gameCamera, tiers.tier);
const starfield = createStarfield();
const keyLight = new THREE.DirectionalLight(LIGHTING.keyColor, LIGHTING.key);
keyLight.position.set(...LIGHTING.keyPosition);
scene.add(starfield.points, player.group, prey.mesh, new THREE.AmbientLight(0xffffff, LIGHTING.ambient), keyLight);

const audio = new AudioEngine();
const settings = new Settings();
player.onEat = (_mass, what) => {
  if (!what) return;
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
  banner.show(index + 1, tier.title);
  audio.tierUp();
  gameCamera.addShake(JUICE.tierShake);
};
const hunger = new Hunger(player);
const hungerOverlay = new HungerOverlay();
const scoreScreen = new ScoreScreen();

// Run over: score = mass eaten (scaled to points), shown with the biggest meal and the tier reached.
hunger.onEnd = () => {
  const score = Math.round(player.eatenMass * HUNGER.pointsPerMass);
  const previous = loadBest();
  const newBest = score > previous;
  if (newBest) saveBest(score);
  scoreScreen.show({
    score,
    best: Math.max(score, previous),
    newBest,
    biggest: player.biggestEaten,
    tierNumber: tiers.index + 1,
    tierTitle: tiers.tier.title,
    eatenCount: player.eatenCount,
    seconds: hunger.runTime,
  });
  refreshMenus();
};

// Fresh run: player, tier, camera, prey pool, hunger and overlays. The camera resets before the prey (spawn distances follow it).
function resetRun(): void {
  player.reset();
  tiers.reset();
  gameCamera.reset(player.position, player.radius, tiers.tier.cameraScale);
  prey.reset(tiers.tier);
  hunger.reset();
  hungerOverlay.reset();
  banner.reset();
  audio.reset(player.radius);
}

const renderer = new Renderer(canvas, scene, gameCamera.camera, player);
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

function applySettings(): void {
  input.setEnabled('mouse', settings.scheme === 'mouse');
  const touchScheme = settings.scheme === 'finger' || settings.scheme === 'joystick';
  input.setEnabled('touch', touchScheme);
  if (touchScheme) touch.setMode(settings.scheme as 'finger' | 'joystick');
  else touch.release();
  renderer.lensing.setQuality(settings.quality);
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
};
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
  gameCamera.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// Debug handle used by the Playwright smoke test.
const pixelReads: { x: number; y: number; resolve: (rgb: number[]) => void }[] = [];
const debug = {
  frames: 0,
  player,
  prey,
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
  /** Final RGB at a canvas pixel (CSS pixels, y down), read right after the next frame renders. */
  readPixel: (x: number, y: number) => new Promise<number[]>((resolve) => pixelReads.push({ x, y, resolve })),
};
(window as unknown as { __spaghettify: typeof debug }).__spaghettify = debug;

function drawFrame(): void {
  renderer.render();
  for (const read of pixelReads.splice(0)) read.resolve(renderer.readPixel(read.x, read.y));
  debug.frames++;
  requestAnimationFrame(frame);
}

const NO_MOVE = { x: 0, y: 0 };
let last = performance.now();
function frame(now: number): void {
  const realDt = Math.min((now - last) / 1000, RENDER.maxFrameDt);
  last = now;
  if (mode !== 'playing') {
    drawFrame();
    return;
  }
  input.update();
  tiers.update(realDt, player.mass);
  // Game time dips into slow motion during the tier-up; the camera and overlays run on real time.
  const dt = realDt * tiers.timeScale;
  // Input only steers while the run is live; during and after the evaporation the hole just drifts.
  player.update(dt, hunger.phase === 'playing' ? input.move : NO_MOVE, gameCamera.viewScale);
  hunger.update(dt, realDt);
  player.canEat = hunger.phase === 'playing';
  hungerOverlay.update(realDt, hunger.level);
  player.disk.starvation = hungerOverlay.level;
  prey.update(dt);
  audio.update(realDt, player.radius, hungerOverlay.level, hunger.phase);
  gameCamera.punch = tiers.punch;
  gameCamera.update(realDt, player.position, player.radius);
  starfield.update(player.position, gameCamera.viewScale);
  banner.update(tiers.flash);
  drawFrame();
}
requestAnimationFrame(frame);

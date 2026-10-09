import * as THREE from 'three';
import { HUNGER, LIGHTING, RENDER, TIERS } from './config';
import { AudioEngine } from './audio/AudioEngine';
import { PreyField } from './entities/PreyField';
import { InputManager } from './input/InputManager';
import { KeyboardInput } from './input/KeyboardInput';
import { MouseInput } from './input/MouseInput';
import { Hunger } from './player/Hunger';
import { Player } from './player/Player';
import { GameCamera } from './render/GameCamera';
import { Renderer } from './render/Renderer';
import { createStarfield } from './scene/Starfield';
import { TierDirector } from './spawning/TierDirector';
import { AudioPanel } from './ui/AudioPanel';
import { HungerOverlay } from './ui/HungerOverlay';
import { ScoreScreen } from './ui/ScoreScreen';
import { TierBanner } from './ui/TierBanner';

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
new AudioPanel(audio);
player.onEat = (_mass, what) => {
  if (what) audio.eat(what.radius, player.radius);
};

const banner = new TierBanner();
// Crossing a mass threshold: new prey table and entity budget, camera scale eases out, flash and banner.
tiers.onTierUp = (tier, index) => {
  gameCamera.setTierScale(tier.cameraScale);
  prey.setTier(tier);
  banner.show(index + 1, tier.title);
  audio.tierUp();
};
const hunger = new Hunger(player);
const hungerOverlay = new HungerOverlay();
const scoreScreen = new ScoreScreen();

const BEST_KEY = 'spaghettify.best';
function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // Storage can be blocked; the best score is a convenience.
  }
}

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
};

// Fresh run: player, tier, camera, prey pool, hunger and overlays. The camera resets before the prey (spawn distances follow it).
scoreScreen.onRestart = () => {
  player.reset();
  tiers.reset();
  gameCamera.reset(player.position, player.radius, tiers.tier.cameraScale);
  prey.reset(tiers.tier);
  hunger.reset();
  hungerOverlay.reset();
  banner.reset();
  audio.reset(player.radius);
};

const renderer = new Renderer(canvas, scene, gameCamera.camera, player);
const input = new InputManager([new KeyboardInput(), new MouseInput(canvas)]);

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
  allTiers: TIERS,
  camera: gameCamera,
  renderer,
  /** Final RGB at a canvas pixel (CSS pixels, y down), read right after the next frame renders. */
  readPixel: (x: number, y: number) => new Promise<number[]>((resolve) => pixelReads.push({ x, y, resolve })),
};
(window as unknown as { __spaghettify: typeof debug }).__spaghettify = debug;

const NO_MOVE = { x: 0, y: 0 };
let last = performance.now();
function frame(now: number): void {
  const realDt = Math.min((now - last) / 1000, RENDER.maxFrameDt);
  last = now;
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
  renderer.render();
  for (const read of pixelReads.splice(0)) read.resolve(renderer.readPixel(read.x, read.y));
  debug.frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

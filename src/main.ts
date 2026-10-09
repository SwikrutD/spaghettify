import * as THREE from 'three';
import { LIGHTING, RENDER, TIERS } from './config';
import { PreyField } from './entities/PreyField';
import { InputManager } from './input/InputManager';
import { KeyboardInput } from './input/KeyboardInput';
import { MouseInput } from './input/MouseInput';
import { Player } from './player/Player';
import { GameCamera } from './render/GameCamera';
import { Renderer } from './render/Renderer';
import { createStarfield } from './scene/Starfield';
import { TierDirector } from './spawning/TierDirector';
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

const banner = new TierBanner();
// Crossing a mass threshold: new prey table and entity budget, camera scale eases out, flash and banner.
tiers.onTierUp = (tier, index) => {
  gameCamera.setTierScale(tier.cameraScale);
  prey.setTier(tier);
  banner.show(index + 1, tier.title);
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
  allTiers: TIERS,
  camera: gameCamera,
  renderer,
  /** Final RGB at a canvas pixel (CSS pixels, y down), read right after the next frame renders. */
  readPixel: (x: number, y: number) => new Promise<number[]>((resolve) => pixelReads.push({ x, y, resolve })),
};
(window as unknown as { __spaghettify: typeof debug }).__spaghettify = debug;

let last = performance.now();
function frame(now: number): void {
  const realDt = Math.min((now - last) / 1000, RENDER.maxFrameDt);
  last = now;
  input.update();
  tiers.update(realDt, player.mass);
  // Game time dips into slow motion during the tier-up; the camera and overlays run on real time.
  const dt = realDt * tiers.timeScale;
  player.update(dt, input.move, gameCamera.viewScale);
  prey.update(dt);
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

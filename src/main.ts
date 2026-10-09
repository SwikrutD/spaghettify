import * as THREE from 'three';
import { LIGHTING, RENDER } from './config';
import { PreyField } from './entities/PreyField';
import { InputManager } from './input/InputManager';
import { KeyboardInput } from './input/KeyboardInput';
import { MouseInput } from './input/MouseInput';
import { Player } from './player/Player';
import { GameCamera } from './render/GameCamera';
import { Renderer } from './render/Renderer';
import { createStarfield } from './scene/Starfield';

const canvas = document.getElementById('game') as HTMLCanvasElement;

const scene = new THREE.Scene();
const player = new Player();
const prey = new PreyField(player);
const keyLight = new THREE.DirectionalLight(LIGHTING.keyColor, LIGHTING.key);
keyLight.position.set(...LIGHTING.keyPosition);
scene.add(createStarfield(), player.group, prey.mesh, new THREE.AmbientLight(0xffffff, LIGHTING.ambient), keyLight);

const gameCamera = new GameCamera(player.position, player.radius);
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
  renderer,
  /** Final RGB at a canvas pixel (CSS pixels, y down), read right after the next frame renders. */
  readPixel: (x: number, y: number) => new Promise<number[]>((resolve) => pixelReads.push({ x, y, resolve })),
};
(window as unknown as { __spaghettify: typeof debug }).__spaghettify = debug;

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, RENDER.maxFrameDt);
  last = now;
  input.update();
  player.update(dt, input.move);
  prey.update(dt);
  gameCamera.update(dt, player.position, player.radius);
  renderer.render();
  for (const read of pixelReads.splice(0)) read.resolve(renderer.readPixel(read.x, read.y));
  debug.frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

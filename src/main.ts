import * as THREE from 'three';
import { BOTS, DANGER, HOLES, JUICE, LIGHTING, MILESTONE_FX, MILESTONES, NET_CLIENT, QUALITY, RENDER, STORAGE } from './config';
import { initAnalytics, scoreBand, track } from './analytics/analytics';
import { AudioEngine } from './audio/AudioEngine';
import { objectView, poolView } from './debug/debugViews';
import { MergerRipple } from './effects/MergerRipple';
import { ShedBurst } from './effects/ShedBurst';
import { MilestoneSetPiece } from './effects/MilestoneSetPiece';
import { CometFieldMesh } from './entities/CometFieldMesh';
import { DebrisMesh } from './entities/DebrisMesh';
import { PreyFieldMesh } from './entities/PreyFieldMesh';
import type { BodyFrame } from './entities/PreyMesh';
import { InputManager } from './input/InputManager';
import { GamepadInput } from './input/GamepadInput';
import { KeyboardInput } from './input/KeyboardInput';
import { MouseInput } from './input/MouseInput';
import { TouchInput } from './input/TouchInput';
import { fetchOnline } from './leaderboard/api';
import type { FieldSight } from './net/ArenaMirror.ts';
import { arenaUrl, NetClient, type NetEnd } from './net/NetClient';
import { OnlineArena } from './net/OnlineArena.ts';
import { blink } from './player/HoleMesh';
import { HoleMeshes } from './player/HoleMeshes';
import type { OverMessage, WelcomeMessage } from './protocol/messages.ts';
import { AutoQuality } from './render/AutoQuality';
import { GameCamera } from './render/GameCamera';
import { Renderer } from './render/Renderer';
import { ArenaWall } from './scene/ArenaWall';
import { createStarfield } from './scene/Starfield';
import { RunSnapshot } from './share/RunSnapshot';
import { deliverCard, shareMethod } from './share/share';
import { cardBlob, cardFileName, renderShareCard, shareText } from './share/shareCard';
import { isTouchFirst, Settings } from './settings/Settings';
import { canSwallow } from './sim/body.ts';
import type { AteEvent, DiedEvent, HoleEatenEvent } from './sim/events.ts';
import { viewDistance, type Hole, type Meal } from './sim/Hole.ts';
import { generateName } from './sim/names.ts';
import { classNamed, MILESTONE_MASSES } from './sim/milestones.ts';
import { World } from './sim/World.ts';
import { Hud } from './ui/Hud';
import { HungerOverlay } from './ui/HungerOverlay';
import { postRunToBoard, refreshTitleBoard, showServerLife } from './ui/leaderboardFlow';
import { NameTags } from './ui/NameTags';
import { NetStatus } from './ui/NetStatus';
import { PauseMenu } from './ui/PauseMenu';
import { PerfOverlay } from './ui/PerfOverlay';
import { ScoreScreen, type RunStats } from './ui/ScoreScreen';
import { SettingsPanel } from './ui/SettingsPanel';
import { MilestoneBanner } from './ui/MilestoneBanner';
import { withArticle } from './ui/milestones';
import { loadBest, saveBest, TitleScreen } from './ui/TitleScreen';

initAnalytics();
const canvas = document.getElementById('game') as HTMLCanvasElement;

// The game state and rules (src/sim). Play joins the online arena on the server when it can (src/net: the client's
// mirror of a server room) and otherwise plays the offline arena with bot holes, where the local player is the
// world's focus hole, steered by the input vector. `?seed=` fixes the offline arena and `?bots=` sets its number of
// bots (the tests use 0); either, or `?offline`, plays offline without trying the server.
const params = new URLSearchParams(location.search);
const botParam = Number(params.get('bots'));
const offlineOnly = params.has('offline') || params.has('bots') || params.has('seed');
const offlineWorld = new World({
  seed: params.has('seed') ? Number(params.get('seed')) >>> 0 : (Math.random() * 2 ** 32) >>> 0,
  bots: params.has('bots') && Number.isFinite(botParam) ? Math.max(0, Math.min(40, Math.round(botParam))) : BOTS.count,
});
/** The world drawn and played: the offline arena, or online the mirror of the server's room. */
let world: World = offlineWorld;
/** The player's hole in it. */
let local: Hole = offlineWorld.focus;
// A name for the player until they type one.
const fallbackName = generateName(world.rng, (n) => world.holes.some((h) => h.name === n));
local.name = fallbackName;

// What the world looks like. These only read the sim state and react to its events.
const scene = new THREE.Scene();
const holeMeshes = new HoleMeshes();
const holeMesh = holeMeshes.local;
const ripple = new MergerRipple();
const preyMesh = new PreyFieldMesh(world.prey.objects.length);
const cometMesh = new CometFieldMesh();
const debrisMesh = new DebrisMesh();
const shedBurst = new ShedBurst();
const starfield = createStarfield();
const arenaWall = new ArenaWall();
const keyLight = new THREE.DirectionalLight(LIGHTING.keyColor, LIGHTING.key);
keyLight.position.set(...LIGHTING.keyPosition);
scene.add(
  starfield.points,
  holeMeshes.group,
  ripple.group,
  preyMesh.group,
  cometMesh.group,
  debrisMesh.object3d,
  shedBurst.points,
  arenaWall.mesh,
  new THREE.AmbientLight(0xffffff, LIGHTING.ambient),
  keyLight,
);
const bodyFrame: BodyFrame = {
  world,
  sight: null,
  alpha: 1,
  dt: 0,
  time: 0,
  holes: holeMeshes.drawn,
  view: { x: 0, z: 0, radius: 1, unitsPerPixel: 1, nearZ: 1, farZ: -1, nearHalf: 1, farHalf: 1 },
};
const gameCamera = new GameCamera(holeMesh.position, local.radius);
const setPiece = new MilestoneSetPiece();

const audio = new AudioEngine();
const settings = new Settings();
const snapshot = new RunSnapshot();
const banner = new MilestoneBanner();
const hungerOverlay = new HungerOverlay();
const scoreScreen = new ScoreScreen();
const hud = new Hud();
const nameTags = new NameTags();
// `?perf` in the URL shows frame time, GPU time per pass (where the browser allows it) and the quality level; the
// connection line moves down out of its way.
const perfOn = params.has('perf');
const netStatus = new NetStatus(document.body, perfOn ? 96 : 12);
/** 0..1 flash when the local hole eats a hole or is eaten; decays on real time. */
let mergerFlash = 0;

// Online play (null while offline): the connection and the client's side of the room.
let net: NetClient | null = null;
let online: OnlineArena | null = null;
/** Joining right now (the title waits). */
let joining = false;
/** The last online session dropped: Play again tries to join again (otherwise it plays on offline). */
let rejoin = false;
/** The window lost focus or the tab is hidden: online the hole is not steered (nothing pauses there). */
let away = false;
/** Why the last online session ended without the player leaving (debug and tests). */
let lastEnd: NetEnd | null = null;

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

/** The local hole reached a size milestone: it can now swallow a whole class. Flash, banner, sound, shake. */
function onMilestone(index: number): void {
  const milestone = MILESTONES[index];
  setPiece.start();
  const unlocks = milestone.unlocks ? classNamed(milestone.unlocks).name : '';
  banner.show(unlocks ? `NOW BIG ENOUGH TO EAT ${withArticle(unlocks).toUpperCase()}` : '', milestone.title);
  audio.milestone();
  gameCamera.addShake(JUICE.milestoneShake);
}

/** A hole swallowed another: the ripple, the feed line, and the shake, flash and boom for the local hole's own mergers (fainter with distance). */
function onHoleEaten(e: HoleEatenEvent): void {
  ripple.emit(e.x, e.z, e.eaterRadius);
  const mine = e.eater === local.id || e.victim === local.id;
  hud.addFeed(`${e.eaterName} ate ${e.victimName}`, mine);
  const dx = e.x - local.position.x;
  const dz = e.z - local.position.z;
  const range = viewDistance(local.radius) * HOLES.mergerShakeViews;
  const near = mine ? 1 : Math.max(0, 1 - Math.hypot(dx, dz) / range);
  if (near <= 0) return;
  gameCamera.addShake(HOLES.mergerShake * near);
  audio.merger(near);
  if (mine) mergerFlash = 1;
}

/** React to what the world did since the last frame (online: what the snapshots said, as it is drawn). */
function handleEvents(): void {
  for (const e of world.events) {
    switch (e.type) {
      case 'ate':
        if (e.hole === local.id) onAte(e);
        break;
      case 'bumped':
        if (e.hole === local.id) {
          // A hit: shake, thud and a spray of sparks (the sim throws the shed mass out as debris).
          gameCamera.addShake(DANGER.hitShake);
          audio.hit();
          shedBurst.emit(e.x, e.z, e.nx, e.nz, e.radius);
        } else if (Math.hypot(e.x - local.position.x, e.z - local.position.z) < viewDistance(local.radius) * 1.2) {
          shedBurst.emit(e.x, e.z, e.nx, e.nz, e.radius);
        }
        break;
      case 'shed':
        if (e.hole === local.id) holeMesh.squash();
        else holeMeshes.meshOf(world.hole(e.hole))?.squash();
        break;
      case 'milestone':
        if (e.hole === local.id) onMilestone(e.index);
        break;
      case 'holeEaten':
        onHoleEaten(e);
        break;
      case 'died':
        // Online the score screen waits for the server's account of the life ('over').
        if (e.hole === local.id && !online) endRun(e);
        break;
    }
  }
  world.clearEvents();
}

// Life over (offline): score = peak mass gained (scaled to points), shown with the biggest meal and the size reached.
function endRun(died: DiedEvent): void {
  const score = local.score;
  const stats = runStats(score, local.biggestEaten, local.milestone, local.eatenCount, local.holesEaten, died.cause === 'eaten' ? died.byName : null, local.hunger.runTime, false);
  showScore(stats);
  void postRunToBoard(scoreScreen.board, stats, title.nicknameValue);
  track('run-end', {
    band: scoreBand(score),
    tier: local.milestone + 1,
    seconds: Math.round(local.hunger.runTime),
    eaten: local.eatenCount,
    holes: local.holesEaten,
    newBest: stats.newBest,
    cause: died.cause,
    online: false,
  });
}

// Life over (online): the server scored it, and posted it when the player has a nickname. Never posted from here.
function endOnlineLife(over: OverMessage): void {
  if (!online) return;
  const milestone = Math.max(0, Math.min(MILESTONES.length - 1, over.milestone - 1));
  const stats = runStats(over.score, over.biggest, milestone, over.eaten, over.holesEaten, over.cause === 'eaten' ? over.byName : null, over.seconds, true);
  showScore(stats);
  const { name, named, refused } = online.welcome;
  void showServerLife(scoreScreen.board, stats, over.posted, name, named, refused);
  track('run-end', {
    band: scoreBand(over.score),
    tier: over.milestone,
    seconds: Math.round(over.seconds),
    eaten: over.eaten,
    holes: over.holesEaten,
    newBest: stats.newBest,
    cause: over.cause,
    online: true,
  });
}

/** A life's stats for the score screen; keeps the best score on this device. */
function runStats(score: number, biggest: Meal | null, milestone: number, eaten: number, holesEaten: number, eatenBy: string | null, seconds: number, online: boolean): RunStats {
  const previous = loadBest();
  const newBest = score > previous;
  if (newBest) saveBest(score);
  return {
    score,
    best: Math.max(score, previous),
    newBest,
    biggest,
    milestoneNumber: milestone + 1,
    milestoneTitle: MILESTONES[milestone].title,
    eatenCount: eaten,
    holesEaten,
    eatenBy,
    seconds,
    online,
  };
}

function showScore(stats: RunStats): void {
  // Online the menu may be open over the running arena when the life ends.
  if (mode === 'paused') setMode('playing');
  scoreScreen.show(stats);
  prepareShare(stats);
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
    track('share', { method: used, band: scoreBand(stats.score), tier: stats.milestoneNumber });
  } finally {
    sharing = false;
  }
};

/** Steps not yet run in the offline arena: real seconds carried over to the next frame. */
let pending = 0;

/** Draw the world as of `alpha` (0..1) between its last two steps. `dt` is seconds since the last frame. */
function renderWorld(dt: number, alpha: number): void {
  bodyFrame.alpha = alpha;
  bodyFrame.dt = dt;
  bodyFrame.time += dt;
  // What the camera sees (as of the last frame's placement; it moves little in one frame), with a margin for
  // bodies whose centre is just off screen.
  gameCamera.groundView(bodyFrame.view, gameCamera.distance * 0.1);
  holeMeshes.update(dt, alpha, world, local, bodyFrame.view, gameCamera.camera);
  renderer.lensing.extras = holeMeshes.lensExtras;
  ripple.update(dt);
  preyMesh.update(bodyFrame);
  cometMesh.update(bodyFrame);
  debrisMesh.update(bodyFrame);
  shedBurst.update(dt);
}

// A fresh life for the local hole (the camera and everything drawn from it start over; the effects are cleared).
function restartDrawing(): void {
  holeMeshes.reset(local);
  gameCamera.reset(holeMesh.position, local.radius);
  shedBurst.reset();
  ripple.reset();
  setPiece.reset();
  mergerFlash = 0;
  hungerOverlay.reset();
  banner.reset();
  audio.reset(local.radius);
  snapshot.reset();
  renderWorld(0, 1);
}

// A fresh offline arena (hole, bots, field, bodies, comets, debris), for quitting to the title screen.
function resetRun(): void {
  world.reset();
  local.name = nameForRun();
  pending = 0;
  hud.clearFeed();
  restartDrawing();
}

// Play again after an offline life: the hole respawns in the arena as it runs, at a clear spawn point.
function respawnLocal(): void {
  world.respawn(local);
  local.name = nameForRun();
  restartDrawing();
}

/** The nickname from the title screen, or the generated one. */
function nameForRun(): string {
  return title.nicknameValue || fallbackName;
}

/** Draw and play `next` from now on (the offline arena, or an online room's mirror). */
function useWorld(next: World, nextLocal: Hole, sight: FieldSight | null): void {
  world = next;
  local = nextLocal;
  bodyFrame.world = next;
  bodyFrame.sight = sight;
  holeMesh.drawOffset.x = holeMesh.drawOffset.z = 0;
  pauseMenu.setOnline(online !== null);
}

const renderer = new Renderer(canvas, scene, gameCamera.camera, holeMesh);
renderer.onBeforeRender = (gl) => holeMeshes.turbulence.prepare(gl);
const touch = new TouchInput(canvas);
const input = new InputManager([
  { id: 'keyboard', source: new KeyboardInput() },
  { id: 'gamepad', source: new GamepadInput() },
  { id: 'touch', source: touch },
  { id: 'mouse', source: new MouseInput(canvas) },
]);

// Menus and run state. Offline the run does not advance in 'title' or 'paused'; the scene keeps rendering behind the
// menus. Online 'paused' is the menu over the arena, which runs on.
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
  holeMeshes.setDetail(level.diskLayers, level.diskOctaves);
  holeMeshes.turbulence.setRenderHeight(renderer.bufferHeight);
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
  netStatus.setVisible(next !== 'title');
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

/** Play the offline arena: from the title (a fresh life there) or after a life (respawn). `note` says why it is offline. */
function playOffline(from: 'title' | 'restart', note: string | null, why: string): void {
  if (from === 'title') {
    local.name = nameForRun();
    title.hide();
    setMode('playing');
  } else {
    respawnLocal();
    refreshMenus();
  }
  if (note) netStatus.showNote(note);
  track('join', { online: false, why, from });
  track('run-start', { from, online: false });
}

/** What the player is told when the online arena could not be joined (the game plays offline instead). */
function joinFailedNote(why: NetEnd): string {
  switch (why) {
    case 'full':
      return 'The online arena is full right now. Playing the offline arena with bots.';
    case 'version':
      return 'A new version of the game is out. Reload the page to play online.';
    case 'unreachable':
      return 'Could not reach the server. Playing the offline arena with bots.';
    default:
      return 'Could not join the online arena. Playing the offline arena with bots.';
  }
}

/**
 * The server runs a newer build than this page (a 'version' refusal): reload to get it, unless the page reloaded for
 * that a moment ago (then it plays offline instead of reloading in a loop). True if it reloads.
 */
function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(STORAGE.versionReload));
    if (last && Date.now() - last < NET_CLIENT.reloadGuardSeconds * 1000) return false;
    sessionStorage.setItem(STORAGE.versionReload, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/** Join quick play on the server; play offline (saying why) if it cannot. */
async function joinOnline(from: 'title' | 'restart'): Promise<void> {
  if (joining) return;
  joining = true;
  title.setConnecting(true);
  // Only a nickname the player typed goes to the server (it makes up a name otherwise, and does not post that one).
  const result = await NetClient.connect(arenaUrl(), title.nicknameValue, gameCamera.screenReach());
  joining = false;
  title.setConnecting(false);
  if ('failed' in result) {
    if (result.failed === 'version' && reloadForNewVersion()) return;
    playOffline(from, joinFailedNote(result.failed), result.failed);
    return;
  }
  startOnline(result.client, result.welcome, from);
}

/** Welcomed into a room: follow it, and start playing once the first snapshot has placed the hole. */
function startOnline(client: NetClient, welcome: WelcomeMessage, from: 'title' | 'restart'): void {
  net = client;
  rejoin = false;
  const arena = new OnlineArena(welcome, client, gameCamera.screenReach());
  online = arena;
  let entered = false;
  arena.onBoard = (board) => hud.setBoard(board.rows, board.you, arena.local);
  arena.onOver = (over) => endOnlineLife(over);
  arena.onNewLife = () => {
    if (!entered) {
      // Into the room's world: the title (or the last score screen) gives way.
      entered = true;
      useWorld(arena.world, arena.local, arena.mirror.sight);
      hud.clearFeed();
      title.hide();
      scoreScreen.hide();
      setMode('playing');
      if (welcome.refused) netStatus.showNote(`That nickname is not allowed here. You play as ${welcome.name}.`);
      track('join', { online: true, why: 'ok', from });
      track('run-start', { from, online: true });
    } else {
      track('run-start', { from: 'restart', online: true });
    }
    restartDrawing();
    refreshMenus();
  };
  client.listen((message, at) => arena.receive(message, at));
  client.onEnd = (why) => onlineEnded(arena, why);
}

/** Leave the online arena (the server scores a life still going) and go back to the offline world. */
function leaveOnline(): void {
  net?.close();
  net = null;
  online = null;
  useWorld(offlineWorld, offlineWorld.focus, null);
}

/**
 * The connection ended without the player leaving. A life in play carries on in the offline arena (a fresh one, the
 * hole at its size and with its life so far); a life that was over stays on its score screen and Play again tries
 * to join again. The server scored the online part of the life either way.
 */
function onlineEnded(arena: OnlineArena, why: NetEnd): void {
  if (online !== arena) return;
  lastEnd = why;
  const hole = arena.local;
  const entered = world === arena.world;
  net = null;
  online = null;
  if (why === 'version' && reloadForNewVersion()) return;
  if (!entered) {
    // Welcomed, then dropped before the first snapshot: as if the join failed.
    playOffline(title.isVisible ? 'title' : 'restart', joinFailedNote(why), why);
    return;
  }
  rejoin = !offlineOnly;
  const live = hole.phase === 'playing' || hole.phase === 'evaporating';
  useWorld(offlineWorld, offlineWorld.focus, null);
  world.reset();
  pending = 0;
  hud.clearFeed();
  if (live) {
    carryOver(hole);
    netStatus.showNote(
      why === 'shutdown'
        ? 'The server is restarting. Your hole carries on in the offline arena.'
        : 'Lost the connection to the server. Your hole carries on in the offline arena.',
    );
    track('net-drop', { why, carried: true });
  } else {
    // The life ended (or was ending) online: the offline arena waits behind the score screen for Play again.
    local.name = nameForRun();
    local.hunger.phase = 'over';
    restartDrawing();
    netStatus.showNote('Lost the connection to the server.');
    track('net-drop', { why, carried: false });
    // Play again was already pressed: join again (or play offline). No account of the life came: show what was seen.
    if (arena.awaitingLife) void joinOnline('restart');
    else if (!arena.over) endDroppedLife(hole);
  }
  refreshMenus();
}

/** The offline arena takes over a life from the online one: the hole at a clear spot for its size, its life so far kept. */
function carryOver(from: Hole): void {
  world.respawn(local, from.radius);
  local.name = from.name;
  local.mass = from.mass;
  local.peakMass = Math.max(from.peakMass, from.mass);
  local.eatenMass = from.eatenMass;
  local.eatenCount = from.eatenCount;
  local.biggestEaten = from.biggestEaten;
  local.holesEaten = from.holesEaten;
  local.milestone = Math.max(local.milestone, from.milestone);
  local.hunger.runTime = from.hunger.runTime;
  restartDrawing();
}

/** Swallowed online as the connection dropped (the server's account never came): the score screen from what this client saw. */
function endDroppedLife(hole: Hole): void {
  const stats = runStats(hole.score, hole.biggestEaten, hole.milestone, hole.eatenCount, hole.holesEaten, hole.eatenByName || null, hole.hunger.runTime, true);
  showScore(stats);
  scoreScreen.board.clear();
  scoreScreen.board.setStatus('The connection dropped. The server scored this life as it stood.');
}

title.onPlay = () => {
  if (offlineOnly) playOffline('title', null, 'offline-mode');
  else void joinOnline('title');
};
title.onShow = () => {
  void refreshTitleBoard(title.board, title.nicknameValue);
  void refreshOnline();
};
title.onSettings = () => {
  title.hide();
  openSettings('title');
};
pauseMenu.onResume = resume;
pauseMenu.onPauseRequest = pause;
pauseMenu.onSettings = () => openSettings('pause');
pauseMenu.onQuit = () => {
  if (online) leaveOnline();
  resetRun();
  setMode('title');
  title.show();
};
settingsPanel.onClose = closeSettings;
scoreScreen.onRestart = () => {
  if (online) {
    // A new life in the room once the server takes it; drawing starts afresh when it comes (onNewLife).
    online.playAgain();
  } else if (rejoin) {
    void joinOnline('restart');
  } else {
    respawnLocal();
    refreshMenus();
    track('run-start', { from: 'restart', online: false });
  }
};

/** Players online, on the title screen; or that the game plays offline. */
async function refreshOnline(): Promise<void> {
  if (offlineOnly) {
    title.setOnline('OFFLINE ARENA');
    return;
  }
  const info = await fetchOnline();
  if (!info) title.setOnline('SERVER UNREACHABLE: OFFLINE ARENA');
  else title.setOnline(`${info.players} ${info.players === 1 ? 'PLAYER' : 'PLAYERS'} ONLINE`);
}
window.setInterval(() => {
  if (title.isVisible) void refreshOnline();
}, NET_CLIENT.onlineRefreshSeconds * 1000);

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
// Losing focus or hiding the tab pauses a live offline run; online the hole stops being steered (the arena runs on).
window.addEventListener('blur', () => {
  away = true;
  if (!online) pause();
});
window.addEventListener('focus', () => {
  away = false;
});
document.addEventListener('visibilitychange', () => {
  away = document.hidden;
  if (!document.hidden) return;
  if (online) online.halt();
  else pause();
});
title.show();

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h);
  holeMeshes.turbulence.setRenderHeight(renderer.bufferHeight);
  gameCamera.resize(w, h);
  shedBurst.setViewport(renderer.bufferHeight, gameCamera.camera.fov);
  online?.setReach(gameCamera.screenReach());
}
window.addEventListener('resize', resize);
resize();
renderWorld(0, 1);

// Debug handle used by the Playwright smoke test and the console. Sim objects are shown through views whose
// {x, z} vectors behave like THREE.Vector3 (see debugViews); writes go straight into the sim.
const pixelReads: { x: number; y: number; resolve: (rgb: number[]) => void }[] = [];
let playerView: { hole: Hole; view: Hole } | null = null;
const debug = {
  frames: 0,
  /** Smoothed CPU milliseconds per frame (simulation steps, drawing and issuing the draw calls). */
  cpuMs: 0,
  /** The world played and drawn (offline, or the online room's mirror). */
  get world() {
    return world;
  },
  holes: holeMeshes,
  hud,
  nameTags,
  ripple,
  /** Bot holes in the world, with their characters (tests and tuning). */
  get bots() {
    return world.holes.filter((h) => h.bot);
  },
  /** The local player's hole, with a few helpers. */
  get player() {
    if (playerView?.hole !== local) {
      const hole = local;
      const view = objectView(hole, {
        disk: holeMesh.disk,
        group: holeMesh.group,
        setRadius(r: number) {
          hole.radius = hole.prevRadius = r;
        },
        /** Credit a meal straight away, with all its feedback (the event is handled at once). */
        eat(mass: number, what?: Meal) {
          world.eat(hole, mass, what ?? null);
          handleEvents();
        },
      });
      playerView = { hole, view };
    }
    return playerView.view;
  },
  /** Online play: the connection and the client's side of the room (null fields while offline). */
  net: {
    get state(): 'offline' | 'joining' | 'online' {
      return online ? 'online' : joining ? 'joining' : 'offline';
    },
    get arena() {
      return online;
    },
    get rtt() {
      return net?.rtt ?? null;
    },
    get offlineWorld() {
      return offlineWorld;
    },
    get note() {
      return netStatus.noteText;
    },
    /** Why the last session ended without the player leaving. */
    get lastEnd() {
      return lastEnd;
    },
  },
  /** The arena's bodies (dwarf planets and up) and helpers around them and the small-matter field. */
  prey: {
    get objects() {
      return poolView(world.prey.objects);
    },
    get liveCount() {
      return world.prey.liveCount;
    },
    /** True if the local hole is big enough to eat this object. */
    isEdible: (obj: { radius: number }) => canSwallow(obj.radius, local.radius),
    /** The mesh and instance arena body i was drawn as in the last frame, or null. */
    instanceOf: (i: number) => preyMesh.instanceOf(i),
    /** Instances drawn last frame per mesh: low detail rocks, rocks, spheres. */
    get counts() {
      return preyMesh.counts;
    },
    group: preyMesh.group,
    /**
     * Something to eat: an arena body slot turned into a still rock of `radius` (a fraction of the hole's by
     * default), `gap` hole radii to the right of the hole. It goes back to its class when it respawns.
     */
    edible(radius = local.radius * 0.6, gap = 4) {
      const body = world.prey.objects[world.prey.objects.length - 1];
      body.state = 'alive';
      body.className = 'rock';
      body.round = false;
      body.radius = radius;
      body.mass = radius * radius;
      body.velocity.x = body.velocity.z = 0;
      body.position.x = local.position.x + local.radius * gap;
      body.position.z = local.position.z;
      return objectView(body);
    },
    /** Nothing near the hole: every body respawns out of its sight and the small matter around it is cleared. */
    clear() {
      for (const body of world.prey.objects) body.position.x += 1e6;
      world.field.clearAround(local.position.x, local.position.z, gameCamera.targetDistance * 4);
    },
  },
  get field() {
    return world.field;
  },
  comets: {
    get objects() {
      return poolView(world.comets.objects);
    },
    get launched() {
      return world.comets.launched;
    },
    launch: (x: number, z: number, vx: number, vz: number, radius: number) => world.comets.launch(x, z, vx, vz, radius),
    spawn: () => world.comets.spawn(local),
    reset: () => world.comets.reset(),
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
  milestones: {
    get index() {
      return local.milestone;
    },
    all: MILESTONES,
    masses: MILESTONE_MASSES,
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

const perfOverlay = perfOn ? new PerfOverlay(renderer, () => qualityLevel()) : null;

/** Names over the holes in view, and the HUD only while there is a run to show (not on the title screen or the score screen). */
function updateTags(): void {
  const showing = mode !== 'title' && local.phase !== 'over';
  hud.setVisible(showing);
  nameTags.setVisible(showing);
  if (online) {
    const board = online.board;
    netStatus.online(board ? board.players : null, net?.rtt ?? null);
  } else if (joining) {
    netStatus.connecting();
  } else {
    netStatus.offline();
  }
  if (!showing) return;
  nameTags.begin();
  for (const hole of world.holes) {
    if (hole.phase !== 'playing') continue;
    const mesh = hole === local ? holeMesh : holeMeshes.meshOf(hole);
    if (mesh && mesh.group.visible) nameTags.add(hole, mesh, local, gameCamera.camera, window.innerWidth, window.innerHeight);
  }
  nameTags.end();
}

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
  // Online the room runs on whatever the player does (the menu is open, the title waits for the first snapshot).
  if (online) {
    input.update();
    const steer = mode === 'playing' && !away && world === online.world;
    online.update(Math.max(0, frameMs) / 1000, steer ? input.move.x : 0, steer ? -input.move.y : 0, performance.now());
    holeMesh.drawOffset.x = online.drawOffset.x;
    holeMesh.drawOffset.z = online.drawOffset.z;
  }
  const live = online ? world === online.world && mode !== 'title' : mode === 'playing';
  if (!live) {
    drawFrame(start);
    return;
  }
  let alpha: number;
  if (online) {
    alpha = online.alpha;
  } else {
    input.update();
    // Screen up is -Z on the play plane. The sim ignores input once the hole is out of play.
    local.input.x = input.move.x;
    local.input.z = -input.move.y;
    // Fixed steps of real time; whatever is left over carries to the next frame and the drawing interpolates into it.
    pending += realDt;
    while (pending >= world.dt) {
      world.step();
      pending -= world.dt;
    }
    alpha = pending / world.dt;
  }
  setPiece.update(realDt);
  handleEvents();
  snapshot.update(realDt);
  // A run with no photo yet gets one as the hole starts to evaporate.
  if (local.phase === 'evaporating') snapshot.ensure();
  hungerOverlay.update(realDt, local.hunger.level);
  // The disk dims as the hole starves and blinks while it is invulnerable after a hit or just spawned.
  holeMesh.disk.starvation = Math.max(hungerOverlay.level, blink(local));
  renderWorld(realDt, alpha);
  audio.update(realDt, local.radius, hungerOverlay.level, local.phase);
  gameCamera.punch = setPiece.punch;
  gameCamera.update(realDt, holeMesh.position, holeMesh.simRadius);
  arenaWall.update(realDt, holeMesh.simRadius);
  starfield.update(holeMesh.position, gameCamera.viewScale);
  mergerFlash *= Math.exp(-realDt / 0.25);
  banner.update(Math.max(setPiece.flash, (mergerFlash * HOLES.mergerFlash) / MILESTONE_FX.flashPeak));
  // Offline the board is worked out from the holes; online it comes from the server (Hud.setBoard).
  if (!online) hud.update(realDt, world.holes, local);
  updateTags();
  drawFrame(start);
}
requestAnimationFrame(frame);

# Progress - Spaghettify

## Next session
M3 Gravitational lensing shader. Recommended: Opus 5.5, xhigh (per milestone list). Screen-space post pass that bends the background (stars, prey, the disk's own image) around the player. Must slot in before bloom and keep `CorePass` (core redrawn after bloom) working. User should also playtest M1 feel and the M2 disk first and report tweaks to `GROWTH`, `PREY`, `DISK`, `BLOOM`.

## Milestones
Suggested model/effort in brackets.

- [x] M0 Scaffold, git, controllable player, bloom [Sonnet 5.5, medium] (2026-10-08)
- [x] M1 Core loop: eat smaller objects, grow, camera zoom scales with size [Sonnet 5.5, high] (2026-10-08, awaiting user playtest)
- [x] M2 Accretion disk shader [Opus 5.5, high] (2026-10-09, awaiting user playtest)
- [ ] M3 Gravitational lensing shader [Opus 5.5, xhigh]
- [ ] M4 Spaghettification (tidal stretch on large objects) [Opus 5.5, high]
- [ ] M5 Spawning and size tiers (debris, asteroids/moons, planets) [Sonnet 5.5, high]
- [ ] M6 Hunger / Hawking evaporation fail state, score screen [Sonnet 5.5, medium]
- [ ] M7 Audio, UI, juice, mobile controls [Sonnet 5.5, medium]
- [ ] M8 Performance pass (pooling, draw calls, phone test) [Opus 5.5, high]
- [ ] M9 Docker + TrueNAS deploy + Cloudflare subdomain + Umami [Sonnet 5.5, medium]
- [ ] Post-MVP: more tiers, daily seed, leaderboard, multiplayer

## Done
- 2026-10-08 M0: Vite + TS + Three.js scaffold, git, ESLint (flat config), Playwright smoke test.
  - `src/config/index.ts`: PLAYER, INPUT, CAMERA, BLOOM, RENDER, STARFIELD tunables.
  - `src/input/`: `InputSource` interface, `MouseInput` (follow), `KeyboardInput` (WASD/arrows), `InputManager` (first active source wins, outputs `move` vector, x right, y up).
  - `src/player/Player.ts`: drifting velocity model on the XZ plane, placeholder black core plus glowing ring, `setRadius`.
  - `src/render/`: `GameCamera` (tilted follow cam, distance scales with radius), `Renderer` (EffectComposer: render, UnrealBloom, Output).
  - `src/scene/Starfield.ts` with `src/shaders/starfield.{vert,frag}.glsl` (loaded via vite-plugin-glsl).
  - `tests/smoke.spec.ts`: loads, frames run, mouse moves player, keyboard moves player, no console errors. Uses `window.__spaghettify` debug handle (`frames`, `player`).
  - Scripts: `npm run dev | build | typecheck | lint | test`.

- 2026-10-08 M1: core loop.
  - `src/entities/PreyField.ts`: fixed pool of 60 lumpy rocks as one `InstancedMesh` (per-instance colour, spin, slow drift). Eat on contact if `radius < player.radius * edibleRatio`; eaten objects shrink into the hole (`eatTime`) then the slot is respawned on a ring just off screen. Spawn scale-in, far and stale (outgrown, off-screen) objects are recycled. Larger objects are inert (no damage or gravity).
  - `src/player/Player.ts`: `mass`, `eat(mass)`, `radiusForMass()`; visible `radius` chases the mass-implied radius (`GROWTH.radiusSmoothing`). `massOfRadius()` is shared by player and prey.
  - Config: `GROWTH` (density, absorbEfficiency, radiusExponent 0.5, smoothing), `PREY` (count, relative size range, eat ratio, spawn rings, drift, colours), `LIGHTING`.
  - Prey sizes are RELATIVE to the player radius at spawn time (0.2x to 2.2x, log-uniform, about 65 percent edible), so the field scales with you forever. M5 replaces this with absolute tier tables.
  - Smoke test now has a second test: teleports onto an edible prey via the debug handle (`player`, `prey`, `prey.isEdible`), asserts mass, radius and eatenCount rise, and that a larger object is not eaten.
  - Camera zoom (`distancePerRadius` 22) was checked by screenshot at radius 0.5 and 4.5: framing stays consistent. Feel not judged by a human yet.

- 2026-10-09 M2: accretion disk.
  - `src/player/AccretionDisk.ts` (owned by `Player` as `player.disk`): disk mesh plus camera-facing photon ring, both additive. Disk is one 3-layer stacked ring geometry (one draw call); the vertex shader remaps it to `[innerRadius, outer]` and flares the layers apart in height.
  - `src/shaders/accretionDisk.{vert,frag}.glsl`: Shakura-Sunyaev temperature profile, blackbody colour, relativistic Doppler beaming (left side brighter and bluer with CCW spin), Keplerian swirl with a two-phase flow-map cross-fade so the turbulence never winds up. `src/shaders/lib/{simplex3d,blackbody}.glsl` included via vite-plugin-glsl `#include`.
  - `src/shaders/photonRing.{vert,frag}.glsl`: thin ring hugging the shadow for a crisp edge.
  - Heat (0..1) drives outer radius, thickness, temperature (3800 K to 6000 K) and brightness. Heat = growth (log of eatenMass / startMass) plus activity (each meal adds gained / mass, decays). Fast rise, slow cool. All in `DISK` and `PHOTON_RING` config.
  - `src/render/CorePass.ts`: redraws the core (camera layer 1) after bloom, depth-tested against the scene depth, so glow never washes over the shadow. Toggle `BLOOM.keepCoreBlack`.
  - Renderer now uses ACES tone mapping (`RENDER.toneMappingExposure`). Bloom retuned to 0.4 / 0.12 / 1.0.
  - Smoke test asserts `player.disk.heat` rises after eating.
  - Judged by screenshot (SwiftShader) at heat 0, ~0.6 and 1. Animation (swirl speed, flow cross-fade pulsing) not yet judged by a human.

## In progress
(nothing)

## Decisions log
- 2026-09-28: Project named Spaghettify. Separate from Launch Window. Self-hosted on TrueNAS.
- 2026-10-08: Mouse follow uses screen-space offset from screen centre (not a plane raycast) so every input source is just a 0..1 vector. Camera keeps the player centred, so this matches "drift toward pointer".
- 2026-10-08: Gameplay plane is XZ, camera looks toward -Z tilted 58 degrees; screen up = -Z.
- 2026-10-08: Playwright uses SwiftShader flags so WebGL works headless. Dev server is reused if already running on 5173.

- 2026-10-08: Growth is mass-based with mass = r^3 and radius = startRadius * (mass/startMass)^0.5, so growth outpaces volume conservation a bit to keep early runs feeling quick. Tunable via `GROWTH.radiusExponent`.
- 2026-10-08: Prey rendered with one InstancedMesh so M4 (stretch shader) and M8 (draw calls) stay easy.

- 2026-10-09: Disk feeds on a "heat" level combining long-term growth and recent accretion rate, not raw eatenMass, so the disk reacts to each meal and will dim when starving (ties into M6 hunger).
- 2026-10-09: Core redrawn after bloom (CorePass) instead of fighting bloom settings; bloom can stay pretty without softening the shadow.
- 2026-10-09: ACES tone mapping added because the disk is HDR. Fed disks were capped near 6000 K and given a saturation boost because hotter blackbody colours read as grey-white after tone mapping.

## Known bugs
- Eating uses distance on the XZ plane only (centre within `radius + preyRadius * eatReach`), not true overlap. Big prey that are only edible barely may feel slightly late or early; tune `eatReach`.
- Smoke test "bigger object not eaten" can in theory flake if the player grows enough from a stray meal during its 300 ms window.
- Disk fill cost: 3 layers x 2 flow phases x 3 noise octaves per pixel. Fine on desktop; unverified on a phone. M8 can drop `DISK.layers` or `noiseOctaves` per quality level.
- At full heat the dim outer disk reads slightly muddy brown; tune `outerSoftness`, `colorSaturation` or `tempIntensityPower` by eye.

## Open questions
- Not yet playtested on a phone (no touch input until M7).

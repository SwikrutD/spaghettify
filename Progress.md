# Progress - Spaghettify

## Next session
M4 Spaghettification (tidal stretch on large objects). Recommended: Opus 5.5, high (per milestone list). Stretch big prey toward the hole as they fall in, in the prey vertex shader (the prey are one InstancedMesh). Prey stay on layer 0, so the lens bends the stretched shapes for free; keep them opaque so they write alpha 1 (see the alpha mask contract under M3). User should first playtest M1, M2 and M3 and report tweaks to `GROWTH`, `PREY`, `DISK`, `BLOOM`, `LENSING`.

## Milestones
Suggested model/effort in brackets.

- [x] M0 Scaffold, git, controllable player, bloom [Sonnet 5.5, medium] (2026-10-08)
- [x] M1 Core loop: eat smaller objects, grow, camera zoom scales with size [Sonnet 5.5, high] (2026-10-08, awaiting user playtest)
- [x] M2 Accretion disk shader [Opus 5.5, high] (2026-10-09, awaiting user playtest)
- [x] M3 Gravitational lensing shader [Opus 5.5, xhigh] (2026-10-09, awaiting user playtest)
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
  - `src/render/CorePass.ts`: redraws the core (`CORE_LAYER`) after bloom, depth-tested against the scene depth, so glow never washes over the shadow. Toggle `BLOOM.keepCoreBlack`.
  - Renderer now uses ACES tone mapping (`RENDER.toneMappingExposure`). Bloom retuned to 0.4 / 0.12 / 1.0.
  - Smoke test asserts `player.disk.heat` rises after eating.
  - Judged by screenshot (SwiftShader) at heat 0, ~0.6 and 1. Animation (swirl speed, flow cross-fade pulsing) not yet judged by a human.

- 2026-10-09 M3: gravitational lensing.
  - Pipeline (`src/render/Renderer.ts`): RenderPass (layer 0: stars, prey) > `LensingPass` > bloom > `CorePass` > output. Both composer buffers carry a `DepthTexture`.
  - `src/render/LensingPass.ts` + `src/shaders/lensing.{vert,frag}.glsl`: full-screen thin point-mass lens (deflection E * (E/r)^falloff, smooth window to zero at `radius`). Writes the bent colour AND the bent depth (`gl_FragDepth`), then draws the hole's own parts on top (`CORE_LAYER` core, `OVERLAY_LAYER` disk and photon ring), depth-tested against it. So the core is never bent and CorePass still finds a valid depth after the swap. Centre and core radius come from projecting `player.position` and `player.radius` each frame (exposed as `lensing.centre`, `lensing.coreRadius`).
  - Two layers: the far background (stars) bends with `einsteinRadius` 4; play-plane things (prey, disk) bend with `planeEinsteinRadius` 1.6, scaled by how far behind the hole they are (smoothstep from `planeDepthSoft` in front to `planeDepthRange` behind). Prey in front of the hole do not bend; prey behind it arc around.
  - Scene alpha is the layer mask: clear alpha 0, prey write 1, the starfield uses CustomBlending so it never writes alpha. Filtered alpha also stops bilinear background samples from picking up prey edges.
  - The disk bends itself in its vertex shader (`src/shaders/lib/lensVertex.glsl`, forward map with Newton steps) with the same lens (`lib/lens.glsl`, shared uniforms in `src/render/lensUniforms.ts`). Result: the near side hugs the core, the far side lifts and opens a dark crescent above it.
  - `src/render/layers.ts` holds `CORE_LAYER` (1) and `OVERLAY_LAYER` (2). The core is no longer on layer 0.
  - Quality: `lensing.setQuality(level)` indexes `LENSING.samples` (0 off, 1 tap, 4 taps inside `sampleZone` x E). Off also stops the disk bending.
  - `STARFIELD.count` 2500 to 9000 so the lens has enough stars to visibly bend.
  - Smoke test 3: core pixel black with the lens on and off, far side of the disk dark only when lensed, near side bright in both, still clean after a resize. Uses `__spaghettify.readPixel` (reads the frame right after it renders) and `renderer.lensing`.
  - Judged by screenshot (SwiftShader): arcs and dashes around the hole, a full Einstein ring when a star sits behind it, prey behind the hole lifted, big prey in front still cover the core. Perf (GTX 1070 Ti, 3840x2160 render): whole frame about 2.4 ms at quality 0 or 1, 2.6 ms at quality 2. No D3D shader warnings.

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

- 2026-10-09: The hole's own parts are kept out of the lensed image. A lensed image that contains the core magnifies the shadow into a big black annulus. The disk and photon ring are drawn after the lens; the disk bends itself per vertex.
- 2026-10-09: Bending scales with depth behind the hole (as real lensing does) instead of one uniform warp. A uniform warp pushed the whole disk away from the core and made nearby prey appear far from where they are. Stars get the strong lens, prey and the disk a weaker one.
- 2026-10-09: Scene alpha is the play-plane mask instead of depth or an extra render target: it is free, and filtered alpha also kills bilinear ghost edges. Contract: any future layer-0 effect that is not a solid play-plane object must leave alpha alone.
- 2026-10-09: Background hidden behind a prey in the unbent image falls back to the plane-bent background instead of black, so a future non-black backdrop cannot show dark shadows behind prey.

## Known bugs
- Lens: the squeezed zone inside the Einstein ring (under the disk and in the crescent above the core) can twinkle while moving. Quality 2 supersamples it with 4 taps; add taps or a low-res fallback if the playtest shows shimmer.
- Lens: near a prey close to the hole, stars bent with the plane strength sit next to stars bent with the full strength, so star positions jump slightly there. Not noticeable in screenshots.
- Lens: a star exactly behind the hole makes an Einstein ring with faint beads (magnified texels of a small star sprite). Rare and brief.
- Prey behind the hole look up to about 0.5 player radii farther out than they are, so they get eaten a little before they visibly touch. Reads as being pulled in; judge in playtest.
- Eating uses distance on the XZ plane only (centre within `radius + preyRadius * eatReach`), not true overlap. Big prey that are only edible barely may feel slightly late or early; tune `eatReach`.
- Smoke test "bigger object not eaten" can in theory flake if the player grows enough from a stray meal during its 300 ms window.
- Disk fill cost: 3 layers x 2 flow phases x 3 noise octaves per pixel. Fine on desktop; unverified on a phone. M8 can drop `DISK.layers` or `noiseOctaves` per quality level.
- At full heat the dim outer disk reads slightly muddy brown; tune `outerSoftness`, `colorSaturation` or `tempIntensityPower` by eye.

## Open questions
- Not yet playtested on a phone (no touch input until M7). Lens cost on a phone unknown; drop it to quality 1 first.
- Lens strength is a taste call: `einsteinRadius` 4 puts the star ring just outside the heat-0 disk. Is the far-side lift of the disk (`planeEinsteinRadius`, `planeDepthRange`) too much or too little?

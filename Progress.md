# Progress - Spaghettify

## Next session
M7 part 1: Web Audio (ambient drone reacting to size and hunger, synthesized SFX: eat, grow, tier-up, danger, evaporate) plus the music and SFX volume sliders and a mute toggle. Recommended: Sonnet 5.5, medium (per milestone list; M7 is split into audio first, then title/pause/settings UI and mobile controls, because it is too big for one segment). Playtest M6 first and report tweaks to `HUNGER` (src/config/index.ts).
How to start: `/clear`, then `/model` (Sonnet 5.5, medium), then paste the start prompt below.

```
Start Milestone 7 part 1 (audio) from Progress.md. Read Progress.md and CLAUDE.md first, and do only this segment.

Goal: Web Audio API only, no asset files. An ambient drone that reacts to hole size (tier or radius) and to hunger (Hunger.level / HungerOverlay.level), plus synthesized SFX for eat (pitch by prey size), grow, tier-up (hook TierDirector.onTierUp), danger/hunger warning and evaporate (Hunger.onEnd / phase 'evaporating'). Separate music and SFX gain nodes with volume sliders and a mute toggle, persisted in localStorage (try/catch). Audio must start after the first user gesture. Put tunables in a new AUDIO block in src/config. Code goes under src/audio/. Do not build the title screen, pause menu or mobile controls (later M7 parts). Player-facing copy: no em dashes, no serial commas, ASCII quotes.

Hooks that exist: window.__spaghettify exposes player, prey, tiers, hunger, hungerOverlay, camera, renderer. Player.eat(mass, what) is the eat event, Hunger.phase is 'playing' | 'evaporating' | 'over', ScoreScreen.onRestart restarts the run.

Done when: sound plays for each event in a manual check, no console errors with audio blocked or unavailable, and tsc, ESLint and the Playwright smoke tests pass (npm run typecheck, npm run lint, npm test). Add a smoke test that the audio context is created after a click and the mute toggle works. Update Progress.md and commit at the end.
```

## Milestones
Suggested model/effort in brackets.

- [x] M0 Scaffold, git, controllable player, bloom [Sonnet 5.5, medium] (2026-10-08)
- [x] M1 Core loop: eat smaller objects, grow, camera zoom scales with size [Sonnet 5.5, high] (2026-10-08, awaiting user playtest)
- [x] M2 Accretion disk shader [Opus 5.5, high] (2026-10-09, awaiting user playtest)
- [x] M3 Gravitational lensing shader [Opus 5.5, xhigh] (2026-10-09, awaiting user playtest)
- [x] M4 Spaghettification (tidal stretch on large objects) [Opus 5.5, high] (2026-10-09, awaiting user playtest)
- [x] M5 Spawning and size tiers (debris, asteroids/moons, planets) [Sonnet 5.5, high] (2026-10-09, awaiting user playtest)
- [x] M6 Hunger / Hawking evaporation fail state, score screen [Sonnet 5.5, medium] (2026-10-09, awaiting user playtest)
- [ ] M7 Audio, UI, juice, mobile controls [Sonnet 5.5, medium] (split: part 1 audio, part 2 title/pause/settings, part 3 mobile controls and juice)
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
  - (Prey sizes were relative to the player radius in M1; M5 replaced that with absolute tier tables.)
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

- 2026-10-09 M4: spaghettification.
  - `src/entities/preyMaterial.ts`: `createPreyMaterial()` is the old MeshStandardMaterial (flat shaded, opaque) with chunks injected via `onBeforeCompile` (fails loudly if a three.js chunk is renamed). Still one draw call, layer 0, alpha 1.
  - `src/shaders/preySpaghettify.{pars.vert,vert}.glsl`: replaces `<project_vertex>`. In world space, around each instance centre: stretch along the hole direction, squeeze across by `stretch ^ -squeeze`, squash radial distances below `knee` core radii smoothly toward zero (nothing pokes out the far side), then rotate about the hole by `curl * ln(rc / r)` so the stream winds into a spiral with the disk's spin. Flat shading derives normals from the final position, so lighting follows the shape.
  - `src/shaders/preyGlow.{pars.frag,frag}.glsl`: HDR emissive tidal-heating glow on parts within `glowReach` core radii (catches bloom).
  - Per-instance attributes: `aStretch` (dirX, dirZ, stretch, curl) and `aGlow`. Uniform `uHole` (x, z, core radius) set each frame in `PreyField.update`.
  - `PreyField`: edible prey pre-stretch on approach (gap below `onsetGap` player radii, up to `approachStretch`). When eaten: infall over `infallTimeMin..Max` (size weighted), distance shrinks as `1 - t^accelPower` while swinging `swirl` rad around the hole; stretch ramps to `maxStretch` (size weighted), curl and glow build; drains (shrinks) from `drainStart`. The infall is an offset from the hole, so it follows a moving player. `PREY.eatTime` removed. Mass is still credited at the moment of contact.
  - Size weight = (preyRadius / (playerRadius * edibleRatio)) ^ `sizePower`. Inedible objects stay inert.
  - Config: new `SPAGHETTI` block.
  - Smoke test 4: no stretch far away, stretch along the hole line when close, stretch above 1.5 and aligned with the hole every frame of the infall, and by the last infall frame the object is close to the centre and drained. Reads the GPU attribute and instance matrices.
  - Judged by screenshot (SwiftShader, frozen infall at several progress values and angles): a curved, thin stream that wraps into the core; from behind the hole the lens lifts it over the far disk. Not yet judged in motion by a human.

- 2026-10-09 M5: scale fixes, size tiers, set piece.
  - Playtest fixes. Speed was a fixed 9 u/s while the camera zoomed in proportion to radius, so on-screen speed fell as you grew. Now `PLAYER.maxSpeed * viewScale ^ speedExponent` (viewScale = camera distance over start distance, exponent 1): constant on-screen speed, Hole.io style. The "only the ring grows" bug: camera distance was exactly proportional to radius (core constant on screen) while the disk widened with heat. Now distance = `CAMERA.startDistance * (radius / startRadius) ^ zoomExponent` (0.7), so the hole itself gets bigger on screen as it grows. Disk growth is smaller too (`DISK.outerRadiusMax` 4.4 to 3.6, `growthFullMassRatio` 300 to 100000 so heat growth spans the whole game).
  - Mass is area-like: `GROWTH.massExponent` 2 (mass = radius squared, was cubed), radiusExponent 0.5 conserves area. With absolute prey sizes the old cubic prey mass made one big meal jump a whole tier. Tier thresholds use these units (mass 9 is radius 3, mass 400 is radius 20).
  - `src/config/tiers.ts`: `TIERS` (title, `minMass`, entity budget `count`, `cameraScale`, weighted prey classes with a log-uniform radius range and HSL colour ranges), `TIER_UP` set piece tunables, helpers `tierIndexForMass`, `tierMinRadius`, `PREY_POOL_SIZE`. Class names are generic real classes (dust grain, pebble, rock, boulder, asteroid, small moon, dwarf planet, moon, rocky planet, ice giant, gas giant); sizes are ordered correctly but not to scale.
  - `PreyField`: one pool of `PREY_POOL_SIZE` slots, the first `tier.count` live (`mesh.count`). Respawn draws a class by weight from the current tier and redraws specks below `PREY.minRelSize` x player radius. Spawn, respawn and despawn distances are now in camera distances (`PREY` initialInner/Outer, respawnInner/Outer, despawnDistance, driftSpeed) from `view.targetDistance`, so the field always fills the screen. `setTier()` refills slots that join and any live prey smaller than the new table's minimum. `PreyObject.className` is stored; `player.biggestEaten` records the biggest object eaten.
  - `src/spawning/TierDirector.ts`: tier index (monotonic) from `player.mass`, `onTierUp`, and the set piece envelopes on real time: camera `punch`, game `timeScale` dip (0.25 for 0.9 s), white `flash`. `src/ui/TierBanner.ts`: DOM flash plus "TIER n / title" banner. `GameCamera`: tier scale eases in (`TIER_UP.pullRate`), punch adds up to 30 percent distance, near and far clip planes scale with distance, `targetDistance` and `viewScale` getters.
  - `src/scene/Starfield.ts` and `starfield.vert.glsl`: the star field now wraps around the player and scales with the view scale. Before it was fixed in the world (300 extent) and would run out of stars when you travel or zoom out.
  - Smoke tests 5 and 6: crossing each threshold by eating (mass set just under the threshold) changes the tier, raises the camera scale and target distance, dips `timeScale`, leaves no live prey below the new table's minimum, records `biggestEaten` and shows the banner; the final live prey all fit tier 3's table. On-screen speed stays within 25 percent between mass 0.25 and 100. Both use a small viewport (SwiftShader is slow).
  - Judged by screenshot on the real GPU (`--use-angle=d3d11`, 60 fps at 1280x720 at all tiers): the hole core grows from about 16 percent of screen height at the start to about 22 to 25 percent and steps back at each tier pull-back; prey table and colours change per tier. Feel in motion, pacing and the set piece have not been judged by a human.

- 2026-10-09 M6: hunger fail state and score screen.
  - `HUNGER` block in `src/config/index.ts`: `graceTime` 7 s, `warnTime` 3.5, `decayRate` 0.09 per second (ramps in over `rampTime` 2), floor = max(`failMass` 0.1, run peak mass x `failPeakFraction` 0.5), `evaporateTime` 1.8 s real, `pointsPerMass` 1000. `DISK.starveDim` 0.8.
  - `src/player/Hunger.ts`: phases `playing` > `evaporating` > `over`. Eating (eatenCount change) resets `idle`. After the grace time mass decays exponentially. At the floor the hole evaporates for `evaporateTime` real seconds (input off, eating off via `player.canEat`, mass drains to 0.4 x floor so the camera never hits radius 0), then `onEnd` shows the score screen. `level` 0..1 (time-based warning up to 0.4, then follows progress to the floor). `enabled` flag for tests.
  - `src/ui/HungerOverlay.ts`: red vignette plus "HAWKING RADIATION: EAT" / "EVAPORATING" text driven by a smoothed level. `player.disk.starvation` follows that level and dims disk brightness and the photon ring.
  - `src/ui/ScoreScreen.ts` + `milestones.ts`: score (eatenMass x 1000), best (localStorage `spaghettify.best`), ladder line from `biggestEaten` ("You ate a moon"), tier reached, objects eaten, time, PLAY AGAIN (button or Enter).
  - Restart (`main.ts`): `player.reset()`, `tiers.reset()`, `gameCamera.reset()`, `prey.reset(tier)` (refills the whole pool, camera first), `hunger.reset()`, overlay and banner reset.
  - Smoke test 7: eat, skip the grace period, mass drains and the warning and disk dimming show, push to the floor, score screen stats match the debug handle, PLAY AGAIN gives a fresh run that can eat. The tier and speed tests set `hunger.enabled = false`. Also made test 2 robust (big object must be over 2x the player radius).
  - Not judged by a human: vignette look, disk dimming, pacing of the drain, the score screen layout.

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

- 2026-10-09: Spaghettification injects into MeshStandardMaterial (`onBeforeCompile`, chunks in .glsl files) instead of a full custom ShaderMaterial, to keep three's lighting and flat shading for free.
- 2026-10-09: Stretch happens in world space after the instance transform (not in local space), so spin does not twist the stream; the CPU passes the hole direction per instance.
- 2026-10-09: Added a spiral curl and swirl on the infall, plus a tidal heating glow. A straight stick read as a stretched rock; the curl reads as matter falling into a spinning hole. All three can be zeroed in `SPAGHETTI`.

- 2026-10-09: On-screen movement speed is held constant by scaling world speed with the camera distance (exponent 1), and the camera zooms out more slowly than the hole grows (exponent 0.7) so the hole gets visibly bigger. Tier pull-backs shrink it again on screen, so it ranges about 1x to 2.3x its starting size.
- 2026-10-09: Mass is area-like (radius squared) so absolute-size prey stay proportionate: a meal the size of the hole roughly doubles its area. A cubic prey mass made single meals jump tiers.
- 2026-10-09: Prey tables are absolute but the screen stays useful through the `minRelSize` filter (no specks next to a big hole) and the table design (the small end of each table is edible at the tier start, the big end is 5 to 10 times the tier-start radius and rare). Spawn distances are fractions of the camera distance, not of the player radius.
- 2026-10-09: Tier never goes back down (monotonic) so shedding mass cannot replay the set piece. Revisit in M6 if hunger shrinking should drop tiers.
- 2026-10-09: Tier set piece = camera pull-back punch + 0.9 s slow-mo + white flash + banner, all driven by one `TierDirector` on real time. The prey refill at tier-up happens under the flash so nothing visibly pops.

- 2026-10-09: Tier stays monotonic when hunger shrinks the hole (a tier is "reached", and going back down would replay the set piece). The score screen reports the highest tier reached.
- 2026-10-09: The fail floor is relative to the run's peak mass (half of it) so starving matters at every size; an absolute floor alone would take a minute to hit at planet mass. Mass lost to hunger is never regained, so the floor only moves up.
- 2026-10-09: Score = mass eaten x 1000 so the first meals (dust grains of mass 0.0025) still count.
- 2026-10-09: Hunger runs on game time (so it pauses in tier-up slow motion); the final evaporation runs on real time.

## Known bugs
- Spaghetti: a prey eaten with its centre exactly on the hole (only happens with debug teleports) stretches along its last direction and half of it shows on one side until it drains.
- Spaghetti: a stream behind the hole is lifted by the lens and wraps along the shadow edge instead of visibly entering the core. Looks like a photon-ring wrap; judge in playtest.
- Spaghetti: the 6x stretched rock shows its low-poly facets (mesh detail 2). Fine with the flat-shaded look; raise `PREY.meshDetail` if it reads badly.
- Lens: the squeezed zone inside the Einstein ring (under the disk and in the crescent above the core) can twinkle while moving. Quality 2 supersamples it with 4 taps; add taps or a low-res fallback if the playtest shows shimmer.
- Lens: near a prey close to the hole, stars bent with the plane strength sit next to stars bent with the full strength, so star positions jump slightly there. Not noticeable in screenshots.
- Lens: a star exactly behind the hole makes an Einstein ring with faint beads (magnified texels of a small star sprite). Rare and brief.
- Prey behind the hole look up to about 0.5 player radii farther out than they are, so they get eaten a little before they visibly touch. The M4 infall now starts from there, so it reads as being pulled in; judge in playtest.
- Prey: planets and moons are the same flat-shaded lumpy low-poly rock mesh as asteroids, only coloured per class. Big bodies look like potatoes; needs round smooth bodies (a second mesh type or a per-instance roundness) at the M7 visual pass.
- Prey: big inert objects overlap each other, and the hole can end up inside one when it drifts into it. Harmless until dangers arrive; spawn clears the hole but nothing separates prey from prey.
- Tiers: thresholds (mass 9 and 400), counts (80, 70, 60) and class weights are set from numbers and stills only. The early game may be sparse or a tier too short or long; tune `TIERS` after a playtest.
- Tests: SwiftShader runs about 3 to 5 fps at 1280x720 with the lens on, so the tier and speed tests use a small viewport. For real performance numbers or screenshots, a scratch spec with `launchOptions.args: ['--use-angle=d3d11', '--ignore-gpu-blocklist']` uses the GPU.
- Eating uses distance on the XZ plane only (centre within `radius + preyRadius * eatReach`), not true overlap. Big prey that are only edible barely may feel slightly late or early; tune `eatReach`.
- Disk fill cost: 3 layers x 2 flow phases x 3 noise octaves per pixel. Fine on desktop; unverified on a phone. M8 can drop `DISK.layers` or `noiseOctaves` per quality level.
- At full heat the dim outer disk reads slightly muddy brown; tune `outerSoftness`, `colorSaturation` or `tempIntensityPower` by eye.

## Open questions
- Hunger pacing: about 16 s from last meal to run end at the start (7 s grace plus roughly 9 s drain). Too harsh or too soft? Tune `HUNGER`. No pause menu yet, so a tab left idle in the background still evaporates (frames are capped at 0.05 s per frame, so it is slow when hidden).
- Spaghetti feel: infall time (0.35 s to 0.85 s), `maxStretch` 6, `curl` 0.6 and glow strength are set from stills only.
- Not yet playtested on a phone (no touch input until M7). Lens cost on a phone unknown; drop it to quality 1 first.
- Lens strength is a taste call: `einsteinRadius` 4 puts the star ring just outside the heat-0 disk. Is the far-side lift of the disk (`planeEinsteinRadius`, `planeDepthRange`) too much or too little?

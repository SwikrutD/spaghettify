# Progress - Spaghettify

## Next session
M1 Core loop: eat smaller objects, grow, camera zoom scales with size. Recommended: Sonnet 5.5, high.

## Milestones
Suggested model/effort in brackets.

- [x] M0 Scaffold, git, controllable player, bloom [Sonnet 5.5, medium] (2026-10-08)
- [ ] M1 Core loop: eat smaller objects, grow, camera zoom scales with size [Sonnet 5.5, high]
- [ ] M2 Accretion disk shader [Opus 5.5, high]
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

## In progress
(nothing)

## Decisions log
- 2026-09-28: Project named Spaghettify. Separate from Launch Window. Self-hosted on TrueNAS.
- 2026-10-08: Mouse follow uses screen-space offset from screen centre (not a plane raycast) so every input source is just a 0..1 vector. Camera keeps the player centred, so this matches "drift toward pointer".
- 2026-10-08: Gameplay plane is XZ, camera looks toward -Z tilted 58 degrees; screen up = -Z.
- 2026-10-08: Playwright uses SwiftShader flags so WebGL works headless. Dev server is reused if already running on 5173.

## Known bugs
- Placeholder ring blooms heavily and softens the black core. Bloom is tuned (0.3 / 0.2 / 0.9) but the disk shader in M2 should retune it.

## Open questions
- Not yet playtested on a phone (no touch input until M7).

# Spaghettify

A browser arcade game. The player is a baby black hole, starting pea-sized, drifting through space and eating everything: dust, asteroids, moons, planets, stars. Katamari / Hole.io energy with black hole physics as the spectacle. Easy to learn, "one more run" addictive, visually striking.

The name is literal: spaghettification is the stretching of an object into a long thin shape by extreme tidal forces near a black hole. The theme is physics, not food. Do not add food-themed hazards, prey or jokes.

Goal: a public game with real players. Retention, a global leaderboard and shareability matter, so polish the first 30 seconds and the end-of-run screen.

## Session protocol (read first)

1. At the start of EVERY session, read `Progress.md` before doing anything else. It is the source of truth for what is done, what is in progress and what is next. Sessions are often started fresh after `/clear`, so do not assume any prior context.
2. Work on ONE segment (one milestone or sub-task) per session unless told otherwise.
3. Before ending a session, or when the user says they are wrapping up, update `Progress.md`:
   - Move finished items to Done with the date
   - Record the current state of anything half-finished, precisely enough that a fresh session can pick it up cold (file names, what works, what does not)
   - Add any decisions made and why to the Decisions log
   - Add known bugs and open questions
   - Set the "Next session" section to the single most useful next step, including the recommended model and effort for it
4. Keep `Progress.md` concise. Prune stale notes rather than letting it grow forever.
5. Commit to git at the end of each segment with a clear message.

### End-of-segment recap (required)

At the end of every segment, give a short recap in chat AND save the same information to `Progress.md`. The recap must contain:

- What was done and what state it is in
- Known bugs or open questions
- **Next segment:** name of the next milestone or sub-task
- **Recommended model and effort for the next segment:** pick from the milestone list in `Progress.md` (the bracketed suggestions), and adjust if what happened this session changes the difficulty. Say why in one line if it differs from the list.
- **How to start it:** the exact steps, e.g. run `/clear`, then `/model` to set the model and effort, then paste the start prompt.
- **Start prompt:** a ready-to-paste prompt in a code block for the next session. It must name the milestone, state the concrete goal and the done criteria (including `tsc`, ESLint and the Playwright smoke test passing), mention any half-finished state or known bugs that matter, and remind the session to read `Progress.md` first and to do only this one segment.

Rough guide for choosing: Sonnet 5.5 at medium for scaffolding, UI, audio and deploy work; Sonnet 5.5 at high for gameplay systems; Opus 5.5 at high for shaders and performance work; Opus 5.5 at xhigh only for the hardest shader or architecture problems (for example lensing).

## Game design

- **Core loop:** Move the black hole, eat objects smaller than you, grow, unlock bigger prey. Larger objects are dangerous.
- **Growth:** Continuous. Radius scales smoothly with mass. Tiers are mass thresholds that change the scene scale and the prey table, with a short set-piece moment when you cross one.
- **Dangers:**
  - Gravity pull from large bodies that drags you toward them
  - Collisions with bigger objects knock you back and shed mass
  - Roaming hazards that actively move through the scene (comets, rival black holes, stars at higher tiers). Keep them astronomical and on theme.
- **Hunger:** If you go too long without eating you slowly evaporate (Hawking radiation as a fail state). This keeps runs moving.
- **Spectacle (the point of the game):**
  - Tidal stretching: large objects visibly spaghettify on the way in
  - Accretion disk that brightens and thickens as you feed
  - Gravitational lensing of the background around the player (screen-space shader is fine; it does not need to be a full geodesic ray tracer)
  - Size tiers change the scene scale: dust field, asteroid belt, planetary system, star cluster, galaxy core
- **Run structure:** Short runs (a few minutes), score = mass eaten, with a size milestone ladder ("You ate Jupiter").
- **MVP scope:** Single-player, three size tiers (debris, asteroids/moons, planets), lensing + disk + spaghettification working, hunger fail state, score screen.
- **Public features (after MVP, in this order):** share card (score image or link), nickname entry, global leaderboard.
- **Later / not committed:** More tiers, power-ups, daily seed, real-time multiplayer.

## Look and feel

- **Camera:** Tilted 2.5D. Gameplay logic runs on a flat plane; the camera is angled so depth, the disk and the stretching read well. Camera distance and zoom scale with the player's size.
- **Art style:** Realistic-ish space. Dark background, physically inspired glowing accretion disk, believable planets and stars. No cartoon faces.
- **Audio:** Web Audio API only, no asset files. An ambient drone that reacts to size and hunger, plus synthesized SFX (eat, grow, tier-up, danger, evaporate).

## Public features detail

- **Share card:** a canvas-rendered PNG with score, biggest object eaten and a screenshot of the run. Share through the Web Share API with a download fallback.
- **Leaderboard anti-cheat (light):** server rate limits, score sanity caps and a nickname profanity filter. Accept that some cheating will happen; do not build replay validation.

## Menus and settings

- Title screen: play button, best score, nickname entry
- Pause menu: resume and quit run (also pauses on tab blur)
- Settings panel: separate music and SFX volume sliders, control scheme (including the mobile finger follow or joystick toggle) and quality level
- No first-run tutorial overlay for now; the first seconds of play should teach the loop
- Accessibility is minimal for now beyond the volume sliders and a mute toggle

## Controls

- Desktop: mouse follow (the hole drifts toward the pointer). Keyboard (WASD or arrows) as an alternative is welcome.
- Mobile: touch with a toggle in the settings between finger follow and a virtual joystick. Remember the choice in localStorage.
- Gamepad support: left stick to move.
- All input goes through one input abstraction that outputs a desired movement vector, so game logic never reads a device directly.

## Tech stack

- Frontend: Vite + TypeScript + Three.js (same family as the user's Rex Chase project)
- Rendering: custom GLSL shaders for the accretion disk, lensing and stretching; post-processing (bloom) via Three.js EffectComposer or pmndrs/postprocessing
- Physics: simple custom 2.5D gravity and collision; no heavy physics engine unless clearly needed
- Audio: Web Audio API
- Backend (needed for the leaderboard): Node (Fastify) + SQLite, packaged as a Docker container. Leaderboard accepts an anonymous nickname only (no accounts), with basic validation and rate limiting. If multiplayer is attempted much later, WebSockets from the same server
- Frontend must work on its own; the backend is additive and the game must still play if it is unreachable

## Quality and testing

- `tsc` (typecheck) and ESLint must pass before a segment is called done
- A Playwright smoke test must pass: the game loads, runs a few seconds of frames with no console errors and the player can move
- Add or update the smoke test when a milestone adds a new screen or flow
- The user playtests each milestone; shaders are judged by eye

## Performance and devices

- Targets: 60 fps on a mid-range laptop and a recent phone
- Quality auto-scales down when frame time is bad (render resolution first, then bloom, then lensing detail)
- Object pooling for spawned entities; keep a fixed entity budget per tier
- Test on a phone before calling a milestone done

## Hosting

- Self-hosted on the user's TrueNAS server (Docker app), not a static-only host
- Domain: a swikrut.com subdomain; DNS is managed in Cloudflare
- Umami analytics, same as Rex Chase
- Keep a `Dockerfile` and `docker-compose.yml` at the root once a backend exists

## Code conventions

- Game systems split by concern under `src/` (e.g., `player/`, `entities/`, `spawning/`, `shaders/`, `input/`, `audio/`, `ui/`)
- Tunable numbers (growth rate, hunger decay, spawn density, tier thresholds, hazard speeds) in `src/config/`, never hard-coded in logic
- Shaders in their own `.glsl` files, not inline strings
- Physics flavor over strict accuracy is fine here, but any real fact shown to the player (masses, sizes, "you ate X") must be correct

## Writing style for any player-facing copy or docs

- No em dashes, and no en dashes used as punctuation
- No serial (Oxford) commas
- Straight ASCII quotes and apostrophes

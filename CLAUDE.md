# Spaghettify

A browser multiplayer arcade game. The player is a baby black hole, starting pea-sized, drifting through a shared arena and eating everything: dust, asteroids, moons, planets and other black holes. Hole.io / slither.io energy: drop into a live arena with other players and bots, grow, eat holes smaller than you and avoid the bigger ones. Black hole physics is the spectacle. Easy to learn, "one more run" addictive, visually striking.

Direction change (2026-10-09): the single-player MVP (M0 to M13) shipped, but playtesting showed it gets boring once the hole is big, because nothing pushes back. The game is now an endless drop-in arena shared by real players and bot black holes that eat each other. Everything below reflects that.

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

Rough guide for choosing: Sonnet 5.5 at medium for scaffolding, UI, audio and deploy work; Sonnet 5.5 at high for gameplay systems; Opus 5.5 at high for shaders and performance work; Opus 5.5 at xhigh only for the hardest shader or architecture problems (for example lensing, the multiplayer server and netcode).

## Game design

- **Core loop:** Drop into a live arena, eat objects and black holes smaller than you, grow, and avoid holes bigger than you. Being eaten ends the life; you respawn as a pea in the same arena.
- **Run format:** Endless drop-in (slither.io style). Press Play to join the fullest open arena; play until you are eaten (or evaporate); the score screen shows that life; Play again respawns you. No rounds, no lobby wait.
- **Other black holes (the main threat and the late game):**
  - Bot holes fill every arena up to a target population (around 12 holes). Bots wander, feed, chase smaller holes and flee bigger ones, with some variety in skill and temperament so they are beatable.
  - Hole vs hole: a hole whose radius is clearly bigger (a tunable ratio, around 1.15) swallows a smaller one whose centre it covers; the victim spaghettifies into it and most of its mass transfers. Holes too close in size bump off each other and both shed mass.
  - Bots are never posted to the global leaderboard.
- **World:** One bounded arena per room where all sizes coexist: dust everywhere, asteroids, moons and planets scattered through it, so a pea and a planet-eater share the same space. Each player's camera zooms out as they grow. The arena edge is a soft boundary (on theme, for example a dense gas wall that pushes back).
- **Growth:** Continuous. Radius scales smoothly with mass. Tiers are now size milestones (banner, set piece, sound) rather than a scene swap; the prey population of the arena does not change per player.
- **Dangers:**
  - Bigger black holes (players and bots)
  - Gravity pull from large bodies and big holes that drags you toward them
  - Bumping into something too big to swallow knocks you back and visibly shrinks you (the shed matter is thrown off as debris anyone can eat)
  - Roaming hazards (comets now, more later). Keep them astronomical and on theme.
- **Hunger:** Size-scaled Hawking decay instead of a countdown. Holes slowly lose mass when they stop eating, faster the bigger they are, so a leader cannot camp forever. A tiny starving hole can still evaporate, which ends that life.
- **Spectacle (the point of the game):**
  - Tidal stretching: large objects visibly spaghettify on the way in
  - Accretion disk that brightens and thickens as you feed
  - Gravitational lensing of the background around the player (screen-space shader is fine; it does not need to be a full geodesic ray tracer)
  - Hole eats hole: the smaller hole is torn into a stream around the bigger one's disk, with a visible merger moment (flash, shake, a gravitational wave ripple)
  - The camera zooming out as you grow carries the sense of scale (dust field to planetary system)
- **Score:** peak mass of that life, plus holes eaten; size milestone ladder ("You ate Jupiter", "You ate <nickname>"). Live top 10 of the arena in a corner of the HUD.
- **Shipped single-player MVP (M0 to M13):** lensing, disk, spaghettification, tiers, hunger, score screen, audio, menus, touch, perf ladder, Docker deploy, share card, global leaderboard, dangers, round planets.
- **Committed next (in this order):** bump shrink fix, simulation split into a shared sim, mixed arena, bot holes and hole vs hole eating (offline arena), online multiplayer server, netcode client, leaderboard and share card for the arena. See `Progress.md`.
- **Later / not committed:** private room codes, more body types (stars, a central galaxy core), power-ups, daily events, disk cosmetics.

## Look and feel

- **Camera:** Tilted 2.5D. Gameplay logic runs on a flat plane; the camera is angled so depth, the disk and the stretching read well. Camera distance and zoom scale with the player's size.
- **Art style:** Realistic-ish space. Dark background, physically inspired glowing accretion disk, believable planets and stars. No cartoon faces.
- **Audio:** Web Audio API only, no asset files. An ambient drone that reacts to size and hunger, plus synthesized SFX (eat, grow, tier-up, danger, evaporate).

## Public features detail

- **Share card:** a canvas-rendered PNG with score, biggest object eaten and a screenshot of the run. Share through the Web Share API with a download fallback.
- **Leaderboard anti-cheat (light):** server rate limits, score sanity caps and a nickname profanity filter. Online lives are scored by the server itself (authoritative), so they are trustworthy; offline arena scores keep the sanity caps. Accept that some cheating will happen; do not build replay validation.
- **Nicknames in the arena:** shown over each hole (players and bots), filtered by the same profanity filter. Players without a nickname get a generated on-theme name.

## Menus and settings

- Title screen: play button, best score, nickname entry, online status (players online, or offline arena)
- Pause menu: online there is no real pause (the arena keeps running); Escape opens a menu with settings and leave arena. The offline arena still pauses, including on tab blur.
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
- Backend: Node (Fastify) + SQLite, packaged as a Docker container. Leaderboard accepts an anonymous nickname only (no accounts), with basic validation and rate limiting.
- Multiplayer: WebSockets from the same Node server (`/ws`). Server-authoritative: each room steps the same simulation code as the client at its fixed 60 Hz and sends snapshots at 20 Hz (decided in M18, see `Progress.md`). Clients send only their movement vector and receive compact binary snapshots of what is near them (interest management). The client predicts its own hole and interpolates everyone else. Bots run on the server in online rooms.
- Simulation code lives in `src/sim/`: pure TypeScript with no three.js, DOM or browser imports, fixed timestep, deterministic given a seed. Both the game and the server import it, so it follows the server's rules (erasable TS only, `.ts` import extensions; see `Progress.md`). Rendering, audio and UI only read sim state and sim events. The online protocol (`src/protocol/`) is shared the same way.
- Frontend must work on its own; the server is additive. If it is unreachable the game falls back to a local offline arena with bots only, and says so on screen.

## Quality and testing

- `tsc` (typecheck) and ESLint must pass before a segment is called done
- A Playwright smoke test must pass: the game loads, runs a few seconds of frames with no console errors and the player can move
- The simulation in `src/sim/` gets fast headless unit tests (`node --test`) for eating, bumping, hole vs hole, decay and bots
- Multiplayer gets a test that runs the real server with two browser clients in one arena (they see each other and one can eat the other), plus a test that the game falls back to the offline arena when the server is down
- Add or update the smoke test when a milestone adds a new screen or flow
- The user playtests each milestone; shaders are judged by eye

## Performance and devices

- Targets: 60 fps on a mid-range laptop and a recent phone
- Quality auto-scales down when frame time is bad (render resolution first, then bloom, then lensing detail)
- Object pooling for spawned entities; a fixed entity budget per arena, a spatial grid for queries and rendering only what is near the camera
- Network budget: a few KB per second per client; the server must hold several full rooms on the TrueNAS box
- Test on a phone before calling a milestone done

## Hosting

- Self-hosted on the user's TrueNAS server (Docker app), not a static-only host
- Domain: a swikrut.com subdomain; DNS is managed in Cloudflare
- Umami analytics, same as Rex Chase
- Keep a `Dockerfile` and `docker-compose.yml` at the root; Caddy proxies `/api` and the WebSocket endpoint to the Node server

## Code conventions

- Game systems split by concern under `src/` (e.g., `sim/`, `net/`, `bots/`, `player/`, `entities/`, `shaders/`, `input/`, `audio/`, `ui/`)
- Tunable numbers (growth rate, hunger decay, spawn density, tier thresholds, hazard speeds, bot behaviour, tick rate) in `src/config/`, never hard-coded in logic
- Shaders in their own `.glsl` files, not inline strings
- Physics flavor over strict accuracy is fine here, but any real fact shown to the player (masses, sizes, "you ate X") must be correct

## Writing style for any player-facing copy or docs

- No em dashes, and no en dashes used as punctuation
- No serial (Oxford) commas
- Straight ASCII quotes and apostrophes

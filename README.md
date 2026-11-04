# Spaghettify

A multiplayer browser arcade game. You're a baby black hole, pea-sized, drifting through a shared
arena. Eat dust, asteroids, moons, planets and any black hole smaller than you. Avoid the ones
bigger than you.

**Play:** https://spaghettify.swikrut.com

The name is literal: spaghettification is what happens to anything stretched long and thin by
the tides near a black hole.

## How it plays

- **Endless drop-in.** Press Play to join the fullest open arena. Play until you're eaten, then
  respawn as a pea in the same arena.
- **Other holes are the real threat.** Bots fill each arena alongside real players. A clearly
  bigger hole swallows a smaller one and takes most of its mass.
- **One arena, every size.** Dust, asteroids, moons and planets share the same space, and the
  camera zooms out as you grow.

## Run locally

```
npm install
npm run server    # game server
npm run dev       # client (Vite)
```

`npm test` runs the simulation tests, the server tests and a Playwright smoke test.

TypeScript, Canvas, WebSockets and Vite, deployed with Docker and Caddy.

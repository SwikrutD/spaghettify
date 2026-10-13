# Deploying Spaghettify

Two containers from one `Dockerfile`, run together by `docker-compose.yml`:

- **`spaghettify`** (image `spaghettify:latest`, the default build target `web`): Caddy serving the Vite
  build and proxying `/api/*` and the `/ws` WebSocket to the api container. Listens on 8080 inside,
  published on host port 8095 (change it freely). This is the only container Cloudflare talks to.
- **`api`** (image `spaghettify-api:latest`, target `api`): the game server, Fastify on Node 24 with the
  built-in SQLite: the leaderboard and the online arena (rooms running the shared simulation). Listens on
  3000 on the compose network only (no published port). Its database file is `/data/leaderboard.db` on a
  volume. If it is down, the game still plays; the score screen says the leaderboard is unavailable.

TLS is not handled by the containers: Cloudflare (Tunnel or proxy) sits in front of them.

What the web image does:

- `npm ci`, `npm run build` (typecheck plus Vite build), then `scripts/precompress.mjs` writes `.br` and `.gz` copies.
- Caddy serves `/assets/*` (content-hashed) with `Cache-Control: public, max-age=31536000, immutable`
  and everything else (`index.html`) with `no-cache`, so a new deploy shows up on the next load.
- Brotli or gzip from the precompressed files, on-the-fly gzip or zstd for anything else. Errors are `no-store`.
- Health check: `wget` on `/` every 30 s.

What the api does:

- `POST /api/scores`, `GET /api/scores/top`, `GET /api/scores/rank?score=n`, `GET /api/online` (players and
  rooms), `GET /api/health`, all `no-store`.
- The online arena on the WebSocket `/ws`: up to 8 rooms of 12 holes (bots fill what players do not), one
  simulation step 60 times a second per room and a snapshot of what is near each player 20 times a second.
  Lives played online are scored by the server and posted to the board under the player's nickname. Limits
  per connection and per IP are in `NET.limits` (`src/config/net.ts`).
- What it costs (M21 load test, `npm run load`): every room runs on the one Node thread. A full room of 12
  players is about 4 to 5 percent of one i7-8700K core with its sockets (about 6 percent of the TrueNAS
  i3-6100), so 8 full rooms (96 players) take about half of one i3 core; Caddy proxying their WebSockets
  takes about as much again on the other threads. Memory: about 5 MB per room, the api stays under
  200 MB. Upload: about 2 KB/s of game data per player (up to about 10 KB/s for a player who has grown
  huge), about 3.5 KB/s on the wire with TCP, TLS and WebSocket framing: 96 players need about 3 Mbit/s
  of upload. No new room opens while the rooms use more than 75 percent of a core (`NET.rooms.maxLoad`).
  `/api/online` reports that share as `load`.
- Light anti-cheat: 6 score submissions and 120 requests per minute per client IP, score sanity caps from
  the run time and the size milestones, a nickname filter (shared rules in `src/leaderboard/rules.ts`).
- The client IP is taken from `X-Forwarded-For` only through proxies on private addresses (Caddy,
  cloudflared), so a player cannot dodge the rate limit with a made-up header.
- Logs only rejected runs and errors (`docker logs spaghettify-api`).

## 0. Before the first deploy (on your PC)

1. **Pick the subdomain.** The default is `spaghettify.swikrut.com`. If you choose another, change
   `ANALYTICS.domains` in `src/config/index.ts`.
2. **Umami.** Sign in at https://cloud.umami.is (the same account as Rex Chase), Settings > Websites >
   Add website, name `Spaghettify`, domain as above. Copy the website id and paste it into
   `ANALYTICS.websiteId` in `src/config/index.ts` (marked `FILL IN`). Commit.
   Analytics only loads in a production build served from that hostname, so local runs send nothing.
3. **Check it locally:**
   ```
   docker compose up -d --build
   ```
   Open http://localhost:8095 (and http://localhost:8095/?perf for the frame time readout).
   Optional: run the whole test suite against the container with
   `$env:BASE_URL='http://localhost:8095'; npm test` (PowerShell) or `BASE_URL=http://localhost:8095 npm test` (bash).

## 1. Get the code onto TrueNAS and build the images

The code goes to a GitHub repo (private is fine) and the NAS clones it and builds the images itself.
Nothing is copied by hand.

**On the PC, once:** create an empty repo on GitHub, then
`git remote add origin https://github.com/<user>/spaghettify.git` and `git push -u origin main`.

**Datasets** (TrueNAS web UI, Datasets > select the pool > Add Dataset, preset Generic): a dataset
`spaghettify`, then a child dataset `leaderboard` inside it. The api runs as the `node` user (uid 1000)
and must be able to write to the leaderboard one. Back it up with your usual snapshot task; it is one
small SQLite file (plus `-wal` and `-shm` files while running).

**Clone and build** (System > Shell, or SSH as admin). Here the pool is `raidmirror` and the datasets are
under `Apps`; use your own path:

```
sudo chown 1000:1000 /mnt/raidmirror/Apps/spaghettify/leaderboard
cd /mnt/raidmirror/Apps/spaghettify
sudo git clone https://github.com/<user>/spaghettify.git repo      # public repo
cd repo
sudo docker compose build
sudo docker image ls | grep spaghettify
```

For a private repo, create a fine-grained GitHub token (Settings > Developer settings > Personal access
tokens > Fine-grained) limited to this repo with Contents read-only, and clone with
`https://<user>:<TOKEN>@github.com/<user>/spaghettify.git`. The first build takes several minutes on the
i3. It leaves `spaghettify:latest` and `spaghettify-api:latest`.

## 2. Create the TrueNAS app

Apps > Discover Apps > the three-dot menu > **Install via YAML**. Name: `spaghettify`. Paste:

```yaml
services:
  spaghettify:
    image: spaghettify:latest
    pull_policy: never
    restart: unless-stopped
    ports:
      - "8095:8080"
    depends_on:
      - api
    read_only: true
    tmpfs:
      - /tmp
      - /config
      - /data
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE

  api:
    image: spaghettify-api:latest
    pull_policy: never
    restart: unless-stopped
    environment:
      DB_PATH: /data/leaderboard.db
    volumes:
      - /mnt/<pool>/apps/spaghettify/leaderboard:/data
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
```

`pull_policy: never` makes it use the images you loaded instead of looking for them on Docker Hub.
The service must be called `api`: Caddy proxies to `api:3000` (or set `API_UPSTREAM` on the
`spaghettify` service to another `host:port`).
If port 8095 is taken on the NAS, change the left number. Check http://<truenas-ip>:8095 from your LAN.

## 3. Cloudflare: point the subdomain at it

Use whichever route your other self-hosted services already use.

**A. Cloudflare Tunnel (recommended, no open ports).** If `cloudflared` already runs on TrueNAS:
Cloudflare dashboard > Zero Trust > Networks > Tunnels > your tunnel > Public hostname > Add.
Subdomain `spaghettify`, domain `swikrut.com`, type `HTTP`, URL `<truenas-ip>:8095`
(or `spaghettify:8080` if cloudflared shares a Docker network with it). The DNS record is created for you.

**B. Reverse proxy on the NAS** (Nginx Proxy Manager, Traefik or similar, with 443 forwarded on the router):
in Cloudflare DNS add a record `spaghettify` pointing at your home IP (A) or your DDNS name (CNAME),
proxied (orange cloud). SSL/TLS mode Full (strict) with a valid origin certificate on the proxy.
The proxy forwards `spaghettify.swikrut.com` to `http://<truenas-ip>:8095`.

Cloudflare settings worth checking for this hostname:

- WebSockets must be on (Network > WebSockets; on by default, and a Tunnel carries them as they are).

- Leave Rocket Loader off (it rewrites script tags and can break the module script).
- No cache rule is needed: Cloudflare caches the `.js` assets and honours the origin `Cache-Control`;
  HTML is not cached by default, which is what we want.
- After a deploy nothing needs purging, because asset names change with their content.

## 4. Check the live site

```
curl -sI https://spaghettify.swikrut.com/ | grep -i cache-control              # no-cache
curl -sI -H "Accept-Encoding: br" https://spaghettify.swikrut.com/assets/<file>.js   # immutable, br
```

```
curl -s https://spaghettify.swikrut.com/api/health                              # {"ok":true}
curl -s https://spaghettify.swikrut.com/api/scores/top                          # {"entries":[...],"total":n}
curl -s https://spaghettify.swikrut.com/api/online                              # {"players":n,"rooms":n,"load":x}
curl -si -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" https://spaghettify.swikrut.com/ws | head -1   # 101 Switching Protocols
```

Open the site: the title says how many players are online (or `SERVER UNREACHABLE: OFFLINE ARENA` when
`/api/online` does not answer). Press Play: the game joins the online arena and the corner line reads
`ONLINE` with the players in the room and the round trip in ms. If it cannot join, a note says why and the
game plays the offline arena with bots (the line reads `OFFLINE ARENA`). Open a second browser (or a phone)
and play at the same time: both land in the same room. Check Umami's Realtime view shows the visit and a
`run-start` event. Set a nickname on the title screen and play a life: the score screen shows your rank and
the board (online the server posts the life itself).
Open `/?perf` on a phone to see the frame time and the quality level it settles on.

**Load.** `load` in `/api/online` is the share of one CPU core the rooms took over the last 5 seconds
(0.05 is 5 percent). With players on, check it now and then, and `docker stats` for the two containers. On
the PC, `npm run load -- sim` measures a room's cost without sockets and `npm run load -- ws` runs headless
clients against a server (`--url ws://localhost:8095/ws` for the Docker stack; each client sends a made-up
`X-Forwarded-For`, which counts because it comes from a private address, so the per-IP limits do not refuse
them).

## Updating

On the PC: commit and `git push`.
On TrueNAS:

```
cd /mnt/<pool>/Apps/spaghettify/repo
sudo git pull
sudo docker compose build
```

Then Apps > spaghettify > Stop, then Start so both containers pick up the new images. The leaderboard survives updates (it lives on the dataset).

**Moderating the board.** There is no admin UI. To remove a nickname (all its runs):

```
sudo docker exec -it spaghettify-api node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/leaderboard.db').prepare('DELETE FROM scores WHERE nickname = ? COLLATE NOCASE').run(process.argv[1])" "<nickname>"
```

The nickname filter lists live in `src/leaderboard/rules.ts`. Old images can be removed
with `sudo docker image prune`.

## Analytics events

Page views are automatic. The `tier` field (and the leaderboard's `tier` column) holds the size milestone reached
since M16; the name stayed for compatibility. Custom events (sent only on the live hostname, see `src/analytics/analytics.ts`):

| Event | When | Fields |
| --- | --- | --- |
| `join` | Play from the title screen picked an arena | `online` (true or false), `why` (`ok`, or for the offline arena: `offline-mode`, `unreachable`, `full`, `version` or the reason a join dropped), `from` |
| `run-start` | Play from the title screen or Play again | `from` (`title` or `restart`), `online` |
| `run-end` | The life ends (evaporated or eaten by another hole) | `band` (score range), `tier` (the size milestone reached, 1 to 9), `seconds`, `eaten`, `holes` (holes swallowed), `newBest`, `cause` (`evaporated` or `eaten`), `online` |
| `net-drop` | The connection to the online arena ended without the player leaving | `why`, `carried` (the life carried on offline) |
| `leaderboard-submit` | The score screen posted a run (only with a nickname set) | `result` (`ok`, `offline`, `nickname`, `implausible`, `invalid` or `rate`), `tier` |
| `share` | The share card was shared (share sheet) or saved (download) from the score screen | `method` (`share` or `download`), `band`, `tier` |

No cookies, no IDs and never the nickname (the nickname only goes to the game's own leaderboard API).

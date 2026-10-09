# Deploying Spaghettify

The game is a static Vite build served by Caddy inside one Docker container. There is no backend yet.
The container listens on port 8080 inside and is published on host port 8095 (change it freely).
TLS is not handled by the container: Cloudflare (Tunnel or proxy) sits in front of it.

What the image does:

- `npm ci`, `npm run build` (typecheck plus Vite build), then `scripts/precompress.mjs` writes `.br` and `.gz` copies.
- Caddy serves `/assets/*` (content-hashed) with `Cache-Control: public, max-age=31536000, immutable`
  and everything else (`index.html`) with `no-cache`, so a new deploy shows up on the next load.
- Brotli or gzip from the precompressed files, on-the-fly gzip or zstd for anything else. Errors are `no-store`.
- Health check: `wget` on `/` every 30 s.

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

## 1. Get the image onto TrueNAS

The repo has no git remote, so the simplest path is to build on the PC and copy the image across.
Both machines are x86-64, so the image runs as is.

```
docker build -t spaghettify:latest .
docker save spaghettify:latest -o spaghettify.tar
```

Copy `spaghettify.tar` to a TrueNAS share (for example `/mnt/<pool>/apps/spaghettify/`), then in
TrueNAS: System > Shell (or SSH as admin):

```
sudo docker load -i /mnt/<pool>/apps/spaghettify/spaghettify.tar
sudo docker image ls spaghettify
```

(Alternative: copy the repo without `node_modules` and `dist` to the dataset and run
`sudo docker build -t spaghettify:latest .` there. Later, if the repo goes to GitHub, a GitHub Actions
workflow can push to ghcr.io and TrueNAS can pull it; that is not set up.)

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
    read_only: true
    tmpfs:
      - /tmp
      - /config
      - /data
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
```

`pull_policy: never` makes it use the image you loaded instead of looking for it on Docker Hub.
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

- Leave Rocket Loader off (it rewrites script tags and can break the module script).
- No cache rule is needed: Cloudflare caches the `.js` assets and honours the origin `Cache-Control`;
  HTML is not cached by default, which is what we want.
- After a deploy nothing needs purging, because asset names change with their content.

## 4. Check the live site

```
curl -sI https://spaghettify.swikrut.com/ | grep -i cache-control              # no-cache
curl -sI -H "Accept-Encoding: br" https://spaghettify.swikrut.com/assets/<file>.js   # immutable, br
```

Open the site, play a run and check Umami's Realtime view shows the visit and a `run-start` event.
Open `/?perf` on a phone to see the frame time and the quality level it settles on.

## Updating

On the PC: commit, `docker build -t spaghettify:latest .`, `docker save spaghettify:latest -o spaghettify.tar`.
On TrueNAS: `sudo docker load -i .../spaghettify.tar`, then Apps > spaghettify > Stop, then Start
(or `sudo docker restart` the container) so it picks up the new image. Old images can be removed
with `sudo docker image prune`.

## Analytics events

Page views are automatic. Custom events (sent only on the live hostname, see `src/analytics/analytics.ts`):

| Event | When | Fields |
| --- | --- | --- |
| `run-start` | Play from the title screen or Play again | `from` (`title` or `restart`) |
| `run-end` | The hole evaporates | `band` (score range), `tier`, `seconds`, `eaten`, `newBest` |

No cookies, no IDs and never the nickname.

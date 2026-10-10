# Two images from one file:
#   web (default, last stage): Caddy serving the Vite build and proxying /api and /ws to the api container
#   api: the game server (leaderboard and the online arena: Fastify + node:sqlite + WebSockets), built with `--target api`

# Build stage: install, typecheck, build and precompress the Vite production build.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && node scripts/precompress.mjs dist

# Game server. Node 24 runs the TypeScript sources directly (type stripping) and has SQLite built in, so
# there is no compile step and no native module. The rules, tunables, simulation and online protocol it
# shares with the game come from src/ (the root package.json is copied for its "type": "module").
FROM node:24-alpine AS api
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/leaderboard.db
WORKDIR /app
COPY package.json ./
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/src server/src
COPY src/config src/config
COPY src/sim src/sim
COPY src/protocol src/protocol
COPY src/leaderboard/rules.ts src/leaderboard/
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
WORKDIR /app/server
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]

# Serve stage: Caddy serving static files and proxying /api and /ws.
FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

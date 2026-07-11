# Builds the browser SPA and bakes it into a Caddy image that serves the static
# bundle and reverse-proxies the API. Web-only build (SIMPLECRM_WEB_ONLY=1) skips
# the Electron bundles and makes the client default to its own origin.
#
# A glibc base (node:22, not alpine) avoids the Rollup musl optional-dependency
# pitfall during `vite build`.
FROM node:24 AS build

WORKDIR /app
# Full context; .dockerignore keeps node_modules/.git/build output out.
COPY . .
RUN npm install -g pnpm@9
RUN pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts
# The bundle is large (Monaco). Raise the V8 heap so the build does not hit the
# ~2 GB default limit on small (e.g. 4 GB) hosts. The host still needs enough
# RAM+swap to back this; see docs/SETUP_SERVER.md.
RUN NODE_OPTIONS=--max-old-space-size=4096 SIMPLECRM_WEB_ONLY=1 npx vite build

FROM caddy:2

COPY --from=build /app/dist /srv/dist
COPY docker/Caddyfile /etc/caddy/Caddyfile

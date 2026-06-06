# Builds the browser SPA and bakes it into a Caddy image that serves the static
# bundle and reverse-proxies the API. Web-only build (SIMPLECRM_WEB_ONLY=1) skips
# the Electron bundles and makes the client default to its own origin.
#
# A glibc base (node:22, not alpine) avoids the Rollup musl optional-dependency
# pitfall during `vite build`.
FROM node:22 AS build

WORKDIR /app
# Full context; .dockerignore keeps node_modules/.git/build output out.
COPY . .
RUN npm ci --legacy-peer-deps --ignore-scripts
RUN SIMPLECRM_WEB_ONLY=1 npx vite build

FROM caddy:2

COPY --from=build /app/dist /srv/dist
COPY docker/Caddyfile /etc/caddy/Caddyfile

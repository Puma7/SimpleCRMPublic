FROM node:24-alpine AS base

WORKDIR /app
ENV PNPM_CONFIG_NODE_LINKER=hoisted \
    PNPM_CONFIG_IGNORE_SCRIPTS=true
RUN npm install -g pnpm@11.13.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.electron.json ./
COPY packages ./packages

FROM base AS build
RUN pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts
RUN pnpm run build:packages

# Install production dependencies into a clean stage. pnpm prune does not
# support recursive workspace pruning and can retain pending downloads here.
# Skip the root postinstall: it prepares Electron, which the API does not use.
FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile --node-linker=hoisted --ignore-scripts

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/desktop/dist ./packages/desktop/dist
# Run as the unprivileged `node` user (uid 1000) of the base image; the code
# stays root-owned and read-only to it. The data directories are created and
# handed to node here, so fresh named volumes mounted on top inherit that owner.
# Volumes written by older root-run images are converted by update.sh.
RUN mkdir -p /app/data/attachments /app/data/audit-archive /app/data/logs \
  && chown -R node:node /app/data
USER node
EXPOSE 3000
# Nutzer-Regex (Workflow-Bedingungen, Relay-Betreffregeln) laeuft auf Text, den
# Mail-Absender bestimmen. Mit diesem V8-Flag wechselt ein Muster, das zu oft
# zurueckspringt, auf die Engine mit linearer Laufzeit, statt den Prozess fuer
# Sekunden bis Stunden zu blockieren (F-A13A14-04). NODE_OPTIONS nimmt dieses
# Flag nicht an, deshalb steht es hier.
CMD ["node", "--enable-experimental-regexp-engine-on-excessive-backtracks", "packages/server/dist/server.js"]

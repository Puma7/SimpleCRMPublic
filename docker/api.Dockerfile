FROM node:24-alpine AS build

WORKDIR /app
ENV PNPM_CONFIG_NODE_LINKER=hoisted \
    PNPM_CONFIG_IGNORE_SCRIPTS=true
RUN npm install -g pnpm@11.12.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.electron.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts
RUN pnpm run build:packages
# CI=true is REQUIRED: in a non-TTY `RUN`, `pnpm prune --prod` needs to recreate
# node_modules and otherwise aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY,
# which would break the API image build in the server-compose-smoke CI job.
# --ignore-scripts is REQUIRED: prune otherwise re-runs the root `postinstall`
# (electron install + better-sqlite3 patch + electron-rebuild), which are
# desktop-only and fail here because electron is a devDependency absent from the
# pruned prod image. The server edition needs none of them. (The pre-pnpm
# Dockerfile pruned with --ignore-scripts for the same reason.)
RUN CI=true pnpm prune --prod --ignore-scripts

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]

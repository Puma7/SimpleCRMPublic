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
EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]

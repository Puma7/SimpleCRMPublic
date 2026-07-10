FROM node:24-alpine AS build

WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.electron.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts
RUN pnpm run build:packages
# CI=true is REQUIRED: in a non-TTY `RUN`, `pnpm prune --prod` needs to recreate
# node_modules and otherwise aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY,
# which would break the API image build in the server-compose-smoke CI job.
RUN CI=true pnpm prune --prod

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]

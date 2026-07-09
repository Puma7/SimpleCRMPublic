FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.electron.json ./
COPY packages ./packages
RUN npm ci --legacy-peer-deps --ignore-scripts
RUN npm run build:packages
RUN npm prune --omit=dev --legacy-peer-deps --ignore-scripts

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]

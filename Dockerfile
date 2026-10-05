# syntax=docker/dockerfile:1
# NOTE: this file could NOT be built or run locally (no Docker on the dev machine). Validate it in CI/your host first.
#
# Migrations are NOT run at container start. Run them as a deploy step, with the production image:
#   docker run --rm --env-file .env <image> yarn migration:run:prod

# ---- deps: every dependency, to compile ----
FROM node:26-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build

# ---- prod-deps: production dependencies only ----
FROM node:26-alpine AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

# ---- runtime ----
FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
RUN corepack enable && mkdir -p /data/uploads && chown -R node:node /data /app
COPY --chown=node:node package.json yarn.lock ./
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
USER node
EXPOSE 4000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "dist/main.js"]

# Unc worker — always-on DRY-RUN scheduler. Sketch for Fly.io (see fly.toml).
# Builds the worker with tsc only (no Next build), runs it under node with the
# health endpoint on :8080 for the Fly check. No secrets are baked in; provider,
# model and internal-source credentials are supplied only through `fly secrets`.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.worker.json ./
COPY src ./src
RUN npx tsc -p tsconfig.worker.json
# The standalone build has no path-alias resolver: every lib file the worker pulls in must
# use relative imports. Fail the image rather than crash at boot with "Cannot find module '@/…'".
RUN ! grep -rl 'require("@/' dist/worker

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ARG UNC_BUILD_SHA
ENV UNC_BUILD_SHA=${UNC_BUILD_SHA}
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist/worker ./dist/worker
# The heartbeat lives on the container's writable layer; the health check reads it.
# Created as root, then handed to `node` — otherwise writeHeartbeatFile EACCES and
# Fly's HTTP check stays 503 even while the loop is ticking.
RUN mkdir -p /app/.unc-worker && chown node:node /app/.unc-worker
USER node
EXPOSE 8080
CMD ["node", "dist/worker/worker/main.js", "--interval", "60", "--heartbeat", "/app/.unc-worker/heartbeat.json", "--health-port", "8080"]

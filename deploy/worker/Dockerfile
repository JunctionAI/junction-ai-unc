# Unc worker — always-on DRY-RUN scheduler. Sketch for Fly.io (see fly.toml).
# Builds the worker with tsc only (no Next build), runs it under node with the
# health endpoint on :8080 for the Fly check. No secrets are baked in; the only
# env var it honours is ANTHROPIC_API_KEY (optional — set with `fly secrets`).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.worker.json ./
COPY src ./src
RUN npx tsc -p tsconfig.worker.json

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist/worker ./dist/worker
# The heartbeat lives on the container's writable layer; the health check reads it.
RUN mkdir -p /app/.unc-worker
USER node
EXPOSE 8080
CMD ["node", "dist/worker/worker/main.js", "--interval", "60", "--heartbeat", "/app/.unc-worker/heartbeat.json", "--health-port", "8080"]

# syntax=docker/dockerfile:1.7

FROM node:22.22.1-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/*/package.json packages/
RUN npm ci --include=dev

COPY . .
ARG PUBLIC_MAPBOX_ACCESS_TOKEN=""
ENV PUBLIC_MAPBOX_ACCESS_TOKEN=$PUBLIC_MAPBOX_ACCESS_TOKEN
RUN npm run build

FROM node:22.22.1-bookworm-slim AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4311 \
    ZINDYCAST_DB_PATH=/app/var/coordination.sqlite \
    ZINDYCAST_JOBS_PATH=/app/var/jobs.sqlite \
    ZINDYCAST_INSTALLATIONS_PATH=/app/var/installations.sqlite \
    ZINDYCAST_NOTIFICATIONS_PATH=/app/var/notifications.sqlite \
    ZINDYCAST_VERIFICATION_PATH=/app/var/verification.sqlite
WORKDIR /app

COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/var && chown node:node /app/var

USER node
EXPOSE 4311
CMD ["npm", "start"]

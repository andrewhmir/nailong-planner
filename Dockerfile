# syntax=docker/dockerfile:1

FROM node:25-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:25-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Bundle the operator CLIs (provision/backup/reset-password) into plain JavaScript
# so the runtime image can run them with `railway ssh` — the standalone bundle
# contains neither the TypeScript sources nor `tsx`.
RUN npm run ops:bundle

FROM node:25-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Taipei

# `gosu` lets the entrypoint fix the volume's ownership as root and then drop to
# the unprivileged app user. HOSTNAME must stay 0.0.0.0: the standalone server
# binds `process.env.HOSTNAME` verbatim, and Docker sets that to the container id.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app \
  && useradd --system --gid app app

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/ops ./ops
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data && chown -R app:app /app /data

# The entrypoint re-chowns the mounted volume at start (Railway mounts volumes
# root-owned) and then execs the command as `app`.
USER root
ENTRYPOINT ["docker-entrypoint.sh"]

EXPOSE 3000
CMD ["node", "server.js"]

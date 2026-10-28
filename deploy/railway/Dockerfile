# Railway build of the same image as /Dockerfile (ADR 0024's Contabo image is built by
# .github/workflows/image.yml). Differences: no BuildKit cache mount (Railway requires a
# service-specific cache id, and four services build this file), and the release id comes from
# Railway's commit sha. NEXT_PUBLIC_APP_ORIGIN and the other ARGs come from service variables.
# Keep in step with /Dockerfile.
# syntax=docker/dockerfile:1.7
# One image for every Yayatoh process on the production server (ADR 0024): web, admin, worker and
# the one-off migrate/bootstrap tasks run from the same build with different commands
# (deploy/docker-compose.prod.yml). No secret is baked in: everything comes from Doppler at runtime.
# Built by .github/workflows/image.yml; `NEXT_PUBLIC_*` and the front-door names are read by
# `next build`, so they are build arguments.

FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json ./
# The pnpm version pinned in package.json (`packageManager`), as CI's pnpm/action-setup uses.
RUN npm install -g "$(node -p "require('./package.json').packageManager")"

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
ARG NEXT_PUBLIC_APP_ORIGIN=https://app.yayatoh.com
ARG HSTS=1
ARG SERVER_ACTIONS_ALLOWED_ORIGINS=
ARG LEGACY_ORIGIN_URL=
ARG LEGACY_ABC_ORIGIN_URL=
ARG LEGACY_YAY_HOSTS=
ARG LEGACY_ABC_HOSTS=
ARG FRONT_DOOR_MAX_BODY=
ENV NEXT_PUBLIC_APP_ORIGIN=$NEXT_PUBLIC_APP_ORIGIN \
    HSTS=$HSTS \
    SERVER_ACTIONS_ALLOWED_ORIGINS=$SERVER_ACTIONS_ALLOWED_ORIGINS \
    LEGACY_ORIGIN_URL=$LEGACY_ORIGIN_URL \
    LEGACY_ABC_ORIGIN_URL=$LEGACY_ABC_ORIGIN_URL \
    LEGACY_YAY_HOSTS=$LEGACY_YAY_HOSTS \
    LEGACY_ABC_HOSTS=$LEGACY_ABC_HOSTS \
    FRONT_DOOR_MAX_BODY=$FRONT_DOOR_MAX_BODY
# One app at a time: two 8 GB builds at once exhaust a 16 GB runner (as the CI typecheck).
# Types are checked by `pnpm typecheck` in CI, so the image build skips Next's own type-check pass (it ran out of heap).
RUN NEXT_SKIP_TYPECHECK=1 NODE_OPTIONS=--max-old-space-size=8192 pnpm turbo run build --concurrency=1 --filter=@yayatoh/web --filter=@yayatoh/admin

FROM base AS runtime
ENV NODE_ENV=production
ARG RAILWAY_GIT_COMMIT_SHA=unknown
ENV YAYATOH_RELEASE=$RAILWAY_GIT_COMMIT_SHA
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000 3001
# The compose file sets each service's command; this default serves the web app.
WORKDIR /app/apps/web
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000", "--keepAliveTimeout", "75000"]

# Frontend: build the Vite app, then serve it (and reverse-proxy the API)
# with Caddy, which provisions and renews HTTPS automatically.

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# patches/ must be present before install: postinstall runs patch-package
# to re-apply the committed @smogon/calc patch (no git/network needed).
COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci

COPY . .

# Baked into the bundle at build time. Set via docker-compose build arg.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

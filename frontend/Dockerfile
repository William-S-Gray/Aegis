# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- builder
FROM node:22-alpine AS builder

WORKDIR /build

# Copy manifests first so dependency installation is cached independently of
# source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------- runtime
# The unprivileged variant: nginx runs as uid 101, listens on 8080, and keeps
# its pid and temp files in /tmp. The stock image starts its master as root.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

USER root
RUN apk add --no-cache curl \
    && mkdir -p /etc/nginx/aegis
USER 101

# Owned by nginx so the entrypoint can write config.js at start.
COPY --from=builder --chown=101:101 /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/aegis/security-headers.conf
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.d/40-aegis-config.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:8080/healthz || exit 1

# nginx's own entrypoint runs /docker-entrypoint.d/* before starting, which is
# where config.js and the CSP are generated from the environment.

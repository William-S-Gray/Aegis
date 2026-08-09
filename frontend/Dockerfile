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
FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache curl

COPY --from=builder /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-aegis-config.sh
RUN chmod +x /docker-entrypoint.d/40-aegis-config.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:8080/healthz || exit 1

# nginx's own entrypoint runs /docker-entrypoint.d/* before starting, which is
# where config.js is generated from the environment.

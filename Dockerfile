# syntax=docker/dockerfile:1.7
# Frontpage — production image
# Multi-stage build using Next.js standalone output.

ARG NODE_VERSION=22

# ---------- 1. Dependencies ----------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN set -eux; \
    npm ci --include=optional; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64|x64) \
        npm install --no-save --no-package-lock \
          lightningcss-linux-x64-gnu@1.32.0 \
          @tailwindcss/oxide-linux-x64-gnu@4.3.2 \
          @rolldown/binding-linux-x64-gnu@1.1.5 \
          @unrs/resolver-binding-linux-x64-gnu@1.11.1 \
          @img/sharp-linux-x64@0.34.5 \
          @img/sharp-libvips-linux-x64@1.2.4 \
        ;; \
      arm64|aarch64) \
        npm install --no-save --no-package-lock \
          lightningcss-linux-arm64-gnu@1.32.0 \
          @tailwindcss/oxide-linux-arm64-gnu@4.3.2 \
          @rolldown/binding-linux-arm64-gnu@1.1.5 \
          @unrs/resolver-binding-linux-arm64-gnu@1.11.1 \
          @img/sharp-linux-arm64@0.34.5 \
          @img/sharp-libvips-linux-arm64@1.2.4 \
        ;; \
      *) \
        echo "Unsupported Docker target architecture: ${TARGETARCH:-$(dpkg --print-architecture)}"; \
        exit 1 \
        ;; \
    esac

# ---------- 2. Build ----------
FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app

ARG VERSION=latest
ENV VERSION=${VERSION} \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ---------- 3. Runtime ----------
FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data

RUN mkdir -p /app/.next /data && chown -R node:node /app /data

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]

# syntax=docker/dockerfile:1.7
# Frontpage — production image
# Multi-stage build using Next.js standalone output.

ARG NODE_VERSION=22

# ---------- 1. Dependencies ----------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=optional \
 && npm install --no-save --no-package-lock \
      lightningcss-linux-x64-gnu \
      @tailwindcss/oxide-linux-x64-gnu \
      @rolldown/binding-linux-x64-gnu \
      @unrs/resolver-binding-linux-x64-gnu \
      @img/sharp-linux-x64 \
      @img/sharp-libvips-linux-x64

# ---------- 2. Build ----------
FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app

ARG VERSION=latest
ENV VERSION=${VERSION} \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Clear cached runtime data so build uses the bundled source
RUN rm -f public/data/projects.json public/data/personal.json 2>/dev/null; true

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

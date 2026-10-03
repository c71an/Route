# ==============================================================================
# Stage 1: Fetch Upstream RSSHub
# ==============================================================================
FROM alpine/git:latest AS upstream
ARG RSSHUB_REPO=https://github.com/DIYgod/RSSHub.git
ARG RSSHUB_REF=master

WORKDIR /source
RUN git clone --depth=1 --branch ${RSSHUB_REF} ${RSSHUB_REPO} /rsshub && \
    rm -rf /rsshub/.git

# ==============================================================================
# Stage 2: Build & Prune RSSHub with Custom Routes
# ==============================================================================
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable pnpm

# 1. Copy upstream RSSHub base
COPY --from=upstream /rsshub /app

# 2. Remove all 1000+ upstream route subdirectories, keeping upstream root files (healthz.ts, index.tsx, etc.)
# Then copy custom routes
RUN find /app/lib/routes -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
COPY ./routes/ /app/lib/routes/

# 3. Clean unused upstream docs, test files, and assets
RUN rm -rf /app/docs /app/test /app/tests /app/spec /app/specs /app/.github /app/assets/build

# 4. Prune unused heavy dependencies from package.json before install
COPY ./scripts/prune-deps.mjs /app/scripts/prune-deps.mjs
RUN node /app/scripts/prune-deps.mjs /app

# 5. Install dependencies (skipping Chromium/browser binaries)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV USE_CHINA_NPM_REGISTRY=0

RUN pnpm install --no-frozen-lockfile

# 6. Build RSSHub (build:routes + tsdown compilation)
RUN pnpm build

# 7. Minify node_modules: trace reachable dependencies from dist/index.mjs
COPY ./scripts/minify.mjs /app/scripts/minify.mjs
RUN node /app/scripts/minify.mjs /app

# ==============================================================================
# Stage 3: Minimal Production Runtime
# ==============================================================================
FROM node:24-bookworm-slim AS runner

LABEL maintainer="c71an"
LABEL description="Minimalist custom RSSHub Docker Image (linux/amd64, linux/arm64)"

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=1200 \
    CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install dumb-init, curl, Chromium (for weibo route), and Chinese font
RUN apt-get update && \
    apt-get install -yq --no-install-recommends \
        dumb-init \
        curl \
        chromium \
        fonts-wqy-zenhei \
    && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /usr/share/doc /usr/share/man

# Copy minimal runtime files only
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/lib/assets /app/lib/assets
COPY --from=builder /app/app-minimal/node_modules /app/node_modules

EXPOSE 1200

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:1200/healthz || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--max-http-header-size=32768", "dist/index.mjs"]

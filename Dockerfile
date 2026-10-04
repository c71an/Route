# ==============================================================================
# Stage 1: Fetch Upstream RSSHub
# ==============================================================================
FROM alpine/git:latest AS upstream
ARG RSSHUB_REPO=https://github.com/DIYgod/RSSHub.git
ARG RSSHUB_REF=master

WORKDIR /source
RUN git clone --depth=1 --branch ${RSSHUB_REF} ${RSSHUB_REPO} /rsshub

# ==============================================================================
# Stage 2: Build & Prune RSSHub with Custom Routes
# ==============================================================================
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Enable pnpm via corepack & install git, python3, make, g++ for node-gyp native module support
RUN corepack enable pnpm && \
    apt-get update && \
    apt-get install -yq --no-install-recommends git python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 1. Copy upstream RSSHub base
COPY --from=upstream /rsshub /app

# 2. Remove all 1000+ upstream route subdirectories, keeping upstream root files (healthz.ts, index.tsx, etc.)
# Then copy custom routes
RUN find /app/lib/routes -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
COPY ./routes/ /app/lib/routes/

# Compatibility shims in case routes import @/utils/puppeteer or @/utils/puppeteer-utils
RUN echo "export { getPlaywrightPage as getPuppeteerPage } from './playwright';" > /app/lib/utils/puppeteer.ts && \
    echo "export { constructCookieArray, getCookies, parseCookieArray, setCookies } from './playwright-utils';" > /app/lib/utils/puppeteer-utils.ts

# 3. Install all dependencies (skipping browser binary downloads as system chromium is used)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV USE_CHINA_NPM_REGISTRY=0

RUN pnpm install --frozen-lockfile

# 4. Build RSSHub (build:routes + tsdown compilation)
RUN pnpm build

# 5. Prune devDependencies to keep standard production dependencies
RUN pnpm prune --prod

# ==============================================================================
# Stage 3: Minimal Production Runtime
# ==============================================================================
FROM node:24-bookworm-slim AS runner

LABEL maintainer="c71an"
LABEL description="Custom RSSHub Docker Image (linux/amd64, linux/arm64)"

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

# Copy built application and production node_modules
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/lib/assets /app/lib/assets
COPY --from=builder /app/node_modules /app/node_modules

EXPOSE 1200

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:1200/healthz || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--max-http-header-size=32768", "dist/index.mjs"]


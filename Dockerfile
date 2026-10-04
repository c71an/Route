# ==============================================================================
# 阶段 1: upstream
# 克隆上游 RSSHub master 分支核心代码
# ==============================================================================
FROM alpine/git:latest AS upstream
ARG RSSHUB_REPO=https://github.com/DIYgod/RSSHub.git
ARG RSSHUB_REF=master

WORKDIR /source
RUN git clone --depth=1 --branch ${RSSHUB_REF} ${RSSHUB_REPO} /rsshub

# ==============================================================================
# 阶段 2: builder
# 1. 清空上游 lib/routes/* 下所有子目录
# 2. 注入本项目 routes/ 中的自定义路由
# 3. 安装依赖并编译构建
# ==============================================================================
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# 启用 pnpm 并安装原生编译所需的基础依赖
RUN corepack enable pnpm && \
    apt-get update && \
    apt-get install -yq --no-install-recommends git python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 复制上游核心代码
COPY --from=upstream /rsshub /app

# 1. 清空上游 lib/routes/* 下所有子目录（保留根级通用文件如 healthz.ts, index.tsx 等）
RUN find /app/lib/routes -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +

# 2. 注入本项目 routes/ 中的自定义路由
COPY ./routes/ /app/lib/routes/

# 环境变量：彻底跳过 Playwright 内置浏览器二进制下载
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV USE_CHINA_NPM_REGISTRY=0

# 安装依赖
RUN pnpm install --frozen-lockfile

# 执行 RSSHub 编译流程 (构建路由注册表及 TypeScript 编译)
RUN pnpm build

# 裁剪开发依赖，只保留生产运行必需依赖
RUN pnpm prune --prod

# ==============================================================================
# 阶段 3: runner (超轻量生产环境，舍弃 Chromium、X11 及图形字体)
# ==============================================================================
FROM node:24-bookworm-slim AS runner

LABEL maintainer="c71an"
LABEL description="Minimal Custom RSSHub Docker Image (linux/amd64, linux/arm64)"

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=1200

WORKDIR /app

# 仅安装进程守护 (dumb-init) 与健康检查必备工具 (curl)，无需任何 Chromium/X11/GUI 依赖
RUN apt-get update && \
    apt-get install -yq --no-install-recommends \
        dumb-init \
        curl \
    && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /usr/share/doc /usr/share/man

# 从 builder 阶段提取构建成果与生产依赖
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/lib/assets /app/lib/assets
COPY --from=builder /app/node_modules /app/node_modules

EXPOSE 1200

# 容器健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:1200/healthz || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--max-http-header-size=32768", "dist/index.mjs"]

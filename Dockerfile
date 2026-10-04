# ==============================================================================
# 阶段 1: upstream
# 克隆上游 RSSHub master 分支核心代码并记录 Commit 信息
# ==============================================================================
FROM alpine/git:latest AS upstream
ARG RSSHUB_REPO=https://github.com/DIYgod/RSSHub.git
ARG RSSHUB_REF=master

WORKDIR /source
RUN git clone --depth=1 --branch ${RSSHUB_REF} ${RSSHUB_REPO} /rsshub && \
    cd /rsshub && \
    git rev-parse HEAD > /rsshub/GIT_COMMIT_SHA && \
    git log -1 --format=%cd > /rsshub/GIT_COMMIT_DATE

# ==============================================================================
# 阶段 2: builder
# 1. 清空上游 lib/routes/* 下所有子目录
# 2. 注入本项目 routes/ 中的自定义路由
# 3. 移除 playwright 相关重型依赖
# 4. 安装依赖并编译构建，清洗 node_modules
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

# 1. 消除运行期 "git: not found"：直接将构建时的 SHA 和日期固化到 lib/utils/git-hash.ts
RUN SHA=$(cat /app/GIT_COMMIT_SHA | cut -c1-8) && \
    DATE=$(cat /app/GIT_COMMIT_DATE) && \
    echo "export const gitHash = '${SHA}';" > /app/lib/utils/git-hash.ts && \
    echo "export const gitDate = new Date('${DATE}');" >> /app/lib/utils/git-hash.ts

# 2. 清空上游 lib/routes/* 下所有子目录（保留根级通用文件如 healthz.ts, index.tsx 等）
RUN find /app/lib/routes -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +

# 3. 注入本项目 routes/ 中的自定义路由
COPY ./routes/ /app/lib/routes/

# 环境变量：彻底跳过 Playwright 内置浏览器二进制下载
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV USE_CHINA_NPM_REGISTRY=0

# 4. 彻底移除未使用的 playwright / puppeteer 依赖包，大幅缩减依赖体积
RUN pnpm remove playwright puppeteer @playwright/test --ignore-scripts || true

# 安装依赖
RUN pnpm install --frozen-lockfile=false

# 执行 RSSHub 编译流程 (构建路由注册表及 TypeScript 编译)
RUN pnpm build

# 裁剪开发依赖，只保留生产运行必需依赖
RUN pnpm prune --prod

# 5. 清理 node_modules 中的文档、类型定义、源码映射等非运行期垃圾文件
RUN find /app/node_modules -type f \( -name "*.d.ts" -o -name "*.map" -o -name "*.md" -o -name "*.markdown" \) -delete && \
    find /app/node_modules -type d \( -name "test" -o -name "tests" -o -name "example" -o -name "examples" -o -name "docs" \) -exec rm -rf {} + || true

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

# 从 builder 阶段提取构建成果与精简后的生产依赖
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/lib/assets /app/lib/assets
COPY --from=builder /app/node_modules /app/node_modules

EXPOSE 1200

# 容器健康检查：将探测间隔设为 60s，减少控制台日志输出频度
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:1200/healthz || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--max-http-header-size=32768", "dist/index.mjs"]

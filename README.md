# Minimal Custom RSSHub (Router)

本项目用于**根据自定义路由集合按需拉取并编译上游 RSSHub**。通过剔除上游 1000+ 无关路由及其数十个重型依赖（包括 Chromium/Playwright、各大海外平台 SDK 等），利用 GitHub Actions 云端全自动编译，打造**极致精简、开箱即用**的双架构 Docker 镜像。

---

## 🎯 目标系统与架构支持

本项目专注于以下两类运行环境，仅编译并保留这两个架构：
1. **S905D（电视盒子 / 斐讯 N1 / 外贸盒子等）Debian / Armbian 系统**：`linux/arm64` (aarch64)
2. **Windows 系统（Docker Desktop / WSL2）**：`linux/amd64` (x86_64)

镜像发布为多架构 Manifest，在对应设备上执行 `docker pull` 或 `docker run` 会自动拉取匹配架构的轻量镜像。

---

## 💡 为什么需要本项目？

官方 RSSHub 为了支持数以千计的网站，镜像包含了海量依赖：
- 官方镜像默认或 Chromium 捆绑版体积高达 **1.5 GB ~ 3 GB+**。
- 包含大量与你的路由无关的重型依赖（如 `@googleapis/youtube`、`youtubei.js`、`twitter-api-v2`、`patchright/playwright` 及其完整的 Chromium 浏览器和数十个 Linux X11/GTK 共享库）。
- 对于仅使用少量特定路由的用户，官方镜像存在巨大的资源浪费与拉取耗时。

### 本项目的瘦身优化机制：
1. **精准路由替换**：拉取上游 RSSHub 核心框架后，清空上游无关子目录，自动保留上游根级必要服务文件（`healthz.ts`、`index.tsx` 等），仅注入你自定义的 `routes` 业务目录。
2. **保留必要组件并剔除其余重型无用依赖**：为支持微博路由（自动获取访客 Cookies），**完整保留 Patchright/Puppeteer 核心能力**；同时剔除无关的上游重型依赖（YouTube, Twitter, Telegram, Notion, Imapflow 等）。
3. **极简系统级 Chromium 与中文字体**：摒弃官方体积庞大且在 ARM64 存在兼容问题的 Chromium 打包，改由运行阶段采用 Debian 原生包（`chromium --no-install-recommends` + `fonts-wqy-zenhei` 文泉驿中文字体），既满足微博爬虫对真实浏览器渲染与中文字体渲染的需求，又在 S905D（ARM64）和 Windows（AMD64）上保持极致精简，免除数百兆桌面 GUI 赘余库。
4. **静态依赖追踪 (NFT Minification)**：利用 `@vercel/nft` (Node File Trace) 深度分析编译产物 `dist/index.mjs`，仅将实际被引用的 `node_modules` 运行时文件打包入镜像。
5. **去除冗余元数据**：自动清理生产依赖中的 TypeScript 定义（`.d.ts`）、Source Map（`.map`）、文档、单元测试等。
6. **最终效果**：在**完整保留 Chromium 无头浏览器与微博爬取能力**的前提下，镜像大小仍比官方 2GB~3GB 镜像减少 **80% 以上**，兼顾轻量与功能完整性！

---

## 📁 目录结构

```text
├── .github/
│   └── workflows/
│       └── docker-build.yml     # GitHub Actions 云端多架构自动编译工作流
├── routes/                      # 纯自定义路由目录（无需保留上游文件）
│   ├── 7kid/                    # 7kid 路由
│   ├── chinacdc/                # 中国疾控中心急性呼吸道传染病监测
│   ├── gov/                     # 政府最新政策
│   ├── komatsu/                 # 小松挖掘机开工率统计
│   ├── pcb/                     # 生机健康
│   ├── ssm/                     # SSM 统计
│   ├── stats/                   # 国家统计局数据发布
│   ├── weibo/                   # 微博相关路由
│   └── zaixs/                   # 在线社区板块精华帖
├── scripts/
│   ├── prune-deps.mjs           # 预清理无用重型依赖脚本
│   └── minify.mjs               # 基于 @vercel/nft 的依赖深度瘦身脚本
├── .dockerignore
├── Dockerfile                   # 多阶段轻量化编译构建文件 (amd64 / arm64)
└── docker-compose.yml           # 一键部署配置（含 Redis 缓存）
```

---

## 🚀 GitHub Actions 自动云端编译

本项目已配置完善的 GitHub Actions 工作流（[`.github/workflows/docker-build.yml`](.github/workflows/docker-build.yml)）：

### 触发方式
- **代码提交自动构建**：每次向 `main` / `master` 分支推送代码（或更新 `routes/` 内容）时自动触发构建。
- **每周定时自动同步**：每周一凌晨 03:00 UTC 自动拉取上游 RSSHub master 分支最新代码重新编译，自动获取上游核心安全修复与框架更新。
- **手动调度 (workflow_dispatch)**：可在 GitHub 仓库的 Actions 页面手动点击 **Run workflow**，支持指定上游分支或 Tag。

### 镜像发布
构建完成后会自动发布到 GitHub Container Registry (GHCR)：
```bash
# 镜像地址格式（替换为你的 GitHub 用户名/仓库名）
ghcr.io/<your-github-username>/router:latest
```

> **提示**：如果想同步推送到 Docker Hub，只需在 GitHub 仓库的 **Settings -> Secrets and variables -> Actions** 中配置 `DOCKERHUB_USERNAME` 与 `DOCKERHUB_TOKEN` 即可。

---

## 🛠️ 部署与使用

### 方式 1：使用 Docker Compose（推荐）

1. 克隆本仓库或直接下载 [`docker-compose.yml`](docker-compose.yml)：
   ```bash
   git clone https://github.com/c71an/Router.git
   cd Router
   ```

2. 启动服务：
   ```bash
   docker compose up -d
   ```

3. 访问服务：
   - 首页：`http://localhost:1200/`
   - 健康检查：`http://localhost:1200/healthz`
   - 示例路由：`http://localhost:1200/chinacdc/week`

---

### 方式 2：使用 Docker 直接运行

无论是在 **Windows** 还是 **S905D Debian**，执行同一条命令即可：

```bash
docker run -d \
  --name rsshub-custom \
  --restart unless-stopped \
  -p 1200:1200 \
  -e NODE_ENV=production \
  -e TZ=Asia/Shanghai \
  ghcr.io/c71an/router:latest
```

---

## ⚙️ 常用环境变量

可在 `docker-compose.yml` 或 `docker run -e` 中配置：

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `PORT` | 服务监听端口（默认 1200） | `1200` |
| `CACHE_TYPE` | 缓存驱动（支持 `memory` 或 `redis`） | `redis` |
| `REDIS_URL` | Redis 连接串 | `redis://redis:6379/` |
| `CACHE_EXPIRE` | 路由缓存时间（秒） | `600` |
| `WEIBO_COOKIES` | 微博 Cookie（用于微博路由稳定抓取） | `SUB=xxx; ...` |

---

## ➕ 如何新增自定义路由

1. 在 `routes/` 目录下创建新文件夹或文件（例如 `routes/myfeed/index.ts`）。
2. 按照 RSSHub v2 规范编写路由元数据和 handler 函数。
3. 提交并推送到 GitHub：
   ```bash
   git add routes/
   git commit -m "feat: add myfeed route"
   git push origin main
   ```
4. GitHub Actions 将自动触发云端双架构编译并更新最新镜像！

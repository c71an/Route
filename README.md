# Custom RSSHub (Route)

本项目用于**根据自定义路由集合构建私有 RSSHub 镜像**。采用**纯路由替换精简策略**：仅保留自身维护的业务路由与上游核心框架，抛弃上游自带的 1000+ 无关路由，同时保持官方完整的生产依赖和运行库生态，通过 GitHub Actions 全自动多架构构建，兼顾轻量与高稳定性。

---

## 🎯 目标系统与架构支持

本项目专注于以下两类生产环境，仅保留并编译这两个架构：
1. **S905D（电视盒子 / 斐讯 N1 / 外贸盒子等）Debian / Armbian 系统**：`linux/arm64` (aarch64)
2. **Windows 系统（Docker Desktop / WSL2）**：`linux/amd64` (x86_64)

构建产物发布为多架构 Manifest，在对应设备上执行 `docker pull` 或 `docker run` 会自动拉取适配目标架构的镜像。

---

## 💡 构建策略与优势

### 纯路由精简策略（Route-Only Pruning）
官方 RSSHub 内置了数千个站点的路由规则。大部分私有部署用户仅使用特定站点，若保留全部路由，不仅每次构建耗时极长，还容易受无关路由文件变动的影响。

本项目采用**纯路由精简策略**：
1. **只保留自定义路由**：拉取上游最新 RSSHub 核心后，清空上游路由子目录，自动保留框架基础路由（`healthz.ts`、`index.tsx` 等），只将本仓库 `routes/` 注入为唯一的业务路由。
2. **依赖原生完整性**：**不再对 `package.json` 或 `node_modules` 进行黑盒裁剪或静态追踪精简**，完全保留上游官方声明的生产依赖（`pnpm prune --prod`），彻底杜绝因依赖被误删引起的运行时缺失报错（如 `browsers.json`、`hono-api-reference`、原生 C++ 扩展等）。
3. **内置系统级 Chromium 与中文字体**：针对需要无头浏览器抓取的路由（如微博 `user.ts` 自动获取访客 Cookies），最终运行镜像采用 Debian 原生 `chromium`（`--no-install-recommends`）与 `fonts-wqy-zenhei` 文泉驿中文字体，并在两个架构上预配 `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`，开箱即用。

---

## 📁 目录结构

```text
├── .github/
│   └── workflows/
│       └── docker-build.yml     # GitHub Actions 云端双架构自动构建工作流
├── routes/                      # 自定义路由目录（按需增减）
│   ├── 7kid/                    # 7kid 路由
│   ├── chinacdc/                # 中国疾控中心
│   ├── gov/                     # 政府最新政策
│   ├── komatsu/                 # 小松挖掘机开工率
│   ├── pcb/                     # 生机健康
│   ├── ssm/                     # SSM 统计
│   ├── stats/                   # 国家统计局数据发布
│   ├── weibo/                   # 微博路由（支持 Chromium 访客 Cookies）
│   └── zaixs/                   # 在线社区
├── Dockerfile                   # 专注于路由替换与多架构适配的构建文件
├── docker-compose.yml           # 一键运行配置（集成 Redis 缓存）
└── README.md
```

---

## 🚀 GitHub Actions 云端自动构建

本项目已配置自动化工作流（[`.github/workflows/docker-build.yml`](.github/workflows/docker-build.yml)）：

### 触发机制
- **推送代码自动构建**：修改 `routes/**` 或 `Dockerfile` 并推送到 `main` / `master` 分支时自动触发。
- **每周定时自动同步**：每周一凌晨 03:00 UTC 自动拉取上游 RSSHub 最新 master 分支重新编译，自动获取上游核心安全修复与功能更新。
- **手动调度**：可在 GitHub Actions 页面随时手动触发（支持指定上游分支或 commit）。

### 镜像地址
构建产物发布至 GitHub Container Registry (GHCR)：
```bash
ghcr.io/<your-github-username>/route:latest
```

---

## 🛠️ 部署与使用

### 方式 1：Docker Compose（推荐）

1. 启动服务：
   ```bash
   docker compose up -d
   ```

2. 检查与验证：
   - 首页：`http://localhost:1200/`
   - 健康检查：`http://localhost:1200/healthz`
   - 微博路由测试：`http://localhost:1200/weibo/user/1195230310`

---

### 方式 2：Docker CLI 直接运行

```bash
docker run -d \
  --name rsshub-custom \
  --restart unless-stopped \
  -p 1200:1200 \
  -e NODE_ENV=production \
  -e TZ=Asia/Shanghai \
  ghcr.io/c71an/route:latest
```

---

## ⚙️ 常用环境变量

可在 `docker-compose.yml` 或 `docker run -e` 中配置：

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `1200` | 服务监听端口 |
| `CACHE_TYPE` | `memory` | 缓存驱动（建议在 Docker Compose 中配置为 `redis`） |
| `REDIS_URL` | - | Redis 连接串，如 `redis://redis:6379/` |
| `CACHE_EXPIRE` | `300` | 路由缓存时间（秒） |
| `CHROMIUM_EXECUTABLE_PATH` | `/usr/bin/chromium` | 无头浏览器执行路径（镜像已内置） |
| `WEIBO_COOKIES` | - | 微博可选 Cookie，用于提高微博路由的抓取稳定性 |

---

## ➕ 如何新增自定义路由

1. 在 `routes/` 下创建对应的路由目录与 TypeScript 文件（例如 `routes/myfeed/index.ts`）。
2. 按照 RSSHub 规范编写路由定义与 handler 处理逻辑。
3. 提交并推送到 GitHub：
   ```bash
   git add routes/
   git commit -m "feat: add myfeed route"
   git push origin main
   ```
4. GitHub Actions 会自动完成云端多架构编译并发布最新镜像。

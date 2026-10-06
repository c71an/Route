# Custom RSSHub (Route)

本项目用于**根据自定义路由集合构建私有 RSSHub 镜像**。采用三阶段多阶段构建与纯路由替换精简策略：拉取上游核心代码，清空上游无关路由子目录并注入私有自定义路由，支持 `linux/amd64` 与 `linux/arm64` 双架构自动编译发布。

---

## 🏗️ 镜像构建阶段流程

```text
[阶段 1: upstream]
      ↓ 克隆上游 RSSHub master 分支核心代码
[阶段 2: builder]
      ↓ 1. 清空上游 lib/routes/* 下所有子目录（保留根级通用文件）
      ↓ 2. 注入本项目 routes/ 中的自定义路由
      ↓ 3. 安装依赖并执行 pnpm build，裁剪开发依赖
[阶段 3: runner]
      ↓ 基于 Debian 极简运行时，彻底舍弃 Chromium/X11/字体，编译发布 linux/amd64 和 linux/arm64 镜像
```

---

## 📁 目录结构

```text
├── .github/
│   └── workflows/
│       └── docker-build.yml     # GitHub Actions 多架构 (amd64 / arm64) 构建工作流
├── routes/                      # 自定义路由目录（按需增减）
│   ├── ...                      # 路由文件夹
├── Dockerfile                   # 极简三阶段多架构构建文件（无 GUI/无浏览器依赖）
├── .dockerignore                # 构建上下文忽略配置
└── README.md
```

---

## 🚀 GitHub Actions 自动构建

项目内置了自动化多架构构建工作流（[`.github/workflows/docker-build.yml`](.github/workflows/docker-build.yml)）：

- **触发条件**：
  - 代码推送：修改 `routes/**` 或 `Dockerfile` 并推送到 `main` / `master` 分支。
  - 手动调度：支持在 Actions 控制台通过 `workflow_dispatch` 手动触发并指定构建参数。
- **目标架构**：
  - `linux/amd64`（PC / 服务器 / WSL2）
  - `linux/arm64`（ARM 电视盒子如 S905D / 树莓派 / 苹果 M 系列服务器）
- **发布目标**：发布到 GitHub Container Registry (GHCR) 及 Docker Hub（可选）。

---

## 🛠️ 快速启动

### 运行容器

```bash
docker run -d \
  --name rsshub-custom \
  --restart unless-stopped \
  -p 1200:1200 \
  -e NODE_ENV=production \
  -e TZ=Asia/Shanghai \
  ghcr.io/<your-github-username>/route:latest
```

### 验证服务

- 首页状态：`http://localhost:1200/`
- 健康检查：`http://localhost:1200/healthz`
- 路由测试：`http://localhost:1200/weibo/user/1195230310`

---

## ➕ 新增自定义路由

1. 在 `routes/` 下新建对应路由文件夹和 `.ts` 文件（如 `routes/demo/index.ts`）。
2. 按照 RSSHub 路由规范编写配置与逻辑。
3. 提交推送至 GitHub，Actions 将自动进行双架构编译并发布最新镜像：
   ```bash
   git add routes/
   git commit -m "feat: add demo route"
   git push origin main
   ```

---

## 🖼️ 微博图片防盗链内置反代 (形态 2)

本项目内置了专用的图片反代路由 (`/proxy`)，可自动为新浪/微博图片附带合法 `Referer: https://weibo.com/`，并提供 30 天强缓存。

### 启用方法 (docker-compose.yml)

只需在 RSSHub 环境变量中添加如下两行：

```yaml
environment:
  # 使用本实例内置的 /proxy 路由代理图片，${href_ue} 会自动进行 URL 编码
  HOTLINK_TEMPLATE: '/proxy?url=${href_ue}'
  # 关键：严格限制仅对微博路由应用代理，绝不影响其他路由 (如 /7kid, /chinacdc 等)
  HOTLINK_INCLUDE_PATHS: '/weibo'
```

- **精准范围**：仅 `/weibo/*` 路由下的图片链接会被重写为 `/proxy?url=...`，其他任何路由不受影响。
- **视频保护**：构建阶段已对防盗链中间件打补丁，视频直接输出 CDN 原链，不会被代理截断。
- **安全防刷**：内置白名单机制，仅允许代理 `*.sinaimg.cn`、`*.weibo.cn`、`*.weibocdn.com` 域名，防止被滥用为公开代理。


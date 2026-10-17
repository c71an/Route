# Custom RSSHub (Route)

轻量级私有定制版 RSSHub 镜像。基于上游最新核心，剔除全部无关冗余路由与重型浏览器（Chromium/Playwright）依赖，仅注入本项目自定义路由，并通过 `@vercel/nft` 深度摇树压缩。

- ⚡ **极致轻量**：镜像体积压缩至 ~90MB，内存占用极低。
- 🌍 **架构支持**：GitHub Actions 自动构建并发布 `linux/arm64`。

---

## 🚀 快速启动

### 基础部署 (Docker CLI)

```bash
docker run -d \
  --name rsshub \
  --restart unless-stopped \
  -p 1200:1200 \
  -e NODE_ENV=production \
  -e TZ=Asia/Shanghai \
  -e CACHE_EXPIRE=600 \
  -e DEBUG_INFO=false \
  ghcr.io/c71an/route:latest
```

### Docker Compose

```yaml
services:
  rsshub:
    image: ghcr.io/c71an/route:latest
    container_name: rsshub
    restart: unless-stopped
    ports:
      - "1200:1200"
    environment:
      NODE_ENV: production
      TZ: Asia/Shanghai
      CACHE_EXPIRE: 600
      DEBUG_INFO: "false"

      # ── 小红书配置（轻量纯 HTTP 模式） ──
      # XIAOHONGSHU_COOKIE: '你的小红书网页版 Cookie'
```

---

## 🛠️ 本地开发与添加路由

```text
├── .github/workflows/docker-build.yml   # 自动编译发布工作流 (arm64)
├── routes/                              # 自定义路由目录
│   ├── weibo/                          # 微博路由与防频刷工具
│   └── ...                             # 其他私有路由 (7kid, chinacdc, gov 等)
├── Dockerfile                           # 极简三阶段构建 (upstream -> builder -> runner)
└── README.md
```

### 添加新路由

1. 在 `routes/` 下创建对应目录与脚本（例如 `routes/demo/index.ts`）。
2. 按照 RSSHub 规范编写 `export const route = { ... }` 与数据提取逻辑。
3. 推送至 `main` 分支，GitHub Actions 将全自动触发多架构构建与发布：
   ```bash
   git add routes/
   git commit -m "feat: add demo route"
   git push origin main
   ```

---

## 🔍 服务验证

- **健康检查**：`http://localhost:1200/healthz`
- **微博路由**：`http://localhost:1200/weibo/user/1195230310`

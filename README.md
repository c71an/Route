# Custom RSSHub (Route)

轻量级私有定制版 RSSHub 镜像。基于上游最新核心，剔除全部无关冗余路由与重型浏览器（Chromium/Playwright）依赖，仅注入本项目自定义路由，并通过 `@vercel/nft` 深度摇树压缩。

- ⚡ **极致轻量**：镜像体积压缩至 ~90MB，内存占用极低。
- 🌍 **多架构支持**：GitHub Actions 自动构建并发布 `linux/amd64` 与 `linux/arm64`。
- 🛡️ **内置图片反代**：原生提供 `/proxy` 流式反代端点，自动绕过微博等图床防盗链，且不拦截视频直链。

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

### 推荐部署 (Docker Compose 带防盗链反代)

若使用 FreshRSS 等阅读器订阅微博，建议开启内置图片反代以绕过防盗链限制：

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

      # ── 图片防盗链反代配置 ──
      # 局域网阅读器推荐填入 RSSHub 实例地址（如 http://192.168.1.x:1200/proxy?url=${href_ue}）
      HOTLINK_TEMPLATE: '/proxy?url=${href_ue}'
      # 严格限定代理范围，仅对微博生效，绝不影响其他路由
      HOTLINK_INCLUDE_PATHS: '/weibo'
```

---

## 🖼️ 图片防盗链内置反代机制

项目内置了针对防盗链图床的原生流式反代端点（`/proxy`）：

1. **动态 Referer 注入**：服务端根据目标图片域名（如 `*.sinaimg.cn`、`*.weibocdn.com`）自动附带合法 `Referer: https://weibo.com/`，彻底告别 403 裂图。
2. **零磁盘流式透传**：数据流即收即发，不落地硬盘，不堆积内存。
3. **客户端 30 天强缓存**：自动注入 `Cache-Control: public, max-age=2592000, immutable`，阅读器二次打开秒加载，极大减少重复请求。
4. **视频直链保护**：构建阶段已对防盗链中间件进行深度修剪，仅拦截并代理 `<img>` 图片，视频依然保持官方 CDN 直连播放。

> **提示**：后续如需为其他平台（知乎、B站等）添加 Referer 规则，只需在 [`routes/proxy/index.ts`](routes/proxy/index.ts) 的 `REFERER_RULES` 中追加映射，并在 `HOTLINK_INCLUDE_PATHS` 中用逗号追加路由路径（如 `/weibo,/zhihu`）即可。

---

## 🛠️ 本地开发与添加路由

```text
├── .github/workflows/docker-build.yml   # 自动编译发布工作流 (amd64 / arm64)
├── routes/                              # 自定义路由目录
│   ├── proxy/index.ts                  # 内置图片防盗链流式反代端点
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
- **反代探针**：`http://localhost:1200/proxy?url=https%3A%2F%2Fwx1.sinaimg.cn...`

# 动态 Cookie 与 User-Agent 挂载目录

本目录支持在容器运行期间**免重启、免 stop / rm 动态热更新 Cookie 与 User-Agent**。

## 映射方式（Docker 启动参数）
将本目录直接挂载至容器工作目录：
```bash
-v /你的宿主机路径/Router/cookies:/app/cookies
```
或者挂载单文件：
```bash
-v /你的宿主机路径/Router/cookies/ua.txt:/app/cookies/ua.txt
-v /你的宿主机路径/Router/cookies/xiaohongshu.txt:/app/cookies/xiaohongshu.txt
-v /你的宿主机路径/Router/cookies/douyin.txt:/app/cookies/douyin.txt
-v /你的宿主机路径/Router/cookies/weibo.txt:/app/cookies/weibo.txt
```

## 对应文件名
- **全局浏览器 UA**：`ua.txt`（直接填入 Chrome 真实 User-Agent，自动推导全平台 Client Hints）
- **小红书**：`xiaohongshu.txt`
- **抖音**：`douyin.txt`
- **微博**：`weibo.txt`

## 浏览器一键可视化同步（推荐）
在日常登录账号的 Chrome 浏览器中访问：
```text
http://localhost:1200/ua
```
- **查看**：同时显示 RSSHub 当前生效 UA 与当前浏览器 UA。
- **一键同步**：点击按钮，直接将当前浏览器 UA 同步并写入 `cookies/ua.txt`。
- **手动编辑**：支持文本框自由编辑修改并保存。
- **防误触**：纯打开页面不会自动更改，必须显式点击按钮才执行写入。

## 热生效机制
- 当 Cookie 或 UA 失效/升级时，直接更新对应文本文件（或在 `/ua` 控制台点击同步）。
- 服务端检测文件修改时间戳（mtime），在下一次请求时**秒级自动热加载**。
- **无需 `docker stop`，无需 `docker rm`，内存缓存 100% 完整保留，彻底消除冷启动风控！**

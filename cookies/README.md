# 动态 Cookie 挂载目录

本目录支持在容器运行期间**免重启、免 stop / rm 动态热更新 Cookie**。

## 映射方式（Docker 启动参数）
将本目录直接挂载至容器工作目录：
```bash
-v /你的宿主机路径/Router/cookies:/app/cookies
```
或者挂载整个根目录下的单文件：
```bash
-v /你的宿主机路径/Router/cookies/xiaohongshu.txt:/app/cookies/xiaohongshu.txt
-v /你的宿主机路径/Router/cookies/douyin.txt:/app/cookies/douyin.txt
-v /你的宿主机路径/Router/cookies/weibo.txt:/app/cookies/weibo.txt
```

## 对应文件名
- **小红书**：`xiaohongshu.txt`
- **抖音**：`douyin.txt`
- **微博**：`weibo.txt`

## 热生效机制
- 当 Cookie 失效时，直接把新 Cookie 粘贴进上述文本文件并保存。
- 服务端会检测文件修改时间戳（mtime），在下一次请求时**秒级自动热加载**最新 Cookie。
- **无需 `docker stop`，无需 `docker rm`，内存缓存 100% 完整保留，彻底消除冷启动风控！**

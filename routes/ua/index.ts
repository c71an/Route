import type { Route } from '@/types';
import { ViewType } from '@/types';
import { getBrowserFingerprint, updateUserAgent } from '../common/fingerprint';

export const route: Route = {
    path: '/',
    name: 'User-Agent 管理',
    categories: ['other'],
    view: ViewType.Notifications,
    maintainers: ['c71an'],
    handler,
    description: '查看、对比与热同步 RSSHub 容器的 User-Agent 指纹',
};

async function handler(ctx) {
    const browserUa = ctx.req.header('user-agent') || '';
    const fp = getBrowserFingerprint();

    // 1. 处理 POST 提交更新
    if (ctx.req.method === 'POST') {
        let newUa = '';
        try {
            const body = await ctx.req.json();
            newUa = body.ua;
        } catch {
            try {
                const formData = await ctx.req.parseBody();
                newUa = formData.ua as string;
            } catch (_) {}
        }

        if (!newUa) {
            return ctx.json({ success: false, message: '未接收到有效的 User-Agent 内容' }, 400);
        }

        try {
            const updatedFp = updateUserAgent(newUa);
            return ctx.json({
                success: true,
                message: 'User-Agent 已成功更新并秒级热生效！',
                ua: updatedFp.ua,
                version: updatedFp.fullVersion,
                secChUa: updatedFp.secChUa,
            });
        } catch (err: any) {
            return ctx.json({ success: false, message: err.message }, 400);
        }
    }

    // 2. 若客户端请求 JSON 格式
    if (ctx.req.query('format') === 'json' || ctx.req.header('accept')?.includes('application/json')) {
        return ctx.json({
            rsshubUa: fp.ua,
            browserUa,
            majorVersion: fp.majorVersion,
            fullVersion: fp.fullVersion,
            secChUa: fp.secChUa,
        });
    }

    // 3. 渲染可视化控制台页面（黑白灰主体 + RSS 经典橙色高亮）
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User-Agent 管理</title>
    <style>
        :root {
            --bg-color: #121212;
            --container-bg: #1c1c1e;
            --card-bg: #242426;
            --card-border: #333336;
            --text-main: #f5f5f7;
            --text-sub: #a1a1aa;
            --text-muted: #71717a;
            --code-bg: #151517;
            --code-border: #2d2d30;
            --code-text: #e4e4e7;
            
            /* RSS 经典橙 */
            --rss-orange: #ff6600;
            --rss-orange-hover: #ff771a;
            --rss-orange-active: #e65c00;
            --rss-orange-subtle: rgba(255, 102, 0, 0.12);
            --rss-orange-border: rgba(255, 102, 0, 0.35);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 24px 16px;
        }
        .container {
            width: 100%;
            max-width: 780px;
            background: var(--container-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 32px;
            box-shadow: 0 25px 35px -5px rgba(0, 0, 0, 0.6), 0 10px 15px -5px rgba(0, 0, 0, 0.5);
        }
        .header {
            margin-bottom: 24px;
            border-bottom: 1px solid var(--card-border);
            padding-bottom: 16px;
        }
        .header h1 {
            font-size: 1.4rem;
            font-weight: 700;
            color: var(--text-main);
        }
        /* 当前运行 RSSHub UA 区域（纯黑白灰状态区，无外层卡片框） */
        .status-section {
            margin-bottom: 0;
        }
        .divider {
            height: 1px;
            background: var(--card-border);
            margin: 24px 0;
            border: none;
        }
        .status-title {
            font-size: 0.85rem;
            color: var(--text-sub);
            font-weight: 600;
            letter-spacing: 0.05em;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .badge-orange {
            font-size: 0.75rem;
            padding: 3px 8px;
            border-radius: 6px;
            background: var(--rss-orange-subtle);
            color: var(--rss-orange);
            border: 1px solid var(--rss-orange-border);
            font-family: ui-monospace, SFMono-Regular, monospace;
            font-weight: 600;
        }
        /* 卡片区域（当前浏览器卡片与自定义卡片统一色调） */
        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 18px 20px;
            margin-bottom: 20px;
        }
        .card-title {
            font-size: 0.85rem;
            color: var(--text-sub);
            font-weight: 600;
            letter-spacing: 0.05em;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        /* 统一输入框与展示框样式 */
        .ua-box {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 0.88rem;
            line-height: 1.5;
            word-break: break-all;
            color: var(--code-text);
            background: var(--code-bg);
            padding: 12px 14px;
            border-radius: 8px;
            border: 1px solid var(--code-border);
        }
        .meta-tags {
            display: flex;
            gap: 8px;
            margin-top: 10px;
            flex-wrap: wrap;
        }
        .tag-gray {
            font-size: 0.75rem;
            padding: 3px 8px;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.04);
            color: var(--text-muted);
            border: 1px solid rgba(255, 255, 255, 0.08);
            font-family: ui-monospace, monospace;
        }
        textarea {
            width: 100%;
            height: 95px;
            background: var(--code-bg);
            border: 1px solid var(--code-border);
            border-radius: 8px;
            color: var(--code-text);
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            font-size: 0.88rem;
            line-height: 1.5;
            padding: 12px 14px;
            resize: vertical;
            outline: none;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
            display: block;
        }
        textarea:focus {
            border-color: var(--rss-orange);
            box-shadow: 0 0 0 2px var(--rss-orange-subtle);
        }
        /* 统一卡片操作按钮（RSS 橙色） */
        .btn-action {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            background: var(--rss-orange);
            color: #ffffff;
            border: 1px solid var(--rss-orange-hover);
            border-radius: 8px;
            padding: 9px 18px;
            font-size: 0.88rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            margin-top: 12px;
        }
        .btn-action:hover {
            background: var(--rss-orange-hover);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(255, 102, 0, 0.25);
        }
        .btn-action:active {
            background: var(--rss-orange-active);
            transform: translateY(0);
        }
        .btn-action:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        .toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 500;
            display: none;
            z-index: 100;
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.5);
            animation: fadeIn 0.3s ease;
        }
        .toast.success {
            display: block;
            background: #1c1511;
            color: #ffa86b;
            border: 1px solid var(--rss-orange);
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 0 15px rgba(255, 102, 0, 0.2);
        }
        .toast.error {
            display: block;
            background: #201415;
            color: #fca5a5;
            border: 1px solid #ef4444;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>User-Agent 管理</h1>
        </div>

        <!-- 1. 当前运行 RSSHub UA (去掉了外层卡片框，纯黑白灰状态区) -->
        <div class="status-section">
            <div class="status-title">
                <span>当前运行RSSHUB UA</span>
                <span id="effective-ver" class="badge-orange">CHROME ${fp.fullVersion}</span>
            </div>
            <div class="ua-box" id="effective-ua">${fp.ua}</div>
            <div class="meta-tags">
                <span class="tag-gray">Client Hints: ${fp.secChUa.replace(/"/g, '&quot;')}</span>
            </div>
        </div>

        <div class="divider"></div>

        <!-- 2. 当前访问浏览器 UA (卡片) -->
        <div class="card">
            <div class="card-title">
                <span>当前访问浏览器 UA</span>
            </div>
            <div class="ua-box" id="browser-ua">${browserUa || '未检测到浏览器 User-Agent'}</div>
            ${
                browserUa
                    ? `<button type="button" class="btn-action" id="btn-sync" onclick="syncBrowserUa()">
                        同步浏览器 UA
                    </button>`
                    : ''
            }
        </div>

        <!-- 3. 自定义 (卡片，色彩完全统一) -->
        <div class="card">
            <div class="card-title">
                <span>自定义</span>
            </div>
            <textarea id="custom-ua" placeholder="在此粘贴或修改 User-Agent 字符串...">${fp.ua}</textarea>
            <button type="button" class="btn-action" id="btn-submit" onclick="submitCustomUa()">
                同步自定义 UA
            </button>
        </div>
    </div>

    <div id="toast" class="toast"></div>

    <script>
        const browserUa = ${JSON.stringify(browserUa)};

        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast ' + type;
            setTimeout(() => {
                toast.className = 'toast';
            }, 3500);
        }

        async function postUa(uaString) {
            const res = await fetch(window.location.pathname, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ua: uaString })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || '更新失败');
            }
            return data;
        }

        async function syncBrowserUa() {
            if (!browserUa) {
                showToast('未检测到有效的浏览器 User-Agent', 'error');
                return;
            }

            // 移动端防呆提示
            if (/mobile|iphone|android|ipad/i.test(browserUa)) {
                if (!confirm('检测到您当前使用的是移动端浏览器，确定要将小红书/抖音等 PC 路由的指纹同步为手机端吗？')) {
                    return;
                }
            }

            const btn = document.getElementById('btn-sync');
            btn.disabled = true;
            btn.textContent = '正在同步...';

            try {
                const data = await postUa(browserUa);
                document.getElementById('effective-ua').textContent = data.ua;
                document.getElementById('effective-ver').textContent = 'CHROME ' + data.version;
                document.getElementById('custom-ua').value = data.ua;
                showToast('✅ 浏览器 UA 已成功同步并秒级热生效！');
            } catch (err) {
                showToast('❌ ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = '同步浏览器 UA';
            }
        }

        async function submitCustomUa() {
            const input = document.getElementById('custom-ua').value.trim();
            if (!input) {
                showToast('请输入有效的 User-Agent', 'error');
                return;
            }

            const btn = document.getElementById('btn-submit');
            btn.disabled = true;
            btn.textContent = '正在保存...';

            try {
                const data = await postUa(input);
                document.getElementById('effective-ua').textContent = data.ua;
                document.getElementById('effective-ver').textContent = 'CHROME ' + data.version;
                document.getElementById('custom-ua').value = data.ua;
                showToast('✅ 自定义 UA 已成功保存并秒级热生效！');
            } catch (err) {
                showToast('❌ ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = '同步自定义 UA';
            }
        }
    </script>
</body>
</html>`;

    return ctx.html(html);
}

import type { Route } from '@/types';

export const route: Route = {
    path: '/',
    name: '图片代理',
    url: 'https://weibo.com',
    categories: ['social-media'],
    example: '/proxy?url=https%3A%2F%2Fwx1.sinaimg.cn%2Flarge%2F001ySj3ngy1h6y0z6z4d8j60u011i40c02.jpg',
    maintainers: ['c71an'],
    handler,
    description: '内部图片反代服务，自动根据图片来源域名匹配合法 Referer 绕过防盗链，并设置强缓存。',
};

// 来源域名 -> 合法 Referer 映射规则（后续可在此处按需添加其他平台）
interface RefererRule {
    pattern: RegExp;
    referer: string;
}

const REFERER_RULES: RefererRule[] = [
    // 微博 / 新浪图床
    { pattern: /(?:sinaimg\.cn|weibo\.cn|weibocdn\.com)$/i, referer: 'https://weibo.com/' },
    // 后续如有其它平台，直接在此追加，例如：
    // { pattern: /zhimg\.com$/i, referer: 'https://www.zhihu.com/' },
    // { pattern: /xhscdn\.com$/i, referer: 'https://www.xiaohongshu.com/' },
    // { pattern: /hdslb\.com$/i, referer: 'https://www.bilibili.com/' },
];

function getRefererForUrl(targetUrl: string): string | undefined {
    try {
        const { hostname } = new URL(targetUrl);
        const matched = REFERER_RULES.find((rule) => rule.pattern.test(hostname));
        return matched ? matched.referer : undefined;
    } catch {
        return undefined;
    }
}

async function handler(ctx) {
    const targetUrl = ctx.req.query('url');

    if (!targetUrl) {
        return new Response('Missing "url" query parameter', {
            status: 400,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    try {
        // 根据目标图片域名动态匹配 Referer
        const matchedReferer = getRefererForUrl(targetUrl);

        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        if (matchedReferer) {
            headers.Referer = matchedReferer;
        }

        const upstreamResponse = await fetch(targetUrl, { headers });

        if (!upstreamResponse.ok) {
            return new Response(`Upstream fetch failed with status: ${upstreamResponse.status}`, {
                status: upstreamResponse.status,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        }

        const contentType = upstreamResponse.headers.get('content-type') || 'image/jpeg';
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', contentType);
        // 设置 30 天强缓存，减少重复请求
        responseHeaders.set('Cache-Control', 'public, max-age=2592000, immutable');

        const contentLength = upstreamResponse.headers.get('content-length');
        if (contentLength) {
            responseHeaders.set('Content-Length', contentLength);
        }

        return new Response(upstreamResponse.body, {
            status: 200,
            headers: responseHeaders,
        });
    } catch (err: any) {
        return new Response(`Proxy error: ${err.message || 'unknown error'}`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }
}

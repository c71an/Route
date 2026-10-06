import type { Route } from '@/types';

export const route: Route = {
    path: '/',
    name: '图片代理',
    url: 'https://weibo.com',
    categories: ['social-media'],
    example: '/proxy?url=https%3A%2F%2Fwx1.sinaimg.cn%2Flarge%2F001ySj3ngy1h6y0z6z4d8j60u011i40c02.jpg',
    maintainers: ['c71an'],
    handler,
    description: '内部图片反代服务，自动附带合法 Referer 绕过防盗链机制，并设置浏览器强缓存。',
};

async function handler(ctx) {
    const targetUrl = ctx.req.query('url');

    if (!targetUrl) {
        return new Response('Missing "url" query parameter', {
            status: 400,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    try {
        const upstreamResponse = await fetch(targetUrl, {
            headers: {
                Referer: 'https://weibo.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        });

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

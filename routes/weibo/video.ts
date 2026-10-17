import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';

import weiboUtils, { calculateWeiboTTL } from './utils';

export const route: Route = {
    path: '/video/:id/:quality?',
    name: '微博视频防防盗链播放端点',
    categories: ['social-media'],
    view: ViewType.Videos,
    maintainers: ['c71an'],
    handler,
    description: '为微博视频提供伪装 Referer 的零拷贝流式转发与自适应缓存服务，彻底解决 403 防盗链与过期问题',
};

async function handler(ctx) {
    const rawId = ctx.req.param('id');
    const quality = ctx.req.param('quality') || '720p';
    const cleanId = rawId.match(/([a-zA-Z0-9]+)/)?.[1] || rawId;

    const cacheKey = `weibo:video-stream:${cleanId}:${quality}`;
    let targetUrl = (await cache.get(cacheKey)) as string | undefined;

    if (!targetUrl) {
        try {
            const data = await weiboUtils.getShowData('', cleanId);
            const pageInfo = data?.page_info?.type === 'video' ? data.page_info : data?.retweeted_status?.page_info;

            if (!pageInfo || pageInfo.type !== 'video') {
                return ctx.text('Video not found for this weibo', 404);
            }

            const urls = pageInfo.urls || {};
            const mediaInfo = pageInfo.media_info || {};

            if (quality === '720p') {
                targetUrl = urls.mp4_720p_mp4 || mediaInfo.mp4_720p_mp4 || urls.mp4_hd_mp4 || mediaInfo.mp4_hd_url || mediaInfo.stream_url_hd || '';
            } else if (quality === 'hd') {
                targetUrl = urls.mp4_hd_mp4 || mediaInfo.mp4_hd_url || mediaInfo.stream_url_hd || urls.mp4_720p_mp4 || mediaInfo.mp4_720p_mp4 || '';
            } else if (quality === 'ld') {
                targetUrl = urls.mp4_ld_mp4 || mediaInfo.mp4_sd_url || mediaInfo.stream_url || '';
            }

            if (!targetUrl) {
                targetUrl = urls.mp4_720p_mp4 || mediaInfo.mp4_720p_mp4 || urls.mp4_hd_mp4 || mediaInfo.mp4_hd_url || mediaInfo.stream_url_hd || urls.mp4_ld_mp4 || mediaInfo.mp4_sd_url || mediaInfo.stream_url || '';
            }

            if (targetUrl) {
                const ttl = calculateWeiboTTL(targetUrl, 86400);
                await cache.set(cacheKey, targetUrl, ttl);
            }
        } catch (err: any) {
            return ctx.text(`Failed to resolve weibo video: ${err.message}`, 502);
        }
    }

    if (!targetUrl) {
        return ctx.text('Playable video stream not found for this weibo', 404);
    }

    // 若客户端显式要求 302 重定向
    if (ctx.req.query('redirect') === '1') {
        ctx.header('Referrer-Policy', 'no-referrer');
        ctx.header('Access-Control-Allow-Origin', '*');
        return ctx.redirect(targetUrl, 302);
    }

    // 默认走智能流式代理：由 Router 代替客户端伪造 Referer: https://weibo.com/ 请求新浪 CDN，彻底免疫第三方阅读器 403 拦截
    try {
        const range = ctx.req.header('range');
        const upstreamHeaders: Record<string, string> = {
            Referer: 'https://weibo.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        if (range) {
            upstreamHeaders.Range = range;
        }

        const upstreamRes = await fetch(targetUrl, {
            method: 'GET',
            headers: upstreamHeaders,
        });

        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', upstreamRes.headers.get('content-type') || 'video/mp4');
        responseHeaders.set('Accept-Ranges', 'bytes');
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        responseHeaders.set('Cache-Control', 'public, max-age=86400');

        const contentRange = upstreamRes.headers.get('content-range');
        if (contentRange) {
            responseHeaders.set('Content-Range', contentRange);
        }
        const contentLength = upstreamRes.headers.get('content-length');
        if (contentLength) {
            responseHeaders.set('Content-Length', contentLength);
        }

        if (ctx.req.method === 'HEAD') {
            return new Response(null, {
                status: upstreamRes.status,
                headers: responseHeaders,
            });
        }

        return new Response(upstreamRes.body, {
            status: upstreamRes.status,
            headers: responseHeaders,
        });
    } catch (streamErr: any) {
        // 异常降级 302
        return ctx.redirect(targetUrl, 302);
    }
}

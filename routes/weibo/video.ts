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

// 记录正在进行中的视频直链解析 Promise，防止播放器多个 Range 请求并发击穿微博
const inFlightWeiboVideoRequests = new Map<string, Promise<string>>();

async function resolveWeiboVideo(cleanId: string, quality: string): Promise<string> {
    const flightKey = `${cleanId}:${quality}`;
    if (inFlightWeiboVideoRequests.has(flightKey)) {
        return inFlightWeiboVideoRequests.get(flightKey)!;
    }

    const promise = (async () => {
        const cacheKey = `weibo:video-stream:${cleanId}:${quality}`;
        const cachedUrl = (await cache.get(cacheKey)) as string | undefined;
        if (cachedUrl) {
            return cachedUrl;
        }

        const data = await weiboUtils.getShowData('', cleanId);
        const pageInfo = data?.page_info?.type === 'video' ? data.page_info : data?.retweeted_status?.page_info;

        if (!pageInfo || pageInfo.type !== 'video') {
            // 负缓存：写入 5 分钟空标记，防止无视频微博被客户端高频重复打向微博
            await cache.set(cacheKey, '__NOT_FOUND__', 300);
            return '';
        }

        const urls = pageInfo.urls || {};
        const mediaInfo = pageInfo.media_info || {};

        const video720p = urls.mp4_720p_mp4 || mediaInfo.mp4_720p_mp4 || urls.mp4_hd_mp4 || mediaInfo.mp4_hd_url || mediaInfo.stream_url_hd || '';
        const videoHd = urls.mp4_hd_mp4 || mediaInfo.mp4_hd_url || mediaInfo.stream_url_hd || urls.mp4_720p_mp4 || mediaInfo.mp4_720p_mp4 || '';
        const videoLd = urls.mp4_ld_mp4 || mediaInfo.mp4_sd_url || mediaInfo.stream_url || '';

        // 批量预热写入全清晰度缓存
        if (video720p) {
            const ttl = calculateWeiboTTL(video720p, 86400);
            cache.set(`weibo:video-stream:${cleanId}:720p`, video720p, ttl);
        }
        if (videoHd) {
            const ttl = calculateWeiboTTL(videoHd, 86400);
            cache.set(`weibo:video-stream:${cleanId}:hd`, videoHd, ttl);
        }
        if (videoLd) {
            const ttl = calculateWeiboTTL(videoLd, 86400);
            cache.set(`weibo:video-stream:${cleanId}:ld`, videoLd, ttl);
        }

        let resolvedUrl = '';
        if (quality === '720p') {
            resolvedUrl = video720p;
        } else if (quality === 'hd') {
            resolvedUrl = videoHd;
        } else if (quality === 'ld') {
            resolvedUrl = videoLd;
        }
        resolvedUrl = resolvedUrl || video720p || videoHd || videoLd;

        if (!resolvedUrl) {
            await cache.set(cacheKey, '__NOT_FOUND__', 300);
        }

        return resolvedUrl;
    })().finally(() => {
        inFlightWeiboVideoRequests.delete(flightKey);
    });

    inFlightWeiboVideoRequests.set(flightKey, promise);
    return promise;
}

async function handler(ctx) {
    const rawId = ctx.req.param('id');
    const quality = ctx.req.param('quality') || '720p';
    const cleanId = rawId.match(/([a-zA-Z0-9]+)/)?.[1] || rawId;

    const cacheKey = `weibo:video-stream:${cleanId}:${quality}`;
    let targetUrl = (await cache.get(cacheKey)) as string | undefined;

    if (targetUrl === '__NOT_FOUND__') {
        return ctx.text('Video not found for this weibo', 404);
    }

    if (!targetUrl) {
        try {
            targetUrl = await resolveWeiboVideo(cleanId, quality);
        } catch (err: any) {
            return ctx.text(`Failed to resolve weibo video: ${err.message}`, 502);
        }
    }

    if (!targetUrl || targetUrl === '__NOT_FOUND__') {
        return ctx.text('Playable video stream not found for this weibo', 404);
    }

    // 若客户端显式要求 302 重定向
    if (ctx.req.query('redirect') === '1') {
        ctx.header('Referrer-Policy', 'no-referrer');
        ctx.header('Access-Control-Allow-Origin', '*');
        const ttl = calculateWeiboTTL(targetUrl, 86400);
        ctx.header('Cache-Control', `public, max-age=${ttl}`);
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
        ctx.header('Referrer-Policy', 'no-referrer');
        ctx.header('Access-Control-Allow-Origin', '*');
        const ttl = calculateWeiboTTL(targetUrl, 86400);
        ctx.header('Cache-Control', `public, max-age=${ttl}`);
        return ctx.redirect(targetUrl, 302);
    }
}

import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';

import weiboUtils, { calculateWeiboTTL } from './utils';

export const route: Route = {
    path: '/video/:id/:quality?',
    name: '微博视频 302 播放重定向端点',
    categories: ['social-media'],
    view: ViewType.Videos,
    maintainers: ['c71an'],
    handler,
    description: '为微博视频提供自适应缓存的 302 播放重定向服务，彻底解决视频直链过期 403 问题',
};

async function handler(ctx) {
    const rawId = ctx.req.param('id');
    const quality = ctx.req.param('quality') || '720p';
    const cleanId = rawId.match(/([a-zA-Z0-9]+)/)?.[1] || rawId;

    ctx.header('Referrer-Policy', 'no-referrer');
    ctx.header('Access-Control-Allow-Origin', '*');

    const cacheKey = `weibo:video-stream:${cleanId}:${quality}`;
    const cachedUrl = (await cache.get(cacheKey)) as string | undefined;
    if (cachedUrl) {
        return ctx.redirect(cachedUrl, 302);
    }

    try {
        const data = await weiboUtils.getShowData('', cleanId);
        const pageInfo = data?.page_info?.type === 'video' ? data.page_info : data?.retweeted_status?.page_info;

        if (!pageInfo || pageInfo.type !== 'video') {
            return ctx.text('Video not found for this weibo', 404);
        }

        const urls = pageInfo.urls || {};
        const mediaInfo = pageInfo.media_info || {};

        let targetUrl = '';
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
            return ctx.redirect(targetUrl, 302);
        }

        return ctx.text('Playable video stream not found for this weibo', 404);
    } catch (err: any) {
        return ctx.text(`Failed to resolve weibo video: ${err.message}`, 502);
    }
}

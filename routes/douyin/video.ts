import { config } from '@/config';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';

import { calculateDouyinTTL, fetchAwemeDetail, pickPlayableVideoUrl } from './utils';

export const route: Route = {
    path: '/video/:aweme_id/:type?/:index?',
    name: '视频与实况图 302 播放重定向端点',
    categories: ['social-media'],
    view: ViewType.Videos,
    maintainers: ['c71an'],
    handler,
    description: '为抖音常规视频和 Live Photo 实况图提供自适应缓存的 302 播放重定向服务',
};

async function handler(ctx) {
    const rawAwemeId = ctx.req.param('aweme_id');
    const type = ctx.req.param('type') || 'video';
    const index = parseInt(ctx.req.param('index') || '0', 10);
    const cleanAwemeId = rawAwemeId.match(/(\d+)/)?.[1] || rawAwemeId;

    ctx.header('Referrer-Policy', 'no-referrer');
    ctx.header('Access-Control-Allow-Origin', '*');

    const cacheKey = `douyin:video-stream:${cleanAwemeId}:${type}:${index}`;
    const cachedUrl = (await cache.get(cacheKey)) as string | undefined;
    if (cachedUrl === '__NOT_FOUND__') {
        return ctx.text('Video stream not found for this aweme_id', 404);
    }
    if (cachedUrl) {
        const ttl = calculateDouyinTTL(cachedUrl, 3600);
        ctx.header('Cache-Control', `public, max-age=${ttl}`);
        return ctx.redirect(cachedUrl, 302);
    }

    const cookie = config.douyin?.cookie || process.env.DOUYIN_COOKIE;
    if (!cookie) {
        return ctx.text('DOUYIN_COOKIE is required', 500);
    }

    try {
        const detail = await fetchAwemeDetail(cleanAwemeId, cookie);

        // 批量预热写入缓存：顺手把这篇作品的所有实况图和主视频全部写入缓存，供后续并发请求秒开
        if (detail.images && detail.images.length > 0) {
            for (let i = 0; i < detail.images.length; i++) {
                const liveUrls = detail.images[i]?.video?.play_addr?.url_list;
                const liveUrl = pickPlayableVideoUrl(liveUrls);
                if (liveUrl) {
                    const ttl = calculateDouyinTTL(liveUrl, 3600);
                    cache.set(`douyin:video-stream:${cleanAwemeId}:live:${i}`, liveUrl, ttl);
                }
            }
        }

        const bitRates = detail.video?.bit_rate || [];
        let mainVideoUrl = '';
        for (const br of bitRates) {
            const url = pickPlayableVideoUrl(br.play_addr?.url_list);
            if (url && (url.includes('-weba.') || !url.includes('-web.'))) {
                mainVideoUrl = url;
                break;
            }
        }
        if (!mainVideoUrl) {
            const bestPlayAddr = bitRates[0]?.play_addr?.url_list || detail.video?.play_addr?.url_list || [];
            mainVideoUrl = pickPlayableVideoUrl(bestPlayAddr);
        }
        if (mainVideoUrl) {
            const ttl = calculateDouyinTTL(mainVideoUrl, 3600);
            cache.set(`douyin:video-stream:${cleanAwemeId}:video:0`, mainVideoUrl, ttl);
        }

        let targetUrl = '';
        if (type === 'live') {
            const targetImage = detail.images?.[index];
            const liveUrls = targetImage?.video?.play_addr?.url_list;
            targetUrl = pickPlayableVideoUrl(liveUrls);
            if (!targetUrl && detail.images && detail.images.length > 0) {
                await cache.set(cacheKey, '__NOT_FOUND__', 300);
                return ctx.text(`Live photo video stream not found for image index ${index}`, 404);
            }
        } else {
            targetUrl = mainVideoUrl;
        }

        if (targetUrl) {
            const ttl = calculateDouyinTTL(targetUrl, 3600);
            ctx.header('Cache-Control', `public, max-age=${ttl}`);
            return ctx.redirect(targetUrl, 302);
        }

        // 负缓存：写入 5 分钟空标记，防止无视频作品被客户端高频重复打向抖音
        await cache.set(cacheKey, '__NOT_FOUND__', 300);
        return ctx.text('Video stream not found for this aweme_id', 404);
    } catch (err: any) {
        if (err.message?.includes('未找到') || err.message?.includes('status_code=')) {
            await cache.set(cacheKey, '__NOT_FOUND__', 300);
        }
        return ctx.text(`Failed to resolve douyin video: ${err.message}`, 502);
    }
}

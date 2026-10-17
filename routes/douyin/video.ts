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
    if (cachedUrl) {
        return ctx.redirect(cachedUrl, 302);
    }

    const cookie = config.douyin?.cookie || process.env.DOUYIN_COOKIE;
    if (!cookie) {
        return ctx.text('DOUYIN_COOKIE is required', 500);
    }

    try {
        const detail = await fetchAwemeDetail(cleanAwemeId, cookie);
        let targetUrl = '';

        if (type === 'live') {
            const targetImage = detail.images?.[index];
            const liveUrls = targetImage?.video?.play_addr?.url_list;
            targetUrl = pickPlayableVideoUrl(liveUrls);
            if (!targetUrl && detail.images && detail.images.length > 0) {
                return ctx.text(`Live photo video stream not found for image index ${index}`, 404);
            }
        } else {
            const bitRates = detail.video?.bit_rate || [];
            for (const br of bitRates) {
                const url = pickPlayableVideoUrl(br.play_addr?.url_list);
                if (url && (url.includes('-weba.') || !url.includes('-web.'))) {
                    targetUrl = url;
                    break;
                }
            }
            if (!targetUrl) {
                const bestPlayAddr = bitRates[0]?.play_addr?.url_list || detail.video?.play_addr?.url_list || [];
                targetUrl = pickPlayableVideoUrl(bestPlayAddr);
            }
        }

        if (targetUrl) {
            // 自适应提取真实有效秒数进行缓存，兼顾安全缓冲
            const ttl = calculateDouyinTTL(targetUrl, 3600);
            await cache.set(cacheKey, targetUrl, ttl);
            return ctx.redirect(targetUrl, 302);
        }

        return ctx.text('Video stream not found for this aweme_id', 404);
    } catch (err: any) {
        return ctx.text(`Failed to resolve douyin video: ${err.message}`, 502);
    }
}

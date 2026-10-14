import { config } from '@/config';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';

import { calculateXhsTTL, extractNoteMedia, fetchNoteDetail } from './util';

export const route: Route = {
    path: '/video/:note_id/:type?/:index?',
    name: '视频与实况图 302 播放重定向端点',
    categories: ['social-media'],
    view: ViewType.Videos,
    maintainers: ['c71an'],
    handler,
    description: '为小红书常规视频和 Live Photo 实况图提供按 t 参数精确自适应缓存的 302 播放重定向服务',
};

async function handler(ctx) {
    const rawNoteId = ctx.req.param('note_id');
    const type = ctx.req.param('type') || 'video';
    const index = parseInt(ctx.req.param('index') || '0', 10);
    const cleanNoteId = rawNoteId.match(/([0-9a-f]{24})/i)?.[1] || rawNoteId;

    const cacheKey = `xiaohongshu:video-stream:${cleanNoteId}:${type}:${index}`;
    const cachedUrl = await cache.get(cacheKey);
    if (cachedUrl) {
        return ctx.redirect(cachedUrl, 302);
    }

    const cookie = config.xiaohongshu?.cookie || process.env.XIAOHONGSHU_COOKIE;
    if (!cookie) {
        return ctx.text('XIAOHONGSHU_COOKIE is required', 500);
    }

    try {
        const noteData = await fetchNoteDetail(cleanNoteId, cookie);
        const media = extractNoteMedia(noteData);

        let targetUrl = '';
        if (type === 'live') {
            targetUrl = media.livePhotos[index] || '';
        } else {
            targetUrl = media.mainVideo || media.mainVideoBackups[0] || '';
        }

        if (targetUrl) {
            const ttl = calculateXhsTTL(targetUrl, 3600 * 24);
            await cache.set(cacheKey, targetUrl, ttl);
            return ctx.redirect(targetUrl, 302);
        }

        return ctx.text('Media not found for this note', 404);
    } catch (err: any) {
        return ctx.text(`Failed to resolve note media: ${err.message}`, 502);
    }
}

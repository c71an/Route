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

        // 批量预热写入：顺手把这篇笔记的所有实况图和主视频全部写入缓存，供后续请求秒开
        if (cleanNoteId) {
            const cacheTasks: Promise<any>[] = [];
            media.livePhotos.forEach((liveUrl, idx) => {
                if (liveUrl) {
                    const lTtl = calculateXhsTTL(liveUrl, 3600 * 24);
                    cacheTasks.push(cache.set(`xiaohongshu:video-stream:${cleanNoteId}:live:${idx}`, liveUrl, lTtl));
                }
            });

            const mainVideo = media.mainVideo || media.mainVideoBackups[0];
            if (mainVideo) {
                const vTtl = calculateXhsTTL(mainVideo, 3600 * 24);
                cacheTasks.push(cache.set(`xiaohongshu:video-stream:${cleanNoteId}:video:0`, mainVideo, vTtl));
            }
            await Promise.all(cacheTasks);
        }

        let targetUrl = '';
        if (type === 'live') {
            targetUrl = media.livePhotos[index] || '';
        } else {
            targetUrl = media.mainVideo || media.mainVideoBackups[0] || '';
        }

        if (targetUrl) {
            return ctx.redirect(targetUrl, 302);
        }

        return ctx.text('Media not found for this note', 404);
    } catch (err: any) {
        return ctx.text(`Failed to resolve note media: ${err.message}`, 502);
    }
}

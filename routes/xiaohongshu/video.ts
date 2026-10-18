import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';

export const route: Route = {
    path: '/video/:note_id/:type?/:index?',
    name: '视频与实况图 302 播放重定向端点',
    categories: ['social-media'],
    view: ViewType.Videos,
    maintainers: ['c71an'],
    handler,
    description: '为小红书常规视频和 Live Photo 实况图提供高性能 302 播放重定向服务',
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

    return ctx.text('视频直链缓存已失效。为防止触发小红书风控已拦截裸请求，请在阅读器中下拉刷新博主源获取最新流。', 410);
}

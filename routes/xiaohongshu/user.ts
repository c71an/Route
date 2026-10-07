import querystring from 'node:querystring';

import { config } from '@/config';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import { fallback, queryToBoolean } from '@/utils/readable-social';

import { getUserWithCookie, renderNotesFulltext } from './util';

export const route: Route = {
    path: '/user/:user_id/notes/:routeParams?',
    name: '博主笔记 (轻量纯 HTTP)',
    categories: ['social-media'],
    view: ViewType.Articles,
    maintainers: ['c71an'],
    handler,
    example: '/xiaohongshu/user/593032945e87e77791e03696/notes',
    features: {
        antiCrawler: true,
        requirePuppeteer: false,
        requireConfig: [
            {
                name: 'XIAOHONGSHU_COOKIE',
                optional: false,
                description: '小红书登录 Cookie（网页版提取），轻量纯 HTTP 模式必备',
            },
        ],
    },
    parameters: {
        user_id: '博主用户 ID，长度为 24 位字符（打开博主主页 URL 末尾的一串字符）',
        routeParams: '额外参数，如 `displayLivePhoto=1` 时开启实况照片转换为视频显示',
    },
    description: `::: tip
采用纯 HTTP + Cookie 高速直取方案，无需任何重型浏览器依赖。
:::`,
};

async function handler(ctx) {
    const userId = ctx.req.param('user_id');
    const routeParams = querystring.parse(ctx.req.param('routeParams') || '');
    const displayLivePhoto = !!fallback(undefined, queryToBoolean(routeParams.displayLivePhoto), false);
    const url = `https://www.xiaohongshu.com/user/profile/${userId}`;
    const cookie = config.xiaohongshu?.cookie || process.env.XIAOHONGSHU_COOKIE;

    if (!cookie) {
        throw new Error('未检测到 XIAOHONGSHU_COOKIE！纯 HTTP 轻量模式需要配置小红书网页版 Cookie。');
    }

    // 默认缓存 1 小时，避免频繁并发访问触发小红书风控滑块
    return await cache.tryGet(
        `xiaohongshu:user:${userId}:${displayLivePhoto ? '1' : '0'}`,
        async () => {
            const urlNotePrefix = 'https://www.xiaohongshu.com/explore';
            const user = await getUserWithCookie(url, cookie);
            const notes = await renderNotesFulltext(user.notes || [], urlNotePrefix, url, cookie, displayLivePhoto);

            const basicInfo = user.userPageData.basicInfo;
            return {
                title: `${basicInfo.nickname} - 笔记 • 小红书`,
                description: basicInfo.desc || `${basicInfo.nickname} 的小红书笔记`,
                image: basicInfo.imageb || basicInfo.images,
                link: url,
                item: notes,
            };
        },
        3600 // 缓存 1 小时
    );
}


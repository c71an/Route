import querystring from 'node:querystring';

import { config } from '@/config';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import { parseDate } from '@/utils/parse-date';
import { fallback, queryToBoolean } from '@/utils/readable-social';

import { calculateDouyinTTL, fetchUserAweme, getDouyinCookie, getOriginAvatar, pickPlayableVideoUrl } from './utils';

export const route: Route = {
    path: '/user/:sec_uid/:routeParams?',
    name: '博主作品 (轻量纯 HTTP)',
    categories: ['social-media'],
    view: ViewType.Videos,
    maintainers: ['c71an'],
    handler,
    example: '/douyin/user/MS4wLjABAAAARcAHmmF9mAG3JEixq_CdP72APhBlGlLVbN-1eBcPqao',
    features: {
        antiCrawler: true,
        requirePuppeteer: false,
        requireConfig: [
            {
                name: 'DOUYIN_COOKIE',
                optional: false,
                description: '抖音网页版 Cookie（必须包含 UIFID、ttwid 和 sessionid），轻量纯 HTTP 模式必备',
            },
        ],
    },
    parameters: {
        sec_uid: '博主 sec_uid，可在博主主页 URL 中找到（以 MS4wLjABAAAA 开头）',
        routeParams: '额外参数，例如 `embed=0` 关闭视频内嵌，`displayLivePhoto=0` 关闭实况照片转换为短视频显示（默认均开启）',
    },
    description: `::: tip
采用纯 HTTP + a_bogus / webSign 双重签名毫秒级直取方案，无需任何重型浏览器依赖。
:::`,
};

async function handler(ctx) {
    const secUid = ctx.req.param('sec_uid');
    if (!secUid || !secUid.startsWith('MS4wLjABAAAA')) {
        throw new InvalidParameterError('非法的 UID 参数，抖音博主 sec_uid 必须以 <b>MS4wLjABAAAA</b> 开头。');
    }

    let embedVideo = true;
    let displayLivePhoto = true;
    if (ctx.req.param('routeParams')) {
        const routeParams = querystring.parse(ctx.req.param('routeParams'));
        embedVideo = fallback(undefined, queryToBoolean(routeParams.embed), true);
        displayLivePhoto = fallback(undefined, queryToBoolean(routeParams.displayLivePhoto), true);
    }

    const cookie = getDouyinCookie();
    if (!cookie) {
        throw new Error('未检测到抖音 Cookie！请在 cookies/douyin.txt 写入或配置 DOUYIN_COOKIE 环境变量。');
    }

    const host = ctx.req.header('x-forwarded-host') || ctx.req.header('host');
    const proto = ctx.req.header('x-forwarded-proto') || 'http';
    const origin = host ? `${proto}://${host}` : new URL(ctx.req.url).origin;
    const pageUrl = `https://www.douyin.com/user/${secUid}`;

    return await cache.tryGet(
        `douyin:user:${secUid}:${embedVideo ? '1' : '0'}:${displayLivePhoto ? '1' : '0'}`,
        async () => {
            const data = await fetchUserAweme(secUid, cookie);
            const awemeList = data.aweme_list || [];

            if (awemeList.length === 0) {
                throw new Error('未获取到该博主的作品列表，可能该博主暂无公开作品，或 Cookie 已失效被风控拦截。');
            }

            const author = awemeList[0].author;
            const userNickname = author?.nickname || '抖音博主';
            const userAvatar = getOriginAvatar(author?.avatar_thumb?.url_list?.slice(-1)[0]);
            const userDesc = author?.signature || `${userNickname} 的抖音作品更新`;

            // 1. 彻底排除置顶干扰：按实际真实发布时间戳进行绝对降序排序（陈年置顶作品自动沉底）
            const sortedList = [...awemeList].sort((a, b) => (b.create_time || 0) - (a.create_time || 0));

            // 2. 严格仅截取时间线上真正最新的前 3 篇作品，多余的历史作品全部剔除
            const targetList = sortedList.slice(0, 3);

            const items = targetList.map((post) => {
                const coverUrl = post.video?.cover?.url_list?.slice(-1)[0] || post.video?.origin_cover?.url_list?.slice(-1)[0] || '';
                const descHtml = (post.desc || '').replaceAll('\n', '<br>');
                const isImageAlbum = !!(post.images && post.images.length > 0) || post.aweme_type === 68;

                const mediaParts: string[] = [];

                // 1. 图集作品处理（统一与微博、小红书完全一致的 Live Photo 呈现方式）
                if (isImageAlbum && post.images && post.images.length > 0) {
                    let liveIndex = 0;
                    for (let i = 0; i < post.images.length; i++) {
                        const imgItem = post.images[i];
                        const imgUrl = imgItem.url_list?.slice(-1)[0] || imgItem.display_image?.url_list?.slice(-1)[0] || '';
                        const hasLiveVideo = !!imgItem.video?.play_addr?.url_list;

                        if (hasLiveVideo && displayLivePhoto) {
                            const directLiveUrl = pickPlayableVideoUrl(imgItem.video?.play_addr?.url_list);
                            if (directLiveUrl) {
                                const ttl = calculateDouyinTTL(directLiveUrl, 3600);
                                cache.set(`douyin:video-stream:${post.aweme_id}:live:${liveIndex}`, directLiveUrl, ttl);
                            }
                            const dynamicLiveEndpoint = origin && post.aweme_id ? `${origin}/douyin/video/${post.aweme_id}/live/${liveIndex}` : directLiveUrl;
                            liveIndex++;

                            if (dynamicLiveEndpoint) {
                                mediaParts.push(`<video data-type="livephoto" controls poster="${imgUrl}">
                        <source src="${dynamicLiveEndpoint}" type="video/mp4">
                    </video>`);
                                continue;
                            }
                        }
                        mediaParts.push(`<img src="${imgUrl}">`);
                    }
                } else if (embedVideo) {
                    // 2. 常规视频作品
                    const bitRates = post.video?.bit_rate || [];
                    let directPlayUrl = '';
                    for (const br of bitRates) {
                        const url = pickPlayableVideoUrl(br.play_addr?.url_list);
                        if (url && (url.includes('-weba.') || !url.includes('-web.'))) {
                            directPlayUrl = url;
                            break;
                        }
                    }
                    if (!directPlayUrl) {
                        const bestUrls = bitRates[0]?.play_addr?.url_list || post.video?.play_addr?.url_list || [];
                        directPlayUrl = pickPlayableVideoUrl(bestUrls);
                    }
                    const videoStreamUrl = origin && post.aweme_id ? `${origin}/douyin/video/${post.aweme_id}/video/0` : directPlayUrl;

                    if (directPlayUrl) {
                        const ttl = calculateDouyinTTL(directPlayUrl, 3600);
                        cache.set(`douyin:video-stream:${post.aweme_id}:video:0`, directPlayUrl, ttl);
                    }

                    if (videoStreamUrl) {
                        mediaParts.push(`<video controls poster="${coverUrl}">
                        <source src="${videoStreamUrl}" type="video/mp4">
                    </video>`);
                    }
                } else if (coverUrl) {
                    mediaParts.push(`<img src="${coverUrl}">`);
                }

                const mediaContent = mediaParts.join('');
                const description = mediaContent ? (descHtml ? `${mediaContent}<br>${descHtml}` : mediaContent) : descHtml;

                return {
                    title: post.desc || '抖音作品更新',
                    description,
                    link: `https://www.douyin.com/video/${post.aweme_id}`,
                    pubDate: parseDate(post.create_time * 1000),
                    category: post.video_tag?.map((t) => t.tag_name) || [],
                };
            });

            return {
                title: `${userNickname} - 抖音作品`,
                description: userDesc,
                image: userAvatar,
                link: pageUrl,
                item: items,
            };
        },
        1800 // 缓存 30 分钟
    );
}

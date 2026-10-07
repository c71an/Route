import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';

import { config } from '@/config';
import cache from '@/utils/cache';
import logger from '@/utils/logger';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

// 模拟真实桌面浏览器的请求头
const getHeaders = (cookie?: string) => ({
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    Host: 'www.xiaohongshu.com',
    Pragma: 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ...(cookie && { Cookie: cookie }),
});

// 从 HTML 中提取小红书 SSR 注入的 __INITIAL_STATE__ 数据
function extractInitialState($: CheerioAPI) {
    let script = $('script:contains("window.__INITIAL_STATE__=")').text();
    if (!script) {
        return null;
    }

    script = script.slice(script.indexOf('window.__INITIAL_STATE__=') + 'window.__INITIAL_STATE__='.length);
    script = script.replaceAll('undefined', 'null').replaceAll(/new Map\(\s*\[\s*\]\s*\)/g, 'null');

    return script;
}

// 纯 HTTP 获取用户主页数据并提取带 xsec_token 的笔记列表
export async function getUserWithCookie(url: string, cookie: string) {
    logger.http(`Requesting XiaoHongShu User Profile: ${url}`);
    const res = await ofetch(url, {
        headers: getHeaders(cookie),
    });

    const $ = load(res);
    const script = extractInitialState($);
    if (!script) {
        throw new Error('无法提取小红书初始状态数据，可能触发了滑块验证码或页面结构变更');
    }

    const state = JSON.parse(script);
    if (!state.user || !state.user.userPageData || !state.user.userPageData.basicInfo) {
        throw new Error('小红书未能正确返回用户数据，请检查 Cookie 是否有效或账号是否异常');
    }

    // 提取主页卡片中的 xsec_token 签名参数，拼接到笔记 ID 后面
    const tokenizedPaths = new Map<string, string>();
    $('#userPostedFeeds a[href*="xsec_token"]').each((_, item) => {
        const href = $(item).attr('href');
        if (!href) {
            return;
        }

        const match = href.match(/\/([0-9a-f]{24})(?:\?|$)/i);
        if (match && href.includes('?')) {
            tokenizedPaths.set(match[1], href);
        }
    });

    if (state.user.notes) {
        for (const item of state.user.notes.flat()) {
            const path = tokenizedPaths.get(item.id);
            if (path) {
                item.id += path.slice(path.indexOf('?'));
            }
        }
    }

    return state.user;
}

// 获取单条笔记全文详情（带组图、长文与视频直链）
export async function getFullNote(link: string, cookie: string, displayLivePhoto: boolean) {
    return await cache.tryGet(
        link,
        async () => {
            logger.http(`Requesting XiaoHongShu Note Detail: ${link}`);
            const res = await ofetch(link, {
                headers: getHeaders(cookie),
            });

            const $ = load(res);
            const script = extractInitialState($);
            if (!script) {
                throw new Error('无法提取小红书笔记详情数据');
            }

            const state = JSON.parse(script);
            const noteData = state.note?.noteDetailMap?.[state.note.firstNoteId]?.note;
            if (!noteData) {
                throw new Error('小红书笔记数据结构为空或笔记已被删除');
            }

            const title = noteData.title || noteData.desc;
            let desc = noteData.desc || '';
            desc = desc.replaceAll(/\[.*?\]/g, '');
            desc = desc.replaceAll(/#(.*?)#/g, '#$1');
            desc = desc.replaceAll('\n', '<br>');
            const pubDate = parseDate(noteData.time, 'x');
            const updated = parseDate(noteData.lastUpdateTime, 'x');

            let mediaContent = '';
            if (noteData.type === 'video') {
                const originVideoKey = noteData.video?.consumer?.originVideoKey;
                const videoUrls: string[] = [];

                if (originVideoKey) {
                    videoUrls.push(`http://sns-video-al.xhscdn.com/${originVideoKey}`);
                }

                const streamTypes = ['av1', 'h264', 'h265', 'h266'];
                for (const type of streamTypes) {
                    const streams = noteData.video?.media?.stream?.[type];
                    if (!streams?.length) {
                        continue;
                    }
                    const stream = streams[0];
                    if (stream.masterUrl) {
                        videoUrls.push(stream.masterUrl);
                    }
                    if (stream.backupUrls?.length) {
                        videoUrls.push(...stream.backupUrls);
                    }
                }

                const posterUrl = noteData.imageList?.[0]?.urlDefault;

                if (videoUrls.length > 0) {
                    mediaContent = `<video controls ${posterUrl ? `poster="${posterUrl}"` : ''}>
                        ${videoUrls.map((videoUrl) => `<source src="${videoUrl}" type="video/mp4">`).join('\n')}
                    </video><br>`;
                }
            } else if (noteData.imageList && noteData.imageList.length > 0) {
                mediaContent = noteData.imageList
                    .map((image) => {
                        if (image.livePhoto && displayLivePhoto) {
                            const videoUrls: string[] = [];
                            const streamTypes = ['av1', 'h264', 'h265', 'h266'];
                            for (const type of streamTypes) {
                                const streams = image.stream?.[type];
                                if (!streams?.length) {
                                    continue;
                                }
                                if (streams[0].masterUrl) {
                                    videoUrls.push(streams[0].masterUrl);
                                }
                                if (streams[0].backupUrls?.length) {
                                    videoUrls.push(...streams[0].backupUrls);
                                }
                            }

                            if (videoUrls.length > 0) {
                                return `<video controls poster="${image.urlDefault}">
                                    ${videoUrls.map((videoUrl) => `<source src="${videoUrl}" type="video/mp4">`).join('\n')}
                                </video>`;
                            }
                        }
                        return `<img src="${image.urlDefault}">`;
                    })
                    .join('<br>');
            }

            const description = `${mediaContent ? `${mediaContent}<br>` : ''}${desc}`;
            return {
                title,
                description,
                pubDate,
                updated,
            };
        },
        config.cache.contentExpire
    );
}

// 批量渲染博主笔记全文
export async function renderNotesFulltext(notes: any[], urlPrefix: string, cookie: string, displayLivePhoto: boolean) {
    const data: Array<{
        title: string;
        link: string;
        description: string;
        author: string;
        guid: string;
        pubDate?: Date;
        updated?: Date;
    }> = [];

    const promises = notes.flatMap((noteGroup) =>
        noteGroup.map(async ({ noteCard, id }) => {
            const link = `${urlPrefix}/${id}`;
            const guid = `${urlPrefix}/${noteCard.noteId}`;
            try {
                const { title, description, pubDate, updated } = await getFullNote(link, cookie, displayLivePhoto);
                return {
                    title,
                    link,
                    description,
                    author: noteCard.user?.nickName || noteCard.user?.nickname,
                    guid,
                    pubDate,
                    updated,
                };
            } catch (err: any) {
                // 如果单条详情抓取失败，降级展示封面图和简短标题，确保不打断整个 Feed
                logger.warn(`Failed to fetch full note for ${link}: ${err.message}`);
                const coverUrl = noteCard.cover?.infoList?.pop()?.url || '';
                return {
                    title: noteCard.displayTitle,
                    link,
                    description: coverUrl ? `<img src="${coverUrl}"><br>${noteCard.displayTitle}` : noteCard.displayTitle,
                    author: noteCard.user?.nickName || noteCard.user?.nickname,
                    guid,
                };
            }
        })
    );

    data.push(...(await Promise.all(promises)));
    return data;
}

import fs from 'node:fs';
import path from 'node:path';

import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';

import { config } from '@/config';
import cache from '@/utils/cache';
import logger from '@/utils/logger';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const cookieCache = new Map<string, { mtime: number; content: string }>();

/**
 * 动态加载 Cookie：优先检查挂载的 cookies/<service>.txt 文件（支持修改后免重启即刻生效），不存在时回退到环境变量
 */
export function getDynamicCookie(service: string, envVarName: string, configCookie?: string): string {
    const filePath = path.resolve(process.cwd(), 'cookies', `${service}.txt`);
    try {
        if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const cached = cookieCache.get(filePath);
            if (cached && cached.mtime === stat.mtimeMs) {
                return cached.content;
            }
            const content = fs.readFileSync(filePath, 'utf-8').trim();
            cookieCache.set(filePath, { mtime: stat.mtimeMs, content });
            if (content) {
                return content;
            }
        }
    } catch (_) {}

    return (configCookie || process.env[envVarName] || '').trim();
}

export function getXiaohongshuCookie(): string {
    return getDynamicCookie('xiaohongshu', 'XIAOHONGSHU_COOKIE', config.xiaohongshu?.cookie);
}

// 随机休眠辅助函数，模拟人类浏览停顿
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 全局请求节流队列：防止容器重启缓存清空后，多博主路由高并发直接打崩小红书风控
let lastRequestTime = 0;
let requestQueue = Promise.resolve();

export async function rateLimitedRequest<T>(fn: () => Promise<T>, minIntervalMs = 1500): Promise<T> {
    const execute = async () => {
        const now = Date.now();
        const timeSinceLast = now - lastRequestTime;
        if (timeSinceLast < minIntervalMs) {
            const waitTime = minIntervalMs - timeSinceLast + Math.floor(Math.random() * 500);
            await sleep(waitTime);
        }
        try {
            return await fn();
        } finally {
            lastRequestTime = Date.now();
        }
    };

    const current = requestQueue.then(execute, execute);
    requestQueue = current.then(() => {}, () => {});
    return current;
}

// 用户浏览器环境真实模拟（与生成 Cookie 的浏览器保持严格一致）
const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

const getHeaders = (cookie?: string, referer?: string) => ({
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'zh-CN, zh;q=0.9, en-US;q=0.8, en;q=0.7',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    Dnt: '1',
    Host: 'www.xiaohongshu.com',
    Pragma: 'no-cache',
    Priority: 'u=0, i',
    'Sec-Ch-Ua': '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': UA_CHROME,
    ...(referer && { Referer: referer }),
    ...(cookie && { Cookie: cookie }),
});

// 规范化小红书图片直链：将带有时间戳与临时鉴权 Token 的动态 CDN 链接转换为永久有效的免鉴权静态链接
export function normalizeXiaohongshuImageUrl(url?: string): string {
    if (!url) {
        return '';
    }
    // 剥离时间戳及 MD5 鉴权路径并升级为永久 CDN 域名
    const tokenMatch = url.match(/^https?:\/\/([^/]+)\/\d{10,14}\/[0-9a-fA-F]{32}\/(.+)$/i);
    if (tokenMatch) {
        const [, host, restPath] = tokenMatch;
        const vendorMatch = host.match(/^sns-webpic-([a-zA-Z0-9]+)\.xhscdn\.com$/i);
        if (vendorMatch) {
            return `https://sns-img-${vendorMatch[1]}.xhscdn.com/${restPath}`;
        }
        if (/^sns-webpic\.xhscdn\.com$/i.test(host) || /xiaohongshu\.com$/i.test(host)) {
            return `https://ci.xiaohongshu.com/${restPath}`;
        }
        return `https://${host.replace(/^sns-webpic-/, 'sns-img-')}/${restPath}`;
    }
    const vendorMatch = url.match(/^https?:\/\/sns-webpic-([a-zA-Z0-9]+)\.xhscdn\.com\/(.+)$/i);
    if (vendorMatch) {
        return `https://sns-img-${vendorMatch[1]}.xhscdn.com/${vendorMatch[2]}`;
    }
    return url;
}

// 从 HTML 中提取小红书 SSR 注入的 __INITIAL_STATE__ 数据
function extractInitialState($: CheerioAPI) {
    let script = $('script:contains("window.__INITIAL_STATE__=")').text();
    if (!script) {
        return null;
    }

    script = script.slice(script.indexOf('window.__INITIAL_STATE__=') + 'window.__INITIAL_STATE__='.length);
    // 处理小红书前端注入的非标准 JSON 构造器与关键字
    script = script
        .replaceAll('undefined', 'null')
        .replaceAll(/new Map\(\s*\[[\s\S]*?\]\s*\)/g, 'null')
        .replaceAll(/new Set\(\s*\[[\s\S]*?\]\s*\)/g, '[]')
        .replaceAll(/new Set\(\s*\)/g, '[]')
        .replaceAll(/new Map\(\s*\)/g, 'null');

    return script;
}

// 纯 HTTP 获取用户主页数据并提取带 xsec_token 的笔记列表
export async function getUserWithCookie(url: string, cookie: string) {
    logger.http(`Requesting XiaoHongShu User Profile: ${url}`);
    const res = await rateLimitedRequest(() =>
        ofetch(url, {
            headers: getHeaders(cookie),
        })
    );

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
            let finalHref = href;
            if (!finalHref.includes('xsec_source=')) {
                finalHref += '&xsec_source=pc_user';
            }
            tokenizedPaths.set(match[1], finalHref);
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

// 提取小红书视频链接中的 16 进制时间戳 t 参数，计算出精确的剩余有效期（秒）
export function calculateXhsTTL(url?: string, defaultTTL = 604800): number {
    if (!url) {
        return defaultTTL;
    }
    try {
        const urlObj = new URL(url);
        const tHex = urlObj.searchParams.get('t');
        if (tHex) {
            const expireTimestamp = parseInt(tHex, 16);
            const now = Math.floor(Date.now() / 1000);
            const remaining = expireTimestamp - now;
            // 预留 5 分钟安全缓冲，防止边界误差
            const safeTTL = remaining - 300;
            if (safeTTL > 60) {
                return safeTTL;
            }
        }
    } catch (_) {}
    return defaultTTL;
}

export interface NoteMediaStreams {
    mainVideo?: string;
    mainVideoBackups: string[];
    livePhotos: string[];
    posterUrl?: string;
}

export function extractNoteMedia(noteData: any): NoteMediaStreams {
    const result: NoteMediaStreams = {
        mainVideoBackups: [],
        livePhotos: [],
    };

    if (noteData.type === 'video') {
        const originVideoKey = noteData.video?.consumer?.originVideoKey;
        if (originVideoKey) {
            result.mainVideoBackups.push(`http://sns-video-al.xhscdn.com/${originVideoKey}`);
        }

        const streamTypes = ['h264', 'av1', 'h265', 'h266'];
        for (const type of streamTypes) {
            const streams = noteData.video?.media?.stream?.[type];
            if (!streams?.length) {
                continue;
            }
            const stream = streams[0];
            if (stream.masterUrl && !result.mainVideo) {
                result.mainVideo = stream.masterUrl;
            }
            if (stream.backupUrls?.length) {
                result.mainVideoBackups.push(...stream.backupUrls);
            }
        }

        const rawPosterUrl = noteData.imageList?.[0]?.urlDefault || noteData.imageList?.[0]?.url || noteData.imageList?.[0]?.infoList?.[0]?.url;
        result.posterUrl = normalizeXiaohongshuImageUrl(rawPosterUrl);
    } else if (noteData.imageList && noteData.imageList.length > 0) {
        for (const image of noteData.imageList) {
            if (image.livePhoto) {
                const streamTypes = ['h264', 'av1', 'h265', 'h266'];
                let liveUrl = '';
                for (const type of streamTypes) {
                    const streams = image.stream?.[type];
                    if (!streams?.length) {
                        continue;
                    }
                    if (streams[0].masterUrl) {
                        liveUrl = streams[0].masterUrl;
                        break;
                    }
                }
                result.livePhotos.push(liveUrl);
            }
        }
    }

    return result;
}

// 记录正在进行中的单篇笔记抓取 Promise，防止高并发下重复回源击穿小红书
const inFlightNoteRequests = new Map<string, Promise<any>>();

// 单篇笔记原始详情拉取与解析（内置 Singleflight 防并发重复拉取机制）
export function fetchNoteDetail(noteIdOrLink: string, cookie: string, profileUrl?: string): Promise<any> {
    const cleanId = noteIdOrLink.match(/([0-9a-f]{24})/i)?.[1] || noteIdOrLink;

    if (inFlightNoteRequests.has(cleanId)) {
        logger.http(`XiaoHongShu Note Detail deduplicated for cleanId: ${cleanId}`);
        return inFlightNoteRequests.get(cleanId)!;
    }

    const promise = (async () => {
        const link = noteIdOrLink.startsWith('http') ? noteIdOrLink : `https://www.xiaohongshu.com/explore/${cleanId}`;
        logger.http(`Requesting XiaoHongShu Note Detail: ${link}`);
        const res = await rateLimitedRequest(() =>
            ofetch(link, {
                headers: getHeaders(cookie, profileUrl),
            })
        );

        const $ = load(res);
        const script = extractInitialState($);
        if (!script) {
            throw new Error('无法提取小红书笔记详情数据，可能触发了滑块验证码或页面结构变更');
        }

        const state = JSON.parse(script);
        const noteData = state.note?.noteDetailMap?.[state.note.firstNoteId]?.note;
        if (!noteData) {
            throw new Error('小红书笔记数据结构为空或笔记已被删除');
        }

        return noteData;
    })().finally(() => {
        inFlightNoteRequests.delete(cleanId);
    });

    inFlightNoteRequests.set(cleanId, promise);
    return promise;
}

// 获取单条笔记全文详情（带组图、长文与视频直链）
export async function getFullNote(link: string, profileUrl: string, cookie: string, displayLivePhoto: boolean, origin?: string) {
    const cached = await cache.get(link);
    if (cached) {
        return cached;
    }

    const noteData = await fetchNoteDetail(link, cookie, profileUrl);
    const cleanNoteId = link.match(/([0-9a-f]{24})/i)?.[1] || '';

    const title = noteData.title || noteData.desc;
    let desc = noteData.desc || '';
    desc = desc.replaceAll(/\[.*?\]/g, '');
    desc = desc.replaceAll(/#(.*?)#/g, '#$1');
    desc = desc.replaceAll('\n', '<br>');
    const pubDate = parseDate(noteData.time, 'x');
    const updated = parseDate(noteData.lastUpdateTime, 'x');

    const media = extractNoteMedia(noteData);
    let mediaContent = '';
    const collectedVideoUrls: string[] = [];

    if (noteData.type === 'video') {
        const dynamicVideoEndpoint = origin && cleanNoteId ? `${origin}/xiaohongshu/video/${cleanNoteId}/video/0` : '';
        const posterAttr = media.posterUrl ? `poster="${media.posterUrl}"` : '';

        // 如果配置了 origin，优先使用永不过期的 302 动态端点，并将当前真实有效流与备用链接存入缓存
        if (media.mainVideo) {
            collectedVideoUrls.push(media.mainVideo);
            if (cleanNoteId) {
                const ttl = calculateXhsTTL(media.mainVideo, 3600 * 24);
                await cache.set(`xiaohongshu:video-stream:${cleanNoteId}:video:0`, media.mainVideo, ttl);
            }
        }

        const sourceElements: string[] = [];
        if (dynamicVideoEndpoint) {
            sourceElements.push(`<source src="${dynamicVideoEndpoint}" type="video/mp4">`);
        } else if (media.mainVideo) {
            sourceElements.push(`<source src="${media.mainVideo}" type="video/mp4">`);
        }
        for (const backup of media.mainVideoBackups) {
            sourceElements.push(`<source src="${backup}" type="video/mp4">`);
        }

        if (sourceElements.length > 0) {
            mediaContent = `<video controls ${posterAttr}>\n${sourceElements.join('\n')}\n</video>`;
        }
    } else if (noteData.imageList && noteData.imageList.length > 0) {
        let liveIndex = 0;
        const mediaParts: string[] = [];
        for (const image of noteData.imageList) {
            const imgUrl = normalizeXiaohongshuImageUrl(image.urlDefault || image.url || image.infoList?.[0]?.url);
            if (image.livePhoto && displayLivePhoto) {
                const liveUrl = media.livePhotos[liveIndex] || '';
                if (liveUrl) {
                    collectedVideoUrls.push(liveUrl);
                    if (cleanNoteId) {
                        const ttl = calculateXhsTTL(liveUrl, 3600 * 24);
                        await cache.set(`xiaohongshu:video-stream:${cleanNoteId}:live:${liveIndex}`, liveUrl, ttl);
                    }
                }

                const dynamicLiveEndpoint = origin && cleanNoteId ? `${origin}/xiaohongshu/video/${cleanNoteId}/live/${liveIndex}` : liveUrl;
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
        mediaContent = mediaParts.join('');
    }

    const description = mediaContent ? (desc ? `${mediaContent}<br>${desc}` : mediaContent) : desc;
    const result = {
        title,
        description,
        pubDate,
        updated,
    };

    // 动态计算整篇笔记的缓存时间：根据所有视频 URL 中最早过期的 t 参数决定
    let dynamicNoteTTL = 604800; // 纯图文笔记默认 7 天
    for (const vUrl of collectedVideoUrls) {
        const ttl = calculateXhsTTL(vUrl, 604800);
        if (ttl < dynamicNoteTTL) {
            dynamicNoteTTL = ttl;
        }
    }

    await cache.set(link, result, dynamicNoteTTL);
    return result;
}

// 从 24 位小红书笔记 ID 提取秒级发布时间戳（ObjectId 前 8 位为 Hex 时间戳）
export function getNoteTimestamp(note: any): number {
    const rawId = note?.noteCard?.noteId || note?.id || '';
    const match = rawId.match(/([0-9a-f]{24})/i);
    if (match) {
        const hex = match[1].slice(0, 8);
        const timestamp = parseInt(hex, 16);
        if (!isNaN(timestamp) && timestamp > 0) {
            return timestamp;
        }
    }
    return 0;
}

// 批量渲染博主笔记全文（仅抓取并输出最新的前 3 篇全文，其余笔记全部过滤不展示）
export async function renderNotesFulltext(notes: any[], urlPrefix: string, profileUrl: string, cookie: string, displayLivePhoto: boolean, origin?: string) {
    const data: Array<{
        title: string;
        link: string;
        description: string;
        author: string;
        guid: string;
        pubDate?: Date;
        updated?: Date;
    }> = [];

    // 1. 先按底层 ObjectId 真实发布时间戳进行绝对倒序（置顶的陈年老笔记会被自然排到后面）
    const sortedNotes = [...notes.flat()].sort((a, b) => getNoteTimestamp(b) - getNoteTimestamp(a));

    // 2. 严格截取时间真正最新的前 3 篇笔记：仅抓取这 3 篇全文，其余所有历史笔记全部丢弃不输出到 Feed
    const allNotes = sortedNotes.slice(0, 3);

    // 3. 采用串行处理 + 随机拟真延迟（1500ms ~ 3000ms），平滑突发流量
    for (let i = 0; i < allNotes.length; i++) {
        const { noteCard, id } = allNotes[i];
        const link = `${urlPrefix}/${id}`;
        const guid = `${urlPrefix}/${noteCard.noteId}`;

        // 仅当缓存未命中（即真正需要发起网络请求）时才加入人类浏览间隔延迟，命中缓存则瞬间返回
        const isCached = await cache.get(link);
        if (!isCached && i > 0) {
            const jitterMs = 1500 + Math.floor(Math.random() * 1500);
            await sleep(jitterMs);
        }

        try {
            const { title, description, pubDate, updated } = await getFullNote(link, profileUrl, cookie, displayLivePhoto, origin);
            data.push({
                title,
                link,
                description,
                author: noteCard.user?.nickName || noteCard.user?.nickname,
                guid,
                pubDate,
                updated,
            });
        } catch (err: any) {
            // 单篇风控或失效时平滑降级展示封面大图，不打断整个 Feed
            logger.warn(`Failed to fetch full note for ${link}: ${err.message}`);
            const rawCoverUrl = noteCard.cover?.infoList?.pop()?.url || noteCard.cover?.urlDefault || '';
            const coverUrl = normalizeXiaohongshuImageUrl(rawCoverUrl);
            data.push({
                title: noteCard.displayTitle,
                link,
                description: coverUrl ? `<img src="${coverUrl}"><br>${noteCard.displayTitle}` : noteCard.displayTitle,
                author: noteCard.user?.nickName || noteCard.user?.nickname,
                guid,
            });
        }
    }

    return data;
}

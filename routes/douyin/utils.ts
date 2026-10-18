import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { config } from '@/config';
import logger from '@/utils/logger';
import ofetch from '@/utils/ofetch';
import { sign as signABogus } from './abogus';
import type { PostData } from './types';

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

export function getDouyinCookie(): string {
    return getDynamicCookie('douyin', 'DOUYIN_COOKIE', config.douyin?.cookie);
}

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

// 字节跳动火山引擎 ArgusSecurityPlugin / webSign 策略盐值
const ARGUS_SALT = 'A96D855A08C0A9707F8BEF0D9A527E4E';

export const getOriginAvatar = (url?: string): string => {
    if (!url) {
        return '';
    }
    return url
        .replace(/^(.*\.douyinpic\.com\/).*(\/aweme-avatar\/)([^?]*)(\?.*)?$/, '$1origin$2$3')
        .replaceAll(/~\w+_\d+x\d+/g, '');
};

/**
 * 筛选真正可播放的 CDN 视频直链
 * 策略优先级：
 * 1. 过滤掉必须登录态的 /aweme/v1/play/ 伪链接
 * 2. 核心优先：优先选择带有 -weba. 等免 Referer 防盗链校验的开放 CDN 节点（如 v11-weba.douyinvod.com）
 * 3. 次优选择：避开已知严格校验 Referer 的 -web.douyinvod.com 节点
 * 4. 兜底返回有效 CDN 直链
 */
export function pickPlayableVideoUrl(urlList?: string[]): string {
    if (!urlList || urlList.length === 0) {
        return '';
    }
    const cdnUrls = urlList.filter((u) => !u.includes('/aweme/v1/play/'));
    if (cdnUrls.length === 0) {
        return urlList[0] || '';
    }
    // 优先匹配免防盗链的 weba / webb 开放节点
    const openCdn = cdnUrls.find((u) => u.includes('-weba.') || u.includes('-webb.') || u.includes('weba.douyinvod.com'));
    if (openCdn) {
        return openCdn;
    }
    // 避开严格校验 Referer 的 -web.douyinvod.com 节点
    const nonStrict = cdnUrls.find((u) => !u.includes('-web.'));
    if (nonStrict) {
        return nonStrict;
    }
    return cdnUrls[0];
}

export const formatDuration = (ms?: number): string => {
    if (!ms) {
        return '';
    }
    const seconds = Math.floor(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

/**
 * 从抖音视频/媒体链接中动态提取有效秒数，自适应计算缓存 TTL
 */
export function calculateDouyinTTL(url?: string, defaultTTL = 3600): number {
    if (!url) {
        return defaultTTL;
    }
    try {
        // 1. 优先匹配抖音视频 CDN 路径中的 8 位 Hex 时间戳 (例如 /6ad2fba5/video/tos/)
        const hexMatch = url.match(/\/([0-9a-f]{8})\/video\/tos\//i);
        if (hexMatch) {
            const expireTimestamp = parseInt(hexMatch[1], 16);
            const remaining = expireTimestamp - Math.floor(Date.now() / 1000);
            const safeTTL = remaining - 300; // 预留 5 分钟安全缓冲
            if (safeTTL > 60) {
                return safeTTL;
            }
        }

        // 2. 匹配 Query 参数中的十进制时间戳 (expire 或 x-expires)
        const urlObj = new URL(url);
        const expireStr = urlObj.searchParams.get('x-expires') || urlObj.searchParams.get('expire');
        if (expireStr) {
            const expireTimestamp = parseInt(expireStr, 10);
            const remaining = expireTimestamp - Math.floor(Date.now() / 1000);
            const safeTTL = remaining - 300;
            if (safeTTL > 60) {
                return safeTTL;
            }
        }
    } catch (_) {}
    return defaultTTL;
}

/**
 * 从 Cookie 字符串中自动提取关键风控指纹
 */
function extractCookieFingerprints(cookie: string) {
    const uifidMatch = cookie.match(/(?:^|;\s*)(?:UIFID|uifid|UIFID_TEMP|uifid_temp)=([^;]+)/i);
    const uifid = uifidMatch ? uifidMatch[1].trim() : '';

    const fpMatch = cookie.match(/(?:^|;\s*)s_v_web_id=([^;]+)/i);
    const fp = fpMatch ? fpMatch[1].trim() : '';

    return { uifid, fp };
}

/**
 * 纯 HTTP 方式获取抖音博主最新作品列表（突破 ArgusSecurityPlugin 双重签名机制）
 */
export async function fetchUserAweme(secUid: string, cookie: string): Promise<PostData> {
    logger.http(`Requesting Douyin User Aweme List for sec_uid: ${secUid}`);

    const { uifid, fp } = extractCookieFingerprints(cookie);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const baseParams: Record<string, string> = {
        device_platform: 'webapp',
        aid: '6383',
        channel: 'channel_pc_web',
        sec_user_id: secUid,
        max_cursor: '0',
        count: '15',
        publish_video_strategy_type: '2',
        update_version_code: '170400',
        pc_client_type: '1',
        version_code: '170400',
        version_name: '17.4.0',
        cookie_enabled: 'true',
        screen_width: '1920',
        screen_height: '1080',
        browser_language: 'zh-CN',
        browser_platform: 'Win32',
        browser_name: 'Chrome',
        browser_version: '155.0.0.0',
        browser_online: 'true',
        engine_name: 'Blink',
        engine_version: '155.0.0.0',
        os_name: 'Windows',
        os_version: '10',
        cpu_core_num: '12',
        device_memory: '16',
        platform: 'PC',
        downlink: '10',
        effective_type: '4g',
        round_trip_time: '50',
    };

    if (uifid) {
        baseParams.uifid = uifid;
    }
    if (fp) {
        baseParams.fp = fp;
        baseParams.verifyFp = fp;
    }

    // 1. 计算第一层签名 a_bogus
    const baseQuery = new URLSearchParams(baseParams).toString();
    const aBogus = signABogus(baseQuery, UA);

    // 2. 组装并计算第二层火山引擎 ArgusSecurityPlugin 专属签名 x-secsdk-web-signature
    const fullParams = new URLSearchParams(baseQuery);
    fullParams.set('a_bogus', aBogus);
    fullParams.set('timestamp', timestamp);

    const queryToHash = fullParams.toString();
    const hashPreimage = `${uifid}_${timestamp}_${ARGUS_SALT}_${queryToHash}`;
    const webSignature = crypto.createHash('md5').update(hashPreimage).digest('hex');

    fullParams.set('x-secsdk-web-signature', webSignature);

    const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/post/?${fullParams.toString()}`;

    const headers: Record<string, string> = {
        'User-Agent': UA,
        Referer: `https://www.douyin.com/user/${secUid}`,
        Cookie: cookie,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Sec-Ch-Ua': '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    };

    if (uifid) {
        headers.uifid = uifid;
        headers['x-secsdk-web-signature'] = webSignature;
        headers['x-secsdk-web-expire'] = timestamp;
    }

    const res = (await ofetch(apiUrl, { headers })) as PostData;

    if (res.status_code !== 0) {
        throw new Error(`抖音接口响应异常: status_code=${res.status_code}`);
    }

    return res;
}

// 记录正在进行中的单条视频详情请求 Promise，防止高并发（例如多张实况图同时请求）重复回源击穿抖音
const inFlightAwemeRequests = new Map<string, Promise<any>>();

/**
 * 纯 HTTP 获取单条视频详情（内置 Singleflight 防并发重复拉取机制，用于 302 视频重定向播放端点）
 */
export function fetchAwemeDetail(awemeId: string, cookie: string): Promise<any> {
    if (inFlightAwemeRequests.has(awemeId)) {
        logger.http(`Douyin Aweme Detail deduplicated for aweme_id: ${awemeId}`);
        return inFlightAwemeRequests.get(awemeId)!;
    }

    const promise = (async () => {
        logger.http(`Requesting Douyin Aweme Detail for aweme_id: ${awemeId}`);

        const { uifid, fp } = extractCookieFingerprints(cookie);
        const timestamp = Math.floor(Date.now() / 1000).toString();

        const detailParams: Record<string, string> = {
            device_platform: 'webapp',
            aid: '6383',
            channel: 'channel_pc_web',
            aweme_id: awemeId,
            update_version_code: '170400',
            pc_client_type: '1',
        };

        if (uifid) {
            detailParams.uifid = uifid;
        }
        if (fp) {
            detailParams.fp = fp;
            detailParams.verifyFp = fp;
        }

        const baseQuery = new URLSearchParams(detailParams).toString();
        const aBogus = signABogus(baseQuery, UA);

        const fullParams = new URLSearchParams(baseQuery);
        fullParams.set('a_bogus', aBogus);
        fullParams.set('timestamp', timestamp);

        const queryToHash = fullParams.toString();
        const hashPreimage = `${uifid}_${timestamp}_${ARGUS_SALT}_${queryToHash}`;
        const webSignature = crypto.createHash('md5').update(hashPreimage).digest('hex');

        fullParams.set('x-secsdk-web-signature', webSignature);

        const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?${fullParams.toString()}`;

        const headers: Record<string, string> = {
            'User-Agent': UA,
            Referer: `https://www.douyin.com/video/${awemeId}`,
            Cookie: cookie,
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            'Sec-Ch-Ua': '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
        };

        if (uifid) {
            headers.uifid = uifid;
            headers['x-secsdk-web-signature'] = webSignature;
            headers['x-secsdk-web-expire'] = timestamp;
        }

        const res = (await ofetch(apiUrl, { headers })) as any;

        if (res.status_code !== 0 || !res.aweme_detail) {
            throw new Error(`获取视频详情失败: status_code=${res.status_code}`);
        }

        return res.aweme_detail;
    })().finally(() => {
        inFlightAwemeRequests.delete(awemeId);
    });

    inFlightAwemeRequests.set(awemeId, promise);
    return promise;
}


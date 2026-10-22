import { getBrowserFingerprint, getDynamicCookie } from './fingerprint';

export interface HeaderOptions {
    service?: 'xiaohongshu' | 'douyin' | string;
    cookie?: string;
    referer?: string;
    origin?: string;
    mode?: 'document' | 'json';
    extraHeaders?: Record<string, string>;
}

/**
 * 组装符合当前 Chrome 真实环境的标准请求头
 */
export function createHeaders(options: HeaderOptions = {}): Record<string, string> {
    const fp = getBrowserFingerprint(options.service);
    const cookie = options.cookie || (options.service ? getDynamicCookie(options.service) : '');
    const isJson = options.mode === 'json';

    return {
        'User-Agent': fp.ua,
        'Sec-Ch-Ua': fp.secChUa,
        'Sec-Ch-Ua-Mobile': fp.mobile,
        'Sec-Ch-Ua-Platform': fp.platform,
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        Dnt: '1',
        Priority: 'u=1, i',
        ...(isJson
            ? {
                  Accept: 'application/json, text/plain, */*',
                  'Sec-Fetch-Dest': 'empty',
                  'Sec-Fetch-Mode': 'cors',
                  'Sec-Fetch-Site': 'same-origin',
              }
            : {
                  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                  'Sec-Fetch-Dest': 'document',
                  'Sec-Fetch-Mode': 'navigate',
                  'Sec-Fetch-Site': options.referer ? 'same-origin' : 'none',
                  'Sec-Fetch-User': '?1',
                  'Upgrade-Insecure-Requests': '1',
              }),
        ...(options.referer && { Referer: options.referer }),
        ...(options.origin && { Origin: options.origin }),
        ...(cookie && { Cookie: cookie }),
        ...options.extraHeaders,
    };
}

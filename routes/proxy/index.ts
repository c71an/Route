import type { Route } from '@/types';

export const route: Route = {
    path: '/',
    name: '图片代理',
    url: 'https://weibo.com',
    categories: ['social-media'],
    example: '/proxy?url=https%3A%2F%2Fwx1.sinaimg.cn%2Flarge%2F001ySj3ngy1h6y0z6z4d8j60u011i40c02.jpg',
    maintainers: ['c71an'],
    handler,
    description: '内部图片反代服务，自动根据图片来源域名匹配合法 Referer 绕过防盗链，并设置强缓存。',
};

// 来源域名 -> 合法 Referer 映射规则（后续可在此处按需添加其他平台）
interface RefererRule {
    pattern: RegExp;
    referer: string;
}

const REFERER_RULES: RefererRule[] = [
    // 微博 / 新浪图床
    { pattern: /(?:sinaimg\.cn|weibo\.cn|weibocdn\.com)$/i, referer: 'https://weibo.com/' },
    // 小红书图床
    { pattern: /(?:xhscdn\.com|xiaohongshu\.com)$/i, referer: 'https://www.xiaohongshu.com/' },
    // 后续如有其它平台，直接在此追加，例如：
    // { pattern: /zhimg\.com$/i, referer: 'https://www.zhihu.com/' },
    // { pattern: /hdslb\.com$/i, referer: 'https://www.bilibili.com/' },
];

function getRefererForUrl(targetUrl: string): string | undefined {
    try {
        const { hostname } = new URL(targetUrl);
        const matched = REFERER_RULES.find((rule) => rule.pattern.test(hostname));
        return matched ? matched.referer : undefined;
    } catch {
        return undefined;
    }
}

function getCandidateUrls(url: string): string[] {
    const candidates: string[] = [];

    // 处理小红书带时间戳鉴权 token 的临时链接
    // 例如: http://sns-webpic-qc.xhscdn.com/202610081146/acdc8493c5f7e534028a454e231c6737/notes_uhdr/1040g3qo325sss0l6ke7040q1p5t79e1fk8nlgag!nd_dft_wlteh_webp_3
    const xhsTokenMatch = url.match(/^https?:\/\/([^/]+)\/\d{10,14}\/[0-9a-fA-F]{32}\/(.+)$/i);
    if (xhsTokenMatch) {
        const [, host, restPath] = xhsTokenMatch;
        const vendorMatch = host.match(/^sns-webpic-([a-zA-Z0-9]+)\.xhscdn\.com$/i);
        if (vendorMatch) {
            candidates.push(`https://sns-img-${vendorMatch[1]}.xhscdn.com/${restPath}`);
        }
        candidates.push(`https://ci.xiaohongshu.com/${restPath}`);
    } else {
        const vendorMatch = url.match(/^https?:\/\/sns-webpic-([a-zA-Z0-9]+)\.xhscdn\.com\/(.+)$/i);
        if (vendorMatch) {
            candidates.push(`https://sns-img-${vendorMatch[1]}.xhscdn.com/${vendorMatch[2]}`);
            candidates.push(`https://ci.xiaohongshu.com/${vendorMatch[2]}`);
        }
    }

    if (!candidates.includes(url)) {
        candidates.push(url);
    }
    return candidates;
}

async function handler(ctx) {
    const targetUrl = ctx.req.query('url');

    if (!targetUrl) {
        return new Response('Missing "url" query parameter', {
            status: 400,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    try {
        const candidateUrls = getCandidateUrls(targetUrl);
        let upstreamResponse: Response | null = null;

        for (const currentUrl of candidateUrls) {
            const matchedReferer = getRefererForUrl(currentUrl);

            const headers: Record<string, string> = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            };
            if (matchedReferer) {
                headers.Referer = matchedReferer;
            }

            try {
                const res = await fetch(currentUrl, { headers });
                if (res.ok) {
                    upstreamResponse = res;
                    break;
                }
                upstreamResponse = res;
            } catch {
                // 网络或解析异常时继续尝试下一个候选地址
            }
        }

        if (!upstreamResponse || !upstreamResponse.ok) {
            const status = upstreamResponse?.status || 502;
            return new Response(`Upstream fetch failed with status: ${status}`, {
                status,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        }

        const contentType = upstreamResponse.headers.get('content-type') || 'image/jpeg';
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', contentType);
        // 设置 30 天强缓存，减少重复请求
        responseHeaders.set('Cache-Control', 'public, max-age=2592000, immutable');

        const contentLength = upstreamResponse.headers.get('content-length');
        if (contentLength) {
            responseHeaders.set('Content-Length', contentLength);
        }

        return new Response(upstreamResponse.body, {
            status: 200,
            headers: responseHeaders,
        });
    } catch (err: any) {
        return new Response(`Proxy error: ${err.message || 'unknown error'}`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }
}

import fs from 'node:fs';
import path from 'node:path';

const fileCache = new Map<string, { mtime: number; content: string }>();

// 默认兜底 User-Agent（当前主流稳定版 Chrome 156）
export const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

/**
 * 清理与提取 UA 字符串（支持直接提取 DevTools 复制的原始抓包文本或带引号的字符串）
 */
export function cleanUaString(raw: string): string {
    if (!raw) {
        return '';
    }
    const trimmed = raw.trim();

    // 优先匹配标准 Mozilla/5.0 开始的 UA 字符串
    const mozillaMatch = trimmed.match(/Mozilla\/5\.0[^\r\n"']+/i);
    if (mozillaMatch) {
        return mozillaMatch[0].trim();
    }

    // 匹配 DevTools "user-agent\n..." 格式
    const devToolsMatch = trimmed.match(/(?:user-agent|User-Agent)\s*[\r\n]+\s*([^\r\n]+)/i);
    if (devToolsMatch) {
        return devToolsMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    // 兜底去除首尾引号
    return trimmed.replace(/^['"]|['"]$/g, '');
}

/**
 * 动态加载文本文件（基于 mtime 自动热加载，无需重启 Node 进程）
 */
export function getDynamicFile(fileName: string, fallback = ''): string {
    const filePath = path.resolve(process.cwd(), 'cookies', fileName);
    try {
        if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const cached = fileCache.get(filePath);
            if (cached && cached.mtime === stat.mtimeMs) {
                return cached.content;
            }
            const content = fs.readFileSync(filePath, 'utf-8').trim();
            fileCache.set(filePath, { mtime: stat.mtimeMs, content });
            if (content) {
                return content;
            }
        }
    } catch (_) {}

    return fallback;
}

/**
 * 获取服务动态 Cookie：优先检查挂载的 cookies/<service>.txt 文件，不存在时回退到环境变量
 */
export function getDynamicCookie(service: string, envVarName?: string, configCookie?: string): string {
    const fileContent = getDynamicFile(`${service}.txt`);
    if (fileContent) {
        return fileContent;
    }
    return (configCookie || (envVarName ? process.env[envVarName] : '') || '').trim();
}

export interface BrowserFingerprint {
    ua: string;
    majorVersion: string;
    fullVersion: string;
    secChUa: string;
    platform: string;
    mobile: string;
}

/**
 * 获取当前真实浏览器指纹（优先读取 cookies/ua.txt 或 cookies/<service>_ua.txt）
 */
export function getBrowserFingerprint(service?: string): BrowserFingerprint {
    const rawUa = (service ? getDynamicFile(`${service}_ua.txt`) : '') || getDynamicFile('ua.txt', DEFAULT_UA);
    const ua = cleanUaString(rawUa) || DEFAULT_UA;

    // 动态提取 Chrome 主版本号与全版本号
    const match = ua.match(/Chrome\/(\d+)(?:\.([\d.]+))?/i);
    const majorVersion = match ? match[1] : '156';
    const fullVersion = match ? (match[2] ? `${match[1]}.${match[2]}` : `${match[1]}.0.0.0`) : '156.0.0.0';

    return {
        ua,
        majorVersion,
        fullVersion,
        // 与最新 Chrome 156 严格对齐的标准 Client Hints 格式
        secChUa: `"Not:A-Brand";v="8", "Chromium";v="${majorVersion}", "Google Chrome";v="${majorVersion}"`,
        platform: '"Windows"',
        mobile: '?0',
    };
}

/**
 * 保存并更新 User-Agent 到 cookies/ua.txt，直接刷新热生效缓存
 */
export function updateUserAgent(newUa: string): BrowserFingerprint {
    const cleaned = cleanUaString(newUa);
    if (!cleaned) {
        throw new Error('User-Agent 不能为空！');
    }
    if (!cleaned.includes('Mozilla/') && !cleaned.includes('Chrome/')) {
        throw new Error('输入的 User-Agent 格式无效，必须包含有效的浏览器标识！');
    }

    const cookiesDir = path.resolve(process.cwd(), 'cookies');
    if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir, { recursive: true });
    }

    const filePath = path.resolve(cookiesDir, 'ua.txt');
    fs.writeFileSync(filePath, cleaned, 'utf-8');

    // 立即更新内存缓存，确保下一次读取毫秒级生效
    const stat = fs.statSync(filePath);
    fileCache.set(filePath, { mtime: stat.mtimeMs, content: cleaned });

    return getBrowserFingerprint();
}

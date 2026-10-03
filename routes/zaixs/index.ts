import { load } from 'cheerio';
import iconv from 'iconv-lite'; // 导入 iconv-lite

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

// 定义路由元数据
export const route: Route = {
    // 路径包含 fid 参数
    path: '/:fid',
    // 路由名称
    name: '社区板块精华帖',
    // 网站 URL
    url: 'https://share.zaixs.com',
    // 分类
    categories: ['bbs'],
    // 示例路径，需要具体的 fid 参数，例如：123
    example: '/zaixs/112',
    // 参数说明
    parameters: { fid: '板块 ID' },
    // 维护者
    maintainers: ['c71an'],
    // 处理器函数
    handler,
};

async function handler(ctx) {
    const fid = ctx.req.param('fid');
    const listUrl = `https://share.zaixs.com/wap/community/list?fid=${fid}&digest=1`;

    // Headers 用于列表页 (Mobi) 和详情页 (PC)
    const mobiHeaders = {
        Host: 'share.zaixs.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    };
    const pcHeaders = {
        Host: 'www.zaixs.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    };

    // 1. 获取列表页（UTF-8 编码）
    const listRes = await got({ url: listUrl, headers: mobiHeaders });
    const $ = load(listRes.data);

    const channelTitle = $('body > div:nth-of-type(2) > div > p:nth-of-type(1)').text().trim();
    const list = $('#news li').slice(0, 10).toArray();

    // 2. 遍历列表，获取详情
    const items = await Promise.all(
        list.map((item) => {
            const $item = $(item);
            const title = $item.find('a div h6').text().trim();
            const rawLink = $item.find('a').attr('href') || '';
            let link = new URL(rawLink, listUrl).href;

            // URL 转换：移动端链接 → PC 端链接
            // /wap/thread/view-thread/tid/{id} → https://www.zaixs.com/thread-{id}-1-1.html
            const match = rawLink.match(/tid\/(\d+)/);
            if (match) {
                link = `https://www.zaixs.com/thread-${match[1]}-1-1.html`;
            }

            // 使用缓存
            return cache.tryGet(link, async () => {
                // 3. 获取详情页（GBK 编码）
                // 必须设置 responseType: 'buffer' 才能进行编码转换
                const detailRes = await got({ url: link, headers: pcHeaders, responseType: 'buffer' });
                // 使用 iconv-lite 解码 GBK
                const detailHtml = iconv.decode(detailRes.data as Buffer, 'gbk');
                // 加载详情页，设置 decodeEntities: false 防止乱码
                const $detail = load(detailHtml, { decodeEntities: false });

                // 提取发布时间
                let pubDate: string | undefined;
                // 时间在首帖作者栏的 span 标签的 title 属性中
                const firstPostTime = $detail('[id^="authorposton"] span[title]').first().attr('title');
                if (firstPostTime) {
                    // 使用 parseDate 进行标准化处理
                    pubDate = parseDate(firstPostTime).toUTCString();
                }

                // 提取正文：首帖 HTML
                const content = $detail('div.t_fsz table').first();

                // 清洗内容 (与原逻辑保持一致)
                // 1. 干掉所有 tip
                content.find('div.tip, div.aimg_tip, .xs0, .tip_horn').remove();

                // 2. 清洗 img 标签，确保 src 正确
                content.find('img').each((_, el) => {
                    const $img = $detail(el);
                    const realSrc = $img.attr('zoomfile') || $img.attr('file') || $img.attr('data-src') || $img.attr('data-original') || $img.attr('src');

                    if (realSrc && !/none\.gif$/i.test(realSrc)) {
                        // 替换为真实的图片链接
                        $img.attr('src', realSrc);
                    } else {
                        // 移除无效或占位图
                        $img.remove();
                    }
                });

                const contentHtml = content.html() ?? '';

                return {
                    title,
                    link,
                    description: contentHtml,
                    pubDate,
                };
            });
        })
    );

    // 3. 返回最终数据对象
    return {
        // 频道标题
        title: `萧内网 ${channelTitle}`,
        // 频道链接
        link: listUrl,
        // 频道描述
        description: `萧内网 ${channelTitle} 精华列表`,
        // 过滤掉缓存失败或返回空值的项
        item: items.filter(Boolean),
    };
}

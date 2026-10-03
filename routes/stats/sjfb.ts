import { load } from 'cheerio';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

// 目标页面的固定 URL
const baseUrl = 'https://www.stats.gov.cn/sj/zxfb/';

// 定义路由元数据
export const route: Route = {
    // 路由路径
    path: '/sjfb',
    // 路由名称
    name: '最新数据发布',
    // 网站 URL
    url: baseUrl,
    // 分类
    categories: ['government'],
    // 示例路径
    example: '/stats/sjfb',
    // 维护者
    maintainers: ['c71an'],
    // 处理器函数
    handler,
};

async function handler() {
    // 获取列表页数据
    const { data: listHtml } = await got(baseUrl);
    const $ = load(listHtml);

    // 文章列表选择器
    const list = $('div.wrapper-list-right .list-content ul li a.fl.pc_1600').slice(0, 10).toArray();

    // 映射并处理文章列表，利用缓存获取详情
    const items = await Promise.all(
        list.map((item) => {
            const $item = $(item);
            // 列表页使用 title 属性作为标题
            const title = $item.attr('title') ?? $item.text().trim();
            // 使用 URL 构造函数处理相对路径
            const link = new URL($item.attr('href') ?? '', baseUrl).href;

            // 使用 cache.tryGet 来实现缓存逻辑
            return cache.tryGet(link, async () => {
                const { data: detailHtml } = await got(link);
                const $detail = load(detailHtml);

                // 提取文章内容
                const description = $detail('.txt-content .trs_editor_view').html() ?? '';

                // 提取发布时间。原始选择器：.detail-title-des h2 p
                const pubDateText = $detail('.detail-title-des h2 p').first().text().trim();

                // 假设 pubDateText 格式为 "发布时间：2023年01月01日 10:00"，使用 parseDate 处理
                // parseDate 具有很强的中文日期识别能力，但可能需要清理前缀
                const pubDate = parseDate(pubDateText.replace('发布时间：', '').trim());

                return {
                    title,
                    link,
                    description,
                    pubDate,
                };
            });
        })
    );

    // 返回最终数据对象
    return {
        // 频道标题
        title: '国家统计局 - 最新数据发布',
        // 频道链接
        link: baseUrl,
        // 频道描述
        description: '中华人民共和国国家统计局官网最新数据发布栏目。',
        // 文章列表
        item: items,
    };
}

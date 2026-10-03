import { load } from 'cheerio';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

// 目标页面的固定 URL
const baseUrl = 'https://www.chinacdc.cn/jksj/jksj04_14275/';

// 定义路由元数据
export const route: Route = {
    // 路由路径
    path: '/week',
    // 路由名称
    name: '全国急性呼吸道传染病哨点监测情况',
    // 网站 URL
    url: baseUrl,
    // 分类
    categories: ['health'],
    // 示例路径
    example: '/chinacdc/week',
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
    const list = $('.xw_list > li > dl > dd > a').slice(0, 4).toArray();

    // 映射并处理文章列表，利用缓存获取详情
    const items = await Promise.all(
        list.map((item) => {
            const $item = $(item);
            const title = $item.text().trim();
            // 使用 URL 构造函数处理相对路径
            const link = new URL($item.attr('href') ?? '', baseUrl).href;

            // 使用 cache.tryGet 来实现缓存逻辑
            return cache.tryGet(link, async () => {
                const { data: detailHtml } = await got(link);
                const $detail = load(detailHtml);

                // 提取文章内容
                const description = $detail('#articleCon > div').html() ?? '';

                // 提取发布时间，格式类似于 '2023-10-20' 或 '2023/10/20'
                const pubDateText = $detail('div.xqCon span.fb em').text().trim();
                // 使用 parseDate 进行标准化处理，它会自动识别多种常见格式
                const pubDate = parseDate(pubDateText);

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
        title: '全国急性呼吸道传染病哨点监测情况 - 中国疾病预防控制中心',
        // 频道链接
        link: baseUrl,
        // 频道描述
        description: '中国疾病预防控制中心发布的全国急性呼吸道传染病哨点监测情况报告。',
        // 文章列表
        item: items,
    };
}

import { load } from 'cheerio';

import type { Route } from '@/types';
import cache from '@/utils/cache'; // 引入缓存工具
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

// 定义路由元数据
export const route: Route = {
    // 路由路径：您需要根据实际情况定义，例如：/pbc/data-interpretation
    path: '/sjjd',
    // 路由名称
    name: '数据解读',
    // 网站 URL
    url: 'http://www.pbc.gov.cn/diaochatongjisi/116219/116225/index.html',
    // 分类
    categories: ['finance'],
    // 示例路径
    example: '/pbc/sjjd',
    // 维护者
    maintainers: ['c71an'],
    // 处理器函数
    handler,
};

// 目标页面的固定 URL
const baseUrl = 'http://www.pbc.gov.cn/diaochatongjisi/116219/116225/index.html';

async function handler() {
    // 获取列表页数据
    const { data: listHtml } = await got(baseUrl);
    const $ = load(listHtml);

    // 文章列表选择器
    // 注意：这里的 #11871 可能因网站更新而失效，请检查
    const list = $('#11871 table table a').slice(0, 10).toArray();

    // 映射并处理文章列表，利用缓存获取详情
    const items = await Promise.all(
        list.map((item) => {
            const $item = $(item);
            const title = $item.attr('title') ?? '无标题';
            // 使用 URL 构造函数处理相对路径
            const link = new URL($item.attr('href') ?? '', baseUrl).href;

            // 使用 cache.tryGet 来实现缓存逻辑
            return cache.tryGet(link, async () => {
                const { data: detailHtml } = await got(link);
                const $detail = load(detailHtml);

                // 提取文章内容
                // 同样，这里的选择器可能因网站更新而失效
                const description = $detail('#11880 > div:nth-child(2) > div table:nth-child(4) tr:first td').html() ?? '';

                // 提取发布时间并使用 parseDate 进行标准化处理
                const pubDateText = $detail('#shijian').text().trim();
                const pubDate = parseDate(pubDateText, 'YYYY年MM月DD日 HH:mm'); // 假设日期格式为 '2023年10月20日 09:00'

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
        title: '中国人民银行 - 数据解读',
        // 频道链接
        link: baseUrl,
        // 频道描述
        description: '中国人民银行调查统计司',
        // 文章列表
        item: items,
    };
}

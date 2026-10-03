import { load } from 'cheerio';

import type { Route } from '@/types';
import got from '@/utils/got';

// 定义常量的目标链接
const baseUrl = 'https://www.city.komatsu.lg.jp';
const link = `${baseUrl}/soshiki/1042/surveillance/14588.html`;

export const route: Route = {
    // 修正路由 path 以匹配实际内容
    path: '/week',
    // 修正分类
    categories: ['health'],
    // 修正示例
    example: '/komatsu/week',
    // 修正 URL
    url: link,
    // 修正名称
    name: '小松市 下水モニタリング',
    maintainers: ['c71an'],
    // 在 RSSHub v2 中，handler 函数直接返回数据
    handler,
    // 默认缓存时间，可根据更新频率调整
    allowEmpty: false,
};

async function handler() {
    // got 配置可以简化
    const response = await got(link);
    const $ = load(response.data);

    // 提取信息
    // 标题文本：下水モニタリング
    const titleText = $('#contents > h1 > span > span').text().trim();
    // 更新日期文本：更新日 令和7年3月28日
    const updateText = $('#social-update-area > p').text().trim();
    // 内容 HTML：公告表格和说明
    const descHtml = $('#contents-in > div.free-layout-area > div').html()?.trim() ?? '';
    // 尝试获取发布时间
    const pubDateStr = $('meta[name="nsls:timestamp"]').attr('content');

    // 如果获取到时间戳，则使用它，否则使用当前时间
    const pubDate = pubDateStr ? new Date(pubDateStr).toUTCString() : new Date().toUTCString();

    // 构建并返回 RSS 数据
    return {
        // 频道标题
        title: `${titleText}／小松市`,
        // 频道链接
        link,
        // 频道描述
        description: '小松市的 COVID-19 下水监测数据更新',
        // 构建 item 数组，因为这是一个单页监测报告，通常只有一个 item
        item: [
            {
                // 文章标题，结合标题和更新日期
                title: `${titleText} - ${updateText}`,
                // 文章链接
                link,
                // 文章内容，使用提取的 HTML
                description: descHtml,
                // 文章发布时间
                pubDate,
                // GUID 应该是唯一标识符，使用更新日期文本作为标识
                guid: `komatsu_sewer_monitoring_${updateText}`,
            },
        ],
    };
}

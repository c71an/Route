import { load } from 'cheerio';

import type { Route } from '@/types';
import got from '@/utils/got';
// import { parseDate } from '@/utils/parse-date'; // 如果需要解析时间戳，则引入

// 目标页面的固定 URL
const link = 'https://www.ssm.gov.mo/apps1/statistics/%E6%B5%81%E6%84%9F%E6%A8%A3%E7%96%BE%E7%97%85%E5%92%8C%E6%96%B0%E5%86%A0%E7%97%85%E6%AF%92%E6%84%9F%E6%9F%93%E7%9B%A3%E6%B8%AC';

// 复杂的选择器应该提取出来，提高可读性
const SELECTOR_ROW = 'body > div:nth-of-type(3) > div:nth-of-type(2) > div > div > table:nth-of-type(1) > tbody > tr:nth-of-type(2)';
const SELECTOR_DATE = `${SELECTOR_ROW} > td:nth-of-type(1)`; // 预期是日期文本
const SELECTOR_LINK_ELEMENT = `${SELECTOR_ROW} > td:nth-of-type(2) > a`; // 预期是包含链接的 A 标签

// 定义路由元数据
export const route: Route = {
    // 路由路径
    path: '/week',
    // 路由名称
    name: '流感樣疾病和新冠病毒感染監測',
    // 网站 URL
    url: link,
    // 分类
    categories: ['government', 'health'],
    // 示例路径
    example: '/ssm/week',
    // 维护者
    maintainers: ['c71an'],
    // 处理器函数
    handler,
};

async function handler() {
    // 获取页面数据，简化 got 调用
    const response = await got(link);
    const $ = load(response.data);

    // 提取最新的日期和链接
    const dateText = $(SELECTOR_DATE).text().trim();
    const itemLinkAttr = $(SELECTOR_LINK_ELEMENT).attr('href');

    // 确保链接是绝对路径，如果网站使用相对路径，需要进行 URL 拼接
    // 假设链接已经是绝对或相对路径可以直接使用
    const itemLink = itemLinkAttr || link;

    // 构建 item
    const item = {
        // 文章标题：基础标题 + 提取的日期
        title: `流感樣疾病和新冠病毒感染監測 ${dateText}`,
        // 文章链接
        link: itemLink,
        // 文章描述：通常可以简单重复标题或提供更多详情
        description: `澳門特別行政區政府衛生局公佈的 ${dateText} 監測報告，請點擊查看詳情。`,
        // pubDate: 如果网站有时间戳，应该在这里解析并使用 parseDate
        // pubDate: parseDate(dateText), // 示例：如果 dateText 是可解析的日期

        // GUID：使用链接或日期作为唯一标识符
        guid: `ssm_monitoring_${dateText}`,
    };

    // 返回最终数据对象
    return {
        // 频道标题
        title: '流感樣疾病和新冠病毒感染監測 - 澳門特別行政區政府衛生局',
        // 频道链接
        link,
        // 频道描述
        description: '澳門特別行政區政府衛生局 流感樣疾病和新冠病毒感染監測數據',
        // 文章列表 (只有一个最新的项目)
        item: [item],
    };
}

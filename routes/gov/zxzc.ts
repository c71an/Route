import { load } from 'cheerio';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

// 目标页面的固定 URL
const baseUrl = 'https://www.gov.cn/zhengce/zuixin/';

type GovPolicyItem = {
    TITLE: string;
    URL: string;
    DOCRELPUBTIME: string;
};

export const route: Route = {
    path: '/zxzc',
    name: '最新政策',
    url: baseUrl,
    categories: ['government'],
    example: '/gov/zxzc',
    maintainers: ['c71an'],
    handler,
};

async function handler() {
    const apiUrl = 'https://www.gov.cn/zhengce/zuixin/ZUIXINZHENGCE.json';
    const { data } = await got(apiUrl, {
        responseType: 'json',
    });

    const list = (data as GovPolicyItem[]).slice(0, 10);

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(item.URL, async () => {
                const { data: detailHtml } = await got(item.URL);
                const $detail = load(detailHtml);

                const description = $detail('#UCAP-CONTENT > div.trs_editor_view.TRS_UEDITOR.trs_paper_default').html() || $detail('#UCAP-CONTENT').html() || '';

                const firstPublishedTime = $detail('meta[name="firstpublishedtime"]').attr('content');
                const normalizedPublishedTime = firstPublishedTime?.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2}:\d{2})$/, '$1 $2');

                return {
                    title: item.TITLE.trim(),
                    link: item.URL,
                    description,
                    pubDate: parseDate(normalizedPublishedTime ?? item.DOCRELPUBTIME),
                };
            })
        )
    );

    return {
        title: '国务院办公厅 - 最新政策',
        link: baseUrl,
        description: '中华人民共和国中央人民政府门户网站发布的最新政策信息。',
        item: items,
    };
}

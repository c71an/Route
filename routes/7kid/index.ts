import { URL } from 'node:url'; // 导入 URL
import { promisify } from 'node:util'; // 导入 promisify
import * as zlib from 'node:zlib'; // 导入 zlib 模块

import type { DataItem, Route } from '@/types';
import got from '@/utils/got';

// 将 zlib.gunzip 转换为 Promise 版本，以便在 async/await 中使用
const gunzipPromise = promisify(zlib.gunzip);

// 定义 API 基础 URL
const apiBase = 'https://kidcms.7kid.com/api/javaphpcms/v1/no-auth';
const linkBase = 'https://kidcms.7kid.com/#/detail';

// 定义文章结构 (根据 API 响应推断)
interface Article {
    id: number;
    title: string;
    publishTime: number | string; // 时间戳或日期字符串
    // ... 其他字段
}

// === 工具函数：处理 content 为 Buffer ===
// rawContent 可以是 JSON 字符串或者数字数组
const decodeContent = (rawContent: string | number[]): Buffer => {
    let arr: number[];
    if (typeof rawContent === 'string') {
        // 确保 JSON.parse 成功
        try {
            arr = JSON.parse(rawContent) as number[];
        } catch {
            return Buffer.from([]);
        }
    } else {
        arr = rawContent;
    }

    // 将可能为负数的字节 (JS number) 转换为 0-255 的 Buffer 字节
    const byteArray = arr.map((x) => (x < 0 ? x + 256 : x));
    return Buffer.from(byteArray);
};

// === 获取详情 + 解压 HTML 内容 ===
const getArticleDetail = async (id: number): Promise<string> => {
    // 请求详情 API
    const detailResponse = await got.post(`${apiBase}/get-detail?articleId=${id}`, {
        responseType: 'json',
    });

    const rawContent = detailResponse.data.data.content;

    // 1. 解码内容为 Buffer
    const buffer = decodeContent(rawContent);

    if (buffer.length === 0) {
        return '内容为空，无法解压。';
    }

    try {
        // 2. 使用 promisified zlib.gunzip 解压
        const decompressed = await gunzipPromise(buffer);
        // 3. 转换为 UTF-8 字符串 (HTML)
        return decompressed.toString('utf-8');
    } catch {
        throw new Error('解压文章内容失败');
    }
};

// 定义路由元数据
export const route: Route = {
    // 路径包含 schoolId 参数
    path: '/:schoolId',
    // 路由名称
    name: '文章列表',
    // 网站 URL
    url: 'https://kidcms.7kid.com',
    // 分类
    categories: ['education'],
    // 示例路径，需要具体的 schoolId 参数
    example: '/7kid/718336990898551810',
    // 参数说明
    parameters: { schoolId: '学校 ID' },
    // 维护者
    maintainers: ['c71an'],
    // 处理器函数
    handler,
};

async function handler(ctx) {
    const schoolId = ctx.req.param('schoolId');
    const url = `${apiBase}/home/category-list?schoolId=${schoolId}`;

    // 获取文章列表数据
    const response = await got.post(url, { responseType: 'json' });

    const data = response.data.data;

    // 过滤出有文章列表的分类，并将所有文章平铺到一个数组
    const articles: Article[] = data.filter((category) => category.articleList && category.articleList.length > 0).flatMap((category) => category.articleList);

    // 遍历文章并获取详情
    const items: DataItem[] = await Promise.all(
        articles.map(async (article) => {
            let description = '点击标题查看详情'; // 默认描述

            try {
                // 调用工具函数获取解压后的 HTML 内容
                description = await getArticleDetail(article.id);
            } catch {
                // 错误处理，保留默认描述
            }

            return {
                title: article.title,
                // 构造前端可访问的链接
                link: new URL(`#/detail?content_id=${article.id}`, linkBase).href,
                // 转换发布时间
                pubDate: new Date(article.publishTime).toUTCString(),
                description,
            };
        })
    );

    // 返回最终数据对象
    return {
        // 频道标题
        title: `7kid - School ID: ${schoolId}`,
        // 频道链接
        link: 'https://kidcms.7kid.com',
        // 频道描述
        description: `7kid CMS School ID ${schoolId} 最新文章`,
        // 文章列表
        item: items,
    };
}

'use strict';

// 静态资源地址
const ASSET_URL = 'https://page.638866.xyz/';
// 前缀用于内部重定向
const PREFIX = '/';
// 如有需要，可设置额外的配置项（目前未使用）
const Config = { jsdelivr: 0 };
// 白名单，若为空则默认允许所有请求
const whiteList = [];

// 匹配 GitHub 相关 URL 的正则集合
const urlPatterns = [
  /^(?:https?:\/\/)?github\.com\/[^/]+\/[^/]+\/(?:releases|archive)\/.*$/i,
  /^(?:https?:\/\/)?github\.com\/[^/]+\/[^/]+\/(?:blob|raw)\/.*$/i,
  /^(?:https?:\/\/)?github\.com\/[^/]+\/[^/]+\/(?:info|git-).*$/i,
  /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/[^/]+\/[^/]+\/[^/]+\/.+$/i,
  /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/[^/]+\/[^/]+\/.+$/i,
  /^(?:https?:\/\/)?github\.com\/[^/]+\/[^/]+\/tags.*$/i
];

// 预检请求响应配置
const PREFLIGHT_INIT = {
  status: 204,
  headers: new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000'
  })
};

// 构造响应时自动添加 CORS 头
const makeRes = (body, status = 200, headers = {}) => {
  headers['access-control-allow-origin'] = '*';
  return new Response(body, { status, headers });
};

// 封装 URL 解析
const newUrl = urlStr => {
  try {
    return new URL(urlStr);
  } catch {
    return null;
  }
};

// 主请求处理函数
const fetchHandler = async (req, waitUntil) => {
  // 使用 GET 方法作为缓存键
  const cacheKey = new Request(req.url, { method: 'GET' });
  const cache = caches.default;
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) return cachedResponse;

  const urlObj = new URL(req.url);
  let path = urlObj.searchParams.get('q');

  // 若存在 ?q= 参数，则重定向到规范地址
  if (path) {
    return Response.redirect(`https://${urlObj.host}${PREFIX}${path}`, 301);
  }

  // 从 URL 中提取路径，并将多余斜杠转换为 "https://"
  path = urlObj.href
    .slice(urlObj.origin.length + PREFIX.length)
    .replace(/^https?:\/+/, 'https://');

  // 如果匹配 GitHub 相关 URL 则走代理处理，否则直接请求静态资源地址
  if (urlPatterns.some(pattern => pattern.test(path))) {
    try {
      const response = await httpHandler(req, path);
      waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (error) {
      console.error(`Error handling request: ${error.message}`);
      return makeRes('Internal Server Error', 500);
    }
  } else {
    return fetch(ASSET_URL + path);
  }
};

// 处理预检请求和代理请求
const httpHandler = async (req, pathname) => {
  // 预检请求（OPTIONS）
  if (req.method === 'OPTIONS' && req.headers.has('access-control-request-headers')) {
    return new Response(null, PREFLIGHT_INIT);
  }

  const reqHdrNew = new Headers(req.headers);
  // 若白名单为空或匹配则允许请求，否则返回 403
  if (whiteList.length && !whiteList.some(item => pathname.includes(item))) {
    return new Response("blocked", { status: 403 });
  }

  // 确保 URL 为 https 开头
  if (!pathname.startsWith('https://')) {
    pathname = 'https://' + pathname;
  }
  const urlObj = newUrl(pathname);
  const reqInit = {
    method: req.method,
    headers: reqHdrNew,
    redirect: 'manual',
    body: req.body
  };
  return proxy(urlObj, reqInit);
};

// 代理请求并处理重定向
const proxy = async (urlObj, reqInit) => {
  const res = await fetch(urlObj.href, reqInit);
  const resHdrNew = new Headers(res.headers);
  const status = res.status;

  // 如遇到重定向，检查 location 是否为 GitHub 相关 URL
  if (resHdrNew.has('location')) {
    const _location = resHdrNew.get('location');
    if (checkUrl(_location)) {
      resHdrNew.set('location', PREFIX + _location);
    } else {
      // 非 GitHub URL 重定向则采用 follow 方式递归代理
      reqInit.redirect = 'follow';
      return proxy(newUrl(_location), reqInit);
    }
  }

  // 增加 CORS 头并删除安全策略相关响应头
  resHdrNew.set('access-control-expose-headers', '*');
  resHdrNew.set('access-control-allow-origin', '*');
  resHdrNew.delete('content-security-policy');
  resHdrNew.delete('content-security-policy-report-only');
  resHdrNew.delete('clear-site-data');

  return new Response(res.body, { status, headers: resHdrNew });
};

// 检查 URL 是否符合 GitHub 相关规则
const checkUrl = url => urlPatterns.some(pattern => pattern.test(url));

// 导出 Cloudflare Pages Functions 处理入口
export async function onRequest(context) {
  const { request, waitUntil } = context;
  return await fetchHandler(request, waitUntil);
}

'use strict';

// 静态资源地址（如果有前端静态资源）
const ASSET_URL = 'https://page.638866.xyz/';

// 代理请求前缀
const PREFIX = '/';

// 允许代理的 URL 规则（支持 GitHub Raw）
const urlPatterns = [
  /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/[^/]+\/[^/]+\/[^/]+\/.+$/i,
  /^(?:https?:\/\/)?github\.com\/[^/]+\/[^/]+\/(?:releases|archive|tags)\/.*$/i,
  /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/[^/]+\/[^/]+\/.+$/i
];

// 预检请求响应（CORS 处理）
const PREFLIGHT_INIT = {
  status: 204,
  headers: new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-max-age': '1728000'
  })
};

// 创建响应并附加 CORS 头
const makeRes = (body, status = 200, headers = {}) => {
  headers['access-control-allow-origin'] = '*';
  return new Response(body, { status, headers });
};

// 解析 URL
const newUrl = urlStr => {
  try {
    return new URL(urlStr);
  } catch {
    return null;
  }
};

// Cloudflare Pages Functions 处理入口
export async function onRequest(context) {
  const { request, waitUntil } = context;
  return await fetchHandler(request, waitUntil);
}

// 处理请求
const fetchHandler = async (req, waitUntil) => {
  console.log('Request URL:', req.url);

  const urlObj = new URL(req.url);
  let path = urlObj.href.slice(urlObj.origin.length + PREFIX.length);

  // 直接访问静态资源
  if (!path.startsWith('http://') && !path.startsWith('https://')) {
    return fetch(ASSET_URL + path);
  }

  console.log('Fetching:', path);

  // 确保路径是合法的 URL
  const targetUrl = newUrl(path);
  if (!targetUrl) {
    return makeRes('Invalid URL', 400);
  }

  // 代理 GitHub 相关 URL
  if (urlPatterns.some(pattern => pattern.test(targetUrl.href))) {
    try {
      const response = await proxy(targetUrl, req);
      waitUntil(caches.default.put(req, response.clone()));
      return response;
    } catch (error) {
      console.error('Error:', error.message);
      return makeRes('Internal Server Error', 500);
    }
  }

  return makeRes('Not Allowed', 403);
};

// 代理请求
const proxy = async (urlObj, req) => {
  const reqInit = {
    method: req.method,
    headers: new Headers(req.headers),
    redirect: 'manual',
    body: req.body
  };

  // 发送请求
  const res = await fetch(urlObj.href, reqInit);
  const resHdrNew = new Headers(res.headers);
  const status = res.status;

  // 处理 302 重定向
  if (resHdrNew.has('location')) {
    const location = resHdrNew.get('location');
    if (urlPatterns.some(pattern => pattern.test(location))) {
      resHdrNew.set('location', PREFIX + location);
    } else {
      return proxy(newUrl(location), req);
    }
  }

  // 添加 CORS 头
  resHdrNew.set('access-control-expose-headers', '*');
  resHdrNew.set('access-control-allow-origin', '*');
  resHdrNew.delete('content-security-policy');

  return new Response(res.body, { status, headers: resHdrNew });
};

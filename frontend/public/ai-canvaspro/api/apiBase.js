const DEFAULT_TIMEOUT = 30000;
const DEFAULT_LOCAL_API_BASE = 'http://127.0.0.1:8777';
const EMBEDDED_API_BASE = '/ai-canvaspro-api';

function normalizeBaseUrl(value) {
  const text = String(value || '').trim();
  return text.endsWith('/') ? text.slice(0, -1) : text;
}

export function getApiBase() {
  try {
    const params = new URLSearchParams(location.search || '');
    const explicitBase =
      params.get('api_base') ||
      globalThis.__AICANVAS_API_BASE__ ||
      '';
    if (explicitBase) return normalizeBaseUrl(explicitBase);
    if (location.protocol === 'file:') return DEFAULT_LOCAL_API_BASE;
    if (location.pathname.startsWith('/ai-canvaspro/')) return EMBEDDED_API_BASE;
  } catch {
    /* fallback to same-origin requests */
  }
  return '';
}

export function buildApiUrl(path) {
  const apiBase = getApiBase();
  const route = String(path || '');
  if (!route) return apiBase || '';
  if (!route.startsWith('/')) return `${apiBase}/${route}`;
  return `${apiBase}${route}`;
}

export function fetchWithTimeout(url, options = {}, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

export function fetchWithTimeoutWithSignal(
  url,
  options = {},
  timeout = DEFAULT_TIMEOUT,
  signal,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let abortListener = null;

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      abortListener = () => controller.abort();
      signal.addEventListener('abort', abortListener, { once: true });
    }
  }

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  });
}

function stringifyErrorBodyValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const nested =
      value.message ||
      value.error ||
      value.errorMessage ||
      value.error_message ||
      value.detail ||
      value.details ||
      value.reason;
    if (nested !== undefined && nested !== null && nested !== value) {
      const nestedText = stringifyErrorBodyValue(nested);
      if (nestedText) return nestedText;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value || '');
}

async function parseErrorBody(response) {
  let text = '';
  try {
    text = await response.text();
    const data = JSON.parse(text);
    return stringifyErrorBodyValue(
      data.data?.message ||
      data.error ||
      data.message ||
      data.body?.message ||
      data.data?.msg ||
      text,
    );
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

export async function request(path, options = {}, timeout = DEFAULT_TIMEOUT) {
  const fullUrl = String(path || '').startsWith('http') ? path : buildApiUrl(path);
  try {
    const response = await fetchWithTimeout(fullUrl, options, timeout);
    if (response.status === 404) {
      return { success: true, data: null, status: 404 };
    }
    if (!response.ok) {
      const errorBody = await parseErrorBody(response);
      return {
        success: false,
        error: `请求失败: HTTP ${response.status}${errorBody ? ` — ${errorBody}` : ''}`,
        status: response.status,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { success: true, data, status: response.status };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { success: false, error: '请求超时，请检查网络连接或服务器状态', status: 0 };
    }
    if (String(error?.message || '').includes('Failed to fetch')) {
      return {
        success: false,
        error:
          '网络请求失败。请检查：\n1. 网络连接是否正常\n2. 本地 Python 服务器(server.py)是否已启动\n3. 浏览器是否可以访问 http://localhost:8777\n4. 是否有防火墙拦截了 8777 端口',
        status: 0,
      };
    }
    return { success: false, error: error?.message || '未知网络错误', status: 0 };
  }
}

export function get(path, timeout) {
  return request(path, { method: 'GET' }, timeout);
}

export function post(path, body, timeout) {
  const options = { method: 'POST', headers: {} };
  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
      options.body = body;
    } else if (typeof body === 'object') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    } else {
      options.body = body;
    }
  }
  return request(path, options, timeout);
}

export function del(path, timeout) {
  return request(path, { method: 'DELETE' }, timeout);
}

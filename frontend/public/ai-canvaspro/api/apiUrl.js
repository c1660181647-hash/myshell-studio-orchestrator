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

import { graphStore } from './src/core/stores/appStore.js';

const BRIDGE_VERSION = '2026.06.11';
const DB_NAME = 'myshell-studio-ai-canvaspro';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const ASSET_STORE = 'assets';
const MESSAGE_REQUEST = 'aicanvas-studio:request';
const MESSAGE_RESPONSE = 'aicanvas-studio:response';
const MESSAGE_READY = 'aicanvas-studio:ready';
const MESSAGE_AUTOSAVE = 'aicanvas-studio:autosave';
const API_BASE = location.pathname.startsWith('/ai-canvaspro/') ? '/ai-canvaspro-api' : '';
const AUTHOR_SIGNAL_POLICY_KEY = '__MYSHELL_STUDIO_CANVASPRO_AUTHOR_SIGNAL_POLICY__';
const AUTHOR_SIGNAL_POLICY_STYLE_ID = 'studio-canvaspro-author-signal-policy';
const LICENSE_MODAL_ID = 'studioCanvasproLicenseModal';
const AUTHOR_SIGNAL_LABEL = '第三方组件 / 授权声明';
const HIDDEN_UPSTREAM_MENU_IDS = Object.freeze(['btnTutorial', 'btnGithubOfficial', 'btnFeatureFeedback']);
const BLOCKED_UPSTREAM_EXTERNAL_URL_PATTERNS = Object.freeze([
  /github\.com\/ashuoAI\/AI-CanvasPro/i,
  /i1etb6xynr\.feishu\.cn/i,
  /space\.bilibili\.com\/1876480181/i,
]);
const ALLOWED_ACTIONS = new Set([
  'getStatus',
  'saveSnapshot',
  'exportPackage',
  'importPackage',
  'getSelectedContext',
  'openShortcuts',
]);
const BRIDGE_INSTALL_KEY = '__MYSHELL_STUDIO_CANVASPRO_BRIDGE_INSTALLED__';
const bridgeAlreadyInstalled = Boolean(window[BRIDGE_INSTALL_KEY]);
window[BRIDGE_INSTALL_KEY] = true;
const OFFLINE_GENERATION_SELECTOR = [
  '.act-generate',
  '.act-image-generate',
  '.act-video-generate',
  '.act-text-generate',
  '.act-audio-generate',
  '.act-runninghub',
  '.act-dreamina',
  '[data-action*="generate" i]',
  '[data-ui-action*="generate" i]',
  '[data-command*="generate" i]',
  '[class*="generate" i]',
  '[class*="runninghub" i]',
  '[class*="dreamina" i]',
].join(',');
const ASSET_URL_KEYS = new Set([
  'audioUrl',
  'displayUrl',
  'fileUrl',
  'imageUrl',
  'localUrl',
  'originalUrl',
  'src',
  'sourceUrl',
  'thumbUrl',
  'url',
  'videoUrl',
]);
const LOCAL_PATH_KEYS = new Set([
  'displayLocalPath',
  'localPath',
  'originalLocalPath',
  'path',
  'thumbLocalPath',
]);

let dbPromise = null;
let autosaveTimer = null;
let lastAutosaveSignature = '';
let lastAutosaveMeta = null;
let apiReachable = null;

function postToStudio(message) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, window.location.origin);
  }
}

function isTrustedStudioMessage(event) {
  if (event.origin !== window.location.origin) return false;
  if (window.parent && window.parent !== window && event.source !== window.parent) return false;
  return true;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTrustedStudioRequest(event) {
  if (!isTrustedStudioMessage(event)) return false;
  const message = event.data || {};
  if (!isPlainRecord(message)) return false;
  if (message.type !== MESSAGE_REQUEST) return false;
  if (typeof message.id !== 'string' || !message.id) return false;
  if (typeof message.action !== 'string' || !ALLOWED_ACTIONS.has(message.action)) return false;
  if (message.payload != null && !isPlainRecord(message.payload)) return false;
  return true;
}

function applyRuntimeModeState() {
  document.documentElement.dataset.studioCanvasproApi =
    apiReachable === false ? 'offline' : apiReachable === true ? 'native' : 'unknown';
}

function installOfflineGenerationGuard() {
  document.addEventListener(
    'click',
    (event) => {
      if (apiReachable !== false) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const control = target.closest(OFFLINE_GENERATION_SELECTOR);
      if (!control) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.showToast?.('Native CanvasPro API is required for generation tasks.', 'warn');
    },
    true,
  );
}

function installAuthorSignalPolicyStyles() {
  if (document.getElementById(AUTHOR_SIGNAL_POLICY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = AUTHOR_SIGNAL_POLICY_STYLE_ID;
  style.textContent = `
    #btnTutorial,
    #btnGithubOfficial,
    #btnFeatureFeedback,
    #btnBilibili {
      display: none !important;
    }
    #avatarMenu {
      min-width: 236px;
    }
    #btnAbout .studio-canvaspro-about-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #aboutOverlay {
      position: fixed !important;
      inset: 0 !important;
      align-items: center !important;
      justify-content: center !important;
      background: rgba(0, 0, 0, 0.68) !important;
      z-index: 2147483000 !important;
    }
    #aboutOverlay .about-dialog {
      width: min(420px, calc(100vw - 40px)) !important;
      padding: 28px 28px 24px !important;
      border: 1px solid rgba(255, 255, 255, 0.14) !important;
      border-radius: 16px !important;
      background: rgba(18, 18, 22, 0.98) !important;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.68) !important;
      color: rgba(255, 255, 255, 0.92) !important;
    }
    #aboutOverlay .about-logo {
      display: none !important;
    }
    #aboutOverlay .about-title {
      margin-top: 0 !important;
      color: rgba(255, 255, 255, 0.96) !important;
      font-size: 18px !important;
      line-height: 1.4 !important;
    }
    #aboutOverlay .about-version,
    #aboutOverlay .about-footer,
    #aboutOverlay .about-close {
      color: rgba(255, 255, 255, 0.68) !important;
    }
    #${LICENSE_MODAL_ID} {
      position: fixed !important;
      inset: 0 !important;
      display: none;
      align-items: center !important;
      justify-content: center !important;
      padding: 24px !important;
      background: rgba(0, 0, 0, 0.68) !important;
      z-index: 2147483001 !important;
      box-sizing: border-box !important;
    }
    #${LICENSE_MODAL_ID}[aria-hidden="false"] {
      display: flex !important;
    }
    .studio-canvaspro-license-modal-card {
      position: relative;
      width: min(440px, 100%);
      padding: 28px 28px 24px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 16px;
      background: rgba(18, 18, 22, 0.98);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.68);
      color: rgba(255, 255, 255, 0.92);
      text-align: left;
    }
    .studio-canvaspro-license-modal-title {
      margin: 0 32px 14px 0;
      color: rgba(255, 255, 255, 0.96);
      font-size: 18px;
      font-weight: 700;
      line-height: 1.4;
    }
    .studio-canvaspro-license-modal-close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 30px;
      height: 30px;
      border: 0;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.72);
      cursor: pointer;
    }
    .studio-canvaspro-license-modal-close:hover {
      background: rgba(255, 255, 255, 0.14);
      color: rgba(255, 255, 255, 0.94);
    }
    .studio-canvaspro-license-disclosure {
      margin: 14px 0 0;
      padding: 12px;
      border: 1px solid var(--stroke-default, rgba(255, 255, 255, 0.12));
      border-radius: 10px;
      background: var(--white-05, rgba(255, 255, 255, 0.05));
      color: var(--text-secondary, rgba(255, 255, 255, 0.72));
      font-size: 13px;
      line-height: 1.65;
      text-align: left;
    }
    .studio-canvaspro-license-disclosure p {
      margin: 0 0 8px;
    }
    .studio-canvaspro-license-disclosure p:last-child {
      margin-bottom: 0;
    }
    .studio-canvaspro-license-disclosure strong {
      color: var(--text-primary, rgba(255, 255, 255, 0.92));
      font-weight: 700;
    }
  `;
  document.head.appendChild(style);
}

function setElementHidden(element) {
  if (!element) return;
  if (!element.hidden) element.hidden = true;
  if (element.getAttribute('aria-hidden') !== 'true') element.setAttribute('aria-hidden', 'true');
  if (element.tabIndex !== -1) element.tabIndex = -1;
}

function isBlockedUpstreamExternalUrl(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (BLOCKED_UPSTREAM_EXTERNAL_URL_PATTERNS.some((pattern) => pattern.test(text))) return true;
  try {
    const url = new URL(text, location.href);
    return BLOCKED_UPSTREAM_EXTERNAL_URL_PATTERNS.some((pattern) => pattern.test(url.href));
  } catch {
    return false;
  }
}

function neutralizeBlockedExternalUrl(element) {
  if (!element) return;
  const url = element.getAttribute('data-external-url') || element.getAttribute('href') || '';
  if (!isBlockedUpstreamExternalUrl(url)) return;
  if (element.dataset && !element.dataset.studioBlockedExternalUrl) {
    element.dataset.studioBlockedExternalUrl = url;
  } else if (!element.getAttribute('data-studio-blocked-external-url')) {
    element.setAttribute('data-studio-blocked-external-url', url);
  }
  element.removeAttribute('data-external-url');
  if (element.tagName === 'A') element.removeAttribute('href');
}

function setButtonLabel(button, label) {
  if (!button || button.dataset.studioCanvasproLabel === label) return;
  const icon = button.querySelector('svg')?.cloneNode(true);
  button.replaceChildren();
  if (icon) button.appendChild(icon);
  const text = document.createElement('span');
  text.className = 'studio-canvaspro-about-label';
  text.textContent = label;
  button.appendChild(text);
  button.setAttribute('aria-label', label);
  button.dataset.studioCanvasproLabel = label;
}

function createDisclosureParagraph(text, strongPrefix = '') {
  const paragraph = document.createElement('p');
  if (strongPrefix) {
    const strong = document.createElement('strong');
    strong.textContent = strongPrefix;
    paragraph.appendChild(strong);
    paragraph.appendChild(document.createTextNode(text));
  } else {
    paragraph.textContent = text;
  }
  return paragraph;
}

function updateAboutDisclosure() {
  const overlay = document.getElementById('aboutOverlay');
  const dialog = overlay?.querySelector('.about-dialog');
  if (!dialog) return;

  const title = dialog.querySelector('.about-title');
  if (title && title.textContent !== AUTHOR_SIGNAL_LABEL) title.textContent = AUTHOR_SIGNAL_LABEL;

  const author = dialog.querySelector('.about-author');
  if (author?.textContent) author.textContent = '';
  setElementHidden(author);

  const upstreamLink = document.getElementById('btnBilibili');
  neutralizeBlockedExternalUrl(upstreamLink);
  setElementHidden(upstreamLink);

  const footer = dialog.querySelector('.about-footer');
  if (footer) {
    footer.textContent = 'CanvasPro is loaded as an external optional component inside MyShell Studio.';
  }

  let disclosure = document.getElementById('studioCanvasproLicenseDisclosure');
  if (!disclosure) {
    disclosure = document.createElement('div');
    disclosure.id = 'studioCanvasproLicenseDisclosure';
    disclosure.className = 'studio-canvaspro-license-disclosure';
    const version = document.getElementById('aboutVersion');
    if (version?.parentElement) {
      version.insertAdjacentElement('afterend', disclosure);
    } else {
      dialog.appendChild(disclosure);
    }
  }

  if (disclosure.dataset.studioCanvasproReady === 'true') return;
  disclosure.replaceChildren(
    createDisclosureParagraph('CanvasPro 以外部可选组件形式接入 Studio。'),
    createDisclosureParagraph(
      ' AI-CanvasPro。版权、许可证和商业授权归其权利方所有；商业、SaaS、打包分发或白标使用需先取得书面授权。',
      '上游项目：',
    ),
    createDisclosureParagraph('Studio 已隐藏上游教程、反馈和仓库跳转入口，避免用户离开当前产品环境。'),
  );
  disclosure.dataset.studioCanvasproReady = 'true';
}

function ensureStudioLicenseModal() {
  let modal = document.getElementById(LICENSE_MODAL_ID);
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = LICENSE_MODAL_ID;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-labelledby', 'studioCanvasproLicenseModalTitle');

  const card = document.createElement('div');
  card.className = 'studio-canvaspro-license-modal-card';

  const close = document.createElement('button');
  close.type = 'button';
  close.id = 'studioCanvasproLicenseModalClose';
  close.className = 'studio-canvaspro-license-modal-close';
  close.setAttribute('aria-label', '关闭授权声明');
  close.textContent = '×';

  const title = document.createElement('h2');
  title.id = 'studioCanvasproLicenseModalTitle';
  title.className = 'studio-canvaspro-license-modal-title';
  title.textContent = AUTHOR_SIGNAL_LABEL;

  const disclosure = document.createElement('div');
  disclosure.className = 'studio-canvaspro-license-disclosure';
  disclosure.replaceChildren(
    createDisclosureParagraph('CanvasPro 以外部可选组件形式接入 Studio。'),
    createDisclosureParagraph(
      ' AI-CanvasPro。版权、许可证和商业授权归其权利方所有；商业、SaaS、打包分发或白标使用需先取得书面授权。',
      '上游项目：',
    ),
    createDisclosureParagraph('Studio 已隐藏上游教程、反馈和仓库跳转入口，避免用户离开当前产品环境。'),
  );

  card.append(close, title, disclosure);
  modal.appendChild(card);
  document.body.appendChild(modal);
  return modal;
}

function openAboutDisclosure() {
  updateAboutDisclosure();
  const upstreamOverlay = document.getElementById('aboutOverlay');
  if (upstreamOverlay) {
    upstreamOverlay.style.display = 'none';
    upstreamOverlay.setAttribute('aria-hidden', 'true');
  }
  const modal = ensureStudioLicenseModal();
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
}

function closeStudioLicenseModal() {
  const modal = document.getElementById(LICENSE_MODAL_ID);
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}

function closeAboutDisclosure() {
  closeStudioLicenseModal();
  const overlay = document.getElementById('aboutOverlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
}

function applyAuthorSignalPolicy() {
  installAuthorSignalPolicyStyles();
  for (const id of HIDDEN_UPSTREAM_MENU_IDS) {
    const element = document.getElementById(id);
    neutralizeBlockedExternalUrl(element);
    setElementHidden(element);
  }
  document.querySelectorAll('[data-external-url], a[href]').forEach((element) => {
    neutralizeBlockedExternalUrl(element);
  });
  setButtonLabel(document.getElementById('btnAbout'), AUTHOR_SIGNAL_LABEL);
  updateAboutDisclosure();
  document.documentElement.dataset.studioCanvasproAuthorSignals = 'hidden';
}

function installAuthorSignalPolicy() {
  if (window[AUTHOR_SIGNAL_POLICY_KEY]) return;
  window[AUTHOR_SIGNAL_POLICY_KEY] = true;
  let policyTimer = null;

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('#btnAbout')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openAboutDisclosure();
        return;
      }
      if (
        target.closest('#studioCanvasproLicenseModalClose') ||
        target === document.getElementById(LICENSE_MODAL_ID) ||
        target.closest('#aboutClose') ||
        target === document.getElementById('aboutOverlay')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAboutDisclosure();
        return;
      }
      const trigger = target.closest('[data-external-url], [data-studio-blocked-external-url], a[href]');
      if (!trigger) return;
      const url =
        trigger.getAttribute('data-studio-blocked-external-url') ||
        trigger.getAttribute('data-external-url') ||
        trigger.getAttribute('href') ||
        '';
      if (!isBlockedUpstreamExternalUrl(url)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.showToast?.('请在第三方组件 / 授权声明中查看 CanvasPro 授权边界。', 'warn');
    },
    true,
  );

  const schedulePolicy = () => {
    window.clearTimeout(policyTimer);
    policyTimer = window.setTimeout(applyAuthorSignalPolicy, 50);
  };

  applyAuthorSignalPolicy();
  window.setTimeout(applyAuthorSignalPolicy, 500);
  window.setTimeout(applyAuthorSignalPolicy, 1500);
  new MutationObserver(schedulePolicy).observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function cloneJson(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fallback below */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
  return dbPromise;
}

async function idbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error(`Failed to write ${storeName}`));
  });
}

function getProjectName() {
  return (
    document.getElementById('projectNameText')?.textContent?.trim() ||
    document.getElementById('projectNameEl')?.textContent?.trim() ||
    'AI Canvas'
  );
}

function getProjectId() {
  return String(window.currentProjectId || 'default_v2_project').trim() || 'default_v2_project';
}

function getCanvasData({ sanitizeForPersistence = true } = {}) {
  const tabManager = window.CanvasTabManager;
  if (tabManager?.getMultiDataSnapshot) {
    return cloneJson(tabManager.getMultiDataSnapshot({ sanitizeForPersistence }));
  }
  if (graphStore?.serialize) {
    const state = graphStore.serialize();
    return {
      activeCanvasId: 'canvas_1',
      canvases: [
        {
          id: 'canvas_1',
          name: 'Default canvas',
          nodes: Array.isArray(state?.nodes) ? state.nodes : Object.values(state?.nodes || {}),
          edges: Array.isArray(state?.edges) ? state.edges : Object.values(state?.edges || {}),
          viewport: state?.viewport || { x: 0, y: 0, zoom: 1.1 },
          assets: Array.isArray(state?.assets) ? state.assets : [],
        },
      ],
    };
  }
  const state = graphStore?.getState?.() || {};
  return {
    activeCanvasId: 'canvas_1',
    canvases: [
      {
        id: 'canvas_1',
        name: 'Default canvas',
        nodes: Array.isArray(state.nodes) ? state.nodes : Object.values(state.nodes || {}),
        edges: Array.isArray(state.edges) ? state.edges : Object.values(state.edges || {}),
        viewport: state.viewport || { x: 0, y: 0, zoom: 1.1 },
        assets: Array.isArray(state.assets) ? state.assets : [],
      },
    ],
  };
}

function getSnapshotEnvelope() {
  const data = getCanvasData({ sanitizeForPersistence: true });
  const canvases = Array.isArray(data?.canvases) ? data.canvases : [];
  const nodeCount = canvases.reduce((total, canvas) => {
    const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : Object.values(canvas?.nodes || {});
    return total + nodes.length;
  }, 0);
  const edgeCount = canvases.reduce((total, canvas) => {
    const edges = Array.isArray(canvas?.edges) ? canvas.edges : Object.values(canvas?.edges || {});
    return total + edges.length;
  }, 0);
  return {
    bridgeVersion: BRIDGE_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      id: getProjectId(),
      name: getProjectName(),
    },
    stats: {
      canvasCount: canvases.length,
      nodeCount,
      edgeCount,
    },
    data,
  };
}

function buildAutosaveSignature(snapshot) {
  return JSON.stringify({
    project: snapshot.project,
    stats: snapshot.stats,
    data: snapshot.data,
  });
}

async function saveBrowserSnapshot(reason = 'manual') {
  const snapshot = getSnapshotEnvelope();
  const signature = buildAutosaveSignature(snapshot);
  const savedAt = new Date().toISOString();
  await idbPut(PROJECT_STORE, {
    id: snapshot.project.id,
    name: snapshot.project.name,
    savedAt,
    reason,
    snapshot,
  });
  lastAutosaveSignature = signature;
  lastAutosaveMeta = {
    savedAt,
    reason,
    projectId: snapshot.project.id,
    projectName: snapshot.project.name,
    stats: snapshot.stats,
    apiReachable,
  };
  postToStudio({ type: MESSAGE_AUTOSAVE, payload: lastAutosaveMeta });
  return lastAutosaveMeta;
}

function scheduleAutosave(reason = 'change') {
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(async () => {
    try {
      const snapshot = getSnapshotEnvelope();
      const signature = buildAutosaveSignature(snapshot);
      if (signature === lastAutosaveSignature) return;
      await saveBrowserSnapshot(reason);
    } catch (error) {
      console.warn('[studio-bridge] autosave failed', error);
    }
  }, 900);
}

async function checkApiReachable() {
  if (!API_BASE) {
    apiReachable = null;
    return apiReachable;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${API_BASE}/api/v2/runtime/info`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    let payload = null;
    try {
      payload = await response.clone().json();
    } catch {
      /* non-json runtime payloads are treated as native server responses */
    }
    apiReachable =
      response.ok &&
      payload?.available !== false &&
      payload?.mode !== 'studio-compat';
  } catch {
    apiReachable = false;
  } finally {
    clearTimeout(timer);
    applyRuntimeModeState();
  }
  return apiReachable;
}

function safeFilename(value, fallback = 'ai-canvas') {
  const text = String(value || '').trim() || fallback;
  return text
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function extFromMime(mime) {
  const value = String(mime || '').toLowerCase();
  if (value.includes('jpeg')) return 'jpg';
  if (value.includes('png')) return 'png';
  if (value.includes('webp')) return 'webp';
  if (value.includes('gif')) return 'gif';
  if (value.includes('mp4')) return 'mp4';
  if (value.includes('webm')) return 'webm';
  if (value.includes('mpeg')) return 'mp3';
  if (value.includes('wav')) return 'wav';
  if (value.includes('ogg')) return 'ogg';
  if (value.includes('json')) return 'json';
  if (value.includes('text')) return 'txt';
  return 'bin';
}

function extFromUrl(url, mime) {
  try {
    const pathname = new URL(url, location.href).pathname;
    const match = pathname.match(/\.([a-z0-9]{1,8})$/i);
    if (match) return match[1].toLowerCase();
  } catch {
    /* use mime fallback */
  }
  return extFromMime(mime);
}

function isLikelyFetchableAsset(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  if (/^(data|blob):/i.test(url)) return true;
  if (/^https?:\/\//i.test(url)) return true;
  if (url.startsWith('/')) return true;
  return false;
}

function isLocalPathOnly(value) {
  const text = String(value || '').trim();
  return (
    !!text &&
    !isLikelyFetchableAsset(text) &&
    (/^[a-z]:\\/i.test(text) || text.startsWith('file:') || text.startsWith('~/') || text.startsWith('/Users/'))
  );
}

function collectAssetRefs(value, path = '$', refs = []) {
  if (value == null) return refs;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAssetRefs(item, `${path}[${index}]`, refs));
    return refs;
  }
  if (typeof value !== 'object') return refs;
  for (const [key, raw] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (typeof raw === 'string') {
      if ((ASSET_URL_KEYS.has(key) || LOCAL_PATH_KEYS.has(key)) && raw.trim()) {
        refs.push({
          field: key,
          jsonPath: childPath,
          source: raw.trim(),
          fetchable: isLikelyFetchableAsset(raw),
          localPathOnly: LOCAL_PATH_KEYS.has(key) && isLocalPathOnly(raw),
        });
      }
      continue;
    }
    collectAssetRefs(raw, childPath, refs);
  }
  return refs;
}

function dataUrlToBytes(url) {
  const match = String(url).match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) throw new Error('Invalid data URL');
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const body = match[3] || '';
  const binary = isBase64 ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, mime };
}

async function fetchAssetBytes(source) {
  if (/^data:/i.test(source)) return dataUrlToBytes(source);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(source, {
      signal: controller.signal,
      cache: 'force-cache',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime: blob.type || response.headers.get('content-type') || 'application/octet-stream',
    };
  } finally {
    clearTimeout(timer);
  }
}

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function uint32(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function textBytes(value) {
  return new TextEncoder().encode(String(value));
}

async function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();
  for (const file of files) {
    const nameBytes = textBytes(file.path);
    const data = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(await file.bytes.arrayBuffer());
    const crc = crc32(data);
    const common = [
      ...uint16(20),
      ...uint16(0x0800),
      ...uint16(0),
      ...uint16(dosTime),
      ...uint16(dosDate),
      ...uint32(crc),
      ...uint32(data.length),
      ...uint32(data.length),
      ...uint16(nameBytes.length),
      ...uint16(0),
    ];
    const localHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...common]);
    localParts.push(localHeader, nameBytes, data);
    const centralHeader = new Uint8Array([
      0x50,
      0x4b,
      0x01,
      0x02,
      ...uint16(20),
      ...common,
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint32(0),
      ...uint32(offset),
    ]);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }
  const centralDirectory = concatBytes(centralParts);
  const localDirectory = concatBytes(localParts);
  const end = new Uint8Array([
    0x50,
    0x4b,
    0x05,
    0x06,
    ...uint16(0),
    ...uint16(0),
    ...uint16(files.length),
    ...uint16(files.length),
    ...uint32(centralDirectory.length),
    ...uint32(localDirectory.length),
    ...uint16(0),
  ]);
  return concatBytes([localDirectory, centralDirectory, end]);
}

function downloadBytes(bytes, filename, mime = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function exportPackage() {
  const snapshot = getSnapshotEnvelope();
  const refs = collectAssetRefs(snapshot.data);
  const files = [
    {
      path: 'manifest.json',
      bytes: textBytes(
        JSON.stringify(
          {
            kind: 'myshell-studio-ai-canvaspro-package',
            version: 1,
            bridgeVersion: BRIDGE_VERSION,
            exportedAt: snapshot.exportedAt,
            project: snapshot.project,
            stats: snapshot.stats,
          },
          null,
          2,
        ),
      ),
    },
    {
      path: 'projects.json',
      bytes: textBytes(JSON.stringify(snapshot.data, null, 2)),
    },
  ];
  const manifestAssets = [];
  const skippedAssets = [];
  let assetIndex = 0;

  for (const ref of refs) {
    if (!ref.fetchable) {
      skippedAssets.push({ ...ref, reason: ref.localPathOnly ? 'local-path-only' : 'not-fetchable' });
      continue;
    }
    try {
      const { bytes, mime } = await fetchAssetBytes(ref.source);
      const ext = extFromUrl(ref.source, mime);
      const path = `assets/${String(assetIndex + 1).padStart(3, '0')}-${safeFilename(ref.field)}.${ext}`;
      assetIndex += 1;
      files.push({ path, bytes });
      const asset = {
        id: `${snapshot.project.id}:${assetIndex}`,
        packagePath: path,
        mime,
        size: bytes.length,
        ...ref,
      };
      manifestAssets.push(asset);
      void idbPut(ASSET_STORE, {
        id: asset.id,
        savedAt: new Date().toISOString(),
        source: ref.source,
        mime,
        size: bytes.length,
        blob: new Blob([bytes], { type: mime }),
      }).catch(() => {});
    } catch (error) {
      skippedAssets.push({ ...ref, reason: error?.message || 'fetch-failed' });
    }
  }

  files.push({
    path: 'assets-manifest.json',
    bytes: textBytes(
      JSON.stringify(
        {
          assets: manifestAssets,
          skippedAssets,
        },
        null,
        2,
      ),
    ),
  });
  files.push({
    path: 'README.txt',
    bytes: textBytes(
      [
        'MyShell Studio AI CanvasPro package',
        '',
        'projects.json contains the CanvasPro project data.',
        'assets-manifest.json maps collected asset files back to JSON paths.',
        'Some local-only absolute paths may be listed as skipped assets because browsers cannot read them directly.',
      ].join('\n'),
    ),
  });

  const zipBytes = await createZip(files);
  const filename = `${safeFilename(snapshot.project.name)}-${new Date().toISOString().slice(0, 10)}.canvaspro.zip`;
  downloadBytes(zipBytes, filename, 'application/zip');
  return {
    filename,
    assets: manifestAssets.length,
    skippedAssets: skippedAssets.length,
    stats: snapshot.stats,
  };
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

async function readZipEntries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let eocd = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (readUint32(bytes, index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP package');
  const count = readUint16(bytes, eocd + 10);
  let cursor = readUint32(bytes, eocd + 16);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (readUint32(bytes, cursor) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
    const method = readUint16(bytes, cursor + 10);
    const compressedSize = readUint32(bytes, cursor + 20);
    const fileNameLength = readUint16(bytes, cursor + 28);
    const extraLength = readUint16(bytes, cursor + 30);
    const commentLength = readUint16(bytes, cursor + 32);
    const localOffset = readUint32(bytes, cursor + 42);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + fileNameLength));
    if (method !== 0) throw new Error(`Unsupported ZIP compression for ${name}`);
    const localNameLength = readUint16(bytes, localOffset + 26);
    const localExtraLength = readUint16(bytes, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, bytes.slice(dataOffset, dataOffset + compressedSize));
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function isZipFile(file) {
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04;
}

async function parseProjectFile(file) {
  const lowerName = String(file?.name || '').toLowerCase();
  if (lowerName.endsWith('.zip') || (await isZipFile(file))) {
    const entries = await readZipEntries(file);
    const projectBytes = entries.get('projects.json') || entries.get('project.json');
    if (!projectBytes) throw new Error('Package is missing projects.json');
    const data = JSON.parse(new TextDecoder().decode(projectBytes));
    const manifestBytes = entries.get('manifest.json');
    const manifest = manifestBytes ? JSON.parse(new TextDecoder().decode(manifestBytes)) : null;
    return { data, manifest };
  }
  const text = await file.text();
  return { data: JSON.parse(text), manifest: null };
}

async function importPackage(file) {
  if (!file) throw new Error('No file selected');
  const { data, manifest } = await parseProjectFile(file);
  const normalized = Array.isArray(data?.canvases)
    ? data
    : {
        activeCanvasId: 'canvas_1',
        canvases: [
          {
            id: 'canvas_1',
            name: manifest?.project?.name || file.name.replace(/\.(canvaspro\.zip|zip|json)$/i, ''),
            nodes: Array.isArray(data?.nodes) ? data.nodes : Object.values(data?.nodes || {}),
            edges: Array.isArray(data?.edges) ? data.edges : Object.values(data?.edges || {}),
            viewport: data?.viewport || { x: 0, y: 0, zoom: 1.1 },
          },
        ],
      };
  const manager = window.CanvasTabManager;
  if (manager?.init) {
    manager.init(normalized, { markClean: false });
  } else if (graphStore?.hydrateTrustedSnapshot) {
    graphStore.hydrateTrustedSnapshot(normalized.canvases?.[0] || normalized);
  } else if (graphStore?.loadState) {
    graphStore.loadState(normalized.canvases?.[0] || normalized);
  } else {
    throw new Error('Canvas runtime is not ready');
  }
  const projectName = manifest?.project?.name || file.name.replace(/\.(canvaspro\.zip|zip|json)$/i, '');
  const projectNameEl = document.getElementById('projectNameText');
  if (projectNameEl && projectName) projectNameEl.textContent = projectName;
  window.showToast?.('Studio project package imported', 'success');
  await saveBrowserSnapshot('import');
  return {
    projectName,
    stats: getSnapshotEnvelope().stats,
  };
}

function getSelectedContext() {
  const snapshot = getSnapshotEnvelope();
  const activeCanvas =
    snapshot.data?.canvases?.find((canvas) => canvas.id === snapshot.data.activeCanvasId) ||
    snapshot.data?.canvases?.[0] ||
    null;
  const state = graphStore?.getState?.() || {};
  const selectedIds = Array.isArray(state.selectedNodeIds) ? state.selectedNodeIds : [];
  const nodes = Array.isArray(activeCanvas?.nodes) ? activeCanvas.nodes : Object.values(activeCanvas?.nodes || {});
  const selectedNodes = selectedIds.length
    ? nodes.filter((node) => selectedIds.includes(node?.id))
    : [];
  const selectedIdSet = new Set(selectedNodes.map((node) => node?.id).filter(Boolean));
  const edges = Array.isArray(activeCanvas?.edges) ? activeCanvas.edges : Object.values(activeCanvas?.edges || {});
  return {
    project: snapshot.project,
    activeCanvasId: activeCanvas?.id || '',
    nodes: selectedNodes,
    edges: edges.filter((edge) => selectedIdSet.has(edge?.sourceId || edge?.srcId) && selectedIdSet.has(edge?.targetId)),
  };
}

function openShortcutsSettings() {
  document.getElementById('btnOpenSettings')?.click?.();
  const shortcutsNav = document.querySelector('[data-pane="shortcuts"]');
  shortcutsNav?.click?.();
  return {
    opened: Boolean(shortcutsNav || document.getElementById('pane-shortcuts')),
  };
}

async function handleAction(action, payload = {}) {
  switch (action) {
    case 'getStatus':
      return {
        ready: true,
        bridgeVersion: BRIDGE_VERSION,
        apiReachable,
        lastAutosave: lastAutosaveMeta,
        stats: getSnapshotEnvelope().stats,
      };
    case 'saveSnapshot':
      return await saveBrowserSnapshot(payload.reason || 'manual');
    case 'exportPackage':
      return await exportPackage();
    case 'importPackage':
      return await importPackage(payload.file);
    case 'getSelectedContext':
      return getSelectedContext();
    case 'openShortcuts':
      return openShortcutsSettings();
    default:
      throw new Error(`Unknown Studio bridge action: ${action}`);
  }
}

window.addEventListener('message', async (event) => {
  if (bridgeAlreadyInstalled || !isTrustedStudioRequest(event)) return;
  const message = event.data || {};
  const id = message.id;
  try {
    const payload = await handleAction(message.action, message.payload || {});
    event.source?.postMessage({ type: MESSAGE_RESPONSE, id, ok: true, payload }, event.origin);
  } catch (error) {
    event.source?.postMessage(
      {
        type: MESSAGE_RESPONSE,
        id,
        ok: false,
        error: error?.message || String(error),
      },
      event.origin,
    );
  }
});

function installAutosaveHooks() {
  graphStore?.subscribe?.(() => scheduleAutosave('graph-change'));
  window.addEventListener('aicanvas:dirty-state-changed', () => scheduleAutosave('dirty-state'));
  window.addEventListener('pagehide', () => {
    void saveBrowserSnapshot('pagehide').catch(() => {});
  });
  window.setTimeout(() => scheduleAutosave('boot'), 1600);
}

async function boot() {
  if (bridgeAlreadyInstalled) return;
  installOfflineGenerationGuard();
  installAuthorSignalPolicy();
  installAutosaveHooks();
  await checkApiReachable();
  window.setInterval(checkApiReachable, 15000);
  postToStudio(
    {
      type: MESSAGE_READY,
      payload: {
        ready: true,
        bridgeVersion: BRIDGE_VERSION,
        apiReachable,
        stats: getSnapshotEnvelope().stats,
      },
    },
  );
}

void boot().catch((error) => {
  console.warn('[studio-bridge] boot failed', error);
  postToStudio(
    {
      type: MESSAGE_READY,
      payload: {
        ready: false,
        bridgeVersion: BRIDGE_VERSION,
        error: error?.message || String(error),
      },
    },
  );
});

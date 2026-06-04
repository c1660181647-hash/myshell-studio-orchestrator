import { graphStore } from './src/core/stores/appStore.js';

const BRIDGE_VERSION = '2026.06.04';
const DB_NAME = 'myshell-studio-ai-canvaspro';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const ASSET_STORE = 'assets';
const MESSAGE_REQUEST = 'aicanvas-studio:request';
const MESSAGE_RESPONSE = 'aicanvas-studio:response';
const MESSAGE_READY = 'aicanvas-studio:ready';
const MESSAGE_AUTOSAVE = 'aicanvas-studio:autosave';
const API_BASE = location.pathname.startsWith('/ai-canvaspro/') ? '/ai-canvaspro-api' : '';
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
  window.parent?.postMessage({ type: MESSAGE_AUTOSAVE, payload: lastAutosaveMeta }, '*');
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
    apiReachable = response.ok;
  } catch {
    apiReachable = false;
  } finally {
    clearTimeout(timer);
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
  const message = event.data || {};
  if (message.type !== MESSAGE_REQUEST) return;
  const id = message.id || '';
  try {
    const payload = await handleAction(message.action, message.payload || {});
    event.source?.postMessage({ type: MESSAGE_RESPONSE, id, ok: true, payload }, event.origin || '*');
  } catch (error) {
    event.source?.postMessage(
      {
        type: MESSAGE_RESPONSE,
        id,
        ok: false,
        error: error?.message || String(error),
      },
      event.origin || '*',
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
  installAutosaveHooks();
  await checkApiReachable();
  window.setInterval(checkApiReachable, 15000);
  window.parent?.postMessage(
    {
      type: MESSAGE_READY,
      payload: {
        ready: true,
        bridgeVersion: BRIDGE_VERSION,
        apiReachable,
        stats: getSnapshotEnvelope().stats,
      },
    },
    '*',
  );
}

void boot().catch((error) => {
  console.warn('[studio-bridge] boot failed', error);
  window.parent?.postMessage(
    {
      type: MESSAGE_READY,
      payload: {
        ready: false,
        bridgeVersion: BRIDGE_VERSION,
        error: error?.message || String(error),
      },
    },
    '*',
  );
});

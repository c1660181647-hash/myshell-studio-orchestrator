import {
  ArrowLeft,
  Clipboard,
  Download,
  ExternalLink,
  Keyboard,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const CANVASPRO_ENTRY = '/ai-canvaspro/index.html';
const CANVASPRO_BRIDGE_SRC = '/ai-canvaspro/studio-bridge.js';
const BRIDGE_REQUEST = 'aicanvas-studio:request';
const BRIDGE_RESPONSE = 'aicanvas-studio:response';
const BRIDGE_READY = 'aicanvas-studio:ready';
const BRIDGE_AUTOSAVE = 'aicanvas-studio:autosave';

type BridgeStats = {
  canvasCount?: number;
  edgeCount?: number;
  nodeCount?: number;
};

type BridgeStatus = {
  apiReachable?: boolean | null;
  bridgeVersion?: string;
  error?: string;
  lastAutosave?: AutosavePayload | null;
  ready?: boolean;
  stats?: BridgeStats;
};

type AutosavePayload = {
  apiReachable?: boolean | null;
  projectName?: string;
  reason?: string;
  savedAt?: string;
  stats?: BridgeStats;
};

type BridgeResponseMessage = {
  error?: string;
  id?: string;
  ok?: boolean;
  payload?: unknown;
  type?: string;
};

type PendingBridgeRequest = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
  timeout: number;
};

interface CanvasProProps {
  embeddedInStudio?: boolean;
  onBackToStudio?: () => void;
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSavedAt(value?: string) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

export default function CanvasPro({ embeddedInStudio = false, onBackToStudio }: CanvasProProps) {
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRequests = useRef<Map<string, PendingBridgeRequest>>(new Map());
  const [reloadKey, setReloadKey] = useState(0);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ ready: false });
  const [lastAutosave, setLastAutosave] = useState<AutosavePayload | null>(null);
  const [busyAction, setBusyAction] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const src = useMemo(
    () => `${CANVASPRO_ENTRY}?embedded=studio&reload=${reloadKey}`,
    [reloadKey],
  );

  useEffect(() => {
    setBridgeStatus({ ready: false });
    setLastAutosave(null);
  }, [reloadKey]);

  useEffect(() => {
    return () => {
      pendingRequests.current.forEach((request) => {
        window.clearTimeout(request.timeout);
        request.reject(new Error('CanvasPro page was closed'));
      });
      pendingRequests.current.clear();
    };
  }, []);

  const sendCanvasCommand = useCallback(
    <T,>(action: string, payload?: Record<string, unknown>, timeoutMs = 30000) => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return Promise.reject(new Error('CanvasPro iframe is not ready'));
      const id = createRequestId();
      return new Promise<T>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingRequests.current.delete(id);
          reject(new Error(`CanvasPro bridge timed out: ${action}`));
        }, timeoutMs);
        pendingRequests.current.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeout,
        });
        target.postMessage(
          {
            action,
            id,
            payload: payload || {},
            type: BRIDGE_REQUEST,
          },
          window.location.origin,
        );
      });
    },
    [],
  );

  const injectStudioBridge = useCallback(() => {
    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    if (!doc) return;
    if (doc.querySelector('[data-canvaspro-placeholder="1"]')) return;
    if (doc.getElementById('myshell-studio-canvaspro-bridge')) return;
    const script = doc.createElement('script');
    script.id = 'myshell-studio-canvaspro-bridge';
    script.type = 'module';
    script.src = CANVASPRO_BRIDGE_SRC;
    doc.head.appendChild(script);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<BridgeResponseMessage>) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data || {};
      if (message.type === BRIDGE_READY) {
        setBridgeStatus((current) => ({
          ...current,
          ...((message.payload as BridgeStatus | undefined) || {}),
          ready: Boolean((message.payload as BridgeStatus | undefined)?.ready),
        }));
        return;
      }
      if (message.type === BRIDGE_AUTOSAVE) {
        const payload = (message.payload as AutosavePayload | undefined) || {};
        setLastAutosave(payload);
        setBridgeStatus((current) => ({
          ...current,
          apiReachable: payload.apiReachable,
          lastAutosave: payload,
          stats: payload.stats || current.stats,
        }));
        return;
      }
      if (message.type !== BRIDGE_RESPONSE || !message.id) return;
      const pending = pendingRequests.current.get(message.id);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      pendingRequests.current.delete(message.id);
      if (message.ok) {
        pending.resolve(message.payload);
      } else {
        pending.reject(new Error(message.error || 'CanvasPro bridge request failed'));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const runBridgeAction = useCallback(
    async <T,>(
      action: string,
      work: () => Promise<T>,
      successMessage: (result: T) => string,
    ) => {
      setBusyAction(action);
      setNotice('');
      try {
        const result = await work();
        setNotice(successMessage(result));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyAction('');
      }
    },
    [],
  );

  const saveSnapshot = useCallback(() => {
    void runBridgeAction(
      'saveSnapshot',
      () => sendCanvasCommand<AutosavePayload>('saveSnapshot', { reason: 'manual' }),
      (result) => `离线快照已保存${formatSavedAt(result.savedAt) ? ` · ${formatSavedAt(result.savedAt)}` : ''}`,
    );
  }, [runBridgeAction, sendCanvasCommand]);

  const exportPackage = useCallback(() => {
    void runBridgeAction(
      'exportPackage',
      () =>
        sendCanvasCommand<{ assets?: number; filename?: string; skippedAssets?: number }>(
          'exportPackage',
          {},
          90000,
        ),
      (result) =>
        `项目包已导出 · ${result.assets || 0} 个资产${result.skippedAssets ? `，${result.skippedAssets} 个保留引用` : ''}`,
    );
  }, [runBridgeAction, sendCanvasCommand]);

  const copySelectedContext = useCallback(() => {
    void runBridgeAction(
      'copySelectedContext',
      async () => {
        const context = await sendCanvasCommand<{ nodes?: unknown[] }>('getSelectedContext');
        const text = JSON.stringify(context, null, 2);
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        return context;
      },
      (context) => `已复制 ${context.nodes?.length || 0} 个选中节点上下文`,
    );
  }, [runBridgeAction, sendCanvasCommand]);

  const openShortcuts = useCallback(() => {
    void runBridgeAction(
      'openShortcuts',
      () => sendCanvasCommand<{ opened?: boolean }>('openShortcuts'),
      (result) => (result.opened ? '已打开快捷键设置' : '快捷键设置暂不可用'),
    );
  }, [runBridgeAction, sendCanvasCommand]);

  const importPackageFile = useCallback(
    (file: File) => {
      void runBridgeAction(
        'importPackage',
        () =>
          sendCanvasCommand<{ projectName?: string; stats?: BridgeStats }>(
            'importPackage',
            { file },
            90000,
          ),
        (result) => `已导入 ${result.projectName || 'CanvasPro 项目'}`,
      );
    },
    [runBridgeAction, sendCanvasCommand],
  );

  const bridgeReady = Boolean(bridgeStatus.ready);
  const apiReachable = bridgeStatus.apiReachable;
  const statusLabel = !bridgeReady
    ? 'Bridge 启动中'
    : apiReachable === false
      ? '离线快照'
      : apiReachable === true
        ? '本地服务已连'
        : 'Studio Bridge';
  const savedLabel = formatSavedAt(lastAutosave?.savedAt || bridgeStatus.lastAutosave?.savedAt);
  const nodeCount = bridgeStatus.stats?.nodeCount ?? lastAutosave?.stats?.nodeCount;
  const showBackButton = Boolean(onBackToStudio) || !embeddedInStudio;
  const backLabel = embeddedInStudio ? 'Command' : 'Studio';

  return (
    <main
      data-testid="canvaspro-workspace"
      className="relative h-full w-full overflow-hidden bg-Cr-Bg-soft-v2"
    >
      <iframe
        ref={iframeRef}
        key={reloadKey}
        data-testid="canvaspro-iframe"
        title="AI CanvasPro"
        src={src}
        className="h-full w-full border-0"
        allow="clipboard-read; clipboard-write; fullscreen; web-share"
        onLoad={injectStudioBridge}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".canvaspro.zip,.zip,.json,application/json,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) importPackageFile(file);
        }}
      />
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-[130] flex items-center justify-between">
        {showBackButton ? (
          <button
            type="button"
            onClick={() => {
              if (onBackToStudio) {
                onBackToStudio();
              } else {
                navigate('/dreamy');
              }
            }}
            className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2/90 px-3 text-sm font-semibold text-Cr-text-default-v2 shadow-[0_10px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl active:bg-Cr-beta-white-8-v2"
            aria-label="Back to Studio command workspace"
            title="Back to Studio command workspace"
          >
            <ArrowLeft size={16} />
            <span>{backLabel}</span>
          </button>
        ) : (
          <div />
        )}
        <div className="pointer-events-auto flex max-w-[calc(100vw-108px)] items-center gap-2 overflow-x-auto rounded-full-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2/90 p-1 shadow-[0_10px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <div
            data-testid="canvaspro-bridge-status"
            className="hidden h-9 shrink-0 items-center gap-2 rounded-full-v2 border border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3 text-xs font-semibold text-Cr-text-subtler-v2 sm:inline-flex"
            title={savedLabel ? `最近离线快照 ${savedLabel}` : statusLabel}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                bridgeReady
                  ? apiReachable === false
                    ? 'bg-yellow-400'
                    : 'bg-green-400'
                  : 'bg-Cr-text-disabled-v2'
              }`}
            />
            <span className="whitespace-nowrap">{statusLabel}</span>
            {typeof nodeCount === 'number' ? (
              <span className="whitespace-nowrap text-Cr-text-disabled-v2">{nodeCount} nodes</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={saveSnapshot}
            disabled={!bridgeReady || Boolean(busyAction)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full-v2 text-Cr-text-default-v2 disabled:opacity-45 active:bg-Cr-beta-white-8-v2"
            aria-label="Save offline snapshot"
            title="保存离线快照"
          >
            <Save size={16} />
          </button>
          <button
            type="button"
            onClick={exportPackage}
            disabled={!bridgeReady || Boolean(busyAction)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full-v2 text-Cr-text-default-v2 disabled:opacity-45 active:bg-Cr-beta-white-8-v2"
            aria-label="Export CanvasPro package"
            title="导出项目包"
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!bridgeReady || Boolean(busyAction)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full-v2 text-Cr-text-default-v2 disabled:opacity-45 active:bg-Cr-beta-white-8-v2"
            aria-label="Import CanvasPro package"
            title="导入项目包或 JSON"
          >
            <Upload size={16} />
          </button>
          <button
            type="button"
            onClick={copySelectedContext}
            disabled={!bridgeReady || Boolean(busyAction)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full-v2 text-Cr-text-default-v2 disabled:opacity-45 active:bg-Cr-beta-white-8-v2"
            aria-label="Copy selected nodes context"
            title="复制选中节点上下文"
          >
            <Clipboard size={16} />
          </button>
          <button
            type="button"
            onClick={openShortcuts}
            disabled={!bridgeReady || Boolean(busyAction)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full-v2 text-Cr-text-default-v2 disabled:opacity-45 active:bg-Cr-beta-white-8-v2"
            aria-label="Open CanvasPro shortcuts"
            title="打开快捷键设置"
          >
            <Keyboard size={16} />
          </button>
          <div className="h-5 w-px shrink-0 bg-Cr-border-default-v2" />
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full-v2 text-Cr-text-default-v2 active:bg-Cr-beta-white-8-v2"
            aria-label="Reload AI CanvasPro"
            title="Reload AI CanvasPro"
          >
            <RotateCcw size={16} />
          </button>
          <a
            href={CANVASPRO_ENTRY}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full-v2 text-Cr-text-default-v2 active:bg-Cr-beta-white-8-v2"
            aria-label="Open AI CanvasPro in a new tab"
            title="Open AI CanvasPro in a new tab"
          >
            <ExternalLink size={16} />
          </a>
        </div>
      </div>
      {notice ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[130] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-full-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2/92 px-4 py-2 text-sm font-semibold text-Cr-text-default-v2 shadow-[0_10px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          {notice}
        </div>
      ) : null}
    </main>
  );
}

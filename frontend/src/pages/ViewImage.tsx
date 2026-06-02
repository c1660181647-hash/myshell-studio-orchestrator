import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Loader2,
  RefreshCcw,
  RotateCcw,
} from 'lucide-react';
import { BackNavBar } from '../components/NavBar';
import {
  cancelTask,
  deleteTask,
  fetchTaskDetail,
  hasTelegramInitData,
  reportTaskDownload,
  retryTask,
  type LibraryGenerateResult,
} from '../services/api';
import { openExternalLink, useTelegramBackButton } from '../hooks/useTelegram';
import { trackEvent } from '../services/tracking';

export type LibraryDetailStatus =
  | 'auth_missing'
  | 'done'
  | 'empty'
  | 'error'
  | 'queued'
  | 'running';

export interface LibraryDetailMedia {
  kind: 'image' | 'video';
  url: string;
  posterUrl: string;
  thumbUrl: string;
  aspectRatio: string;
}

export interface LibraryDetailViewState {
  task: LibraryGenerateResult;
  media: LibraryDetailMedia | null;
  status: LibraryDetailStatus;
}

type TaskDetailEnvelope = {
  task?: unknown;
  taskDetail?: unknown;
  detail?: unknown;
  result?: unknown;
  generateResults?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asTaskCandidate(value: unknown): LibraryGenerateResult | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.taskId === 'string' ||
    typeof value.status === 'string' ||
    isRecord(value.result)
  ) {
    return value as unknown as LibraryGenerateResult;
  }
  return null;
}

export function normalizeLibraryTaskDetail(raw: unknown): LibraryGenerateResult | null {
  const direct = asTaskCandidate(raw);
  if (direct) return direct;
  if (!isRecord(raw)) return null;

  const envelope = raw as TaskDetailEnvelope;
  const nestedCandidates = [
    envelope.task,
    envelope.taskDetail,
    envelope.detail,
    envelope.result,
  ];
  for (const candidate of nestedCandidates) {
    const task = asTaskCandidate(candidate);
    if (task) return task;
  }

  if (Array.isArray(envelope.generateResults)) {
    for (const candidate of envelope.generateResults) {
      const task = asTaskCandidate(candidate);
      if (task) return task;
    }
  }

  return null;
}

export function getLibraryDetailStatus(task: LibraryGenerateResult): LibraryDetailStatus {
  if (task.status === 'queued') return 'queued';
  if (task.status === 'running') return 'running';
  if (task.status === 'error' || task.status === 'rejected') return 'error';
  return resolveLibraryDetailMedia(task) ? 'done' : 'empty';
}

export function resolveLibraryDetailMedia(task: LibraryGenerateResult): LibraryDetailMedia | null {
  const result = task.result || {};
  const outputUrl = result.outputImg || '';
  const posterUrl = result.outputPoster || result.outputPreview || task.imageUrl || '';
  const fallbackThumb = posterUrl || outputUrl || result.inputImg?.[0] || '';
  if (!outputUrl) return null;

  const width = Number.parseInt(result.width || '', 10);
  const height = Number.parseInt(result.height || '', 10);
  const aspectRatio = width > 0 && height > 0 ? `${width}/${height}` : '3/4';
  const kind =
    task.botType === 'video' ||
    /\.mp4($|\?)/i.test(outputUrl) ||
    /\.webm($|\?)/i.test(outputUrl)
      ? 'video'
      : 'image';

  return {
    kind,
    url: outputUrl,
    posterUrl,
    thumbUrl: fallbackThumb,
    aspectRatio,
  };
}

function formatStartTime(startTime: string): string {
  const timestamp = Number(startTime);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function getProgress(task: LibraryGenerateResult): number {
  const estimate = Number.parseInt(task.estimateTaskDuration || '', 10) || 300_000;
  const start = Number.parseInt(task.startTime || '', 10);
  if (!start) return 8;
  const elapsed = Date.now() - start;
  return Math.min(Math.max((elapsed / estimate) * 100, 8), 95);
}

function getErrorMessage(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  return String(error);
}

function MediaShell({
  children,
  media,
}: {
  children: React.ReactNode;
  media: LibraryDetailMedia | null;
}) {
  return (
    <div className="relative flex min-h-[360px] flex-1 items-center justify-center overflow-hidden bg-black px-3 py-5">
      {media?.thumbUrl && (
        <img
          src={media.thumbUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-20 blur-2xl"
        />
      )}
      <div className="relative z-[1] flex h-full w-full items-center justify-center">
        {children}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[320px] flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full-v2 bg-Cr-Bg-surface-default-v2 text-Cr-text-static-white-v2">
        {icon}
      </div>
      <div className="mb-2 text-lg font-semibold text-Cr-text-default-v2">
        {title}
      </div>
      <div className="mb-5 text-sm leading-5 text-Cr-text-subtler-v2">
        {description}
      </div>
      {action}
    </div>
  );
}

export default function ViewImage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation('library');
  const [viewState, setViewState] = useState<LibraryDetailViewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authMissing, setAuthMissing] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const loadTask = useCallback(async () => {
    if (!id) {
      setViewState(null);
      setLoading(false);
      setError('Missing library task id.');
      return;
    }
    if (!hasTelegramInitData()) {
      setAuthMissing(true);
      setViewState(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setAuthMissing(false);
    try {
      const raw = await fetchTaskDetail(id);
      const task = normalizeLibraryTaskDetail(raw);
      if (!task) {
        throw new Error('Task detail response did not include a renderable task.');
      }
      const state: LibraryDetailViewState = {
        task,
        media: resolveLibraryDetailMedia(task),
        status: getLibraryDetailStatus(task),
      };
      setViewState(state);
      setVideoError(false);
      trackEvent('miniapp_task_view', {
        task_id: task.taskId || id,
        status: state.status,
        source: 'library_detail_route',
      });
    } catch (err) {
      setViewState(null);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  useTelegramBackButton(() => navigate(-1));

  const title = useMemo(() => {
    if (viewState?.task.botName) return viewState.task.botName;
    if (id) return `Task ${id}`;
    return t('library:title');
  }, [id, t, viewState?.task.botName]);

  const startedAt = formatStartTime(viewState?.task.startTime || '');
  const canOpenMedia = Boolean(viewState?.media?.url);
  const canCancel =
    viewState?.status === 'queued' || viewState?.status === 'running';
  const canRetry =
    viewState?.status === 'error' || viewState?.status === 'empty';

  const runAction = async (
    action: 'cancel' | 'delete' | 'download' | 'retry',
    fn: () => Promise<void>,
  ) => {
    if (!id || actionBusy) return;
    setActionBusy(action);
    try {
      await fn();
      trackEvent('miniapp_result_action', {
        task_id: viewState?.task.taskId || id,
        action,
        source: 'library_detail_route',
      });
      if (action === 'delete') {
        navigate('/library');
        return;
      }
      if (action !== 'download') {
        await loadTask();
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionBusy(null);
    }
  };

  const media = viewState?.media || null;

  return (
    <div className="flex h-full flex-col bg-Cr-Bg-soft-v2 text-Cr-text-default-v2">
      <BackNavBar title={title} />

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={28} className="animate-spin text-Cr-text-subtler-v2" />
        </div>
      ) : authMissing ? (
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title="Authentication required"
          description="Open this page from the Telegram miniapp or provide dev init data before loading a Library task."
          action={
            <button
              type="button"
              onClick={() => navigate('/library')}
              className="h-11 rounded-md-v2 bg-CCr-button-brand-bg_default-v2 px-5 text-sm font-semibold text-CCr-button-brand-fg_default-v2"
            >
              {t('library:title')}
            </button>
          }
        />
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title={t('library:failedToLoad')}
          description={error}
          action={
            <button
              type="button"
              onClick={() => void loadTask()}
              className="inline-flex h-11 items-center gap-2 rounded-md-v2 bg-CCr-button-brand-bg_default-v2 px-5 text-sm font-semibold text-CCr-button-brand-fg_default-v2"
            >
              <RefreshCcw size={16} />
              {t('common:retry')}
            </button>
          }
        />
      ) : viewState?.status === 'queued' || viewState?.status === 'running' ? (
        <MediaShell media={media}>
          <div className="w-full max-w-[340px] rounded-lg bg-Cr-Bg-surface-default-v2 p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-Cr-text-default-v2">
                  {viewState.status === 'queued'
                    ? t('library:inQueue')
                    : t('library:generatingStatus')}
                </div>
                {startedAt && (
                  <div className="mt-1 text-xs text-Cr-text-subtler-v2">
                    {startedAt}
                  </div>
                )}
              </div>
              <Loader2 size={20} className="animate-spin text-dreamy-brand-hot-v2" />
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-dreamy-brand-hot-v2 transition-[width] duration-500"
                style={{ width: `${getProgress(viewState.task)}%` }}
              />
            </div>
          </div>
        </MediaShell>
      ) : viewState?.status === 'error' ? (
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title={t('library:generationFailed')}
          description={viewState.task.result?.errMsg || 'The task failed before producing media.'}
        />
      ) : viewState?.status === 'empty' || !media ? (
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title="No media available"
          description="This task loaded successfully, but it does not include a usable output URL yet."
        />
      ) : (
        <MediaShell media={media}>
          {media.kind === 'video' && !videoError ? (
            <video
              src={media.url}
              poster={media.posterUrl}
              className="max-h-full w-full max-w-full rounded-lg object-contain"
              controls
              autoPlay
              loop
              playsInline
              onError={() => {
                setVideoError(true);
                trackEvent('miniapp_format_not_supported', {
                  task_id: viewState?.task.taskId || id,
                  slug_id: viewState?.task.slugId || '',
                  bot_name: viewState?.task.botName || '',
                  video_url: media.url,
                  source: 'library_detail_route',
                });
              }}
            />
          ) : videoError ? (
            <EmptyState
              icon={<AlertTriangle size={24} />}
              title={t('library:formatNotSupported')}
              description={t('library:videoFallbackDesc')}
              action={
                <button
                  type="button"
                  onClick={() => openExternalLink(media.url)}
                  className="inline-flex h-11 items-center gap-2 rounded-md-v2 bg-CCr-button-brand-bg_default-v2 px-5 text-sm font-semibold text-CCr-button-brand-fg_default-v2"
                >
                  <ExternalLink size={16} />
                  {t('library:openInBrowser')}
                </button>
              }
            />
          ) : (
            <img
              src={media.url}
              alt={viewState?.task.botName || ''}
              className="max-h-full max-w-full rounded-lg object-contain"
              style={{ aspectRatio: media.aspectRatio }}
            />
          )}
        </MediaShell>
      )}

      {viewState && !loading && !error && !authMissing && (
        <div className="border-t border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-4 py-3 pb-[calc(env(safe-area-inset-bottom,16px)+12px)]">
          <div className="mb-3 flex min-h-10 items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-Cr-text-default-v2">
                {viewState.task.botName || viewState.task.taskId || id}
              </div>
              <div className="truncate text-xs text-Cr-text-subtler-v2">
                {viewState.status}
                {startedAt ? ` · ${startedAt}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadTask()}
              className="flex size-10 shrink-0 items-center justify-center rounded-md-v2 bg-CCr-button-tertiary-bg_default-v2 text-Cr-text-static-white-v2"
              aria-label="Refresh task"
            >
              <RefreshCcw size={18} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {canOpenMedia && (
              <button
                type="button"
                onClick={() =>
                  void runAction('download', async () => {
                    await reportTaskDownload(viewState.task.taskId || id);
                    openExternalLink(media?.url || '');
                  })
                }
                disabled={actionBusy === 'download'}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md-v2 bg-CCr-button-brand-bg_default-v2 px-3 text-sm font-semibold text-CCr-button-brand-fg_default-v2 disabled:opacity-60"
              >
                <Download size={18} />
                {t('library:download')}
              </button>
            )}
            {canRetry && (
              <button
                type="button"
                onClick={() =>
                  void runAction('retry', async () => retryTask(viewState.task.taskId || id))
                }
                disabled={actionBusy === 'retry'}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md-v2 bg-CCr-button-brand-bg_default-v2 px-3 text-sm font-semibold text-CCr-button-brand-fg_default-v2 disabled:opacity-60"
              >
                <RotateCcw size={18} />
                {t('common:retry')}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() =>
                  void runAction('cancel', async () => cancelTask(viewState.task.taskId || id))
                }
                disabled={actionBusy === 'cancel'}
                className="inline-flex h-12 items-center justify-center rounded-md-v2 bg-CCr-button-tertiary-bg_default-v2 px-3 text-sm font-semibold text-Cr-text-default-v2 disabled:opacity-60"
              >
                {t('library:cancel')}
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                void runAction('delete', async () => deleteTask(viewState.task.taskId || id))
              }
              disabled={actionBusy === 'delete'}
              className="inline-flex h-12 items-center justify-center rounded-md-v2 bg-CCr-button-tertiary-bg_default-v2 px-3 text-sm font-semibold text-Cr-text-critical-default-v2 disabled:opacity-60"
            >
              {t('common:delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

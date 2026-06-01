import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Clapperboard,
  Clock3,
  Film,
  GitBranch,
  ImagePlus,
  Layers3,
  Loader2,
  Maximize2,
  PanelRightOpen,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import exampleGood from '../assets/example-good.png';
import exampleMultiple from '../assets/example-multiple.png';
import { useEnergy } from '../contexts/EnergyContext';
import { fetchGenerateResult } from '../services/api';
import {
  extractGenerateTaskMedia,
  postStudioClientResult,
  resetStudioProject,
  resolveStudioAssetUrl,
  streamStudioRun,
  submitDreamyMiniappJob,
} from '../services/dreamyUnified';
import type {
  StudioAction,
  StudioAgentNode,
  StudioExecutionRequest,
  StudioMode,
  StudioProgressEvent,
  StudioProject,
  StudioRouteEvent,
  StudioRunEvent,
  StudioSegment,
} from '../services/dreamyUnified';
import { trackEvent } from '../services/tracking';

type TabKey = 'chat' | 'preview';

interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  action?: StudioAction;
  pending?: boolean;
  error?: string;
  route?: StudioRouteEvent;
  steps?: StudioProgressEvent[];
  segmentId?: string;
}

const DEFAULT_DREAMY_SLUG = 'ai-porn-generator';

const LOCAL_POSTERS = [exampleGood, exampleMultiple];

const EMPTY_GRAPH: StudioAgentNode[] = [
  { id: 'intent-router', label: 'Intent Router', status: 'idle', detail: 'Waiting for prompt' },
  { id: 'asset-planner', label: 'Asset Planner', status: 'idle', detail: 'No source selected' },
  { id: 'dreamy-executor', label: 'Dreamy Executor', status: 'idle', detail: 'Standing by' },
  { id: 'timeline', label: 'Timeline', status: 'idle', detail: 'No segments yet' },
];

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function statusTone(status?: string): string {
  if (status === 'done') return 'text-Cr-text-success-default-v2';
  if (status === 'error') return 'text-Cr-text-critical-default-v2';
  if (status === 'running' || status === 'queued') return 'text-dreamy-brand-hot-v2';
  return 'text-Cr-text-subtler-v2';
}

function actionLabel(action: StudioAction): string {
  return {
    generate: 'Generate',
    extend: 'Extend',
    restyle: 'Restyle',
    'retry-agent': 'Try agent',
  }[action];
}

function getSegmentMedia(segment?: StudioSegment | null): string {
  return resolveStudioAssetUrl(segment?.url || segment?.posterUrl);
}

function createLocalProject(mode: StudioMode, message: string, action: StudioAction, parent?: StudioSegment): StudioProject {
  const projectId = makeId('local_project');
  const segment: StudioSegment = {
    id: makeId('segment'),
    type: action === 'extend' ? 'video' : 'image',
    url: '',
    posterUrl: LOCAL_POSTERS[Math.floor(Math.random() * LOCAL_POSTERS.length)],
    prompt: message,
    botSlug: action === 'extend' ? 'sora-video-generator' : DEFAULT_DREAMY_SLUG,
    botName: action === 'extend' ? 'Sora Video Generator' : 'Dreamy Agent',
    action,
    parentSegmentId: parent?.id,
    status: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return {
    projectId,
    conversationId: makeId('conversation'),
    mode,
    messages: [],
    segments: [segment],
    selectedSegmentId: segment.id,
    agentGraph: [
      { id: 'intent-router', label: 'Intent Router', status: 'done', detail: 'Local route fallback' },
      { id: 'asset-planner', label: 'Asset Planner', status: parent ? 'done' : 'queued', detail: parent?.botName || 'Prompt only' },
      { id: 'dreamy-executor', label: 'Dreamy Executor', status: 'queued', detail: 'Waiting for Studio backend' },
      { id: 'timeline', label: 'Timeline', status: 'queued', detail: 'Draft segment added' },
    ],
    updatedAt: nowIso(),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function Pill({ children, tone = 'default' }: { children: string; tone?: 'default' | 'hot' | 'success' | 'danger' }) {
  const toneClass = {
    default: 'border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 text-Cr-text-subtler-v2',
    hot: 'border-dreamy-brand-hot-v2/50 bg-dreamy-brand-hot-v2/15 text-dreamy-brand-hot-v2',
    success: 'border-Cr-border-success-v2 bg-Cr-Bg-success-default-v2 text-Cr-text-success-default-v2',
    danger: 'border-Cr-border-critical-v2 bg-Cr-Bg-critical-default-v2 text-Cr-text-critical-bolder-v2',
  }[tone];
  return (
    <span className={`inline-flex h-6 items-center rounded-md-v2 border px-2 text-[11px] font-semibold ${toneClass}`}>
      {children}
    </span>
  );
}

function ModeSwitch({ mode, onChange }: { mode: StudioMode; onChange: (mode: StudioMode) => void }) {
  return (
    <div className="grid h-9 grid-cols-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 p-1">
      {(['player', 'canvas'] as StudioMode[]).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`rounded-md-v2 text-xs font-semibold capitalize transition-colors ${
            mode === item
              ? 'bg-Cr-beta-white-12-v2 text-Cr-text-default-v2 shadow-sm'
              : 'text-Cr-text-subtler-v2 active:text-Cr-text-default-v2'
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function ThinkingSteps({ steps = [] }: { steps?: StudioProgressEvent[] }) {
  if (!steps.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {steps.map((step, index) => (
        <div key={`${step.step}_${index}`} className="rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-3-v2 p-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase text-Cr-text-subtler-v2">{step.step}</div>
            {typeof step.progress === 'number' && (
              <div className="text-[11px] font-semibold text-dreamy-brand-hot-v2">{step.progress}%</div>
            )}
          </div>
          <div className="mt-1 text-xs leading-5 text-Cr-text-subtle-v2">{step.message}</div>
          {typeof step.progress === 'number' && (
            <div className="mt-2 h-1 overflow-hidden rounded-full-v2 bg-Cr-beta-white-8-v2">
              <div className="h-full rounded-full-v2 bg-dreamy-brand-hot-v2" style={{ width: `${step.progress}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ChatMessage({
  item,
  onAction,
  selectedSegment,
  submitting,
}: {
  item: ChatItem;
  selectedSegment?: StudioSegment | null;
  submitting: boolean;
  onAction: (action: StudioAction, prompt?: string, source?: StudioSegment | null) => void;
}) {
  const isUser = item.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[92%] rounded-xl-v2 px-3 py-3 ${
          isUser
            ? 'bg-dreamy-brand-hot-v2 text-white'
            : 'border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2 text-Cr-text-default-v2'
        }`}
      >
        {!isUser && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill tone={item.pending ? 'hot' : item.error ? 'danger' : 'default'}>
              {item.pending ? 'Routing' : item.error ? 'Needs review' : 'Dreamy Studio'}
            </Pill>
            {item.route && <Pill>{item.route.bot.name}</Pill>}
          </div>
        )}
        <div className="text-sm leading-5">{item.content}</div>
        {item.route && (
          <div className="mt-2 rounded-lg-v2 bg-Cr-beta-white-3-v2 p-2 text-xs leading-5 text-Cr-text-subtler-v2">
            <div className="font-semibold text-Cr-text-subtle-v2">{item.route.analysis}</div>
            <div>{item.route.reason}</div>
          </div>
        )}
        <ThinkingSteps steps={item.steps} />
        {item.pending && (
          <div className="mt-3 inline-flex items-center gap-2 text-xs text-Cr-text-subtler-v2">
            <Loader2 size={13} className="animate-spin" />
            Working on the next segment
          </div>
        )}
        {item.error && (
          <div className="mt-3 rounded-lg-v2 border border-Cr-border-critical-v2 bg-Cr-Bg-critical-default-v2 p-2 text-xs leading-5 text-Cr-text-critical-bolder-v2">
            {item.error}
          </div>
        )}
        {!isUser && item.segmentId && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => onAction('extend', 'Extend this into the next shot', selectedSegment)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg-v2 bg-Cr-beta-white-8-v2 px-2 text-xs font-semibold text-Cr-text-default-v2 disabled:opacity-40"
            >
              <Clapperboard size={14} />
              Extend
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => onAction('restyle', 'Restyle this segment with stronger cinematic lighting', selectedSegment)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg-v2 bg-Cr-beta-white-8-v2 px-2 text-xs font-semibold text-Cr-text-default-v2 disabled:opacity-40"
            >
              <Wand2 size={14} />
              Restyle
            </button>
            <button
              type="button"
              disabled={!selectedSegment}
              onClick={() => selectedSegment && onAction('generate', `Use segment ${selectedSegment.id} as the next source`, selectedSegment)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg-v2 bg-Cr-beta-white-5-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2 disabled:opacity-40"
            >
              <Maximize2 size={14} />
              Use source
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => onAction('retry-agent', 'Try another agent for this result', selectedSegment)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg-v2 bg-Cr-beta-white-5-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2 disabled:opacity-40"
            >
              <RefreshCcw size={14} />
              Agent
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentCard({
  segment,
  active,
  onSelect,
  onDelete,
}: {
  segment: StudioSegment;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const media = getSegmentMedia(segment);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative h-[86px] w-[116px] shrink-0 overflow-hidden rounded-lg-v2 border text-left transition-colors ${
        active ? 'border-dreamy-brand-hot-v2' : 'border-Cr-border-default-v2'
      } bg-Cr-Bg-surface-default-v2`}
    >
      {media ? (
        <img src={media} alt="" className="h-full w-full object-cover opacity-80" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-Cr-Bg-surface-subtle-v2">
          <Film size={18} className="text-Cr-text-subtler-v2" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <div className="truncate text-[11px] font-semibold text-white">{segment.botName}</div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] capitalize text-white/70">{segment.action}</span>
          <span className={`text-[10px] font-semibold ${segment.status === 'error' ? 'text-red-300' : 'text-white/70'}`}>
            {segment.status}
          </span>
        </div>
      </div>
      <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold text-white/85">
        {segment.type}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-md-v2 bg-black/60 text-white group-hover:flex"
        aria-label="Delete segment"
      >
        <Trash2 size={12} />
      </button>
    </button>
  );
}

function PreviewPanel({
  project,
  selectedSegment,
  agentsOpen,
  onToggleAgents,
  onSelectSegment,
  onDeleteSegment,
  onAction,
  submitting,
}: {
  project: StudioProject | null;
  selectedSegment?: StudioSegment | null;
  agentsOpen: boolean;
  onToggleAgents: () => void;
  onSelectSegment: (segmentId: string) => void;
  onDeleteSegment: (segmentId: string) => void;
  onAction: (action: StudioAction, prompt?: string, source?: StudioSegment | null) => void;
  submitting: boolean;
}) {
  const media = getSegmentMedia(selectedSegment);
  const graph = project?.agentGraph?.length ? project.agentGraph : EMPTY_GRAPH;
  const runningAgents = graph.filter((node) => node.status === 'running' || node.status === 'queued').length;
  const segments = project?.segments || [];

  return (
    <section className="relative flex min-h-0 flex-col rounded-xl-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-Cr-border-default-v2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg-v2 bg-Cr-beta-white-8-v2">
            <Film size={16} className="text-dreamy-brand-hot-v2" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Preview</div>
            <div className="truncate text-[11px] text-Cr-text-subtler-v2">
              {segments.length ? `${segments.length} segments` : 'No segments'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleAgents}
          className="inline-flex h-8 items-center gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2"
        >
          <GitBranch size={14} />
          Auto route: {graph.length}
          {runningAgents > 0 && <span className="h-1.5 w-1.5 rounded-full bg-dreamy-brand-hot-v2" />}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="relative flex min-h-[260px] flex-1 items-center justify-center overflow-hidden rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-soft-v2">
          {selectedSegment?.type === 'video' && selectedSegment.url ? (
            <video
              src={resolveStudioAssetUrl(selectedSegment.url)}
              poster={resolveStudioAssetUrl(selectedSegment.posterUrl)}
              className="h-full w-full object-contain"
              controls
              playsInline
            />
          ) : media ? (
            <img src={media} alt="Selected segment" className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-Cr-text-subtler-v2">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2">
                <Sparkles size={24} />
              </div>
              <div className="text-sm font-semibold">Ready for a first segment</div>
            </div>
          )}

          {selectedSegment && (
            <div className="absolute left-3 top-3 flex flex-wrap gap-2">
              <Pill tone={selectedSegment.status === 'error' ? 'danger' : selectedSegment.status === 'done' ? 'success' : 'hot'}>
                {selectedSegment.status}
              </Pill>
              <Pill>{selectedSegment.botName}</Pill>
            </div>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div className="flex items-center gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2">
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-md-v2 bg-Cr-beta-white-8-v2">
              <Play size={14} />
            </button>
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-md-v2 text-Cr-text-subtler-v2">
              <Pause size={14} />
            </button>
            <div className="h-1 flex-1 overflow-hidden rounded-full-v2 bg-Cr-beta-white-8-v2">
              <div className="h-full w-1/3 rounded-full-v2 bg-dreamy-brand-hot-v2" />
            </div>
            <span className="text-[11px] font-semibold text-Cr-text-subtler-v2">
              {segments.length ? `${segments.length * 5}s` : '0s'}
            </span>
          </div>
          <button
            type="button"
            disabled={!selectedSegment || submitting}
            onClick={() => onAction('extend', 'Extend this into the next shot', selectedSegment)}
            className="inline-flex h-11 items-center gap-2 rounded-lg-v2 bg-dreamy-brand-hot-v2 px-3 text-xs font-semibold text-white disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
          >
            <Clapperboard size={14} />
            Extend
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {segments.map((segment) => (
            <SegmentCard
              key={segment.id}
              segment={segment}
              active={segment.id === selectedSegment?.id}
              onSelect={() => onSelectSegment(segment.id)}
              onDelete={() => onDeleteSegment(segment.id)}
            />
          ))}
          {!segments.length && (
            <div className="flex h-[86px] min-w-[220px] items-center justify-center rounded-lg-v2 border border-dashed border-Cr-border-default-v2 text-xs text-Cr-text-subtler-v2">
              Timeline is empty
            </div>
          )}
        </div>
      </div>

      {agentsOpen && (
        <div className="absolute bottom-3 right-3 top-14 z-20 w-[min(360px,calc(100%-24px))] rounded-xl-v2 border border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 p-3 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <PanelRightOpen size={16} />
              Agents
            </div>
            <button type="button" onClick={onToggleAgents} className="flex h-8 w-8 items-center justify-center rounded-lg-v2 bg-Cr-Bg-surface-subtle-v2">
              <X size={14} />
            </button>
          </div>
          <div className="space-y-2">
            {graph.map((node, index) => (
              <div key={node.id} className="rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md-v2 bg-Cr-beta-white-8-v2 text-[11px] font-semibold">
                      {index + 1}
                    </span>
                    <span className="truncate text-xs font-semibold">{node.label}</span>
                  </div>
                  <span className={`text-[11px] font-semibold ${statusTone(node.status)}`}>{node.status}</span>
                </div>
                {node.detail && <div className="mt-2 text-xs leading-5 text-Cr-text-subtler-v2">{node.detail}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Composer({
  mode,
  prompt,
  previewUrl,
  selectedFileName,
  submitting,
  onModeChange,
  onPromptChange,
  onSubmit,
  onPickFile,
  onClearFile,
  onStop,
}: {
  mode: StudioMode;
  prompt: string;
  previewUrl: string;
  selectedFileName?: string;
  submitting: boolean;
  onModeChange: (mode: StudioMode) => void;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onPickFile: () => void;
  onClearFile: () => void;
  onStop: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <ModeSwitch mode={mode} onChange={onModeChange} />
        <Pill>{mode === 'canvas' ? 'Canvas chain' : 'Player loop'}</Pill>
      </div>
      <div className="rounded-xl-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2 p-3">
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          rows={3}
          className="block max-h-28 min-h-16 w-full resize-none bg-transparent text-sm leading-5 text-Cr-text-default-v2 outline-none placeholder:text-Cr-text-subtlest-v2"
          placeholder="Describe the next shot, style, or change"
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onPickFile}
              className="inline-flex h-9 items-center gap-2 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-3 text-xs font-semibold text-Cr-text-default-v2 active:bg-Cr-beta-white-8-v2"
            >
              <ImagePlus size={15} />
              Image
            </button>
            {previewUrl && (
              <div className="flex min-w-0 items-center gap-2 rounded-md-v2 bg-Cr-beta-white-5-v2 p-1 pr-2">
                <img src={previewUrl} alt="" className="h-7 w-7 rounded-md-v2 object-cover" />
                <span className="max-w-[120px] truncate text-[11px] text-Cr-text-subtler-v2">{selectedFileName}</span>
                <button type="button" onClick={onClearFile} aria-label="Remove image">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
          {submitting ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex h-9 items-center gap-2 rounded-md-v2 bg-Cr-beta-white-8-v2 px-4 text-xs font-semibold text-Cr-text-default-v2"
            >
              <X size={14} />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!prompt.trim()}
              className="inline-flex h-9 items-center gap-2 rounded-md-v2 bg-dreamy-brand-hot-v2 px-4 text-xs font-semibold text-white disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
            >
              <Send size={14} />
              Run
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dreamy() {
  const navigate = useNavigate();
  const { energy, refresh } = useEnergy();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<StudioMode>('player');
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [prompt, setPrompt] = useState('');
  const [project, setProject] = useState<StudioProject | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Dreamy Studio is ready.',
      createdAt: nowIso(),
      steps: [
        { step: 'route', message: 'Natural language selects the next agent and segment shape.', progress: 0 },
      ],
    },
  ]);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');

  const selectedSegment = useMemo(() => {
    const id = project?.selectedSegmentId;
    return project?.segments.find((segment) => segment.id === id) || project?.segments[project.segments.length - 1] || null;
  }, [project]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const mergeProject = useCallback((incoming: StudioProject) => {
    setProject(incoming);
    setMode(incoming.mode || 'player');
  }, []);

  const updateAssistant = useCallback((id: string, patch: Partial<ChatItem>) => {
    setMessages((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const appendAssistantStep = useCallback((id: string, step: StudioProgressEvent) => {
    setMessages((prev) =>
      prev.map((item) => (item.id === id ? { ...item, steps: [...(item.steps || []), step] } : item)),
    );
  }, []);

  const clearFile = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [previewUrl]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const registerClientExecution = useCallback(
    async (request: StudioExecutionRequest, projectId: string, fileForRequest: File | null, assistantId: string) => {
      const sourceUrl = request.sourceSegment?.url || request.sourceSegment?.posterUrl;
      const expectedType: StudioSegment['type'] = request.botType === 'image-to-video' ? 'video' : 'image';
      await postStudioClientResult(projectId, {
        segmentId: request.segmentId,
        status: 'running',
        type: expectedType,
        prompt: request.prompt,
        botSlug: request.botSlug,
        botName: request.botName,
        action: request.action,
        parentSegmentId: request.sourceSegment?.id,
        posterUrl: request.segment.posterUrl,
      }).then((result) => mergeProject(result.project));

      try {
        appendAssistantStep(assistantId, {
          step: 'miniapp',
          message: `Submitting ${request.botName}`,
          progress: 52,
        });
        const job = await withTimeout(
          submitDreamyMiniappJob({
            slugId: request.botSlug || DEFAULT_DREAMY_SLUG,
            prompt: request.prompt,
            imageFile: fileForRequest,
            imageUrl: fileForRequest ? undefined : sourceUrl,
          }),
          10000,
          'Dreamy miniapp submit',
        );

        let media: { url?: string; posterUrl?: string; status?: string } = {};
        try {
          const result = await withTimeout(fetchGenerateResult(job.response.outputJobId), 5000, 'Dreamy result poll');
          media = extractGenerateTaskMedia(result);
        } catch {
          media = {};
        }

        const status = media.status === 'completed' || media.status === 'success' || media.status === 'done' ? 'done' : 'running';
        const update = await postStudioClientResult(projectId, {
          segmentId: request.segmentId,
          status,
          type: expectedType,
          url: media.url,
          posterUrl: media.posterUrl || request.segment.posterUrl,
          prompt: request.prompt,
          botSlug: request.botSlug,
          botName: request.botName,
          action: request.action,
          parentSegmentId: request.sourceSegment?.id,
          taskId: job.response.outputJobId,
        });
        mergeProject(update.project);
        updateAssistant(assistantId, {
          pending: false,
          segmentId: request.segmentId,
          content: status === 'done' ? 'Segment is ready.' : 'Segment is running in Dreamy.',
        });
        void refresh();
      } catch (error) {
        const update = await postStudioClientResult(projectId, {
          segmentId: request.segmentId,
          status: 'error',
          type: expectedType,
          posterUrl: request.segment.posterUrl,
          prompt: request.prompt,
          botSlug: request.botSlug,
          botName: request.botName,
          action: request.action,
          parentSegmentId: request.sourceSegment?.id,
        }).catch(() => null);
        if (update) mergeProject(update.project);
        updateAssistant(assistantId, {
          pending: false,
          segmentId: request.segmentId,
          content: 'Segment was queued, but client execution needs attention.',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [appendAssistantStep, mergeProject, refresh, updateAssistant],
  );

  const runStudio = useCallback(
    async (action: StudioAction = 'generate', overridePrompt?: string, source?: StudioSegment | null) => {
      if (submitting) return;
      const text = (overridePrompt || prompt).trim();
      if (!text && action === 'generate') return;

      const runPrompt = text || {
        extend: 'Extend this into the next shot',
        restyle: 'Restyle this segment',
        'retry-agent': 'Try another agent for this segment',
        generate: 'Create a new Dreamy segment',
      }[action];
      const fileForRequest = selectedFile;
      const userId = makeId('user');
      const assistantId = makeId('assistant');
      const sourceSegment = source || selectedSegment;

      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', content: runPrompt, action, createdAt: nowIso(), hasImage: Boolean(fileForRequest) },
        { id: assistantId, role: 'assistant', content: 'Routing next segment...', pending: true, createdAt: nowIso(), action },
      ]);
      setSubmitting(true);
      setActiveTab('chat');
      trackEvent('dreamy_studio_run', {
        action,
        mode,
        has_image: Boolean(fileForRequest),
        source_segment_id: sourceSegment?.id || '',
      });

      const controller = new AbortController();
      abortRef.current = controller;
      let currentProjectId = project?.projectId || '';

      try {
        await streamStudioRun({
          message: runPrompt,
          mode,
          action,
          projectId: project?.projectId,
          sourceSegmentId: sourceSegment?.id,
          agentGraph: project?.agentGraph,
          imageFile: fileForRequest,
          signal: controller.signal,
          onEvent: async (event: StudioRunEvent, rawEventName: string) => {
            if (rawEventName === 'meta' && 'projectId' in event && 'conversationId' in event && 'mode' in event) {
              const metaEvent = event as Extract<StudioRunEvent, { conversationId: string }>;
              currentProjectId = metaEvent.projectId;
              setProject((prev) =>
                prev || {
                  projectId: metaEvent.projectId,
                  conversationId: metaEvent.conversationId,
                  mode: metaEvent.mode,
                  messages: [],
                  segments: [],
                  selectedSegmentId: null,
                  agentGraph: EMPTY_GRAPH,
                  updatedAt: nowIso(),
                },
              );
              return;
            }
            if (rawEventName === 'route' && 'bot' in event) {
              updateAssistant(assistantId, {
                route: event,
                content: `Matched ${event.bot.name}.`,
              });
              return;
            }
            if (rawEventName === 'progress' && 'step' in event) {
              appendAssistantStep(assistantId, event);
              return;
            }
            if (rawEventName === 'execution_request' && 'segmentId' in event && 'segment' in event) {
              const executionEvent = event as StudioExecutionRequest;
              setProject((prev) => {
                if (!prev) return prev;
                const exists = prev.segments.some((segment) => segment.id === executionEvent.segment.id);
                return {
                  ...prev,
                  agentGraph: executionEvent.agentGraph || prev.agentGraph,
                  selectedSegmentId: executionEvent.segmentId,
                  segments: exists ? prev.segments : [...prev.segments, executionEvent.segment],
                };
              });
              updateAssistant(assistantId, {
                segmentId: executionEvent.segmentId,
                content: `Queued ${executionEvent.botName}.`,
              });
              await registerClientExecution(executionEvent, currentProjectId, fileForRequest, assistantId);
              return;
            }
            if (rawEventName === 'project' && 'project' in event) {
              mergeProject(event.project);
              return;
            }
            if (rawEventName === 'error' && 'message' in event) {
              updateAssistant(assistantId, { pending: false, error: event.message });
            }
          },
        });
      } catch (error) {
        if (controller.signal.aborted) {
          updateAssistant(assistantId, { pending: false, content: 'Stopped.' });
        } else {
          const fallback = createLocalProject(mode, runPrompt, action, sourceSegment || undefined);
          mergeProject(fallback);
          updateAssistant(assistantId, {
            pending: false,
            segmentId: fallback.selectedSegmentId || undefined,
            content: 'Local draft segment added.',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        abortRef.current = null;
        setSubmitting(false);
        setPrompt('');
        clearFile();
      }
    },
    [
      appendAssistantStep,
      clearFile,
      mergeProject,
      mode,
      project,
      prompt,
      registerClientExecution,
      selectedFile,
      selectedSegment,
      submitting,
      updateAssistant,
    ],
  );

  const stopRun = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSubmitting(false);
  };

  const selectSegment = (segmentId: string) => {
    setProject((prev) => (prev ? { ...prev, selectedSegmentId: segmentId } : prev));
    setActiveTab('preview');
  };

  const deleteSegment = (segmentId: string) => {
    setProject((prev) => {
      if (!prev) return prev;
      const segments = prev.segments.filter((segment) => segment.id !== segmentId);
      const selectedSegmentId = prev.selectedSegmentId === segmentId ? segments[segments.length - 1]?.id || null : prev.selectedSegmentId;
      return { ...prev, segments, selectedSegmentId, updatedAt: nowIso() };
    });
  };

  const resetProject = async () => {
    const projectId = project?.projectId;
    setProject(null);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Dreamy Studio is ready.',
        createdAt: nowIso(),
        steps: [{ step: 'route', message: 'Natural language selects the next agent and segment shape.', progress: 0 }],
      },
    ]);
    if (projectId) {
      await resetStudioProject(projectId).catch(() => undefined);
    }
  };

  const refreshSelectedTask = async () => {
    if (!project || !selectedSegment?.taskId) return;
    const result = await fetchGenerateResult(selectedSegment.taskId).catch(() => null);
    const media = extractGenerateTaskMedia(result);
    const status = media.status === 'completed' || media.status === 'success' || media.status === 'done' ? 'done' : selectedSegment.status;
    const update = await postStudioClientResult(project.projectId, {
      segmentId: selectedSegment.id,
      status,
      type: selectedSegment.type,
      url: media.url,
      posterUrl: media.posterUrl || selectedSegment.posterUrl,
      taskId: selectedSegment.taskId,
    }).catch(() => null);
    if (update) mergeProject(update.project);
  };

  return (
    <div className="flex h-full min-h-[100dvh] flex-col bg-Cr-Bg-soft-v2 text-Cr-text-default-v2">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full-v2 bg-Cr-Bg-surface-subtle-v2 active:bg-Cr-beta-white-8-v2"
            aria-label="Back"
          >
            <ChevronLeft size={20} strokeWidth={2} />
          </button>
          <div>
            <div className="text-base font-semibold">Dreamy Studio</div>
            <div className="text-[11px] text-Cr-text-subtler-v2">{project?.projectId || 'New project'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshSelectedTask}
            disabled={!selectedSegment?.taskId}
            className="hidden h-9 items-center gap-2 rounded-lg-v2 bg-Cr-Bg-surface-subtle-v2 px-3 text-xs font-semibold text-Cr-text-subtle-v2 disabled:opacity-40 sm:inline-flex"
          >
            <RotateCcw size={14} />
            Refresh
          </button>
          <button
            type="button"
            onClick={resetProject}
            className="flex h-9 w-9 items-center justify-center rounded-lg-v2 bg-Cr-Bg-surface-subtle-v2 text-Cr-text-subtle-v2 active:bg-Cr-beta-white-8-v2"
            aria-label="Reset project"
          >
            <Clock3 size={16} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/energy')}
            className="flex h-9 min-w-9 items-center justify-center rounded-full-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2 active:bg-Cr-beta-white-8-v2"
            aria-label="Energy"
          >
            {energy ?? '--'}
          </button>
        </div>
      </header>

      <div className="grid h-11 shrink-0 grid-cols-2 border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 p-1 lg:hidden">
        {(['chat', 'preview'] as TabKey[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg-v2 text-xs font-semibold capitalize ${
              activeTab === tab ? 'bg-Cr-Bg-surface-default-v2 text-Cr-text-default-v2' : 'text-Cr-text-subtler-v2'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <main className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(360px,0.42fr)_minmax(480px,0.58fr)]">
        <section
          className={`min-h-0 flex-col overflow-hidden rounded-xl-v2 border border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 ${
            activeTab === 'chat' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-Cr-border-default-v2 px-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg-v2 bg-Cr-beta-white-8-v2">
                <Sparkles size={16} className="text-dreamy-brand-hot-v2" />
              </div>
              <div>
                <div className="text-sm font-semibold">Conversation</div>
                <div className="text-[11px] text-Cr-text-subtler-v2">{project?.conversationId || 'No session'}</div>
              </div>
            </div>
            <Pill tone={submitting ? 'hot' : 'default'}>{submitting ? 'Running' : mode}</Pill>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 [-webkit-overflow-scrolling:touch]">
            {messages.map((item) => (
              <ChatMessage
                key={item.id}
                item={item}
                selectedSegment={selectedSegment}
                submitting={submitting}
                onAction={runStudio}
              />
            ))}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <Composer
            mode={mode}
            prompt={prompt}
            previewUrl={previewUrl}
            selectedFileName={selectedFile?.name}
            submitting={submitting}
            onModeChange={setMode}
            onPromptChange={setPrompt}
            onPickFile={() => fileInputRef.current?.click()}
            onClearFile={clearFile}
            onSubmit={() => void runStudio('generate')}
            onStop={stopRun}
          />
        </section>

        <div className={activeTab === 'preview' ? 'min-h-0' : 'hidden min-h-0 lg:block'}>
          <PreviewPanel
            project={project}
            selectedSegment={selectedSegment}
            agentsOpen={agentsOpen}
            onToggleAgents={() => setAgentsOpen((value) => !value)}
            onSelectSegment={selectSegment}
            onDeleteSegment={deleteSegment}
            onAction={runStudio}
            submitting={submitting}
          />
        </div>
      </main>
    </div>
  );
}

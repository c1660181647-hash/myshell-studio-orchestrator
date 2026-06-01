import {
  fetchBotDetail,
  fetchGenerateResult,
  fetchLibraryAll,
  fetchTaskRunning,
  generate,
  uploadImage,
} from './api';
import type { GenerateResponse, GenerateResultResponse } from '../types';

export type UnifiedMode = 'orchestrator' | 'miniapp' | 'monitor';
export type StudioMode = 'player' | 'canvas';
export type StudioAction = 'generate' | 'extend' | 'restyle' | 'retry-agent';
export type StudioStatus = 'draft' | 'queued' | 'running' | 'done' | 'timeout' | 'auth_missing' | 'error' | 'cancelled';
export type KnownStudioApi =
  | 'dreamy-miniapp'
  | 'myshell-art'
  | 'explore'
  | 'ai-picks'
  | 'bot-detail'
  | 'upload'
  | 'tag-generator'
  | 'library'
  | 'energy-store'
  | 'earn'
  | 'share-invite'
  | 'settings'
  | 'checkin';
export type StudioApi = KnownStudioApi | (string & {});
export type StudioExecutor = 'client' | 'server' | 'navigation';

export interface OrchestratorBotRef {
  id?: string;
  name?: string;
  type?: string;
  rating?: number;
  description?: string;
  page_url?: string;
}

export interface OrchestratorEvent {
  type?: string;
  step?: string;
  message?: string;
  detail?: string;
  progress?: number;
  conversation_id?: string;
  bot?: OrchestratorBotRef;
  bot_used?: OrchestratorBotRef;
  image_url?: string;
  video_url?: string;
  prompt_used?: string;
  source?: string;
  bot_page_url?: string;
  needs_image_hint?: string;
  status?: string;
}

export interface StreamOrchestratorOptions {
  message: string;
  imageFile?: File | null;
  conversationId?: string | null;
  signal?: AbortSignal;
  onEvent: (event: OrchestratorEvent, rawEventName: string) => void;
}

export interface DreamyMiniappJobInput {
  slugId: string;
  prompt: string;
  imageFile?: File | null;
  imageUrl?: string;
}

export interface DreamyMiniappJobResult {
  uploadedImageUrl?: string;
  botId: string;
  articleId: string;
  response: GenerateResponse;
}

export interface MonitorSnapshot {
  running: boolean;
  libraryCount: number;
  latestTaskId?: string;
  latestStatus?: string;
  latestBotName?: string;
  latestPreview?: string;
}

export interface StudioAgentNode {
  id: string;
  label: string;
  status: 'idle' | StudioStatus;
  detail?: string;
}

export interface StudioEvidence {
  status: StudioStatus | string;
  source: string;
  accepted: boolean;
  mediaUrl?: string;
  taskId?: string;
  message?: string;
  checkedAt?: string;
}

export interface StudioAuthStatus {
  status: 'ready' | 'client_delegated' | 'auth_missing' | 'unavailable' | string;
  mode?: string;
  message?: string;
}

export interface StudioHealthComponent {
  status: 'ok' | 'ready' | 'client_delegated' | 'auth_missing' | 'unavailable' | 'error' | string;
  message?: string;
  mode?: string;
  path?: string;
  url?: string;
}

export interface StudioHealth {
  status: 'ok' | 'degraded' | string;
  version?: string;
  checkedAt?: string;
  components: Record<string, StudioHealthComponent>;
}

export interface StudioPageAdapter {
  id: StudioApi;
  name: string;
  kind: string;
  baseUrl: string;
  appRoute?: string;
  executor: StudioExecutor;
  authMode: string;
  status: string;
  dispatchMode?: string;
  dispatchReady?: boolean;
  dispatchStatus?: string;
  dispatchMessage?: string;
  authStatus?: StudioAuthStatus;
  routeParams?: string[];
  routeDefaults?: Record<string, string>;
  intentKeywords?: string[];
  registrySource?: 'code' | 'manifest' | string;
  manifestVersion?: string;
  botCount?: number;
  capabilities: string[];
}

export interface StudioAgentCapability {
  id: string;
  label: string;
  pageId: string;
  role: string;
  capabilities: string[];
}

export interface StudioJob {
  jobId: string;
  projectId: string;
  segmentId: string;
  pageId: StudioApi | string;
  pageName: string;
  agentId: string;
  executor: StudioExecutor;
  api: StudioApi | string;
  clientAction?: 'navigate' | string;
  navigationPath?: string;
  studioReturnPath?: string;
  status: StudioStatus;
  action: StudioAction;
  botSlug: string;
  botName: string;
  botType?: string;
  prompt: string;
  taskId?: string;
  mediaUrl?: string;
  posterUrl?: string;
  authStatus?: StudioAuthStatus;
  evidence?: StudioEvidence;
  attempt?: number;
  createdAt?: string;
  updatedAt?: string;
  evidenceTrail?: StudioEvidence[];
}

export interface StudioSegment {
  id: string;
  type: 'image' | 'video';
  url?: string;
  posterUrl?: string;
  prompt: string;
  botSlug: string;
  botName: string;
  action: StudioAction;
  parentSegmentId?: string;
  status: StudioStatus;
  taskId?: string;
  jobId?: string;
  authStatus?: StudioAuthStatus;
  evidence?: StudioEvidence;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudioMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  action?: StudioAction;
  segmentId?: string;
  hasImage?: boolean;
  route?: StudioRouteEvent;
}

export interface StudioProject {
  projectId: string;
  conversationId: string;
  mode: StudioMode;
  messages: StudioMessage[];
  segments: StudioSegment[];
  selectedSegmentId?: string | null;
  agentGraph: StudioAgentNode[];
  jobs?: StudioJob[];
  updatedAt: string;
}

export interface StudioRouteEvent {
  type?: 'route';
  intent: string;
  analysis: string;
  optimizedPrompt: string;
  reason: string;
  action: StudioAction;
  sourceSegmentId?: string;
  sourceSummary?: string;
  executor: StudioExecutor;
  api?: StudioApi;
  agentId?: string;
  clientAction?: 'navigate' | string;
  navigationPath?: string;
  studioReturnPath?: string;
  page?: StudioPageAdapter;
  bot: {
    slug: string;
    name: string;
    type: string;
    rating?: number;
    description?: string;
    pageUrl?: string;
  };
}

export interface StudioProgressEvent {
  type?: 'progress';
  step: string;
  message: string;
  progress?: number;
}

export interface StudioExecutionRequest {
  type?: 'execution_request';
  executor: StudioExecutor;
  api: StudioApi | string;
  page?: StudioPageAdapter;
  agentId?: string;
  clientAction?: 'navigate' | string;
  navigationPath?: string;
  studioReturnPath?: string;
  jobId: string;
  segmentId: string;
  botSlug: string;
  botName: string;
  botType: string;
  prompt: string;
  action: StudioAction;
  sourceSegment?: StudioSegment | null;
  agentGraph?: StudioAgentNode[];
  segment: StudioSegment;
  authStatus?: StudioAuthStatus;
  evidence?: StudioEvidence;
}

export interface StudioProjectEvent {
  type?: 'project';
  project: StudioProject;
}

export type StudioRunEvent =
  | ({ type?: 'meta'; projectId: string; conversationId: string; mode: StudioMode })
  | StudioRouteEvent
  | StudioProgressEvent
  | StudioExecutionRequest
  | StudioProjectEvent
  | ({ type?: 'job'; job: StudioJob })
  | ({ type?: 'done'; status: string; projectId: string; segmentId?: string; jobId?: string })
  | ({ type?: 'error'; message: string });

export interface StreamStudioRunOptions {
  message: string;
  mode: StudioMode;
  action: StudioAction;
  projectId?: string | null;
  sourceSegmentId?: string | null;
  pageId?: StudioApi | string;
  agentId?: string;
  agentGraph?: StudioAgentNode[];
  imageFile?: File | null;
  signal?: AbortSignal;
  onEvent: (event: StudioRunEvent, rawEventName: string) => void | Promise<void>;
}

export interface StudioClientResultInput {
  segmentId: string;
  status: StudioSegment['status'];
  type?: StudioSegment['type'];
  url?: string;
  posterUrl?: string;
  prompt?: string;
  botSlug?: string;
  botName?: string;
  action?: StudioAction;
  parentSegmentId?: string;
  taskId?: string;
  jobId?: string;
  source?: string;
  evidence?: StudioEvidence;
  authStatus?: StudioAuthStatus;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getOrchestratorBaseUrl(): string {
  const configured = import.meta.env.VITE_DREAMY_ORCHESTRATOR_BASE_URL as string | undefined;
  return configured ? stripTrailingSlash(configured) : '';
}

export function getOrchestratorChatEndpoint(): string {
  const base = getOrchestratorBaseUrl();
  return base ? `${base}/api/chat` : '/api/chat';
}

export function getStudioRunEndpoint(): string {
  const base = getOrchestratorBaseUrl();
  return base ? `${base}/api/studio/run` : '/api/studio/run';
}

export function getStudioHealthEndpoint(): string {
  const base = getOrchestratorBaseUrl();
  return base ? `${base}/api/health` : '/api/health';
}

export function getStudioProjectEndpoint(projectId: string): string {
  const base = getOrchestratorBaseUrl();
  const path = `/api/studio/projects/${encodeURIComponent(projectId)}`;
  return base ? `${base}${path}` : path;
}

export function getStudioJobEndpoint(jobId: string): string {
  const base = getOrchestratorBaseUrl();
  const path = `/api/studio/jobs/${encodeURIComponent(jobId)}`;
  return base ? `${base}${path}` : path;
}

function getStudioRootEndpoint(path: string): string {
  const base = getOrchestratorBaseUrl();
  return base ? `${base}${path}` : path;
}

export function resolveOrchestratorAssetUrl(url: string | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  const base = getOrchestratorBaseUrl();
  return base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url;
}

export const resolveStudioAssetUrl = resolveOrchestratorAssetUrl;

async function readSse<TEvent>({
  response,
  onEvent,
}: {
  response: Response;
  onEvent: (event: TEvent, rawEventName: string) => void | Promise<void>;
}) {
  if (!response.ok) {
    throw new Error(`Studio ${response.status}: ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error('Studio endpoint did not return a readable stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const dispatch = async () => {
    if (dataLines.length === 0) {
      eventName = 'message';
      return;
    }
    const payload = dataLines.join('\n');
    dataLines = [];
    try {
      await onEvent(JSON.parse(payload) as TEvent, eventName);
    } catch {
      await onEvent({ type: eventName, message: payload } as TEvent, eventName);
    }
    eventName = 'message';
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (line === '') {
        await dispatch();
      } else if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim() || 'message';
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
  }

  if (buffer.trim()) {
    for (const rawLine of buffer.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim() || 'message';
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
  }
  await dispatch();
}

export async function streamArtOrchestrator({
  message,
  imageFile,
  conversationId,
  signal,
  onEvent,
}: StreamOrchestratorOptions): Promise<string | null> {
  const formData = new FormData();
  formData.append('message', message);
  if (conversationId) formData.append('conversation_id', conversationId);
  if (imageFile) formData.append('image', imageFile);

  const response = await fetch(getOrchestratorChatEndpoint(), {
    method: 'POST',
    body: formData,
    signal,
  });

  let resolvedConversationId = conversationId ?? null;

  await readSse<OrchestratorEvent>({
    response,
    onEvent: (parsed, eventName) => {
      if (parsed.conversation_id) resolvedConversationId = parsed.conversation_id;
      onEvent(parsed, eventName);
    },
  });
  return resolvedConversationId;
}

export async function streamStudioRun({
  message,
  mode,
  action,
  projectId,
  sourceSegmentId,
  pageId,
  agentId,
  agentGraph,
  imageFile,
  signal,
  onEvent,
}: StreamStudioRunOptions): Promise<void> {
  const formData = new FormData();
  formData.append('message', message);
  formData.append('mode', mode);
  formData.append('action', action);
  if (projectId) formData.append('project_id', projectId);
  if (sourceSegmentId) formData.append('source_segment_id', sourceSegmentId);
  if (pageId) formData.append('page_id', pageId);
  if (agentId) formData.append('agent_id', agentId);
  if (agentGraph) formData.append('agent_graph', JSON.stringify(agentGraph));
  if (imageFile) formData.append('image', imageFile);

  const response = await fetch(getStudioRunEndpoint(), {
    method: 'POST',
    body: formData,
    signal,
  });
  await readSse<StudioRunEvent>({ response, onEvent });
}

export async function fetchStudioProject(projectId: string): Promise<StudioProject> {
  const response = await fetch(getStudioProjectEndpoint(projectId));
  if (!response.ok) {
    throw new Error(`Studio project ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchStudioProjects(limit = 50): Promise<StudioProject[]> {
  const response = await fetch(getStudioRootEndpoint(`/api/studio/projects?limit=${encodeURIComponent(String(limit))}`));
  if (!response.ok) throw new Error(`Studio projects ${response.status}: ${response.statusText}`);
  const body = await response.json();
  return body.projects || [];
}

export async function fetchStudioPages(): Promise<StudioPageAdapter[]> {
  const response = await fetch(getStudioRootEndpoint('/api/pages'));
  if (!response.ok) throw new Error(`Studio pages ${response.status}: ${response.statusText}`);
  const body = await response.json();
  return body.pages || [];
}

export async function fetchStudioAgents(): Promise<StudioAgentCapability[]> {
  const response = await fetch(getStudioRootEndpoint('/api/agents'));
  if (!response.ok) throw new Error(`Studio agents ${response.status}: ${response.statusText}`);
  const body = await response.json();
  return body.agents || [];
}

export async function fetchStudioHealth(): Promise<StudioHealth> {
  const response = await fetch(getStudioHealthEndpoint());
  if (!response.ok) throw new Error(`Studio health ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchStudioJob(jobId: string): Promise<StudioJob> {
  const response = await fetch(getStudioJobEndpoint(jobId));
  if (!response.ok) throw new Error(`Studio job ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchStudioJobs(
  options: {
    projectId?: string;
    status?: StudioStatus | string;
    pageId?: StudioApi | string;
    agentId?: string;
    limit?: number;
  } = {},
): Promise<StudioJob[]> {
  const params = new URLSearchParams();
  if (options.projectId) params.set('project_id', options.projectId);
  if (options.status) params.set('status', options.status);
  if (options.pageId) params.set('page_id', options.pageId);
  if (options.agentId) params.set('agent_id', options.agentId);
  params.set('limit', String(options.limit || 100));
  const query = params.toString();
  const response = await fetch(getStudioRootEndpoint(`/api/studio/jobs${query ? `?${query}` : ''}`));
  if (!response.ok) throw new Error(`Studio jobs ${response.status}: ${response.statusText}`);
  const body = await response.json();
  return body.jobs || [];
}

export async function postStudioClientResult(
  projectId: string,
  result: StudioClientResultInput,
): Promise<{ project: StudioProject; segment: StudioSegment; job?: StudioJob | null }> {
  const response = await fetch(`${getStudioProjectEndpoint(projectId)}/client-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });
  if (!response.ok) {
    throw new Error(`Studio client result ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export async function cancelStudioJob(jobId: string): Promise<{ project?: StudioProject | null; job: StudioJob }> {
  const response = await fetch(`${getStudioJobEndpoint(jobId)}/cancel`, { method: 'POST' });
  if (!response.ok) throw new Error(`Studio cancel ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function retryStudioJob(jobId: string): Promise<{ project?: StudioProject | null; job: StudioJob; executionRequest?: StudioExecutionRequest | null }> {
  const response = await fetch(`${getStudioJobEndpoint(jobId)}/retry`, { method: 'POST' });
  if (!response.ok) throw new Error(`Studio retry ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function resetStudioProject(projectId: string): Promise<void> {
  const response = await fetch(`${getStudioProjectEndpoint(projectId)}/reset`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Studio reset ${response.status}: ${response.statusText}`);
  }
}

export async function submitDreamyMiniappJob({
  slugId,
  prompt,
  imageFile,
  imageUrl,
}: DreamyMiniappJobInput): Promise<DreamyMiniappJobResult> {
  const detail = await fetchBotDetail(slugId);
  const botId = detail?.info?.botId || slugId;
  const articleId = detail?.info?.slugId || slugId;
  const uploadedImageUrl = imageFile ? await uploadImage(imageFile) : imageUrl;
  const inputImg = uploadedImageUrl ? [uploadedImageUrl, prompt] : [prompt];
  const response = await generate(botId, inputImg, articleId);
  return {
    uploadedImageUrl,
    botId,
    articleId,
    response,
  };
}

export async function readDreamyMonitorSnapshot(taskId?: string): Promise<MonitorSnapshot> {
  const [runningState, libraryState, taskState] = await Promise.all([
    fetchTaskRunning().catch(() => ({ running: false })),
    fetchLibraryAll().catch(() => ({ generateResults: [] })),
    taskId ? fetchGenerateResult(taskId).catch(() => null) : Promise.resolve(null),
  ]);

  const latest = libraryState.generateResults[0];
  const task = taskState?.tasks?.[0];
  return {
    running: Boolean(runningState.running),
    libraryCount: libraryState.generateResults.length,
    latestTaskId: task?.jobId || latest?.taskId,
    latestStatus: task?.status || latest?.status,
    latestBotName: task?.botName || latest?.botName,
    latestPreview: latest?.result?.outputPreview || latest?.result?.outputImg,
  };
}

export function extractGenerateTaskMedia(result: GenerateResultResponse | null | undefined): {
  url?: string;
  posterUrl?: string;
  status?: string;
} {
  const task = result?.tasks?.[0];
  if (!task) return {};
  try {
    const parsed = typeof task.result === 'string' ? JSON.parse(task.result) : task.result;
    const outputImg = parsed?.outputImg || parsed?.output_img;
    const outputPreview = parsed?.outputPreview || parsed?.output_preview;
    const outputPoster = parsed?.outputPoster || parsed?.output_poster;
    return {
      url: outputImg || outputPreview,
      posterUrl: outputPoster || outputPreview || outputImg,
      status: task.status,
    };
  } catch {
    return { status: task.status };
  }
}

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
  pageId?: string;
  agentId?: string;
  navigationPath?: string;
  missingRouteParams?: string[];
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

export interface StudioReadinessGate {
  id: string;
  label: string;
  status: 'ready' | 'degraded' | 'blocked' | 'auth_missing' | 'unavailable' | string;
  required: boolean;
  message?: string;
  evidence?: Record<string, unknown>;
}

export interface StudioReadiness {
  status: 'ready' | 'degraded' | 'blocked' | string;
  checkedAt: string;
  summary: {
    ready: number;
    degraded: number;
    blocked: number;
    total: number;
  };
  gates: StudioReadinessGate[];
  health?: StudioHealth;
}

export interface StudioDeliveryAction {
  action: string;
  status: StudioStatus | string;
  message?: string;
  segmentId?: string;
  jobId?: string;
  pageId?: string;
  botName?: string;
}

export interface StudioDeliverySegment {
  segmentId: string;
  jobId?: string;
  pageId?: string;
  pageName?: string;
  agentId?: string;
  status: StudioStatus | string;
  botName?: string;
  mediaUrl?: string;
  posterUrl?: string;
  taskId?: string;
  authStatus?: StudioAuthStatus;
  evidence?: StudioEvidence;
  evidenceTrail?: StudioEvidence[];
  updatedAt?: string;
}

export interface StudioProjectDeliveryReport {
  projectId: string;
  conversationId: string;
  checkedAt: string;
  handoffStatus: 'ready' | 'in_progress' | 'needs_attention' | string;
  readyForHandoff: boolean;
  summary: {
    totalSegments: number;
    totalJobs: number;
    acceptedEvidence: number;
    pendingEvidence: number;
    issueCount: number;
    unresolvedActionCount: number;
  };
  statusCounts: Record<StudioStatus | string, number>;
  segments: StudioDeliverySegment[];
  jobs: StudioJob[];
  unresolvedActions: StudioDeliveryAction[];
}

export interface StudioDispatchMatrixEntry {
  pageId: StudioApi | string;
  pageName: string;
  kind: string;
  executor: StudioExecutor;
  agentId: string;
  recommendedAction: 'navigate' | 'execute-client' | 'execute-server' | string;
  dispatchReady: boolean;
  dispatchStatus: string;
  dispatchMessage?: string;
  authStatus: StudioAuthStatus;
  clientAction?: 'navigate' | string;
  navigationPath?: string;
  studioReturnPath?: string;
  routeParams: string[];
  missingRouteParams: string[];
  capabilities: string[];
  registrySource?: string;
}

export interface StudioDispatchMatrix {
  checkedAt: string;
  projectId?: string | null;
  sourceSegmentId?: string | null;
  sourceMediaUrl?: string;
  summary: {
    total: number;
    ready: number;
    blocked: number;
    missingParams: number;
    navigation: number;
    client: number;
    server: number;
  };
  entries: StudioDispatchMatrixEntry[];
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

export type StudioStatusCounts = Record<StudioStatus | string, number>;

export interface StudioOverviewPage extends StudioPageAdapter {
  agentIds: string[];
  jobCounts: StudioStatusCounts;
  latestJob?: StudioJob | null;
}

export interface StudioOverviewAgent extends StudioAgentCapability {
  jobCounts: StudioStatusCounts;
  latestJob?: StudioJob | null;
}

export interface StudioOverview {
  checkedAt: string;
  totals: {
    pages: number;
    agents: number;
    jobs: number;
    issues: number;
    [status: string]: number;
  };
  pages: StudioOverviewPage[];
  agents: StudioOverviewAgent[];
  latestJobs: StudioJob[];
}

export type StudioCoverageStatus = 'covered' | 'pending' | 'ready_unverified' | 'blocked' | string;

export interface StudioCoveragePage extends StudioDispatchMatrixEntry {
  coverageStatus: StudioCoverageStatus;
  jobCount: number;
  acceptedEvidence: number;
  latestJob?: StudioJob | null;
  latestEvidence?: StudioEvidence;
}

export interface StudioCoverageReport {
  status: 'ready' | 'ready_with_gaps' | 'blocked' | string;
  checkedAt: string;
  projectId?: string | null;
  sourceSegmentId?: string | null;
  sourceMediaUrl?: string;
  summary: StudioDispatchMatrix['summary'] & {
    covered: number;
    pending: number;
    readyUnverified: number;
    acceptedEvidence: number;
    issues: number;
    pendingJobs: number;
    withJobs: number;
  };
  pages: StudioCoveragePage[];
}

export interface StudioCoverageVerifyResult {
  status: 'verified' | 'no_verifiable_pages' | string;
  checkedAt: string;
  project: StudioProject;
  projectId: string;
  sourceSegmentId?: string | null;
  sourceMediaUrl?: string;
  matchedCount: number;
  createdCount: number;
  skippedCount: number;
  jobs: StudioJob[];
  skippedPages: Array<{
    pageId: StudioApi | string;
    pageName: string;
    executor: StudioExecutor | string;
    dispatchStatus: string;
    coverageStatus: StudioCoverageStatus;
    reason: string;
    message?: string;
    missingRouteParams?: string[];
  }>;
  coverage: StudioCoverageReport;
}

export interface StudioHandoffGate {
  id: string;
  label: string;
  status: 'ready' | 'needs_attention' | 'blocked' | string;
  required: boolean;
  message?: string;
}

export interface StudioHandoffGap {
  id: string;
  kind: 'page' | 'job' | string;
  pageId?: StudioApi | string;
  pageName?: string;
  status: StudioCoverageStatus | StudioStatus | string;
  reason: string;
  message?: string;
  missingRouteParams?: string[];
}

export interface StudioHandoffAction {
  id: string;
  action: string;
  kind: 'page' | 'job' | string;
  targetId?: string;
  targetName?: string;
  status?: StudioCoverageStatus | StudioStatus | string;
  reason?: string;
  message?: string;
  pageId?: StudioApi | string;
  segmentId?: string;
  jobId?: string;
}

export interface StudioHandoffArtifact {
  id: string;
  label: string;
  endpoint: string;
  projectId?: string;
  url?: string;
  query?: Record<string, unknown>;
  filename?: string;
}

export interface StudioHandoffSnapshot {
  status: 'ready' | 'needs_attention' | 'blocked' | string;
  readyForDelivery: boolean;
  checkedAt: string;
  projectId?: string | null;
  sourceSegmentId?: string | null;
  sourceMediaUrl?: string;
  summary: {
    pages: number;
    covered: number;
    pending: number;
    readyUnverified: number;
    blocked: number;
    acceptedEvidence: number;
    jobs: number;
    issues: number;
    deliveryAcceptedEvidence: number;
    deliveryPendingEvidence: number;
    unresolvedActions: number;
    gaps: number;
  };
  gates: StudioHandoffGate[];
  gaps: StudioHandoffGap[];
  actions: StudioHandoffAction[];
  artifacts: StudioHandoffArtifact[];
  reports: {
    health: StudioHealth;
    readiness: StudioReadiness;
    overview: StudioOverview;
    dispatchMatrix: StudioDispatchMatrix;
    coverage: StudioCoverageReport;
    deliveryReport?: StudioProjectDeliveryReport | null;
  };
}

export interface StudioDeliveryBundle {
  status: 'ready' | 'needs_attention' | 'blocked' | string;
  readyForDelivery: boolean;
  checkedAt: string;
  projectId: string;
  conversationId: string;
  sourceSegmentId?: string | null;
  sourceMediaUrl?: string;
  summary: {
    pages: number;
    covered: number;
    readyUnverified: number;
    blockedPages: number;
    jobs: number;
    acceptedJobs: number;
    dispatchSessions: number;
    dispatchTargets: number;
    pendingTargets: number;
    visitedTargets: number;
    completedTargets: number;
    skippedTargets: number;
    errorTargets: number;
    blockedTargets: number;
    gaps: number;
    actions: number;
    artifacts: number;
  };
  targetStatusCounts: Record<string, number>;
  artifacts: StudioHandoffArtifact[];
  dispatchSessions: StudioDispatchSession[];
  acceptedJobs: StudioJob[];
  remainingTargets: StudioDispatchSessionTarget[];
  skippedTargets: StudioDispatchBatchSkip[];
  reports: {
    deliveryReport: StudioProjectDeliveryReport;
    coverage: StudioCoverageReport;
    handoffSnapshot: StudioHandoffSnapshot;
  };
}

export interface StudioDeliveryAuditRequirement {
  id: string;
  label: string;
  status: 'ready' | 'degraded' | 'blocked' | 'needs_attention' | 'auth_missing' | string;
  required: boolean;
  message?: string;
  evidence?: Record<string, unknown>;
}

export interface StudioDeliveryAudit {
  status: 'ready' | 'degraded' | 'blocked' | string;
  checkedAt: string;
  projectId?: string | null;
  sourceSegmentId?: string | null;
  sourceMediaUrl?: string;
  summary: {
    pages: number;
    agents: number;
    readyTargets: number;
    missingParams: number;
    missingCorePages: number;
    missingCoreAgents: number;
    readinessGates: number;
    readinessReady: number;
    jobs: number;
    artifacts: number;
    actions: number;
  };
  requirements: StudioDeliveryAuditRequirement[];
  actions: StudioHandoffAction[];
  artifacts: StudioHandoffArtifact[];
  reports: {
    health: StudioHealth;
    readiness: StudioReadiness;
    overview: StudioOverview;
    dispatchMatrix: StudioDispatchMatrix;
    coverage: StudioCoverageReport;
    deliveryReport?: StudioProjectDeliveryReport | null;
    handoffSnapshot?: StudioHandoffSnapshot | null;
  };
}

export interface StudioActionResolveResult {
  status: 'executed' | 'skipped' | 'manual_required' | string;
  checkedAt: string;
  action: string;
  targetId: string;
  projectId?: string | null;
  sourceSegmentId?: string | null;
  resultType: 'coverage-verify' | 'operator-instruction' | string;
  message?: string;
  next?: {
    label?: string;
    message?: string;
    env?: string;
    command?: string;
    targetId?: string;
  };
  result?: StudioCoverageVerifyResult;
  audit: StudioDeliveryAudit;
}

export interface StudioActionResolveBatchResult {
  status: 'executed' | 'executed_with_manual' | 'executed_with_skips' | 'manual_required' | 'skipped' | string;
  checkedAt: string;
  projectId?: string | null;
  sourceSegmentId?: string | null;
  summary: {
    requested: number;
    executed: number;
    manualRequired: number;
    skipped: number;
    createdJobs: number;
  };
  executedActions: Array<{
    status: string;
    action: string;
    targetId: string;
    resultType: string;
    jobId?: string;
    message?: string;
  }>;
  manualActions: Array<{
    status: string;
    action: string;
    targetId: string;
    resultType: string;
    message?: string;
    next?: StudioActionResolveResult['next'];
  }>;
  skippedActions: Array<{
    status: string;
    action: string;
    targetId: string;
    resultType: string;
    reason?: string;
    message?: string;
  }>;
  result?: StudioCoverageVerifyResult | null;
  audit: StudioDeliveryAudit;
}

export interface StudioDispatchBatchTarget {
  id: string;
  pageId: StudioApi | string;
  pageName: string;
  kind: string;
  executor: StudioExecutor | string;
  agentId: string;
  recommendedAction: 'navigate' | 'execute-client' | 'execute-server' | string;
  dispatchStatus: string;
  dispatchMessage?: string;
  clientAction?: 'navigate' | string;
  navigationPath?: string;
  studioReturnPath?: string;
  routeParams: string[];
  missingRouteParams: string[];
  authStatus: StudioAuthStatus;
  capabilities: string[];
  projectId?: string | null;
  sourceSegmentId?: string | null;
  sourceMediaUrl?: string;
}

export interface StudioDispatchBatchSkip {
  id: string;
  pageId: StudioApi | string;
  pageName: string;
  kind: string;
  executor: StudioExecutor | string;
  agentId: string;
  recommendedAction: 'navigate' | 'execute-client' | 'execute-server' | string;
  dispatchStatus: string;
  reason: string;
  message?: string;
  navigationPath?: string;
  missingRouteParams: string[];
  authStatus: StudioAuthStatus;
}

export interface StudioDispatchBatchPlan {
  status: 'planned' | 'blocked' | string;
  readyForDispatch: boolean;
  checkedAt: string;
  projectId?: string | null;
  sourceSegmentId?: string | null;
  sourceMediaUrl?: string;
  summary: {
    total: number;
    planned: number;
    skipped: number;
    navigation: number;
    client: number;
    server: number;
    missingParams: number;
    blocked: number;
  };
  targets: StudioDispatchBatchTarget[];
  skippedTargets: StudioDispatchBatchSkip[];
  matrix: StudioDispatchMatrix;
  handoffSnapshot: StudioHandoffSnapshot;
}

export type StudioDispatchSessionTargetStatus = 'pending' | 'visited' | 'completed' | 'skipped' | 'error' | string;

export interface StudioDispatchSessionTarget extends StudioDispatchBatchTarget {
  status: StudioDispatchSessionTargetStatus;
  evidence?: Record<string, unknown>;
  visitedAt?: string;
  completedAt?: string;
  skippedAt?: string;
  erroredAt?: string;
  updatedAt?: string;
}

export interface StudioDispatchSession extends Omit<StudioDispatchBatchPlan, 'status' | 'readyForDispatch' | 'targets'> {
  sessionId: string;
  status: 'active' | 'needs_review' | 'done' | 'blocked' | 'cancelled' | string;
  readyForDispatch: boolean;
  createdAt: string;
  updatedAt: string;
  planStatus?: string;
  summary: StudioDispatchBatchPlan['summary'] & {
    pending: number;
    visited: number;
    completed: number;
    targetSkipped: number;
    targetErrors: number;
  };
  targets: StudioDispatchSessionTarget[];
  nextTarget?: StudioDispatchSessionTarget | null;
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
  routeParams?: string[];
  missingRouteParams?: string[];
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

export interface StudioDispatchPreview {
  page: StudioPageAdapter;
  route: StudioRouteEvent;
  executor: StudioExecutor;
  agentId: string;
  authStatus: StudioAuthStatus;
  dispatchReady: boolean;
  dispatchStatus: string;
  dispatchMessage: string;
  clientAction?: 'navigate' | string;
  navigationPath?: string;
  studioReturnPath?: string;
  routeParams: string[];
  missingRouteParams: string[];
  prompt: string;
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

export async function fetchStudioProjectDeliveryReport(projectId: string): Promise<StudioProjectDeliveryReport> {
  const response = await fetch(`${getStudioProjectEndpoint(projectId)}/delivery-report`);
  if (!response.ok) {
    throw new Error(`Studio delivery report ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchStudioProjectDeliveryBundle(options: {
  projectId: string;
  sourceSegmentId?: string;
}): Promise<StudioDeliveryBundle> {
  const params = new URLSearchParams();
  if (options.sourceSegmentId) params.set('source_segment_id', options.sourceSegmentId);
  const query = params.toString();
  const response = await fetch(`${getStudioProjectEndpoint(options.projectId)}/delivery-bundle${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error(`Studio delivery bundle ${response.status}: ${response.statusText}`);
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

export async function fetchStudioOverview(limit = 50): Promise<StudioOverview> {
  const response = await fetch(getStudioRootEndpoint(`/api/studio/overview?limit=${encodeURIComponent(String(limit))}`));
  if (!response.ok) throw new Error(`Studio overview ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchStudioReadiness(): Promise<StudioReadiness> {
  const response = await fetch(getStudioRootEndpoint('/api/studio/readiness'));
  if (!response.ok) throw new Error(`Studio readiness ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchStudioDeliveryAudit(options: {
  projectId?: string;
  sourceSegmentId?: string;
} = {}): Promise<StudioDeliveryAudit> {
  const params = new URLSearchParams();
  if (options.projectId) params.set('project_id', options.projectId);
  if (options.sourceSegmentId) params.set('source_segment_id', options.sourceSegmentId);
  const query = params.toString();
  const response = await fetch(getStudioRootEndpoint(`/api/studio/delivery-audit${query ? `?${query}` : ''}`));
  if (!response.ok) throw new Error(`Studio delivery audit ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchStudioDispatchMatrix(options: {
  projectId?: string;
  sourceSegmentId?: string;
} = {}): Promise<StudioDispatchMatrix> {
  const params = new URLSearchParams();
  if (options.projectId) params.set('project_id', options.projectId);
  if (options.sourceSegmentId) params.set('source_segment_id', options.sourceSegmentId);
  const query = params.toString();
  const response = await fetch(getStudioRootEndpoint(`/api/studio/dispatch-matrix${query ? `?${query}` : ''}`));
  if (!response.ok) throw new Error(`Studio dispatch matrix ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchStudioCoverage(options: {
  projectId?: string;
  sourceSegmentId?: string;
} = {}): Promise<StudioCoverageReport> {
  const params = new URLSearchParams();
  if (options.projectId) params.set('project_id', options.projectId);
  if (options.sourceSegmentId) params.set('source_segment_id', options.sourceSegmentId);
  const query = params.toString();
  const response = await fetch(getStudioRootEndpoint(`/api/studio/coverage${query ? `?${query}` : ''}`));
  if (!response.ok) throw new Error(`Studio coverage ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchStudioHandoffSnapshot(options: {
  projectId?: string;
  sourceSegmentId?: string;
} = {}): Promise<StudioHandoffSnapshot> {
  const params = new URLSearchParams();
  if (options.projectId) params.set('project_id', options.projectId);
  if (options.sourceSegmentId) params.set('source_segment_id', options.sourceSegmentId);
  const query = params.toString();
  const response = await fetch(getStudioRootEndpoint(`/api/studio/handoff-snapshot${query ? `?${query}` : ''}`));
  if (!response.ok) throw new Error(`Studio handoff snapshot ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function planStudioDispatchBatch(options: {
  projectId?: string;
  sourceSegmentId?: string;
  pageIds?: Array<StudioApi | string>;
  limit?: number;
} = {}): Promise<StudioDispatchBatchPlan> {
  const response = await fetch(getStudioRootEndpoint('/api/studio/dispatch-batch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: options.projectId,
      source_segment_id: options.sourceSegmentId,
      page_ids: options.pageIds,
      limit: options.limit || 50,
    }),
  });
  if (!response.ok) throw new Error(`Studio dispatch batch ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function createStudioDispatchSession(options: {
  projectId?: string;
  sourceSegmentId?: string;
  pageIds?: Array<StudioApi | string>;
  limit?: number;
} = {}): Promise<StudioDispatchSession> {
  const response = await fetch(getStudioRootEndpoint('/api/studio/dispatch-sessions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: options.projectId,
      source_segment_id: options.sourceSegmentId,
      page_ids: options.pageIds,
      limit: options.limit || 50,
    }),
  });
  if (!response.ok) throw new Error(`Studio dispatch session ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchStudioDispatchSessions(options: {
  projectId?: string;
  limit?: number;
} = {}): Promise<StudioDispatchSession[]> {
  const params = new URLSearchParams();
  if (options.projectId) params.set('project_id', options.projectId);
  params.set('limit', String(options.limit || 20));
  const response = await fetch(getStudioRootEndpoint(`/api/studio/dispatch-sessions?${params.toString()}`));
  if (!response.ok) throw new Error(`Studio dispatch sessions ${response.status}: ${response.statusText}`);
  const body = await response.json();
  return body.sessions || [];
}

export async function fetchStudioDispatchSession(sessionId: string): Promise<StudioDispatchSession> {
  const response = await fetch(getStudioRootEndpoint(`/api/studio/dispatch-sessions/${encodeURIComponent(sessionId)}`));
  if (!response.ok) throw new Error(`Studio dispatch session ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function updateStudioDispatchSessionTarget(options: {
  sessionId: string;
  targetId: string;
  status: StudioDispatchSessionTargetStatus;
  evidence?: Record<string, unknown>;
}): Promise<StudioDispatchSession> {
  const response = await fetch(
    getStudioRootEndpoint(
      `/api/studio/dispatch-sessions/${encodeURIComponent(options.sessionId)}/targets/${encodeURIComponent(options.targetId)}`,
    ),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: options.status,
        evidence: options.evidence || {},
      }),
    },
  );
  if (!response.ok) throw new Error(`Studio dispatch target ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function verifyStudioCoverage(options: {
  projectId?: string;
  sourceSegmentId?: string;
  pageIds?: Array<StudioApi | string>;
  limit?: number;
} = {}): Promise<StudioCoverageVerifyResult> {
  const response = await fetch(getStudioRootEndpoint('/api/studio/coverage/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: options.projectId,
      source_segment_id: options.sourceSegmentId,
      page_ids: options.pageIds,
      limit: options.limit || 50,
    }),
  });
  if (!response.ok) throw new Error(`Studio coverage verify ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function resolveStudioAction(options: {
  action: string;
  targetId: string;
  projectId?: string;
  sourceSegmentId?: string;
}): Promise<StudioActionResolveResult> {
  const response = await fetch(getStudioRootEndpoint('/api/studio/actions/resolve'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: options.action,
      target_id: options.targetId,
      project_id: options.projectId,
      source_segment_id: options.sourceSegmentId,
    }),
  });
  if (!response.ok) throw new Error(`Studio action resolve ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function resolveStudioActionsBatch(options: {
  projectId?: string;
  sourceSegmentId?: string;
  actions?: Array<{ action: string; targetId?: string; target_id?: string }>;
}): Promise<StudioActionResolveBatchResult> {
  const response = await fetch(getStudioRootEndpoint('/api/studio/actions/resolve-batch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: options.projectId,
      source_segment_id: options.sourceSegmentId,
      actions: options.actions?.map((action) => ({
        action: action.action,
        target_id: action.target_id || action.targetId,
      })),
    }),
  });
  if (!response.ok) throw new Error(`Studio action resolve batch ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchStudioDispatchPreview(
  options: {
    message?: string;
    projectId?: string;
    action?: StudioAction;
    sourceSegmentId?: string;
    pageId?: StudioApi | string;
    agentId?: string;
    hasImage?: boolean;
  } = {},
): Promise<StudioDispatchPreview> {
  const params = new URLSearchParams();
  if (options.message) params.set('message', options.message);
  if (options.projectId) params.set('project_id', options.projectId);
  if (options.action) params.set('action', options.action);
  if (options.sourceSegmentId) params.set('source_segment_id', options.sourceSegmentId);
  if (options.pageId) params.set('page_id', options.pageId);
  if (options.agentId) params.set('agent_id', options.agentId);
  if (typeof options.hasImage === 'boolean') params.set('has_image', String(options.hasImage));
  const query = params.toString();
  const response = await fetch(getStudioRootEndpoint(`/api/studio/dispatch-preview${query ? `?${query}` : ''}`));
  if (!response.ok) throw new Error(`Studio dispatch preview ${response.status}: ${response.statusText}`);
  return response.json();
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

export async function bulkStudioJobs(options: {
  action: 'cancel' | 'retry';
  projectId?: string;
  status?: StudioStatus | string;
  pageId?: StudioApi | string;
  agentId?: string;
  includeTerminal?: boolean;
  limit?: number;
}): Promise<{
  action: 'cancel' | 'retry';
  matchedCount: number;
  skippedCount?: number;
  jobs: StudioJob[];
  skippedJobs?: StudioJob[];
  projects?: StudioProject[];
  executionRequests?: StudioExecutionRequest[];
}> {
  const response = await fetch(getStudioRootEndpoint('/api/studio/jobs/bulk'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: options.action,
      project_id: options.projectId,
      status: options.status,
      page_id: options.pageId,
      agent_id: options.agentId,
      include_terminal: options.includeTerminal,
      limit: options.limit || 100,
    }),
  });
  if (!response.ok) throw new Error(`Studio bulk ${options.action} ${response.status}: ${response.statusText}`);
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

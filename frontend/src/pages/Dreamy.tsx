import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Film,
  GitBranch,
  Hand,
  ImagePlus,
  Layers3,
  Link2,
  Loader2,
  Maximize2,
  MousePointer2,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Send,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Volume2,
  Wand2,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import presetCharacterGif from '../assets/dreamy-preset-character.gif';
import presetCinematicGif from '../assets/dreamy-preset-cinematic.gif';
import exampleGood from '../assets/example-good.png';
import exampleMultiple from '../assets/example-multiple.png';
import exampleSmall from '../assets/example-small.png';
import { useEnergy } from '../contexts/EnergyContext';
import { fetchGenerateResult, hasTelegramInitData } from '../services/api';
import {
  bulkStudioJobs,
  cancelStudioDispatchSession,
  cancelStudioJob,
  createStudioDispatchSession,
  createStudioTimelineExport,
  extractGenerateTaskMedia,
  fetchStudioCoverage,
  fetchStudioDeliveryAudit,
  fetchStudioDispatchMatrix,
  fetchStudioDispatchPreview,
  fetchStudioAgents,
  fetchStudioBotPreviews,
  fetchStudioHandoffSnapshot,
  fetchStudioHealth,
  fetchStudioJobs,
  fetchStudioOverview,
  fetchStudioPages,
  fetchStudioProjectDeliveryBundle,
  fetchStudioProjectDeliveryReport,
  fetchStudioProjects,
  fetchStudioReadiness,
  fetchStudioDispatchSession,
  fetchStudioDispatchSessions,
  fetchVerifiedDreamyWorkshopProject,
  getStudioDispatchSelectionPageIds,
  getStudioDispatchTargetHref,
  getStudioRootEndpoint,
  planStudioDispatchBatch,
  pollStudioJob,
  postStudioClientResult,
  resetStudioProject,
  resolveStudioAction,
  resolveStudioActionsBatch,
  retryStudioDispatchSession,
  retryStudioJob,
  resolveStudioAssetUrl,
  runStudioDispatchSessionTarget,
  streamStudioRun,
  submitDreamyMiniappJob,
  toggleStudioDispatchPageSelection,
  updateStudioDispatchSessionTarget,
  verifyStudioCoverage,
} from '../services/dreamyUnified';
import {
  buildStudioDispatchNavigationPath,
  clearStudioDispatchSession,
  forgetLastStudioProjectId,
  normalizeStudioNavigationPath,
  readLastStudioProjectId,
  readStudioDispatchSession,
  saveLastStudioProjectId,
  saveStudioDispatchSession,
} from '../services/studioSession';
import type {
  StudioAgentCapability,
  StudioAction,
  StudioAgentNode,
  StudioActionResolveResult,
  StudioApi,
  StudioBotPreview,
  StudioBotPreviewsResponse,
  StudioCoverageReport,
  StudioDeliveryAudit,
  StudioDeliveryBundle,
  StudioDispatchMatrix,
  StudioDispatchMatrixEntry,
  StudioDispatchBatchPlan,
  StudioDispatchBatchTarget,
  StudioDispatchSession,
  StudioDispatchSessionRetryResult,
  StudioDispatchSessionTarget,
  StudioDispatchSessionTargetRunResult,
  StudioDispatchPreview,
  StudioExecutor,
  StudioExecutionRequest,
  StudioHandoffAction,
  StudioHandoffArtifact,
  StudioHandoffSnapshot,
  StudioHealth,
  StudioJob,
  StudioMode,
  StudioOverview,
  StudioOverviewPage,
  StudioPageAdapter,
  StudioProgressEvent,
  StudioProject,
  StudioProjectDeliveryReport,
  StudioReadiness,
  StudioRouteEvent,
  StudioRunEvent,
  StudioSegment,
  StudioStatus,
} from '../services/dreamyUnified';
import { trackEvent } from '../services/tracking';

const CanvasPro = lazy(() => import('./CanvasPro'));

type TabKey = 'chat' | 'preview';
type StudioWorkspace = 'orchestrator' | 'canvaspro';
type CanvasTool = 'select' | 'pan' | 'connect';
type CanvasNodeKind =
  | 'prompt'
  | 'agent'
  | 'segment'
  | 'output'
  | 'source-text'
  | 'source-image'
  | 'source-video'
  | 'source-audio'
  | 'ai-text'
  | 'ai-image'
  | 'ai-video'
  | 'ai-audio'
  | 'annotation';
type CanvasSourceType = 'text' | 'image' | 'video' | 'audio' | 'json';
type CanvasBoardId = 'story' | 'media' | 'timeline';

interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status?: string;
  action?: StudioAction;
  prompt?: string;
  segmentId?: string;
  agentId?: string;
  botSlug?: string;
  botName?: string;
  mediaUrl?: string;
  sourceType?: CanvasSourceType;
  fileName?: string;
  outputText?: string;
  boardId?: CanvasBoardId;
}

interface CanvasConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface CanvasSnapshot {
  customNodes: CanvasNode[];
  customConnections: CanvasConnection[];
  positionOverrides: Record<string, { x: number; y: number }>;
}

interface CanvasContextMenuState {
  screenX: number;
  screenY: number;
  canvasX: number;
  canvasY: number;
}

function getInitialCanvasView() {
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    return { zoom: 0.56, pan: { x: -120, y: 20 } };
  }
  return { zoom: 0.82, pan: { x: 88, y: 10 } };
}

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

interface StudioDispatchRunOverride {
  pageId: StudioApi | string;
  agentId?: string;
  pageName?: string;
  executor?: StudioExecutor;
  mode?: StudioMode;
  botId?: string;
  articleId?: string;
  botSlug?: string;
  botName?: string;
  botType?: string;
  botSequence?: ManualBotEntry[];
}

interface ManualBotEntry {
  id: string;
  botId: string;
  botSlug: string;
  botName: string;
  botType: string;
  articleId: string;
  action: StudioAction;
}

interface StudioStarterPreset {
  id: string;
  title: string;
  prompt: string;
  pageId: StudioApi | string;
  pageName: string;
  agentId: string;
  botId?: string;
  articleId?: string;
  botSlug: string;
  recommendation: string;
  visualUrl: string;
  fallbackVisualUrl: string;
  previewStatus: string;
  previewAccepted: boolean;
  previewSource: string;
  previewLabel: string;
  workflow: string;
  steps: string[];
  estimatedWaitSeconds: number;
}

interface CanvasFlowPreset {
  id: string;
  title: string;
  summary: string;
  action: StudioAction;
  prompt: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

const DEFAULT_DREAMY_SLUG = '3d-anime-porn';
const DREAMY_VIDEO_SLUG = '3d-futa-porn';
const VERIFIED_WORKSHOP_PROJECT_ID = 'dreamy_verified_workshop_two_bot';
const VERIFIED_WORKSHOP_SEGMENTS: StudioSegment[] = [
  {
    id: 'verified_workshop_segment_1',
    type: 'video',
    url: 'https://d2rzqgs9j5kr8g.cloudfront.net/video/chat/embed_obj/202606030911/551da3b2c0274fab8e1cd12c554186d4.mp4',
    posterUrl: 'https://www.myshellstatic.com/video/chat/embed_obj/202606030911/551da3b2c0274fab8e1cd12c554186d4-poster.jpg',
    prompt: 'Verified Dreamy workshop result from 3D Anime Porn.',
    botSlug: DEFAULT_DREAMY_SLUG,
    botId: '1769085605',
    articleId: DEFAULT_DREAMY_SLUG,
    botName: '3D Anime Porn',
    action: 'generate',
    status: 'done',
    taskId: 'bdcc5855a80f479dafe39c3afd3ab6fa',
    evidence: {
      status: 'done',
      source: 'dreamyporn-workshop-web',
      accepted: true,
      mediaUrl: 'https://d2rzqgs9j5kr8g.cloudfront.net/video/chat/embed_obj/202606030911/551da3b2c0274fab8e1cd12c554186d4.mp4',
      taskId: 'bdcc5855a80f479dafe39c3afd3ab6fa',
      message: 'Real Dreamy workshop bot completed and returned playable media.',
      checkedAt: '2026-06-03T09:11:00Z',
    },
    createdAt: '2026-06-03T09:11:00Z',
    updatedAt: '2026-06-03T09:11:00Z',
  },
  {
    id: 'verified_workshop_segment_2',
    type: 'video',
    url: 'https://d2rzqgs9j5kr8g.cloudfront.net/video/chat/embed_obj/202606030923/ed0e2719080742b5a5db07483f439a84.mp4',
    posterUrl: 'https://www.myshellstatic.com/video/chat/embed_obj/202606030923/ed0e2719080742b5a5db07483f439a84-poster.jpg',
    prompt: 'Verified Dreamy workshop result from 3D Futa Porn, staged as the next segment.',
    botSlug: DREAMY_VIDEO_SLUG,
    botId: '1768994068',
    articleId: DREAMY_VIDEO_SLUG,
    botName: '3D Futa Porn',
    action: 'extend',
    parentSegmentId: 'verified_workshop_segment_1',
    status: 'done',
    taskId: 'ed8d4bd4aab74245aadb8f8a832c3f4b',
    evidence: {
      status: 'done',
      source: 'dreamyporn-workshop-web',
      accepted: true,
      mediaUrl: 'https://d2rzqgs9j5kr8g.cloudfront.net/video/chat/embed_obj/202606030923/ed0e2719080742b5a5db07483f439a84.mp4',
      taskId: 'ed8d4bd4aab74245aadb8f8a832c3f4b',
      message: 'Second real Dreamy workshop bot completed and is staged as a timeline extension.',
      checkedAt: '2026-06-03T09:23:00Z',
    },
    createdAt: '2026-06-03T09:23:00Z',
    updatedAt: '2026-06-03T09:23:00Z',
  },
];
const LOCAL_POSTERS = [exampleGood, exampleMultiple];
const DEFAULT_STUDIO_AGENT_ID = 'dreamy-miniapp-executor';
const TRANSIENT_STUDIO_STATUSES = new Set(['queued', 'running']);
const DREAMY_STARTER_PRESETS: StudioStarterPreset[] = [
  {
    id: 'verified-3d-anime',
    title: '3D Anime Porn',
    prompt: 'Continue from the verified 3D Anime Porn workshop output with a matching five second shot.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: DEFAULT_DREAMY_SLUG,
    botId: '1769085605',
    articleId: DEFAULT_DREAMY_SLUG,
    recommendation: 'Verified workshop bot with completed media already staged in the timeline.',
    visualUrl: VERIFIED_WORKSHOP_SEGMENTS[0].posterUrl || presetCinematicGif,
    fallbackVisualUrl: presetCinematicGif,
    previewStatus: 'done',
    previewAccepted: true,
    previewSource: 'dreamyporn-workshop-web',
    previewLabel: 'Verified result',
    workflow: 'Workshop video',
    steps: ['Verified bot', 'Video segment', 'Timeline'],
    estimatedWaitSeconds: 0,
  },
  {
    id: 'verified-3d-futa',
    title: '3D Futa Porn',
    prompt: 'Append a next segment from the verified 3D Futa Porn workshop output.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: DREAMY_VIDEO_SLUG,
    botId: '1768994068',
    articleId: DREAMY_VIDEO_SLUG,
    recommendation: 'Verified workshop bot used as the second timeline segment.',
    visualUrl: VERIFIED_WORKSHOP_SEGMENTS[1].posterUrl || presetCharacterGif,
    fallbackVisualUrl: presetCharacterGif,
    previewStatus: 'done',
    previewAccepted: true,
    previewSource: 'dreamyporn-workshop-web',
    previewLabel: 'Verified result',
    workflow: 'Workshop video',
    steps: ['Verified bot', 'Next segment', 'Timeline'],
    estimatedWaitSeconds: 0,
  },
];

const DREAMY_CATALOG_FALLBACK_PRESETS: StudioStarterPreset[] = [
  {
    id: 'catalog-aurora-dusk',
    title: 'Aurora Dusk',
    prompt: 'Animate the current Dreamy source into a five second Aurora Dusk video segment with smooth cinematic motion.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: 'aurora-dusk',
    botId: 'aurora-dusk',
    articleId: 'aurora-dusk',
    recommendation: 'Dreamy miniapp video generation for extending Studio timelines.',
    visualUrl: '',
    fallbackVisualUrl: presetCinematicGif,
    previewStatus: 'catalog_ready',
    previewAccepted: true,
    previewSource: 'dreamy-catalog',
    previewLabel: 'Catalog media',
    workflow: 'Image to video',
    steps: ['Source image', 'Motion prompt', 'Video segment'],
    estimatedWaitSeconds: 60,
  },
  {
    id: 'catalog-crystal-rose',
    title: 'Crystal Rose',
    prompt: 'Create a polished Dreamy image with Crystal Rose, cinematic lighting and a clean portrait composition.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: 'crystal-rose',
    botId: 'crystal-rose',
    articleId: 'crystal-rose',
    recommendation: 'Dreamy miniapp outfit and portrait generation.',
    visualUrl: '',
    fallbackVisualUrl: exampleSmall,
    previewStatus: 'catalog_ready',
    previewAccepted: true,
    previewSource: 'dreamy-catalog',
    previewLabel: 'Catalog media',
    workflow: 'Text to image',
    steps: ['Prompt', 'Dreamy bot', 'Image segment'],
    estimatedWaitSeconds: 30,
  },
  {
    id: 'catalog-ember-fox',
    title: 'Ember Fox',
    prompt: 'Create a classic Dreamy scene with Ember Fox, warm studio lighting and a production-ready composition.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: 'ember-fox',
    botId: 'ember-fox',
    articleId: 'ember-fox',
    recommendation: 'Dreamy miniapp classic scene generation.',
    visualUrl: '',
    fallbackVisualUrl: exampleGood,
    previewStatus: 'catalog_ready',
    previewAccepted: true,
    previewSource: 'dreamy-catalog',
    previewLabel: 'Catalog media',
    workflow: 'Text to image',
    steps: ['Prompt', 'Dreamy bot', 'Image segment'],
    estimatedWaitSeconds: 30,
  },
  {
    id: 'catalog-jade-river',
    title: 'Jade River',
    prompt: 'Create a vivid Dreamy wild encounter style image with Jade River and cinematic lighting.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: 'jade-river',
    botId: 'jade-river',
    articleId: 'jade-river',
    recommendation: 'Dreamy miniapp wild encounter image generation.',
    visualUrl: '',
    fallbackVisualUrl: exampleMultiple,
    previewStatus: 'catalog_ready',
    previewAccepted: true,
    previewSource: 'dreamy-catalog',
    previewLabel: 'Catalog media',
    workflow: 'Text to image',
    steps: ['Prompt', 'Dreamy bot', 'Image segment'],
    estimatedWaitSeconds: 30,
  },
  {
    id: 'catalog-luna-star',
    title: 'Luna Star',
    prompt: 'Create a character image with Luna Star, clear subject and polished Dreamy composition.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: 'luna-star',
    botId: 'luna-star',
    articleId: 'luna-star',
    recommendation: 'Dreamy miniapp character image generation.',
    visualUrl: '',
    fallbackVisualUrl: presetCharacterGif,
    previewStatus: 'catalog_ready',
    previewAccepted: true,
    previewSource: 'dreamy-catalog',
    previewLabel: 'Catalog media',
    workflow: 'Text to image',
    steps: ['Prompt', 'Dreamy bot', 'Image segment'],
    estimatedWaitSeconds: 30,
  },
  {
    id: 'catalog-nova-silk',
    title: 'Nova Silk',
    prompt: 'Create a celebrity style Dreamy image with Nova Silk, strong lighting and high-detail composition.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: 'nova-silk',
    botId: 'nova-silk',
    articleId: 'nova-silk',
    recommendation: 'Dreamy miniapp celebrity style image generation.',
    visualUrl: '',
    fallbackVisualUrl: exampleGood,
    previewStatus: 'catalog_ready',
    previewAccepted: true,
    previewSource: 'dreamy-catalog',
    previewLabel: 'Catalog media',
    workflow: 'Text to image',
    steps: ['Prompt', 'Dreamy bot', 'Image segment'],
    estimatedWaitSeconds: 30,
  },
  {
    id: 'catalog-scarlet-bloom',
    title: 'Scarlet Bloom',
    prompt: 'Create a fashion-forward Dreamy image with Scarlet Bloom, polished framing and cinematic color.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: 'scarlet-bloom',
    botId: 'scarlet-bloom',
    articleId: 'scarlet-bloom',
    recommendation: 'Dreamy miniapp fashion image generation.',
    visualUrl: '',
    fallbackVisualUrl: exampleSmall,
    previewStatus: 'catalog_ready',
    previewAccepted: true,
    previewSource: 'dreamy-catalog',
    previewLabel: 'Catalog media',
    workflow: 'Text to image',
    steps: ['Prompt', 'Dreamy bot', 'Image segment'],
    estimatedWaitSeconds: 30,
  },
  {
    id: 'catalog-violet-haze',
    title: 'Violet Haze',
    prompt: 'Create a Dreamy category image with Violet Haze, expressive styling and a clean final composition.',
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: 'violet-haze',
    botId: 'violet-haze',
    articleId: 'violet-haze',
    recommendation: 'Dreamy miniapp category image generation.',
    visualUrl: '',
    fallbackVisualUrl: presetCinematicGif,
    previewStatus: 'catalog_ready',
    previewAccepted: true,
    previewSource: 'dreamy-catalog',
    previewLabel: 'Catalog media',
    workflow: 'Text to image',
    steps: ['Prompt', 'Dreamy bot', 'Image segment'],
    estimatedWaitSeconds: 30,
  },
];

const CANVAS_FLOW_PRESETS: CanvasFlowPreset[] = [
  {
    id: 'text-image-video',
    title: 'Text -> Image -> Video',
    summary: 'Create a source frame first, animate it, then stage the clip on the timeline.',
    action: 'generate',
    prompt: 'Build a neon rainy city source image, then turn the selected image into a five second cinematic video segment.',
    nodes: [
      {
        id: 'flow-text-image',
        kind: 'agent',
        title: 'Flow 01 Text to Image',
        subtitle: 'Generate the source frame from the user prompt',
        x: 260,
        y: 178,
        width: 250,
        height: 112,
        status: 'ready',
        action: 'generate',
        prompt: 'Generate the strongest source image for this scene.',
        botName: '3D Anime Porn',
        botSlug: DEFAULT_DREAMY_SLUG,
      },
      {
        id: 'flow-image-video',
        kind: 'agent',
        title: 'Flow 02 Image to Video',
        subtitle: 'Animate the selected source image into a short clip',
        x: 580,
        y: 178,
        width: 260,
        height: 112,
        status: 'queued',
        action: 'extend',
        prompt: 'Use the selected image as the source and create a five second motion shot.',
        botName: '3D Futa Porn',
        botSlug: DREAMY_VIDEO_SLUG,
      },
      {
        id: 'flow-timeline-video',
        kind: 'segment',
        title: 'Flow 03 Video Segment',
        subtitle: 'Review, rerun, or extend the produced video clip',
        x: 900,
        y: 178,
        width: 260,
        height: 124,
        status: 'idle',
        action: 'extend',
        prompt: 'Extend this shot into the next clip with matching lighting and character continuity.',
        botName: 'Dreamy Video Segment',
        botSlug: DREAMY_VIDEO_SLUG,
      },
    ],
    connections: [
      { id: 'flow-root-to-text-image', from: 'prompt-root', to: 'flow-text-image', label: 'prompt' },
      { id: 'flow-text-image-to-image-video', from: 'flow-text-image', to: 'flow-image-video', label: 'source image' },
      { id: 'flow-image-video-to-timeline-video', from: 'flow-image-video', to: 'flow-timeline-video', label: 'motion' },
      { id: 'flow-timeline-video-to-output', from: 'flow-timeline-video', to: 'timeline-output', label: 'sequence' },
    ],
  },
  {
    id: 'segment-rerun-long-video',
    title: 'Segment Rerun -> Long Video',
    summary: 'Regenerate weak clips, keep accepted clips, then export the whole sequence.',
    action: 'retry-agent',
    prompt: 'Rerun only the selected weak segment with the same character and lighting, then keep the timeline ready for a long video export.',
    nodes: [
      {
        id: 'flow-rerun-segment',
        kind: 'agent',
        title: 'Flow 01 Rerun Segment',
        subtitle: 'Repeat production for the selected clip without touching accepted clips',
        x: 274,
        y: 350,
        width: 276,
        height: 112,
        status: 'ready',
        action: 'retry-agent',
        prompt: 'Rerun the selected clip and preserve the surrounding timeline.',
        botName: 'Segment Retry Agent',
        botSlug: DEFAULT_DREAMY_SLUG,
      },
      {
        id: 'flow-export-long',
        kind: 'output',
        title: 'Flow 02 Long Video Export',
        subtitle: 'Collect every accepted segment into one export manifest',
        x: 646,
        y: 350,
        width: 306,
        height: 112,
        status: 'ready',
      },
    ],
    connections: [
      { id: 'flow-root-to-rerun-segment', from: 'prompt-root', to: 'flow-rerun-segment', label: 'selected clip' },
      { id: 'flow-rerun-segment-to-export-long', from: 'flow-rerun-segment', to: 'flow-export-long', label: 'approved' },
      { id: 'flow-export-long-to-output', from: 'flow-export-long', to: 'timeline-output', label: 'export all' },
    ],
  },
];

function rankStarterPresets(
  presets: StudioStarterPreset[],
  sourceSegment?: StudioSegment | null,
  hasReferenceImage = false,
): StudioStarterPreset[] {
  const preferredOrder =
    sourceSegment?.type === 'image'
      ? ['verified-3d-futa', 'verified-3d-anime']
      : sourceSegment?.type === 'video'
        ? ['verified-3d-futa', 'verified-3d-anime']
        : hasReferenceImage
          ? ['verified-3d-futa', 'verified-3d-anime']
          : ['verified-3d-anime', 'verified-3d-futa'];
  const order = new Map(preferredOrder.map((id, index) => [id, index]));
  return [...presets].sort((left, right) => (order.get(left.id) ?? 99) - (order.get(right.id) ?? 99));
}

function isDreamyStudioBot(preview: StudioBotPreview): boolean {
  return preview.pageId === 'dreamy-miniapp';
}

function getStarterPresetAction(preset: StudioStarterPreset, sourceSegment?: StudioSegment | null): StudioAction {
  if ((preset.botSlug === DREAMY_VIDEO_SLUG || preset.workflow.toLowerCase().includes('video')) && sourceSegment) return 'extend';
  return 'generate';
}

function botTypeForStarterPreset(preset: StudioStarterPreset): string {
  return preset.workflow.toLowerCase().includes('video') ? 'image-to-video' : 'text-to-image';
}

function getStarterPresetRunLabel(preset: StudioStarterPreset, sourceSegment?: StudioSegment | null): string {
  return getStarterPresetAction(preset, sourceSegment) === 'extend' ? 'Append segment' : 'Add segment';
}

function verifiedWorkshopBotMatches(
  segment: StudioSegment,
  target: Partial<Pick<StudioStarterPreset, 'botSlug' | 'botId' | 'articleId' | 'title'>>,
): boolean {
  const values = [target.botSlug, target.botId, target.articleId, target.title].filter(Boolean).map((value) => String(value).toLowerCase());
  const segmentValues = [segment.botSlug, segment.botId, segment.articleId, segment.botName]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => segmentValues.includes(value));
}

function findVerifiedWorkshopSegmentForBot(
  target: Partial<Pick<StudioStarterPreset, 'botSlug' | 'botId' | 'articleId' | 'title'>>,
): StudioSegment | null {
  return VERIFIED_WORKSHOP_SEGMENTS.find((segment) => verifiedWorkshopBotMatches(segment, target)) || null;
}

function resolveVerifiedWorkshopVisual(
  target: Partial<Pick<StudioStarterPreset, 'botSlug' | 'botId' | 'articleId' | 'title'>>,
): string {
  const segment = findVerifiedWorkshopSegmentForBot(target);
  return resolveStudioDisplayAssetUrl(segment?.posterUrl || '') || resolveStudioDisplayAssetUrl(segment?.url || '') || '';
}

function previewLabelFor(preview?: StudioBotPreview): string {
  if (!preview) return 'Local fallback';
  if (preview.status === 'ready' && preview.accepted) {
    return preview.botSpecific ? 'Bot result' : 'MyShell result';
  }
  if (preview.status === 'catalog_ready') return 'Catalog media';
  if (preview.status === 'auth_missing' || preview.evidence?.status === 'auth_missing') return 'Needs auth';
  if (preview.status === 'needs_generation') return 'Needs refresh';
  return preview.status || 'Preview pending';
}

function workflowForDreamyBotType(botType?: string): string {
  return (botType || '').toLowerCase().includes('video') ? 'Image to video' : 'Text to image';
}

function stepsForDreamyBotType(botType?: string): string[] {
  return (botType || '').toLowerCase().includes('video')
    ? ['Source image', 'Motion prompt', 'Video segment']
    : ['Prompt', 'Dreamy bot', 'Image segment'];
}

function parseManualBotEntries(value: string): ManualBotEntry[] {
  const rows = value
    .split(/\n|;/)
    .flatMap((row) => (row.includes('|') ? [row] : row.split(',')))
    .map((row) => row.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return rows.slice(0, 12).flatMap((row, index) => {
    const [rawBotId, rawName, rawType, rawSlug, rawArticleId] = row.split('|').map((part) => part.trim());
    const botId = rawBotId || '';
    const botSlug = rawSlug || botId;
    if (!botId && !botSlug) return [];
    const key = `${botId}:${botSlug}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const botType = rawType || (index === 0 ? 'text-to-image' : 'image-to-video');
    return [
      {
        id: `manual-bot-${index}-${botId || botSlug}`,
        botId,
        botSlug,
        botName: rawName || `Manual Bot ${index + 1}`,
        botType,
        articleId: rawArticleId || botSlug || botId,
        action: index === 0 ? 'generate' : 'extend',
      },
    ];
  });
}

function starterPresetFromBotPreview(preview: StudioBotPreview): StudioStarterPreset {
  const botType = preview.botType || '';
  const fallbackVisualUrl = fallbackVisualForDreamyBot(preview.botSlug, preview.botName);
  const verifiedVisualUrl = resolveVerifiedWorkshopVisual({
    botSlug: preview.botSlug,
    botId: preview.botId,
    articleId: preview.articleId,
    title: preview.botName,
  });
  const imageUrl = verifiedVisualUrl || resolveStudioDisplayAssetUrl(preview.thumbnailUrl || preview.posterUrl || preview.mediaUrl) || fallbackVisualUrl;
  const verifiedSegment = findVerifiedWorkshopSegmentForBot({
    botSlug: preview.botSlug,
    botId: preview.botId,
    articleId: preview.articleId,
    title: preview.botName,
  });
  const isVideo = botType.toLowerCase().includes('video');
  return {
    id: `dreamy-bot-${preview.botSlug}`,
    title: preview.botName,
    prompt: isVideo
      ? `Animate the selected Dreamy source image with ${preview.botName}, preserving character continuity and cinematic motion.`
      : `Create a polished Dreamy image with ${preview.botName}, cinematic lighting, clear subject, and production-ready composition.`,
    pageId: 'dreamy-miniapp',
    pageName: 'Dreamy Miniapp',
    agentId: DEFAULT_STUDIO_AGENT_ID,
    botSlug: preview.botSlug,
    botId: preview.botId || verifiedSegment?.botId,
    articleId: preview.articleId || verifiedSegment?.articleId || preview.botSlug,
    recommendation: preview.generatedPrompt || preview.evidence?.message || `Run ${preview.botName} through the Dreamy miniapp.`,
    visualUrl: imageUrl,
    fallbackVisualUrl,
    previewStatus: verifiedSegment ? 'done' : preview.status,
    previewAccepted: Boolean(verifiedSegment || preview.botSpecific || preview.mediaUrl || preview.thumbnailUrl || preview.posterUrl),
    previewSource: verifiedSegment ? 'dreamyporn-workshop-web' : preview.source || 'dreamy-catalog',
    previewLabel: verifiedSegment ? 'Verified result' : previewLabelFor(preview),
    workflow: workflowForDreamyBotType(botType),
    steps: stepsForDreamyBotType(botType),
    estimatedWaitSeconds: isVideo ? 60 : 30,
  };
}

function hydrateStarterPresets(
  presets: StudioStarterPreset[],
  previewsResponse: StudioBotPreviewsResponse | null,
): StudioStarterPreset[] {
  if (!previewsResponse?.previews?.length) return presets;
  const previewBySlug = new Map(previewsResponse.previews.map((preview) => [preview.botSlug, preview]));
  return presets.map((preset) => {
    const manifestStarter = previewsResponse.starterPresets?.[preset.id];
    const manifestPreview = manifestStarter?.botSlug ? previewBySlug.get(manifestStarter.botSlug) : undefined;
    const previewSlug = manifestPreview && isDreamyStudioBot(manifestPreview) ? manifestStarter?.botSlug || preset.botSlug : preset.botSlug;
    const preview = previewBySlug.get(previewSlug);
    const verifiedSegment = findVerifiedWorkshopSegmentForBot({
      botSlug: previewSlug,
      botId: preview?.botId || preset.botId,
      articleId: preview?.articleId || preset.articleId,
      title: preview?.botName || preset.title,
    });
    const previewMedia =
      resolveStudioDisplayAssetUrl(verifiedSegment?.posterUrl || '') ||
      resolveStudioDisplayAssetUrl(preview?.thumbnailUrl || preview?.posterUrl || preview?.mediaUrl);
    const visualUrl = previewMedia || preset.visualUrl || preset.fallbackVisualUrl;
    return {
      ...preset,
      botSlug: previewSlug,
      botId: preview?.botId || verifiedSegment?.botId || preset.botId,
      articleId: preview?.articleId || verifiedSegment?.articleId || preset.articleId,
      visualUrl,
      previewStatus: verifiedSegment ? 'done' : preview?.status || preset.previewStatus,
      previewAccepted: Boolean(verifiedSegment || (preview ? preview.accepted : preset.previewAccepted)),
      previewSource: verifiedSegment ? 'dreamyporn-workshop-web' : preview?.source || preset.previewSource,
      previewLabel: verifiedSegment ? 'Verified result' : preview ? previewLabelFor(preview) : preset.previewLabel,
    };
  });
}

function isTransientStudioStatus(status?: string): boolean {
  return Boolean(status && TRANSIENT_STUDIO_STATUSES.has(status));
}

const QUEUE_STATUS_OPTIONS: Array<StudioStatus | 'all'> = [
  'all',
  'queued',
  'running',
  'done',
  'timeout',
  'auth_missing',
  'error',
  'cancelled',
];

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

function createVerifiedWorkshopFallbackProject(): StudioProject {
  const checkedAt = nowIso();
  return {
    projectId: VERIFIED_WORKSHOP_PROJECT_ID,
    conversationId: 'conversation_verified_workshop',
    mode: 'player',
    messages: [
      {
        id: 'verified-workshop-user',
        role: 'user',
        content: 'Stage two completed Dreamy workshop bot results into a timeline.',
        createdAt: '2026-06-03T09:10:00Z',
        action: 'generate',
      },
      {
        id: 'verified-workshop-assistant',
        role: 'assistant',
        content: 'Two real Dreamy workshop outputs are staged. Add another segment or export the timeline.',
        createdAt: checkedAt,
        action: 'extend',
        segmentId: VERIFIED_WORKSHOP_SEGMENTS[1].id,
      },
    ],
    segments: VERIFIED_WORKSHOP_SEGMENTS.map((segment) => {
      const clone: StudioSegment = { ...segment };
      if (segment.evidence) clone.evidence = { ...segment.evidence };
      return clone;
    }),
    selectedSegmentId: VERIFIED_WORKSHOP_SEGMENTS[1].id,
    agentGraph: [
      { id: 'intent-router', label: 'Intent Router', status: 'done', detail: 'Verified workshop route' },
      { id: 'dreamy-bot-1', label: '3D Anime Porn', status: 'done', detail: 'Real media accepted' },
      { id: 'dreamy-bot-2', label: '3D Futa Porn', status: 'done', detail: 'Second segment accepted' },
      { id: 'timeline', label: 'Timeline', status: 'done', detail: 'Two clips ready for export' },
    ],
    jobs: [],
    timelineExports: [],
    updatedAt: checkedAt,
  };
}

function downloadJsonText(jsonText: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadJsonPayload(payload: unknown, filename: string): void {
  downloadJsonText(JSON.stringify(payload, null, 2), filename);
}

function deliveryBundleFilename(bundle: StudioDeliveryBundle): string {
  return `myshell-studio-delivery-${bundle.projectId}.json`;
}

function deliveryAuditFilename(audit: StudioDeliveryAudit): string {
  return `myshell-studio-audit-${audit.projectId || 'current'}.json`;
}

function isMissingStudioProjectError(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

function formatStudioActionNext(next?: StudioActionResolveResult['next']): string {
  if (!next) return '';
  const details = [
    next.label,
    next.message,
    next.uiUrl ? `Open Studio ${next.uiUrl}` : '',
    next.url ? `Open ${next.url}` : '',
    next.retryUrl ? `Retry ${next.retryUrl}` : '',
    next.cancelUrl ? `Cancel ${next.cancelUrl}` : '',
    next.env ? `Env ${next.env}` : '',
    next.command ? `Command ${next.command}` : '',
  ].filter(Boolean);
  return details.length ? ` ${details.join(' ')}` : '';
}

function statusTone(status?: string): string {
  if (status === 'done') return 'text-Cr-text-success-default-v2';
  if (status === 'error' || status === 'timeout' || status === 'auth_missing') return 'text-Cr-text-critical-default-v2';
  if (status === 'running' || status === 'queued') return 'text-dreamy-brand-hot-v2';
  return 'text-Cr-text-subtler-v2';
}

function statusPillTone(status?: string): 'default' | 'hot' | 'success' | 'danger' {
  if (status === 'done') return 'success';
  if (status === 'error' || status === 'timeout' || status === 'auth_missing') return 'danger';
  if (status === 'running' || status === 'queued') return 'hot';
  return 'default';
}

function healthPillTone(status?: string): 'default' | 'hot' | 'success' | 'danger' {
  if (status === 'ok' || status === 'ready' || status === 'client_delegated') return 'success';
  if (status === 'auth_missing' || status === 'unavailable' || status === 'degraded' || status === 'needs_configuration') return 'hot';
  if (status === 'error' || status === 'blocked') return 'danger';
  return 'default';
}

function liveGenerationLabel(status?: string): string {
  if (!status) return 'Checking generation';
  if (status === 'ok' || status === 'ready' || status === 'client_delegated') return 'Generation ready';
  if (status === 'auth_missing' || status === 'needs_configuration') return 'Login needed';
  if (status === 'unavailable') return 'Generation offline';
  if (status === 'degraded') return 'Generation limited';
  if (status === 'error' || status === 'blocked') return 'Generation issue';
  return 'Generation active';
}

function handoffPillTone(status?: string): 'default' | 'hot' | 'success' | 'danger' {
  if (status === 'ready') return 'success';
  if (status === 'needs_attention' || status === 'blocked') return 'danger';
  if (status === 'in_progress') return 'hot';
  return 'default';
}

function handoffItemPriority(item: { kind?: string; status?: string; reason?: string; action?: string }): number {
  if (item.kind === 'dispatch_target') return 0;
  if (item.status === 'error' || item.reason === 'error' || item.action === 'inspect-gap') return 1;
  if (item.status === 'blocked' || item.reason === 'auth_missing') return 2;
  return 3;
}

function actionLabel(action: StudioAction): string {
  return {
    generate: 'Generate',
    extend: 'Extend',
    restyle: 'Restyle',
    'retry-agent': 'Try agent',
  }[action];
}

function defaultAgentIdForPage(page?: StudioPageAdapter | null): string {
  if (page?.executor === 'navigation') return 'miniapp-page-navigator';
  if (page?.id === 'myshell-art') return 'myshell-art-cdp-executor';
  return DEFAULT_STUDIO_AGENT_ID;
}

function resolveStudioDisplayAssetUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/gallery/video')) return exampleMultiple;
  if (url.startsWith('/gallery/style')) return exampleSmall;
  if (url.startsWith('/gallery/')) return exampleGood;
  if (url.startsWith('/assets/') || url.startsWith('/src/')) return url;
  return resolveStudioAssetUrl(url);
}

function getSegmentMedia(segment?: StudioSegment | null): string {
  if (!segment) return '';
  return resolveStudioDisplayAssetUrl(segment.type === 'video' ? segment.posterUrl || segment.url : segment.url || segment.posterUrl);
}

const FAILED_DISPLAY_SEGMENT_STATUSES = new Set(['error', 'auth_missing', 'timeout', 'cancelled']);

function isFailedDisplaySegment(segment?: StudioSegment | null): boolean {
  return Boolean(segment?.status && FAILED_DISPLAY_SEGMENT_STATUSES.has(segment.status));
}

function getTimelineDisplaySegments(segments: StudioSegment[] = []): StudioSegment[] {
  return segments.filter((segment) => !isFailedDisplaySegment(segment));
}

function fallbackVisualForDreamyBot(botSlug?: string, botName?: string): string {
  const value = `${botSlug || ''} ${botName || ''}`.toLowerCase();
  return value.includes('futa') ? presetCharacterGif : presetCinematicGif;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const CANVAS_BOARDS: Array<{ id: CanvasBoardId; label: string }> = [
  { id: 'story', label: 'Story' },
  { id: 'media', label: 'Media' },
  { id: 'timeline', label: 'Timeline' },
];

const AI_CANVAS_NODE_LIBRARY: Array<{
  kind: CanvasNodeKind;
  title: string;
  subtitle: string;
  width: number;
  height: number;
  action?: StudioAction;
  botSlug?: string;
  sourceType?: CanvasSourceType;
}> = [
  {
    kind: 'source-text',
    title: 'Source Text',
    subtitle: 'Prompt, character notes, or shot brief',
    width: 248,
    height: 118,
    sourceType: 'text',
  },
  {
    kind: 'source-image',
    title: 'Source Image',
    subtitle: 'Reference image dropped into the canvas',
    width: 258,
    height: 146,
    sourceType: 'image',
  },
  {
    kind: 'source-video',
    title: 'Source Video',
    subtitle: 'Reference clip or generated video source',
    width: 266,
    height: 150,
    sourceType: 'video',
  },
  {
    kind: 'source-audio',
    title: 'Source Audio',
    subtitle: 'Audio reference or voice material',
    width: 244,
    height: 116,
    sourceType: 'audio',
  },
  {
    kind: 'ai-image',
    title: 'AI Image',
    subtitle: 'Generate a source frame from prompt or references',
    width: 258,
    height: 132,
    action: 'generate',
    botSlug: DEFAULT_DREAMY_SLUG,
  },
  {
    kind: 'ai-video',
    title: 'AI Video',
    subtitle: 'Animate selected sources into a short clip',
    width: 266,
    height: 136,
    action: 'extend',
    botSlug: DREAMY_VIDEO_SLUG,
  },
  {
    kind: 'ai-text',
    title: 'AI Text',
    subtitle: 'Rewrite prompt, extract beats, or summarize nodes',
    width: 248,
    height: 120,
    action: 'generate',
  },
  {
    kind: 'annotation',
    title: 'Annotation',
    subtitle: 'Planning note pinned on the canvas',
    width: 220,
    height: 104,
  },
];

const CANVAS_COMMAND_PRESETS = [
  { label: '/image', value: '/image Generate a polished source frame from the selected references.' },
  { label: '/video', value: '/video Animate the selected source into a five second Dreamy segment.' },
  { label: '/extend', value: '/extend Continue the previous timeline segment with matching motion and style.' },
  { label: '/style', value: '/style Restyle the selected node while preserving the subject and composition.' },
];

function getCanvasNodeLibraryItem(kind: CanvasNodeKind) {
  return AI_CANVAS_NODE_LIBRARY.find((item) => item.kind === kind);
}

function getCanvasDefaultBoard(kind: CanvasNodeKind): CanvasBoardId {
  if (kind === 'segment' || kind === 'output' || kind === 'ai-video' || kind === 'source-video') return 'timeline';
  if (kind.startsWith('source-') || kind === 'ai-image' || kind === 'ai-audio') return 'media';
  return 'story';
}

function getCanvasNodeMediaMode(kind: CanvasNodeKind): CanvasSourceType | undefined {
  if (kind === 'source-image') return 'image';
  if (kind === 'source-video') return 'video';
  if (kind === 'source-audio') return 'audio';
  if (kind === 'source-text') return 'text';
  return undefined;
}

function getCanvasNodeIcon(kind: CanvasNodeKind) {
  return {
    prompt: Sparkles,
    agent: Bot,
    segment: Film,
    output: Layers3,
    'source-text': PanelRightOpen,
    'source-image': ImagePlus,
    'source-video': Film,
    'source-audio': Play,
    'ai-text': Sparkles,
    'ai-image': ImagePlus,
    'ai-video': Clapperboard,
    'ai-audio': Play,
    annotation: SlidersHorizontal,
  }[kind];
}

function normalizeCanvasNodeKind(value: unknown): CanvasNodeKind {
  const raw = String(value || '').toLowerCase();
  const knownKinds: CanvasNodeKind[] = [
    'prompt',
    'agent',
    'segment',
    'output',
    'source-text',
    'source-image',
    'source-video',
    'source-audio',
    'ai-text',
    'ai-image',
    'ai-video',
    'ai-audio',
    'annotation',
  ];
  if (knownKinds.includes(raw as CanvasNodeKind)) return raw as CanvasNodeKind;
  if (raw.includes('audio')) return raw.includes('source') ? 'source-audio' : 'ai-audio';
  if (raw.includes('video') || raw.includes('clip')) return raw.includes('source') || raw.includes('media') ? 'source-video' : 'ai-video';
  if (raw.includes('image') || raw.includes('photo') || raw.includes('picture')) return raw.includes('source') ? 'source-image' : 'ai-image';
  if (raw.includes('note') || raw.includes('comment')) return 'annotation';
  if (raw.includes('text') || raw.includes('prompt')) return raw.includes('source') ? 'source-text' : 'ai-text';
  return 'agent';
}

function buildCanvasGraph(
  project: StudioProject | null,
  positionOverrides: Record<string, { x: number; y: number }>,
): { nodes: CanvasNode[]; connections: CanvasConnection[] } {
  const graph = project?.agentGraph?.length ? project.agentGraph : EMPTY_GRAPH;
  const segments = getTimelineDisplaySegments(project?.segments || []);
  const nodes: CanvasNode[] = [];
  const connections: CanvasConnection[] = [];

  const addNode = (node: CanvasNode) => {
    const override = positionOverrides[node.id];
    nodes.push(override ? { ...node, ...override } : node);
  };

  addNode({
    id: 'prompt-root',
    kind: 'prompt',
    title: '01 Prompt',
    subtitle: project?.messages?.[project.messages.length - 1]?.content || 'Describe a scene, page, or agent run',
    x: 470,
    y: 52,
    width: 260,
    height: 118,
    status: project ? 'ready' : 'idle',
    prompt: project?.messages?.[project.messages.length - 1]?.content,
    boardId: 'story',
  });

  graph.forEach((agent, index) => {
    const id = `agent-${agent.id}`;
    const branchPositions = [
      { x: 418, y: 218, width: 300, height: 124 },
      { x: 280, y: 408, width: 244, height: 128 },
      { x: 760, y: 408, width: 244, height: 128 },
      { x: 520, y: 594, width: 260, height: 112 },
    ];
    const fallbackPosition = {
      x: 300 + (index % 3) * 260,
      y: 406 + Math.floor(index / 3) * 150,
      width: 244,
      height: 118,
    };
    const position = branchPositions[index] || fallbackPosition;
    addNode({
      id,
      kind: 'agent',
      title: `${String(index + 2).padStart(2, '0')} ${agent.label}`,
      subtitle: agent.detail || 'Agent step',
      x: position.x,
      y: position.y,
      width: position.width,
      height: position.height,
      status: agent.status,
      agentId: agent.id,
      boardId: index > 1 ? 'timeline' : 'story',
    });

    connections.push({
      id: index === 0 ? 'prompt-to-agent-0' : `agent-${graph[index - 1].id}-to-${agent.id}`,
      from: index === 0 ? 'prompt-root' : index < 3 ? `agent-${graph[0].id}` : `agent-${graph[index - 1].id}`,
      to: id,
      label: index === 0 ? 'route' : index === 1 ? 'primary' : index === 2 ? 'fallback' : 'next',
    });
  });

  segments.forEach((segment, index) => {
    const id = `segment-${segment.id}`;
    const segmentX = 220 + (index % 3) * 300;
    const segmentY = 594 + Math.floor(index / 3) * 160;
    addNode({
      id,
      kind: 'segment',
      title: `Segment ${String(index + 1).padStart(2, '0')} (${segment.type})`,
      subtitle: segment.prompt,
      x: segmentX,
      y: segmentY,
      width: 246,
      height: 142,
      status: segment.status,
      action: segment.action,
      prompt: segment.prompt,
      segmentId: segment.id,
      botSlug: segment.botSlug,
      botName: segment.botName,
      mediaUrl: getSegmentMedia(segment),
      sourceType: segment.type,
      boardId: 'timeline',
    });

    const parent = segment.parentSegmentId ? `segment-${segment.parentSegmentId}` : null;
    connections.push({
      id: parent ? `${parent}-to-${id}` : `agent-to-${id}`,
      from: parent || (graph.length > 1 ? `agent-${graph[1].id}` : graph.length ? `agent-${graph[0].id}` : 'prompt-root'),
      to: id,
      label: segment.action,
    });
  });

  addNode({
    id: 'timeline-output',
    kind: 'output',
    title: '05 Output Timeline',
    subtitle: segments.length ? `${segments.length} staged assets / ${segments.length * 5}s preview` : 'Waiting for generated assets',
    x: 430,
    y: 782,
    width: 360,
    height: 112,
    status: segments.length ? 'ready' : 'idle',
    boardId: 'timeline',
  });

  if (segments.length) {
    segments.forEach((segment, index) => {
      connections.push({
        id: `segment-${segment.id}-to-output`,
        from: `segment-${segment.id}`,
        to: 'timeline-output',
        label: index === segments.length - 1 ? 'current' : undefined,
      });
    });
  } else if (graph.length) {
    connections.push({
      id: 'agent-to-output-empty',
      from: `agent-${graph[graph.length - 1].id}`,
      to: 'timeline-output',
      label: 'stage',
    });
  }

  return { nodes, connections };
}

function createLocalProject(
  mode: StudioMode,
  message: string,
  action: StudioAction,
  parent?: StudioSegment,
  existing?: StudioProject | null,
): StudioProject {
  const projectId = existing?.projectId || makeId('local_project');
  const conversationId = existing?.conversationId || makeId('conversation');
  const segment: StudioSegment = {
    id: makeId('segment'),
    type: action === 'extend' ? 'video' : 'image',
    url: '',
    posterUrl: LOCAL_POSTERS[Math.floor(Math.random() * LOCAL_POSTERS.length)],
    prompt: message,
    botSlug: action === 'extend' ? DREAMY_VIDEO_SLUG : DEFAULT_DREAMY_SLUG,
    botName: action === 'extend' ? '3D Futa Porn' : '3D Anime Porn',
    action,
    parentSegmentId: parent?.id,
    status: 'draft',
    evidence: {
      status: 'draft',
      source: 'local-fallback',
      accepted: false,
      message: 'Local draft only; not accepted as delivery evidence.',
      checkedAt: nowIso(),
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const fallbackAgentGraph: StudioAgentNode[] = [
    { id: 'intent-router', label: 'Intent Router', status: 'done', detail: 'Local route fallback' },
    { id: 'asset-planner', label: 'Asset Planner', status: parent ? 'done' : 'queued', detail: parent?.botName || 'Prompt only' },
    { id: 'dreamy-executor', label: 'Dreamy Executor', status: 'queued', detail: 'Waiting for Studio backend' },
    { id: 'timeline', label: 'Timeline', status: 'queued', detail: 'Draft segment added' },
  ];
  const agentGraph: StudioAgentNode[] = existing?.agentGraph?.length ? existing.agentGraph : fallbackAgentGraph;
  return {
    ...(existing || {}),
    projectId,
    conversationId,
    mode,
    messages: existing?.messages || [],
    segments: [...(existing?.segments || []), segment],
    selectedSegmentId: segment.id,
    agentGraph,
    jobs: existing?.jobs || [],
    updatedAt: nowIso(),
  };
}

function mergeStudioProjectState(current: StudioProject | null, incoming: StudioProject): StudioProject {
  if (!current || current.projectId !== incoming.projectId) return incoming;
  const incomingSegments = new Map(incoming.segments.map((segment) => [segment.id, segment]));
  const incomingJobs = new Map((incoming.jobs || []).map((job) => [job.jobId, job]));
  const incomingExports = new Map((incoming.timelineExports || []).map((item) => [item.exportId, item]));
  return {
    ...current,
    ...incoming,
    messages: incoming.messages?.length ? incoming.messages : current.messages,
    segments: [
      ...current.segments.map((segment) => incomingSegments.get(segment.id) || segment),
      ...incoming.segments.filter((segment) => !current.segments.some((currentSegment) => currentSegment.id === segment.id)),
    ],
    jobs: [
      ...(current.jobs || []).map((job) => incomingJobs.get(job.jobId) || job),
      ...(incoming.jobs || []).filter((job) => !(current.jobs || []).some((currentJob) => currentJob.jobId === job.jobId)),
    ],
    timelineExports: [
      ...(incoming.timelineExports || []),
      ...((current.timelineExports || []).filter((item) => !incomingExports.has(item.exportId))),
    ],
    selectedSegmentId: incoming.selectedSegmentId || current.selectedSegmentId,
    updatedAt: incoming.updatedAt || current.updatedAt,
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
    <span className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md-v2 border px-2 text-[11px] font-semibold ${toneClass}`}>
      {children}
    </span>
  );
}

function getStudioWorkspaceFromSearch(search: string): StudioWorkspace {
  try {
    const params = new URLSearchParams(search);
    const value = params.get('workspace') || params.get('view');
    return value === 'canvaspro' ? 'canvaspro' : 'orchestrator';
  } catch {
    return 'orchestrator';
  }
}

function StudioWorkspaceSwitch({
  workspace,
  onChange,
}: {
  workspace: StudioWorkspace;
  onChange: (workspace: StudioWorkspace) => void;
}) {
  const items: Array<{ id: StudioWorkspace; label: string; Icon: typeof Sparkles }> = [
    { id: 'orchestrator', label: 'Command', Icon: Sparkles },
    { id: 'canvaspro', label: 'CanvasPro', Icon: Layers3 },
  ];

  return (
    <div
      data-testid="studio-workspace-switch"
      className="grid h-9 w-[210px] shrink-0 grid-cols-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 p-1"
    >
      {items.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          data-testid={id === 'canvaspro' ? 'canvaspro-workspace-switch' : 'orchestrator-workspace-switch'}
          aria-label={`Switch Studio workspace to ${label}`}
          aria-pressed={workspace === id}
          onClick={() => onChange(id)}
          className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md-v2 px-2 text-xs font-semibold transition-colors ${
            workspace === id
              ? 'bg-Cr-beta-white-12-v2 text-Cr-text-default-v2 shadow-sm'
              : 'text-Cr-text-subtler-v2 active:text-Cr-text-default-v2'
          }`}
        >
          <Icon size={13} className="shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}

function ModeSwitch({
  mode,
  onChange,
  labelScope = 'Switch studio mode to',
}: {
  mode: StudioMode;
  onChange: (mode: StudioMode) => void;
  labelScope?: string;
}) {
  return (
    <div className="grid h-9 w-[132px] shrink-0 grid-cols-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 p-1">
      {(['player', 'canvas'] as StudioMode[]).map((item) => {
        const label = item === 'player' ? 'Player' : 'Canvas';
        return (
          <button
            key={item}
            type="button"
            aria-label={`${labelScope} ${label}`}
            aria-pressed={mode === item}
            onClick={() => onChange(item)}
            className={`rounded-md-v2 px-2 text-xs font-semibold transition-colors ${
              mode === item
                ? 'bg-Cr-beta-white-12-v2 text-Cr-text-default-v2 shadow-sm'
                : 'text-Cr-text-subtler-v2 active:text-Cr-text-default-v2'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function StudioHealthStrip({ health }: { health: StudioHealth | null }) {
  const components = [
    ['backend', 'Backend'],
    ['storage', 'Storage'],
    ['chromeCdp', 'CDP'],
    ['myshellCookies', 'Cookies'],
    ['cookieInjection', 'Injection'],
    ['dreamyApiAuth', 'Dreamy'],
    ['credentialSetup', 'Secrets'],
    ['liveGeneration', 'Live'],
  ] as const;

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3 py-2 [-webkit-overflow-scrolling:touch]">
      <Pill tone={healthPillTone(health?.status)}>{health ? `Health ${health.status}` : 'Health checking'}</Pill>
      {components.map(([id, label]) => {
        const component = health?.components?.[id];
        const status = component?.status || 'unknown';
        const detail = component?.message || component?.path || component?.url || component?.mode || '';
        const tone = healthPillTone(status);
        return (
          <span
            key={id}
            title={detail}
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                tone === 'success'
                  ? 'bg-Cr-text-success-default-v2'
                  : tone === 'danger'
                    ? 'bg-Cr-text-critical-default-v2'
                    : tone === 'hot'
                      ? 'bg-dreamy-brand-hot-v2'
                      : 'bg-Cr-text-subtlest-v2'
              }`}
            />
            {label} {status}
          </span>
        );
      })}
    </div>
  );
}

function StudioReadinessStrip({ readiness }: { readiness: StudioReadiness | null }) {
  const gates = readiness?.gates || [];
  const summary = readiness?.summary;

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3 py-2 [-webkit-overflow-scrolling:touch]">
      <Pill tone={healthPillTone(readiness?.status)}>
        {readiness ? `Delivery ${readiness.status}` : 'Delivery checking'}
      </Pill>
      {summary && <Pill>{`${summary.ready}/${summary.total} ready`}</Pill>}
      {gates.map((gate) => {
        const tone = healthPillTone(gate.status);
        const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;
        return (
          <span
            key={gate.id}
            title={gate.message || gate.id}
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
          >
            <Icon
              size={12}
              className={
                tone === 'success'
                  ? 'text-Cr-text-success-default-v2'
                  : tone === 'danger'
                    ? 'text-Cr-text-critical-default-v2'
                    : 'text-dreamy-brand-hot-v2'
              }
            />
            <span className="max-w-[120px] truncate">{gate.label}</span>
            <span className="text-Cr-text-subtlest-v2">{gate.status}</span>
          </span>
        );
      })}
    </div>
  );
}

function artifactHref(artifact: StudioHandoffArtifact): string {
  if (artifact.uiUrl) {
    if (/^https?:\/\//i.test(artifact.uiUrl)) return artifact.uiUrl;
    return artifact.uiUrl.startsWith('/') ? artifact.uiUrl : `/${artifact.uiUrl}`;
  }
  return getStudioRootEndpoint(artifact.url || artifact.endpoint);
}

function actionUiHref(action: StudioHandoffAction): string {
  const appHref = action.uiUrl || action.next?.uiUrl || '';
  if (appHref) {
    if (/^https?:\/\//i.test(appHref)) return appHref;
    return appHref.startsWith('/') ? appHref : `/${appHref}`;
  }
  const apiHref = action.url || action.next?.url || action.retryUrl || action.next?.retryUrl || action.cancelUrl || action.next?.cancelUrl || '';
  if (!apiHref) return '';
  if (/^https?:\/\//i.test(apiHref)) return apiHref;
  return getStudioRootEndpoint(apiHref);
}

function absoluteAppHref(href: string): string {
  if (!href || /^https?:\/\//i.test(href) || typeof window === 'undefined') return href;
  return new URL(href, window.location.origin).toString();
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text || typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }

  if (copied) return true;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function readDispatchSessionRestoreParams(): { sessionId?: string; targetId?: string } {
  if (typeof window === 'undefined') return {};
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      sessionId: params.get('dispatch_session_id') || params.get('session_id') || undefined,
      targetId: params.get('target_id') || params.get('dispatch_target_id') || undefined,
    };
  } catch {
    return {};
  }
}

function isDispatchTargetRunResult(
  result: StudioActionResolveResult['result'],
): result is StudioDispatchSessionTargetRunResult {
  return Boolean(result && typeof result === 'object' && 'session' in result && 'target' in result);
}

function isDispatchSessionRetryResult(
  result: StudioActionResolveResult['result'],
): result is StudioDispatchSessionRetryResult {
  return Boolean(result && typeof result === 'object' && 'session' in result && !('target' in result));
}

function StudioArtifactLinks({
  artifacts,
  limit = 4,
}: {
  artifacts?: StudioHandoffArtifact[];
  limit?: number;
}) {
  const visibleArtifacts = (artifacts || []).filter((artifact) => artifact.url || artifact.endpoint).slice(0, limit);
  if (!visibleArtifacts.length) return null;

  return (
    <>
      {visibleArtifacts.map((artifact) => (
        <a
          key={`${artifact.id}:${artifact.url || artifact.endpoint}`}
          data-testid="studio-artifact-link"
          href={artifactHref(artifact)}
          target="_blank"
          rel="noreferrer"
          title={artifact.uiUrl || artifact.url || artifact.endpoint}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2 hover:bg-Cr-beta-white-8-v2"
        >
          <ExternalLink size={12} className="text-Cr-text-subtlest-v2" />
          <span className="max-w-[130px] truncate">{artifact.label || artifact.id}</span>
        </a>
      ))}
      {(artifacts || []).length > visibleArtifacts.length && <Pill>{`+${(artifacts || []).length - visibleArtifacts.length} artifacts`}</Pill>}
    </>
  );
}

function StudioDeliveryCommandCenter({
  audit,
  coverage,
  snapshot,
  bundle,
  matrix,
  plan,
  session,
  overview,
  refreshingAudit,
  verifyingCoverage,
  planningDispatch,
  sessionRunning,
  bundling,
  onRefreshAudit,
  onVerifyCoverage,
  onPlanRemaining,
  onStartQueue,
  onBundle,
}: {
  audit: StudioDeliveryAudit | null;
  coverage: StudioCoverageReport | null;
  snapshot: StudioHandoffSnapshot | null;
  bundle: StudioDeliveryBundle | null;
  matrix: StudioDispatchMatrix | null;
  plan: StudioDispatchBatchPlan | null;
  session: StudioDispatchSession | null;
  overview: StudioOverview | null;
  refreshingAudit: boolean;
  verifyingCoverage: boolean;
  planningDispatch: boolean;
  sessionRunning: boolean;
  bundling: boolean;
  onRefreshAudit: () => void;
  onVerifyCoverage: () => void;
  onPlanRemaining: () => void;
  onStartQueue: () => void;
  onBundle: () => void;
}) {
  const coverageSummary = coverage?.summary;
  const matrixSummary = matrix?.summary;
  const snapshotSummary = snapshot?.summary;
  const sessionSummary = session?.summary;
  const totalPages =
    coverageSummary?.total ||
    matrixSummary?.total ||
    snapshotSummary?.pages ||
    audit?.summary?.pages ||
    overview?.totals?.pages ||
    0;
  const coveredPages = coverageSummary?.covered || snapshotSummary?.covered || 0;
  const readyTargets = matrixSummary?.ready || audit?.summary?.readyTargets || 0;
  const pendingTargets = sessionSummary?.pending ?? plan?.summary?.planned ?? 0;
  const visitedTargets = sessionSummary?.visited || bundle?.summary?.visitedTargets || 0;
  const actionCount = audit?.summary?.actions ?? snapshotSummary?.unresolvedActions ?? bundle?.summary?.actions ?? 0;
  const issueCount =
    (coverageSummary?.blocked || 0) +
    (coverageSummary?.issues || 0) +
    (overview?.totals?.issues || 0) +
    (bundle?.summary?.errorTargets || 0);
  const coveragePercent = totalPages ? Math.round((coveredPages / totalPages) * 100) : 0;
  const readyPercent = totalPages ? Math.round((readyTargets / totalPages) * 100) : 0;
  const canVerify = Boolean(coverageSummary?.readyUnverified);
  const canStartQueue = Boolean(plan && !sessionRunning);

  return (
    <section
      data-testid="delivery-command-center"
      className="grid gap-3 border-b border-Cr-border-default-v2 bg-[#0d1018] p-3"
      aria-label="Delivery Command Center"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-Cr-text-default-v2">
            <SlidersHorizontal size={15} className="text-dreamy-brand-hot-v2" />
            Delivery Command Center
          </div>
          <div className="text-[11px] text-Cr-text-subtler-v2">
            {`${totalPages || 0} pages / ${readyTargets} ready / ${actionCount} actions`}
          </div>
        </div>
        <div className="flex max-w-full gap-2 overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <button
            type="button"
            disabled={refreshingAudit}
            onClick={onRefreshAudit}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md-v2 border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:opacity-50"
          >
            <RefreshCcw size={12} className={refreshingAudit ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            disabled={!canVerify || verifyingCoverage}
            onClick={onVerifyCoverage}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md-v2 border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:opacity-50"
          >
            <CheckCircle2 size={12} className={verifyingCoverage ? 'animate-pulse' : ''} />
            Verify Ready
          </button>
          <button
            type="button"
            disabled={planningDispatch}
            onClick={onPlanRemaining}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md-v2 border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:opacity-50"
          >
            <GitBranch size={12} className={planningDispatch ? 'animate-pulse' : ''} />
            Plan Remaining
          </button>
          <button
            type="button"
            disabled={!canStartQueue}
            onClick={onStartQueue}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md-v2 border border-dreamy-brand-hot-v2/50 bg-dreamy-brand-hot-v2/15 px-2.5 text-[11px] font-semibold text-dreamy-brand-hot-v2 disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-Cr-text-subtlest-v2"
          >
            <Play size={12} />
            Start Queue
          </button>
          <button
            type="button"
            disabled={bundling}
            onClick={onBundle}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md-v2 border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:opacity-50"
          >
            <Download size={12} className={bundling ? 'animate-pulse' : ''} />
            Bundle
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="grid gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase text-Cr-text-subtlest-v2">Delivery</span>
            <Pill tone={handoffPillTone(snapshot?.status || audit?.status)}>{snapshot?.status || audit?.status || 'checking'}</Pill>
          </div>
          <div className="text-2xl font-semibold text-Cr-text-default-v2">{coveragePercent}%</div>
          <div className="text-[11px] text-Cr-text-subtler-v2">{`${coveredPages}/${totalPages || 0} pages covered`}</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-Cr-text-success-default-v2" style={{ width: `${Math.min(100, coveragePercent)}%` }} />
          </div>
        </div>

        <div className="grid gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase text-Cr-text-subtlest-v2">Dispatch Matrix</span>
            <Pill tone={readyTargets === totalPages && totalPages ? 'success' : 'hot'}>{`${readyTargets}/${totalPages || 0}`}</Pill>
          </div>
          <div className="text-2xl font-semibold text-Cr-text-default-v2">{readyPercent}%</div>
          <div className="text-[11px] text-Cr-text-subtler-v2">{`${matrixSummary?.navigation || 0} nav / ${matrixSummary?.client || 0} client / ${matrixSummary?.server || 0} server`}</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-dreamy-brand-hot-v2" style={{ width: `${Math.min(100, readyPercent)}%` }} />
          </div>
        </div>

        <div className="grid gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase text-Cr-text-subtlest-v2">Queue</span>
            <Pill tone={session?.status === 'active' ? 'success' : plan ? 'hot' : 'default'}>{session?.status || plan?.status || 'idle'}</Pill>
          </div>
          <div className="text-2xl font-semibold text-Cr-text-default-v2">{pendingTargets}</div>
          <div className="text-[11px] text-Cr-text-subtler-v2">{`${visitedTargets} visited / ${sessionSummary?.completed || bundle?.summary?.completedTargets || 0} done`}</div>
          <div className="flex gap-1">
            <Pill tone={sessionSummary?.targetErrors || bundle?.summary?.errorTargets ? 'danger' : 'default'}>
              {`${sessionSummary?.targetErrors || bundle?.summary?.errorTargets || 0} errors`}
            </Pill>
            <Pill tone={sessionSummary?.targetSkipped || bundle?.summary?.skippedTargets ? 'hot' : 'default'}>
              {`${sessionSummary?.targetSkipped || bundle?.summary?.skippedTargets || 0} skipped`}
            </Pill>
          </div>
        </div>

        <div className="grid gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase text-Cr-text-subtlest-v2">Operator Actions</span>
            <Pill tone={issueCount ? 'danger' : actionCount ? 'hot' : 'success'}>{issueCount ? `${issueCount} issues` : `${actionCount} actions`}</Pill>
          </div>
          <div className="text-2xl font-semibold text-Cr-text-default-v2">{actionCount}</div>
          <div className="text-[11px] text-Cr-text-subtler-v2">{`${audit?.summary?.artifacts || snapshot?.artifacts.length || bundle?.summary?.artifacts || 0} artifacts ready`}</div>
          <div className="flex gap-1">
            <Pill tone={snapshot?.readyForDelivery ? 'success' : 'default'}>{snapshot?.readyForDelivery ? 'deliverable' : 'review'}</Pill>
            <Pill tone={bundle?.readyForDelivery ? 'success' : 'default'}>{bundle ? `bundle ${bundle.status}` : 'bundle pending'}</Pill>
          </div>
        </div>
      </div>
    </section>
  );
}

function StudioDeliveryAuditStrip({
  audit,
  refreshing,
  resolvingActionId,
  resolvingBatch,
  onRefresh,
  onDownload,
  onResolveAction,
  onResolveSafeActions,
}: {
  audit: StudioDeliveryAudit | null;
  refreshing: boolean;
  resolvingActionId: string | null;
  resolvingBatch: boolean;
  onRefresh: () => void;
  onDownload: () => void;
  onResolveAction: (action: StudioHandoffAction) => void;
  onResolveSafeActions: () => void;
}) {
  const summary = audit?.summary;
  const gaps = (audit?.requirements || []).filter((item) => item.status !== 'ready');
  const actions = audit?.actions || [];
  const visibleActions = [...actions].sort((first, second) => handoffItemPriority(first) - handoffItemPriority(second)).slice(0, 3);
  const safeActionCount = actions.filter(
    (action) => action.action === 'verify-ready' || action.action === 'run-target' || action.action === 'retry-queue',
  ).length;

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3 py-2 [-webkit-overflow-scrolling:touch]">
      <Pill tone={healthPillTone(audit?.status)}>
        {audit ? `Audit ${audit.status}` : 'Audit checking'}
      </Pill>
      <button
        type="button"
        disabled={refreshing}
        onClick={onRefresh}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <RefreshCcw size={12} className={refreshing ? 'animate-spin' : ''} />
        Refresh Audit
      </button>
      <button
        type="button"
        disabled={!audit}
        onClick={onDownload}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <Download size={12} />
        Audit JSON
      </button>
      <button
        type="button"
        disabled={!safeActionCount || resolvingBatch || Boolean(resolvingActionId)}
        onClick={onResolveSafeActions}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        {resolvingBatch ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        Resolve Safe
      </button>
      {summary && (
        <>
          <Pill tone={summary.missingCorePages || summary.missingCoreAgents ? 'danger' : 'success'}>{`${summary.pages} pages`}</Pill>
          <Pill tone={summary.missingCoreAgents ? 'danger' : 'success'}>{`${summary.agents} agents`}</Pill>
          <Pill tone={summary.readyTargets === summary.pages ? 'success' : 'hot'}>{`${summary.readyTargets}/${summary.pages} ready`}</Pill>
          <Pill tone={summary.missingParams ? 'hot' : 'default'}>{`${summary.missingParams} missing params`}</Pill>
          <Pill tone={summary.actions ? 'hot' : 'success'}>{`${summary.actions || 0} actions`}</Pill>
          <Pill>{`${summary.artifacts} artifacts`}</Pill>
          <StudioArtifactLinks artifacts={audit?.artifacts} limit={4} />
        </>
      )}
      {visibleActions.map((action) => {
        const resolving = resolvingActionId === action.id;
        const uiHref = actionUiHref(action);
        return (
          <span
            key={action.id}
            className="inline-flex h-6 shrink-0 items-center gap-1"
          >
            <button
              type="button"
              title={action.message || action.reason || action.action}
              disabled={Boolean(resolvingActionId) || resolvingBatch}
              onClick={() => onResolveAction(action)}
              className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2 disabled:opacity-60"
            >
              {resolving ? (
                <Loader2 size={12} className="animate-spin text-dreamy-brand-hot-v2" />
              ) : (
                <GitBranch size={12} className="text-dreamy-brand-hot-v2" />
              )}
              <span className="max-w-[130px] truncate">{action.targetName || action.targetId || action.kind}</span>
              <span className="text-Cr-text-subtlest-v2">{action.action}</span>
            </button>
            {uiHref && (
              <a
                data-testid="studio-action-ui-link"
                href={uiHref}
                target="_blank"
                rel="noreferrer"
                title={uiHref}
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-1.5 text-[11px] font-semibold text-Cr-text-subtler-v2 hover:bg-Cr-beta-white-8-v2"
              >
                <ExternalLink size={12} className="text-Cr-text-subtlest-v2" />
                Open
              </a>
            )}
          </span>
        );
      })}
      {gaps.slice(0, 5).map((item) => {
        const tone = healthPillTone(item.status);
        const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;
        return (
          <span
            key={item.id}
            title={item.message || item.id}
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
          >
            <Icon
              size={12}
              className={
                tone === 'danger'
                  ? 'text-Cr-text-critical-default-v2'
                  : tone === 'success'
                    ? 'text-Cr-text-success-default-v2'
                    : 'text-dreamy-brand-hot-v2'
              }
            />
            <span className="max-w-[130px] truncate">{item.label}</span>
            <span className="text-Cr-text-subtlest-v2">{item.status}</span>
          </span>
        );
      })}
      {actions.length > 3 && <Pill tone="hot">{`+${actions.length - 3} actions`}</Pill>}
    </div>
  );
}

function StudioDeliveryReportStrip({
  projectId,
  report,
}: {
  projectId?: string;
  report: StudioProjectDeliveryReport | null;
}) {
  if (!projectId) return null;
  const summary = report?.summary;
  const actions = report?.unresolvedActions || [];

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3 py-2 [-webkit-overflow-scrolling:touch]">
      <Pill tone={handoffPillTone(report?.handoffStatus)}>
        {report ? `Project ${report.handoffStatus}` : 'Project checking'}
      </Pill>
      {summary && (
        <>
          <Pill tone={summary.acceptedEvidence ? 'success' : 'default'}>{`${summary.acceptedEvidence} accepted`}</Pill>
          <Pill tone={summary.pendingEvidence ? 'hot' : 'default'}>{`${summary.pendingEvidence} pending`}</Pill>
          <Pill tone={summary.issueCount ? 'danger' : 'default'}>{`${summary.issueCount} issues`}</Pill>
        </>
      )}
      {actions.slice(0, 4).map((action) => (
        <span
          key={`${action.segmentId || action.jobId || action.action}_${action.action}`}
          title={action.message || action.action}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
        >
          <AlertTriangle size={12} className="text-dreamy-brand-hot-v2" />
          <span className="max-w-[130px] truncate">{action.action}</span>
          <span className="text-Cr-text-subtlest-v2">{action.status}</span>
        </span>
      ))}
      {actions.length > 4 && <Pill tone="hot">{`+${actions.length - 4} actions`}</Pill>}
    </div>
  );
}

function StudioCoverageStrip({
  coverage,
  verifying,
  onVerify,
}: {
  coverage: StudioCoverageReport | null;
  verifying: boolean;
  onVerify: () => void;
}) {
  const summary = coverage?.summary;
  const gaps = (coverage?.pages || []).filter((page) => page.coverageStatus !== 'covered');
  const canVerify = Boolean(summary?.readyUnverified);

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3 py-2 [-webkit-overflow-scrolling:touch]">
      <Pill tone={coverage?.status === 'blocked' ? 'danger' : coverage?.status === 'ready' ? 'success' : 'hot'}>
        {coverage ? `Coverage ${coverage.status}` : 'Coverage checking'}
      </Pill>
      <button
        type="button"
        disabled={!canVerify || verifying}
        onClick={onVerify}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <RefreshCcw size={12} className={verifying ? 'animate-spin' : ''} />
        Verify Ready
      </button>
      {summary && (
        <>
          <Pill tone={summary.covered === summary.total ? 'success' : 'hot'}>{`${summary.covered}/${summary.total} covered`}</Pill>
          <Pill tone={summary.pending ? 'hot' : 'default'}>{`${summary.pending} pending`}</Pill>
          <Pill tone={summary.readyUnverified ? 'hot' : 'default'}>{`${summary.readyUnverified} unverified`}</Pill>
          <Pill tone={summary.blocked ? 'danger' : 'default'}>{`${summary.blocked} blocked`}</Pill>
        </>
      )}
      {gaps.slice(0, 6).map((page) => (
        <span
          key={page.pageId}
          title={page.dispatchMessage || page.latestEvidence?.message || page.coverageStatus}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
        >
          <AlertTriangle
            size={12}
            className={page.coverageStatus === 'blocked' ? 'text-Cr-text-critical-default-v2' : 'text-dreamy-brand-hot-v2'}
          />
          <span className="max-w-[120px] truncate">{page.pageName}</span>
          <span className="text-Cr-text-subtlest-v2">{page.coverageStatus}</span>
        </span>
      ))}
      {gaps.length > 6 && <Pill tone="hot">{`+${gaps.length - 6} gaps`}</Pill>}
    </div>
  );
}

function StudioHandoffSnapshotStrip({
  snapshot,
  bundle,
  refreshing,
  bundling,
  onRefresh,
  onBundle,
}: {
  snapshot: StudioHandoffSnapshot | null;
  bundle: StudioDeliveryBundle | null;
  refreshing: boolean;
  bundling: boolean;
  onRefresh: () => void;
  onBundle: () => void;
}) {
  const summary = snapshot?.summary;
  const gaps = snapshot?.gaps || [];
  const actions = snapshot?.actions || [];
  const visibleGaps = [...gaps].sort((first, second) => handoffItemPriority(first) - handoffItemPriority(second)).slice(0, 4);
  const visibleActions = [...actions].sort((first, second) => handoffItemPriority(first) - handoffItemPriority(second)).slice(0, 4);

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3 py-2 [-webkit-overflow-scrolling:touch]">
      <Pill tone={handoffPillTone(snapshot?.status)}>
        {snapshot ? `Handoff ${snapshot.status}` : 'Handoff checking'}
      </Pill>
      <button
        type="button"
        disabled={refreshing}
        onClick={onRefresh}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <RefreshCcw size={12} className={refreshing ? 'animate-spin' : ''} />
        Refresh Handoff
      </button>
      <button
        type="button"
        disabled={bundling}
        onClick={onBundle}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <Download size={12} className={bundling ? 'animate-pulse' : ''} />
        Bundle
      </button>
      {summary && (
        <>
          <Pill tone={snapshot?.readyForDelivery ? 'success' : 'default'}>
            {snapshot?.readyForDelivery ? 'deliverable' : 'not deliverable'}
          </Pill>
          <Pill tone={summary.covered === summary.pages ? 'success' : 'hot'}>{`${summary.covered}/${summary.pages} pages`}</Pill>
          <Pill tone={summary.gaps ? 'danger' : 'default'}>{`${summary.gaps} gaps`}</Pill>
          <Pill tone={summary.unresolvedActions ? 'hot' : 'default'}>{`${summary.unresolvedActions} actions`}</Pill>
          <Pill tone={summary.deliveryAcceptedEvidence || summary.acceptedEvidence ? 'success' : 'default'}>
            {`${summary.deliveryAcceptedEvidence || summary.acceptedEvidence} evidence`}
          </Pill>
          <Pill>{`${summary.jobs} jobs`}</Pill>
          <Pill>{`${snapshot?.artifacts.length || 0} artifacts`}</Pill>
          <StudioArtifactLinks artifacts={bundle?.artifacts || snapshot?.artifacts} limit={4} />
        </>
      )}
      {bundle && (
        <>
          <Pill tone={bundle.summary.acceptedJobs ? 'success' : 'default'}>{`${bundle.summary.acceptedJobs} accepted jobs`}</Pill>
          <Pill tone={bundle.summary.remainingTargets ? 'hot' : 'success'}>{`${bundle.summary.remainingTargets || 0} remaining`}</Pill>
          <Pill tone={bundle.summary.errorTargets ? 'danger' : 'default'}>{`${bundle.summary.errorTargets || 0} errors`}</Pill>
          <Pill>{`${bundle.summary.artifacts} bundle artifacts`}</Pill>
        </>
      )}
      {visibleGaps.map((gap) => (
        <span
          key={gap.id}
          title={gap.message || gap.reason}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
        >
          <AlertTriangle size={12} className={gap.status === 'blocked' ? 'text-Cr-text-critical-default-v2' : 'text-dreamy-brand-hot-v2'} />
          <span className="max-w-[120px] truncate">{gap.pageName || gap.pageId || gap.id}</span>
          <span className="text-Cr-text-subtlest-v2">{gap.reason}</span>
        </span>
      ))}
      {visibleActions.map((action) => {
        const uiHref = actionUiHref(action);
        return (
          <span
            key={action.id}
            className="inline-flex h-6 shrink-0 items-center gap-1"
          >
            <span
              title={action.message || action.reason || action.action}
              className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
            >
              <GitBranch size={12} className="text-dreamy-brand-hot-v2" />
              <span className="max-w-[130px] truncate">{action.targetName || action.targetId || action.kind}</span>
              <span className="text-Cr-text-subtlest-v2">{action.action}</span>
            </span>
            {uiHref && (
              <a
                data-testid="studio-action-ui-link"
                href={uiHref}
                target="_blank"
                rel="noreferrer"
                title={uiHref}
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-1.5 text-[11px] font-semibold text-Cr-text-subtler-v2 hover:bg-Cr-beta-white-8-v2"
              >
                <ExternalLink size={12} className="text-Cr-text-subtlest-v2" />
                Open
              </a>
            )}
          </span>
        );
      })}
    </div>
  );
}

function StudioDispatchBatchStrip({
  plan,
  session,
  planning,
  sessionRunning,
  selectedPageCount,
  onPlan,
  onPlanRemaining,
  onPlanSelected,
  onStartSession,
  onStartSelectedSession,
  onCancelSession,
  onRetrySession,
  onOpenTarget,
  onCompleteTarget,
  onErrorTarget,
  onSkipTarget,
}: {
  plan: StudioDispatchBatchPlan | null;
  session: StudioDispatchSession | null;
  planning: boolean;
  sessionRunning: boolean;
  selectedPageCount: number;
  onPlan: () => void;
  onPlanRemaining: () => void;
  onPlanSelected: () => void;
  onStartSession: () => void;
  onStartSelectedSession: () => void;
  onCancelSession: () => void;
  onRetrySession: () => void;
  onOpenTarget: (target: StudioDispatchBatchTarget | StudioDispatchSessionTarget) => void;
  onCompleteTarget: (target: StudioDispatchSessionTarget) => void;
  onErrorTarget: (target: StudioDispatchSessionTarget) => void;
  onSkipTarget: (target: StudioDispatchSessionTarget) => void;
}) {
  const summary = plan?.summary;
  const sessionSummary = session?.summary;
  const focusedTarget =
    session?.focusedTarget ||
    (session?.focusedTargetId ? session.targets.find((target) => target.id === session.focusedTargetId) : null);
  const nextDispatchTarget =
    session?.targets.find((target) => (
      target.status === 'pending' &&
      ((target.executor === 'navigation' && target.navigationPath) || target.executor !== 'navigation')
    )) ||
    plan?.targets.find((target) => (target.executor === 'navigation' && target.navigationPath) || target.executor !== 'navigation');
  const visitedTarget = session?.targets.find((target) => target.status === 'visited');
  const skipped = plan?.skippedTargets || [];
  const visibleTargets = (session?.targets || plan?.targets || []).slice(0, 5);
  const focusedTargetVisible = focusedTarget && !visibleTargets.some((target) => target.id === focusedTarget.id);
  const hasSelectedPages = selectedPageCount > 0;
  const canCancelSession = Boolean(session && session.status !== 'cancelled' && session.status !== 'done');
  const canRetrySession = Boolean(
    session &&
    ((session.summary.targetCancelled || 0) > 0 || (session.summary.targetErrors || 0) > 0 || session.status === 'cancelled'),
  );

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3 py-2 [-webkit-overflow-scrolling:touch]">
      <Pill tone={plan?.readyForDispatch ? 'success' : plan ? 'danger' : 'default'}>
        {plan ? `Batch ${plan.status}` : 'Batch not planned'}
      </Pill>
      <Pill tone={session?.status === 'active' ? 'success' : session ? 'hot' : 'default'}>
        {session ? `Queue ${session.status}` : 'Queue not started'}
      </Pill>
      <button
        type="button"
        disabled={planning}
        onClick={onPlan}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <RefreshCcw size={12} className={planning ? 'animate-spin' : ''} />
        Plan All
      </button>
      <button
        type="button"
        disabled={planning}
        onClick={onPlanRemaining}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <RotateCcw size={12} className={planning ? 'animate-spin' : ''} />
        Plan Remaining
      </button>
      <button
        type="button"
        disabled={!hasSelectedPages || planning}
        onClick={onPlanSelected}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <CheckCircle2 size={12} className={planning ? 'animate-pulse' : ''} />
        Plan Selected
      </button>
      <button
        type="button"
        disabled={sessionRunning}
        onClick={onStartSession}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <GitBranch size={12} className={sessionRunning ? 'animate-pulse' : ''} />
        Start Queue
      </button>
      <button
        type="button"
        disabled={!hasSelectedPages || sessionRunning}
        onClick={onStartSelectedSession}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <GitBranch size={12} className={sessionRunning ? 'animate-pulse' : ''} />
        Start Selected
      </button>
      <button
        type="button"
        disabled={!canCancelSession || sessionRunning}
        onClick={onCancelSession}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <Pause size={12} />
        Cancel Queue
      </button>
      <button
        type="button"
        disabled={!canRetrySession || sessionRunning}
        onClick={onRetrySession}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <RotateCcw size={12} className={sessionRunning ? 'animate-spin' : ''} />
        Retry Queue
      </button>
      <button
        type="button"
        disabled={!nextDispatchTarget || sessionRunning}
        onClick={() => nextDispatchTarget && onOpenTarget(nextDispatchTarget)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <Play size={12} />
        {nextDispatchTarget?.executor === 'navigation' ? 'Open Next' : 'Run Next'}
      </button>
      <button
        type="button"
        disabled={!visitedTarget || sessionRunning}
        onClick={() => visitedTarget && onCompleteTarget(visitedTarget)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <CheckCircle2 size={12} />
        Mark Done
      </button>
      <button
        type="button"
        disabled={!visitedTarget || sessionRunning}
        onClick={() => visitedTarget && onErrorTarget(visitedTarget)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <AlertTriangle size={12} />
        Mark Error
      </button>
      <button
        type="button"
        disabled={!visitedTarget || sessionRunning}
        onClick={() => visitedTarget && onSkipTarget(visitedTarget)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
      >
        <X size={12} />
        Skip
      </button>
      {summary && (
        <>
          <Pill tone={summary.planned ? 'success' : 'default'}>{`${summary.planned}/${summary.total} targets`}</Pill>
          <Pill>{`${summary.navigation} nav`}</Pill>
          <Pill>{`${summary.client} client`}</Pill>
          <Pill>{`${summary.server} server`}</Pill>
          <Pill tone={summary.skipped ? 'hot' : 'default'}>{`${summary.skipped} skipped`}</Pill>
          <Pill tone={summary.missingParams ? 'hot' : 'default'}>{`${summary.missingParams} missing params`}</Pill>
          {!!summary.coveredSkipped && <Pill tone="success">{`${summary.coveredSkipped} covered skipped`}</Pill>}
          {hasSelectedPages && <Pill tone="hot">{`${selectedPageCount} selected`}</Pill>}
        </>
      )}
      {!summary && hasSelectedPages && <Pill tone="hot">{`${selectedPageCount} selected`}</Pill>}
      {sessionSummary && (
        <>
          {focusedTarget && (
            <Pill tone={focusedTarget.status === 'completed' ? 'success' : focusedTarget.status === 'error' ? 'danger' : 'hot'}>
              {`Focus ${focusedTarget.pageName} ${focusedTarget.status}`}
            </Pill>
          )}
          <Pill tone={sessionSummary.pending ? 'hot' : 'default'}>{`${sessionSummary.pending} pending`}</Pill>
          <Pill tone={sessionSummary.visited ? 'hot' : 'default'}>{`${sessionSummary.visited} visited`}</Pill>
          <Pill tone={sessionSummary.completed ? 'success' : 'default'}>{`${sessionSummary.completed} done`}</Pill>
          <Pill tone={sessionSummary.targetSkipped ? 'hot' : 'default'}>{`${sessionSummary.targetSkipped || 0} skipped`}</Pill>
          <Pill tone={sessionSummary.targetErrors ? 'danger' : 'default'}>{`${sessionSummary.targetErrors || 0} errors`}</Pill>
          <Pill tone={sessionSummary.targetCancelled ? 'hot' : 'default'}>{`${sessionSummary.targetCancelled || 0} cancelled`}</Pill>
        </>
      )}
      {visibleTargets.map((target) => (
        <span
          key={target.id}
          title={target.navigationPath || target.dispatchMessage || target.recommendedAction}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
        >
          <GitBranch size={12} className={target.executor === 'navigation' ? 'text-Cr-text-success-default-v2' : 'text-dreamy-brand-hot-v2'} />
          <span className="max-w-[120px] truncate">{target.pageName}</span>
          <span className="text-Cr-text-subtlest-v2">{String('status' in target ? target.status : target.executor)}</span>
        </span>
      ))}
      {focusedTargetVisible && (
        <span
          key={focusedTarget.id}
          title={focusedTarget.navigationPath || focusedTarget.dispatchMessage || focusedTarget.recommendedAction}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-dreamy-brand-hot-v2 bg-dreamy-brand-hot-v2/10 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
        >
          <GitBranch size={12} className="text-dreamy-brand-hot-v2" />
          <span className="max-w-[120px] truncate">{focusedTarget.pageName}</span>
          <span className="text-Cr-text-subtlest-v2">{focusedTarget.status}</span>
        </span>
      )}
      {skipped.slice(0, 4).map((target) => (
        <span
          key={target.id}
          title={target.message || target.reason}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 text-[11px] font-semibold text-Cr-text-subtler-v2"
        >
          <AlertTriangle size={12} className="text-dreamy-brand-hot-v2" />
          <span className="max-w-[120px] truncate">{target.pageName}</span>
          <span className="text-Cr-text-subtlest-v2">{target.reason}</span>
        </span>
      ))}
    </div>
  );
}

function StudioDispatchMatrixPanel({
  matrix,
  selectedPageId,
  selectedBatchPageIds,
  submitting,
  onSelectPage,
  onToggleBatchPage,
  onSelectReadyBatchPages,
  onClearBatchPageSelection,
  onRunEntry,
  onCopyEntryLink,
}: {
  matrix: StudioDispatchMatrix | null;
  selectedPageId: string;
  selectedBatchPageIds: string[];
  submitting: boolean;
  onSelectPage: (pageId: string) => void;
  onToggleBatchPage: (pageId: string) => void;
  onSelectReadyBatchPages: (pageIds: string[]) => void;
  onClearBatchPageSelection: () => void;
  onRunEntry: (entry: StudioDispatchMatrixEntry) => void;
  onCopyEntryLink: (entry: StudioDispatchMatrixEntry) => void;
}) {
  const entries = matrix?.entries || [];
  if (!entries.length) return null;
  const summary = matrix?.summary;
  const selectedBatchSet = new Set(selectedBatchPageIds);
  const readyPageIds = entries.filter((entry) => entry.dispatchReady).map((entry) => String(entry.pageId));

  return (
    <div className="shrink-0 border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-Cr-text-subtle-v2">
          <GitBranch size={14} />
          Dispatch Matrix
        </div>
        <div className="flex max-w-full items-center gap-2 overflow-x-auto [-webkit-overflow-scrolling:touch]">
          {summary && (
            <>
              <Pill tone={summary.ready === summary.total ? 'success' : 'hot'}>{`${summary.ready}/${summary.total} ready`}</Pill>
              <Pill tone={summary.missingParams ? 'hot' : 'default'}>{`${summary.missingParams} missing params`}</Pill>
              <Pill>{`${summary.navigation} nav`}</Pill>
              <Pill tone={selectedBatchPageIds.length ? 'hot' : 'default'}>{`${selectedBatchPageIds.length} selected`}</Pill>
              {matrix?.sourceSegmentId && <Pill tone="success">source segment</Pill>}
            </>
          )}
          <button
            type="button"
            disabled={!readyPageIds.length}
            onClick={() => onSelectReadyBatchPages(readyPageIds)}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
          >
            <CheckCircle2 size={12} />
            Select Ready
          </button>
          <button
            type="button"
            disabled={!selectedBatchPageIds.length}
            onClick={onClearBatchPageSelection}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
          >
            <X size={12} />
            Clear
          </button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {entries.map((entry) => {
          const active = entry.pageId === selectedPageId;
          const entryHref = getStudioDispatchTargetHref(entry);
          const selectedForBatch = selectedBatchSet.has(String(entry.pageId));
          const missingLabel = entry.missingRouteParams.length
            ? `Needs ${entry.missingRouteParams.join(', ')}`
            : '';
          const blockedLabel = missingLabel || entry.dispatchStatus;
          return (
            <div
              key={entry.pageId}
              className={`grid min-w-[230px] gap-2 rounded-lg-v2 border p-2 text-left text-xs transition-colors ${
                active
                  ? 'border-dreamy-brand-hot-v2 bg-dreamy-brand-hot-v2/10'
                  : 'border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 active:bg-Cr-beta-white-8-v2'
              }`}
            >
              <div className="grid min-w-0 gap-2 text-left">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <label className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedForBatch}
                      onChange={() => onToggleBatchPage(String(entry.pageId))}
                      aria-label={`Include ${entry.pageName} in selected dispatch batch`}
                      className="h-3.5 w-3.5 shrink-0 accent-dreamy-brand-hot-v2"
                    />
                    <span className="min-w-0 truncate font-semibold text-Cr-text-default-v2">{entry.pageName}</span>
                  </label>
                  <Pill tone={healthPillTone(entry.dispatchStatus)}>{entry.dispatchStatus}</Pill>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-Cr-text-subtler-v2">
                  <span className="truncate">{entry.agentId}</span>
                  <span className="shrink-0">{entry.executor}</span>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-Cr-text-subtlest-v2">
                  <span className="truncate">{entry.navigationPath || entry.recommendedAction}</span>
                  {!!entry.missingRouteParams.length && (
                    <span className="shrink-0 font-semibold text-dreamy-brand-hot-v2">
                      {entry.missingRouteParams.join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-1.5">
                <button
                  type="button"
                  onClick={() => onSelectPage(entry.pageId)}
                  aria-label={`Focus ${entry.pageName} dispatch target`}
                  className="inline-flex h-8 items-center justify-center rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-default-v2"
                >
                  Focus
                </button>
                <button
                  type="button"
                  disabled={!entry.dispatchReady || submitting}
                  onClick={() => onRunEntry(entry)}
                  title={entry.dispatchReady ? `Dispatch ${entry.pageName}` : blockedLabel}
                  aria-label={`Dispatch ${entry.pageName}`}
                  className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-default-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
                >
                  <Play size={12} className="shrink-0" />
                  <span className="truncate">{entry.dispatchReady ? 'Dispatch' : blockedLabel}</span>
                </button>
                {entryHref ? (
                  <a
                    data-testid="studio-dispatch-open-link"
                    href={entryHref}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open ${entry.pageName} at ${entryHref}`}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-default-v2 hover:bg-Cr-beta-white-12-v2"
                  >
                    <ExternalLink size={12} />
                    Open
                  </a>
                ) : (
                  <span
                    title="No direct page link for this executor"
                    className="inline-flex h-8 items-center justify-center rounded-md-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-[11px] font-semibold text-Cr-text-subtlest-v2"
                  >
                    Open
                  </span>
                )}
                <button
                  type="button"
                  disabled={!entryHref}
                  onClick={() => onCopyEntryLink(entry)}
                  title={entryHref ? `Copy ${entry.pageName} link` : 'No direct page link to copy'}
                  aria-label={`Copy ${entry.pageName} dispatch link`}
                  className="inline-flex h-8 items-center justify-center rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-default-v2 disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
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
            {item.route.page && (
              <div className="text-Cr-text-subtle-v2">
                {item.route.page.name}
                {item.route.navigationPath ? ` · ${item.route.navigationPath}` : ''}
              </div>
            )}
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

function ChatThreadPanel({
  messages,
  selectedSegment,
  submitting,
  onAction,
}: {
  messages: ChatItem[];
  selectedSegment?: StudioSegment | null;
  submitting: boolean;
  onAction: (action: StudioAction, prompt?: string, source?: StudioSegment | null) => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, submitting]);

  return (
    <div
      data-testid="studio-chat-log"
      className="min-h-0 flex-1 overflow-y-auto bg-Cr-Bg-soft-v2 p-3 [-webkit-overflow-scrolling:touch]"
      aria-label="Dreamy chat conversation"
    >
      <div className="grid min-h-full content-end gap-3">
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            item={message}
            selectedSegment={selectedSegment}
            submitting={submitting}
            onAction={onAction}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function DreamyOrchestratorThread({
  project,
  messages,
  starterPresets,
  allBotPresets,
  selectedStarterPresetId,
  selectedStarterPreset,
  selectedSegment,
  manualBotIdsText,
  manualBotEntries,
  selectedManualBotEntryId,
  submitting,
  onSelectPreset,
  onManualBotIdsChange,
  onSelectManualBot,
  onRunManualBot,
  onRunManualBotSequence,
  onRunPreset,
  onAction,
}: {
  project: StudioProject | null;
  messages: ChatItem[];
  starterPresets: StudioStarterPreset[];
  allBotPresets: StudioStarterPreset[];
  selectedStarterPresetId?: string;
  selectedStarterPreset?: StudioStarterPreset | null;
  selectedSegment?: StudioSegment | null;
  manualBotIdsText: string;
  manualBotEntries: ManualBotEntry[];
  selectedManualBotEntryId?: string;
  submitting: boolean;
  onSelectPreset: (preset: StudioStarterPreset) => void;
  onManualBotIdsChange: (value: string) => void;
  onSelectManualBot: (entry: ManualBotEntry) => void;
  onRunManualBot: (entry: ManualBotEntry) => void;
  onRunManualBotSequence: () => void;
  onRunPreset?: (preset: StudioStarterPreset, prompt?: string) => void;
  onAction: (action: StudioAction, prompt?: string, source?: StudioSegment | null) => void;
}) {
  const [allBotPickerOpen, setAllBotPickerOpen] = useState(false);
  const activeStarterPresetId = selectedStarterPreset?.id || selectedStarterPresetId;
  const selectableBotCount = allBotPresets.length || starterPresets.length;
  const choicePresets = useMemo(() => {
    const seen = new Set<string>();
    const ordered = [selectedStarterPreset, ...starterPresets, ...allBotPresets].filter(Boolean) as StudioStarterPreset[];
    return ordered.filter((preset) => {
      const key = preset.botSlug || preset.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 4);
  }, [allBotPresets, selectedStarterPreset, starterPresets]);
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const latestAssistantError = [...messages].reverse().find((message) => message.error);
  const displayPrompt =
    latestUserMessage?.content ||
    selectedStarterPreset?.prompt ||
    'Generate a 5s rooftop suite at night - neon skyline through the window, slow push-in, cinematic.';
  const segments = getTimelineDisplaySegments(project?.segments || []);
  const selectedSegmentIndex = selectedSegment ? segments.findIndex((segment) => segment.id === selectedSegment.id) : -1;
  const segmentMedia = getSegmentMedia(selectedSegment);
  const selectedSegmentNumber = selectedSegmentIndex >= 0 ? selectedSegmentIndex + 1 : Math.max(segments.length, 1);
  const selectedBotName = selectedStarterPreset?.title || selectedSegment?.botName || choicePresets[0]?.title || 'Dreamy bot';
  const allPresets = allBotPresets.length ? allBotPresets : starterPresets;

  return (
    <div data-testid="studio-chat-log" className="dreamy-studio-thread" aria-label="Dreamy orchestrator conversation">
      <div className="dreamy-studio-msg">
        <div className="dreamy-studio-msg-avatar dreamy-studio-msg-avatar-user">D</div>
        <div className="min-w-0">
          <div className="dreamy-studio-who">
            <span className="dreamy-studio-name">You</span>
            <span className="dreamy-studio-time">10:41 AM</span>
          </div>
          <div className="dreamy-studio-bubble">{displayPrompt}</div>
        </div>
      </div>

      <div className="dreamy-studio-msg">
        <div className="dreamy-studio-msg-avatar dreamy-studio-msg-avatar-bot">
          <Bot size={15} />
        </div>
        <div className="min-w-0">
          <div className="dreamy-studio-who">
            <span className="dreamy-studio-name">Orchestrator</span>
            <span className="dreamy-studio-time">10:41 AM</span>
          </div>
          <div className="dreamy-studio-body-text">
            I found <b className="text-white">{choicePresets.length || selectableBotCount} scenes</b> that match your prompt.
            Pick the one you want to bring to life.
          </div>
          <div className="dreamy-studio-choice-head">
            <span className="dreamy-studio-eyebrow">Choose a scene</span>
            <span className="dreamy-studio-faint">{`${choicePresets.length} options`}</span>
          </div>
          <div data-testid="all-bot-previews" className="dreamy-studio-choice-list">
            {choicePresets.map((preset, index) => {
              const selected = activeStarterPresetId === preset.id;
              const cost = preset.workflow.toLowerCase().includes('video') ? (index === 2 ? 56 : 48) : 44;
              const visual = resolveStudioDisplayAssetUrl(preset.visualUrl) || preset.fallbackVisualUrl || fallbackVisualForDreamyBot(preset.botSlug, preset.title);
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-testid="dreamy-scene-choice"
                  aria-pressed={selected}
                  onClick={() => onSelectPreset(preset)}
                  className={`dreamy-studio-choice ${selected ? 'is-on' : ''}`}
                >
                  <span className="dreamy-studio-choice-thumb">
                    {visual ? <img src={visual} alt="" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="dreamy-studio-choice-title">{preset.title}</span>
                    <span className="dreamy-studio-choice-desc">
                      {preset.workflow} · {preset.previewAccepted ? 'ready media' : preset.previewLabel} · 5s
                    </span>
                  </span>
                  <span className="dreamy-studio-pickside">
                    <span className="dreamy-studio-cost-mini">
                      <Zap size={11} fill="currentColor" />
                      {cost}
                    </span>
                    <span className="dreamy-studio-radio">
                      <CheckCircle2 size={11} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="dreamy-studio-choice-foot">
            <button type="button" className="dreamy-studio-ghost-pill" onClick={() => setAllBotPickerOpen(true)}>
              <RefreshCcw size={13} />
              Show other scenes
            </button>
            <span className="dreamy-studio-faint">Tap a scene to preview · switch anytime</span>
          </div>
        </div>
      </div>

      <div className="dreamy-studio-msg">
        <div className="dreamy-studio-msg-avatar dreamy-studio-msg-avatar-bot">
          <Sparkles size={15} />
        </div>
        <div className="min-w-0">
          <div className="dreamy-studio-who">
            <span className="dreamy-studio-name">Orchestrator</span>
            <span className="dreamy-studio-time">10:41 AM</span>
          </div>
          <div className="dreamy-studio-body-text">
            Segment <b className="text-white">{String(selectedSegmentNumber).padStart(2, '0')}</b> is ready. Added to the timeline.
          </div>
          <div className="dreamy-studio-segment-card">
            <div className="dreamy-studio-segment-thumb">
              {segmentMedia ? <img src={segmentMedia} alt="" /> : null}
              <button type="button" className="dreamy-studio-segment-play" aria-label="Preview segment">
                <Play size={16} fill="currentColor" />
              </button>
              <span className="dreamy-studio-duration">00:05</span>
            </div>
            <div className="dreamy-studio-segment-meta">
              <div className="dreamy-studio-eyebrow">Inputs used</div>
              <div className="dreamy-studio-seg-pills">
                <span className="dreamy-studio-seg-pill"><span className="dreamy-studio-faint">Source</span><b>{selectedSegment?.botSlug || selectedStarterPreset?.botSlug || 'keyframe_02'}</b></span>
                <span className="dreamy-studio-seg-pill"><span className="dreamy-studio-faint">Prompt</span><b>{selectedBotName}</b></span>
                <span className="dreamy-studio-seg-pill"><span className="dreamy-studio-faint">Style</span><b>Cinematic</b></span>
                <span className="dreamy-studio-seg-pill"><span className="dreamy-studio-faint">Motion</span><b>Slow</b></span>
              </div>
            </div>
            <div className="dreamy-studio-seg-actions">
              <button
                type="button"
                data-testid="orchestrator-extend-segment"
                disabled={submitting || (!selectedSegment && !selectedStarterPreset)}
                onClick={() => {
                  if (selectedStarterPreset) onRunPreset?.(selectedStarterPreset, `Extend ${selectedBotName} as the next five second shot.`);
                  else onAction('extend', 'Extend this into the next shot.', selectedSegment);
                }}
                className="dreamy-studio-seg-action dreamy-studio-seg-action-primary disabled:opacity-50"
              >
                <Plus size={13} />
                Extend
              </button>
              <button
                type="button"
                disabled={!selectedSegment || submitting}
                onClick={() => onAction('extend', 'Use this segment as the source for the next shot.', selectedSegment)}
                className="dreamy-studio-seg-action disabled:opacity-50"
              >
                Use as next source
              </button>
              <span className="dreamy-studio-spacer" />
              <button type="button" className="dreamy-studio-seg-action !w-8 !px-0" aria-label="More segment actions">
                ...
              </button>
            </div>
          </div>
          {latestAssistantError?.error && (
            <div className="mt-3 rounded-lg border border-red-400/35 bg-red-500/10 p-2 text-xs leading-5 text-red-100">
              {latestAssistantError.error}
            </div>
          )}
        </div>
      </div>

      <div className="sr-only">
        {messages.map((message) => (
          <span key={message.id}>{message.content}</span>
        ))}
      </div>

      {allBotPickerOpen && (
        <div className="dreamy-studio-dialog-backdrop" role="dialog" aria-modal="true" aria-label="All selectable Dreamy bots">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close all bot picker"
            onClick={() => setAllBotPickerOpen(false)}
          />
          <section className="dreamy-studio-dialog">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-Cr-text-default-v2">
                  <Bot size={15} className="text-dreamy-brand-hot-v2" />
                  All selectable bots
                </div>
                <div className="truncate text-[11px] text-Cr-text-subtler-v2">
                  Select one bot for the prompt. The canvas preview follows the active choice.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Pill tone="hot">{`${allPresets.length} bots`}</Pill>
                <button
                  type="button"
                  onClick={() => setAllBotPickerOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md-v2 border border-white/10 bg-white/[0.04] text-Cr-text-subtler-v2 active:bg-white/[0.08]"
                  aria-label="Close all bot picker"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <div data-testid="all-bots-modal-list" className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {allPresets.map((preset) => (
                  <BotPresetCard
                    key={`modal-${preset.id}`}
                    preset={preset}
                    selected={activeStarterPresetId === preset.id}
                    submitting={submitting}
                    variant="modal"
                    onSelect={(nextPreset) => {
                      onSelectPreset(nextPreset);
                      setAllBotPickerOpen(false);
                    }}
                  />
                ))}
              </div>
              <details data-testid="manual-bot-id-panel" className="mt-4 rounded-lg-v2 border border-white/10 bg-white/[0.03] p-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 marker:hidden">
                  <span className="text-xs font-semibold uppercase text-Cr-text-subtler-v2">Manual Bot IDs</span>
                  <Pill tone={manualBotEntries.length ? 'hot' : 'default'}>{`${manualBotEntries.length} queued`}</Pill>
                </summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
                  <textarea
                    data-testid="manual-bot-id-input"
                    value={manualBotIdsText}
                    disabled={submitting}
                    onChange={(event) => onManualBotIdsChange(event.target.value)}
                    rows={3}
                    className="min-h-20 resize-none rounded-md-v2 border border-white/10 bg-black/35 px-3 py-2 text-xs leading-5 text-Cr-text-default-v2 outline-none placeholder:text-Cr-text-subtlest-v2 disabled:opacity-50"
                    placeholder="botId or botId|name|type|slug|articleId"
                  />
                  <div className="grid gap-2">
                    <button
                      type="button"
                      data-testid="manual-bot-run-selected"
                      disabled={submitting || !manualBotEntries.length}
                      onClick={() => {
                        const selected = manualBotEntries.find((entry) => entry.id === selectedManualBotEntryId) || manualBotEntries[0];
                        if (selected) onRunManualBot(selected);
                      }}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md-v2 bg-white/[0.08] px-3 text-xs font-semibold text-Cr-text-default-v2 disabled:opacity-40"
                    >
                      <Clapperboard size={13} />
                      Run selected
                    </button>
                    <button
                      type="button"
                      data-testid="manual-bot-run-sequence"
                      disabled={submitting || manualBotEntries.length < 2}
                      onClick={onRunManualBotSequence}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md-v2 bg-dreamy-brand-hot-v2 px-3 text-xs font-semibold text-white disabled:bg-white/[0.08] disabled:text-Cr-text-subtlest-v2"
                    >
                      <GitBranch size={13} />
                      Run sequence
                    </button>
                  </div>
                </div>
                {!!manualBotEntries.length && (
                  <div data-testid="manual-bot-sequence-list" className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {manualBotEntries.map((entry, index) => (
                      <button
                        key={entry.id}
                        type="button"
                        disabled={submitting}
                        aria-pressed={selectedManualBotEntryId === entry.id}
                        onClick={() => onSelectManualBot(entry)}
                        className={`min-w-[144px] rounded-md-v2 border px-2 py-2 text-left disabled:opacity-50 ${
                          selectedManualBotEntryId === entry.id
                            ? 'border-dreamy-brand-hot-v2 bg-dreamy-brand-hot-v2/10'
                            : 'border-white/10 bg-white/[0.04]'
                        }`}
                      >
                        <span className="block truncate text-xs font-semibold text-Cr-text-default-v2">{entry.botName}</span>
                        <span className="block truncate text-[10px] text-Cr-text-subtlest-v2">{`${index + 1}. ${entry.botId || entry.botSlug}`}</span>
                      </button>
                    ))}
                  </div>
                )}
              </details>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function DreamyPreviewTimelinePanels({
  project,
  selectedSegment,
  selectedStarterPreset,
  onSelectSegment,
  onAction,
  onRunPreset,
  onExportAllSegments,
  timelineExporting,
  submitting,
}: {
  project: StudioProject | null;
  selectedSegment?: StudioSegment | null;
  selectedStarterPreset?: StudioStarterPreset | null;
  onSelectSegment: (segmentId: string) => void;
  onAction: (action: StudioAction, prompt?: string, source?: StudioSegment | null) => void;
  onRunPreset?: (preset: StudioStarterPreset, prompt?: string) => void;
  onExportAllSegments: () => void;
  timelineExporting: boolean;
  submitting: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const segments = getTimelineDisplaySegments(project?.segments || []);
  const media = getSegmentMedia(selectedSegment);
  const selectedStarterVisual = resolveStudioDisplayAssetUrl(selectedStarterPreset?.visualUrl);
  const selectedSegmentFallback = fallbackVisualForDreamyBot(selectedSegment?.botSlug, selectedSegment?.botName);
  const starterMatchesSelectedSegment = Boolean(
    selectedStarterPreset && selectedSegment && verifiedWorkshopBotMatches(selectedSegment, selectedStarterPreset),
  );
  const showStarterPreview = Boolean(selectedStarterPreset && (!selectedSegment || !starterMatchesSelectedSegment));
  const stageMedia = showStarterPreview ? selectedStarterVisual : media;
  const stageFallback = showStarterPreview ? selectedStarterVisual || presetCinematicGif : selectedSegmentFallback;
  const selectedIndex = selectedSegment ? segments.findIndex((segment) => segment.id === selectedSegment.id) : -1;
  const selectedNumber = selectedIndex >= 0 ? selectedIndex + 1 : Math.max(segments.length, 1);
  const totalSeconds = Math.max(segments.length * 5, 5);
  const latestTimelineExport = project?.timelineExports?.[0] || null;
  const latestTimelineMediaUrl = resolveStudioDisplayAssetUrl(latestTimelineExport?.mediaUrl);
  const markerPositions = segments.length
    ? segments.map((_, index) => `${((index + 0.5) / segments.length) * 100}%`)
    : ['8%', '34%', '60%', '84%'];
  const timelineLabels = Array.from({ length: Math.max(segments.length, 2) + 1 }, (_, index) =>
    `00:${String(index * 5).padStart(2, '0')}`,
  );
  const runAddSegment = () => {
    if (selectedStarterPreset) {
      onRunPreset?.(selectedStarterPreset, `Append the next five second segment with ${selectedStarterPreset.title}.`);
      return;
    }
    if (selectedSegment) onAction('extend', 'Extend this into the next shot.', selectedSegment);
  };

  return (
    <>
      <section data-testid="preview-workspace-panel" className="dreamy-studio-preview" aria-label="Preview">
        <div className="dreamy-studio-preview-stage">
          <div data-testid="preview-main-stage" className="dreamy-studio-player">
            <div
              className="dreamy-studio-player-media"
              style={{
                backgroundImage: stageMedia ? undefined : `url(${stageFallback})`,
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: 'cover',
              }}
            >
              {stageMedia ? (
                <img
                  src={stageMedia}
                  alt={`${selectedStarterPreset?.title || selectedSegment?.botName || 'Dreamy'} preview`}
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = stageFallback;
                  }}
                />
              ) : null}
            </div>
            <span className="dreamy-studio-scene-tag">
              <span className="dreamy-studio-live-dot" />
              {`Preview · Segment ${String(selectedNumber).padStart(2, '0')}`}
            </span>
            <span className="dreamy-studio-scene-cap">1920x1080 · 24fps</span>

            <div className="dreamy-studio-marker-track">
              <div className="dreamy-studio-marker-line" />
              {markerPositions.map((left, index) => (
                <span key={`${left}-${index}`} className="dreamy-studio-marker" style={{ left }} />
              ))}
            </div>

            <div className="dreamy-studio-controls">
              <button
                type="button"
                className="dreamy-studio-play"
                onClick={() => setPlaying((value) => !value)}
                aria-label={playing ? 'Pause preview' : 'Play preview'}
              >
                {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
              <span className="dreamy-studio-time">
                00:03.21 <span>{`/ 00:${String(Math.min(totalSeconds, 5)).padStart(2, '0')}.00`}</span>
              </span>
              <div className="dreamy-studio-scrub" aria-hidden="true">
                <div className="dreamy-studio-scrub-fill" />
                <div className="dreamy-studio-scrub-knob" />
              </div>
              <button type="button" className="dreamy-studio-control-icon" aria-label="Volume">
                <Volume2 size={20} />
              </button>
              <button type="button" className="dreamy-studio-fit">
                Fit
                <ChevronDown size={13} />
              </button>
              <button type="button" className="dreamy-studio-control-icon" aria-label="Fullscreen">
                <Maximize2 size={18} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section data-testid="timeline-workbench" className="dreamy-studio-timeline" aria-label="Timeline">
        <div className="dreamy-studio-timeline-head">
          <span className="dreamy-studio-timeline-title">Timeline</span>
          <span className="dreamy-studio-total">{`Total 00:${String(totalSeconds).padStart(2, '0')}.00 · ${segments.length} segments`}</span>
          <span className="dreamy-studio-spacer" />
          <div className="dreamy-studio-tool">
            <button type="button" className="dreamy-studio-tool-button" aria-label="Undo">
              <RotateCcw size={17} />
            </button>
            <button type="button" className="dreamy-studio-tool-button" aria-label="Redo">
              <RefreshCcw size={17} />
            </button>
          </div>
          <div className="dreamy-studio-zoom">
            <button type="button" aria-label="Zoom out">-</button>
            <span className="dreamy-studio-zoom-bar" />
            <button type="button" aria-label="Zoom in">+</button>
          </div>
          <button
            type="button"
            data-testid="preview-append-next-segment"
            disabled={submitting || (!selectedSegment && !selectedStarterPreset)}
            onClick={runAddSegment}
            className="dreamy-studio-add disabled:opacity-50"
          >
            <Plus size={14} />
            Add segment
          </button>
        </div>

        <div className="dreamy-studio-timeline-body">
          <div className="dreamy-studio-ruler">
            {timelineLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="dreamy-studio-tracks">
            {segments.map((segment, index) => {
              const segmentMedia = getSegmentMedia(segment);
              const segmentFallback = fallbackVisualForDreamyBot(segment.botSlug, segment.botName);
              return (
                <Fragment key={segment.id}>
                  {index > 0 && (
                    <span className="dreamy-studio-gap">
                      <button type="button" aria-label="Insert segment" onClick={runAddSegment}>
                        <Plus size={12} />
                      </button>
                    </span>
                  )}
                  <button
                    type="button"
                    data-testid="timeline-segment-card"
                    onClick={() => onSelectSegment(segment.id)}
                    className={`dreamy-studio-clip ${segment.id === selectedSegment?.id ? 'is-sel' : ''}`}
                    style={{
                      backgroundImage: segmentMedia ? undefined : `url(${segmentFallback})`,
                      backgroundPosition: 'center',
                      backgroundSize: 'cover',
                    }}
                  >
                    {segmentMedia ? (
                      <img
                        src={segmentMedia}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                    <span className="dreamy-studio-clip-no">{index + 1}</span>
                    <span className="dreamy-studio-clip-len">5.0s</span>
                  </button>
                </Fragment>
              );
            })}
            {!segments.length && (
              <div className="flex h-[86px] flex-1 items-center justify-center rounded-lg border border-dashed border-white/15 text-xs text-Cr-text-subtler-v2">
                Start now to create segment 1
              </div>
            )}
          </div>
          <div className="dreamy-studio-hint">Drag to reorder · click a segment to edit or preview</div>
        </div>

        <div className="dreamy-studio-dock">
          <div className="dreamy-studio-cost">
            <span className="dreamy-studio-cost-label">Preview render</span>
            <span className="dreamy-studio-cost-value energy">
              <Zap size={16} fill="currentColor" />
              48
              <span className="dreamy-studio-unit">/ preview</span>
            </span>
          </div>
          <span className="dreamy-studio-cost-div" />
          <div className="dreamy-studio-cost">
            <span className="dreamy-studio-cost-label">Spent this project</span>
            <span className="dreamy-studio-cost-value">
              <Zap size={16} fill="currentColor" className="text-Cr-text-subtler-v2" />
              {Math.max(segments.length * 78, 156)}
              <span className="dreamy-studio-unit">energy</span>
            </span>
          </div>
          <span className="dreamy-studio-spacer" />
          <span className="dreamy-studio-cost-note">
            <Zap size={14} fill="currentColor" className="text-yellow-300" />
            Final render at 1080p · est. 240 energy
          </span>
          <button
            type="button"
            data-testid="preview-export-all-segments"
            disabled={!segments.length || timelineExporting}
            onClick={onExportAllSegments}
            className="dreamy-studio-start"
          >
            {timelineExporting ? 'Rendering' : 'Start now'}
            <span className="dreamy-studio-cost-chip">
              {timelineExporting ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} fill="currentColor" />}
              240
            </span>
          </button>
        </div>

        {latestTimelineExport && (
          <div data-testid="timeline-export-output-card" className="dreamy-studio-export-output">
            <Pill tone={latestTimelineExport.status === 'ready' ? 'success' : statusPillTone(latestTimelineExport.status)}>
              {latestTimelineExport.status}
            </Pill>
            <span>{latestTimelineExport.evidence?.message || `Composed ${latestTimelineExport.summary.videoSegments} video segments.`}</span>
            {latestTimelineMediaUrl && (
              <a href={latestTimelineMediaUrl} target="_blank" rel="noreferrer">
                Open composed video
              </a>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function PromptRoutingPanel({
  prompt,
  messages,
  selectedStarterPreset,
  selectedSegment,
  submitting,
}: {
  prompt: string;
  messages: ChatItem[];
  selectedStarterPreset?: StudioStarterPreset | null;
  selectedSegment?: StudioSegment | null;
  submitting: boolean;
}) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  const acceptedPrompt = prompt.trim() || latestUserMessage?.content || selectedStarterPreset?.prompt || '';
  const targetBotName = selectedStarterPreset?.title || selectedSegment?.botName || 'Choose a bot';
  const targetBotId = selectedStarterPreset?.botId || selectedSegment?.botId || selectedStarterPreset?.botSlug || selectedSegment?.botSlug || '';
  const nextAction = selectedSegment ? 'Add next segment' : 'Generate first segment';

  return (
    <div
      data-testid="studio-chat-log"
      className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-3 [-webkit-overflow-scrolling:touch]"
    >
      <div className="rounded-xl-v2 border border-dreamy-brand-hot-v2/35 bg-dreamy-brand-hot-v2/10 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-Cr-text-default-v2">Prompt to bot</div>
            <div className="mt-0.5 truncate text-[11px] text-Cr-text-subtler-v2">
              {submitting ? 'Calling Dreamy now' : 'One prompt, one selected bot, one timeline result'}
            </div>
          </div>
          <Pill tone={submitting ? 'hot' : acceptedPrompt ? 'success' : 'default'}>
            {submitting ? 'Running' : acceptedPrompt ? 'Prompt accepted' : 'Waiting'}
          </Pill>
        </div>

        <div className="grid gap-2 text-xs">
          <div className="rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2 p-2.5">
            <div className="mb-1 text-[10px] font-semibold uppercase text-Cr-text-subtlest-v2">Input prompt</div>
            <div className="line-clamp-3 min-h-5 leading-5 text-Cr-text-default-v2">
              {acceptedPrompt || 'Type the next shot in the box below.'}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2 p-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase text-Cr-text-subtlest-v2">Bot to call</div>
              <div className="truncate font-semibold text-Cr-text-default-v2">{targetBotName}</div>
              {targetBotId && <div className="mt-0.5 truncate text-[11px] text-Cr-text-subtler-v2">{targetBotId}</div>}
            </div>
            <div className="rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2 p-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase text-Cr-text-subtlest-v2">Next action</div>
              <div className="truncate font-semibold text-Cr-text-default-v2">{nextAction}</div>
              <div className="mt-0.5 truncate text-[11px] text-Cr-text-subtler-v2">
                {selectedSegment ? `Source: ${selectedSegment.botName}` : 'Starts the timeline'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {latestAssistantMessage && (
        <div className="rounded-xl-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2 p-3 text-xs leading-5 text-Cr-text-subtle-v2">
          <div className="mb-1 text-[10px] font-semibold uppercase text-Cr-text-subtlest-v2">Latest result</div>
          <div className="line-clamp-3">{latestAssistantMessage.content}</div>
        </div>
      )}

      <div className="sr-only">
        {messages.map((message) => (
          <span key={message.id}>{message.content}</span>
        ))}
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
    <div
      className={`group relative h-[86px] w-[116px] shrink-0 overflow-hidden rounded-lg-v2 border text-left transition-colors ${
        active ? 'border-dreamy-brand-hot-v2' : 'border-Cr-border-default-v2'
      } bg-Cr-Bg-surface-default-v2`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block h-full w-full text-left"
        aria-label={`Select ${segment.botName} segment`}
      >
        {media ? (
          <img src={media} alt="" className="h-full w-full object-contain opacity-80" />
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
      </button>
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
    </div>
  );
}

function PreviewPanel({
  project,
  selectedSegment,
  selectedStarterPreset,
  selectedJob,
  agentsOpen,
  onToggleAgents,
  onSelectSegment,
  onDeleteSegment,
  onCancelJob,
  onRetryJob,
  onAction,
  onRunPreset,
  onExportAllSegments,
  timelineExporting,
  submitting,
}: {
  project: StudioProject | null;
  selectedSegment?: StudioSegment | null;
  selectedStarterPreset?: StudioStarterPreset | null;
  selectedJob?: StudioJob | null;
  agentsOpen: boolean;
  onToggleAgents: () => void;
  onSelectSegment: (segmentId: string) => void;
  onDeleteSegment: (segmentId: string) => void;
  onCancelJob: (jobId: string) => void;
  onRetryJob: (jobId: string) => void;
  onAction: (action: StudioAction, prompt?: string, source?: StudioSegment | null) => void;
  onRunPreset?: (preset: StudioStarterPreset) => void;
  onExportAllSegments: () => void;
  timelineExporting: boolean;
  submitting: boolean;
}) {
  const media = getSegmentMedia(selectedSegment);
  const selectedSegmentFallback = fallbackVisualForDreamyBot(selectedSegment?.botSlug, selectedSegment?.botName);
  const selectedStarterVisual = resolveStudioDisplayAssetUrl(selectedStarterPreset?.visualUrl);
  const starterMatchesSelectedSegment = Boolean(
    selectedStarterPreset && selectedSegment && verifiedWorkshopBotMatches(selectedSegment, selectedStarterPreset),
  );
  const showStarterPreview = Boolean(selectedStarterPreset && (!selectedSegment || !starterMatchesSelectedSegment));
  const stageMedia = showStarterPreview ? selectedStarterVisual : media;
  const stageFallback = showStarterPreview ? selectedStarterVisual || presetCinematicGif : selectedSegmentFallback;
  const graph = project?.agentGraph?.length ? project.agentGraph : EMPTY_GRAPH;
  const runningAgents = graph.filter((node) => node.status === 'running' || node.status === 'queued').length;
  const segments = getTimelineDisplaySegments(project?.segments || []);
  const selectedSegmentIndex = selectedSegment
    ? segments.findIndex((segment) => segment.id === selectedSegment.id)
    : -1;
  const evidence = selectedSegment?.evidence || selectedJob?.evidence;
  const authStatus = selectedSegment?.authStatus || selectedJob?.authStatus;
  const activeJobId = selectedSegment?.jobId || selectedJob?.jobId;
  const latestTimelineExport = project?.timelineExports?.[0] || null;
  const latestTimelineMediaUrl = resolveStudioDisplayAssetUrl(latestTimelineExport?.mediaUrl);

  return (
    <section
      data-testid="preview-workspace-panel"
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-Cr-border-default-v2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg-v2 bg-Cr-beta-white-8-v2">
            <Film size={16} className="text-dreamy-brand-hot-v2" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Preview</div>
            <div className="truncate text-[11px] text-Cr-text-subtler-v2">
              {selectedStarterPreset
                ? `Selected bot: ${selectedStarterPreset.title}`
                : segments.length
                  ? `${segments.length} segments`
                  : 'No segments'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleAgents}
          className="inline-flex h-8 items-center gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2"
        >
          <GitBranch size={14} />
          Agents
          {runningAgents > 0 && <span className="h-1.5 w-1.5 rounded-full bg-dreamy-brand-hot-v2" />}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div
          data-testid="preview-main-stage"
          className="relative flex h-[clamp(260px,38dvh,420px)] shrink-0 items-center justify-center overflow-hidden rounded-lg-v2 border border-Cr-border-default-v2 bg-[#07080d]"
          style={{
            backgroundImage: stageMedia ? undefined : `url(${stageFallback})`,
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'contain',
          }}
        >
          {!showStarterPreview && selectedSegment?.type === 'video' && selectedSegment.url ? (
            <img
              src={media || selectedSegmentFallback}
              alt={`${selectedSegment.botName || 'Selected'} segment preview`}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = selectedSegmentFallback;
              }}
              className="h-full w-full object-contain"
            />
          ) : !showStarterPreview && media ? (
            <img src={media} alt="Selected segment" className="h-full w-full object-contain" />
          ) : selectedStarterPreset ? (
            <div
              data-testid="preview-selected-dreamy-bot"
              className="relative h-full w-full bg-black/20"
            >
              {selectedStarterVisual ? (
                <img src={selectedStarterVisual} alt="" className="h-full w-full object-contain opacity-90" />
              ) : (
                <div className="grid h-full place-items-center text-Cr-text-subtler-v2">
                  <Bot size={32} />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-Cr-text-subtler-v2">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2">
                <Sparkles size={24} />
              </div>
              <div className="text-sm font-semibold">Ready for a first segment</div>
            </div>
          )}

          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            {showStarterPreview && selectedStarterPreset ? (
              <>
                <Pill tone={selectedStarterPreset.previewAccepted ? 'success' : 'hot'}>{selectedStarterPreset.previewLabel}</Pill>
                <Pill>{selectedStarterPreset.title}</Pill>
              </>
            ) : selectedSegment ? (
              <>
                <Pill tone={statusPillTone(selectedSegment.status)}>{selectedSegment.status}</Pill>
                <Pill>{selectedSegment.botName}</Pill>
              </>
            ) : selectedStarterPreset ? (
              <>
                <Pill tone="hot">{selectedStarterPreset.workflow}</Pill>
                <Pill>{selectedStarterPreset.title}</Pill>
              </>
            ) : null}
          </div>

          <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-lg-v2 border border-white/10 bg-black/70 px-3 py-2 backdrop-blur">
            <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md-v2 bg-white text-black">
              <Play size={14} />
            </button>
            <div className="hidden h-5 w-px bg-white/15 sm:block" />
            <span className="shrink-0 text-xs font-semibold text-white/80">
              {segments.length ? `00:00 / 00:${String(segments.length * 5).padStart(2, '0')}` : '00:00 / 00:05'}
            </span>
            <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full-v2 bg-white/20">
              <div className="h-full w-1/3 rounded-full-v2 bg-dreamy-brand-hot-v2" />
            </div>
            <span className="hidden shrink-0 text-xs font-semibold text-white/60 sm:inline">Fit</span>
            <Maximize2 size={15} className="hidden shrink-0 text-white/65 sm:block" />
          </div>
        </div>

        <div
          data-testid="timeline-workbench"
          className="min-h-0 flex-1 overflow-y-auto rounded-xl-v2 border border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 p-3 [-webkit-overflow-scrolling:touch]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Timeline</div>
              <div className="mt-0.5 text-[11px] text-Cr-text-subtler-v2">
                {segments.length ? `Total 00:${String(segments.length * 5).padStart(2, '0')} · ${segments.length} segments` : 'No segments yet'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="preview-segment-rerun"
                disabled={!selectedSegment || submitting}
                onClick={() => {
                  if (selectedStarterPreset) {
                    onRunPreset?.(selectedStarterPreset);
                  } else {
                    onAction('retry-agent', 'Rerun this selected segment with stronger continuity and keep it in the timeline.', selectedSegment);
                  }
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-3 text-xs font-semibold text-Cr-text-default-v2 disabled:text-Cr-text-subtlest-v2"
              >
                <RefreshCcw size={14} />
                Rerun
              </button>
              <button
                type="button"
                data-testid="preview-append-next-segment"
                disabled={submitting || (!selectedSegment && !selectedStarterPreset)}
                onClick={() => {
                  if (selectedStarterPreset) {
                    onRunPreset?.(selectedStarterPreset);
                  } else if (selectedSegment) {
                    onAction('extend', 'Extend this into the next shot', selectedSegment);
                  }
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md-v2 bg-dreamy-brand-hot-v2 px-3 text-xs font-semibold text-white disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
              >
                <Clapperboard size={14} />
                {selectedSegment ? 'Add segment' : 'Start now'}
              </button>
              <button
                type="button"
                data-testid="preview-export-all-segments"
                disabled={!segments.length || timelineExporting}
                onClick={onExportAllSegments}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-3 text-xs font-semibold text-Cr-text-default-v2 disabled:text-Cr-text-subtlest-v2"
              >
                {timelineExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            {segments.map((segment, index) => {
              const segmentMedia = getSegmentMedia(segment);
              const segmentFallback = fallbackVisualForDreamyBot(segment.botSlug, segment.botName);
              return (
                <button
                  key={segment.id}
                  type="button"
                  data-testid="timeline-segment-card"
                  onClick={() => onSelectSegment(segment.id)}
                  className={`relative h-[96px] w-[168px] shrink-0 overflow-hidden rounded-lg-v2 border text-left ${
                    segment.id === selectedSegment?.id
                      ? 'border-dreamy-brand-hot-v2 shadow-[0_0_0_1px_rgba(244,45,118,0.45)]'
                      : 'border-Cr-border-default-v2'
                  } bg-Cr-Bg-surface-default-v2`}
                  style={{
                    backgroundImage: segmentMedia ? undefined : `url(${segmentFallback})`,
                    backgroundPosition: 'center',
                    backgroundSize: 'cover',
                  }}
                >
                  {segmentMedia ? (
                    <img
                      src={segmentMedia}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                      className="h-full w-full object-cover opacity-90"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-Cr-Bg-surface-subtle-v2 text-Cr-text-subtler-v2">
                      <Film size={20} />
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-xs font-semibold text-white">{index + 1}</span>
                  <span className="absolute bottom-2 right-2 rounded bg-black/65 px-2 py-1 text-[11px] font-semibold text-white">5.0s</span>
                  <span className={`absolute bottom-2 left-2 rounded px-2 py-1 text-[10px] font-semibold ${
                    segment.status === 'done'
                      ? 'bg-Cr-text-success-default-v2/85 text-white'
                      : 'bg-dreamy-brand-hot-v2/85 text-white'
                  }`}>
                    {segment.status}
                  </span>
                </button>
              );
            })}
            {!segments.length && (
              <div className="flex h-[104px] min-w-[220px] items-center justify-center rounded-lg-v2 border border-dashed border-Cr-border-default-v2 text-xs text-Cr-text-subtler-v2">
                Start now to create segment 1
              </div>
            )}
          </div>

          <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-3 py-2 text-xs text-Cr-text-subtle-v2">
            <Clock3 size={14} className="shrink-0 text-dreamy-brand-hot-v2" />
            <span data-testid="video-fast-status" className="min-w-0 flex-1 truncate">
              {submitting
                ? 'Generating the next clip...'
                : segments.length
                  ? `Timeline cost: ${segments.length} short clip${segments.length === 1 ? '' : 's'} / ${segments.length * 5}s total.`
                  : 'Timeline cost appears after the first clip.'}
            </span>
            {selectedStarterPreset && (
              <span data-testid="selected-dreamy-bot-preview" className="hidden min-w-0 items-center gap-2 sm:inline-flex">
                <span data-testid="preview-selected-dreamy-bot" className="truncate font-semibold text-Cr-text-default-v2">
                  {selectedStarterPreset.title}
                </span>
              </span>
            )}
          </div>

          {latestTimelineExport && (
            <div
              data-testid="timeline-export-output-card"
              className="mt-3 grid gap-2 rounded-lg-v2 border border-dreamy-brand-hot-v2/35 bg-dreamy-brand-hot-v2/10 p-3 text-xs text-Cr-text-subtle-v2 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-Cr-text-default-v2">Long video output</span>
                  <Pill tone={latestTimelineExport.status === 'ready' ? 'success' : statusPillTone(latestTimelineExport.status)}>
                    {latestTimelineExport.status}
                  </Pill>
                  <Pill>{`${latestTimelineExport.summary.videoSegments} video clips`}</Pill>
                </div>
                <div className="mt-1 truncate text-Cr-text-subtler-v2">
                  {latestTimelineExport.evidence?.message || `${latestTimelineExport.summary.totalSegments} timeline segments packaged.`}
                </div>
                {latestTimelineMediaUrl && (
                  <a
                    href={latestTimelineMediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate font-semibold text-dreamy-brand-hot-v2"
                  >
                    <ExternalLink size={13} />
                    <span className="truncate">Open composed video</span>
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => downloadJsonPayload(latestTimelineExport, `dreamy-timeline-export-${latestTimelineExport.exportId}.json`)}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-3 font-semibold text-Cr-text-default-v2 active:bg-Cr-beta-white-12-v2"
              >
                <Download size={13} />
                Manifest
              </button>
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

function CanvasWorkspace({
  project,
  selectedSegment,
  selectedStarterPreset,
  allBotPresets,
  onSelectSegment,
  onDeleteSegment,
  onAction,
  onRunPreset,
  submitting,
}: {
  project: StudioProject | null;
  selectedSegment?: StudioSegment | null;
  selectedStarterPreset?: StudioStarterPreset | null;
  allBotPresets?: StudioStarterPreset[];
  onSelectSegment: (segmentId: string) => void;
  onDeleteSegment: (segmentId: string) => void;
  onAction: (action: StudioAction, prompt?: string, source?: StudioSegment | null) => void;
  onRunPreset?: (preset: StudioStarterPreset) => void;
  submitting: boolean;
}) {
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasFileInputRef = useRef<HTMLInputElement | null>(null);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [initialView] = useState(getInitialCanvasView);
  const [zoom, setZoom] = useState(initialView.zoom);
  const [pan, setPan] = useState(initialView.pan);
  const [activeBoardId, setActiveBoardId] = useState<CanvasBoardId>('timeline');
  const [activeFlowPresetId, setActiveFlowPresetId] = useState(CANVAS_FLOW_PRESETS[0]?.id || '');
  const [selectedNodeId, setSelectedNodeId] = useState(CANVAS_FLOW_PRESETS[0]?.nodes[0]?.id || 'prompt-root');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([CANVAS_FLOW_PRESETS[0]?.nodes[0]?.id || 'prompt-root']);
  const [canvasAction, setCanvasAction] = useState<StudioAction>('generate');
  const [canvasCommand, setCanvasCommand] = useState('');
  const [positionOverrides, setPositionOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [customNodes, setCustomNodes] = useState<CanvasNode[]>(() => CANVAS_FLOW_PRESETS[0]?.nodes.map((node) => ({ ...node })) || []);
  const [customConnections, setCustomConnections] = useState<CanvasConnection[]>(
    () => CANVAS_FLOW_PRESETS[0]?.connections.map((connection) => ({ ...connection })) || [],
  );
  const [history, setHistory] = useState<CanvasSnapshot[]>([]);
  const [future, setFuture] = useState<CanvasSnapshot[]>([]);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [connectFromNodeId, setConnectFromNodeId] = useState<string | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [spacePanning, setSpacePanning] = useState(false);
  const [showBotCatalog, setShowBotCatalog] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragState, setDragState] = useState<{
    id: string;
    clientX: number;
    clientY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [panState, setPanState] = useState<{
    clientX: number;
    clientY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const baseCanvas = useMemo(() => buildCanvasGraph(project, positionOverrides), [positionOverrides, project]);
  const selectedStarterNode = useMemo<CanvasNode | null>(() => {
    if (!selectedStarterPreset) return null;
    return {
      id: `selected-dreamy-bot-${selectedStarterPreset.id}`,
      kind: 'agent',
      title: `Selected Bot · ${selectedStarterPreset.title}`,
      subtitle: selectedStarterPreset.recommendation,
      x: 154,
      y: 52,
      width: 264,
      height: 138,
      status: 'ready',
      action: getStarterPresetAction(selectedStarterPreset, selectedSegment),
      prompt: selectedStarterPreset.prompt,
      botSlug: selectedStarterPreset.botSlug,
      botName: selectedStarterPreset.title,
      mediaUrl: selectedStarterPreset.visualUrl,
    };
  }, [selectedSegment, selectedStarterPreset]);
  const nodes = useMemo(
    () => (selectedStarterNode ? [selectedStarterNode, ...baseCanvas.nodes, ...customNodes] : [...baseCanvas.nodes, ...customNodes]),
    [baseCanvas.nodes, customNodes, selectedStarterNode],
  );
  const connections = useMemo(
    () => (
      selectedStarterNode
        ? [
            { id: `${selectedStarterNode.id}-to-prompt-root`, from: selectedStarterNode.id, to: 'prompt-root', label: 'selected bot' },
            ...baseCanvas.connections,
            ...customConnections,
          ]
        : [...baseCanvas.connections, ...customConnections]
    ),
    [baseCanvas.connections, customConnections, selectedStarterNode],
  );
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNode = nodeMap.get(selectedNodeId) || nodes[0] || null;
  const displaySegments = useMemo(() => getTimelineDisplaySegments(project?.segments || []), [project?.segments]);
  const selectedNodeSegment = selectedNode?.segmentId
    ? displaySegments.find((segment) => segment.id === selectedNode.segmentId) || null
    : selectedSegment || null;
  const isCustomSelected = Boolean(selectedNode && customNodes.some((node) => node.id === selectedNode.id));
  const activeFlowPreset = CANVAS_FLOW_PRESETS.find((preset) => preset.id === activeFlowPresetId) || CANVAS_FLOW_PRESETS[0];
  const activeSelectedNodeIds = selectedNodeIds.length ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : [];
  const boardNodes = useMemo(
    () => nodes.filter((node) => (node.boardId || getCanvasDefaultBoard(node.kind)) === activeBoardId),
    [activeBoardId, nodes],
  );
  const canUndo = history.length > 0;
  const canRedo = future.length > 0;
  const canvasBotCatalogPresets = allBotPresets?.length ? allBotPresets : DREAMY_STARTER_PRESETS;

  const createCanvasSnapshot = useCallback<() => CanvasSnapshot>(
    () => ({
      customNodes: customNodes.map((node) => ({ ...node })),
      customConnections: customConnections.map((connection) => ({ ...connection })),
      positionOverrides: { ...positionOverrides },
    }),
    [customConnections, customNodes, positionOverrides],
  );

  const restoreCanvasSnapshot = useCallback((snapshot: CanvasSnapshot) => {
    setCustomNodes(snapshot.customNodes.map((node) => ({ ...node })));
    setCustomConnections(snapshot.customConnections.map((connection) => ({ ...connection })));
    setPositionOverrides({ ...snapshot.positionOverrides });
  }, []);

  const commitCanvasSnapshot = useCallback(() => {
    const snapshot = createCanvasSnapshot();
    setHistory((prev) => [...prev.slice(-29), snapshot]);
    setFuture([]);
  }, [createCanvasSnapshot]);

  const undoCanvas = useCallback(() => {
    setHistory((prev) => {
      const snapshot = prev[prev.length - 1];
      if (!snapshot) return prev;
      setFuture((next) => [createCanvasSnapshot(), ...next].slice(0, 30));
      restoreCanvasSnapshot(snapshot);
      return prev.slice(0, -1);
    });
  }, [createCanvasSnapshot, restoreCanvasSnapshot]);

  const redoCanvas = useCallback(() => {
    setFuture((prev) => {
      const snapshot = prev[0];
      if (!snapshot) return prev;
      setHistory((next) => [...next.slice(-29), createCanvasSnapshot()]);
      restoreCanvasSnapshot(snapshot);
      return prev.slice(1);
    });
  }, [createCanvasSnapshot, restoreCanvasSnapshot]);

  const getCanvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasSurfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 480, y: 260 };
      return {
        x: Math.round((clientX - rect.left - pan.x) / zoom),
        y: Math.round((clientY - rect.top - pan.y) / zoom),
      };
    },
    [pan.x, pan.y, zoom],
  );

  useEffect(() => {
    if (nodes.length && !nodes.some((node) => node.id === selectedNodeId)) {
      const nextId = selectedSegment?.id ? `segment-${selectedSegment.id}` : nodes[0].id;
      const resolvedId = nodes.some((node) => node.id === nextId) ? nextId : nodes[0].id;
      setSelectedNodeId(resolvedId);
      setSelectedNodeIds([resolvedId]);
    }
  }, [nodes, selectedNodeId, selectedSegment?.id]);

  useEffect(() => {
    if (!selectedStarterNode) return;
    setSelectedNodeId(selectedStarterNode.id);
    setSelectedNodeIds([selectedStarterNode.id]);
    setCanvasAction(selectedStarterNode.action || 'generate');
    setCanvasCommand(selectedStarterNode.prompt || '');
  }, [selectedStarterNode?.id]);

  useEffect(() => {
    if (!selectedNode) return;
    setCanvasAction(selectedNode.action || (selectedNode.kind === 'segment' ? 'extend' : 'generate'));
    setCanvasCommand(selectedNode.prompt || '');
  }, [selectedNode?.id]);

  const selectCanvasNode = useCallback(
    (node: CanvasNode, additive = false) => {
      setSelectedNodeId(node.id);
      setSelectedNodeIds((prev) => {
        if (!additive) return [node.id];
        if (prev.includes(node.id)) {
          const next = prev.filter((id) => id !== node.id);
          return next.length ? next : [node.id];
        }
        return [...prev, node.id];
      });
      if (node.segmentId) onSelectSegment(node.segmentId);
    },
    [onSelectSegment],
  );

  const applyNodePosition = useCallback(
    (id: string, x: number, y: number) => {
      if (customNodes.some((node) => node.id === id)) {
        setCustomNodes((prev) => prev.map((node) => (node.id === id ? { ...node, x, y } : node)));
        return;
      }
      setPositionOverrides((prev) => ({ ...prev, [id]: { x, y } }));
    },
    [customNodes],
  );

  useEffect(() => {
    if (!dragState && !panState) return;

    const handleMove = (event: PointerEvent) => {
      if (dragState) {
        const x = dragState.originX + (event.clientX - dragState.clientX) / zoom;
        const y = dragState.originY + (event.clientY - dragState.clientY) / zoom;
        applyNodePosition(dragState.id, Math.round(x), Math.round(y));
      }
      if (panState) {
        setPan({
          x: panState.originX + event.clientX - panState.clientX,
          y: panState.originY + event.clientY - panState.clientY,
        });
      }
    };

    const handleUp = () => {
      setDragState(null);
      setPanState(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = dragState ? 'grabbing' : 'grab';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [applyNodePosition, dragState, panState, zoom]);

  const connectCanvasNodes = useCallback(
    (fromId: string, toId: string, label = 'route') => {
      if (!fromId || !toId || fromId === toId) return;
      if (connections.some((connection) => connection.from === fromId && connection.to === toId)) {
        setConnectFromNodeId(null);
        setTool('select');
        return;
      }
      commitCanvasSnapshot();
      setCustomConnections((prev) => [
        ...prev,
        {
          id: `${fromId}-to-${toId}-${Date.now()}`,
          from: fromId,
          to: toId,
          label,
          sourceHandle: 'out',
          targetHandle: 'in',
        },
      ]);
      setConnectFromNodeId(null);
      setTool('select');
    },
    [commitCanvasSnapshot, connections],
  );

  const addCanvasNode = useCallback(
    (
      kind: CanvasNodeKind,
      point?: { x: number; y: number },
      options: { linkFromSelected?: boolean; overrides?: Partial<CanvasNode> } = {},
    ) => {
      const anchor = selectedNode || nodes[nodes.length - 1];
      const libraryItem = getCanvasNodeLibraryItem(kind);
      const sourceType = options.overrides?.sourceType || libraryItem?.sourceType || getCanvasNodeMediaMode(kind);
      const id = options.overrides?.id || makeId(`canvas_${kind.replace(/[^a-z0-9]+/gi, '_')}`);
      const x = point?.x ?? (anchor?.x || 480) + 270;
      const y = point?.y ?? (anchor?.y || 180) + (kind === 'agent' || kind.startsWith('ai-') ? 26 : 132);
      const node: CanvasNode = {
        id,
        kind,
        title: options.overrides?.title || libraryItem?.title || (kind === 'segment' ? 'Draft Segment' : 'Custom Agent'),
        subtitle:
          options.overrides?.subtitle ||
          libraryItem?.subtitle ||
          (kind === 'segment' ? 'Staged media slot' : 'Manual chain step'),
        x,
        y,
        width: options.overrides?.width || libraryItem?.width || (kind === 'agent' ? 228 : 252),
        height: options.overrides?.height || libraryItem?.height || (kind === 'agent' ? 104 : 122),
        status: options.overrides?.status || 'idle',
        action:
          options.overrides?.action ||
          libraryItem?.action ||
          (kind === 'segment' ? 'generate' : kind === 'ai-video' ? 'extend' : undefined),
        prompt: (options.overrides?.prompt ?? canvasCommand) || anchor?.prompt || '',
        botName:
          options.overrides?.botName ||
          (kind === 'agent'
            ? 'Unassigned agent'
            : kind === 'ai-video'
              ? '3D Futa Porn'
              : kind === 'ai-image'
                ? '3D Anime Porn'
                : 'Dreamy canvas'),
        botSlug: options.overrides?.botSlug || libraryItem?.botSlug || (kind === 'agent' ? 'manual-agent' : DEFAULT_DREAMY_SLUG),
        sourceType,
        fileName: options.overrides?.fileName,
        mediaUrl: options.overrides?.mediaUrl,
        outputText: options.overrides?.outputText,
        boardId: options.overrides?.boardId || activeBoardId || getCanvasDefaultBoard(kind),
      };
      commitCanvasSnapshot();
      setCustomNodes((prev) => [...prev, node]);
      if (anchor && options.linkFromSelected !== false) {
        const label = kind.startsWith('source-') ? 'source' : kind.startsWith('ai-') ? 'input' : 'manual';
        setCustomConnections((prev) => [
          ...prev,
          { id: `${anchor.id}-to-${id}`, from: anchor.id, to: id, label, sourceHandle: 'out', targetHandle: 'in' },
        ]);
      }
      setSelectedNodeId(id);
      setSelectedNodeIds([id]);
      setContextMenu(null);
    },
    [activeBoardId, canvasCommand, commitCanvasSnapshot, nodes, selectedNode],
  );

  const handleNodePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    if (tool === 'connect') {
      if (connectFromNodeId && connectFromNodeId !== node.id) {
        connectCanvasNodes(connectFromNodeId, node.id);
      } else {
        setConnectFromNodeId(node.id);
      }
      selectCanvasNode(node, event.shiftKey);
      return;
    }
    if (tool !== 'select') return;
    selectCanvasNode(node, event.shiftKey);
    commitCanvasSnapshot();
    setDragState({
      id: node.id,
      clientX: event.clientX,
      clientY: event.clientY,
      originX: node.x,
      originY: node.y,
    });
  };

  const handleSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    setContextMenu(null);
    if (tool === 'connect') {
      setConnectFromNodeId(null);
      return;
    }
    if (tool !== 'pan' && event.button !== 1 && !spacePanning) return;
    event.preventDefault();
    setPanState({
      clientX: event.clientX,
      clientY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    });
  };

  const applyFlowPreset = (preset: CanvasFlowPreset) => {
    commitCanvasSnapshot();
    setActiveFlowPresetId(preset.id);
    setCustomNodes(preset.nodes.map((node) => ({ ...node })));
    setCustomConnections(preset.connections.map((connection) => ({ ...connection })));
    setCanvasAction(preset.action);
    setCanvasCommand(preset.prompt);
    setSelectedNodeId(preset.nodes[0]?.id || 'prompt-root');
    setSelectedNodeIds([preset.nodes[0]?.id || 'prompt-root']);
    setPositionOverrides({});
  };

  const duplicateSelected = () => {
    if (!selectedNode) return;
    commitCanvasSnapshot();
    const id = makeId(`copy_${selectedNode.kind}`);
    const copy: CanvasNode = {
      ...selectedNode,
      id,
      title: `${selectedNode.title} copy`,
      x: selectedNode.x + 36,
      y: selectedNode.y + 36,
      segmentId: undefined,
      agentId: undefined,
      status: 'idle',
    };
    setCustomNodes((prev) => [...prev, copy]);
    setCustomConnections((prev) => [...prev, { id: `${selectedNode.id}-to-${id}`, from: selectedNode.id, to: id, label: 'copy' }]);
    setSelectedNodeId(id);
    setSelectedNodeIds([id]);
  };

  const deleteSelected = () => {
    if (!selectedNode || selectedNode.id === 'prompt-root' || selectedNode.id === 'timeline-output') return;
    const protectedIds = new Set(['prompt-root', 'timeline-output', selectedStarterNode?.id].filter(Boolean) as string[]);
    const idsToDelete = (activeSelectedNodeIds.length ? activeSelectedNodeIds : [selectedNode.id]).filter((id) => !protectedIds.has(id));
    if (!idsToDelete.length) return;
    commitCanvasSnapshot();
    idsToDelete.forEach((id) => {
      const node = nodeMap.get(id);
      if (node?.segmentId && !customNodes.some((customNode) => customNode.id === id)) {
        onDeleteSegment(node.segmentId);
      }
    });
    setCustomNodes((prev) => prev.filter((node) => !idsToDelete.includes(node.id)));
    setCustomConnections((prev) => prev.filter((connection) => !idsToDelete.includes(connection.from) && !idsToDelete.includes(connection.to)));
    setSelectedNodeId('prompt-root');
    setSelectedNodeIds(['prompt-root']);
  };

  const resolveCanvasCommand = useCallback(
    (value: string) => {
      const withoutSlashPreset = value.replace(/^\/[a-z-]+\s*/i, '');
      return withoutSlashPreset.replace(/@([a-zA-Z0-9:_-]+)/g, (_match, id: string) => {
        const node = nodeMap.get(id);
        if (!node) return `@${id}`;
        return [node.title, node.prompt || node.outputText || node.subtitle].filter(Boolean).join(': ');
      });
    },
    [nodeMap],
  );

  const runSelected = () => {
    if (selectedStarterPreset && selectedNode?.id === selectedStarterNode?.id) {
      onRunPreset?.(selectedStarterPreset);
      return;
    }
    const promptText =
      resolveCanvasCommand(canvasCommand.trim()) || selectedNode?.prompt || `Run ${selectedNode?.title || 'selected node'}`;
    onAction(canvasAction, promptText, selectedNodeSegment);
  };

  const canvasStateJson = () =>
    JSON.stringify(
      {
        projectId: project?.projectId || null,
        selectedNodeId,
        viewport: { zoom, pan },
        nodes,
        connections,
      },
      null,
      2,
    );

  const copyJson = async () => {
    await navigator.clipboard?.writeText(canvasStateJson()).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const downloadJson = () => {
    downloadJsonText(canvasStateJson(), `${project?.projectId || 'dreamy-canvas'}.json`);
  };

  const resetView = () => {
    const nextView = getInitialCanvasView();
    setZoom(nextView.zoom);
    setPan(nextView.pan);
  };

  const commandTail = canvasCommand.trimEnd();
  const showReferenceMenu = commandTail.endsWith('@');
  const showPresetMenu = commandTail.endsWith('/');
  const referenceNodes = nodes.filter((node) => node.id !== selectedNode?.id).slice(0, 6);
  const insertCanvasCommandToken = (token: string) => {
    setCanvasCommand((prev) => {
      const trimmed = prev.trimEnd();
      const withoutTrigger = trimmed.endsWith('@') || trimmed.endsWith('/') ? trimmed.slice(0, -1).trimEnd() : trimmed;
      return `${withoutTrigger}${withoutTrigger ? ' ' : ''}${token} `;
    });
  };

  const importCanvasState = useCallback(
    (rawJson: string, point?: { x: number; y: number }) => {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const readRecord = (value: unknown): Record<string, unknown> =>
        value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      const readArrayOrObject = (value: unknown): Record<string, unknown>[] => {
        if (Array.isArray(value)) return value.map(readRecord);
        if (value && typeof value === 'object') {
          return Object.entries(value as Record<string, unknown>).map(([id, item]) => ({ id, ...readRecord(item) }));
        }
        return [];
      };
      const numeric = (value: unknown, fallback: number) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      };

      const rawNodes = readArrayOrObject(parsed.customNodes || parsed.nodes);
      const rawConnections = readArrayOrObject(parsed.customConnections || parsed.connections || parsed.edges);
      const basePoint = point || getCanvasPoint((canvasSurfaceRef.current?.getBoundingClientRect().left || 0) + 420, 260);
      const existingIds = new Set(nodes.map((node) => node.id));
      const importedIdMap = new Map<string, string>();
      const protectedImportIds = new Set(['prompt-root', 'timeline-output']);
      const importedNodes: CanvasNode[] = rawNodes
        .map((rawNode, index) => {
          const sourceId = String(rawNode.id || rawNode.nodeId || rawNode.key || `imported-${index}`);
          if (
            protectedImportIds.has(sourceId) ||
            sourceId.startsWith('agent-') ||
            sourceId.startsWith('segment-') ||
            sourceId.startsWith('selected-dreamy-bot')
          ) {
            return null;
          }
          const kind = normalizeCanvasNodeKind(rawNode.kind || rawNode.type || rawNode.nodeType);
          const libraryItem = getCanvasNodeLibraryItem(kind);
          const id = existingIds.has(sourceId) ? makeId(`import_${sourceId.replace(/[^a-z0-9]+/gi, '_')}`) : sourceId;
          importedIdMap.set(sourceId, id);
          existingIds.add(id);
          const position = readRecord(rawNode.position);
          const data = readRecord(rawNode.data);
          const sourceType =
            (String(rawNode.sourceType || data.sourceType || '').toLowerCase() as CanvasSourceType) ||
            getCanvasNodeMediaMode(kind) ||
            libraryItem?.sourceType;
          return {
            id,
            kind,
            title: String(rawNode.title || rawNode.name || data.title || data.name || libraryItem?.title || 'Imported Node'),
            subtitle: String(
              rawNode.subtitle ||
                rawNode.description ||
                data.subtitle ||
                data.description ||
                rawNode.prompt ||
                data.prompt ||
                libraryItem?.subtitle ||
                'Imported from canvas JSON',
            ),
            x: numeric(rawNode.x ?? position.x, basePoint.x + index * 34),
            y: numeric(rawNode.y ?? position.y, basePoint.y + index * 34),
            width: numeric(rawNode.width, libraryItem?.width || 244),
            height: numeric(rawNode.height, libraryItem?.height || 120),
            status: String(rawNode.status || data.status || 'imported'),
            action: (rawNode.action || data.action || libraryItem?.action) as StudioAction | undefined,
            prompt: String(rawNode.prompt || data.prompt || rawNode.text || data.text || ''),
            botSlug: String(rawNode.botSlug || data.botSlug || libraryItem?.botSlug || DEFAULT_DREAMY_SLUG),
            botName: String(rawNode.botName || data.botName || ''),
            mediaUrl: String(rawNode.mediaUrl || rawNode.url || data.mediaUrl || data.url || rawNode.thumbnail || ''),
            outputText: String(rawNode.outputText || data.outputText || rawNode.text || data.text || ''),
            fileName: String(rawNode.fileName || data.fileName || ''),
            sourceType,
            boardId: activeBoardId,
          } satisfies CanvasNode;
        })
        .filter(Boolean) as CanvasNode[];

      const importedConnections: CanvasConnection[] = rawConnections
        .map((rawConnection, index) => {
          const source = String(rawConnection.from || rawConnection.source || rawConnection.sourceId || rawConnection.start || '');
          const target = String(rawConnection.to || rawConnection.target || rawConnection.targetId || rawConnection.end || '');
          const from = importedIdMap.get(source) || source;
          const to = importedIdMap.get(target) || target;
          if (!from || !to || from === to || !existingIds.has(from) || !existingIds.has(to)) return null;
          return {
            id: String(rawConnection.id || `${from}-to-${to}-import-${index}`),
            from,
            to,
            label: String(rawConnection.label || rawConnection.type || 'import'),
            sourceHandle: String(rawConnection.sourceHandle || 'out'),
            targetHandle: String(rawConnection.targetHandle || 'in'),
          };
        })
        .filter(Boolean) as CanvasConnection[];

      if (!importedNodes.length && !importedConnections.length) return;
      commitCanvasSnapshot();
      setCustomNodes((prev) => [...prev, ...importedNodes]);
      setCustomConnections((prev) => [...prev, ...importedConnections]);
      if (importedNodes[0]) {
        setSelectedNodeId(importedNodes[0].id);
        setSelectedNodeIds([importedNodes[0].id]);
      }
    },
    [activeBoardId, commitCanvasSnapshot, getCanvasPoint, nodes],
  );

  const handleCanvasWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = canvasSurfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextZoom = clamp(zoom - event.deltaY * 0.001, 0.35, 1.8);
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const canvasX = (cursorX - pan.x) / zoom;
    const canvasY = (cursorY - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({
      x: Math.round(cursorX - canvasX * nextZoom),
      y: Math.round(cursorY - canvasY * nextZoom),
    });
  };

  const handleCanvasDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-canvas-node="true"], [data-canvas-floating="true"]')) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    addCanvasNode(activeBoardId === 'timeline' ? 'ai-video' : 'ai-image', point, { linkFromSelected: Boolean(selectedNode) });
  };

  const handleCanvasContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-canvas-floating="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getCanvasPoint(event.clientX, event.clientY);
    setContextMenu({ screenX: event.clientX, screenY: event.clientY, canvasX: point.x, canvasY: point.y });
  };

  const handleCanvasDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(false);
    const point = getCanvasPoint(event.clientX, event.clientY);
    const files = Array.from(event.dataTransfer.files || []);
    for (const [index, file] of files.entries()) {
      const dropPoint = { x: point.x + index * 36, y: point.y + index * 36 };
      if (file.name.toLowerCase().endsWith('.json')) {
        try {
          importCanvasState(await file.text(), dropPoint);
        } catch {
          addCanvasNode('annotation', dropPoint, {
            linkFromSelected: false,
            overrides: {
              title: 'JSON import failed',
              subtitle: file.name,
              outputText: 'The dropped JSON could not be parsed as a canvas project.',
            },
          });
        }
        continue;
      }
      const mime = file.type || '';
      const isImage = mime.startsWith('image/');
      const isVideo = mime.startsWith('video/');
      const isAudio = mime.startsWith('audio/');
      const kind: CanvasNodeKind = isImage ? 'source-image' : isVideo ? 'source-video' : isAudio ? 'source-audio' : 'source-text';
      const outputText = kind === 'source-text' ? (await file.text().catch(() => '')).slice(0, 1200) : '';
      addCanvasNode(kind, dropPoint, {
        linkFromSelected: false,
        overrides: {
          title: file.name.replace(/\.[^.]+$/, '') || file.name,
          subtitle: `${mime || 'file'} · ${(file.size / 1024).toFixed(1)} KB`,
          fileName: file.name,
          mediaUrl: kind === 'source-text' ? '' : URL.createObjectURL(file),
          outputText,
          prompt: outputText.slice(0, 360),
          sourceType: getCanvasNodeMediaMode(kind),
        },
      });
    }
  };

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      if (!element) return false;
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setSpacePanning(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        downloadJson();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoCanvas();
        else undoCanvas();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoCanvas();
      }
      if (event.key.toLowerCase() === 'd' || event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        resetView();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePanning(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [deleteSelected, redoCanvas, undoCanvas]);

  const renderConnection = (connection: CanvasConnection) => {
    const from = nodeMap.get(connection.from);
    const to = nodeMap.get(connection.to);
    if (!from || !to) return null;
    const startX = from.x + from.width;
    const startY = from.y + from.height / 2;
    const endX = to.x;
    const endY = to.y + to.height / 2;
    const handle = Math.max(70, Math.abs(endX - startX) * 0.45);
    const path = `M ${startX} ${startY} C ${startX + handle} ${startY}, ${endX - handle} ${endY}, ${endX} ${endY}`;
    const active = activeSelectedNodeIds.includes(from.id) || activeSelectedNodeIds.includes(to.id);
    const accent =
      connection.label === 'fallback'
        ? '#8b949e'
        : connection.label === 'primary'
          ? '#f31272'
          : connection.label === 'route'
            ? '#14b8d4'
            : connection.label === 'source'
              ? '#a855f7'
            : '#22c55e';

    return (
      <g key={connection.id}>
        <path
          d={path}
          fill="none"
          stroke={active ? accent : 'rgba(148, 163, 184, 0.36)'}
          strokeWidth={active ? 2.4 : 1.5}
          strokeLinecap="round"
          strokeDasharray={connection.label === 'fallback' ? '6 5' : undefined}
        />
        {connection.label && (
          <text
            x={(startX + endX) / 2}
            y={(startY + endY) / 2 - 8}
            fill={active ? '#f8a6ca' : 'rgba(203, 213, 225, 0.62)'}
            fontSize="11"
            fontWeight="600"
          >
            {connection.label}
          </text>
        )}
      </g>
    );
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#090a0f] text-Cr-text-default-v2">
      <div className="hidden h-11 shrink-0 items-center justify-between border-b border-white/10 bg-[#101118] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md-v2 bg-dreamy-brand-hot-v2/15 text-dreamy-brand-hot-v2">
            <Link2 size={16} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Canvas orchestration</div>
            <div className="truncate text-[11px] text-Cr-text-subtler-v2">
              {nodes.length} nodes / {connections.length} routes
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copyJson}
            className="hidden h-8 items-center gap-1.5 rounded-md-v2 border border-white/10 bg-white/5 px-2 text-xs font-semibold text-Cr-text-subtle-v2 active:bg-white/10 sm:inline-flex"
          >
            <Copy size={14} />
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
          <button
            type="button"
            onClick={downloadJson}
            className="flex h-8 items-center gap-1.5 rounded-md-v2 border border-white/10 bg-white/5 px-2 text-xs font-semibold text-Cr-text-subtle-v2 active:bg-white/10"
          >
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      <div className="relative min-h-[560px] flex-1 overflow-hidden xl:min-h-0">
        <aside
          data-testid="ai-canvas-left-drawer"
          className={`absolute inset-y-3 left-3 z-40 w-[min(360px,calc(100%-24px))] min-h-0 flex-col overflow-hidden rounded-lg-v2 border border-white/10 bg-[#111219]/98 shadow-2xl backdrop-blur ${
            leftPanelOpen ? 'flex' : 'hidden'
          }`}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
            <div>
              <div className="text-sm font-semibold text-Cr-text-default-v2">Canvas Inputs</div>
              <div className="text-[11px] text-Cr-text-subtler-v2">{boardNodes.length} visible in {activeBoardId}</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowBotCatalog(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md-v2 bg-white/[0.06] px-2 text-[11px] font-semibold active:bg-white/10"
              >
                <Bot size={13} />
                Bots
              </button>
              <button type="button" onClick={() => addCanvasNode('agent')} className="flex h-8 w-8 items-center justify-center rounded-md-v2 bg-white/[0.06]">
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={() => setLeftPanelOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md-v2 bg-white/[0.06] active:bg-white/10"
                aria-label="Close canvas inputs"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {selectedStarterPreset && (
            <div
              data-testid="canvas-selected-dreamy-bot"
              className="m-3 mb-0 grid gap-2 rounded-md-v2 border border-dreamy-brand-hot-v2/40 bg-dreamy-brand-hot-v2/10 p-3"
            >
              <button
                type="button"
                onClick={() => {
                  if (selectedStarterNode) selectCanvasNode(selectedStarterNode);
                  setCanvasCommand(selectedStarterPreset.prompt);
                  setCanvasAction(getStarterPresetAction(selectedStarterPreset, selectedSegment));
                }}
                className="grid grid-cols-[56px_minmax(0,1fr)] gap-2 text-left"
              >
                <span className="relative h-14 overflow-hidden rounded-md-v2 bg-black/30">
                  {selectedStarterPreset.visualUrl ? (
                    <img src={selectedStarterPreset.visualUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="grid h-full place-items-center text-Cr-text-subtler-v2">
                      <Bot size={18} />
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-Cr-text-default-v2">{selectedStarterPreset.title}</span>
                  <span className="mt-1 block truncate text-[11px] text-Cr-text-subtler-v2">{selectedStarterPreset.workflow}</span>
                  <span className="mt-1 block truncate text-[10px] font-semibold text-Cr-text-subtlest-v2">{selectedStarterPreset.botSlug}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRunPreset?.(selectedStarterPreset)}
                disabled={submitting}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md-v2 bg-dreamy-brand-hot-v2 px-2 text-[11px] font-semibold text-white disabled:bg-white/[0.06] disabled:text-Cr-text-subtlest-v2"
              >
                <Clapperboard size={12} />
                {getStarterPresetRunLabel(selectedStarterPreset, selectedSegment)}
              </button>
            </div>
          )}
          <div className="mx-4 my-3 flex h-10 shrink-0 items-center gap-2 rounded-md-v2 border border-white/10 bg-black/20 px-3 text-xs text-Cr-text-subtlest-v2">
            <SlidersHorizontal size={14} />
            <span>Search layers...</span>
            <span className="ml-auto">Cmd K</span>
          </div>
          <div data-testid="ai-canvas-board-tabs" className="mx-4 mb-3 grid grid-cols-3 gap-1 rounded-md-v2 border border-white/10 bg-black/20 p-1">
            {CANVAS_BOARDS.map((board) => (
              <button
                key={board.id}
                type="button"
                onClick={() => setActiveBoardId(board.id)}
                className={`h-8 rounded-md-v2 text-[11px] font-semibold ${
                  activeBoardId === board.id ? 'bg-dreamy-brand-hot-v2 text-white' : 'text-Cr-text-subtler-v2 active:bg-white/[0.08]'
                }`}
              >
                {board.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold text-Cr-text-subtler-v2">
              <span>{CANVAS_BOARDS.find((board) => board.id === activeBoardId)?.label || 'Canvas'} Nodes</span>
              <span>{boardNodes.length}/{nodes.length}</span>
            </div>
            {boardNodes.map((node) => {
              const Icon = getCanvasNodeIcon(node.kind);
              const active = activeSelectedNodeIds.includes(node.id);
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => selectCanvasNode(node)}
                  className={`mb-1 flex w-full min-w-0 items-center gap-2 rounded-md-v2 px-2 py-2 text-left text-xs transition-colors ${
                    active ? 'bg-dreamy-brand-hot-v2/15 text-Cr-text-default-v2' : 'text-Cr-text-subtler-v2 active:bg-white/[0.06]'
                  }`}
                >
                  <Icon size={14} className="shrink-0 text-dreamy-brand-hot-v2" />
                  <span className="min-w-0 flex-1 truncate">{node.title}</span>
                  <span className={`shrink-0 text-[10px] ${statusTone(node.status)}`}>{node.status || 'idle'}</span>
                </button>
              );
            })}
          </div>
          <div className="m-4 mt-0 rounded-md-v2 border border-white/10 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold">
              <span>Mini Map</span>
              <Maximize2 size={13} className="text-Cr-text-subtlest-v2" />
            </div>
            <div className="relative h-36 overflow-hidden rounded-md-v2 border border-white/10 bg-[#0d0e13]">
              {nodes.map((node) => (
                <span
                  key={`mini-${node.id}`}
                  className={`absolute rounded-sm border ${
                    selectedNodeId === node.id ? 'border-dreamy-brand-hot-v2 bg-dreamy-brand-hot-v2/30' : 'border-white/20 bg-white/10'
                  }`}
                  style={{
                    left: `${clamp((node.x / 1200) * 100, 2, 92)}%`,
                    top: `${clamp((node.y / 900) * 100, 2, 90)}%`,
                    width: `${clamp((node.width / 1200) * 100, 6, 26)}%`,
                    height: `${clamp((node.height / 900) * 100, 5, 18)}%`,
                  }}
                />
              ))}
            </div>
          </div>
        </aside>

        <div className="absolute inset-0 overflow-hidden">
          <input
            ref={canvasFileInputRef}
            type="file"
            className="hidden"
            multiple
            accept="image/*,video/*,audio/*,.txt,.md,.json"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              const rect = canvasSurfaceRef.current?.getBoundingClientRect();
              if (!files.length || !rect) return;
              const syntheticPoint = getCanvasPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              void Promise.all(
                files.map(async (file, index) => {
                  const point = { x: syntheticPoint.x + index * 36, y: syntheticPoint.y + index * 36 };
                  if (file.name.toLowerCase().endsWith('.json')) {
                    importCanvasState(await file.text(), point);
                    return;
                  }
                  const mime = file.type || '';
                  const kind: CanvasNodeKind = mime.startsWith('image/')
                    ? 'source-image'
                    : mime.startsWith('video/')
                      ? 'source-video'
                      : mime.startsWith('audio/')
                        ? 'source-audio'
                        : 'source-text';
                  const outputText = kind === 'source-text' ? (await file.text().catch(() => '')).slice(0, 1200) : '';
                  addCanvasNode(kind, point, {
                    linkFromSelected: false,
                    overrides: {
                      title: file.name.replace(/\.[^.]+$/, '') || file.name,
                      subtitle: `${mime || 'file'} · ${(file.size / 1024).toFixed(1)} KB`,
                      fileName: file.name,
                      mediaUrl: kind === 'source-text' ? '' : URL.createObjectURL(file),
                      outputText,
                      prompt: outputText.slice(0, 360),
                      sourceType: getCanvasNodeMediaMode(kind),
                    },
                  });
                }),
              );
              event.target.value = '';
            }}
          />
          <div data-canvas-floating="true" className="absolute left-4 top-4 z-30 flex items-center gap-1 rounded-md-v2 border border-white/10 bg-[#171821]/90 p-1 shadow-xl">
            <button
              type="button"
              data-testid="ai-canvas-open-inputs"
              onClick={() => setLeftPanelOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md-v2 bg-white/[0.06] px-2 text-xs font-semibold text-Cr-text-subtle-v2 active:bg-white/[0.1]"
            >
              <PanelRightOpen size={15} className="rotate-180" />
              Inputs
            </button>
            <button
              type="button"
              onClick={() => setShowBotCatalog(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md-v2 bg-white/[0.06] px-2 text-xs font-semibold text-Cr-text-subtle-v2 active:bg-white/[0.1]"
            >
              <Bot size={15} />
              Bots
            </button>
          </div>

          <div data-canvas-floating="true" className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md-v2 border border-white/10 bg-[#171821]/90 p-1 shadow-xl">
            <button
              type="button"
              onClick={() => setTool('select')}
              className={`flex h-9 w-9 items-center justify-center rounded-md-v2 ${tool === 'select' ? 'bg-dreamy-brand-hot-v2 text-white' : 'text-Cr-text-subtler-v2 active:bg-white/[0.08]'}`}
              aria-label="Select nodes"
            >
              <MousePointer2 size={17} />
            </button>
            <button
              type="button"
              onClick={() => setTool('pan')}
              className={`flex h-9 w-9 items-center justify-center rounded-md-v2 ${tool === 'pan' ? 'bg-dreamy-brand-hot-v2 text-white' : 'text-Cr-text-subtler-v2 active:bg-white/[0.08]'}`}
              aria-label="Pan canvas"
            >
              <Hand size={17} />
            </button>
            <button
              type="button"
              data-testid="ai-canvas-connect-mode"
              onClick={() => {
                setTool('connect');
                setConnectFromNodeId(selectedNode?.id || null);
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-md-v2 ${tool === 'connect' ? 'bg-dreamy-brand-hot-v2 text-white' : 'text-Cr-text-subtler-v2 active:bg-white/[0.08]'}`}
              aria-label="Connect nodes"
            >
              <Link2 size={17} />
            </button>
            <div className="mx-1 h-6 w-px bg-white/10" />
            <button type="button" onClick={() => addCanvasNode('agent')} className="flex h-9 w-9 items-center justify-center rounded-md-v2 text-Cr-text-subtler-v2 active:bg-white/[0.08]" aria-label="Add agent">
              <Bot size={17} />
            </button>
            <button type="button" onClick={() => addCanvasNode('segment')} className="flex h-9 w-9 items-center justify-center rounded-md-v2 text-Cr-text-subtler-v2 active:bg-white/[0.08]" aria-label="Add segment">
              <Film size={17} />
            </button>
            <button type="button" onClick={() => addCanvasNode('source-image')} className="flex h-9 w-9 items-center justify-center rounded-md-v2 text-Cr-text-subtler-v2 active:bg-white/[0.08]" aria-label="Add source image">
              <ImagePlus size={17} />
            </button>
            <button type="button" onClick={() => canvasFileInputRef.current?.click()} className="flex h-9 w-9 items-center justify-center rounded-md-v2 text-Cr-text-subtler-v2 active:bg-white/[0.08]" aria-label="Import file">
              <Download size={17} className="rotate-180" />
            </button>
          </div>

          <div data-canvas-floating="true" className="absolute right-4 top-4 z-30 flex items-center gap-1 rounded-md-v2 border border-white/10 bg-[#171821]/90 p-1 shadow-xl">
            <button
              type="button"
              data-testid="ai-canvas-open-inspector"
              onClick={() => setInspectorOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md-v2 bg-white/[0.06] px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 active:bg-white/10"
            >
              <SlidersHorizontal size={13} />
              Inspector
            </button>
            <button
              type="button"
              onClick={undoCanvas}
              disabled={!canUndo}
              className="flex h-8 w-8 items-center justify-center rounded-md-v2 text-Cr-text-subtler-v2 active:bg-white/[0.08] disabled:opacity-35"
              aria-label="Undo canvas"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              onClick={redoCanvas}
              disabled={!canRedo}
              className="flex h-8 w-8 items-center justify-center rounded-md-v2 text-Cr-text-subtler-v2 active:bg-white/[0.08] disabled:opacity-35"
              aria-label="Redo canvas"
            >
              <RefreshCcw size={14} />
            </button>
            <button
              type="button"
              onClick={downloadJson}
              className="inline-flex h-8 items-center gap-1.5 rounded-md-v2 bg-white/[0.06] px-2 text-[11px] font-semibold active:bg-white/10"
            >
              <Download size={13} />
              JSON
            </button>
          </div>

          <div
            ref={canvasSurfaceRef}
            data-testid="ai-canvas-surface"
            className={`absolute inset-0 cursor-grab overflow-hidden bg-[#0d0e13] active:cursor-grabbing ${isDropActive ? 'ring-2 ring-inset ring-dreamy-brand-hot-v2' : ''}`}
            onPointerDown={handleSurfacePointerDown}
            onWheel={handleCanvasWheel}
            onDoubleClick={handleCanvasDoubleClick}
            onContextMenu={handleCanvasContextMenu}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDropActive(true);
            }}
            onDragLeave={() => setIsDropActive(false)}
            onDrop={handleCanvasDrop}
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.11) 1px, transparent 0)',
              backgroundSize: '24px 24px',
            }}
          >
            <div
              className="absolute left-0 top-0 h-[860px] w-[1420px]"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
            >
              <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1420 860" aria-hidden="true">
                {connections.map(renderConnection)}
              </svg>

              {nodes.map((node) => {
                const Icon = getCanvasNodeIcon(node.kind);
                const active = activeSelectedNodeIds.includes(node.id);
                return (
                  <button
                    key={node.id}
                    type="button"
                    data-canvas-node="true"
                    onPointerDown={(event) => handleNodePointerDown(event, node)}
                    onClick={(event) => selectCanvasNode(node, event.shiftKey)}
                    className={`absolute overflow-hidden rounded-md-v2 border text-left shadow-2xl transition-colors ${
                      active
                        ? 'border-dreamy-brand-hot-v2 bg-[#1d1722] shadow-dreamy-brand-hot-v2/20'
                        : 'border-white/10 bg-[#171821] active:border-white/25'
                    }`}
                    style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                  >
                    <span
                      className={`absolute -left-1 top-1/2 z-10 h-4 w-4 -translate-y-1/2 rounded-full border border-white/20 ${
                        tool === 'connect' && connectFromNodeId && connectFromNodeId !== node.id
                          ? 'bg-dreamy-brand-hot-v2'
                          : 'bg-[#0d0e13]'
                      }`}
                    />
                    <span
                      className={`absolute -right-1 top-1/2 z-10 h-4 w-4 -translate-y-1/2 rounded-full border border-white/20 ${
                        connectFromNodeId === node.id ? 'bg-dreamy-brand-hot-v2' : 'bg-[#0d0e13]'
                      }`}
                    />
                    <div className="flex h-full">
                      {node.mediaUrl && (
                        <div className="h-full w-[86px] shrink-0 bg-black/30">
                          {node.sourceType === 'video' ? (
                            <video src={node.mediaUrl} muted playsInline className="h-full w-full object-contain opacity-80" />
                          ) : node.sourceType === 'audio' ? (
                            <div className="grid h-full place-items-center text-dreamy-brand-hot-v2">
                              <Play size={20} />
                            </div>
                          ) : (
                            <img src={node.mediaUrl} alt="" className="h-full w-full object-contain opacity-80" />
                          )}
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md-v2 bg-white/[0.08] text-dreamy-brand-hot-v2">
                              <Icon size={15} />
                            </span>
                            <span className="truncate text-xs font-semibold">{node.title}</span>
                          </div>
                          <span className={`text-[10px] font-semibold ${statusTone(node.status)}`}>{node.status || 'idle'}</span>
                        </div>
                        <div className="line-clamp-2 text-[11px] leading-4 text-Cr-text-subtler-v2">{node.subtitle}</div>
                        {!node.mediaUrl && node.outputText && (
                          <div className="mt-2 line-clamp-2 rounded-md-v2 bg-black/20 px-2 py-1 text-[10px] leading-4 text-Cr-text-subtlest-v2">
                            {node.outputText}
                          </div>
                        )}
                        {node.botSlug && (
                          <div className="mt-auto truncate text-[10px] font-semibold text-Cr-text-subtlest-v2">{node.botSlug}</div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {isDropActive && (
            <div
              data-canvas-floating="true"
              data-testid="ai-canvas-drop-import"
              className="pointer-events-none absolute inset-6 z-30 grid place-items-center rounded-lg-v2 border border-dreamy-brand-hot-v2/70 bg-dreamy-brand-hot-v2/10 text-sm font-semibold text-white"
            >
              Drop media or canvas JSON
            </div>
          )}

          {contextMenu && (
            <div
              data-canvas-floating="true"
              data-testid="ai-canvas-context-menu"
              className="fixed z-50 w-52 overflow-hidden rounded-md-v2 border border-white/10 bg-[#171821] p-1 text-xs shadow-2xl"
              style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
            >
              {AI_CANVAS_NODE_LIBRARY.map((item) => {
                const Icon = getCanvasNodeIcon(item.kind);
                return (
                  <button
                    key={item.kind}
                    type="button"
                    onClick={() => addCanvasNode(item.kind, { x: contextMenu.canvasX, y: contextMenu.canvasY })}
                    className="flex h-9 w-full items-center gap-2 rounded-md-v2 px-2 text-left font-semibold text-Cr-text-subtler-v2 active:bg-white/[0.08]"
                  >
                    <Icon size={14} className="text-dreamy-brand-hot-v2" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="absolute bottom-6 left-5 right-5 z-20 grid gap-2 md:left-[70px] md:right-[70px]">
            <div
              data-testid="canvas-auto-flow-presets"
              className="hidden flex-wrap items-center gap-2 rounded-md-v2 border border-white/10 bg-[#171821]/95 p-2 shadow-xl"
            >
              <div data-testid="canvas-material-flow-ready" className="mr-1 inline-flex min-w-0 items-center gap-2 rounded-md-v2 bg-white/[0.06] px-2 py-1 text-[11px] font-semibold text-Cr-text-subtle-v2">
                <Link2 size={13} className="shrink-0 text-dreamy-brand-hot-v2" />
                <span className="truncate">{activeFlowPreset?.summary || 'Material flow ready'}</span>
              </div>
              {CANVAS_FLOW_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyFlowPreset(preset)}
                  aria-pressed={activeFlowPresetId === preset.id}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md-v2 px-2 text-[11px] font-semibold ${
                    activeFlowPresetId === preset.id
                      ? 'bg-dreamy-brand-hot-v2 text-white'
                      : 'bg-white/[0.06] text-Cr-text-subtler-v2 active:bg-white/10'
                  }`}
                >
                  <Wand2 size={13} />
                  {preset.title}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex min-w-[260px] flex-1 items-center gap-2 rounded-md-v2 border border-white/10 bg-[#171821]/95 p-2 shadow-xl">
              {(showReferenceMenu || showPresetMenu) && (
                <div
                  data-testid="ai-canvas-reference-menu"
                  className="absolute bottom-[calc(100%+8px)] left-0 right-0 flex flex-wrap gap-1 rounded-md-v2 border border-white/10 bg-[#171821] p-2 shadow-2xl"
                >
                  {showReferenceMenu
                    ? referenceNodes.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => insertCanvasCommandToken(`@${node.id}`)}
                          className="inline-flex h-7 max-w-[180px] items-center gap-1.5 rounded-md-v2 bg-white/[0.06] px-2 text-[11px] font-semibold active:bg-white/10"
                        >
                          <Link2 size={12} className="shrink-0 text-dreamy-brand-hot-v2" />
                          <span className="truncate">{node.title}</span>
                        </button>
                      ))
                    : CANVAS_COMMAND_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => insertCanvasCommandToken(preset.value)}
                          className="inline-flex h-7 items-center gap-1.5 rounded-md-v2 bg-white/[0.06] px-2 text-[11px] font-semibold active:bg-white/10"
                        >
                          <Wand2 size={12} className="text-dreamy-brand-hot-v2" />
                          {preset.label}
                        </button>
                      ))}
                </div>
              )}
              <input
                value={canvasCommand}
                onChange={(event) => setCanvasCommand(event.target.value)}
                className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-Cr-text-subtlest-v2"
                placeholder="Modify this material flow: text to image, image to video, extend, or restyle..."
              />
              <button
                type="button"
                onClick={runSelected}
                disabled={submitting || !selectedNode}
                className="inline-flex h-9 items-center gap-2 rounded-md-v2 bg-dreamy-brand-hot-v2 px-4 text-xs font-semibold text-white disabled:bg-white/[0.06] disabled:text-Cr-text-subtlest-v2"
              >
                <Send size={14} />
                Generate
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-md-v2 border border-white/10 bg-[#171821]/95 p-1 shadow-xl">
              <button type="button" onClick={() => setZoom((value) => clamp(value - 0.08, 0.48, 1.4))} className="flex h-8 w-8 items-center justify-center rounded-md-v2 active:bg-white/[0.08]" aria-label="Zoom out">
                <ZoomOut size={15} />
              </button>
              <button type="button" onClick={resetView} className="h-8 min-w-12 rounded-md-v2 px-2 text-[11px] font-semibold active:bg-white/[0.08]">
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" onClick={() => setZoom((value) => clamp(value + 0.08, 0.48, 1.4))} className="flex h-8 w-8 items-center justify-center rounded-md-v2 active:bg-white/[0.08]" aria-label="Zoom in">
                <ZoomIn size={15} />
              </button>
            </div>
            </div>
          </div>
        </div>

        <aside
          data-testid="ai-canvas-inspector-drawer"
          className={`absolute inset-y-3 right-3 z-40 w-[min(300px,calc(100%-24px))] min-h-0 flex-col overflow-hidden rounded-lg-v2 border border-white/10 bg-[#111219]/98 shadow-2xl backdrop-blur ${
            inspectorOpen ? 'flex' : 'hidden'
          }`}
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <SlidersHorizontal size={14} />
              <div className="truncate text-sm font-semibold">Inspector</div>
            </div>
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md-v2 bg-white/[0.06] active:bg-white/10"
              aria-label="Close inspector"
            >
              <X size={14} />
            </button>
          </div>
          {selectedNode ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="rounded-md-v2 border border-white/10 bg-white/[0.03] p-3">
                <div className="text-sm font-semibold">{selectedNode.title}</div>
                <div className="mt-1 text-xs capitalize text-Cr-text-subtler-v2">{selectedNode.kind}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg-v2 bg-white/5 p-2">
                    <div className="text-Cr-text-subtlest-v2">X</div>
                    <div className="mt-1 font-semibold">{Math.round(selectedNode.x)}</div>
                  </div>
                  <div className="rounded-lg-v2 bg-white/5 p-2">
                    <div className="text-Cr-text-subtlest-v2">Y</div>
                    <div className="mt-1 font-semibold">{Math.round(selectedNode.y)}</div>
                  </div>
                </div>
              </div>

              <label className="mt-3 block text-[11px] font-semibold text-Cr-text-subtler-v2">Action</label>
              <select
                value={canvasAction}
                onChange={(event) => setCanvasAction(event.target.value as StudioAction)}
                className="mt-1 h-9 w-full rounded-lg-v2 border border-white/10 bg-[#171821] px-2 text-xs outline-none"
              >
                <option value="generate">Generate</option>
                <option value="extend">Extend</option>
                <option value="restyle">Restyle</option>
                <option value="retry-agent">Try another agent</option>
              </select>

              <label className="mt-3 block text-[11px] font-semibold text-Cr-text-subtler-v2">Prompt / instruction</label>
              <textarea
                value={canvasCommand}
                onChange={(event) => setCanvasCommand(event.target.value)}
                rows={5}
                className="mt-1 w-full resize-none rounded-lg-v2 border border-white/10 bg-[#171821] p-2 text-xs leading-5 outline-none placeholder:text-Cr-text-subtlest-v2"
                placeholder="Describe how this selected node should change"
              />

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={runSelected}
                  disabled={submitting}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg-v2 bg-dreamy-brand-hot-v2 px-2 text-xs font-semibold text-white disabled:bg-white/[0.06] disabled:text-Cr-text-subtlest-v2"
                >
                  <Wand2 size={14} />
                  Run
                </button>
                <button
                  type="button"
                  onClick={duplicateSelected}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg-v2 bg-white/[0.06] px-2 text-xs font-semibold active:bg-white/10"
                >
                  <Copy size={14} />
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => addCanvasNode('agent')}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg-v2 bg-white/[0.06] px-2 text-xs font-semibold active:bg-white/10"
                >
                  <Plus size={14} />
                  Agent
                </button>
                <button
                  type="button"
                  onClick={deleteSelected}
                  disabled={selectedNode.id === 'prompt-root' || selectedNode.id === 'timeline-output'}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg-v2 bg-white/[0.06] px-2 text-xs font-semibold text-Cr-text-critical-default-v2 active:bg-white/10 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>

              <div className="mt-3 rounded-xl-v2 border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-Cr-text-subtler-v2">
                <div className="font-semibold text-Cr-text-subtle-v2">Selected route</div>
                <div className="mt-1">Bot: {selectedNode.botName || selectedNode.title}</div>
                <div>Slug: {selectedNode.botSlug || selectedNode.agentId || 'canvas-node'}</div>
                <div>Source: {selectedNodeSegment?.id || 'none'}</div>
              </div>
            </div>
          ) : (
            <div className="p-3 text-xs text-Cr-text-subtler-v2">Select a node to edit it.</div>
          )}
        </aside>
      </div>
      {showBotCatalog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true">
          <div className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg-v2 border border-white/10 bg-[#111219] shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
              <div>
                <div className="text-sm font-semibold">Dreamy Bot Catalog</div>
                <div className="text-[11px] text-Cr-text-subtler-v2">{canvasBotCatalogPresets.length} selectable Dreamy bots</div>
              </div>
              <button
                type="button"
                onClick={() => setShowBotCatalog(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md-v2 bg-white/[0.06] active:bg-white/10"
                aria-label="Close bot catalog"
              >
                <X size={15} />
              </button>
            </div>
            <div className="grid gap-3 overflow-y-auto p-4 sm:grid-cols-2">
              {canvasBotCatalogPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    addCanvasNode('agent', undefined, {
                      overrides: {
                        title: preset.title,
                        subtitle: preset.recommendation,
                        status: preset.previewStatus,
                        action: getStarterPresetAction(preset, selectedSegment),
                        prompt: preset.prompt,
                        botSlug: preset.botSlug,
                        botName: preset.title,
                        mediaUrl: preset.visualUrl,
                        boardId: activeBoardId,
                      },
                    });
                    setShowBotCatalog(false);
                  }}
                  className="grid min-h-[132px] grid-cols-[118px_minmax(0,1fr)] overflow-hidden rounded-md-v2 border border-white/10 bg-white/[0.03] text-left active:bg-white/[0.08]"
                >
                  <span className="relative h-full min-h-[132px] bg-black/30">
                    <img src={preset.visualUrl} alt="" className="h-full w-full object-contain" />
                    <span className="absolute bottom-2 left-2 rounded-md-v2 bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                      {preset.workflow}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col p-3">
                    <span className="truncate text-sm font-semibold">{preset.title}</span>
                    <span className="mt-1 line-clamp-2 text-xs leading-5 text-Cr-text-subtler-v2">{preset.recommendation}</span>
                    <span className="mt-auto truncate text-[11px] font-semibold text-dreamy-brand-hot-v2">{preset.botSlug}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RecommendationAgentPanel({
  preset,
  submitting,
  onRunPreset,
}: {
  preset?: StudioStarterPreset;
  submitting: boolean;
  onRunPreset?: (preset: StudioStarterPreset) => void;
}) {
  if (!preset) return null;

  return (
    <div
      data-testid="ai-recommendation-agent"
      className="grid gap-2 rounded-lg-v2 border border-dreamy-brand-hot-v2/35 bg-dreamy-brand-hot-v2/10 p-2 sm:grid-cols-[96px_minmax(0,1fr)_auto]"
    >
      <div className="relative h-[70px] overflow-hidden rounded-md-v2 border border-white/10 bg-black/30">
        <img src={preset.visualUrl} alt="" className="h-full w-full object-contain" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute -left-6 top-0 h-full w-12 rotate-12 animate-pulse bg-white/20 blur-sm" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-Cr-text-default-v2">{preset.title}</span>
          <Pill tone="hot">{preset.workflow}</Pill>
          <Pill>{`${preset.estimatedWaitSeconds}s target`}</Pill>
          <Pill tone={preset.previewAccepted ? 'success' : 'hot'}>{preset.previewLabel}</Pill>
        </div>
        <div className="mt-1 line-clamp-2 text-xs leading-5 text-Cr-text-subtle-v2">{preset.recommendation}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {preset.steps.map((step) => (
            <span key={step} className="rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 py-1 text-[10px] font-semibold text-Cr-text-subtler-v2">
              {step}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        data-testid="ai-recommendation-run"
        disabled={submitting}
        onClick={() => onRunPreset?.(preset)}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md-v2 bg-dreamy-brand-hot-v2 px-3 text-xs font-semibold text-white disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2 sm:self-center"
      >
        <Sparkles size={14} />
        Run AI pick
      </button>
    </div>
  );
}

function BotPresetCard({
  preset,
  selected,
  submitting,
  onSelect,
  variant = 'main',
}: {
  preset: StudioStarterPreset;
  selected: boolean;
  submitting: boolean;
  onSelect: (preset: StudioStarterPreset) => void;
  variant?: 'main' | 'modal';
}) {
  const isModal = variant === 'modal';
  return (
    <div data-testid={isModal ? 'all-bot-picker-card' : 'all-bot-preview-card'}>
      <button
        type="button"
        data-testid={isModal ? `all-bot-picker-${preset.id}` : `starter-preset-${preset.id}`}
        aria-label={`Select ${preset.title} preset`}
        aria-pressed={selected}
        disabled={submitting}
        onClick={() => onSelect(preset)}
        className={`group grid w-full overflow-hidden rounded-xl-v2 border text-left transition-colors active:bg-Cr-beta-white-8-v2 disabled:opacity-50 ${
          isModal
            ? 'h-[132px] grid-cols-[minmax(150px,40%)_minmax(0,1fr)]'
            : 'h-[118px] grid-cols-[minmax(168px,34%)_minmax(0,1fr)]'
        } ${
          selected
            ? 'border-dreamy-brand-hot-v2 bg-dreamy-brand-hot-v2/10 shadow-[0_0_0_1px_rgba(244,45,118,0.35)]'
            : 'border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2'
        }`}
      >
        <span
          data-testid={isModal ? 'all-bot-picker-preview-asset' : 'starter-bot-preview-asset'}
          className="relative block h-full overflow-hidden border-r border-Cr-border-default-v2 bg-black/25"
          style={{
            backgroundImage: preset.visualUrl === preset.fallbackVisualUrl ? `url(${preset.fallbackVisualUrl})` : undefined,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
          }}
        >
          <span data-testid={isModal ? 'all-bot-picker-preview-image' : 'all-bot-preview-image'} className="block h-full w-full">
            <img
              data-testid={isModal ? 'all-bot-picker-image' : 'starter-bot-preview-image'}
              src={preset.visualUrl}
              alt={`${preset.title} preview`}
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
              className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.03] group-active:scale-105"
            />
          </span>
          <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
          <span
            data-testid={preset.previewAccepted ? 'starter-bot-preview-real' : 'starter-bot-preview-fallback'}
            className="absolute bottom-2 left-2 rounded bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase text-white"
          >
            {preset.previewLabel}
          </span>
          <span className="absolute bottom-0 left-0 h-0.5 w-2/3 rounded-r bg-dreamy-brand-hot-v2" />
        </span>
        <span className="grid min-w-0 content-between gap-1.5 p-3">
          <span className="min-w-0">
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold text-Cr-text-default-v2">{preset.title}</span>
              {selected ? (
                <CheckCircle2 size={15} className="shrink-0 text-Cr-text-success-default-v2" />
              ) : (
                <MousePointer2 size={15} className="shrink-0 text-dreamy-brand-hot-v2" />
              )}
            </span>
            <span className={`${isModal ? 'line-clamp-2' : 'line-clamp-1'} mt-1 text-xs leading-5 text-Cr-text-subtle-v2`}>
              {preset.recommendation}
            </span>
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Pill tone="hot">{preset.workflow}</Pill>
            <Pill>{preset.botId || preset.botSlug}</Pill>
          </span>
          <span
            data-testid="starter-bot-preview-state"
            className="truncate text-[10px] font-semibold uppercase text-Cr-text-subtlest-v2"
          >
            {preset.previewAccepted ? `${preset.previewSource}` : `${preset.previewStatus}`}
          </span>
        </span>
      </button>
    </div>
  );
}

function BotSelectionPanel({
  starterPresets,
  allBotPresets,
  selectedStarterPresetId,
  selectedStarterPreset,
  selectedSegment,
  manualBotIdsText,
  manualBotEntries,
  selectedManualBotEntryId,
  submitting,
  onSelectPreset,
  onManualBotIdsChange,
  onSelectManualBot,
  onRunManualBot,
  onRunManualBotSequence,
  onRunPreset,
}: {
  starterPresets: StudioStarterPreset[];
  allBotPresets: StudioStarterPreset[];
  selectedStarterPresetId?: string;
  selectedStarterPreset?: StudioStarterPreset | null;
  selectedSegment?: StudioSegment | null;
  manualBotIdsText: string;
  manualBotEntries: ManualBotEntry[];
  selectedManualBotEntryId?: string;
  submitting: boolean;
  onSelectPreset: (preset: StudioStarterPreset) => void;
  onManualBotIdsChange: (value: string) => void;
  onSelectManualBot: (entry: ManualBotEntry) => void;
  onRunManualBot: (entry: ManualBotEntry) => void;
  onRunManualBotSequence: () => void;
  onRunPreset?: (preset: StudioStarterPreset) => void;
}) {
  const activeStarterPresetId = selectedStarterPreset?.id || selectedStarterPresetId;
  const [allBotPickerOpen, setAllBotPickerOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectableBotCount = allBotPresets.length || starterPresets.length;
  const starterPresetKeys = new Set(starterPresets.flatMap((preset) => [preset.id, preset.botSlug].filter(Boolean)));
  const visibleCatalogPresets = allBotPresets
    .filter((preset) => !starterPresetKeys.has(preset.id) && !starterPresetKeys.has(preset.botSlug))
    .slice(0, 24);
  const selectPreset = useCallback((preset: StudioStarterPreset) => {
    onSelectPreset(preset);
    setSelectorOpen(false);
  }, [onSelectPreset]);

  return (
    <section
      data-testid="bot-selection-panel"
      className="shrink-0 overflow-hidden border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 px-3 py-3"
      aria-label="Dreamy bot selection"
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <button
          type="button"
          data-testid="agent-selector-toggle"
          aria-expanded={selectorOpen}
          onClick={() => setSelectorOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2 px-2.5 py-2 text-left active:bg-Cr-beta-white-8-v2"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md-v2 bg-Cr-beta-white-8-v2">
            {selectedStarterPreset?.visualUrl ? (
              <img src={selectedStarterPreset.visualUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Bot size={15} className="text-dreamy-brand-hot-v2" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-Cr-text-default-v2">
              {selectedStarterPreset?.title || 'Choose Dreamy agent'}
            </span>
            <span className="block truncate text-[11px] text-Cr-text-subtler-v2">
              {selectedStarterPreset?.botSlug || `${selectableBotCount} agents available`}
            </span>
          </span>
          <ChevronDown
            size={15}
            className={`shrink-0 text-Cr-text-subtler-v2 transition-transform ${selectorOpen ? 'rotate-180' : ''}`}
          />
        </button>
        <div data-testid="dreamy-bot-selection-state" className="flex min-w-0 shrink-0 items-center gap-1.5">
          <button
            type="button"
            data-testid="all-bots-modal-open"
            onClick={() => setAllBotPickerOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md-v2 border border-dreamy-brand-hot-v2/55 bg-dreamy-brand-hot-v2/10 px-2.5 text-[11px] font-semibold text-dreamy-brand-hot-v2 active:bg-dreamy-brand-hot-v2/20"
            aria-haspopup="dialog"
            aria-expanded={allBotPickerOpen}
          >
            <Bot size={13} />
            All bots
          </button>
          <span className="hidden sm:inline-flex">
            <Pill tone="hot">{`${selectableBotCount} options`}</Pill>
          </span>
          {selectedStarterPreset && <Pill>{selectedStarterPreset.botSlug}</Pill>}
          {selectedStarterPreset && (
            <>
              <span data-testid="starter-preset-selection" className="sr-only">
                {selectedStarterPreset.title}
              </span>
              <span data-testid="selected-dreamy-bot-preview" className="sr-only">
                Prompt will call this bot and append the result to the timeline.
              </span>
              <button
                type="button"
                data-testid="starter-preset-direct-generate"
                disabled={submitting}
                onClick={() => onRunPreset?.(selectedStarterPreset)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md-v2 bg-dreamy-brand-hot-v2 px-2.5 text-[11px] font-semibold text-white disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
              >
                <Clapperboard size={12} />
                Run
              </button>
              <span data-testid="starter-preset-result-visible" className="sr-only">
                Selected bot result visible
              </span>
            </>
          )}
        </div>
      </div>

      <div
        data-testid="bot-selection-scroll-region"
        className={`mt-3 space-y-2 overflow-y-auto overscroll-contain pr-1 transition-[max-height,opacity] duration-200 [-webkit-overflow-scrolling:touch] ${
          selectorOpen ? 'max-h-[min(48dvh,520px)] opacity-100' : 'max-h-0 opacity-0'
        }`}
        aria-hidden={!selectorOpen}
      >
        {!!starterPresets.length && (
          <div data-testid="starter-presets" className="grid gap-2">
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase text-Cr-text-subtlest-v2">
              <span className="inline-flex min-w-0 items-center gap-2">
                <Sparkles size={13} className="text-dreamy-brand-hot-v2" />
                <span className="truncate">Verified workshop bots</span>
              </span>
              <Pill>{`${starterPresets.length} verified`}</Pill>
            </div>
            <div data-testid="all-bot-previews" className="grid gap-2">
              <div
                data-testid="starter-visual-recommendations"
                className="grid gap-2"
              >
                {starterPresets.map((preset) => (
                  <BotPresetCard
                    key={preset.id}
                    preset={preset}
                    selected={activeStarterPresetId === preset.id}
                    submitting={submitting}
                    onSelect={selectPreset}
                  />
                ))}
              </div>
            </div>
            <div data-testid="dreamy-bot-list-only" className="sr-only">Dreamy-only bot list</div>
          </div>
        )}

        {!!visibleCatalogPresets.length && (
          <div data-testid="dreamy-catalog-presets" className="grid gap-2">
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase text-Cr-text-subtlest-v2">
              <span className="inline-flex min-w-0 items-center gap-2">
                <Layers3 size={13} className="text-dreamy-brand-hot-v2" />
                <span className="truncate">Dreamy catalog bots</span>
              </span>
              <button
                type="button"
                onClick={() => setAllBotPickerOpen(true)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 active:bg-Cr-beta-white-8-v2"
              >
                <ExternalLink size={12} />
                {`${selectableBotCount} total`}
              </button>
            </div>
            <div className="grid gap-2">
              {visibleCatalogPresets.map((preset) => (
                <BotPresetCard
                  key={`catalog-${preset.id}`}
                  preset={preset}
                  selected={activeStarterPresetId === preset.id}
                  submitting={submitting}
                  onSelect={selectPreset}
                />
              ))}
            </div>
          </div>
        )}

        <details data-testid="manual-bot-id-panel" className="group rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2 p-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 marker:hidden">
            <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase text-Cr-text-subtlest-v2">
              <SlidersHorizontal size={13} className="shrink-0 text-Cr-text-subtler-v2" />
              <span className="truncate">Advanced manual bot ids</span>
            </div>
            <Pill tone={manualBotEntries.length ? 'hot' : 'default'}>{`${manualBotEntries.length} queued`}</Pill>
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_116px]">
            <textarea
              data-testid="manual-bot-id-input"
              value={manualBotIdsText}
              disabled={submitting}
              onChange={(event) => onManualBotIdsChange(event.target.value)}
              rows={2}
              className="min-h-10 resize-none rounded-md-v2 border border-Cr-border-default-v2 bg-Cr-beta-white-5-v2 px-2 py-1.5 text-xs leading-5 text-Cr-text-default-v2 outline-none placeholder:text-Cr-text-subtlest-v2 disabled:opacity-50"
              placeholder="botId or botId|name|type|slug|articleId"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
              <button
                type="button"
                data-testid="manual-bot-run-selected"
                disabled={submitting || !manualBotEntries.length}
                onClick={() => {
                  const selected = manualBotEntries.find((entry) => entry.id === selectedManualBotEntryId) || manualBotEntries[0];
                  if (selected) onRunManualBot(selected);
                }}
                className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-default-v2 disabled:opacity-40"
              >
                <Clapperboard size={12} className="shrink-0" />
                Selected
              </button>
              <button
                type="button"
                data-testid="manual-bot-run-sequence"
                disabled={submitting || manualBotEntries.length < 2}
                onClick={onRunManualBotSequence}
                className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md-v2 bg-dreamy-brand-hot-v2 px-2 text-[11px] font-semibold text-white disabled:bg-Cr-Bg-surface-subtle-v2 disabled:text-Cr-text-subtlest-v2"
              >
                <GitBranch size={12} className="shrink-0" />
                Sequence
              </button>
            </div>
          </div>
          {!!manualBotEntries.length && (
            <div data-testid="manual-bot-sequence-list" className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
              {manualBotEntries.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  disabled={submitting}
                  aria-pressed={selectedManualBotEntryId === entry.id}
                  onClick={() => onSelectManualBot(entry)}
                  className={`min-w-[118px] rounded-md-v2 border px-2 py-1.5 text-left disabled:opacity-50 ${
                    selectedManualBotEntryId === entry.id
                      ? 'border-dreamy-brand-hot-v2 bg-dreamy-brand-hot-v2/10'
                      : 'border-Cr-border-default-v2 bg-Cr-beta-white-5-v2'
                  }`}
                >
                  <span className="block truncate text-[11px] font-semibold text-Cr-text-default-v2">{entry.botName}</span>
                  <span className="block truncate text-[10px] text-Cr-text-subtlest-v2">{`${index + 1}. ${entry.botId || entry.botSlug}`}</span>
                </button>
              ))}
            </div>
          )}
        </details>
      </div>

      {allBotPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="All selectable Dreamy bots"
        >
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close all bot picker"
            onClick={() => setAllBotPickerOpen(false)}
          />
          <section className="relative z-10 flex h-[min(760px,86dvh)] w-full max-w-[1120px] flex-col overflow-hidden rounded-xl-v2 border border-white/10 bg-[#0f1016] shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-Cr-text-default-v2">
                  <Bot size={15} className="text-dreamy-brand-hot-v2" />
                  All selectable bots
                </div>
                <div className="truncate text-[11px] text-Cr-text-subtler-v2">
                  Pick any available Dreamy bot; it becomes the active bot for the prompt and timeline.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Pill tone="hot">{`${selectableBotCount} bots`}</Pill>
                <button
                  type="button"
                  onClick={() => setAllBotPickerOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md-v2 border border-white/10 bg-white/[0.04] text-Cr-text-subtler-v2 active:bg-white/[0.08]"
                  aria-label="Close all bot picker"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <div data-testid="all-bots-modal-list" className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(allBotPresets.length ? allBotPresets : starterPresets).map((preset) => (
                  <BotPresetCard
                    key={`modal-${preset.id}`}
                    preset={preset}
                    selected={activeStarterPresetId === preset.id}
                    submitting={submitting}
                    variant="modal"
                    onSelect={(nextPreset) => {
                      selectPreset(nextPreset);
                      setAllBotPickerOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function Composer({
  mode,
  prompt,
  canSubmitWithoutPrompt,
  previewUrl,
  selectedFileName,
  selectedStarterPreset,
  selectedSegment,
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
  canSubmitWithoutPrompt?: boolean;
  previewUrl: string;
  selectedFileName?: string;
  selectedStarterPreset?: StudioStarterPreset | null;
  selectedSegment?: StudioSegment | null;
  submitting: boolean;
  onModeChange: (mode: StudioMode) => void;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onPickFile: () => void;
  onClearFile: () => void;
  onStop: () => void;
}) {
  return (
    <div data-testid="studio-composer" className="dreamy-studio-composer">
      <div className="dreamy-studio-composer-box">
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          rows={3}
          className="dreamy-studio-field"
          placeholder="Describe the next shot you want to create..."
        />
        <div className="dreamy-studio-composer-row">
          <button
            type="button"
            onClick={onPickFile}
            className="dreamy-studio-ghost-pill"
          >
            <ImagePlus size={14} />
            Image
          </button>
          <button
            type="button"
            onClick={onPickFile}
            className="dreamy-studio-ghost-pill"
          >
            <Clapperboard size={14} />
            Video
          </button>
          <button
            type="button"
            onClick={onPickFile}
            className="dreamy-studio-ghost-pill"
          >
            <Link2 size={14} />
            Reference
          </button>
          {previewUrl && (
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1 pr-2">
              <img src={previewUrl} alt="" className="h-7 w-7 rounded-md-v2 object-contain" />
              <span className="max-w-[120px] truncate text-[11px] text-Cr-text-subtler-v2">{selectedFileName}</span>
              <button type="button" onClick={onClearFile} aria-label="Remove image">
                <X size={14} />
              </button>
            </div>
          )}
          <span className="dreamy-studio-spacer" />
          {submitting ? (
            <button
              type="button"
              onClick={onStop}
              className="dreamy-studio-ghost-pill"
            >
              <X size={14} />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!prompt.trim() && !canSubmitWithoutPrompt}
              className="dreamy-studio-send disabled:opacity-40"
              aria-label="Run Dreamy prompt"
            >
              <Send size={18} fill="currentColor" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dreamy() {
  const navigate = useNavigate();
  const location = useLocation();
  const { energy, refresh } = useEnergy();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const restoredDispatchUrlRef = useRef('');
  const autoPollNoticeRef = useRef<Record<string, string>>({});
  const [workspace, setWorkspaceState] = useState<StudioWorkspace>(() =>
    getStudioWorkspaceFromSearch(location.search),
  );
  const [mode, setMode] = useState<StudioMode>('player');
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [prompt, setPrompt] = useState('');
  const [project, setProject] = useState<StudioProject | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Dreamy Studio is ready for the first result.',
      createdAt: nowIso(),
      steps: [
        { step: 'dreamy', message: 'Dreamy Miniapp is the first generation target.', progress: 0 },
      ],
    },
  ]);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [selectedStarterPresetId, setSelectedStarterPresetId] = useState('');
  const [manualBotIdsText, setManualBotIdsText] = useState('');
  const [selectedManualBotEntryId, setSelectedManualBotEntryId] = useState('');
  const [pages, setPages] = useState<StudioPageAdapter[]>([]);
  const [agents, setAgents] = useState<StudioAgentCapability[]>([]);
  const [botPreviews, setBotPreviews] = useState<StudioBotPreviewsResponse | null>(null);
  const [hubJobs, setHubJobs] = useState<StudioJob[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<StudioApi | string>('dreamy-miniapp');
  const [selectedAgentId, setSelectedAgentId] = useState(DEFAULT_STUDIO_AGENT_ID);
  const [studioHealth, setStudioHealth] = useState<StudioHealth | null>(null);
  const [studioOverview, setStudioOverview] = useState<StudioOverview | null>(null);
  const [studioReadiness, setStudioReadiness] = useState<StudioReadiness | null>(null);
  const [deliveryAudit, setDeliveryAudit] = useState<StudioDeliveryAudit | null>(null);
  const [deliveryReport, setDeliveryReport] = useState<StudioProjectDeliveryReport | null>(null);
  const [dispatchMatrix, setDispatchMatrix] = useState<StudioDispatchMatrix | null>(null);
  const [selectedDispatchPageIds, setSelectedDispatchPageIds] = useState<string[]>([]);
  const [coverageReport, setCoverageReport] = useState<StudioCoverageReport | null>(null);
  const [handoffSnapshot, setHandoffSnapshot] = useState<StudioHandoffSnapshot | null>(null);
  const [deliveryBundle, setDeliveryBundle] = useState<StudioDeliveryBundle | null>(null);
  const [dispatchBatchPlan, setDispatchBatchPlan] = useState<StudioDispatchBatchPlan | null>(null);
  const [dispatchSession, setDispatchSession] = useState<StudioDispatchSession | null>(null);
  const [queueStatusFilter, setQueueStatusFilter] = useState<StudioStatus | 'all'>('all');
  const [queuePageFilter, setQueuePageFilter] = useState<StudioApi | string>('all');
  const [queueAgentFilter, setQueueAgentFilter] = useState('all');
  const [dispatchPreview, setDispatchPreview] = useState<StudioDispatchPreview | null>(null);
  const [bulkActionRunning, setBulkActionRunning] = useState<'cancel' | 'retry' | null>(null);
  const [coverageVerifyRunning, setCoverageVerifyRunning] = useState(false);
  const [deliveryAuditRefreshing, setDeliveryAuditRefreshing] = useState(false);
  const [resolvingAuditActionId, setResolvingAuditActionId] = useState<string | null>(null);
  const [resolvingAuditBatch, setResolvingAuditBatch] = useState(false);
  const [handoffRefreshing, setHandoffRefreshing] = useState(false);
  const [deliveryBundleLoading, setDeliveryBundleLoading] = useState(false);
  const [dispatchBatchPlanning, setDispatchBatchPlanning] = useState(false);
  const [dispatchSessionRunning, setDispatchSessionRunning] = useState(false);
  const [timelineExporting, setTimelineExporting] = useState(false);
  const [deliveryDrawerOpen, setDeliveryDrawerOpen] = useState(false);

  useEffect(() => {
    const nextWorkspace = getStudioWorkspaceFromSearch(location.search);
    setWorkspaceState((current) => (current === nextWorkspace ? current : nextWorkspace));
  }, [location.search]);

  const setStudioWorkspace = useCallback(
    (nextWorkspace: StudioWorkspace) => {
      setWorkspaceState(nextWorkspace);
      navigate(nextWorkspace === 'canvaspro' ? '/dreamy?workspace=canvaspro' : '/dreamy', { replace: true });
      trackEvent('dreamy_studio_workspace_switch', {
        workspace: nextWorkspace,
      });
    },
    [navigate],
  );

  const selectedSegment = useMemo(() => {
    const segments = getTimelineDisplaySegments(project?.segments || []);
    const id = project?.selectedSegmentId;
    return segments.find((segment) => segment.id === id) || segments[segments.length - 1] || null;
  }, [project]);
  const manualBotEntries = useMemo(() => parseManualBotEntries(manualBotIdsText), [manualBotIdsText]);
  const selectedManualBotEntry = useMemo(
    () => (selectedManualBotEntryId ? manualBotEntries.find((entry) => entry.id === selectedManualBotEntryId) || null : null),
    [manualBotEntries, selectedManualBotEntryId],
  );
  useEffect(() => {
    if (selectedManualBotEntryId && !manualBotEntries.some((entry) => entry.id === selectedManualBotEntryId)) {
      setSelectedManualBotEntryId('');
    }
  }, [manualBotEntries, selectedManualBotEntryId]);
  const hydratedStarterPresets = useMemo(
    () => hydrateStarterPresets(DREAMY_STARTER_PRESETS, botPreviews),
    [botPreviews],
  );
  const recommendedStarterPresets = useMemo(
    () => rankStarterPresets(hydratedStarterPresets, selectedSegment, Boolean(selectedFile)),
    [hydratedStarterPresets, selectedFile, selectedSegment?.id, selectedSegment?.type],
  );
  const connectedBotPreviewCards = useMemo(
    () =>
      [...(botPreviews?.previews || [])].filter(isDreamyStudioBot).sort((left, right) => {
        return left.botName.localeCompare(right.botName);
      }),
    [botPreviews],
  );
  const connectedBotPresets = useMemo(
    () => connectedBotPreviewCards.map(starterPresetFromBotPreview),
    [connectedBotPreviewCards],
  );
  const selectableStarterPresets = useMemo(() => {
    const bySlug = new Map<string, StudioStarterPreset>();
    for (const preset of recommendedStarterPresets) bySlug.set(preset.botSlug, preset);
    for (const preset of DREAMY_CATALOG_FALLBACK_PRESETS) {
      if (!bySlug.has(preset.botSlug)) bySlug.set(preset.botSlug, preset);
    }
    for (const preset of connectedBotPresets) {
      if (!bySlug.has(preset.botSlug)) bySlug.set(preset.botSlug, preset);
    }
    return [...bySlug.values()];
  }, [connectedBotPresets, recommendedStarterPresets]);
  const selectedStarterPreset = useMemo(
    () =>
      selectableStarterPresets.find((preset) => preset.id === selectedStarterPresetId) ||
      selectableStarterPresets[0] ||
      null,
    [selectableStarterPresets, selectedStarterPresetId],
  );
  const selectedPreviewPreset = useMemo<StudioStarterPreset | null>(() => {
    if (!selectedManualBotEntry) return selectedStarterPreset;
    const workflow = workflowForDreamyBotType(selectedManualBotEntry.botType);
    return {
      id: selectedManualBotEntry.id,
      title: selectedManualBotEntry.botName,
      prompt: prompt || `Run ${selectedManualBotEntry.botName} with the current Dreamy prompt.`,
      pageId: 'dreamy-miniapp',
      pageName: 'Dreamy Miniapp',
      agentId: DEFAULT_STUDIO_AGENT_ID,
      botId: selectedManualBotEntry.botId,
      articleId: selectedManualBotEntry.articleId,
      botSlug: selectedManualBotEntry.botSlug,
      recommendation: `Manual Dreamy bot id ${selectedManualBotEntry.botId || selectedManualBotEntry.botSlug}.`,
      visualUrl: presetCinematicGif,
      fallbackVisualUrl: presetCinematicGif,
      previewStatus: 'manual',
      previewAccepted: false,
      previewSource: 'manual-bot-id',
      previewLabel: 'Manual bot id',
      workflow,
      steps: stepsForDreamyBotType(selectedManualBotEntry.botType),
      estimatedWaitSeconds: selectedManualBotEntry.botType.toLowerCase().includes('video') ? 60 : 30,
    };
  }, [prompt, selectedManualBotEntry, selectedStarterPreset]);

  const selectedJob = useMemo(() => {
    const jobId = selectedSegment?.jobId;
    if (!jobId) return null;
    return project?.jobs?.find((job) => job.jobId === jobId) || null;
  }, [project?.jobs, selectedSegment?.jobId]);

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) || pages[0] || null,
    [pages, selectedPageId],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  );
  const previewPage = dispatchPreview?.page || selectedPage;
  const previewDispatchStatus = dispatchPreview?.dispatchStatus || previewPage?.dispatchStatus;
  const previewDispatchReady = dispatchPreview?.dispatchReady ?? previewPage?.dispatchReady;
  const previewDispatchMode = dispatchPreview?.executor || previewPage?.dispatchMode || previewPage?.executor;
  const previewDispatchMessage = dispatchPreview?.dispatchMessage || previewPage?.dispatchMessage || previewPage?.authStatus?.message;
  const previewMissingParams = dispatchPreview?.missingRouteParams || [];
  const previewNavigationPath = dispatchPreview?.navigationPath || previewPage?.appRoute || '';
  const selectedDispatchBatchPageIds = useMemo(
    () => getStudioDispatchSelectionPageIds(dispatchMatrix?.entries || [], selectedDispatchPageIds),
    [dispatchMatrix?.entries, selectedDispatchPageIds],
  );
  const pageOptions = useMemo(
    () => (pages.length ? pages : [{ id: 'dreamy-miniapp', name: 'Dreamy Miniapp' } as StudioPageAdapter]),
    [pages],
  );
  const overviewPages = studioOverview?.pages?.length ? studioOverview.pages : pageOptions;
  const agentOptions = useMemo(
    () => (
      agents.length
        ? agents
        : [{ id: DEFAULT_STUDIO_AGENT_ID, label: 'Dreamy Miniapp Executor', pageId: 'dreamy-miniapp', role: '', capabilities: [] }]
    ),
    [agents],
  );
  const changePage = useCallback((nextPageId: string) => {
    const nextPage = pages.find((page) => page.id === nextPageId) || null;
    setSelectedPageId(nextPageId);
    setSelectedAgentId(defaultAgentIdForPage(nextPage));
  }, [pages]);
  const selectOverviewPage = useCallback((nextPageId: string) => {
    changePage(nextPageId);
    setQueuePageFilter(nextPageId);
  }, [changePage]);
  const selectStarterPreset = useCallback((preset: StudioStarterPreset) => {
    setSelectedStarterPresetId(preset.id);
    setSelectedManualBotEntryId('');
    setSelectedPageId(preset.pageId);
    setSelectedAgentId(preset.agentId);
    setPrompt(preset.prompt);
    setActiveTab('preview');
    trackEvent('dreamy_studio_preset_selected', {
      preset_id: preset.id,
      bot_slug: preset.botSlug,
      page_id: preset.pageId,
    });
  }, []);
  const selectManualBotEntry = useCallback((entry: ManualBotEntry) => {
    setSelectedManualBotEntryId(entry.id);
    setSelectedPageId('dreamy-miniapp');
    setSelectedAgentId(DEFAULT_STUDIO_AGENT_ID);
    setActiveTab('preview');
    trackEvent('dreamy_studio_manual_bot_selected', {
      bot_id: entry.botId,
      bot_slug: entry.botSlug,
      bot_type: entry.botType,
    });
  }, []);
  const displayedHubJobs = useMemo(
    () => hubJobs.filter((job) => {
      if (queueStatusFilter !== 'all' && job.status !== queueStatusFilter) return false;
      if (queuePageFilter !== 'all' && job.pageId !== queuePageFilter && job.api !== queuePageFilter) return false;
      if (queueAgentFilter !== 'all' && job.agentId !== queueAgentFilter) return false;
      return true;
    }),
    [hubJobs, queueAgentFilter, queuePageFilter, queueStatusFilter],
  );
  const hubJobsVersion = useMemo(
    () => hubJobs.map((job) => `${job.jobId}:${job.status}:${job.updatedAt || ''}`).join('|'),
    [hubJobs],
  );
  const studioContextSourceSegmentId = useMemo(
    () =>
      selectedSegment?.id ||
      dispatchMatrix?.sourceSegmentId ||
      coverageReport?.sourceSegmentId ||
      handoffSnapshot?.sourceSegmentId ||
      project?.selectedSegmentId ||
      project?.segments?.[project.segments.length - 1]?.id,
    [
      coverageReport?.sourceSegmentId,
      dispatchMatrix?.sourceSegmentId,
      handoffSnapshot?.sourceSegmentId,
      project?.selectedSegmentId,
      project?.segments,
      selectedSegment?.id,
    ],
  );

  const applyHandoffSnapshot = useCallback((snapshot: StudioHandoffSnapshot) => {
    setHandoffSnapshot(snapshot);
    setStudioHealth(snapshot.reports.health);
    setStudioReadiness(snapshot.reports.readiness);
    setStudioOverview(snapshot.reports.overview);
    setDispatchMatrix(snapshot.reports.dispatchMatrix);
    setCoverageReport(snapshot.reports.coverage);
    setDeliveryReport(snapshot.reports.deliveryReport || null);
  }, []);

  const applyDispatchSession = useCallback((session: StudioDispatchSession) => {
    setDispatchSession(session);
    setDispatchBatchPlan({
      status: session.planStatus || session.status,
      readyForDispatch: session.readyForDispatch,
      checkedAt: session.checkedAt,
      projectId: session.projectId,
      sourceSegmentId: session.sourceSegmentId,
      sourceMediaUrl: session.sourceMediaUrl,
      summary: session.summary,
      targets: session.targets,
      skippedTargets: session.skippedTargets,
      matrix: session.matrix,
      handoffSnapshot: session.handoffSnapshot,
    });
    if (session.projectId) saveLastStudioProjectId(session.projectId);
    if (session.handoffSnapshot) applyHandoffSnapshot(session.handoffSnapshot);
  }, [applyHandoffSnapshot]);

  const applyDeliveryAudit = useCallback((audit: StudioDeliveryAudit) => {
    setDeliveryAudit(audit);
    setStudioHealth(audit.reports.health);
    setStudioReadiness(audit.reports.readiness);
    setStudioOverview(audit.reports.overview);
    setDispatchMatrix(audit.reports.dispatchMatrix);
    setCoverageReport(audit.reports.coverage);
    setDeliveryReport(audit.reports.deliveryReport || null);
    if (audit.reports.handoffSnapshot) {
      setHandoffSnapshot(audit.reports.handoffSnapshot);
    }
  }, []);

  const refreshDeliveryAudit = useCallback(
    async (options: { projectId?: string; sourceSegmentId?: string; interactive?: boolean } = {}) => {
      const interactive = options.interactive ?? true;
      if (interactive) setDeliveryAuditRefreshing(true);
      try {
        const audit = await fetchStudioDeliveryAudit({
          projectId: options.projectId ?? project?.projectId,
          sourceSegmentId: options.sourceSegmentId ?? studioContextSourceSegmentId,
        });
        applyDeliveryAudit(audit);
        return audit;
      } catch (error) {
        if (interactive) {
          setMessages((prev) => [
            ...prev,
            {
              id: makeId('assistant'),
              role: 'assistant',
              content: 'Delivery audit refresh failed.',
              error: error instanceof Error ? error.message : String(error),
              createdAt: nowIso(),
            },
          ]);
        }
        return null;
      } finally {
        if (interactive) setDeliveryAuditRefreshing(false);
      }
    },
    [applyDeliveryAudit, project?.projectId, studioContextSourceSegmentId],
  );

  const downloadDeliveryAudit = useCallback(() => {
    if (!deliveryAudit) return;
    const filename = deliveryAuditFilename(deliveryAudit);
    downloadJsonPayload(deliveryAudit, filename);
    setMessages((prev) => [
      ...prev,
      {
        id: makeId('assistant'),
        role: 'assistant',
        content: `Delivery audit downloaded ${filename}.`,
        createdAt: nowIso(),
      },
    ]);
  }, [deliveryAudit]);

  const refreshHandoffSnapshot = useCallback(
    async (options: { projectId?: string; sourceSegmentId?: string; interactive?: boolean } = {}) => {
      const interactive = options.interactive ?? true;
      if (interactive) setHandoffRefreshing(true);
      try {
        const snapshot = await fetchStudioHandoffSnapshot({
          projectId: options.projectId ?? project?.projectId,
          sourceSegmentId: options.sourceSegmentId ?? studioContextSourceSegmentId,
        });
        applyHandoffSnapshot(snapshot);
        return snapshot;
      } catch (error) {
        if (interactive) {
          setMessages((prev) => [
            ...prev,
            {
              id: makeId('assistant'),
              role: 'assistant',
              content: 'Handoff snapshot refresh failed.',
              error: error instanceof Error ? error.message : String(error),
              createdAt: nowIso(),
            },
          ]);
        }
        return null;
      } finally {
        if (interactive) setHandoffRefreshing(false);
      }
    },
    [applyHandoffSnapshot, project?.projectId, studioContextSourceSegmentId],
  );

  const refreshDeliveryBundle = useCallback(async () => {
    if (deliveryBundleLoading) return null;
    const projectId = project?.projectId || readLastStudioProjectId() || undefined;
    if (!projectId) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: 'Delivery bundle needs a restored Studio project first.',
          createdAt: nowIso(),
        },
      ]);
      return null;
    }
    setDeliveryBundleLoading(true);
    try {
      const bundle = await fetchStudioProjectDeliveryBundle({
        projectId,
        sourceSegmentId: studioContextSourceSegmentId,
      });
      setDeliveryBundle(bundle);
      applyHandoffSnapshot(bundle.reports.handoffSnapshot);
      setDeliveryReport(bundle.reports.deliveryReport);
      setCoverageReport(bundle.reports.coverage);
      const filename = deliveryBundleFilename(bundle);
      downloadJsonPayload(bundle, filename);
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: `Delivery bundle ${bundle.status}: ${bundle.summary.acceptedJobs} accepted jobs, ${bundle.summary.completedTargets} completed targets, ${bundle.summary.artifacts} artifacts. Downloaded ${filename}.`,
          createdAt: nowIso(),
        },
      ]);
      return bundle;
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: 'Delivery bundle refresh failed.',
          error: error instanceof Error ? error.message : String(error),
          createdAt: nowIso(),
        },
      ]);
      return null;
    } finally {
      setDeliveryBundleLoading(false);
    }
  }, [applyHandoffSnapshot, deliveryBundleLoading, project?.projectId, studioContextSourceSegmentId]);

  const planDispatchBatch = useCallback(async (options: { excludeCovered?: boolean; pageIds?: string[] } = {}) => {
    if (dispatchBatchPlanning) return;
    const pageIds = options.pageIds?.length ? options.pageIds : undefined;
    setDispatchBatchPlanning(true);
    try {
      const projectId = project?.projectId || readLastStudioProjectId() || undefined;
      let plan: StudioDispatchBatchPlan;
      try {
        plan = await planStudioDispatchBatch({
          projectId,
          sourceSegmentId: studioContextSourceSegmentId,
          pageIds,
          limit: 50,
          excludeCovered: options.excludeCovered,
        });
      } catch (error) {
        if (!projectId || !isMissingStudioProjectError(error)) throw error;
        forgetLastStudioProjectId();
        plan = await planStudioDispatchBatch({
          sourceSegmentId: studioContextSourceSegmentId,
          pageIds,
          limit: 50,
          excludeCovered: options.excludeCovered,
        });
      }
      setDispatchBatchPlan(plan);
      applyHandoffSnapshot(plan.handoffSnapshot);
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: `${pageIds ? 'Selected batch' : options.excludeCovered ? 'Remaining batch' : 'Batch dispatch'} planned ${plan.summary.planned} target${plan.summary.planned === 1 ? '' : 's'}; skipped ${plan.summary.skipped}.`,
          createdAt: nowIso(),
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: 'Batch dispatch planning failed.',
          error: error instanceof Error ? error.message : String(error),
          createdAt: nowIso(),
        },
      ]);
    } finally {
      setDispatchBatchPlanning(false);
    }
  }, [applyHandoffSnapshot, dispatchBatchPlanning, project?.projectId, studioContextSourceSegmentId]);

  const startDispatchSession = useCallback(async (options: { pageIds?: string[] } = {}) => {
    if (dispatchSessionRunning) return;
    const pageIds = options.pageIds?.length ? options.pageIds : undefined;
    setDispatchSessionRunning(true);
    try {
      const projectId = project?.projectId || readLastStudioProjectId() || undefined;
      let session: StudioDispatchSession;
      try {
        session = await createStudioDispatchSession({
          projectId,
          sourceSegmentId: studioContextSourceSegmentId,
          pageIds,
          limit: 50,
          excludeCovered: Boolean(dispatchBatchPlan?.excludeCovered),
        });
      } catch (error) {
        if (!projectId || !isMissingStudioProjectError(error)) throw error;
        forgetLastStudioProjectId();
        session = await createStudioDispatchSession({
          sourceSegmentId: studioContextSourceSegmentId,
          pageIds,
          limit: 50,
          excludeCovered: Boolean(dispatchBatchPlan?.excludeCovered),
        });
      }
      applyDispatchSession(session);
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: `${pageIds ? 'Selected dispatch queue' : 'Dispatch queue'} started with ${session.summary.pending} pending target${session.summary.pending === 1 ? '' : 's'}.`,
          createdAt: nowIso(),
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: 'Dispatch queue start failed.',
          error: error instanceof Error ? error.message : String(error),
          createdAt: nowIso(),
        },
      ]);
    } finally {
      setDispatchSessionRunning(false);
    }
  }, [applyDispatchSession, dispatchBatchPlan?.excludeCovered, dispatchSessionRunning, project?.projectId, studioContextSourceSegmentId]);

  const cancelDispatchSession = useCallback(async () => {
    if (!dispatchSession?.sessionId || dispatchSessionRunning) return;
    setDispatchSessionRunning(true);
    try {
      const session = await cancelStudioDispatchSession(dispatchSession.sessionId);
      applyDispatchSession(session);
      const snapshot = await refreshHandoffSnapshot({
        projectId: session.projectId || project?.projectId,
        sourceSegmentId: session.sourceSegmentId || studioContextSourceSegmentId,
        interactive: false,
      });
      if (snapshot) {
        setDispatchBatchPlan((current) => current ? { ...current, handoffSnapshot: snapshot } : current);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: `Dispatch queue cancelled; ${session.summary.targetCancelled || 0} target${session.summary.targetCancelled === 1 ? '' : 's'} stopped.`,
          createdAt: nowIso(),
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: 'Dispatch queue cancel failed.',
          error: error instanceof Error ? error.message : String(error),
          createdAt: nowIso(),
        },
      ]);
    } finally {
      setDispatchSessionRunning(false);
    }
  }, [
    applyDispatchSession,
    dispatchSession?.sessionId,
    dispatchSessionRunning,
    project?.projectId,
    refreshHandoffSnapshot,
    studioContextSourceSegmentId,
  ]);

  const retryDispatchSession = useCallback(async () => {
    if (!dispatchSession?.sessionId || dispatchSessionRunning) return;
    setDispatchSessionRunning(true);
    try {
      const session = await retryStudioDispatchSession(dispatchSession.sessionId);
      applyDispatchSession(session);
      const snapshot = await refreshHandoffSnapshot({
        projectId: session.projectId || project?.projectId,
        sourceSegmentId: session.sourceSegmentId || studioContextSourceSegmentId,
        interactive: false,
      });
      if (snapshot) {
        setDispatchBatchPlan((current) => current ? { ...current, handoffSnapshot: snapshot } : current);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: `Dispatch queue retry opened ${session.summary.pending} pending target${session.summary.pending === 1 ? '' : 's'}.`,
          createdAt: nowIso(),
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: 'Dispatch queue retry failed.',
          error: error instanceof Error ? error.message : String(error),
          createdAt: nowIso(),
        },
      ]);
    } finally {
      setDispatchSessionRunning(false);
    }
  }, [
    applyDispatchSession,
    dispatchSession?.sessionId,
    dispatchSessionRunning,
    project?.projectId,
    refreshHandoffSnapshot,
    studioContextSourceSegmentId,
  ]);

  const completeDispatchSessionTarget = useCallback(
    async (target: StudioDispatchSessionTarget) => {
      if (!dispatchSession?.sessionId || dispatchSessionRunning) return;
      setDispatchSessionRunning(true);
      try {
        const session = await updateStudioDispatchSessionTarget({
          sessionId: dispatchSession.sessionId,
          targetId: target.id,
          status: 'completed',
          evidence: {
            accepted: true,
            completedFrom: 'studio',
            pageId: target.pageId,
            navigationPath: target.navigationPath || '',
          },
        });
        setDispatchSession(session);
        const snapshot = await refreshHandoffSnapshot({
          projectId: session.projectId || project?.projectId,
          sourceSegmentId: session.sourceSegmentId || studioContextSourceSegmentId,
          interactive: false,
        });
        if (snapshot) {
          setDispatchBatchPlan((current) => current ? { ...current, handoffSnapshot: snapshot } : current);
        }
        setMessages((prev) => [
          ...prev,
          {
            id: makeId('assistant'),
            role: 'assistant',
            content: `${target.pageName} marked done; ${session.summary.pending} target${session.summary.pending === 1 ? '' : 's'} pending.`,
            createdAt: nowIso(),
          },
        ]);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId('assistant'),
            role: 'assistant',
            content: 'Dispatch queue update failed.',
            error: error instanceof Error ? error.message : String(error),
            createdAt: nowIso(),
          },
        ]);
      } finally {
        setDispatchSessionRunning(false);
      }
    },
    [dispatchSession?.sessionId, dispatchSessionRunning, project?.projectId, refreshHandoffSnapshot, studioContextSourceSegmentId],
  );

  const reviewDispatchSessionTarget = useCallback(
    async (target: StudioDispatchSessionTarget, status: 'skipped' | 'error') => {
      if (!dispatchSession?.sessionId || dispatchSessionRunning) return;
      setDispatchSessionRunning(true);
      try {
        const isError = status === 'error';
        const session = await updateStudioDispatchSessionTarget({
          sessionId: dispatchSession.sessionId,
          targetId: target.id,
          status,
          evidence: isError
            ? {
                message: 'Operator marked this dispatch target as broken from Studio.',
                pageId: target.pageId,
                navigationPath: target.navigationPath || '',
              }
            : {
                reason: 'operator skipped from Studio dispatch queue',
                pageId: target.pageId,
                navigationPath: target.navigationPath || '',
              },
        });
        setDispatchSession(session);
        const snapshot = await refreshHandoffSnapshot({
          projectId: session.projectId || project?.projectId,
          sourceSegmentId: session.sourceSegmentId || studioContextSourceSegmentId,
          interactive: false,
        });
        if (snapshot) {
          setDispatchBatchPlan((current) => current ? { ...current, handoffSnapshot: snapshot } : current);
        }
        setMessages((prev) => [
          ...prev,
          {
            id: makeId('assistant'),
            role: 'assistant',
            content: `${target.pageName} marked ${isError ? 'error' : 'skipped'}; ${session.summary.pending} target${session.summary.pending === 1 ? '' : 's'} pending.`,
            createdAt: nowIso(),
          },
        ]);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId('assistant'),
            role: 'assistant',
            content: 'Dispatch queue review update failed.',
            error: error instanceof Error ? error.message : String(error),
            createdAt: nowIso(),
          },
        ]);
      } finally {
        setDispatchSessionRunning(false);
      }
    },
    [dispatchSession?.sessionId, dispatchSessionRunning, project?.projectId, refreshHandoffSnapshot, studioContextSourceSegmentId],
  );

  const openDispatchBatchTarget = useCallback(
    async (target: StudioDispatchBatchTarget | StudioDispatchSessionTarget) => {
      const targetPath = normalizeStudioNavigationPath(target.navigationPath);
      if (!targetPath) return;
      const projectId = target.projectId || dispatchSession?.projectId || project?.projectId || '';
      if (projectId) saveLastStudioProjectId(projectId);
      if (dispatchSession?.sessionId && 'status' in target) {
        setDispatchSessionRunning(true);
        try {
          const session = await updateStudioDispatchSessionTarget({
            sessionId: dispatchSession.sessionId,
            targetId: target.id,
            status: 'visited',
            evidence: {
              openedFrom: 'studio',
              pageId: target.pageId,
              navigationPath: targetPath,
            },
          });
          setDispatchSession(session);
        } catch (error) {
          setMessages((prev) => [
            ...prev,
            {
              id: makeId('assistant'),
              role: 'assistant',
              content: 'Dispatch queue visit could not be saved.',
              error: error instanceof Error ? error.message : String(error),
              createdAt: nowIso(),
            },
          ]);
          setDispatchSessionRunning(false);
          return;
        }
        setDispatchSessionRunning(false);
      }
      saveStudioDispatchSession({
        projectId,
        sessionId: dispatchSession?.sessionId,
        targetId: target.id,
        pageId: String(target.pageId),
        pageName: target.pageName,
        navigationPath: targetPath,
        studioReturnPath: target.studioReturnPath || '/dreamy',
      });
      navigate(buildStudioDispatchNavigationPath(targetPath, {
        projectId,
        sessionId: dispatchSession?.sessionId,
        targetId: target.id,
        pageId: String(target.pageId),
        studioReturnPath: target.studioReturnPath || '/dreamy',
      }));
    },
    [dispatchSession?.projectId, dispatchSession?.sessionId, navigate, project?.projectId],
  );

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchStudioPages().catch(() => []),
      fetchStudioAgents().catch(() => []),
      fetchStudioBotPreviews().catch(() => null),
      fetchStudioHealth().catch(() => null),
      fetchStudioOverview().catch(() => null),
      fetchStudioReadiness().catch(() => null),
      fetchStudioDeliveryAudit().catch(() => null),
      fetchStudioDispatchMatrix().catch(() => null),
      fetchStudioCoverage().catch(() => null),
    ]).then(([nextPages, nextAgents, nextBotPreviews, nextHealth, nextOverview, nextReadiness, nextAudit, nextMatrix, nextCoverage]) => {
      if (cancelled) return;
      setPages(nextPages);
      setAgents(nextAgents);
      setBotPreviews(nextBotPreviews);
      setStudioHealth(nextHealth);
      setStudioOverview(nextOverview);
      setStudioReadiness(nextReadiness);
      if (nextAudit) applyDeliveryAudit(nextAudit);
      setDispatchMatrix(nextMatrix);
      setCoverageReport(nextCoverage);
      setSelectedPageId((current) =>
        nextPages.length && !nextPages.some((page) => page.id === current) ? nextPages[0].id : current,
      );
      setSelectedAgentId((current) => (nextAgents.some((agent) => agent.id === current) ? current : DEFAULT_STUDIO_AGENT_ID));
    });
    return () => {
      cancelled = true;
    };
  }, [applyDeliveryAudit]);

  useEffect(() => {
    if (!selectedPage || !agents.length) return;
    setSelectedAgentId((current) => {
      if (agents.some((agent) => agent.id === current)) return current;
      const fallback = defaultAgentIdForPage(selectedPage);
      return agents.some((agent) => agent.id === fallback) ? fallback : agents[0].id;
    });
  }, [agents, selectedPage]);

  useEffect(() => {
    let cancelled = false;
    const context = {
      projectId: project?.projectId,
      sourceSegmentId: selectedSegment?.id,
    };
    void Promise.all([
      fetchStudioDispatchMatrix(context).catch(() => null),
      fetchStudioCoverage(context).catch(() => null),
      fetchStudioHandoffSnapshot(context).catch(() => null),
      fetchStudioDeliveryAudit(context).catch(() => null),
    ]).then(([matrix, coverage, handoff, audit]) => {
      if (cancelled) return;
      if (audit) {
        applyDeliveryAudit(audit);
        return;
      }
      if (handoff) {
        applyHandoffSnapshot(handoff);
        return;
      }
      if (matrix) setDispatchMatrix(matrix);
      if (coverage) setCoverageReport(coverage);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [applyDeliveryAudit, applyHandoffSnapshot, project?.projectId, selectedSegment?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storedProjects = await fetchStudioProjects(20).catch(() => []);
      if (cancelled) return;
      const lastProjectId = readLastStudioProjectId();
      const restored =
        lastProjectId && lastProjectId !== VERIFIED_WORKSHOP_PROJECT_ID
          ? storedProjects.find((item) => item.projectId === lastProjectId)
          : null;
      const restoredHasRenderableSegment = Boolean(
        restored?.segments?.some((segment) => segment.url || segment.posterUrl || segment.status === 'done'),
      );
      if (restored && restoredHasRenderableSegment) {
        setProject((current) => current || restored);
        saveLastStudioProjectId(restored.projectId);
        setMode(restored.mode || 'player');
        return;
      }

      const verifiedProject = await fetchVerifiedDreamyWorkshopProject().catch(() => createVerifiedWorkshopFallbackProject());
      if (cancelled) return;
      setProject((current) => current || verifiedProject);
      saveLastStudioProjectId(verifiedProject.projectId);
      setMode(verifiedProject.mode || 'player');
      setMessages((current) =>
        current.some((message) => message.id === 'verified-workshop-ready')
          ? current
          : [
              ...current,
              {
                id: 'verified-workshop-ready',
                role: 'assistant',
                content: 'Two completed Dreamy workshop bot results are staged in the timeline. Add segment extends it; Export packages the sequence.',
                createdAt: nowIso(),
                segmentId: verifiedProject.selectedSegmentId || undefined,
              },
            ],
      );
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreParams = readDispatchSessionRestoreParams();
    const savedSession = readStudioDispatchSession();
    const projectId = project?.projectId || savedSession?.projectId || readLastStudioProjectId() || undefined;
    const restore = async () => {
      const restoreCandidates: Array<{ sessionId: string; targetId: string | undefined; announce: boolean }> = [];
      if (restoreParams.sessionId) {
        restoreCandidates.push({ sessionId: restoreParams.sessionId, targetId: restoreParams.targetId, announce: true });
      }
      if (savedSession?.sessionId) {
        restoreCandidates.push({ sessionId: savedSession.sessionId, targetId: savedSession.targetId, announce: false });
      }

      for (const candidate of restoreCandidates) {
        const session = await fetchStudioDispatchSession(candidate.sessionId, { targetId: candidate.targetId }).catch(() => null);
        if (!session) continue;
        if (!cancelled) {
          applyDispatchSession(session);
          if (candidate.announce) {
            const restoreKey = `${session.sessionId}:${session.focusedTargetId || candidate.targetId || ''}`;
            if (restoredDispatchUrlRef.current !== restoreKey) {
              restoredDispatchUrlRef.current = restoreKey;
              const focusedTarget = session.focusedTarget || session.targets.find((target) => target.id === session.focusedTargetId);
              setMessages((prev) => [
                ...prev,
                {
                  id: makeId('assistant'),
                  role: 'assistant',
                  content: focusedTarget
                    ? `Dispatch queue restored at ${focusedTarget.pageName} (${focusedTarget.status}).`
                    : `Dispatch queue restored for ${session.sessionId}.`,
                  createdAt: nowIso(),
                },
              ]);
            }
          }
        }
        return;
      }
      if (!projectId) return;
      const [latestSession] = await fetchStudioDispatchSessions({ projectId, limit: 1 });
      if (!cancelled && latestSession) applyDispatchSession(latestSession);
    };
    void restore().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [applyDispatchSession, project?.projectId]);

  useEffect(() => {
    if (!project?.projectId) {
      setDeliveryReport(null);
      return;
    }
    let cancelled = false;
    void fetchStudioProjectDeliveryReport(project.projectId).then((report) => {
      if (!cancelled) setDeliveryReport(report);
    }).catch(() => {
      if (!cancelled) setDeliveryReport(null);
    });
    return () => {
      cancelled = true;
    };
  }, [hubJobsVersion, project?.projectId]);

  useEffect(() => {
    let cancelled = false;
    void fetchStudioJobs({
      limit: 50,
      status: queueStatusFilter === 'all' ? undefined : queueStatusFilter,
      pageId: queuePageFilter === 'all' ? undefined : queuePageFilter,
      agentId: queueAgentFilter === 'all' ? undefined : queueAgentFilter,
    }).then((storedJobs) => {
      if (!cancelled) setHubJobs(storedJobs);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [queueAgentFilter, queuePageFilter, queueStatusFilter]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchStudioOverview().catch(() => null),
      fetchStudioReadiness().catch(() => null),
      fetchStudioDispatchMatrix({
        projectId: project?.projectId,
        sourceSegmentId: selectedSegment?.id,
      }).catch(() => null),
      fetchStudioCoverage({
        projectId: project?.projectId,
        sourceSegmentId: selectedSegment?.id,
      }).catch(() => null),
      fetchStudioHandoffSnapshot({
        projectId: project?.projectId,
        sourceSegmentId: selectedSegment?.id,
      }).catch(() => null),
      fetchStudioDeliveryAudit({
        projectId: project?.projectId,
        sourceSegmentId: selectedSegment?.id,
      }).catch(() => null),
    ]).then(([overview, readiness, matrix, coverage, handoff, audit]) => {
      if (cancelled) return;
      if (audit) {
        applyDeliveryAudit(audit);
        return;
      }
      if (handoff) {
        applyHandoffSnapshot(handoff);
        return;
      }
      if (overview) setStudioOverview(overview);
      if (readiness) setStudioReadiness(readiness);
      if (matrix) setDispatchMatrix(matrix);
      if (coverage) setCoverageReport(coverage);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [applyDeliveryAudit, applyHandoffSnapshot, hubJobsVersion, project?.projectId, selectedSegment?.id]);

  useEffect(() => {
    if (!selectedPageId) return;
    let cancelled = false;
    void fetchStudioDispatchPreview({
      message: prompt,
      action: 'generate',
      projectId: project?.projectId,
      sourceSegmentId: selectedSegment?.id,
      pageId: selectedPageId,
      agentId: selectedAgentId,
      botId: selectedPageId === 'dreamy-miniapp' ? selectedManualBotEntry?.botId : undefined,
      articleId: selectedPageId === 'dreamy-miniapp' ? selectedManualBotEntry?.articleId : undefined,
      botSlug: selectedPageId === 'dreamy-miniapp' ? selectedManualBotEntry?.botSlug || selectedStarterPreset?.botSlug : undefined,
      botName: selectedPageId === 'dreamy-miniapp' ? selectedManualBotEntry?.botName || selectedStarterPreset?.title : undefined,
      botType: selectedPageId === 'dreamy-miniapp'
        ? selectedManualBotEntry?.botType || (selectedStarterPreset ? botTypeForStarterPreset(selectedStarterPreset) : undefined)
        : undefined,
      hasImage: Boolean(selectedFile),
    }).then((preview) => {
      if (!cancelled) setDispatchPreview(preview);
    }).catch(() => {
      if (!cancelled) setDispatchPreview(null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    project?.projectId,
    prompt,
    selectedAgentId,
    selectedFile,
    selectedManualBotEntry?.articleId,
    selectedManualBotEntry?.botId,
    selectedManualBotEntry?.botName,
    selectedManualBotEntry?.botSlug,
    selectedManualBotEntry?.botType,
    selectedPageId,
    selectedSegment?.id,
    selectedStarterPreset?.botSlug,
    selectedStarterPreset?.title,
    selectedStarterPreset?.workflow,
  ]);

  const mergeProject = useCallback((incoming: StudioProject) => {
    setProject((current) => mergeStudioProjectState(current, incoming));
    setHubJobs((current) => {
      const incomingJobs = new Map((incoming.jobs || []).map((job) => [job.jobId, job]));
      return [
        ...current.map((job) => incomingJobs.get(job.jobId) || job),
        ...(incoming.jobs || []).filter((job) => !current.some((currentJob) => currentJob.jobId === job.jobId)),
      ];
    });
    saveLastStudioProjectId(incoming.projectId);
    setMode(incoming.mode || 'player');
  }, []);

  const mergeJob = useCallback((job: StudioJob) => {
    setHubJobs((current) => [job, ...current.filter((item) => item.jobId !== job.jobId)]);
    setProject((prev) => {
      if (!prev) return prev;
      const jobs = [job, ...(prev.jobs || []).filter((item) => item.jobId !== job.jobId)];
      const segments = prev.segments.map((segment) =>
        segment.id === job.segmentId
          ? {
              ...segment,
              jobId: job.jobId,
              status: job.status,
              botId: job.botId || segment.botId,
              articleId: job.articleId || segment.articleId,
              taskId: job.taskId || segment.taskId,
              url: job.mediaUrl || segment.url,
              posterUrl: job.posterUrl || segment.posterUrl,
              authStatus: job.authStatus || segment.authStatus,
              evidence: job.evidence || segment.evidence,
              updatedAt: job.updatedAt || segment.updatedAt,
            }
          : segment,
      );
      return { ...prev, jobs, segments, updatedAt: nowIso() };
    });
  }, []);

  useEffect(() => {
    const jobId = selectedSegment?.jobId || selectedJob?.jobId;
    const currentStatus = selectedJob?.status || selectedSegment?.status;
    if (!project?.projectId || !jobId || hasTelegramInitData() || !isTransientStudioStatus(currentStatus)) return;

    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await pollStudioJob(jobId);
        if (cancelled) return;
        if (result.project) mergeProject(result.project);
        else mergeJob(result.job);

        if (!isTransientStudioStatus(result.job.status)) {
          const noticeKey = `${jobId}:${result.job.status}`;
          if (autoPollNoticeRef.current[jobId] !== noticeKey) {
            autoPollNoticeRef.current[jobId] = noticeKey;
            setMessages((prev) => [
              ...prev,
              {
                id: makeId('assistant'),
                role: 'assistant',
                content:
                  result.job.status === 'done'
                    ? 'Auto-refresh attached the generated media.'
                    : `Auto-refresh returned ${result.job.status}.`,
                error: result.job.status === 'auth_missing' ? result.job.authStatus?.message : undefined,
                createdAt: nowIso(),
              },
            ]);
          }
        }
      } catch {
        // Auto-refresh is opportunistic; the manual Refresh button keeps the explicit failure path visible.
      } finally {
        polling = false;
      }
    };

    const initialTimer = window.setTimeout(poll, 900);
    const intervalTimer = window.setInterval(poll, 4200);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalTimer);
    };
  }, [
    mergeJob,
    mergeProject,
    project?.projectId,
    selectedJob?.jobId,
    selectedJob?.status,
    selectedSegment?.jobId,
    selectedSegment?.status,
  ]);

  const updateAssistant = useCallback((id: string, patch: Partial<ChatItem>) => {
    setMessages((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const appendAssistantStep = useCallback((id: string, step: StudioProgressEvent) => {
    setMessages((prev) =>
      prev.map((item) => (item.id === id ? { ...item, steps: [...(item.steps || []), step] } : item)),
    );
  }, []);

  const registerClientExecution = useCallback(
    async (request: StudioExecutionRequest, projectId: string, fileForRequest: File | null, assistantId: string) => {
      const sourceUrl = request.sourceSegment?.url || request.sourceSegment?.posterUrl;
      const expectedType: StudioSegment['type'] = request.botType === 'image-to-video' ? 'video' : 'image';
      await postStudioClientResult(projectId, {
        segmentId: request.segmentId,
        jobId: request.jobId,
        status: 'running',
        type: expectedType,
        prompt: request.prompt,
        botId: request.botId,
        articleId: request.articleId,
        botSlug: request.botSlug,
        botName: request.botName,
        action: request.action,
        parentSegmentId: request.sourceSegment?.id,
        posterUrl: request.segment.posterUrl,
        authStatus: request.authStatus,
        source: request.api,
        dispatchSessionId: request.dispatchSessionId,
        dispatchTargetId: request.dispatchTargetId,
      }).then((result) => mergeProject(result.project));
      appendAssistantStep(assistantId, {
        step: 'handoff',
        message: 'Queued locally; media result will attach when ready',
        progress: 38,
      });
      updateAssistant(assistantId, {
        pending: true,
        segmentId: request.segmentId,
        content: 'Segment accepted locally; Dreamy media is being prepared.',
      });

      if (!hasTelegramInitData()) {
        const authStatus = {
          status: 'auth_missing',
          mode: 'telegram-init-data',
          message: 'Open Dreamy inside Telegram or provide init data before running the miniapp.',
        };
        const update = await postStudioClientResult(projectId, {
          segmentId: request.segmentId,
          jobId: request.jobId,
          status: 'auth_missing',
          type: expectedType,
          prompt: request.prompt,
          botId: request.botId,
          articleId: request.articleId,
          botSlug: request.botSlug,
          botName: request.botName,
          action: request.action,
          parentSegmentId: request.sourceSegment?.id,
          posterUrl: request.segment.posterUrl,
          authStatus,
          evidence: {
            status: 'auth_missing',
            source: request.api,
            accepted: false,
            message: 'Dreamy Miniapp auth is missing; no external generation request was sent.',
            checkedAt: nowIso(),
          },
          source: request.api,
          dispatchSessionId: request.dispatchSessionId,
          dispatchTargetId: request.dispatchTargetId,
        });
        mergeProject(update.project);
        updateAssistant(assistantId, {
          pending: false,
          segmentId: request.segmentId,
          content: 'Dreamy Miniapp needs Telegram auth before it can run.',
          error: authStatus.message,
        });
        return;
      }

      try {
        appendAssistantStep(assistantId, {
          step: 'miniapp',
          message: `Submitting ${request.botName}`,
          progress: 52,
        });
        const job = await withTimeout(
          submitDreamyMiniappJob({
            slugId: request.botSlug || DEFAULT_DREAMY_SLUG,
            botId: request.botId,
            articleId: request.articleId,
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
          jobId: request.jobId,
          status,
          type: expectedType,
          url: media.url,
          posterUrl: media.posterUrl || request.segment.posterUrl,
          prompt: request.prompt,
          botId: request.botId,
          articleId: request.articleId,
          botSlug: request.botSlug,
          botName: request.botName,
          action: request.action,
          parentSegmentId: request.sourceSegment?.id,
          taskId: job.response.outputJobId,
          source: request.api,
          dispatchSessionId: request.dispatchSessionId,
          dispatchTargetId: request.dispatchTargetId,
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
          jobId: request.jobId,
          status: 'error',
          type: expectedType,
          posterUrl: request.segment.posterUrl,
          prompt: request.prompt,
          botId: request.botId,
          articleId: request.articleId,
          botSlug: request.botSlug,
          botName: request.botName,
          action: request.action,
          parentSegmentId: request.sourceSegment?.id,
          source: request.api,
          dispatchSessionId: request.dispatchSessionId,
          dispatchTargetId: request.dispatchTargetId,
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

  const resolveAuditAction = useCallback(async (action: StudioHandoffAction) => {
    if (resolvingAuditActionId) return;
    const targetId = action.targetId || action.pageId || action.segmentId || action.jobId || action.id;
    if (!targetId) return;
    setResolvingAuditActionId(action.id);
    try {
      const result = await resolveStudioAction({
        action: action.action,
        targetId,
        sessionId: action.sessionId,
        projectId: project?.projectId || deliveryAudit?.projectId || undefined,
        sourceSegmentId: studioContextSourceSegmentId || deliveryAudit?.sourceSegmentId || undefined,
      });

      if (isDispatchTargetRunResult(result.result)) {
        const targetRun = result.result;
        applyDispatchSession(targetRun.session);
        if (targetRun.project) mergeProject(targetRun.project);
        if (targetRun.job) mergeJob(targetRun.job);
        applyDeliveryAudit(result.audit);

        const assistantId = makeId('assistant');
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: `Running audit dispatch target ${targetRun.target.pageName || targetRun.target.pageId || targetRun.target.id}...`,
            pending: true,
            createdAt: nowIso(),
            steps: [{ step: 'dispatch-target', message: 'Audit action materialized queued target', progress: 35 }],
          },
        ]);

        const request = targetRun.executionRequest;
        if (request?.executor === 'client') {
          await registerClientExecution(
            request,
            targetRun.project?.projectId || targetRun.job?.projectId || targetRun.session.projectId || project?.projectId || '',
            null,
            assistantId,
          );
          const restored = await fetchStudioDispatchSession(targetRun.session.sessionId, { targetId: targetRun.target.id }).catch(() => null);
          if (restored) applyDispatchSession(restored);
        } else if (request?.executor === 'server') {
          updateAssistant(assistantId, {
            pending: false,
            content: `Audit dispatch target queued for ${targetRun.target.pageName || targetRun.target.pageId}.`,
            segmentId: request.segmentId,
          });
        } else {
          updateAssistant(assistantId, {
            pending: false,
            content: `Audit dispatch target ${targetRun.target.pageName || targetRun.target.pageId || targetRun.target.id} is ready for operator review.`,
          });
        }

        const refreshedAudit = await fetchStudioDeliveryAudit({
          projectId: targetRun.session.projectId || result.projectId || project?.projectId || undefined,
          sourceSegmentId: targetRun.session.sourceSegmentId || result.sourceSegmentId || studioContextSourceSegmentId || undefined,
        }).catch(() => null);
        if (refreshedAudit) applyDeliveryAudit(refreshedAudit);
        return;
      }

      if (isDispatchSessionRetryResult(result.result)) {
        const retrySession = result.result.session;
        applyDispatchSession(retrySession);
        applyDeliveryAudit(result.audit);
        setMessages((prev) => [
          ...prev,
          {
            id: makeId('assistant'),
            role: 'assistant',
            content: `Dispatch queue retried; ${retrySession.summary.pending} target${retrySession.summary.pending === 1 ? '' : 's'} pending.`,
            createdAt: nowIso(),
          },
        ]);
        return;
      }

      if (result.result && 'project' in result.result && result.result.project) mergeProject(result.result.project);
      if (result.result && 'jobs' in result.result) result.result.jobs?.forEach((job) => mergeJob(job));
      applyDeliveryAudit(result.audit);
      const nextMessage = formatStudioActionNext(result.next);
      const created = result.result && 'createdCount' in result.result ? result.result.createdCount ?? 0 : 0;
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content:
            result.resultType === 'coverage-verify'
              ? `Audit action ${result.action} resolved for ${result.targetId}; verified ${created} target${created === 1 ? '' : 's'}.`
              : `Audit action ${result.action} needs operator follow-up.${nextMessage}`,
          createdAt: nowIso(),
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: `Audit action ${action.action} could not be resolved.`,
          error: error instanceof Error ? error.message : String(error),
          createdAt: nowIso(),
        },
      ]);
    } finally {
      setResolvingAuditActionId(null);
    }
  }, [
    applyDeliveryAudit,
    applyDispatchSession,
    deliveryAudit?.projectId,
    deliveryAudit?.sourceSegmentId,
    fetchStudioDispatchSession,
    fetchStudioDeliveryAudit,
    mergeJob,
    mergeProject,
    project?.projectId,
    registerClientExecution,
    resolvingAuditActionId,
    studioContextSourceSegmentId,
    updateAssistant,
  ]);

  const resolveSafeAuditActions = useCallback(async () => {
    if (resolvingAuditBatch || resolvingAuditActionId || !deliveryAudit) return;
    const safeActions = deliveryAudit.actions
      .filter((action) => action.action === 'verify-ready' || action.action === 'run-target' || action.action === 'retry-queue')
      .map((action) => ({
        action: action.action,
        targetId: action.targetId || action.pageId || action.segmentId || action.jobId || action.id,
        sessionId: action.sessionId,
      }))
      .filter((action) => Boolean(action.targetId));
    if (!safeActions.length) return;
    setResolvingAuditBatch(true);
    try {
      const result = await resolveStudioActionsBatch({
        projectId: project?.projectId || deliveryAudit.projectId || undefined,
        sourceSegmentId: studioContextSourceSegmentId || deliveryAudit.sourceSegmentId || undefined,
        actions: safeActions,
      });
      if (result.result?.project) mergeProject(result.result.project);
      result.result?.jobs?.forEach((job) => mergeJob(job));
      applyDeliveryAudit(result.audit);
      let dispatchedTargets = 0;
      for (const executedAction of result.executedActions) {
        if (!isDispatchTargetRunResult(executedAction.result)) continue;
        const targetRun = executedAction.result;
        dispatchedTargets += 1;
        applyDispatchSession(targetRun.session);
        if (targetRun.project) mergeProject(targetRun.project);
        if (targetRun.job) mergeJob(targetRun.job);

        const assistantId = makeId('assistant');
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: `Running batch audit target ${targetRun.target.pageName || targetRun.target.pageId || targetRun.target.id}...`,
            pending: true,
            createdAt: nowIso(),
            steps: [{ step: 'dispatch-target', message: 'Batch audit action materialized queued target', progress: 35 }],
          },
        ]);

        const request = targetRun.executionRequest;
        if (request?.executor === 'client') {
          await registerClientExecution(
            request,
            targetRun.project?.projectId || targetRun.job?.projectId || targetRun.session.projectId || project?.projectId || '',
            null,
            assistantId,
          );
          const restored = await fetchStudioDispatchSession(targetRun.session.sessionId, { targetId: targetRun.target.id }).catch(() => null);
          if (restored) applyDispatchSession(restored);
        } else if (request?.executor === 'server') {
          updateAssistant(assistantId, {
            pending: false,
            content: `Batch audit target queued for ${targetRun.target.pageName || targetRun.target.pageId}.`,
            segmentId: request.segmentId,
          });
        } else {
          updateAssistant(assistantId, {
            pending: false,
            content: `Batch audit target ${targetRun.target.pageName || targetRun.target.pageId || targetRun.target.id} is ready for operator review.`,
          });
        }
      }
      for (const executedAction of result.executedActions) {
        if (!isDispatchSessionRetryResult(executedAction.result)) continue;
        applyDispatchSession(executedAction.result.session);
      }
      if (dispatchedTargets) {
        const refreshedAudit = await fetchStudioDeliveryAudit({
          projectId: project?.projectId || result.projectId || deliveryAudit.projectId || undefined,
          sourceSegmentId: studioContextSourceSegmentId || result.sourceSegmentId || deliveryAudit.sourceSegmentId || undefined,
        }).catch(() => null);
        if (refreshedAudit) applyDeliveryAudit(refreshedAudit);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: `Resolved ${result.summary.executed} safe audit action${result.summary.executed === 1 ? '' : 's'}; ${dispatchedTargets} dispatch target${dispatchedTargets === 1 ? '' : 's'} ran.`,
          createdAt: nowIso(),
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: 'Safe audit actions could not be resolved.',
          error: error instanceof Error ? error.message : String(error),
          createdAt: nowIso(),
        },
      ]);
    } finally {
      setResolvingAuditBatch(false);
    }
  }, [
    applyDeliveryAudit,
    applyDispatchSession,
    deliveryAudit,
    fetchStudioDeliveryAudit,
    fetchStudioDispatchSession,
    mergeJob,
    mergeProject,
    project?.projectId,
    registerClientExecution,
    resolvingAuditActionId,
    resolvingAuditBatch,
    studioContextSourceSegmentId,
    updateAssistant,
  ]);

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

  const runStudio = useCallback(
    async (
      action: StudioAction = 'generate',
      overridePrompt?: string,
      source?: StudioSegment | null,
      dispatchOverride?: StudioDispatchRunOverride,
    ) => {
      if (submitting) return;
      const text = (overridePrompt || prompt).trim();
      const targetMode = dispatchOverride?.mode || mode;
      const targetPage = dispatchOverride?.pageId
        ? pages.find((page) => page.id === dispatchOverride.pageId) || selectedPage
        : selectedPage;
      const targetPageId = dispatchOverride?.pageId || selectedPageId;
      const targetAgentId = dispatchOverride?.agentId || selectedAgentId;
      const targetPageName = dispatchOverride?.pageName || targetPage?.name || String(targetPageId);
      const targetExecutor = dispatchOverride?.executor || targetPage?.executor;
      const targetBotId = dispatchOverride?.botId || (targetPageId === 'dreamy-miniapp' ? selectedManualBotEntry?.botId : undefined);
      const targetArticleId = dispatchOverride?.articleId || (targetPageId === 'dreamy-miniapp' ? selectedManualBotEntry?.articleId : undefined);
      const targetBotSequence = dispatchOverride?.botSequence;
      const targetBotSlug = dispatchOverride?.botSlug || (
        targetPageId === 'dreamy-miniapp' ? selectedManualBotEntry?.botSlug || selectedStarterPreset?.botSlug : undefined
      );
      const targetBotName = dispatchOverride?.botName || (
        targetPageId === 'dreamy-miniapp' ? selectedManualBotEntry?.botName || selectedStarterPreset?.title : undefined
      );
      const targetBotType = dispatchOverride?.botType || (
        targetPageId === 'dreamy-miniapp'
          ? selectedManualBotEntry?.botType || (selectedStarterPreset ? botTypeForStarterPreset(selectedStarterPreset) : undefined)
          : undefined
      );
      const isNavigationDispatch = targetExecutor === 'navigation';
      const isMatrixDispatch = Boolean(dispatchOverride);
      if (!text && action === 'generate' && !isNavigationDispatch && !isMatrixDispatch) return;

      const runPrompt = text || {
        extend: 'Extend this into the next shot',
        restyle: 'Restyle this segment',
        'retry-agent': 'Try another agent for this segment',
        generate: isNavigationDispatch ? `Open ${targetPageName}` : `Dispatch ${targetPageName}`,
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
      setActiveTab('preview');
      trackEvent('dreamy_studio_run', {
        action,
        mode: targetMode,
        page_id: targetPageId,
        agent_id: targetAgentId,
        bot_id: targetBotId || '',
        bot_slug: targetBotSlug || '',
        bot_type: targetBotType || '',
        bot_sequence_count: targetBotSequence?.length || 0,
        has_image: Boolean(fileForRequest),
        source_segment_id: sourceSegment?.id || '',
      });

      const controller = new AbortController();
      abortRef.current = controller;
      let currentProjectId = project?.projectId || '';

      try {
        await streamStudioRun({
          message: runPrompt,
          mode: targetMode,
          action,
          projectId: project?.projectId,
          sourceSegmentId: sourceSegment?.id,
          pageId: targetPageId,
          agentId: targetAgentId,
          botId: targetBotId,
          articleId: targetArticleId,
          botSlug: targetBotSlug,
          botName: targetBotName,
          botType: targetBotType,
          botSequence: targetBotSequence,
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
                  jobs: [],
                  updatedAt: nowIso(),
                },
              );
              return;
            }
            if (rawEventName === 'route' && 'bot' in event) {
              updateAssistant(assistantId, {
                route: event,
                content:
                  event.executor === 'navigation' && event.page?.name
                    ? `Matched ${event.page.name}.`
                    : `Matched ${event.bot.name}.`,
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
              if (executionEvent.executor === 'client') {
                await registerClientExecution(executionEvent, currentProjectId, fileForRequest, assistantId);
              } else if (executionEvent.executor === 'navigation') {
                const targetPath = normalizeStudioNavigationPath(executionEvent.navigationPath);
                const missingRouteParams = executionEvent.missingRouteParams || [];
                if (missingRouteParams.length) {
                  updateAssistant(assistantId, {
                    pending: false,
                    segmentId: executionEvent.segmentId,
                    content: `Missing ${missingRouteParams.join(', ')} for ${executionEvent.page?.name || executionEvent.api}.`,
                    error: executionEvent.evidence?.message || `Missing route parameters: ${missingRouteParams.join(', ')}`,
                  });
                  return;
                }
                updateAssistant(assistantId, {
                  pending: false,
                  segmentId: executionEvent.segmentId,
                  content: targetPath
                    ? `Opening ${executionEvent.page?.name || executionEvent.api}.`
                    : `Dispatch target ready: ${executionEvent.page?.name || executionEvent.api}.`,
                });
                if (targetPath) {
                  saveLastStudioProjectId(currentProjectId);
                  saveStudioDispatchSession({
                    projectId: currentProjectId,
                    pageId: executionEvent.page?.id || executionEvent.api,
                    pageName: executionEvent.page?.name || executionEvent.api,
                    navigationPath: targetPath,
                    studioReturnPath: executionEvent.studioReturnPath || '/dreamy',
                  });
                  navigate(buildStudioDispatchNavigationPath(targetPath, {
                    projectId: currentProjectId,
                    pageId: executionEvent.page?.id || executionEvent.api,
                    studioReturnPath: executionEvent.studioReturnPath || '/dreamy',
                  }));
                }
              } else {
                updateAssistant(assistantId, {
                  pending: false,
                  segmentId: executionEvent.segmentId,
                  content:
                    executionEvent.authStatus?.status === 'auth_missing'
                      ? 'MyShell Art needs browser cookies before it can run.'
                      : `Server adapter queued ${executionEvent.botName}.`,
                  error: executionEvent.authStatus?.status === 'auth_missing' ? executionEvent.authStatus.message : undefined,
                });
              }
              return;
            }
            if (rawEventName === 'job' && 'job' in event) {
              mergeJob(event.job);
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
          const fallback = createLocalProject(targetMode, runPrompt, action, sourceSegment || undefined, project);
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
      mergeJob,
      pages,
      project,
      navigate,
      prompt,
      registerClientExecution,
      selectedFile,
      selectedAgentId,
      selectedPage,
      selectedPageId,
      selectedSegment,
      selectedManualBotEntry,
      selectedStarterPreset,
      submitting,
      updateAssistant,
    ],
  );

  const stopRun = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSubmitting(false);
  };

  const runStarterPreset = useCallback((preset: StudioStarterPreset, overridePrompt?: string) => {
    selectStarterPreset(preset);
    const promptText = overridePrompt?.trim() || preset.prompt;
    const verifiedSegment = findVerifiedWorkshopSegmentForBot(preset);
    if (verifiedSegment) {
      setActiveTab('preview');
      void (async () => {
        const verifiedProject = await fetchVerifiedDreamyWorkshopProject().catch(() => createVerifiedWorkshopFallbackProject());
        const selectedVerifiedSegment =
          verifiedProject.segments.find((segment) => verifiedWorkshopBotMatches(segment, preset)) || verifiedSegment;
        mergeProject({
          ...verifiedProject,
          mode,
          selectedSegmentId: selectedVerifiedSegment.id,
          updatedAt: nowIso(),
        });
        setMessages((prev) => [
          ...prev,
          {
            id: makeId('user'),
            role: 'user',
            content: promptText,
            action: selectedVerifiedSegment.action || getStarterPresetAction(preset, selectedSegment),
            createdAt: nowIso(),
          },
          {
            id: makeId('assistant'),
            role: 'assistant',
            content: `${preset.title} verified workshop result loaded into the timeline. Use Add segment to continue or Export to compose the long video.`,
            action: selectedVerifiedSegment.action || getStarterPresetAction(preset, selectedSegment),
            segmentId: selectedVerifiedSegment.id,
            createdAt: nowIso(),
          },
        ]);
        trackEvent('dreamy_verified_workshop_preset_loaded', {
          bot_slug: preset.botSlug,
          bot_id: preset.botId || '',
          segment_id: selectedVerifiedSegment.id,
        });
      })().catch((error) => {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId('assistant'),
            role: 'assistant',
            content: 'Verified workshop result could not be loaded.',
            error: error instanceof Error ? error.message : String(error),
            createdAt: nowIso(),
          },
        ]);
      });
      return;
    }
    setActiveTab('preview');
    setMessages((prev) => [
      ...prev,
      {
        id: makeId('user'),
        role: 'user',
        content: promptText,
        action: getStarterPresetAction(preset, selectedSegment),
        createdAt: nowIso(),
      },
      {
        id: makeId('assistant'),
        role: 'assistant',
        content: `${preset.title} is selected with its catalog preview. The visible timeline stays on verified media until a queued Dreamy generation returns usable output.`,
        action: getStarterPresetAction(preset, selectedSegment),
        createdAt: nowIso(),
      },
    ]);
    trackEvent('dreamy_catalog_preset_previewed', {
      bot_slug: preset.botSlug,
      bot_id: preset.botId || '',
      preview_source: preset.previewSource || '',
    });
  }, [mergeProject, mode, selectStarterPreset, selectedSegment]);

  const runManualBotEntry = useCallback((entry: ManualBotEntry) => {
    selectManualBotEntry(entry);
    void runStudio(entry.action, prompt || undefined, selectedSegment, {
      pageId: 'dreamy-miniapp',
      agentId: DEFAULT_STUDIO_AGENT_ID,
      pageName: 'Dreamy Miniapp',
      executor: 'client',
      mode,
      botId: entry.botId,
      articleId: entry.articleId,
      botSlug: entry.botSlug,
      botName: entry.botName,
      botType: entry.botType,
    });
  }, [mode, prompt, runStudio, selectManualBotEntry, selectedSegment]);

  const runManualBotSequence = useCallback(() => {
    if (manualBotEntries.length < 2) return;
    void runStudio('generate', prompt || 'Run the manual Dreamy bot sequence as connected media segments.', selectedSegment, {
      pageId: 'dreamy-miniapp',
      agentId: DEFAULT_STUDIO_AGENT_ID,
      pageName: 'Dreamy Miniapp',
      executor: 'client',
      mode,
      botSequence: manualBotEntries,
    });
  }, [manualBotEntries, mode, prompt, runStudio, selectedSegment]);

  const runMatrixEntry = useCallback((entry: StudioDispatchMatrixEntry) => {
    changePage(entry.pageId);
    setSelectedAgentId(entry.agentId);
    void runStudio('generate', undefined, selectedSegment, {
      pageId: entry.pageId,
      agentId: entry.agentId,
      pageName: entry.pageName,
      executor: entry.executor,
    });
  }, [changePage, runStudio, selectedSegment]);

  const runDispatchBatchTarget = useCallback(
    async (target: StudioDispatchBatchTarget | StudioDispatchSessionTarget) => {
      if (target.executor === 'navigation') {
        await openDispatchBatchTarget(target);
        return;
      }

      if (!('status' in target) || !dispatchSession?.sessionId) {
        changePage(String(target.pageId));
        if (target.agentId) setSelectedAgentId(target.agentId);
        void runStudio('generate', undefined, selectedSegment, {
          pageId: String(target.pageId),
          agentId: target.agentId || undefined,
          pageName: target.pageName,
          executor: target.executor as StudioExecutor,
        });
        return;
      }

      if (dispatchSessionRunning) return;
      const assistantId = makeId('assistant');
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: `Running queued ${target.pageName} target...`,
          pending: true,
          createdAt: nowIso(),
          steps: [{ step: 'dispatch-target', message: 'Materializing queued target', progress: 20 }],
        },
      ]);
      setDispatchSessionRunning(true);
      try {
        const result = await runStudioDispatchSessionTarget({
          sessionId: dispatchSession.sessionId,
          targetId: target.id,
        });
        applyDispatchSession(result.session);
        if (result.project) mergeProject(result.project);
        if (result.job) mergeJob(result.job);

        const request = result.executionRequest;
        if (request?.executor === 'client') {
          await registerClientExecution(
            request,
            result.project?.projectId || result.job?.projectId || dispatchSession.projectId || project?.projectId || '',
            null,
            assistantId,
          );
          const restored = await fetchStudioDispatchSession(dispatchSession.sessionId, { targetId: target.id }).catch(() => null);
          if (restored) applyDispatchSession(restored);
        } else if (request?.executor === 'server') {
          updateAssistant(assistantId, {
            pending: false,
            content: `Server dispatch target queued for ${target.pageName}.`,
            segmentId: request.segmentId,
          });
        } else {
          updateAssistant(assistantId, {
            pending: false,
            content: `${target.pageName} target is ready for operator review.`,
          });
        }

        const snapshot = await refreshHandoffSnapshot({
          projectId: result.session.projectId || project?.projectId,
          sourceSegmentId: result.session.sourceSegmentId || studioContextSourceSegmentId,
          interactive: false,
        });
        if (snapshot) {
          setDispatchBatchPlan((current) => current ? { ...current, handoffSnapshot: snapshot } : current);
        }
      } catch (error) {
        updateAssistant(assistantId, {
          pending: false,
          content: 'Queued dispatch target could not run.',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setDispatchSessionRunning(false);
      }
    },
    [
      applyDispatchSession,
      changePage,
      dispatchSession,
      dispatchSessionRunning,
      fetchStudioDispatchSession,
      mergeJob,
      mergeProject,
      openDispatchBatchTarget,
      project?.projectId,
      refreshHandoffSnapshot,
      registerClientExecution,
      runStudio,
      selectedSegment,
      studioContextSourceSegmentId,
      updateAssistant,
    ],
  );

  const toggleDispatchBatchPage = useCallback((pageId: string) => {
    setSelectedDispatchPageIds((current) => toggleStudioDispatchPageSelection(current, pageId));
  }, []);

  const selectDispatchBatchPages = useCallback((pageIds: string[]) => {
    setSelectedDispatchPageIds(Array.from(new Set(pageIds.filter(Boolean))));
  }, []);

  const clearDispatchBatchPages = useCallback(() => {
    setSelectedDispatchPageIds([]);
  }, []);

  const copyMatrixEntryLink = useCallback((entry: StudioDispatchMatrixEntry) => {
    const href = getStudioDispatchTargetHref(entry);
    if (!href) return;
    void copyTextToClipboard(absoluteAppHref(href));
  }, []);

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

  const exportAllSegments = useCallback(async () => {
    if (!project?.segments.length) return;
    const exportedAt = nowIso();
    const segments = project.segments.map((segment, index) => ({
      index: index + 1,
      segmentId: segment.id,
      type: segment.type,
      status: segment.status,
      prompt: segment.prompt,
      action: segment.action,
      botName: segment.botName,
      botSlug: segment.botSlug,
      taskId: segment.taskId,
      mediaUrl: resolveStudioDisplayAssetUrl(segment.url),
      posterUrl: resolveStudioDisplayAssetUrl(segment.posterUrl),
      evidence: segment.evidence,
    }));
    setTimelineExporting(true);
    try {
      const exportResult = await createStudioTimelineExport({ projectId: project.projectId });
      setProject((prev) => {
        if (!prev || prev.projectId !== project.projectId) return prev;
        const timelineExports = [
          exportResult,
          ...((prev.timelineExports || []).filter((item) => item.exportId !== exportResult.exportId)),
        ];
        return { ...prev, timelineExports, updatedAt: nowIso() };
      });
      const filename = `dreamy-timeline-export-${exportResult.exportId}.json`;
      downloadJsonPayload(exportResult, filename);
      setActiveTab('preview');
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: exportResult.mediaUrl
            ? `Timeline export ready: ${exportResult.summary.videoSegments} video segment${exportResult.summary.videoSegments === 1 ? '' : 's'} composed at ${resolveStudioAssetUrl(exportResult.mediaUrl)}. Downloaded ${filename}.`
            : `Timeline export ${exportResult.status}: ${exportResult.summary.totalSegments} segment${exportResult.summary.totalSegments === 1 ? '' : 's'} saved. ${exportResult.evidence?.message || 'Manifest is ready.'} Downloaded ${filename}.`,
          createdAt: exportResult.checkedAt || exportedAt,
        },
      ]);
    } catch (error) {
      const readySegments = segments.filter((segment) => Boolean(segment.mediaUrl || segment.posterUrl));
      const payload = {
        kind: 'dreamy-long-video-sequence',
        projectId: project.projectId,
        conversationId: project.conversationId,
        exportedAt,
        totalSegments: segments.length,
        readySegments: readySegments.length,
        estimatedDurationSeconds: segments.length * 5,
        exportMode: 'local-fallback',
        segments,
        error: error instanceof Error ? error.message : String(error),
      };
      const filename = `dreamy-long-video-${project.projectId || 'sequence'}.json`;
      downloadJsonPayload(payload, filename);
      setActiveTab('preview');
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: `Timeline export fallback: backend export could not finish, so a local manifest was downloaded as ${filename}.`,
          error: error instanceof Error ? error.message : String(error),
          createdAt: exportedAt,
        },
      ]);
    } finally {
      setTimelineExporting(false);
    }
  }, [project]);

  const resetProject = async () => {
    const projectId = project?.projectId;
    setProject(null);
    setHubJobs([]);
    setDeliveryReport(null);
    setDeliveryAudit(null);
    setCoverageReport(null);
    setHandoffSnapshot(null);
    setDeliveryBundle(null);
    setDispatchBatchPlan(null);
    setDispatchSession(null);
    forgetLastStudioProjectId();
    clearStudioDispatchSession();
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
    if (!hasTelegramInitData() && selectedSegment.jobId) {
      const result = await pollStudioJob(selectedSegment.jobId).catch((error) => {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId('assistant'),
            role: 'assistant',
            content: 'Server result poll failed.',
            error: error instanceof Error ? error.message : String(error),
            createdAt: nowIso(),
          },
        ]);
        return null;
      });
      if (!result) return;
      if (result.project) mergeProject(result.project);
      else mergeJob(result.job);
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content:
            result.job.status === 'done'
              ? 'Server poll accepted fresh Dreamy media.'
              : `Server poll returned ${result.job.status}.`,
          createdAt: nowIso(),
        },
      ]);
      return;
    }
    const result = await fetchGenerateResult(selectedSegment.taskId).catch(() => null);
    const media = extractGenerateTaskMedia(result);
    const status = media.status === 'completed' || media.status === 'success' || media.status === 'done' ? 'done' : selectedSegment.status;
    const update = await postStudioClientResult(project.projectId, {
      segmentId: selectedSegment.id,
      jobId: selectedSegment.jobId,
      status,
      type: selectedSegment.type,
      url: media.url,
      posterUrl: media.posterUrl || selectedSegment.posterUrl,
      taskId: selectedSegment.taskId,
      source: selectedJob?.api || 'dreamy-miniapp',
    }).catch(() => null);
    if (update) mergeProject(update.project);
  };

  const cancelJob = async (jobId: string) => {
    const result = await cancelStudioJob(jobId).catch(() => null);
    if (!result) return;
    if (result.project) mergeProject(result.project);
    else mergeJob(result.job);
  };

  const retryJob = async (jobId: string) => {
    const assistantId = makeId('assistant');
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: 'Retrying queued job...',
        pending: true,
        createdAt: nowIso(),
        steps: [{ step: 'retry', message: 'Recovering persisted job context', progress: 18 }],
      },
    ]);
    const result = await retryStudioJob(jobId).catch((error) => {
      updateAssistant(assistantId, {
        pending: false,
        content: 'Retry could not be queued.',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (!result) return;
    if (result.project) mergeProject(result.project);
    else mergeJob(result.job);
    const request = result.executionRequest;
    if (request?.executor === 'client') {
      await registerClientExecution(request, result.project?.projectId || result.job.projectId, null, assistantId).catch((error) => {
        updateAssistant(assistantId, {
          pending: false,
          segmentId: result.job.segmentId,
          content: 'Retry was queued, but client execution needs attention.',
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }
    updateAssistant(assistantId, {
      pending: false,
      segmentId: result.job.segmentId,
      content: request?.executor === 'server' ? 'Server adapter retry is queued.' : 'Retry queued.',
    });
  };

  const runBulkJobAction = async (action: 'cancel' | 'retry') => {
    if (bulkActionRunning || !displayedHubJobs.length) return;
    setBulkActionRunning(action);
    const result = await bulkStudioJobs({
      action,
      status: queueStatusFilter === 'all' ? undefined : queueStatusFilter,
      pageId: queuePageFilter === 'all' ? undefined : queuePageFilter,
      agentId: queueAgentFilter === 'all' ? undefined : queueAgentFilter,
      limit: 100,
    }).catch((error) => {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: `Bulk ${action} failed.`,
          error: error instanceof Error ? error.message : String(error),
          createdAt: nowIso(),
        },
      ]);
      return null;
    });
    setBulkActionRunning(null);
    if (!result) return;
    result.projects?.forEach((nextProject) => mergeProject(nextProject));
    result.jobs.forEach((job) => mergeJob(job));
    await Promise.all([
      fetchStudioJobs({
        limit: 50,
        status: queueStatusFilter === 'all' ? undefined : queueStatusFilter,
        pageId: queuePageFilter === 'all' ? undefined : queuePageFilter,
        agentId: queueAgentFilter === 'all' ? undefined : queueAgentFilter,
      }).then((jobs) => setHubJobs(jobs)).catch(() => undefined),
      fetchStudioOverview().then((overview) => setStudioOverview(overview)).catch(() => undefined),
      fetchStudioReadiness().then((readiness) => setStudioReadiness(readiness)).catch(() => undefined),
      fetchStudioDispatchMatrix({
        projectId: project?.projectId,
        sourceSegmentId: selectedSegment?.id,
      }).then((matrix) => setDispatchMatrix(matrix)).catch(() => undefined),
      fetchStudioCoverage({
        projectId: project?.projectId,
        sourceSegmentId: selectedSegment?.id,
      }).then((coverage) => setCoverageReport(coverage)).catch(() => undefined),
      fetchStudioHandoffSnapshot({
        projectId: project?.projectId,
        sourceSegmentId: selectedSegment?.id,
      }).then((snapshot) => applyHandoffSnapshot(snapshot)).catch(() => undefined),
      project?.projectId
        ? fetchStudioProjectDeliveryReport(project.projectId).then((report) => setDeliveryReport(report)).catch(() => undefined)
        : Promise.resolve(),
    ]);
    setMessages((prev) => [
      ...prev,
      {
        id: makeId('assistant'),
        role: 'assistant',
        content: `Bulk ${action} applied to ${result.matchedCount} job${result.matchedCount === 1 ? '' : 's'}${
          result.skippedCount ? `; skipped ${result.skippedCount} terminal job${result.skippedCount === 1 ? '' : 's'}` : ''
        }.`,
        createdAt: nowIso(),
      },
    ]);
  };

  const runCoverageVerification = async () => {
    if (coverageVerifyRunning) return;
    setCoverageVerifyRunning(true);
    const result = await verifyStudioCoverage({
      projectId: project?.projectId,
      sourceSegmentId: selectedSegment?.id,
      limit: 50,
    }).catch((error) => {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('assistant'),
          role: 'assistant',
          content: 'Coverage verification failed.',
          error: error instanceof Error ? error.message : String(error),
          createdAt: nowIso(),
        },
      ]);
      return null;
    });
    setCoverageVerifyRunning(false);
    if (!result) return;

    mergeProject(result.project);
    result.jobs.forEach((job) => mergeJob(job));
    setCoverageReport(result.coverage);
    const nextProjectId = result.project.projectId;
    const nextSourceSegmentId = result.coverage.sourceSegmentId || selectedSegment?.id;
    await Promise.all([
      fetchStudioJobs({ limit: 50 }).then((jobs) => setHubJobs(jobs)).catch(() => undefined),
      fetchStudioOverview().then((overview) => setStudioOverview(overview)).catch(() => undefined),
      fetchStudioReadiness().then((readiness) => setStudioReadiness(readiness)).catch(() => undefined),
      fetchStudioDispatchMatrix({
        projectId: nextProjectId,
        sourceSegmentId: nextSourceSegmentId || undefined,
      }).then((matrix) => setDispatchMatrix(matrix)).catch(() => undefined),
      fetchStudioCoverage({
        projectId: nextProjectId,
        sourceSegmentId: nextSourceSegmentId || undefined,
      }).then((coverage) => setCoverageReport(coverage)).catch(() => undefined),
      fetchStudioProjectDeliveryReport(nextProjectId).then((report) => setDeliveryReport(report)).catch(() => undefined),
      fetchStudioHandoffSnapshot({
        projectId: nextProjectId,
        sourceSegmentId: nextSourceSegmentId || undefined,
      }).then((snapshot) => applyHandoffSnapshot(snapshot)).catch(() => undefined),
    ]);
    setMessages((prev) => [
      ...prev,
      {
        id: makeId('assistant'),
        role: 'assistant',
        content: `Coverage verified ${result.createdCount} page${result.createdCount === 1 ? '' : 's'}; skipped ${result.skippedCount}.`,
        createdAt: nowIso(),
      },
    ]);
  };

  return (
    <div
      data-testid="dreamy-studio-root"
      data-selected-starter-preset-id={selectedStarterPresetId}
      data-selected-bot-slug={selectedStarterPreset?.botSlug || ''}
      className="dreamy-studio-root"
    >
      <header className="dreamy-studio-bar">
        <div className="dreamy-studio-brand">
          <span className="dreamy-studio-brand-mark">
            <Sparkles size={18} />
          </span>
          <span className="dreamy-studio-brand-name">
            Dreamy<span className="dreamy-studio-brand-accent">Porn</span> <span className="dreamy-studio-brand-sub">Studio</span>
          </span>
        </div>
        <div className="hidden h-8 w-px bg-white/10 sm:block" />
        <div className="hidden md:block">
          <StudioWorkspaceSwitch workspace={workspace} onChange={setStudioWorkspace} />
        </div>
        <button
          type="button"
          className="dreamy-studio-project hidden sm:inline-flex"
          aria-label="Current project"
        >
          <span>Project</span>
          <span className="dreamy-studio-picker">
            Midnight Suite
            <ChevronDown size={14} />
          </span>
        </button>
        <span className="dreamy-studio-save hidden md:inline-flex">
          <span className="dreamy-studio-save-dot" />
          Autosaved 10:42:11
        </span>
        <span className="dreamy-studio-spacer" />
        <div className="flex min-w-0 items-center justify-end gap-2">
          <button
            type="button"
            data-testid="mobile-workspace-switch"
            onClick={() => setStudioWorkspace(workspace === 'canvaspro' ? 'orchestrator' : 'canvaspro')}
            className="flex h-8 w-8 items-center justify-center rounded-md-v2 border border-white/10 bg-white/[0.04] text-Cr-text-subtler-v2 active:bg-white/[0.08] md:hidden"
            aria-label={workspace === 'canvaspro' ? 'Switch to Studio command workspace' : 'Switch to CanvasPro workspace'}
            title={workspace === 'canvaspro' ? 'Command' : 'CanvasPro'}
          >
            {workspace === 'canvaspro' ? <Sparkles size={15} /> : <Layers3 size={15} />}
          </button>
          <button
            type="button"
            onClick={() => navigate('/energy')}
            className="dreamy-studio-energy"
            aria-label="Energy"
          >
            <Zap size={14} fill="currentColor" />
            <span>{(energy ?? 2809).toLocaleString()}</span>
            <span className="dreamy-studio-energy-plus">
              <Plus size={12} strokeWidth={3} />
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDeliveryDrawerOpen(true)}
            className="dreamy-studio-share hidden sm:inline-flex"
          >
            <Share2 size={14} />
            Share
          </button>
          <button
            type="button"
            onClick={resetProject}
            className="dreamy-studio-avatar"
            aria-label="Reset project"
          />
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {deliveryDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Delivery evidence center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close delivery evidence center"
            onClick={() => setDeliveryDrawerOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-full max-w-[960px] flex-col border-l border-white/10 bg-[#090a0f] shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#0f1016] px-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <PanelRightOpen size={15} className="text-dreamy-brand-hot-v2" />
                  Delivery Evidence
                </div>
                <div className="truncate text-[11px] text-Cr-text-subtler-v2">
                  Readiness, coverage, handoff, dispatch matrix, and recoverable queue controls.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeliveryDrawerOpen(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md-v2 border border-white/10 bg-white/[0.04] text-Cr-text-subtler-v2 active:bg-white/[0.08]"
                aria-label="Close delivery evidence center"
              >
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StudioHealthStrip health={studioHealth} />
              <StudioReadinessStrip readiness={studioReadiness} />
              <StudioDeliveryCommandCenter
                audit={deliveryAudit}
                coverage={coverageReport}
                snapshot={handoffSnapshot}
                bundle={deliveryBundle}
                matrix={dispatchMatrix}
                plan={dispatchBatchPlan}
                session={dispatchSession}
                overview={studioOverview}
                refreshingAudit={deliveryAuditRefreshing}
                verifyingCoverage={coverageVerifyRunning}
                planningDispatch={dispatchBatchPlanning}
                sessionRunning={dispatchSessionRunning}
                bundling={deliveryBundleLoading}
                onRefreshAudit={() => void refreshDeliveryAudit({ interactive: true })}
                onVerifyCoverage={() => void runCoverageVerification()}
                onPlanRemaining={() => void planDispatchBatch({ excludeCovered: true })}
                onStartQueue={() => void startDispatchSession()}
                onBundle={() => void refreshDeliveryBundle()}
              />
              <StudioDeliveryAuditStrip
                audit={deliveryAudit}
                refreshing={deliveryAuditRefreshing}
                resolvingActionId={resolvingAuditActionId}
                resolvingBatch={resolvingAuditBatch}
                onRefresh={() => void refreshDeliveryAudit({ interactive: true })}
                onDownload={downloadDeliveryAudit}
                onResolveAction={(action) => void resolveAuditAction(action)}
                onResolveSafeActions={() => void resolveSafeAuditActions()}
              />
              <StudioDeliveryReportStrip projectId={project?.projectId} report={deliveryReport} />
              <StudioCoverageStrip
                coverage={coverageReport}
                verifying={coverageVerifyRunning}
                onVerify={() => void runCoverageVerification()}
              />
              <StudioHandoffSnapshotStrip
                snapshot={handoffSnapshot}
                bundle={deliveryBundle}
                refreshing={handoffRefreshing}
                bundling={deliveryBundleLoading}
                onRefresh={() => void refreshHandoffSnapshot({ interactive: true })}
                onBundle={() => void refreshDeliveryBundle()}
              />
              <StudioDispatchBatchStrip
                plan={dispatchBatchPlan}
                session={dispatchSession}
                planning={dispatchBatchPlanning}
                sessionRunning={dispatchSessionRunning}
                selectedPageCount={selectedDispatchBatchPageIds.length}
                onPlan={() => void planDispatchBatch()}
                onPlanRemaining={() => void planDispatchBatch({ excludeCovered: true })}
                onPlanSelected={() => void planDispatchBatch({ pageIds: selectedDispatchBatchPageIds })}
                onStartSession={() => void startDispatchSession()}
                onStartSelectedSession={() => void startDispatchSession({ pageIds: selectedDispatchBatchPageIds })}
                onCancelSession={() => void cancelDispatchSession()}
                onRetrySession={() => void retryDispatchSession()}
                onOpenTarget={(target) => void runDispatchBatchTarget(target)}
                onCompleteTarget={(target) => void completeDispatchSessionTarget(target)}
                onErrorTarget={(target) => void reviewDispatchSessionTarget(target, 'error')}
                onSkipTarget={(target) => void reviewDispatchSessionTarget(target, 'skipped')}
              />

      <div className="grid shrink-0 gap-2 border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase text-Cr-text-subtlest-v2">Page</span>
          <select
            value={selectedPageId}
            onChange={(event) => changePage(event.target.value)}
            className="h-10 min-w-0 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2 outline-none"
            aria-label="Studio page adapter"
          >
            {pageOptions.map((page) => (
              <option key={page.id} value={page.id}>{page.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase text-Cr-text-subtlest-v2">Agent</span>
          <select
            value={selectedAgentId}
            onChange={(event) => setSelectedAgentId(event.target.value)}
            className="h-10 min-w-0 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2 outline-none"
            aria-label="Studio agent"
          >
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={refreshSelectedTask}
          disabled={!selectedSegment?.taskId}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg-v2 bg-Cr-Bg-surface-subtle-v2 px-3 text-xs font-semibold text-Cr-text-subtle-v2 disabled:opacity-40 sm:self-end"
        >
          <RotateCcw size={14} />
          Refresh
        </button>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2 py-2 sm:col-span-3 [-webkit-overflow-scrolling:touch]">
          {previewDispatchReady ? (
            <CheckCircle2 size={14} className="shrink-0 text-Cr-text-success-default-v2" />
          ) : (
            <AlertTriangle size={14} className="shrink-0 text-Cr-text-critical-default-v2" />
          )}
          <Pill tone={healthPillTone(previewDispatchStatus)}>{previewDispatchStatus || 'unknown'}</Pill>
          <span className="shrink-0 text-[11px] font-semibold text-Cr-text-subtler-v2">
            {previewDispatchMode || 'dispatch'}
          </span>
          {previewNavigationPath && (
            <span className="shrink-0 text-[11px] font-semibold text-Cr-text-subtle-v2">
              {previewNavigationPath}
            </span>
          )}
          {!!previewMissingParams.length && (
            <Pill tone="hot">{`Missing ${previewMissingParams.join(', ')}`}</Pill>
          )}
          <span className="min-w-[160px] truncate text-[11px] text-Cr-text-subtler-v2">
            {previewDispatchMessage || previewPage?.authMode || 'No runtime status'}
          </span>
        </div>
      </div>

      <div className="shrink-0 border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 p-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-Cr-text-subtle-v2">
            <Layers3 size={14} />
            Page Registry
          </div>
          <div className="flex max-w-full items-center gap-2 overflow-x-auto [-webkit-overflow-scrolling:touch]">
            <Pill>{`${studioOverview?.totals?.pages || overviewPages.length} pages`}</Pill>
            <Pill tone={studioOverview?.totals?.issues ? 'danger' : 'default'}>{`${studioOverview?.totals?.issues || 0} issues`}</Pill>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
          {overviewPages.map((page) => {
            const overviewPage = page as StudioOverviewPage;
            const counts = overviewPage.jobCounts || {};
            const queued = counts.queued || 0;
            const running = counts.running || 0;
            const done = counts.done || 0;
            const issueCount = (counts.timeout || 0) + (counts.auth_missing || 0) + (counts.error || 0);
            const active = page.id === selectedPageId;
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => selectOverviewPage(page.id)}
                className={`grid min-w-[210px] gap-2 rounded-lg-v2 border p-2 text-left text-xs transition-colors ${
                  active
                    ? 'border-dreamy-brand-hot-v2 bg-dreamy-brand-hot-v2/10'
                    : 'border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 active:bg-Cr-beta-white-8-v2'
                }`}
                aria-label={`Select ${page.name} page`}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0 truncate font-semibold text-Cr-text-default-v2">{page.name}</div>
                  <Pill tone={healthPillTone(page.dispatchStatus)}>{page.dispatchStatus || 'unknown'}</Pill>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-Cr-text-subtler-v2">
                  <span className="truncate">{page.executor}</span>
                  <span className="shrink-0">{`Q${queued} R${running} D${done}`}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-Cr-text-subtlest-v2">
                  <span className="truncate">{overviewPage.latestJob?.status || page.dispatchMode || page.authMode}</span>
                  {issueCount > 0 && <span className="font-semibold text-Cr-text-critical-default-v2">{`${issueCount} issue`}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <StudioDispatchMatrixPanel
        matrix={dispatchMatrix}
        selectedPageId={selectedPageId}
        selectedBatchPageIds={selectedDispatchBatchPageIds}
        submitting={submitting}
        onSelectPage={selectOverviewPage}
        onToggleBatchPage={toggleDispatchBatchPage}
        onSelectReadyBatchPages={selectDispatchBatchPages}
        onClearBatchPageSelection={clearDispatchBatchPages}
        onRunEntry={runMatrixEntry}
        onCopyEntryLink={copyMatrixEntryLink}
      />

      <div className="shrink-0 border-b border-Cr-border-default-v2 bg-Cr-Bg-soft-v2 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-Cr-text-subtle-v2">
            <GitBranch size={14} />
            Dispatch Queue
          </div>
          <div className="flex items-center gap-2">
            <Pill>{`${displayedHubJobs.length} jobs`}</Pill>
            <button
              type="button"
              disabled={!displayedHubJobs.length || bulkActionRunning !== null}
              onClick={() => void runBulkJobAction('cancel')}
              className="inline-flex h-7 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:opacity-40"
            >
              <X size={12} />
              Bulk Cancel
            </button>
            <button
              type="button"
              disabled={!displayedHubJobs.length || bulkActionRunning !== null}
              onClick={() => void runBulkJobAction('retry')}
              className="inline-flex h-7 items-center gap-1.5 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:opacity-40"
            >
              <RefreshCcw size={12} className={bulkActionRunning === 'retry' ? 'animate-spin' : ''} />
              Bulk Retry
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            value={queueStatusFilter}
            onChange={(event) => setQueueStatusFilter(event.target.value as StudioStatus | 'all')}
            className="h-9 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2 outline-none"
            aria-label="Queue status filter"
          >
            {QUEUE_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>{status === 'all' ? 'All statuses' : status}</option>
            ))}
          </select>
          <select
            value={queuePageFilter}
            onChange={(event) => setQueuePageFilter(event.target.value)}
            className="h-9 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2 outline-none"
            aria-label="Queue page filter"
          >
            <option value="all">All pages</option>
            {pageOptions.map((page) => (
              <option key={page.id} value={page.id}>{page.name}</option>
            ))}
          </select>
          <select
            value={queueAgentFilter}
            onChange={(event) => setQueueAgentFilter(event.target.value)}
            className="h-9 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 px-2 text-xs font-semibold text-Cr-text-subtle-v2 outline-none"
            aria-label="Queue agent filter"
          >
            <option value="all">All agents</option>
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.label}</option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
          {displayedHubJobs.slice(0, 6).map((job) => (
            <div
              key={job.jobId}
              className="grid min-w-[240px] gap-2 rounded-lg-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-subtle-v2 p-2 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold text-Cr-text-default-v2">{job.pageName}</div>
                <div className="truncate text-[11px] text-Cr-text-subtler-v2">{job.agentId} / {job.botName}</div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Pill tone={statusPillTone(job.status)}>{job.status}</Pill>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={job.status === 'cancelled'}
                    onClick={() => void cancelJob(job.jobId)}
                    className="h-7 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void retryJob(job.jobId)}
                    className="h-7 rounded-md-v2 bg-Cr-beta-white-8-v2 px-2 text-[11px] font-semibold text-Cr-text-subtle-v2"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!displayedHubJobs.length && (
            <div className="flex h-16 min-w-[220px] items-center justify-center rounded-lg-v2 border border-dashed border-Cr-border-default-v2 text-xs text-Cr-text-subtler-v2">
              No jobs match filters
            </div>
          )}
        </div>
      </div>
            </div>
          </aside>
      </div>
      )}

      {workspace === 'canvaspro' ? (
        <section
          data-testid="canvaspro-workspace-panel"
          className="relative z-0 min-h-0 flex-1 overflow-hidden border-t border-Cr-border-default-v2 bg-Cr-Bg-soft-v2"
        >
          <Suspense
            fallback={
              <div className="flex h-full w-full items-center justify-center bg-Cr-Bg-soft-v2 text-sm font-semibold text-Cr-text-subtler-v2">
                <Loader2 size={16} className="mr-2 animate-spin" />
                Loading CanvasPro
              </div>
            }
          >
            <CanvasPro
              embeddedInStudio
              onBackToStudio={() => setStudioWorkspace('orchestrator')}
            />
          </Suspense>
        </section>
      ) : (
      <main className="dreamy-studio-grid">
        <section
          data-testid="conversation-workspace-panel"
          className="dreamy-studio-chat"
        >
          <div className="dreamy-studio-chat-head">
            <span className="dreamy-studio-chat-title">
              <span className="dreamy-studio-glyph">
                <Sparkles size={13} />
              </span>
              Orchestrator
            </span>
            <span className="dreamy-studio-chat-subtitle">Suggests scenes · multi-agent</span>
          </div>

          <DreamyOrchestratorThread
            project={project}
            messages={messages}
            starterPresets={recommendedStarterPresets}
            allBotPresets={selectableStarterPresets}
            selectedStarterPresetId={selectedStarterPresetId}
            selectedStarterPreset={selectedPreviewPreset}
            selectedSegment={selectedSegment}
            manualBotIdsText={manualBotIdsText}
            manualBotEntries={manualBotEntries}
            selectedManualBotEntryId={selectedManualBotEntryId}
            submitting={submitting}
            onSelectPreset={selectStarterPreset}
            onManualBotIdsChange={setManualBotIdsText}
            onSelectManualBot={selectManualBotEntry}
            onRunManualBot={runManualBotEntry}
            onRunManualBotSequence={runManualBotSequence}
            onRunPreset={runStarterPreset}
            onAction={(action, nextPrompt, source) => {
              if (selectedPreviewPreset?.pageId === 'dreamy-miniapp') {
                runStarterPreset(selectedPreviewPreset, nextPrompt);
              } else {
                void runStudio(action, nextPrompt, source);
              }
            }}
          />

          <Composer
            mode={mode}
            prompt={prompt}
            canSubmitWithoutPrompt={Boolean(selectedPreviewPreset) || selectedPage?.executor === 'navigation'}
            previewUrl={previewUrl}
            selectedFileName={selectedFile?.name}
            selectedStarterPreset={selectedPreviewPreset}
            selectedSegment={selectedSegment}
            submitting={submitting}
            onModeChange={(nextMode) => {
              setMode(nextMode);
              if (nextMode === 'canvas') setActiveTab('preview');
            }}
            onPromptChange={setPrompt}
            onPickFile={() => fileInputRef.current?.click()}
            onClearFile={clearFile}
            onSubmit={() => {
              if (selectedPreviewPreset?.pageId === 'dreamy-miniapp') {
                const submittedPrompt = prompt;
                runStarterPreset(selectedPreviewPreset, submittedPrompt);
                setPrompt('');
              } else {
                void runStudio('generate');
              }
            }}
            onStop={stopRun}
          />
        </section>

        <DreamyPreviewTimelinePanels
          project={project}
          selectedSegment={selectedSegment}
          selectedStarterPreset={selectedPreviewPreset}
          onSelectSegment={selectSegment}
          onAction={runStudio}
          onRunPreset={runStarterPreset}
          onExportAllSegments={exportAllSegments}
          timelineExporting={timelineExporting}
          submitting={submitting}
        />
      </main>
      )}
    </div>
  );
}

// 剪辑器状态层（Zustand）。模块级单例 → 关闭编辑器后状态不丢（同会话重开）。
// 变更经 IndexedDB 持久化 → 整页刷新也不丢。素材按 projectId 区分。
import { create } from 'zustand';
import type { EditorAsset, TimelineClip, TimelineTrack, EditorTrackType, EditorSnapshot, ClipProps, AnimatableKey, ClipPropPreset, ClipFilters, TransitionType, TextClipData, Keyframe, PreviewQuality } from './types';
import { ANIMATABLE_KEYS, FILTER_PRESETS, DEFAULT_TRANSITION_DURATION, DEFAULT_TEXT_DATA } from './types';
import { assetTypeFromFile, extractAssetMeta, extractAudioPeaks, genId, clipProps, durationFromTrim, resolveClipPropsAt, upsertKeyframe } from './utils';
import { saveAssetBlob, getAssetBlob, saveSnapshot, getSnapshot } from './storage';

export const BASE_PPS = 40;
const MIN_PPS = 4; // 10%
const MAX_PPS = 200; // 500%
const DEFAULT_IMAGE_DURATION = 5;
const DEFAULT_VIDEO_DURATION = 3;
const DEFAULT_ASPECT = '16:9';

const timelineDuration = (clips: TimelineClip[]) =>
  clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);

const makeDefaultTracks = (): TimelineTrack[] => [
  { id: 'track_video_1', type: 'video', name: '视频 1' },
  { id: 'track_video_2', type: 'video', name: '视频 2' },
  { id: 'track_video_3', type: 'video', name: '视频 3' },
  { id: 'track_audio_1', type: 'audio', name: '音频 1' },
  { id: 'track_audio_2', type: 'audio', name: '音频 2' },
  { id: 'track_audio_3', type: 'audio', name: '音频 3' },
];

type ToolMode = 'select' | 'cut';

// 历史记录快照（只保存可撤销的状态）
interface HistorySnapshot {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
}

interface HistoryState {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
}

const MAX_HISTORY = 50; // 最多保存50步历史

interface EditorStore {
  loadedProjectId: string | null;
  hydrating: boolean;
  uploading: boolean;
  assets: EditorAsset[];
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedAssetId: string | null;
  selectedClipId: string | null;
  selectedClipIds: string[];
  pxPerSecond: number;
  playhead: number;
  playing: boolean;
  playbackRate: number;
  playDirection: 1 | -1; // 播放方向：1 正放，-1 倒放（J/K/L 梭播）
  loop: boolean;
  inPoint: number | null;
  outPoint: number | null;
  aspectRatio: string;
  snapEnabled: boolean;
  clipboard: ClipProps | null;
  presets: ClipPropPreset[];
  toolMode: ToolMode;
  previewQuality: PreviewQuality; // 预览画质（Cmd+1/2/3 切换）
  history: HistoryState;
  isDragging: boolean; // 标记是否正在拖拽
  dragStartSnapshot: HistorySnapshot | null; // 拖拽开始时的快照
  hydrate: (projectId: string | undefined) => Promise<void>;
  addAssets: (files: FileList) => Promise<void>;
  addToTimeline: (assetId: string) => void;
  updateClip: (id: string, patch: Partial<TimelineClip>) => void;
  beginDrag: () => void; // 开始拖拽，记录历史
  endDrag: () => void; // 结束拖拽
  removeClip: (id: string) => void;
  removeSelectedClip: () => void;
  selectAsset: (id: string) => void;
  selectClip: (id: string | null) => void;
  setZoom: (pps: number) => void;
  seek: (sec: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  togglePlay: () => void;
  tick: (dt: number) => void;
  setPlaybackRate: (rate: number) => void;
  shuttle: (dir: 1 | -1) => void; // J/K/L 梭播：L 正放加速、J 倒放加速
  setPreviewQuality: (q: PreviewQuality) => void;
  toggleLoop: () => void;
  stepFrame: (dir: number) => void;
  setInPoint: () => void;
  setOutPoint: () => void;
  clearInOut: () => void;
  setAspectRatio: (ratio: string) => void;
  toggleSnap: () => void;
  addTrack: (type: EditorTrackType) => void;
  removeTrack: (id: string) => void;
  toggleTrackLocked: (id: string) => void;
  toggleTrackMuted: (id: string) => void;
  toggleTrackHidden: (id: string) => void;
  addClipToTrack: (assetId: string, trackId: string, startSec: number) => void;
  setTrackHeight: (id: string, height: number) => void;
  reorderTrack: (id: string, beforeId: string | null) => void;
  setClipProps: (id: string, patch: Partial<ClipProps>) => void;
  copyClipProps: (id: string) => void;
  pasteClipProps: (id: string) => void;
  resetClipProps: (id: string) => void;
  setClipSpeed: (id: string, speed: number) => void;
  toggleClipSelection: (id: string) => void;
  clearMultiSelection: () => void;
  applyPropsToSelected: (patch: Partial<ClipProps>) => void;
  toggleKeyframe: (id: string, key: AnimatableKey) => void;
  savePreset: (name: string, fromClipId: string) => void;
  applyPreset: (presetId: string, clipId: string) => void;
  deletePreset: (presetId: string) => void;
  detachAudio: (id: string) => void;
  setClipFilters: (id: string, patch: Partial<ClipFilters>) => void;
  applyFilterPreset: (id: string, presetId: string) => void;
  setClipTransition: (id: string, type: TransitionType) => void;
  setTransitionDuration: (id: string, duration: number) => void;
  removeTransition: (id: string) => void;
  addTextClip: (preset?: Partial<TextClipData>) => void;
  setClipText: (id: string, patch: Partial<TextClipData>) => void;
  setToolMode: (mode: ToolMode) => void;
  undo: () => void;
  redo: () => void;
  saveNow: () => void;
  selectAllClips: () => void;
  splitClip: (clipId: string, splitTime: number) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistSnapshot() {
  const cur = useEditorStore.getState();
  if (!cur.loadedProjectId || cur.hydrating) return;
  const snapshot: EditorSnapshot = {
    version: 1,
    // blob: URL 在刷新后失效，存空串，hydrate 时由 IndexedDB blob 重新生成
    assets: cur.assets.map((a) => ({ ...a, url: '', thumbnail: a.type === 'image' ? '' : a.thumbnail })),
    clips: cur.clips,
    tracks: cur.tracks,
    aspectRatio: cur.aspectRatio,
  };
  void saveSnapshot(cur.loadedProjectId, snapshot);
}
function scheduleSave() {
  const s = useEditorStore.getState();
  if (!s.loadedProjectId || s.hydrating) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSnapshot, 600);
}

function revokeAssetUrls(assets: EditorAsset[]) {
  for (const a of assets) {
    if (a.url.startsWith('blob:')) URL.revokeObjectURL(a.url);
    if (a.thumbnail && a.thumbnail.startsWith('blob:')) URL.revokeObjectURL(a.thumbnail);
  }
}

// 属性预设走 localStorage（跨项目复用）
const PRESETS_KEY = 'myshell-editor-clip-presets';
function loadPresets(): ClipPropPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function persistPresets(presets: ClipPropPreset[]) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch { /* ignore quota */ }
}

// 应用属性补丁：动画属性若已有关键帧 → 在播放头 upsert 关键帧；否则改静态值
function applyPropPatch(clip: TimelineClip, patch: Partial<ClipProps>, playhead: number): TimelineClip {
  const localT = Math.max(0, Math.min(clip.duration, playhead - clip.start));
  const staticPatch: Partial<ClipProps> = {};
  let kf = clip.keyframes ? { ...clip.keyframes } : undefined;
  (Object.keys(patch) as (keyof ClipProps)[]).forEach((key) => {
    const v = patch[key];
    if (typeof v !== 'number') return;
    if ((ANIMATABLE_KEYS as string[]).includes(key) && clip.keyframes?.[key as AnimatableKey]?.length) {
      const ak = key as AnimatableKey;
      kf = { ...(kf ?? {}), [ak]: upsertKeyframe(kf?.[ak] ?? [], localT, v) };
    } else {
      staticPatch[key] = v;
    }
  });
  return { ...clip, ...staticPatch, ...(kf ? { keyframes: kf } : {}) };
}

// 创建历史快照（只保存可撤销的状态）
function createSnapshot(state: EditorStore): HistorySnapshot {
  return {
    clips: state.clips,
    tracks: state.tracks,
  };
}

// 连续操作（滑块/画布拖拽）合并：同一 tag 且间隔很短时只记一步
let lastHistoryTag: string | null = null;
let lastHistoryTime = 0;
const HISTORY_COALESCE_MS = 500;

// 记录历史（在变更前调用）：把"变更前"状态压入 past、清空 future。
// 注意：present 就是 store 的实时状态本身，不单独保存（旧实现把变更前快照误存进 present，
// 导致 redo 永远失效、多步 undo 跳步——这是本次修复的根因）。
// 传入 tag 的连续操作在 500ms 内合并为一步（避免一次拖动产生几十个历史）。
function recordHistory(state: EditorStore, tag?: string) {
  const now = Date.now();
  if (tag && tag === lastHistoryTag && now - lastHistoryTime < HISTORY_COALESCE_MS) {
    lastHistoryTime = now;
    return {}; // 合并：首个事件已记录变更前状态，后续不再新增历史步
  }
  lastHistoryTag = tag ?? null;
  lastHistoryTime = now;
  const snapshot = createSnapshot(state);
  return {
    history: {
      past: [...state.history.past, snapshot].slice(-MAX_HISTORY),
      future: [],
    },
  };
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  loadedProjectId: null,
  hydrating: false,
  uploading: false,
  assets: [],
  clips: [],
  tracks: makeDefaultTracks(),
  selectedAssetId: null,
  selectedClipId: null,
  selectedClipIds: [],
  pxPerSecond: BASE_PPS,
  playhead: 0,
  playing: false,
  playbackRate: 1,
  playDirection: 1,
  loop: false,
  inPoint: null,
  outPoint: null,
  aspectRatio: DEFAULT_ASPECT,
  snapEnabled: true,
  clipboard: null,
  presets: loadPresets(),
  toolMode: 'select',
  previewQuality: 'full',
  history: {
    past: [],
    future: [],
  },
  isDragging: false,
  dragStartSnapshot: null,

  hydrate: async (projectId) => {
    const key = projectId || '__default__';
    const cur = get();
    if (cur.hydrating) return;
    if (cur.loadedProjectId === key) {
      return; // 同会话重开同项目：保留内存中的实时状态
    }
    set({ hydrating: true });
    if (cur.loadedProjectId && cur.loadedProjectId !== key) revokeAssetUrls(cur.assets);
    const snap = await getSnapshot(key);
    if (!snap) {
      set({ loadedProjectId: key, hydrating: false, assets: [], clips: [], tracks: makeDefaultTracks(), selectedAssetId: null, selectedClipId: null, selectedClipIds: [], playhead: 0, playing: false, aspectRatio: DEFAULT_ASPECT });
      return;
    }
    const rebuilt: EditorAsset[] = [];
    for (const a of snap.assets) {
      const blob = await getAssetBlob(a.id);
      if (!blob) continue; // 素材 blob 丢失则跳过
      const url = URL.createObjectURL(blob);
      rebuilt.push({ ...a, url, thumbnail: a.type === 'image' ? url : a.thumbnail });
    }
    const ids = new Set(rebuilt.map((a) => a.id));
    set({
      loadedProjectId: key, hydrating: false,
      assets: rebuilt, clips: snap.clips.filter((c) => !c.assetId || ids.has(c.assetId)), // 保留文字片段（assetId为空）和有效素材片段
      tracks: snap.tracks?.length ? snap.tracks : makeDefaultTracks(),
      selectedAssetId: rebuilt[0]?.id ?? null, selectedClipId: null, selectedClipIds: [], playhead: 0,
      playing: false, aspectRatio: snap.aspectRatio || DEFAULT_ASPECT,
    });
  },

  addAssets: async (files) => {
    set({ uploading: true });
    const created: EditorAsset[] = [];
    for (const file of Array.from(files)) {
      const type = assetTypeFromFile(file);
      const url = URL.createObjectURL(file);
      const meta = await extractAssetMeta(url, type);
      const id = genId('asset');
      await saveAssetBlob(id, file); // 持久化原始文件，刷新后可重建
      const peaks = type === 'audio' ? await extractAudioPeaks(file) : undefined;
      created.push({ id, name: file.name, type, url, size: file.size, ...meta, ...(peaks ? { peaks } : {}) });
    }
    set((s) => ({
      assets: [...s.assets, ...created],
      selectedAssetId: s.selectedAssetId ?? created[0]?.id ?? null,
      uploading: false,
    }));
    scheduleSave();
  },

  addToTimeline: (assetId) => {
    const { assets, tracks, clips } = get();
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    const trackType = asset.type === 'audio' ? 'audio' : 'video';
    const track = tracks.find((t) => t.type === trackType);
    if (!track) return;
    const duration = asset.duration ?? (asset.type === 'image' ? DEFAULT_IMAGE_DURATION : DEFAULT_VIDEO_DURATION);
    const start = clips.filter((c) => c.trackId === track.id).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    const clip: TimelineClip = { id: genId('clip'), assetId, trackId: track.id, start, duration, trimStart: 0, trimEnd: duration };
    set((s) => ({ ...recordHistory(s), clips: [...clips, clip], selectedClipId: clip.id }));
    scheduleSave();
  },

  updateClip: (id, patch) => {
    const { isDragging } = get();
    // 拖拽中或非拖拽都直接更新，不在这里记录历史
    set((s) => {
      const updated = s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
      // 非拖拽状态：立即记录历史。预览里裁剪(crop)拖拽走这条路径且连续触发，
      // 用 tag 合并为一步（时间线 move/trim 拖拽走 beginDrag/endDrag，此处 isDragging=true 跳过）
      if (!isDragging) {
        const tag = `update:${id}:${Object.keys(patch).sort().join(',')}`;
        return { ...recordHistory(s, tag), clips: updated };
      }
      // 拖拽中：只更新clips，不记录历史
      return { clips: updated };
    });
    scheduleSave();
  },

  beginDrag: () => {
    // 开始拖拽：保存拖拽前的快照
    const state = get();
    const snapshot = createSnapshot(state);
    set({ isDragging: true, dragStartSnapshot: snapshot });
  },

  endDrag: () => {
    // 结束拖拽：检查状态是否真的改变了，只有改变时才记录历史
    const state = get();
    if (!state.isDragging || !state.dragStartSnapshot) {
      // 没有在拖拽或没有开始快照，直接返回
      set({ isDragging: false, dragStartSnapshot: null });
      return;
    }

    const currentSnapshot = createSnapshot(state);
    // 比较快照，判断是否真的有变化
    const hasChanged = JSON.stringify(state.dragStartSnapshot) !== JSON.stringify(currentSnapshot);

    if (hasChanged) {
      // 有变化：将"拖拽前"的快照推入 past，清空 future（实时状态即 present，不单独保存）
      lastHistoryTag = null; // 拖拽是独立手势，断开与前一次滑块编辑的合并
      const newPast = [...state.history.past, state.dragStartSnapshot].slice(-MAX_HISTORY);
      set({
        isDragging: false,
        dragStartSnapshot: null,
        history: {
          past: newPast,
          future: [], // 清空重做栈
        },
      });
    } else {
      // 没有变化：只清除拖拽标记
      set({ isDragging: false, dragStartSnapshot: null });
    }
  },

  removeClip: (id) => {
    set((s) => ({
      ...recordHistory(s),
      clips: s.clips.filter((c) => c.id !== id),
      selectedClipId: s.selectedClipId === id ? null : s.selectedClipId,
      selectedClipIds: s.selectedClipIds.filter((x) => x !== id),
    }));
    scheduleSave();
  },

  removeSelectedClip: () => {
    const { selectedClipIds, clips } = get();
    if (selectedClipIds.length > 0) {
      // 删除所有选中的片段
      set((s) => ({
        ...recordHistory(s),
        clips: s.clips.filter((c) => !selectedClipIds.includes(c.id)),
        selectedClipId: null,
        selectedClipIds: [],
      }));
      scheduleSave();
    }
  },

  selectAsset: (id) => {
    // 点素材：若时间线上有用该素材的片段，自动选中（优先离播放头最近的），方便直接编辑该片段
    const { clips, playhead } = get();
    const used = clips.filter((c) => c.assetId === id);
    if (used.length > 0) {
      const near = used.reduce((best, c) => {
        const d = playhead >= c.start && playhead < c.start + c.duration ? -1 : Math.min(Math.abs(c.start - playhead), Math.abs(c.start + c.duration - playhead));
        const bd = playhead >= best.start && playhead < best.start + best.duration ? -1 : Math.min(Math.abs(best.start - playhead), Math.abs(best.start + best.duration - playhead));
        return d < bd ? c : best;
      });
      set({ selectedAssetId: id, selectedClipId: near.id, selectedClipIds: [near.id] });
      return;
    }
    set({ selectedAssetId: id, selectedClipId: null, selectedClipIds: [] });
  },
  selectClip: (id) => set({ selectedClipId: id, selectedClipIds: id ? [id] : [] }),
  setZoom: (pps) => set({ pxPerSecond: Math.min(MAX_PPS, Math.max(MIN_PPS, pps)) }),
  seek: (sec) => set({ playhead: Math.max(0, sec), playing: false }),

  play: () => {
    const { clips, playhead, inPoint, outPoint, playDirection } = get();
    const total = timelineDuration(clips);
    if (total <= 0) return;
    const start = inPoint ?? 0;
    const end = outPoint ?? total;
    let ph = playhead;
    if (playDirection === 1) {
      if (ph >= end || ph < start) ph = start; // 正放到尾/越界 → 回到起点
    } else {
      if (ph <= start || ph > end) ph = end; // 倒放到头/越界 → 跳到终点
    }
    set({ playing: true, playhead: ph });
  },
  pause: () => set({ playing: false }),
  stop: () => set((s) => ({ playing: false, playhead: s.inPoint ?? 0, playDirection: 1 })),
  togglePlay: () => {
    if (get().playing) { set({ playing: false }); return; }
    set({ playDirection: 1 }); // 空格始终正放
    get().play();
  },
  tick: (dt) => {
    const { playing, playhead, clips, playbackRate, playDirection, loop, inPoint, outPoint } = get();
    if (!playing) return;
    const total = timelineDuration(clips);
    if (total <= 0) { set({ playing: false }); return; }
    const start = inPoint ?? 0;
    const end = outPoint ?? total;
    const next = playhead + dt * playbackRate * playDirection;
    if (playDirection === 1) {
      if (next >= end) {
        if (loop) set({ playhead: start });
        else set({ playhead: end, playing: false });
        return;
      }
    } else {
      if (next <= start) {
        if (loop) set({ playhead: end });
        else set({ playhead: start, playing: false });
        return;
      }
    }
    set({ playhead: next });
  },
  setPlaybackRate: (rate) => set({ playbackRate: Math.min(16, Math.max(0.1, rate)), playDirection: 1 }),
  // J/K/L 梭播：同方向连按提速（1→2→4→8），反向或停止时从该方向 1x 起播
  shuttle: (dir) => {
    const { playing, playDirection, playbackRate } = get();
    const SHUTTLE_SPEEDS = [1, 2, 4, 8];
    if (!playing || playDirection !== dir) {
      set({ playDirection: dir, playbackRate: 1 });
      get().play();
    } else {
      const idx = SHUTTLE_SPEEDS.findIndex((s) => s >= playbackRate);
      const nextIdx = Math.min(SHUTTLE_SPEEDS.length - 1, (idx < 0 ? 0 : idx) + 1);
      set({ playbackRate: SHUTTLE_SPEEDS[nextIdx] });
    }
  },
  setPreviewQuality: (q) => set({ previewQuality: q }),
  toggleLoop: () => set((s) => ({ loop: !s.loop })),
  stepFrame: (dir) => set((s) => {
    const total = timelineDuration(s.clips);
    const next = Math.min(total, Math.max(0, s.playhead + dir / 30)); // 约 30fps 步进
    return { playhead: next, playing: false };
  }),
  setInPoint: () => set((s) => ({
    inPoint: s.playhead,
    outPoint: s.outPoint !== null && s.outPoint <= s.playhead ? null : s.outPoint,
  })),
  setOutPoint: () => set((s) => ({
    outPoint: s.playhead,
    inPoint: s.inPoint !== null && s.inPoint >= s.playhead ? null : s.inPoint,
  })),
  clearInOut: () => set({ inPoint: null, outPoint: null }),
  setAspectRatio: (ratio) => { set({ aspectRatio: ratio }); scheduleSave(); },
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

  addTrack: (type) => {
    set((s) => {
      const count = s.tracks.filter((t) => t.type === type).length;
      const label = type === 'video' ? '视频' : type === 'audio' ? '音频' : '文字';
      const track: TimelineTrack = { id: genId('track'), type, name: `${label} ${count + 1}` };
      const lastIdx = s.tracks.map((t) => t.type).lastIndexOf(type);
      const next = s.tracks.slice();
      next.splice(lastIdx < 0 ? next.length : lastIdx + 1, 0, track);
      return { ...recordHistory(s), tracks: next };
    });
    scheduleSave();
  },
  removeTrack: (id) => {
    set((s) => {
      const selOnTrack = s.clips.find((c) => c.id === s.selectedClipId)?.trackId === id;
      return {
        ...recordHistory(s), // 删轨会连片段一起删除，必须记录历史以便撤销恢复
        tracks: s.tracks.filter((t) => t.id !== id),
        clips: s.clips.filter((c) => c.trackId !== id),
        selectedClipId: selOnTrack ? null : s.selectedClipId,
      };
    });
    scheduleSave();
  },
  toggleTrackLocked: (id) => { set((s) => ({ ...recordHistory(s), tracks: s.tracks.map((t) => (t.id === id ? { ...t, locked: !t.locked } : t)) })); scheduleSave(); },
  toggleTrackMuted: (id) => { set((s) => ({ ...recordHistory(s), tracks: s.tracks.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t)) })); scheduleSave(); },
  toggleTrackHidden: (id) => { set((s) => ({ ...recordHistory(s), tracks: s.tracks.map((t) => (t.id === id ? { ...t, hidden: !t.hidden } : t)) })); scheduleSave(); },
  addClipToTrack: (assetId, trackId, startSec) => {
    const { assets, tracks, clips } = get();
    const asset = assets.find((a) => a.id === assetId);
    const track = tracks.find((t) => t.id === trackId);
    if (!asset || !track || track.locked) return;
    if (track.type === 'text') return; // 文字轨只放文字片段，不接素材
    if ((asset.type === 'audio') !== (track.type === 'audio')) return; // 音频↔音频轨，视频/图片↔视频轨
    const duration = asset.duration ?? (asset.type === 'image' ? DEFAULT_IMAGE_DURATION : DEFAULT_VIDEO_DURATION);
    const clip: TimelineClip = { id: genId('clip'), assetId, trackId, start: Math.max(0, startSec), duration, trimStart: 0, trimEnd: duration };
    set((s) => ({ ...recordHistory(s), clips: [...clips, clip], selectedClipId: clip.id }));
    scheduleSave();
  },

  setTrackHeight: (id, height) => {
    const h = Math.min(200, Math.max(44, Math.round(height)));
    set((s) => ({ ...recordHistory(s, `trackh:${id}`), tracks: s.tracks.map((t) => (t.id === id ? { ...t, height: h } : t)) }));
    scheduleSave();
  },
  reorderTrack: (id, beforeId) => {
    set((s) => {
      const moving = s.tracks.find((t) => t.id === id);
      if (!moving || id === beforeId) return {};
      const without = s.tracks.filter((t) => t.id !== id);
      let insertIdx: number;
      if (beforeId) {
        insertIdx = without.findIndex((t) => t.id === beforeId);
        if (insertIdx < 0) insertIdx = without.length;
        else if (without[insertIdx].type !== moving.type) return {}; // 仅同类型轨道间排序
      } else {
        // 放到同类型轨道组的末尾
        const lastIdx = without.map((t) => t.type).lastIndexOf(moving.type);
        insertIdx = lastIdx < 0 ? without.length : lastIdx + 1;
      }
      const next = without.slice();
      next.splice(insertIdx, 0, moving);
      return { ...recordHistory(s), tracks: next };
    });
    scheduleSave();
  },

  setClipProps: (id, patch) => {
    const { playhead } = get();
    // 滑块/画布拖拽连续触发：按 片段+属性 合并为一步历史
    const tag = `props:${id}:${Object.keys(patch).sort().join(',')}`;
    set((s) => ({ ...recordHistory(s, tag), clips: s.clips.map((c) => (c.id === id ? applyPropPatch(c, patch, playhead) : c)) }));
    scheduleSave();
  },
  copyClipProps: (id) => {
    const clip = get().clips.find((c) => c.id === id);
    if (clip) set({ clipboard: clipProps(clip) });
  },
  pasteClipProps: (id) => {
    const { clipboard } = get();
    if (!clipboard) return;
    set((s) => ({ ...recordHistory(s), clips: s.clips.map((c) => (c.id === id ? { ...c, ...clipboard } : c)) }));
    scheduleSave();
  },
  resetClipProps: (id) => {
    set((s) => ({
      ...recordHistory(s),
      clips: s.clips.map((c) =>
        c.id === id
          ? { id: c.id, assetId: c.assetId, trackId: c.trackId, start: c.start, duration: c.duration, trimStart: c.trimStart, trimEnd: c.trimEnd, speed: c.speed }
          : c,
      ),
    }));
    scheduleSave();
  },

  setClipSpeed: (id, speed) => {
    const sp = Math.min(4, Math.max(0.25, speed));
    set((s) => ({
      ...recordHistory(s, `speed:${id}`),
      clips: s.clips.map((c) =>
        c.id === id ? { ...c, speed: sp, duration: durationFromTrim(c.trimStart, c.trimEnd, sp) } : c,
      ),
    }));
    scheduleSave();
  },

  toggleClipSelection: (id) => {
    set((s) => {
      const has = s.selectedClipIds.includes(id);
      const ids = has ? s.selectedClipIds.filter((x) => x !== id) : [...s.selectedClipIds, id];
      let primary = s.selectedClipId;
      if (!has) primary = id;
      else if (primary === id) primary = ids[ids.length - 1] ?? null;
      return { selectedClipIds: ids, selectedClipId: primary };
    });
  },
  clearMultiSelection: () => set((s) => ({ selectedClipIds: s.selectedClipId ? [s.selectedClipId] : [] })),
  applyPropsToSelected: (patch) => {
    const { playhead, selectedClipIds } = get();
    const idset = new Set(selectedClipIds);
    const tag = `propsmulti:${selectedClipIds.join(',')}:${Object.keys(patch).sort().join(',')}`;
    set((s) => ({ ...recordHistory(s, tag), clips: s.clips.map((c) => (idset.has(c.id) ? applyPropPatch(c, patch, playhead) : c)) }));
    scheduleSave();
  },

  toggleKeyframe: (id, key) => {
    const { playhead } = get();
    set((s) => ({
      ...recordHistory(s),
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const localT = Math.max(0, Math.min(c.duration, playhead - c.start));
        const eps = 1e-3;
        const cur = c.keyframes?.[key] ?? [];
        const existing = cur.find((k) => Math.abs(k.t - localT) <= eps);
        const nextArr = existing
          ? cur.filter((k) => Math.abs(k.t - localT) > eps)
          : upsertKeyframe(cur, localT, resolveClipPropsAt(c, localT)[key]);
        const kf = { ...(c.keyframes ?? {}) };
        if (nextArr.length) kf[key] = nextArr;
        else delete kf[key];
        return { ...c, keyframes: Object.keys(kf).length ? kf : undefined };
      }),
    }));
    scheduleSave();
  },

  savePreset: (name, fromClipId) => {
    const clip = get().clips.find((c) => c.id === fromClipId);
    if (!clip) return;
    const preset: ClipPropPreset = { id: genId('preset'), name: name.trim() || '预设', props: clipProps(clip) };
    set((s) => {
      const presets = [...s.presets, preset];
      persistPresets(presets);
      return { presets };
    });
  },
  applyPreset: (presetId, clipId) => {
    const preset = get().presets.find((p) => p.id === presetId);
    if (!preset) return;
    set((s) => ({ ...recordHistory(s), clips: s.clips.map((c) => (c.id === clipId ? { ...c, ...preset.props } : c)) }));
    scheduleSave();
  },
  deletePreset: (presetId) => {
    set((s) => {
      const presets = s.presets.filter((p) => p.id !== presetId);
      persistPresets(presets);
      return { presets };
    });
  },

  detachAudio: (id) => {
    const { clips, tracks } = get();
    const clip = clips.find((c) => c.id === id);
    if (!clip || clip.sourceMuted) return; // 仅分离一次
    const srcTrack = tracks.find((t) => t.id === clip.trackId);
    if (!srcTrack || srcTrack.type !== 'video') return; // 只对视频轨片段分离
    const audioTrack = tracks.find((t) => t.type === 'audio' && !t.locked);
    if (!audioTrack) return; // 无可用音频轨
    const audioClip: TimelineClip = {
      id: genId('clip'),
      assetId: clip.assetId,
      trackId: audioTrack.id,
      start: clip.start,
      duration: clip.duration,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
      ...(clip.speed != null ? { speed: clip.speed } : {}),
      ...(clip.volume != null ? { volume: clip.volume } : {}),
    };
    set((s) => ({
      ...recordHistory(s),
      // 原视频片段静音自带声音，新音频片段接管声音
      clips: s.clips.map((c) => (c.id === id ? { ...c, sourceMuted: true } : c)).concat(audioClip),
      selectedClipId: audioClip.id,
      selectedClipIds: [audioClip.id],
    }));
    scheduleSave();
    // 懒解码视频音轨波形写回素材（异步，完成后刷新时间线波形）
    void (async () => {
      const asset = get().assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.peaks) return;
      const blob = await getAssetBlob(clip.assetId);
      if (!blob) return;
      const peaks = await extractAudioPeaks(blob);
      if (!peaks) return;
      set((s) => ({ assets: s.assets.map((a) => (a.id === clip.assetId ? { ...a, peaks } : a)) }));
    })();
  },

  setClipFilters: (id, patch) => {
    const tag = `filters:${id}:${Object.keys(patch).sort().join(',')}`;
    set((s) => ({
      ...recordHistory(s, tag),
      clips: s.clips.map((c) => (c.id === id ? { ...c, filters: { ...c.filters, ...patch } } : c)),
    }));
    scheduleSave();
  },
  applyFilterPreset: (id, presetId) => {
    const preset = FILTER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    // 预设未列出的字段回到默认（用 undefined 让 clipFilters 解析时走默认值）
    set((s) => ({
      ...recordHistory(s),
      clips: s.clips.map((c) => (c.id === id ? { ...c, filters: { ...preset.filters } } : c)),
    }));
    scheduleSave();
  },

  setClipTransition: (id, type) => {
    set((s) => ({
      ...recordHistory(s),
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        // 转场不能比片段本身还长（留一点余量），上限 3s
        const dur = Math.min(DEFAULT_TRANSITION_DURATION, Math.max(0.2, c.duration * 0.9), 3);
        return { ...c, transition: { type, duration: Math.min(dur, c.duration * 0.9) } };
      }),
    }));
    scheduleSave();
  },
  setTransitionDuration: (id, duration) => {
    set((s) => ({
      ...recordHistory(s, `transdur:${id}`),
      clips: s.clips.map((c) => {
        if (c.id !== id || !c.transition) return c;
        const d = Math.min(3, Math.max(0.2, duration), c.duration * 0.9);
        return { ...c, transition: { ...c.transition, duration: d } };
      }),
    }));
    scheduleSave();
  },
  removeTransition: (id) => {
    set((s) => ({
      ...recordHistory(s),
      clips: s.clips.map((c) => {
        if (c.id !== id || !c.transition) return c;
        const { transition: _omit, ...rest } = c;
        return rest;
      }),
    }));
    scheduleSave();
  },

  addTextClip: (preset) => {
    const { tracks, clips, playhead } = get();
    // 找第一条未锁视频轨（文字现在放在视频轨）
    let videoTrack = tracks.find((t) => t.type === 'video' && !t.locked);
    if (!videoTrack) {
      // 如果没有可用视频轨，创建一条
      const count = tracks.filter((t) => t.type === 'video').length;
      videoTrack = { id: genId('track'), type: 'video', name: `视频 ${count + 1}` };
      const nextTracks = [videoTrack, ...tracks];
      set({ tracks: nextTracks });
    }
    const DEFAULT_TEXT_DURATION = 3;
    const clip: TimelineClip = {
      id: genId('clip'),
      assetId: '', // 文字片段没有 assetId
      trackId: videoTrack.id,
      start: Math.max(0, playhead),
      duration: DEFAULT_TEXT_DURATION,
      trimStart: 0,
      trimEnd: DEFAULT_TEXT_DURATION,
      text: { ...DEFAULT_TEXT_DATA, ...preset },
    };
    set((s) => ({ ...recordHistory(s), clips: [...clips, clip], selectedClipId: clip.id, selectedClipIds: [clip.id] }));
    scheduleSave();
  },
  setClipText: (id, patch) => {
    const tag = `text:${id}:${Object.keys(patch).sort().join(',')}`;
    set((s) => ({
      ...recordHistory(s, tag),
      clips: s.clips.map((c) => (c.id === id && c.text ? { ...c, text: { ...c.text, ...patch } } : c)),
    }));
    scheduleSave();
  },

  setToolMode: (mode) => {
    set({ toolMode: mode });
  },

  splitClip: (clipId, splitTime) => {
    const { clips } = get();
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;

    // 检查切割时间是否在片段范围内
    if (splitTime <= clip.start || splitTime >= clip.start + clip.duration) return;

    const speed = clip.speed ?? 1;

    // 对齐到帧边界（30fps），避免浮点误差导致空隙
    // 关键：先计算本地时间，再对本地时间进行帧对齐
    const frameTime = 1 / 30;
    const localTimeRaw = splitTime - clip.start;
    const localTime = Math.round(localTimeRaw / frameTime) * frameTime;

    // 计算切割点对应的源素材时间
    const sourceSplitTime = clip.trimStart + localTime * speed;

    // 片段A：保留原ID，从开始到切割点
    const clipA: TimelineClip = {
      ...clip,
      duration: localTime,
      trimEnd: sourceSplitTime,
      keyframes: undefined, // 先清空，下面单独处理
    };

    // 片段B：新ID，从切割点到结束
    // 关键：start = clip.start + clipA.duration，确保完全相接
    const clipB: TimelineClip = {
      ...clip,
      id: genId('clip'),
      start: clip.start + clipA.duration, // 使用 clipA.duration 而不是 alignedSplitTime
      duration: clip.duration - clipA.duration,
      trimStart: sourceSplitTime,
      trimEnd: clip.trimEnd,
      keyframes: undefined,
    };

    // 关键帧处理：根据切割点分配到两个片段
    if (clip.keyframes) {
      const kfA: Partial<Record<AnimatableKey, Keyframe[]>> = {};
      const kfB: Partial<Record<AnimatableKey, Keyframe[]>> = {};

      (Object.keys(clip.keyframes) as AnimatableKey[]).forEach((key) => {
        const frames = clip.keyframes![key];
        if (!frames?.length) return;

        // 片段A：时间 <= localTime 的关键帧
        const framesA = frames.filter((f) => f.t <= localTime);
        if (framesA.length) kfA[key] = framesA;

        // 片段B：时间 > localTime 的关键帧，时间偏移到新片段起点
        const framesB = frames
          .filter((f) => f.t > localTime)
          .map((f) => ({ ...f, t: f.t - localTime }));
        if (framesB.length) kfB[key] = framesB;
      });

      if (Object.keys(kfA).length) clipA.keyframes = kfA;
      if (Object.keys(kfB).length) clipB.keyframes = kfB;
    }

    // 替换原片段为两个新片段
    set((s) => ({
      ...recordHistory(s),
      clips: clips.map((c) => (c.id === clipId ? clipA : c)).concat(clipB),
      selectedClipId: clipB.id,
      selectedClipIds: [clipB.id],
    }));

    scheduleSave();
  },

  undo: () => {
    lastHistoryTag = null; // 撤销后断开连续操作合并
    const state = get();
    const { past, future } = state.history;
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const current = createSnapshot(state); // 撤销前的实时状态，存入 future 供重做

    set({
      clips: previous.clips,
      tracks: previous.tracks,
      selectedClipId: null,
      selectedClipIds: [],
      history: {
        past: past.slice(0, -1),
        future: [current, ...future],
      },
    });

    scheduleSave();
  },

  redo: () => {
    lastHistoryTag = null;
    const state = get();
    const { past, future } = state.history;
    if (future.length === 0) return;

    const next = future[0];
    const current = createSnapshot(state); // 重做前的实时状态，存回 past 供再次撤销

    set({
      clips: next.clips,
      tracks: next.tracks,
      selectedClipId: null,
      selectedClipIds: [],
      history: {
        past: [...past, current],
        future: future.slice(1),
      },
    });

    scheduleSave();
  },

  saveNow: () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    persistSnapshot();
  },

  selectAllClips: () => set((s) => ({
    selectedClipIds: s.clips.map((c) => c.id),
    selectedClipId: s.clips.length ? s.clips[s.clips.length - 1].id : null,
  })),
}));

import { useEffect, useRef, useState } from 'react';
import { Film, Music, Type, Lock, Unlock, Eye, EyeOff, Volume2, VolumeX, Trash2, Plus, Magnet, GripVertical, Scissors, MousePointer2 } from 'lucide-react';
import type { EditorAsset, TimelineTrack, TimelineClip, EditorTrackType } from '../types';
import { ANIMATABLE_KEYS } from '../types';
import { formatTime, formatTimecode, clipSpeed } from '../utils';

interface TimelinePanelProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  assets: EditorAsset[];
  selectedClipId: string | null;
  selectedClipIds: string[];
  pxPerSecond: number;
  playhead: number;
  inPoint: number | null;
  outPoint: number | null;
  basePps: number;
  toolMode?: 'select' | 'cut';
  onSelectClip: (id: string | null) => void;
  onToggleClipSelection: (id: string) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onBeginDrag: () => void;
  onEndDrag: () => void;
  onSeek: (sec: number) => void;
  onZoom: (pps: number) => void;
  onAddClipToTrack: (assetId: string, trackId: string, startSec: number) => void;
  onAddTrack: (type: EditorTrackType) => void;
  onRemoveTrack: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onToggleMuted: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onSetTrackHeight: (id: string, height: number) => void;
  onReorderTrack: (id: string, beforeId: string | null) => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  onSetToolMode?: (mode: 'select' | 'cut') => void;
  onSplitClip?: (clipId: string, splitTime: number) => void;
  height: number;
}

const MIN_DUR = 0.5;
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const SNAP_PX = 8;
export const ASSET_DND_MIME = 'application/x-editor-asset';
const TRACK_DND_MIME = 'application/x-editor-track';
const trackH = (t: TimelineTrack) => t.height ?? 64;
type DragMode = 'move' | 'trim-start' | 'trim-end';

// 占位伪波形（素材没有真实 peaks 时兜底）
function pseudoBars(seed: string, count = 60): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    bars.push(0.25 + ((h % 1000) / 1000) * 0.7);
  }
  return bars;
}

// 把波形数组下采样到 n 个柱（取峰值）
function sampleBars(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr;
  const out: number[] = [];
  const block = arr.length / n;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    const s = Math.floor(i * block);
    const e = Math.floor((i + 1) * block);
    for (let j = s; j < e && j < arr.length; j++) if (arr[j] > peak) peak = arr[j];
    out.push(peak);
  }
  return out;
}

// 取片段对应的波形柱（按 trim 区间裁剪源素材波形）
function clipBars(asset: EditorAsset | undefined, clip: TimelineClip, width: number): number[] {
  const target = Math.max(8, Math.min(160, Math.floor(width / 3)));
  if (asset?.peaks && asset.peaks.length && asset.duration) {
    const i0 = Math.floor((clip.trimStart / asset.duration) * asset.peaks.length);
    const i1 = Math.ceil((clip.trimEnd / asset.duration) * asset.peaks.length);
    return sampleBars(asset.peaks.slice(i0, Math.max(i0 + 1, i1)), target);
  }
  return sampleBars(pseudoBars(clip.id), target);
}

const LABEL_W = 132;

export default function TimelinePanel({
  tracks, clips, assets, selectedClipId, selectedClipIds, pxPerSecond, playhead, inPoint, outPoint, basePps,
  toolMode = 'select',
  onSelectClip, onToggleClipSelection, onUpdateClip, onBeginDrag, onEndDrag, onSeek, onZoom,
  onAddClipToTrack, onAddTrack, onRemoveTrack, onToggleLocked, onToggleMuted, onToggleHidden,
  onSetTrackHeight, onReorderTrack,
  snapEnabled, onToggleSnap, onSetToolMode, onSplitClip, height,
}: TimelinePanelProps) {
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [dropTrackId, setDropTrackId] = useState<string | null>(null);
  const [reorderOverId, setReorderOverId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const labelColRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalDuration = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const rulerSeconds = Math.max(30, Math.ceil((Math.max(totalDuration, playhead) + 5) / 5) * 5);
  const laneWidth = rulerSeconds * pxPerSecond;
  const step = NICE_STEPS.find((s) => s * pxPerSecond >= 64) ?? 600;
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const zoomPct = Math.round((pxPerSecond / basePps) * 100);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); onZoom(pxPerSecond * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)); }
      else if (ev.shiftKey) { ev.preventDefault(); el.scrollLeft += ev.deltaY; }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pxPerSecond, onZoom]);

  // 跟随播放头自动滚动：播放头移出可视区时把它带回视野内
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = playhead * pxPerSecond;
    const pad = 40;
    if (x < el.scrollLeft + pad) el.scrollLeft = Math.max(0, x - pad);
    else if (x > el.scrollLeft + el.clientWidth - pad) el.scrollLeft = x - el.clientWidth + pad;
  }, [playhead, pxPerSecond]);

  const laneLeft = () => laneRef.current?.getBoundingClientRect().left ?? 0;
  const seekFromClientX = (clientX: number) => onSeek(Math.max(0, (clientX - laneLeft()) / pxPerSecond));

  const snapValue = (sec: number, excludeId: string) => {
    const cands = [0, playhead];
    for (const c of clips) { if (c.id === excludeId) continue; cands.push(c.start, c.start + c.duration); }
    let best = sec, bd = SNAP_PX / pxPerSecond;
    for (const cand of cands) { const d = Math.abs(cand - sec); if (d < bd) { bd = d; best = cand; } }
    return best;
  };
  const snapMove = (ns: number, dur: number, id: string) => {
    if (!snapEnabled) return ns;
    const s = snapValue(ns, id); if (s !== ns) return Math.max(0, s);
    const e = snapValue(ns + dur, id) - dur; if (e !== ns) return Math.max(0, e);
    return ns;
  };
  const laneEls = useRef<Record<string, HTMLDivElement | null>>({});
  const trackAtClientY = (y: number, type: EditorTrackType): string | null => {
    for (const t of tracks) {
      if (t.type !== type || t.locked) continue;
      const el = laneEls.current[t.id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return t.id;
    }
    return null;
  };

  const beginDrag = (e: React.PointerEvent, clip: TimelineClip, mode: DragMode, asset: EditorAsset | undefined) => {
    e.preventDefault();
    e.stopPropagation();
    const srcTrack = tracks.find((t) => t.id === clip.trackId);
    if (srcTrack?.locked) return;

    // 切割模式：点击片段执行切割
    if (toolMode === 'cut' && mode === 'move' && onSplitClip) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clipLocalTime = clickX / pxPerSecond;
      const splitTime = clip.start + clipLocalTime;
      onSplitClip(clip.id, splitTime);
      return;
    }

    // Ctrl/Cmd 点击 → 切换多选（不进入拖拽）
    if (mode === 'move' && (e.ctrlKey || e.metaKey)) {
      onToggleClipSelection(clip.id);
      return;
    }

    // Shift 点击 → 也是多选（不拖拽）
    if (mode === 'move' && e.shiftKey) {
      onToggleClipSelection(clip.id);
      return;
    }

    // 长按检测：启动计时器，300ms 后触发框选模式
    if (mode === 'move') {
      longPressTimer.current = setTimeout(() => {
        // 长按触发：开始框选
        startBoxSelection(e);
        longPressTimer.current = null;
      }, 300);
    }

    onSelectClip(clip.id);
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const ad = asset?.duration;
    const hasSource = ad != null;
    const sp = clipSpeed(clip); // 裁剪时源时间增量 = 时间线增量 × 速度
    const { start: oStart, duration: oDur, trimStart: oTs, trimEnd: oTe } = clip;

    // 记录拖动开始前的状态到历史
    let dragStarted = false;

    const onMove = (ev: PointerEvent) => {
      // 如果移动超过 5px，取消长按计时器，进入拖拽
      if (!moved && (Math.abs(ev.clientX - startX) > 5 || Math.abs(ev.clientY - startY) > 5)) {
        moved = true;
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        // 开始拖拽：记录历史
        if (!dragStarted) {
          onBeginDrag();
          dragStarted = true;
        }
      }
      if (!moved) return; // 没移动就不执行拖拽

      const delta = (ev.clientX - startX) / pxPerSecond;
      if (mode === 'move') {
        const ns = snapMove(Math.max(0, oStart + delta), oDur, clip.id);
        const patch: Partial<TimelineClip> = { start: ns };
        const over = trackAtClientY(ev.clientY, srcTrack!.type);
        if (over && over !== clip.trackId) patch.trackId = over;
        onUpdateClip(clip.id, patch);
      } else if (mode === 'trim-start') {
        let lo = -oStart; if (hasSource) lo = Math.max(lo, -oTs / sp);
        const d = Math.min(Math.max(delta, lo), oDur - MIN_DUR);
        onUpdateClip(clip.id, { start: oStart + d, duration: oDur - d, ...(hasSource ? { trimStart: oTs + d * sp } : {}) });
      } else {
        const up = hasSource ? ((ad as number) - oTe) / sp : Infinity;
        const d = Math.min(Math.max(delta, MIN_DUR - oDur), up);
        onUpdateClip(clip.id, { duration: oDur + d, ...(hasSource ? { trimEnd: oTe + d * sp } : {}) });
      }
    };
    const onUp = () => {
      const wasQuickClick = longPressTimer.current !== null; // 计时器未触发 = 未长按（快速点击）
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      // 结束拖拽
      if (dragStarted) {
        onEndDrag();
      } else if (!moved && wasQuickClick && mode === 'move') {
        // 干净点击片段（未拖动、未长按框选、非裁剪边）：播放头跳到点击位置，预览即显示该帧
        seekFromClientX(startX);
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDraggingClipId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    if (moved || mode !== 'move') {
      setDraggingClipId(clip.id);
    }
  };
  const beginPlayheadDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    seekFromClientX(e.clientX);
    const onMove = (ev: PointerEvent) => seekFromClientX(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 框选功能
  const startBoxSelection = (e: React.PointerEvent | PointerEvent) => {
    const laneRect = laneRef.current?.getBoundingClientRect();
    const scrollContainer = scrollRef.current;
    if (!laneRect || !scrollContainer) return;

    const startX = e.clientX - laneRect.left + scrollContainer.scrollLeft;
    const startY = e.clientY - laneRect.top + scrollContainer.scrollTop;

    setSelecting(true);
    setSelectionBox({ x: startX, y: startY, w: 0, h: 0 });

    // 记录框选开始时的已选片段
    const initialSelection = [...selectedClipIds];
    // 干净点击判定：未移动 = 点击（跳播放头）；移动 = 框选（不跳）
    const clickClientX = e.clientX;
    const clickClientY = e.clientY;
    let boxMoved = false;

    const handleMove = (ev: PointerEvent) => {
      if (!laneRect || !scrollContainer) return;
      if (!boxMoved && (Math.abs(ev.clientX - clickClientX) > 5 || Math.abs(ev.clientY - clickClientY) > 5)) boxMoved = true;
      const currentX = ev.clientX - laneRect.left + scrollContainer.scrollLeft;
      const currentY = ev.clientY - laneRect.top + scrollContainer.scrollTop;

      const w = currentX - startX;
      const h = currentY - startY;

      const boxX = w < 0 ? currentX : startX;
      const boxY = h < 0 ? currentY : startY;
      const boxW = Math.abs(w);
      const boxH = Math.abs(h);

      setSelectionBox({ x: boxX, y: boxY, w: boxW, h: boxH });

      // 实时检测框选中的片段
      const boxLeft = Math.min(startX, currentX);
      const boxRight = Math.max(startX, currentX);
      const boxTop = Math.min(startY, currentY);
      const boxBottom = Math.max(startY, currentY);

      const selected: string[] = [];
      clips.forEach((clip) => {
        const clipLeft = clip.start * pxPerSecond;
        const clipRight = (clip.start + clip.duration) * pxPerSecond;

        // 找到片段所在轨道的 Y 位置
        let trackY = 26; // 刻度高度
        for (const track of tracks) {
          if (track.id === clip.trackId) break;
          trackY += trackH(track);
        }
        const clipTop = trackY + 1.5; // top-1.5 offset
        const clipBottom = trackY + trackH(tracks.find(t => t.id === clip.trackId)!) - 1.5; // bottom-1.5 offset

        // 检测碰撞：框选矩形与片段矩形相交
        if (boxLeft < clipRight && boxRight > clipLeft && boxTop < clipBottom && boxBottom > clipTop) {
          selected.push(clip.id);
        }
      });

      // 合并初始选择和框选结果
      const finalSelection = Array.from(new Set([...initialSelection, ...selected]));

      // 批量更新选择（需要通过 store 的方法）
      if (finalSelection.length > 0 && finalSelection[0]) {
        onSelectClip(finalSelection[0]);
        finalSelection.slice(1).forEach((id) => {
          if (!selectedClipIds.includes(id)) {
            onToggleClipSelection(id);
          }
        });
      }
    };

    const handleUp = () => {
      setSelecting(false);
      setSelectionBox(null);
      // 干净点击空白轨道（未拖动框选）：播放头跳到点击位置，与点击片段行为一致
      if (!boxMoved) seekFromClientX(clickClientX);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleLaneMouseDown = (e: React.PointerEvent) => {
    // 点击轨道空白区域
    if ((e.target as HTMLElement).classList.contains('timeline-lane-bg')) {
      // 如果不是 Ctrl/Cmd 修饰键，清空选择
      if (!e.ctrlKey && !e.metaKey) {
        onSelectClip(null);
      }
      // 开始框选
      startBoxSelection(e);
    }
  };

  const onLaneDragOver = (e: React.DragEvent, track: TimelineTrack) => {
    if (track.locked) return;
    if (!Array.from(e.dataTransfer.types).includes(ASSET_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dropTrackId !== track.id) setDropTrackId(track.id);
  };
  const onLaneDrop = (e: React.DragEvent, track: TimelineTrack) => {
    const assetId = e.dataTransfer.getData(ASSET_DND_MIME);
    setDropTrackId(null);
    if (!assetId || track.locked) return;
    e.preventDefault();
    const startSec = Math.max(0, (e.clientX - laneLeft()) / pxPerSecond);
    onAddClipToTrack(assetId, track.id, startSec);
  };

  // 轨道排序（原生 HTML5 DnD，拖手柄）；只在同类型轨道间生效
  const onTrackDragStart = (e: React.DragEvent, track: TimelineTrack) => {
    e.dataTransfer.setData(TRACK_DND_MIME, track.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onTrackDragOver = (e: React.DragEvent, track: TimelineTrack) => {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(TRACK_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (reorderOverId !== track.id) setReorderOverId(track.id);
  };
  const onTrackDrop = (e: React.DragEvent, track: TimelineTrack) => {
    const draggedId = e.dataTransfer.getData(TRACK_DND_MIME);
    setReorderOverId(null);
    if (!draggedId || draggedId === track.id) return;
    e.preventDefault();
    onReorderTrack(draggedId, track.id);
  };

  // 轨道高度调整（拖标签行底边）
  const beginTrackResize = (e: React.PointerEvent, track: TimelineTrack) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = trackH(track);
    const onMove = (ev: PointerEvent) => onSetTrackHeight(track.id, startH + (ev.clientY - startY));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const videoCount = tracks.filter((t) => t.type === 'video').length;
  const audioCount = tracks.filter((t) => t.type === 'audio').length;

  return (
    <section style={{ height }} className="shrink-0 flex flex-col bg-[#1b1b1b] border-t border-white/10 select-none">
      <div className="h-9 flex items-center px-4 gap-3 border-b border-white/10">
        <span className="text-sm font-semibold text-white/80">时间线</span>
        <span className="text-xs text-white/35 tabular-nums">{formatTimecode(playhead)} / {formatTimecode(totalDuration)}</span>
        <span className="text-xs text-white/30">· {clips.length} 片段</span>
        <div className="ml-auto flex items-center gap-1.5">
          {onSetToolMode && (
            <>
              <button
                type="button"
                title="选择工具 (V)"
                onClick={() => onSetToolMode('select')}
                className={`h-6 px-2 rounded text-[11px] flex items-center gap-1 ${toolMode === 'select' ? 'bg-[#f01b5c]/20 text-[#f01b5c]' : 'bg-white/[0.06] text-white/50 hover:text-white'}`}
              >
                <MousePointer2 size={12} />选择
              </button>
              <button
                type="button"
                title="切割工具 (C)"
                onClick={() => onSetToolMode('cut')}
                className={`h-6 px-2 rounded text-[11px] flex items-center gap-1 ${toolMode === 'cut' ? 'bg-[#f01b5c]/20 text-[#f01b5c]' : 'bg-white/[0.06] text-white/50 hover:text-white'}`}
              >
                <Scissors size={12} />切割
              </button>
              <span className="w-px h-4 bg-white/10 mx-1" />
            </>
          )}
          <button type="button" onClick={() => onAddTrack('video')} className="h-6 px-2 rounded bg-white/[0.06] text-[11px] text-white/60 hover:text-white flex items-center gap-1"><Plus size={11} />视频轨</button>
          <button type="button" onClick={() => onAddTrack('audio')} className="h-6 px-2 rounded bg-white/[0.06] text-[11px] text-white/60 hover:text-white flex items-center gap-1"><Plus size={11} />音频轨</button>
          <span className="w-px h-4 bg-white/10 mx-1" />
          <button
            type="button"
            title={snapEnabled ? '吸附对齐：开' : '吸附对齐：关'}
            onClick={onToggleSnap}
            className={`h-6 px-2 rounded text-[11px] flex items-center gap-1 ${snapEnabled ? 'bg-[#f01b5c]/20 text-[#f01b5c]' : 'bg-white/[0.06] text-white/50 hover:text-white'}`}
          >
            <Magnet size={12} />吸附
          </button>
          <span className="w-px h-4 bg-white/10 mx-1" />
          <button type="button" onClick={() => onZoom(pxPerSecond / 1.4)} className="h-6 w-6 rounded bg-white/[0.06] text-white/60 hover:text-white">−</button>
          <span className="text-[11px] text-white/40 w-10 text-center tabular-nums">{zoomPct}%</span>
          <button type="button" onClick={() => onZoom(pxPerSecond * 1.4)} className="h-6 w-6 rounded bg-white/[0.06] text-white/60 hover:text-white">+</button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 轨道标签列（竖向滚动跟随右侧轨道区） */}
        <div ref={labelColRef} className="shrink-0 overflow-hidden border-r border-white/10 bg-[#181818]" style={{ width: LABEL_W }}>
          <div className="h-6 border-b border-white/10" />
          {tracks.map((track) => {
            const canRemove = (track.type === 'video' ? videoCount : audioCount) > 1;
            return (
              <div
                key={track.id}
                onDragOver={(e) => onTrackDragOver(e, track)}
                onDragLeave={() => reorderOverId === track.id && setReorderOverId(null)}
                onDrop={(e) => onTrackDrop(e, track)}
                style={{ height: trackH(track) }}
                className={`relative flex flex-col justify-center gap-1 px-2 border-b border-white/5 ${reorderOverId === track.id ? 'bg-[#f01b5c]/10' : ''}`}
              >
                <div className="flex items-center gap-1 text-xs text-white/60">
                  <span
                    draggable
                    onDragStart={(e) => onTrackDragStart(e, track)}
                    title="拖动排序"
                    className="cursor-grab active:cursor-grabbing text-white/25 hover:text-white/60"
                  >
                    <GripVertical size={12} />
                  </span>
                  {track.type === 'video' ? <Film size={12} /> : track.type === 'audio' ? <Music size={12} /> : <Type size={12} />}
                  <span className="truncate flex-1">{track.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" title={track.locked ? '解锁' : '锁定'} onClick={() => onToggleLocked(track.id)} className={`h-5 w-5 rounded flex items-center justify-center ${track.locked ? 'text-[#f01b5c]' : 'text-white/40 hover:text-white/70'}`}>
                    {track.locked ? <Lock size={11} /> : <Unlock size={11} />}
                  </button>
                  {track.type !== 'audio' && (
                    <button type="button" title={track.hidden ? '显示画面' : '隐藏画面'} onClick={() => onToggleHidden(track.id)} className={`h-5 w-5 rounded flex items-center justify-center ${track.hidden ? 'text-[#f01b5c]' : 'text-white/40 hover:text-white/70'}`}>
                      {track.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  )}
                  {track.type !== 'text' && (
                    <button type="button" title={track.muted ? '取消静音' : '静音'} onClick={() => onToggleMuted(track.id)} className={`h-5 w-5 rounded flex items-center justify-center ${track.muted ? 'text-[#f01b5c]' : 'text-white/40 hover:text-white/70'}`}>
                      {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                    </button>
                  )}
                  <button type="button" title="删除轨道" disabled={!canRemove} onClick={() => onRemoveTrack(track.id)} className="h-5 w-5 rounded flex items-center justify-center text-white/40 hover:text-[#f01b5c] disabled:opacity-20 disabled:hover:text-white/40 ml-auto">
                    <Trash2 size={11} />
                  </button>
                </div>
                <div
                  onPointerDown={(e) => beginTrackResize(e, track)}
                  style={{ touchAction: 'none' }}
                  title="拖动调整轨道高度"
                  className="absolute bottom-0 inset-x-0 h-1.5 cursor-ns-resize hover:bg-[#f01b5c]/60"
                />
              </div>
            );
          })}
        </div>

        {/* 轨道内容（可横向滚动 + 竖向滚动，竖向同步左侧标签列） */}
        <div
          ref={scrollRef}
          onScroll={(e) => { if (labelColRef.current) labelColRef.current.scrollTop = e.currentTarget.scrollTop; }}
          className="flex-1 overflow-x-auto overflow-y-auto"
        >
          <div ref={laneRef} className="relative" style={{ width: laneWidth }}>
            {/* 刻度（点击/拖动跳转播放头） */}
            <div className="relative h-6 border-b border-white/10 cursor-text" onPointerDown={beginPlayheadDrag}>
              {Array.from({ length: Math.floor(rulerSeconds / step) + 1 }).map((_, i) => {
                const sec = i * step;
                return (
                  <div key={sec} className="absolute top-0 h-full border-l border-white/10 pl-1 text-[10px] text-white/35 pointer-events-none" style={{ left: sec * pxPerSecond }}>
                    {formatTime(sec)}
                  </div>
                );
              })}
            </div>

            {/* 播放头 */}
            <div className="absolute top-0 bottom-0 w-px bg-[#f01b5c] pointer-events-none z-20" style={{ left: playhead * pxPerSecond }}>
              <div className="absolute -top-0 -left-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-[#f01b5c]" />
            </div>

            {/* I/O 入出点区间高亮 */}
            {(inPoint !== null || outPoint !== null) && (
              <div
                className="absolute top-0 bottom-0 bg-[#5bc0ff]/10 border-x border-[#5bc0ff]/50 pointer-events-none z-10"
                style={{
                  left: (inPoint ?? 0) * pxPerSecond,
                  width: ((outPoint ?? totalDuration) - (inPoint ?? 0)) * pxPerSecond,
                }}
              />
            )}
            {inPoint !== null && (
              <div className="absolute top-0 h-6 w-0.5 bg-[#5bc0ff] pointer-events-none z-20" style={{ left: inPoint * pxPerSecond }}>
                <span className="absolute top-0 left-0 text-[9px] text-[#5bc0ff] font-bold">I</span>
              </div>
            )}
            {outPoint !== null && (
              <div className="absolute top-0 h-6 w-0.5 bg-[#5bc0ff] pointer-events-none z-20" style={{ left: outPoint * pxPerSecond }}>
                <span className="absolute top-0 -left-2 text-[9px] text-[#5bc0ff] font-bold">O</span>
              </div>
            )}

            {/* 轨道 lanes */}
            {tracks.map((track) => (
              <div
                key={track.id}
                ref={(el) => { laneEls.current[track.id] = el; }}
                onDragOver={(e) => onLaneDragOver(e, track)}
                onDragLeave={() => dropTrackId === track.id && setDropTrackId(null)}
                onDrop={(e) => onLaneDrop(e, track)}
                onPointerDown={handleLaneMouseDown}
                style={{ height: trackH(track) }}
                className={`timeline-lane-bg relative border-b border-white/5 ${dropTrackId === track.id ? 'bg-[#f01b5c]/10' : ''} ${track.locked ? 'opacity-60' : ''}`}
              >
                {clips.filter((c) => c.trackId === track.id).map((clip) => {
                  const asset = assetById.get(clip.assetId);
                  const primary = clip.id === selectedClipId;
                  const inSelection = selectedClipIds.includes(clip.id);
                  const dragging = clip.id === draggingClipId;
                  const w = Math.max(12, clip.duration * pxPerSecond);
                  // 关键帧标记时间（跨所有可动画属性去重）
                  const kfTimes = clip.keyframes
                    ? Array.from(new Set(ANIMATABLE_KEYS.flatMap((k) => (clip.keyframes?.[k] ?? []).map((kf) => kf.t)))).sort((a, b) => a - b)
                    : [];
                  return (
                    <div
                      key={clip.id}
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => beginDrag(e, clip, 'move', asset)}
                      style={{ left: clip.start * pxPerSecond, width: w, touchAction: 'none', cursor: toolMode === 'cut' ? 'crosshair' : track.locked ? 'not-allowed' : 'grab' }}
                      className={`absolute top-1.5 bottom-1.5 rounded-md overflow-hidden border text-left ${
                        dragging ? 'opacity-90 z-10' : ''
                      } ${primary ? 'border-[#f01b5c] ring-1 ring-[#f01b5c]' : inSelection ? 'border-[#f01b5c]/70 ring-1 ring-[#f01b5c]/50' : 'border-white/15'} ${
                        track.type === 'video' ? 'bg-[#2d3a5a]' : track.type === 'audio' ? 'bg-[#2a4a42]' : 'bg-[#5a4a2a]'
                      }`}
                    >
                      {asset?.thumbnail && track.type === 'video' && (
                        <img src={asset.thumbnail} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-35 pointer-events-none" />
                      )}
                      {track.type === 'audio' && (
                        <div className="absolute inset-x-0 bottom-0 top-4 flex items-center gap-px px-1 pointer-events-none opacity-60">
                          {clipBars(asset, clip, w).map((bar, i) => (
                            <span key={i} className="flex-1 bg-[#7fe7c4]" style={{ height: `${Math.max(6, bar * 100)}%` }} />
                          ))}
                        </div>
                      )}
                      {clip.text && (
                        <span className="absolute left-1 top-1 text-white/40 pointer-events-none"><Type size={10} /></span>
                      )}
                      <span className={`relative px-2 pt-1 block truncate text-[11px] text-white/85 pointer-events-none ${clip.text ? 'pl-5' : ''}`}>
                        {clip.text ? (clip.text.content || '文字') : (asset?.name ?? '片段')}
                      </span>
                      {w > 44 && (
                        <span className="absolute bottom-0.5 right-1 text-[10px] text-white/55 tabular-nums pointer-events-none">
                          {formatTime(clip.duration)}
                        </span>
                      )}
                      {/* 关键帧标记（菱形） */}
                      {kfTimes.map((t, i) => (
                        <span
                          key={`kf-${i}`}
                          title={`关键帧 ${formatTime(t)}`}
                          style={{ left: t * pxPerSecond, marginLeft: -3 }}
                          className="absolute top-1 w-1.5 h-1.5 rotate-45 bg-amber-400 pointer-events-none z-10"
                        />
                      ))}
                      {/* 转场标记：片段开头覆盖 transition.duration 的斜纹区 */}
                      {clip.transition && (
                        <div
                          title={`转场 ${formatTime(clip.transition.duration)}`}
                          style={{ width: Math.max(6, clip.transition.duration * pxPerSecond) }}
                          className="absolute left-0 top-0 bottom-0 pointer-events-none z-10 bg-[repeating-linear-gradient(45deg,rgba(91,192,255,0.45)_0,rgba(91,192,255,0.45)_4px,transparent_4px,transparent_8px)] border-r border-[#5bc0ff]/60"
                        />
                      )}
                      {!track.locked && (
                        <>
                          <div onPointerDown={(e) => beginDrag(e, clip, 'trim-start', asset)} style={{ touchAction: 'none' }} className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/20 hover:bg-[#f01b5c]" />
                          <div onPointerDown={(e) => beginDrag(e, clip, 'trim-end', asset)} style={{ touchAction: 'none' }} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/20 hover:bg-[#f01b5c]" />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* 框选矩形 */}
            {selecting && selectionBox && (
              <div
                className="absolute border-2 border-[#f01b5c] bg-[#f01b5c]/10 pointer-events-none z-50"
                style={{
                  left: selectionBox.x,
                  top: selectionBox.y,
                  width: selectionBox.w,
                  height: selectionBox.h,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}


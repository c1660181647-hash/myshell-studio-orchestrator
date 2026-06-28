import React, { Fragment, useEffect, useRef, useMemo, useState } from 'react';
import { Music, Play, Pause, Square, Repeat, Maximize2, Film } from 'lucide-react';
import type { EditorAsset, TimelineClip, TimelineTrack, ClipProps, PreviewQuality } from '../types';
import { formatTimecode, clipProps, resolveClipPropsAt, clipSpeed, clipFilters, clipCrop, filterCss, sharpenAmount, temperatureOverlay, transitionStyles, transitionNeedsUnderlay, textAnimationStyle, textExitAnimationStyle } from '../utils';

interface PreviewPanelProps {
  clips: TimelineClip[];
  assets: EditorAsset[];
  tracks: TimelineTrack[];
  playhead: number;
  playing: boolean;
  playbackRate: number;
  playDirection: 1 | -1;
  loop: boolean;
  fps: number;
  aspectRatio: string;
  previewQuality: PreviewQuality;
  fallbackAsset: EditorAsset | null;
  selectedClipIds: string[];
  onTogglePlay: () => void;
  onStop: () => void;
  onSetPlaybackRate: (rate: number) => void;
  onSetPreviewQuality: (q: PreviewQuality) => void;
  onToggleLoop: () => void;
  onSetAspectRatio: (ratio: string) => void;
  onSetClipProps: (id: string, patch: Partial<ClipProps>) => void;
  onSetClipText: (id: string, patch: { content: string }) => void;
  onSelectClip?: (id: string) => void;
  onUpdateClip?: (id: string, patch: Partial<TimelineClip>) => void;
}

// 淡入淡出系数（0..1）：clip 局部时间在淡入/淡出区间内时按比例衰减
function fadeFactor(p: ClipProps, localTime: number, duration: number): number {
  let f = 1;
  if (p.fadeIn > 0 && localTime < p.fadeIn) f = Math.min(f, localTime / p.fadeIn);
  if (p.fadeOut > 0 && localTime > duration - p.fadeOut) f = Math.min(f, (duration - localTime) / p.fadeOut);
  return Math.max(0, Math.min(1, f));
}

const ASPECT_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'];
// 选中片段的四角缩放手柄（在画框内直接拖拉缩放，不必靠属性面板）
const CORNER_HANDLES: { pos: React.CSSProperties; cursor: string }[] = [
  { pos: { top: -6, left: -6 }, cursor: 'nwse-resize' },
  { pos: { top: -6, right: -6 }, cursor: 'nesw-resize' },
  { pos: { bottom: -6, left: -6 }, cursor: 'nesw-resize' },
  { pos: { bottom: -6, right: -6 }, cursor: 'nwse-resize' },
];
// 速度快捷预设（datalist），实际可在 0.1–16x 间任意输入
const RATE_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8];
// 预览画质：降低渲染分辨率以提升重特效项目的播放流畅度（DOM 预览下减少合成/滤镜开销）
const QUALITY_OPTIONS: { id: PreviewQuality; label: string }[] = [
  { id: 'full', label: '高清' },
  { id: 'standard', label: '标准' },
  { id: 'draft', label: '流畅' },
];

// 文字层组件（独立测量实际尺寸）
const TextLayer = React.memo(function TextLayer({
  clip,
  playhead,
  frameH,
  isSel,
  editing,
  onSetClipText,
  onSetEditingTextId,
  onSelectClip,
  onDragPosition,
  onRotateDrag,
  onScaleDrag
}: {
  clip: TimelineClip;
  playhead: number;
  frameH: number;
  isSel: boolean;
  editing: boolean;
  onSetClipText: (id: string, patch: { content: string }) => void;
  onSetEditingTextId: (id: string | null) => void;
  onSelectClip?: (id: string) => void;
  onDragPosition: (e: React.PointerEvent, clip: TimelineClip) => void;
  onRotateDrag: (e: React.PointerEvent, clip: TimelineClip) => void;
  onScaleDrag: (e: React.PointerEvent, clip: TimelineClip) => void;
}) {
  const localT = playhead - clip.start;
  const p = resolveClipPropsAt(clip, localT);
  const fade = fadeFactor(p, localT, clip.duration);
  const txt = clip.text!;
  const fontPx = (txt.fontSize / 100) * frameH;
  const textRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const [textSize, setTextSize] = useState({ w: 0, h: 0 });
  const hasInitialized = useRef(false);

  // 初始化编辑器内容（仅在编辑模式开启时执行一次）
  useEffect(() => {
    if (editing && editRef.current && !hasInitialized.current) {
      hasInitialized.current = true;
      editRef.current.textContent = txt.content;
      editRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(editRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    if (!editing) {
      hasInitialized.current = false;
    }
  }, [editing]); // 移除 txt.content 依赖，避免拖动时重新初始化

  // 测量文字实际尺寸
  useEffect(() => {
    if (textRef.current) {
      const rect = textRef.current.getBoundingClientRect();
      setTextSize({ w: rect.width, h: rect.height });
    }
  }, [txt.content, txt.fontSize, txt.fontFamily, txt.fontWeight, txt.fontStyle, frameH]);

  // 计算入场/出场动画
  const entranceDur = txt.entranceDuration ?? 0.6;
  const exitDur = txt.exitDuration ?? 0.6;
  let animTransform = 'none';
  let animOpacity = 1;
  if (localT < entranceDur && txt.entrance) {
    const entranceProgress = localT / entranceDur; // 0..1
    const entranceStyle = textAnimationStyle(txt.entrance, entranceProgress);
    animTransform = entranceStyle.transform;
    animOpacity = entranceStyle.opacity;
  } else if (localT > clip.duration - exitDur && txt.exit) {
    const exitProgress = (localT - (clip.duration - exitDur)) / exitDur; // 0..1 表示退出进度
    const exitStyle = textExitAnimationStyle(txt.exit, exitProgress);
    animTransform = exitStyle.transform;
    animOpacity = exitStyle.opacity;
  }

  const textStyle: React.CSSProperties = {
    fontSize: `${fontPx}px`,
    lineHeight: 1.2,
    color: txt.color,
    backgroundColor: txt.bgColor,
    fontWeight: txt.fontWeight,
    fontStyle: txt.fontStyle,
    textAlign: txt.align,
    fontFamily: txt.fontFamily,
    textShadow: txt.bgColor === 'transparent' ? '0 2px 8px rgba(0,0,0,0.6)' : 'none',
  };

  const transformOf = (p: ClipProps) =>
    `translate(${p.x}%, ${p.y}%) scale(${p.scale}) rotate(${p.rotation}deg)`;

  const combinedOpacity = p.opacity * fade * animOpacity;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ transform: animTransform, opacity: combinedOpacity }}
    >
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ transform: transformOf(p) }}
      >
        <div className="relative" style={{ width: textSize.w || 'auto', height: textSize.h || 'auto', pointerEvents: 'auto' }}>
        {editing ? (
          <div
            ref={editRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onBlur={(e) => {
              // 用 innerText 而非 textContent：保留 Shift+Enter 产生的换行（textContent 会丢掉 <br>/<div> → 多行被合并成一行）
              const newContent = (e.currentTarget.innerText || '').replace(/\n+$/, '');
              onSetClipText(clip.id, { content: newContent });
              onSetEditingTextId(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.currentTarget.blur();
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className="max-w-[92vw] min-w-[100px] whitespace-pre-wrap break-words px-2 py-1 rounded outline-none ring-2 ring-[#f01b5c] cursor-text"
            style={textStyle}
          />
        ) : (
          <>
            <div
              ref={textRef}
              className={`max-w-[92vw] whitespace-pre-wrap break-words px-2 py-1 rounded ${isSel ? 'ring-2 ring-[#f01b5c]/70 cursor-move' : 'cursor-pointer'}`}
              style={textStyle}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (onSelectClip && !isSel) {
                  onSelectClip(clip.id);
                } else if (isSel) {
                  onDragPosition(e, clip);
                }
              }}
              onDoubleClick={(e) => { e.stopPropagation(); onSetEditingTextId(clip.id); }}
            >
              {txt.content || ' '}
            </div>
            {isSel && textSize.w > 0 && (
              <>
                <div
                  onPointerDown={(e) => onRotateDrag(e, clip)}
                  style={{ top: -28, left: '50%', transform: 'translateX(-50%)', cursor: 'grab', touchAction: 'none' }}
                  className="absolute w-6 h-6 rounded-full bg-white border-2 border-[#f01b5c] shadow flex items-center justify-center text-xs"
                  title="拖动旋转"
                >
                  🔄
                </div>
                {CORNER_HANDLES.map((hdl, i) => (
                  <div
                    key={i}
                    onPointerDown={(e) => onScaleDrag(e, clip)}
                    style={{ ...hdl.pos, cursor: hdl.cursor, touchAction: 'none' }}
                    className="absolute w-3 h-3 rounded-sm bg-white border border-[#f01b5c] shadow"
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
});

// 把媒体元素的播放时间同步到主时钟（播放头）。使用更严格的容忍度避免切割边界处的闪烁。
function syncMedia(el: HTMLMediaElement | null, target: number, playing: boolean, rate: number, volume: number) {
  if (!el) return;
  if (el.playbackRate !== rate) el.playbackRate = rate;
  // 高倍速（>2x）浏览器音频会变调/失真/丢采样，自动静音保画质（剪映/PR 高速预览同样做法）；
  // 降速回到 ≤2x 时此处会自动恢复音量
  const v = rate > 2 ? 0 : Math.max(0, Math.min(1, volume)); // HTMLMediaElement.volume 上限 1.0；>100% 增益需 Web Audio（Phase 6）
  if (Math.abs(el.volume - v) > 0.01) el.volume = v; // 避免微小变化导致频繁更新
  if (playing) {
    // 容忍度随倍速线性放大：每帧播放头前进 dt×rate，固定 0.1s 容差在高倍速下每帧都触发强制 seek，
    // seek 冲刷解码缓冲→更跟不上→再 seek，陷入抖动卡顿。按 rate×0.1 保持约 6 帧纠偏余量（1x 时仍为 0.1s，行为不变）。
    const tol = Math.max(0.1, rate * 0.1);
    if (Math.abs(el.currentTime - target) > tol) el.currentTime = target;
    if (el.paused) void el.play().catch(() => {});
  } else {
    if (!el.paused) el.pause();
    // 暂停/倒放跟随：上一次 seek 未完成时不发起新 seek，否则反向 seek 互相冲刷、画面卡在某帧。
    // 倒放时播放头每帧在动 → target 每帧变 → 本 effect 每帧重跑，seek 完成后下一帧自然追到最新目标
    // （按解码速度逐帧推进，跟不上则丢帧，不会冻结）。
    if (!el.seeking && Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
  }
}

function VideoLayer({ clipId, src, target, playing, muted, rate, volume, filter, className, style }: { clipId: string; src: string; target: number; playing: boolean; muted: boolean; rate: number; volume: number; filter?: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  const roundedVolume = Math.round(volume * 100) / 100; // 四舍五入到0.01，避免微小变化
  const lastSeekRef = useRef(-1); // 记录上次 onSeeked 校正的目标，防止对同一帧反复 seek 死循环

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
    syncMedia(ref.current, target, playing, rate, roundedVolume);
  }, [target, playing, rate, roundedVolume, muted]);

  // 倒放/暂停跟随：每次 seek 落地后，若仍偏离最新目标则补一次校正。
  // 这解决"停止瞬间有 seek 在途、守卫跳过末次校正 → 停在错帧"。
  // 仅在非正向播放时生效（正向播放靠 video 自身播放，不需要）；
  // lastSeekRef + 0.04 阈值（>一帧 0.033s）防止帧量化导致的无限 seek。
  const onSeeked = () => {
    const el = ref.current;
    if (!el || playing) return;
    if (Math.abs(el.currentTime - target) > 0.04 && Math.abs(lastSeekRef.current - target) > 0.001) {
      lastSeekRef.current = target;
      el.currentTime = target;
    }
  };

  return <video ref={ref} src={src} playsInline onSeeked={onSeeked} style={{ ...(filter ? { filter } : {}), ...style }} className={className ?? 'w-full h-full object-contain'} />;
}

function AudioLayer({ src, target, playing, rate, volume }: { src: string; target: number; playing: boolean; rate: number; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  const roundedVolume = Math.round(volume * 100) / 100; // 四舍五入到0.01，避免微小变化

  useEffect(() => {
    syncMedia(ref.current, target, playing, rate, roundedVolume);
  }, [target, playing, rate, roundedVolume]);
  return <audio ref={ref} src={src} />;
}

// 片段变换 CSS（位置/缩放/旋转）
function transformCss(p: ClipProps): string {
  return `translate(${p.x}%, ${p.y}%) scale(${p.scale}) rotate(${p.rotation}deg)`;
}

// 转场垫底层：上一相邻片段定格在末帧（无交互、不参与播放），供溶解/擦除/滑动叠化
function FrozenLayer({ clip, asset, playbackRate }: { clip: TimelineClip; asset: EditorAsset; playbackRate: number }) {
  const endLocal = clip.duration;
  const p = resolveClipPropsAt(clip, endLocal);
  const f = clipFilters(clip);
  const fcss = filterCss(f);
  const tempOv = temperatureOverlay(f);
  const sharpAmount = sharpenAmount(f);
  const combinedFilter = sharpAmount > 0.5 ? `${fcss} url(#sharpen-filter)` : fcss;
  const target = Math.max(0, clip.trimStart + endLocal * clipSpeed(clip) - 0.04);
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ transform: transformCss(p), opacity: p.opacity }}>
      <div className="relative w-full h-full" style={{ isolation: 'isolate' }}>
        {asset.type === 'video' ? (
          <VideoLayer clipId={clip.id} src={asset.url} target={target} playing={false} muted rate={playbackRate} volume={0} filter={combinedFilter} />
        ) : (
          <img src={asset.url} alt="" draggable={false} style={{ filter: combinedFilter }} className="w-full h-full object-contain" />
        )}
        {tempOv && <div className="absolute inset-0" style={{ backgroundColor: tempOv.color, opacity: tempOv.opacity, mixBlendMode: 'soft-light' }} />}
      </div>
    </div>
  );
}

export default function PreviewPanel({
  clips, assets, tracks, playhead, playing, playbackRate, playDirection, loop, fps, aspectRatio, previewQuality, fallbackAsset, selectedClipIds,
  onTogglePlay, onStop, onSetPlaybackRate, onSetPreviewQuality, onToggleLoop, onSetAspectRatio, onSetClipProps, onSetClipText, onSelectClip, onUpdateClip,
}: PreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1); // 预览缩放，1 = 适应窗口
  const [editingTextId, setEditingTextId] = useState<string | null>(null); // 正在就地编辑的文字片段
  const [cropMode, setCropMode] = useState(false); // 裁剪模式：显示8方向拖拽边框
  // 渲染分辨率系数：媒体层以更低像素合成（CSS 滤镜/叠加按更少像素计算），再放大显示
  const qualityScale = previewQuality === 'draft' ? 0.5 : previewQuality === 'standard' ? 0.66 : 1;
  // 反向播放：HTML <video> 无法正向 play() 倒放，倒放时让媒体元素保持暂停、靠 seek 跟随
  // 反向走动的播放头（store 的 tick 已驱动）。正放则正常 play()。
  const forwardPlaying = playing && playDirection === 1;
  // 不依赖播放头的派生值：播放时每帧重渲染也不重算
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  // 隐藏的视频轨不出画面；静音的音频轨不发声
  const videoTrackIds = useMemo(
    () => new Set(tracks.filter((t) => t.type === 'video' && !t.hidden).map((t) => t.id)),
    [tracks],
  );
  const audioTrackIds = useMemo(
    () => new Set(tracks.filter((t) => t.type === 'audio' && !t.muted).map((t) => t.id)),
    [tracks],
  );
  const hasTimeline = clips.length > 0;
  const totalDuration = useMemo(
    () => clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0),
    [clips],
  );
  // 边界判断：使用小容差避免浮点精度问题，同时确保切割点处片段不会提前消失
  const within = (c: TimelineClip) => {
    const eps = 0.001; // 1ms容差，避免浮点误差
    return playhead >= c.start - eps && playhead < c.start + c.duration + eps;
  };
  // 源素材时间 = 入点 + 时间线经过时长 × 速度（速度越快，源走得越快）
  const targetOf = (c: TimelineClip) => c.trimStart + (playhead - c.start) * clipSpeed(c);

  // 转场垫底：同轨上结束最晚、且在本片段开始之前的片段（作为"上一段"定格末帧）
  const prevAdjacentClip = (c: TimelineClip): TimelineClip | null => {
    let best: TimelineClip | null = null;
    let bestEnd = -Infinity;
    for (const o of clips) {
      if (o.trackId !== c.trackId || o.id === c.id) continue;
      const end = o.start + o.duration;
      if (end <= c.start + 0.06 && end > bestEnd) { best = o; bestEnd = end; }
    }
    return best;
  };

  // 视频轨：所有覆盖播放头的可见片段，统一排序（视频/图片/文字都在这里，按轨道+zIndex排序）
  const trackIndex = new Map(tracks.map((t, i) => [t.id, i]));

  // 所有可见轨道上的片段（视频、图片、文字统一处理）
  const allActiveClips = clips
    .filter((c) => videoTrackIds.has(c.trackId) && within(c))
    .sort((l, r) => {
      // 轨道靠前(视频1)在最上层 → 让其最后渲染（DOM 末尾绘制在最上）；同轨道内按 zIndex 排序
      const trackDiff = (trackIndex.get(r.trackId) ?? 0) - (trackIndex.get(l.trackId) ?? 0);
      if (trackDiff !== 0) return trackDiff;
      return (l.zIndex ?? 0) - (r.zIndex ?? 0); // 同轨道内 zIndex 小的先渲染（在下层）
    });

  // 音频轨：所有覆盖播放头的片段同时发声
  const activeAudios = clips
    .filter((c) => audioTrackIds.has(c.trackId) && within(c))
    .map((c) => ({ c, a: assetById.get(c.assetId) }))
    .filter((x): x is { c: TimelineClip; a: EditorAsset } => Boolean(x.a));

  // 在预览窗口拖拽定位（更新指定片段的 x/y，单位：容器尺寸百分比）
  const beginDragPosition = (e: React.PointerEvent, clip: TimelineClip) => {
    e.preventDefault();
    const base = clipProps(clip);
    const startX = e.clientX, startY = e.clientY;
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width || 1, h = rect?.height || 1;
    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / w) * 100;
      const dy = ((ev.clientY - startY) / h) * 100;
      onSetClipProps(clip.id, {
        x: Math.round((base.x + dx) * 10) / 10,
        y: Math.round((base.y + dy) * 10) / 10,
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 在画框内拖拉四角缩放选中片段：缩放比 = 基准缩放 × (指针离中心距离 / 起始距离)
  const beginScaleDrag = (e: React.PointerEvent, clip: TimelineClip) => {
    e.preventDefault();
    e.stopPropagation();
    const base = clipProps(clip);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    const onMove = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      const next = Math.min(4, Math.max(0.1, (base.scale * dist) / startDist));
      onSetClipProps(clip.id, { scale: Math.round(next * 100) / 100 });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 旋转手柄拖拽：计算指针相对画框中心的角度
  const beginRotateDrag = (e: React.PointerEvent, clip: TimelineClip) => {
    e.preventDefault();
    e.stopPropagation();
    const base = clipProps(clip);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    const onMove = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
      let rotation = base.rotation + (angle - startAngle);
      // 规范化到 -180..180
      while (rotation > 180) rotation -= 360;
      while (rotation < -180) rotation += 360;
      onSetClipProps(clip.id, { rotation: Math.round(rotation) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 裁剪边框拖拽：调整 crop 的 top/right/bottom/left 值
  const beginCropDrag = (e: React.PointerEvent, clip: TimelineClip, edge: 'top' | 'right' | 'bottom' | 'left', fitW: number, fitH: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onUpdateClip) return;
    const startX = e.clientX, startY = e.clientY;
    const baseCrop = clipCrop(clip);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newCrop = { ...baseCrop };
      if (edge === 'top') {
        newCrop.top = Math.max(0, Math.min(0.9, baseCrop.top + dy / fitH));
      } else if (edge === 'bottom') {
        newCrop.bottom = Math.max(0, Math.min(0.9, baseCrop.bottom - dy / fitH));
      } else if (edge === 'left') {
        newCrop.left = Math.max(0, Math.min(0.9, baseCrop.left + dx / fitW));
      } else if (edge === 'right') {
        newCrop.right = Math.max(0, Math.min(0.9, baseCrop.right - dx / fitW));
      }
      // 确保对边之和不超过 0.95
      if (newCrop.left + newCrop.right > 0.95) {
        if (edge === 'left') newCrop.left = 0.95 - newCrop.right;
        else newCrop.right = 0.95 - newCrop.left;
      }
      if (newCrop.top + newCrop.bottom > 0.95) {
        if (edge === 'top') newCrop.top = 0.95 - newCrop.bottom;
        else newCrop.bottom = 0.95 - newCrop.top;
      }
      onUpdateClip!(clip.id, { crop: newCrop });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const transformOf = (p: ClipProps) =>
    `translate(${p.x}%, ${p.y}%) scale(${p.scale}) rotate(${p.rotation}deg)`;

  // 画框：按项目比例在可视区内"适应窗口"，再乘缩放系数。用真实像素避免 width:100% 与竖屏比例打架
  const frame = useMemo(() => {
    const [aw, ah] = aspectRatio.split(':').map(Number);
    const rw = aw > 0 ? aw : 16;
    const rh = ah > 0 ? ah : 9;
    const availW = Math.max(40, viewport.w - 24);
    const availH = Math.max(40, viewport.h - 24);
    const fit = Math.min(availW / rw, availH / rh);
    return { w: rw * fit * zoom, h: rh * fit * zoom };
  }, [aspectRatio, viewport, zoom]);
  const zoomPct = Math.round(zoom * 100);

  // 测量可视区尺寸（窗口/面板尺寸变化时自适应）
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl/⌘ + 滚轮缩放预览（普通滚轮留给溢出滚动）
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      setZoom((z) => Math.min(5, Math.max(0.1, z * (ev.deltaY < 0 ? 1.1 : 1 / 1.1))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-[#141414]">
      {/* SVG 滤镜定义：锐化卷积核 */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="sharpen-filter">
            <feConvolveMatrix
              order="3"
              kernelMatrix="0 -1 0  -1 5 -1  0 -1 0"
              preserveAlpha="true"
            />
          </filter>
        </defs>
      </svg>
      <div ref={viewportRef} className="flex-1 min-h-0 overflow-auto flex p-3">
        <div
          ref={containerRef}
          className="relative bg-black rounded-lg overflow-hidden shrink-0 m-auto flex items-center justify-center"
          style={{ width: frame.w, height: frame.h }}
        >
          {hasTimeline ? (
            <>
              {allActiveClips.length === 0 && <div className="text-white/25 text-xs">此处无画面</div>}
              {allActiveClips.map((c) => {
                // 文字片段：使用 TextLayer 组件
                if (c.text) {
                  return (
                    <TextLayer
                      key={c.id}
                      clip={c}
                      playhead={playhead}
                      frameH={frame.h}
                      isSel={selectedClipIds.includes(c.id)}
                      editing={editingTextId === c.id}
                      onSetClipText={onSetClipText}
                      onSetEditingTextId={setEditingTextId}
                      onSelectClip={onSelectClip}
                      onDragPosition={beginDragPosition}
                      onRotateDrag={beginRotateDrag}
                      onScaleDrag={beginScaleDrag}
                    />
                  );
                }

                // 视频/图片片段：使用原有渲染逻辑
                const a = assetById.get(c.assetId);
                if (!a) return null;
                const track = tracks.find((t) => t.id === c.trackId);
                const muted = Boolean(track?.muted) || Boolean(c.sourceMuted);
                const localT = playhead - c.start;
                const p = resolveClipPropsAt(c, localT); // 含关键帧插值
                const fade = fadeFactor(p, localT, c.duration);
                const isSel = selectedClipIds.includes(c.id);
                const f = clipFilters(c);
                const fcss = filterCss(f);
                const tempOv = temperatureOverlay(f);
                const sharpAmount = sharpenAmount(f);
                // 组合 CSS filter 和 SVG filter（锐化）
                const combinedFilter = sharpAmount > 0.5
                  ? `${fcss} url(#sharpen-filter)`
                  : fcss;
                // 转场：在本片段开头 transition.duration 秒内播放
                const tr = c.transition;
                const inTr = tr ? localT >= 0 && localT < tr.duration : false;
                const ts = inTr && tr ? transitionStyles(tr.type, localT / tr.duration) : null;
                const prev = inTr && tr && transitionNeedsUnderlay(tr.type) ? prevAdjacentClip(c) : null;
                const prevAsset = prev ? assetById.get(prev.assetId) : null;
                const innerStyle: React.CSSProperties = { isolation: 'isolate' };
                if (ts) {
                  innerStyle.opacity = ts.opacity;
                  if (ts.transform !== 'none') innerStyle.transform = ts.transform;
                  if (ts.clipPath !== 'none') innerStyle.clipPath = ts.clipPath;
                }
                // 镜像变换：在转场变换之后追加
                const flipTransform = `${c.flipH ? 'scaleX(-1) ' : ''}${c.flipV ? 'scaleY(-1)' : ''}`.trim();
                if (flipTransform) {
                  innerStyle.transform = innerStyle.transform && innerStyle.transform !== 'none'
                    ? `${innerStyle.transform} ${flipTransform}`
                    : flipTransform;
                }
                return (
                  <Fragment key={c.id}>
                    {/* 转场垫底：上一相邻片段定格末帧，置于入场层之下做叠化 */}
                    {prev && prevAsset && (
                      <FrozenLayer clip={prev} asset={prevAsset} playbackRate={playbackRate} />
                    )}
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ transform: transformOf(p), opacity: p.opacity * fade, pointerEvents: 'none' }}
                    >
                      {/* 计算素材在 object-contain 下的实际显示尺寸 */}
                      {(() => {
                        const aw = a.width ?? 1920;
                        const ah = a.height ?? 1080;
                        const assetAspect = aw / ah;
                        const frameAspect = frame.w / frame.h;
                        let fitW: number, fitH: number;
                        if (assetAspect > frameAspect) {
                          // 素材更宽，宽度填满
                          fitW = frame.w;
                          fitH = frame.w / assetAspect;
                        } else {
                          // 素材更高，高度填满
                          fitH = frame.h;
                          fitW = frame.h * assetAspect;
                        }
                        // 应用裁剪
                        const cr = clipCrop(c);
                        // 只有在裁剪模式下才显示完整素材，其他时候都裁剪
                        const applyCrop = !(isSel && cropMode);
                        const displayW = applyCrop ? fitW * (1 - cr.left - cr.right) : fitW;
                        const displayH = applyCrop ? fitH * (1 - cr.top - cr.bottom) : fitH;
                        const offsetX = applyCrop ? -cr.left * fitW : 0;
                        const offsetY = applyCrop ? -cr.top * fitH : 0;
                        return (
                          <div
                            className="relative cursor-pointer"
                            style={{ width: displayW, height: displayH, pointerEvents: 'auto' }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              if (onSelectClip && !isSel) {
                                onSelectClip(c.id);
                              } else if (isSel && !cropMode) {
                                beginDragPosition(e, c);
                              }
                            }}
                          >
                            <div className="absolute inset-0 overflow-hidden">
                              <div className="absolute" style={{ width: fitW, height: fitH, left: offsetX, top: offsetY }}>
                                <div className="absolute inset-0" style={innerStyle}>
                                <div
                                  className="absolute top-0 left-0"
                                  style={qualityScale < 1
                                    ? { width: `${qualityScale * 100}%`, height: `${qualityScale * 100}%`, transform: `scale(${1 / qualityScale})`, transformOrigin: 'top left' }
                                    : { width: '100%', height: '100%' }}
                                >
                                {a.type === 'video' ? (
                                  <VideoLayer clipId={c.id} key={c.id} src={a.url} target={targetOf(c)} playing={forwardPlaying} muted={muted} rate={playbackRate} volume={p.volume} filter={combinedFilter} />
                                ) : (
                                  <img src={a.url} alt="" draggable={false} style={{ filter: combinedFilter }} className="w-full h-full object-contain" />
                                )}
                                {tempOv && (
                                  <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: tempOv.color, opacity: tempOv.opacity, mixBlendMode: 'soft-light' }} />
                                )}
                                </div>
                              </div>
                              {/* 裁剪模式：显示被裁剪区域的半透明遮罩 */}
                              {isSel && cropMode && (
                                <>
                                  {/* 上方遮罩 */}
                                  {cr.top > 0 && (
                                    <div className="absolute left-0 right-0 bg-black/60 pointer-events-none" style={{ top: 0, height: `${cr.top * 100}%` }} />
                                  )}
                                  {/* 下方遮罩 */}
                                  {cr.bottom > 0 && (
                                    <div className="absolute left-0 right-0 bg-black/60 pointer-events-none" style={{ bottom: 0, height: `${cr.bottom * 100}%` }} />
                                  )}
                                  {/* 左侧遮罩 */}
                                  {cr.left > 0 && (
                                    <div className="absolute top-0 bottom-0 bg-black/60 pointer-events-none" style={{ left: 0, width: `${cr.left * 100}%` }} />
                                  )}
                                  {/* 右侧遮罩 */}
                                  {cr.right > 0 && (
                                    <div className="absolute top-0 bottom-0 bg-black/60 pointer-events-none" style={{ right: 0, width: `${cr.right * 100}%` }} />
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                            {isSel && (
                              <>
                                <div className="absolute inset-0 ring-2 ring-[#f01b5c]/80 ring-inset pointer-events-none" />

                                {!cropMode ? (
                                  <>
                                    {/* 变换模式：旋转手柄 + 缩放手柄 */}
                                    <div
                                      onPointerDown={(e) => beginRotateDrag(e, c)}
                                      style={{
                                        top: -28,
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                        touchAction: 'none',
                                        cursor: 'grab'
                                      }}
                                      className="absolute w-6 h-6 rounded-full bg-white border-2 border-[#f01b5c] shadow flex items-center justify-center z-10"
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#f01b5c]">
                                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                                      </svg>
                                    </div>
                                    {CORNER_HANDLES.map((hdl, i) => (
                                      <div
                                        key={i}
                                        onPointerDown={(e) => beginScaleDrag(e, c)}
                                        style={{ ...hdl.pos, cursor: hdl.cursor, touchAction: 'none' }}
                                        className="absolute w-3 h-3 rounded-sm bg-white border border-[#f01b5c] shadow z-10"
                                      />
                                    ))}
                                  </>
                                ) : (
                                  <>
                                    {/* 裁剪模式：4方向拖拽边框 */}
                                    {/* 上 */}
                                    <div
                                      onPointerDown={(e) => beginCropDrag(e, c, 'top', fitW, fitH)}
                                      style={{ top: -6, left: 0, right: 0, height: 12, cursor: 'ns-resize', touchAction: 'none' }}
                                      className="absolute bg-[#f01b5c]/70 hover:bg-[#f01b5c] z-10"
                                    />
                                    {/* 下 */}
                                    <div
                                      onPointerDown={(e) => beginCropDrag(e, c, 'bottom', fitW, fitH)}
                                      style={{ bottom: -6, left: 0, right: 0, height: 12, cursor: 'ns-resize', touchAction: 'none' }}
                                      className="absolute bg-[#f01b5c]/70 hover:bg-[#f01b5c] z-10"
                                    />
                                    {/* 左 */}
                                    <div
                                      onPointerDown={(e) => beginCropDrag(e, c, 'left', fitW, fitH)}
                                      style={{ left: -6, top: 0, bottom: 0, width: 12, cursor: 'ew-resize', touchAction: 'none' }}
                                      className="absolute bg-[#f01b5c]/70 hover:bg-[#f01b5c] z-10"
                                    />
                                    {/* 右 */}
                                    <div
                                      onPointerDown={(e) => beginCropDrag(e, c, 'right', fitW, fitH)}
                                      style={{ right: -6, top: 0, bottom: 0, width: 12, cursor: 'ew-resize', touchAction: 'none' }}
                                      className="absolute bg-[#f01b5c]/70 hover:bg-[#f01b5c] z-10"
                                    />
                                  </>
                                )}

                                {/* 模式切换/操作按钮 */}
                                {!cropMode ? (
                                  <button
                                    type="button"
                                    onClick={() => setCropMode(true)}
                                    style={{ bottom: -36, right: -2 }}
                                    className="absolute h-7 px-3 rounded bg-white hover:bg-white/90 border-2 border-[#f01b5c] text-xs text-[#f01b5c] font-semibold shadow-lg z-10"
                                  >
                                    ✂️ 裁剪
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setCropMode(false)}
                                    style={{ bottom: -36, right: -2 }}
                                    className="absolute h-7 px-3 rounded bg-[#f01b5c] hover:bg-[#f01b5c]/90 border-2 border-[#f01b5c] text-xs text-white font-semibold shadow-lg z-10"
                                  >
                                    ✓ 完成裁剪
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </Fragment>
                );
              })}
              {activeAudios.map(({ c, a }) => {
                const localT = playhead - c.start;
                const p = clipProps(c);
                const fade = fadeFactor(p, localT, c.duration);
                const computedVolume = p.volume * fade;
                return (
                  <AudioLayer key={c.id} src={a.url} target={targetOf(c)} playing={forwardPlaying} rate={playbackRate} volume={computedVolume} />
                );
              })}
            </>
          ) : fallbackAsset ? (
            <>
              {fallbackAsset.type === 'video' && (
                <video key={fallbackAsset.id} src={fallbackAsset.url} controls className="w-full h-full object-contain" />
              )}
              {fallbackAsset.type === 'image' && (
                <img key={fallbackAsset.id} src={fallbackAsset.url} alt={fallbackAsset.name} className="w-full h-full object-contain" />
              )}
              {fallbackAsset.type === 'audio' && (
                <div className="flex flex-col items-center gap-3 text-white/70">
                  <Music size={40} />
                  <audio src={fallbackAsset.url} controls />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center px-6">
              <Film size={40} className="text-white/15" />
              <div className="text-white/40 text-sm">还没有可预览的画面</div>
              <div className="text-white/25 text-xs">上传素材并添加到时间线后，在此预览</div>
            </div>
          )}
        </div>
      </div>

      {/* 播放控制条 */}
      <div className="h-11 shrink-0 flex items-center gap-2 px-4 border-t border-white/10">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!hasTimeline}
          title={playing ? '暂停 (空格)' : '播放 (空格)'}
          className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center disabled:opacity-30"
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={!hasTimeline}
          title="停止 (回到起点)"
          className="h-7 w-7 rounded bg-white/[0.06] hover:bg-white/15 flex items-center justify-center disabled:opacity-30"
        >
          <Square size={13} />
        </button>
        <button
          type="button"
          onClick={onToggleLoop}
          title={loop ? '循环：开' : '循环：关'}
          className={`h-7 w-7 rounded flex items-center justify-center ${loop ? 'bg-[#f01b5c]/20 text-[#f01b5c]' : 'bg-white/[0.06] text-white/50 hover:text-white'}`}
        >
          <Repeat size={13} />
        </button>
        <span className="ml-1 text-xs text-white/55 tabular-nums">
          {formatTimecode(playhead)} / {formatTimecode(totalDuration)}
        </span>
        {playing && (
          <span
            title="预览帧率"
            className={`text-[11px] tabular-nums ${fps >= 55 ? 'text-emerald-400/70' : fps >= 30 ? 'text-amber-400/80' : 'text-[#f01b5c]'}`}
          >
            {fps} fps
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button type="button" title="缩小预览" onClick={() => setZoom((z) => Math.max(0.1, z / 1.2))} className="h-6 w-6 rounded bg-white/[0.06] text-white/60 hover:text-white">−</button>
            <span className="text-[11px] text-white/40 w-9 text-center tabular-nums">{zoomPct}%</span>
            <button type="button" title="放大预览" onClick={() => setZoom((z) => Math.min(5, z * 1.2))} className="h-6 w-6 rounded bg-white/[0.06] text-white/60 hover:text-white">+</button>
            <button type="button" title="适应窗口" onClick={() => setZoom(1)} className="h-6 w-6 rounded bg-white/[0.06] text-white/60 hover:text-white flex items-center justify-center"><Maximize2 size={12} /></button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-white/35">画质</span>
            <select
              value={previewQuality}
              onChange={(e) => onSetPreviewQuality(e.target.value as PreviewQuality)}
              title="预览画质 ⌘1/2/3（降低分辨率可提升重特效项目的播放流畅度，不影响导出）"
              className="h-7 rounded bg-white/[0.06] text-xs text-white/80 px-1.5 border border-white/10 outline-none"
            >
              {QUALITY_OPTIONS.map((q) => <option key={q.id} value={q.id} className="bg-[#222]">{q.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-white/35">速度</span>
            <input
              type="number"
              min={0.1}
              max={16}
              step={0.05}
              value={playbackRate}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onSetPlaybackRate(v);
              }}
              list="preview-rate-presets"
              title="播放速度（0.1–16x，可自定义）。超过 2x 时浏览器音频会失真，预览自动静音（不影响导出）"
              className="h-7 w-16 rounded bg-white/[0.06] text-xs text-white/80 px-1.5 border border-white/10 outline-none tabular-nums"
            />
            <datalist id="preview-rate-presets">
              {RATE_PRESETS.map((r) => <option key={r} value={r} />)}
            </datalist>
            <span className="text-[11px] text-white/35">x</span>
            {playbackRate > 2 && (
              <span title="超过 2x 浏览器音频会失真，预览已自动静音" className="text-[10px] text-amber-400/70">静音</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-white/35">比例</span>
            <select
              value={aspectRatio}
              onChange={(e) => onSetAspectRatio(e.target.value)}
              className="h-7 rounded bg-white/[0.06] text-xs text-white/80 px-1.5 border border-white/10 outline-none"
            >
              {ASPECT_OPTIONS.map((r) => <option key={r} value={r} className="bg-[#222]">{r}</option>)}
            </select>
          </div>
        </div>
      </div>
    </main>
  );
}

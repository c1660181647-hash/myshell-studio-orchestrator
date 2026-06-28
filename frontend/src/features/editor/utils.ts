import type { EditorAssetType, TimelineClip, ClipProps, ClipFilters, CropInsets, AnimatableKey, Keyframe, TransitionType, TextAnimationType } from './types';
import { DEFAULT_CLIP_PROPS, CLIP_PROP_KEYS, ANIMATABLE_KEYS, DEFAULT_CLIP_FILTERS, DEFAULT_CROP } from './types';

// 转场入场层渲染样式（进度 p: 0..1）。垫底层保持原样，靠入场层叠化/揭开/滑入/缩放
export interface TransitionRender {
  opacity: number;
  transform: string;
  clipPath: string;
}

export function transitionStyles(type: TransitionType, p: number): TransitionRender {
  const t = Math.max(0, Math.min(1, p));
  const base: TransitionRender = { opacity: 1, transform: 'none', clipPath: 'none' };
  switch (type) {
    case 'fade':
    case 'dissolve':
      return { ...base, opacity: t };
    case 'wipe-left':
      return { ...base, clipPath: `inset(0 ${(1 - t) * 100}% 0 0)` };
    case 'wipe-right':
      return { ...base, clipPath: `inset(0 0 0 ${(1 - t) * 100}%)` };
    case 'wipe-up':
      return { ...base, clipPath: `inset(0 0 ${(1 - t) * 100}% 0)` };
    case 'wipe-down':
      return { ...base, clipPath: `inset(${(1 - t) * 100}% 0 0 0)` };
    case 'slide-left':
      return { ...base, transform: `translateX(${(1 - t) * 100}%)` };
    case 'slide-right':
      return { ...base, transform: `translateX(${-(1 - t) * 100}%)` };
    case 'zoom-in':
      return { ...base, opacity: t, transform: `scale(${0.6 + 0.4 * t})` };
    case 'zoom-out':
      return { ...base, opacity: t, transform: `scale(${1.4 - 0.4 * t})` };
    default:
      return base;
  }
}

// fade（从黑场淡入）不需要垫底；其余需要上一相邻片段定格垫底才是真叠化
export function transitionNeedsUnderlay(type: TransitionType): boolean {
  return type !== 'fade';
}

// 把片段上可选的属性字段解析为完整 ClipProps（缺省走默认值；不含关键帧动画，用于面板静态展示/复制）
export function clipProps(clip: TimelineClip | null | undefined): ClipProps {
  if (!clip) return { ...DEFAULT_CLIP_PROPS };
  const out = { ...DEFAULT_CLIP_PROPS };
  for (const k of CLIP_PROP_KEYS) {
    const v = clip[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// 解析片段滤镜（缺省走默认值）
export function clipFilters(clip: TimelineClip | null | undefined): ClipFilters {
  const out = { ...DEFAULT_CLIP_FILTERS };
  const f = clip?.filters;
  if (!f) return out;
  (Object.keys(DEFAULT_CLIP_FILTERS) as (keyof ClipFilters)[]).forEach((k) => {
    const v = f[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  });
  return out;
}

// 解析裁剪边距（各边 0..0.9，且对边之和不超过 0.95，保留可见区域）
export function clipCrop(clip: TimelineClip | null | undefined): CropInsets {
  const out = { ...DEFAULT_CROP };
  const c = clip?.crop;
  if (!c) return out;
  (['top', 'right', 'bottom', 'left'] as (keyof CropInsets)[]).forEach((k) => {
    const v = c[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.min(0.9, v));
  });
  if (out.left + out.right > 0.95) out.right = 0.95 - out.left;
  if (out.top + out.bottom > 0.95) out.bottom = 0.95 - out.top;
  return out;
}

// 按总强度把某滤镜值从中性值 neutral 缩放到 raw
function withStrength(raw: number, neutral: number, strength: number): number {
  return neutral + (raw - neutral) * (strength / 100);
}

// 构造 CSS filter 字符串（不含色温——色温用叠加层实现；不含锐化——锐化用 SVG filter）
export function filterCss(f: ClipFilters): string {
  const s = f.strength;
  const parts = [
    `brightness(${withStrength(f.brightness, 100, s)}%)`,
    `contrast(${withStrength(f.contrast, 100, s)}%)`,
    `saturate(${withStrength(f.saturate, 100, s)}%)`,
    `blur(${withStrength(f.blur, 0, s)}px)`,
    `grayscale(${withStrength(f.grayscale, 0, s)}%)`,
    `sepia(${withStrength(f.sepia, 0, s)}%)`,
  ];
  return parts.join(' ');
}

// 计算锐化强度（0..100 映射到卷积核系数）
export function sharpenAmount(f: ClipFilters): number {
  return withStrength(f.sharpen, 0, f.strength);
}

// 色温叠加层颜色（soft-light 混合）：暖→橙、冷→蓝；返回 null 表示无需叠加
export function temperatureOverlay(f: ClipFilters): { color: string; opacity: number } | null {
  const t = withStrength(f.temperature, 0, f.strength);
  if (Math.abs(t) < 0.5) return null;
  const mag = Math.min(1, Math.abs(t) / 100) * 0.5; // 最大 0.5 不透明度
  return { color: t > 0 ? '#ff8a3d' : '#3da5ff', opacity: mag };
}

// 是否有任何非默认滤镜（决定预览是否需要叠加滤镜层）
export function hasActiveFilters(f: ClipFilters): boolean {
  return (
    f.brightness !== 100 || f.contrast !== 100 || f.saturate !== 100 ||
    f.temperature !== 0 || f.blur !== 0 || f.sharpen !== 0 || f.grayscale !== 0 || f.sepia !== 0
  );
}

// 片段速度倍率（0.25..4，默认 1）
export function clipSpeed(clip: TimelineClip): number {
  const s = clip.speed;
  return typeof s === 'number' && s > 0 ? s : 1;
}

// 源素材区间（trimEnd-trimStart）经速度换算后的时间线时长
export function durationFromTrim(trimStart: number, trimEnd: number, speed: number): number {
  return (trimEnd - trimStart) / (speed > 0 ? speed : 1);
}

// 关键帧线性插值：给定该属性的关键帧数组与片段本地时间 t，返回插值
function interpKeyframes(kfs: Keyframe[], t: number): number {
  if (kfs.length === 1) return kfs[0].value;
  if (t <= kfs[0].t) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.value;
      return a.value + (b.value - a.value) * ((t - a.t) / span);
    }
  }
  return last.value;
}

// 解析片段在「本地时间 localT」处的有效属性：变换类属性若有关键帧则插值，否则取静态值
export function resolveClipPropsAt(clip: TimelineClip, localT: number): ClipProps {
  const base = clipProps(clip);
  const kf = clip.keyframes;
  if (!kf) return base;
  for (const k of ANIMATABLE_KEYS) {
    const arr = kf[k];
    if (arr && arr.length) base[k] = interpKeyframes(arr, localT);
  }
  return base;
}

// 某属性是否有关键帧
export function hasKeyframes(clip: TimelineClip, key: AnimatableKey): boolean {
  return Boolean(clip.keyframes?.[key]?.length);
}

// 在关键帧数组中插入/更新 t 处的值（同 t 覆盖），返回按 t 升序的新数组
export function upsertKeyframe(kfs: Keyframe[], t: number, value: number): Keyframe[] {
  const eps = 1e-3;
  const next = kfs.filter((k) => Math.abs(k.t - t) > eps);
  next.push({ t, value });
  next.sort((a, b) => a.t - b.t);
  return next;
}

export function genId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// HH:MM:SS.CS 时间码（时间线刻度用，匹配开发计划格式）
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe % 1) * 100);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function assetTypeFromFile(file: File): EditorAssetType {
  if (file.type.startsWith('video')) return 'video';
  if (file.type.startsWith('audio')) return 'audio';
  return 'image';
}

type AssetMeta = { thumbnail?: string; duration?: number; width?: number; height?: number };

// 用 Web Audio API 解码音频，下采样成波形峰值（0..1）。失败返回 undefined，由占位波形兜底。
export async function extractAudioPeaks(blob: Blob, buckets = 240): Promise<number[] | undefined> {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return undefined;
    const ctx = new AC();
    const audioBuf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = audioBuf.getChannelData(0);
    const block = Math.max(1, Math.floor(ch.length / buckets));
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < buckets; i++) {
      let peak = 0;
      const start = i * block;
      for (let j = 0; j < block && start + j < ch.length; j++) {
        const v = Math.abs(ch[start + j]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
      if (peak > max) max = peak;
    }
    void ctx.close();
    return max > 0 ? peaks.map((p) => p / max) : peaks;
  } catch {
    return undefined;
  }
}

export async function extractAssetMeta(url: string, type: EditorAssetType): Promise<AssetMeta> {
  try {
    if (type === 'video') return await extractVideoMeta(url);
    if (type === 'image') return await extractImageMeta(url);
    if (type === 'audio') return await extractAudioMeta(url);
  } catch {
    /* best-effort: 失败时返回空，不阻塞上传 */
  }
  return {};
}

function extractVideoMeta(url: string): Promise<AssetMeta> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;
    video.onloadeddata = () => {
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      // 取首帧附近作缩略图
      const seekTo = Number.isFinite(duration) ? Math.min(0.1, duration / 2) : 0;
      const onSeeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = Math.round((160 * (height || 9)) / (width || 16));
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve({ duration, width, height, thumbnail: canvas.toDataURL('image/jpeg', 0.7) });
        } catch {
          resolve({ duration, width, height });
        }
      };
      video.onseeked = onSeeked;
      video.currentTime = seekTo;
    };
    video.onerror = () => reject(new Error('video metadata failed'));
  });
}

function extractImageMeta(url: string): Promise<AssetMeta> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, thumbnail: url });
    img.onerror = () => reject(new Error('image metadata failed'));
    img.src = url;
  });
}

function extractAudioMeta(url: string): Promise<AssetMeta> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = url;
    audio.onloadedmetadata = () => resolve({ duration: audio.duration });
    audio.onerror = () => reject(new Error('audio metadata failed'));
  });
}

// 文字动画样式计算：返回 CSS transform 和 opacity，progress 0..1
export interface TextAnimationStyle {
  transform: string;
  opacity: number;
}

export function textAnimationStyle(type: TextAnimationType | undefined, progress: number): TextAnimationStyle {
  if (!type || type === 'none') return { transform: 'none', opacity: 1 };
  const p = Math.max(0, Math.min(1, progress)); // 限制在 0..1
  switch (type) {
    case 'fade':
      return { transform: 'none', opacity: p };
    case 'slide-up':
      return { transform: `translateY(${(1 - p) * 50}%)`, opacity: p };
    case 'slide-down':
      return { transform: `translateY(${-(1 - p) * 50}%)`, opacity: p };
    case 'slide-left':
      return { transform: `translateX(${(1 - p) * 50}%)`, opacity: p };
    case 'slide-right':
      return { transform: `translateX(${-(1 - p) * 50}%)`, opacity: p };
    case 'zoom-in':
      return { transform: `scale(${0.5 + p * 0.5})`, opacity: p };
    case 'zoom-out':
      return { transform: `scale(${1.5 - p * 0.5})`, opacity: p };
    case 'bounce':
      // 弹跳效果：使用 cubic-bezier 模拟弹性
      const bounce = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      return { transform: `translateY(${-(1 - bounce) * 30}%)`, opacity: p };
    default:
      return { transform: 'none', opacity: 1 };
  }
}

// 出场动画样式：入场动画的镜像反向
export function textExitAnimationStyle(type: TextAnimationType | undefined, progress: number): TextAnimationStyle {
  if (!type || type === 'none') return { transform: 'none', opacity: 1 };
  const p = Math.max(0, Math.min(1, progress)); // 0..1，0=完全可见，1=完全消失
  switch (type) {
    case 'fade':
      return { transform: 'none', opacity: 1 - p };
    case 'slide-up':
      return { transform: `translateY(${-p * 50}%)`, opacity: 1 - p }; // 向上滑出
    case 'slide-down':
      return { transform: `translateY(${p * 50}%)`, opacity: 1 - p }; // 向下滑出
    case 'slide-left':
      return { transform: `translateX(${-p * 50}%)`, opacity: 1 - p }; // 向左滑出
    case 'slide-right':
      return { transform: `translateX(${p * 50}%)`, opacity: 1 - p }; // 向右滑出
    case 'zoom-in':
      return { transform: `scale(${1 + p * 0.5})`, opacity: 1 - p }; // 放大消失
    case 'zoom-out':
      return { transform: `scale(${1 - p * 0.5})`, opacity: 1 - p }; // 缩小消失
    case 'bounce':
      const bounce = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      return { transform: `translateY(${bounce * 30}%)`, opacity: 1 - p }; // 弹跳向下消失
    default:
      return { transform: 'none', opacity: 1 };
  }
}

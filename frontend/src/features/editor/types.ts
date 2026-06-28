// Phase 1 数据模型：剪辑器素材 / 轨道 / 片段
// 后续会迁移到 StudioProject.editor_data 持久化（见开发计划 Phase 1）

export type EditorAssetType = 'video' | 'audio' | 'image';

// 预览画质档位：降低渲染分辨率换取重特效项目的播放流畅度（不影响导出）
export type PreviewQuality = 'full' | 'standard' | 'draft';

export interface EditorAsset {
  id: string;
  name: string;
  type: EditorAssetType;
  url: string; // 本地 object URL（blob:）
  thumbnail?: string; // data URL 缩略图
  duration?: number; // 秒（视频 / 音频）
  width?: number;
  height?: number;
  size: number; // 字节
  peaks?: number[]; // 真实音频波形采样（0..1），由 Web Audio API 解码生成
}

export type EditorTrackType = 'video' | 'audio' | 'text';

export interface TimelineTrack {
  id: string;
  type: EditorTrackType;
  name: string;
  locked?: boolean; // 锁定后不可编辑（移动/裁剪/拖入）
  muted?: boolean; // 音频轨静音
  hidden?: boolean; // 视频轨/文字轨隐藏（预览不显示）
  height?: number; // 轨道行高（px），缺省 64
}

// 文字片段内容与样式（存在 clip.text）。位置/缩放/旋转/透明度/淡入淡出复用 ClipProps
export interface TextClipData {
  content: string;
  fontSize: number; // 占画框高度的百分比（如 8 = 画框高的 8%），保证缩放/换比例 WYSIWYG
  color: string; // 文字颜色
  bgColor: string; // 背景色（'transparent' 表示无）
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  align: 'left' | 'center' | 'right';
  fontFamily: string;
  entrance?: TextAnimationType; // 入场动画
  exit?: TextAnimationType; // 出场动画
  entranceDuration?: number; // 入场动画时长（秒），默认 0.6
  exitDuration?: number; // 出场动画时长（秒），默认 0.6
}

// 文字动画类型
export type TextAnimationType = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom-in' | 'zoom-out' | 'bounce';

export const DEFAULT_TEXT_DATA: TextClipData = {
  content: '双击编辑文字',
  fontSize: 8,
  color: '#ffffff',
  bgColor: 'transparent',
  fontWeight: 'bold',
  fontStyle: 'normal',
  align: 'center',
  fontFamily: 'system-ui, sans-serif',
  entrance: 'fade',
  exit: 'fade',
  entranceDuration: 0.6,
  exitDuration: 0.6,
};

// 文字样式预设（左栏文字库一键添加）
export interface TextStylePreset {
  id: string;
  name: string;
  data: Partial<TextClipData>;
}

export const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  { id: 'plain', name: '默认标题', data: {} },
  { id: 'subtitle', name: '字幕', data: { fontSize: 5, bgColor: 'rgba(0,0,0,0.5)', fontWeight: 'normal' } },
  { id: 'bold-yellow', name: '醒目黄', data: { color: '#ffe600', fontSize: 11 } },
  { id: 'black-bar', name: '黑底白字', data: { bgColor: 'rgba(0,0,0,0.7)', color: '#ffffff' } },
  { id: 'pink', name: '粉标题', data: { color: '#f01b5c', fontSize: 10 } },
];

export const FONT_FAMILIES = [
  { value: 'system-ui, sans-serif', label: '系统默认' },
  { value: 'Georgia, serif', label: '衬线' },
  { value: '"Courier New", monospace', label: '等宽' },
  { value: '"Arial Black", sans-serif', label: '粗黑' },
];

export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  start: number; // 时间线上的起点（秒）
  duration: number; // 片段在时间线上的时长（秒）= (trimEnd-trimStart)/speed
  trimStart: number; // 源素材入点（秒）
  trimEnd: number; // 源素材出点（秒）
  speed?: number; // 播放速度倍率，默认 1（0.25..4）
  zIndex?: number; // 图层顺序（同轨道内，数值越大越在上层），默认 0
  // Phase 4 片段属性（全部可选，缺省走默认值，见 utils.clipProps）
  x?: number; // 位置偏移 X（占预览容器比例，-100..100，0=居中）
  y?: number; // 位置偏移 Y
  scale?: number; // 缩放，1 = 100%
  rotation?: number; // 旋转（度）
  opacity?: number; // 不透明度 0..1
  volume?: number; // 音量 0..2（视频自带音轨 / 音频片段）
  fadeIn?: number; // 淡入时长（秒）
  fadeOut?: number; // 淡出时长（秒）
  sourceMuted?: boolean; // 视频片段自带音轨是否静音（音频分离后置 true，区别于整轨静音）
  filters?: Partial<ClipFilters>; // 滤镜（缺省走 DEFAULT_CLIP_FILTERS）
  transition?: ClipTransition; // 入场转场：在本片段开头播放，与同轨上一相邻片段叠化
  text?: TextClipData; // 文字片段内容与样式（仅文字轨片段，assetId 为空）
  flipH?: boolean; // 水平镜像
  flipV?: boolean; // 垂直镜像
  crop?: CropInsets; // 裁剪（各边占素材的比例 0..1）
  // 关键帧：按可动画属性存，t 为片段本地时间（秒，0..duration）
  keyframes?: Partial<Record<AnimatableKey, Keyframe[]>>;
}

// 裁剪边距（各边占素材显示矩形的比例，0..1）
export interface CropInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_CROP: CropInsets = { top: 0, right: 0, bottom: 0, left: 0 };

// 转场类型（挂在入场片段上，占该片段开头 duration 秒）
export type TransitionType = 'fade' | 'dissolve' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'slide-left' | 'slide-right' | 'zoom-in' | 'zoom-out';

export interface ClipTransition {
  type: TransitionType;
  duration: number; // 转场时长（秒，0.2..3）
}

export interface TransitionDef {
  type: TransitionType;
  name: string;
}

export const TRANSITION_DEFS: TransitionDef[] = [
  { type: 'fade', name: '淡入' },
  { type: 'dissolve', name: '溶解' },
  { type: 'wipe-left', name: '擦除←' },
  { type: 'wipe-right', name: '擦除→' },
  { type: 'wipe-up', name: '擦除↑' },
  { type: 'wipe-down', name: '擦除↓' },
  { type: 'slide-left', name: '滑动←' },
  { type: 'slide-right', name: '滑动→' },
  { type: 'zoom-in', name: '放大' },
  { type: 'zoom-out', name: '缩小' },
];

export const DEFAULT_TRANSITION_DURATION = 0.6;

// 片段滤镜（CSS filter + 色温叠加层 + SVG 锐化）
export interface ClipFilters {
  brightness: number; // 亮度 %  100 = 正常 (0..200)
  contrast: number;   // 对比度 % 100 = 正常 (0..200)
  saturate: number;   // 饱和度 % 100 = 正常 (0..200)
  temperature: number; // 色温 -100(冷)..100(暖)  0 = 中性
  blur: number;       // 模糊 px (0..20)
  sharpen: number;    // 锐化 (0..100)  0 = 无锐化
  grayscale: number;  // 黑白 %  (0..100)
  sepia: number;      // 棕褐 %  (0..100)
  strength: number;   // 总强度 % (0..100) 缩放所有滤镜偏离中性的程度
}

export const DEFAULT_CLIP_FILTERS: ClipFilters = {
  brightness: 100, contrast: 100, saturate: 100, temperature: 0,
  blur: 0, sharpen: 0, grayscale: 0, sepia: 0, strength: 100,
};

// 内置滤镜预设（一键套用，区别于用户保存的属性预设）
export interface FilterPreset {
  id: string;
  name: string;
  filters: Partial<ClipFilters>; // 未列出的字段回到默认
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', name: '原始', filters: {} },
  { id: 'vivid', name: '鲜艳', filters: { saturate: 150, contrast: 115, brightness: 104 } },
  { id: 'retro', name: '复古', filters: { sepia: 45, contrast: 108, saturate: 82, temperature: 30 } },
  { id: 'soft', name: '柔和', filters: { contrast: 90, brightness: 106, saturate: 94 } },
  { id: 'sharp', name: '锐化', filters: { sharpen: 60, contrast: 108 } },
  { id: 'bw', name: '黑白', filters: { grayscale: 100, contrast: 110 } },
  { id: 'cool', name: '冷调', filters: { temperature: -45, saturate: 108 } },
  { id: 'warm', name: '暖调', filters: { temperature: 45, saturate: 104 } },
];

// 可关键帧动画的属性（仅变换类，线性插值）
export type AnimatableKey = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';
export const ANIMATABLE_KEYS: AnimatableKey[] = ['x', 'y', 'scale', 'rotation', 'opacity'];

export interface Keyframe {
  t: number; // 片段本地时间（秒，相对片段起点）
  value: number;
}

// 片段可调属性（含默认值），用于属性面板编辑与复制/粘贴
export interface ClipProps {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export const CLIP_PROP_KEYS: (keyof ClipProps)[] = [
  'x', 'y', 'scale', 'rotation', 'opacity', 'volume', 'fadeIn', 'fadeOut',
];

export const DEFAULT_CLIP_PROPS: ClipProps = {
  x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, fadeIn: 0, fadeOut: 0,
};

// 属性预设（localStorage 全局复用，仅含静态视觉/音频属性）
export interface ClipPropPreset {
  id: string;
  name: string;
  props: ClipProps;
}

// 持久化快照：素材的 url 在加载时由 IndexedDB blob 重新生成
export interface EditorSnapshot {
  version: 1;
  assets: EditorAsset[];
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  aspectRatio?: string; // 项目画布比例，如 '16:9'
}

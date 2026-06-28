import { memo, useState } from 'react';
import { Copy, ClipboardPaste, RotateCcw, Diamond, Save, Trash2, Bookmark, AudioLines, FlipHorizontal, FlipVertical } from 'lucide-react';
import type { EditorAsset, TimelineClip, ClipProps, ClipFilters, AnimatableKey, ClipPropPreset, TextClipData } from '../types';
import { FILTER_PRESETS, TRANSITION_DEFS, FONT_FAMILIES } from '../types';
import { formatTime, formatBytes, resolveClipPropsAt, clipSpeed, hasKeyframes, clipFilters, clipCrop } from '../utils';

interface PropertyPanelProps {
  clip: TimelineClip | null;
  asset: EditorAsset | null;
  width: number;
  playhead: number;
  selectedCount: number; // 多选片段数（>1 时进入批量模式）
  hasClipboard: boolean;
  presets: ClipPropPreset[];
  onSetClipProps: (id: string, patch: Partial<ClipProps>) => void;
  onApplyToSelected: (patch: Partial<ClipProps>) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onSetClipSpeed: (id: string, speed: number) => void;
  onToggleKeyframe: (id: string, key: AnimatableKey) => void;
  onCopyProps: (id: string) => void;
  onPasteProps: (id: string) => void;
  onResetProps: (id: string) => void;
  onSavePreset: (name: string, fromClipId: string) => void;
  onApplyPreset: (presetId: string, clipId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onDetachAudio: (id: string) => void;
  onSetClipFilters: (id: string, patch: Partial<ClipFilters>) => void;
  onApplyFilterPreset: (id: string, presetId: string) => void;
  onSetTransitionDuration: (id: string, duration: number) => void;
  onRemoveTransition: (id: string) => void;
  onSetClipText: (id: string, patch: Partial<TextClipData>) => void;
  onRemoveClip: (id: string) => void;
}

// 滑块 + 数值输入行；可选关键帧菱形按钮
function SliderRow({
  label, value, min, max, step, suffix = '', onChange, kfKey, kfActive, onToggleKf,
}: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string;
  onChange: (v: number) => void;
  kfKey?: AnimatableKey; kfActive?: boolean; onToggleKf?: (key: AnimatableKey) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1">
          {kfKey && onToggleKf && (
            <button type="button" title="在播放头处添加/删除关键帧" onClick={() => onToggleKf(kfKey)}
              className={`h-4 w-4 flex items-center justify-center ${kfActive ? 'text-[#f01b5c]' : 'text-white/25 hover:text-white/60'}`}>
              <Diamond size={10} fill={kfActive ? 'currentColor' : 'none'} />
            </button>
          )}
          <span className="text-[11px] text-white/45">{label}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <input type="number" value={value} min={min} max={max} step={step}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(clamp(v)); }}
            className="w-14 h-6 rounded bg-white/[0.06] text-[11px] text-white/80 px-1 text-right border border-white/10 outline-none focus:border-[#f01b5c]/50" />
          {suffix && <span className="text-[10px] text-white/30 w-3">{suffix}</span>}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="w-full h-1 accent-[#f01b5c] cursor-pointer" />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-white/5">
      <span className="text-[11px] text-white/40">{label}</span>
      <span className="text-xs text-white/75 tabular-nums">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">{children}</div>;
}

function PropertyEditor({
  clip, asset, playhead, selectedCount, hasClipboard, presets,
  onSetClipProps, onApplyToSelected, onUpdateClip, onSetClipSpeed, onToggleKeyframe,
  onCopyProps, onPasteProps, onResetProps, onSavePreset, onApplyPreset, onDeletePreset, onDetachAudio,
  onSetClipFilters, onApplyFilterPreset, onSetTransitionDuration, onRemoveTransition, onRemoveClip,
}: {
  clip: TimelineClip; asset: EditorAsset; playhead: number; selectedCount: number;
  hasClipboard: boolean; presets: ClipPropPreset[];
  onSetClipProps: (id: string, patch: Partial<ClipProps>) => void;
  onApplyToSelected: (patch: Partial<ClipProps>) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onSetClipSpeed: (id: string, speed: number) => void;
  onToggleKeyframe: (id: string, key: AnimatableKey) => void;
  onCopyProps: (id: string) => void;
  onPasteProps: (id: string) => void;
  onResetProps: (id: string) => void;
  onSavePreset: (name: string, fromClipId: string) => void;
  onApplyPreset: (presetId: string, clipId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onDetachAudio: (id: string) => void;
  onSetClipFilters: (id: string, patch: Partial<ClipFilters>) => void;
  onApplyFilterPreset: (id: string, presetId: string) => void;
  onSetTransitionDuration: (id: string, duration: number) => void;
  onRemoveTransition: (id: string) => void;
  onRemoveClip: (id: string) => void;
}) {
  const [batch, setBatch] = useState(true);
  const [presetName, setPresetName] = useState('');
  const localT = Math.max(0, Math.min(clip.duration, playhead - clip.start));
  const p = resolveClipPropsAt(clip, localT); // 含关键帧插值，反映播放头处的有效值
  const f = clipFilters(clip);
  const cr = clipCrop(clip);
  const speed = clipSpeed(clip);
  const isVisual = asset.type === 'video' || asset.type === 'image';
  const hasAudio = asset.type === 'video' || asset.type === 'audio';
  const sourceDur = asset.duration;
  const multi = selectedCount > 1;
  // 批量开启且多选 → 应用到所有选中；否则仅当前片段
  const set = (patch: Partial<ClipProps>) =>
    (multi && batch) ? onApplyToSelected(patch) : onSetClipProps(clip.id, patch);
  const setF = (patch: Partial<ClipFilters>) => onSetClipFilters(clip.id, patch);
  const kfActive = (key: AnimatableKey) => hasKeyframes(clip, key);
  const toggleKf = (key: AnimatableKey) => onToggleKeyframe(clip.id, key);

  const setTrimStart = (v: number) => {
    const ts = Math.min(Math.max(0, v), clip.trimEnd - 0.1);
    onUpdateClip(clip.id, { trimStart: ts, duration: (clip.trimEnd - ts) / speed });
  };
  const setTrimEnd = (v: number) => {
    const max = sourceDur ?? clip.trimEnd;
    const te = Math.min(Math.max(clip.trimStart + 0.1, v), max);
    onUpdateClip(clip.id, { trimEnd: te, duration: (te - clip.trimStart) / speed });
  };

  return (
    <div className="flex-1 overflow-y-auto p-3">
      {asset.thumbnail && (
        <img src={asset.thumbnail} alt={asset.name} className="w-full rounded-md mb-2 border border-white/10" />
      )}
      <div className="text-xs font-medium text-white/85 truncate mb-2">{asset.name}</div>

      {multi && (
        <label className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded bg-[#f01b5c]/10 text-[11px] text-white/70 cursor-pointer">
          <input type="checkbox" checked={batch} onChange={(e) => setBatch(e.target.checked)} className="accent-[#f01b5c]" />
          已选 {selectedCount} 个片段，同步修改
        </label>
      )}

      <div className="flex items-center gap-1 mb-1">
        <button type="button" onClick={() => onCopyProps(clip.id)} title="复制属性"
          className="flex-1 h-7 rounded bg-white/[0.06] hover:bg-white/15 flex items-center justify-center gap-1 text-[11px] text-white/60">
          <Copy size={12} />复制
        </button>
        <button type="button" onClick={() => onPasteProps(clip.id)} disabled={!hasClipboard} title="粘贴属性"
          className="flex-1 h-7 rounded bg-white/[0.06] hover:bg-white/15 flex items-center justify-center gap-1 text-[11px] text-white/60 disabled:opacity-30">
          <ClipboardPaste size={12} />粘贴
        </button>
        <button type="button" onClick={() => onResetProps(clip.id)} title="重置属性"
          className="flex-1 h-7 rounded bg-white/[0.06] hover:bg-white/15 flex items-center justify-center gap-1 text-[11px] text-white/60">
          <RotateCcw size={12} />重置
        </button>
      </div>

      <SectionTitle>速度</SectionTitle>
      <SliderRow label="播放速度" value={Math.round(speed * 100) / 100} min={0.25} max={4} step={0.05} suffix="x" onChange={(v) => onSetClipSpeed(clip.id, v)} />

      {isVisual && (
        <>
          <SectionTitle>变换（◆ 可打关键帧）</SectionTitle>
          <SliderRow label="位置 X" value={Math.round(p.x * 10) / 10} min={-100} max={100} step={1} suffix="%" onChange={(v) => set({ x: v })} kfKey="x" kfActive={kfActive('x')} onToggleKf={toggleKf} />
          <SliderRow label="位置 Y" value={Math.round(p.y * 10) / 10} min={-100} max={100} step={1} suffix="%" onChange={(v) => set({ y: v })} kfKey="y" kfActive={kfActive('y')} onToggleKf={toggleKf} />
          <SliderRow label="缩放" value={Math.round(p.scale * 100)} min={10} max={400} step={1} suffix="%" onChange={(v) => set({ scale: v / 100 })} kfKey="scale" kfActive={kfActive('scale')} onToggleKf={toggleKf} />
          <SliderRow label="旋转" value={Math.round(p.rotation)} min={-180} max={180} step={1} suffix="°" onChange={(v) => set({ rotation: v })} kfKey="rotation" kfActive={kfActive('rotation')} onToggleKf={toggleKf} />
          <SliderRow label="不透明度" value={Math.round(p.opacity * 100)} min={0} max={100} step={1} suffix="%" onChange={(v) => set({ opacity: v / 100 })} kfKey="opacity" kfActive={kfActive('opacity')} onToggleKf={toggleKf} />
        </>
      )}

      {isVisual && (
        <>
          <SectionTitle>镜像</SectionTitle>
          <div className="flex items-center gap-1 py-1">
            <button type="button" title="水平镜像" onClick={() => onUpdateClip(clip.id, { flipH: !clip.flipH })}
              className={`h-7 flex-1 rounded flex items-center justify-center gap-1 text-[11px] ${clip.flipH ? 'bg-[#f01b5c]/30 text-white' : 'bg-white/[0.06] text-white/60'}`}>
              <FlipHorizontal size={13} />水平
            </button>
            <button type="button" title="垂直镜像" onClick={() => onUpdateClip(clip.id, { flipV: !clip.flipV })}
              className={`h-7 flex-1 rounded flex items-center justify-center gap-1 text-[11px] ${clip.flipV ? 'bg-[#f01b5c]/30 text-white' : 'bg-white/[0.06] text-white/60'}`}>
              <FlipVertical size={13} />垂直
            </button>
          </div>
          {(clip.flipH || clip.flipV) ? (
            <button type="button" onClick={() => onUpdateClip(clip.id, { flipH: false, flipV: false })}
              className="mt-1 w-full h-7 rounded bg-white/[0.06] hover:bg-white/15 flex items-center justify-center gap-1 text-[11px] text-white/60">
              <RotateCcw size={12} />重置镜像
            </button>
          ) : null}
        </>
      )}

      {isVisual && (
        <>
          <SectionTitle>图层顺序</SectionTitle>
          <div className="flex items-center gap-1 py-1">
            <button type="button" title="上移一层" onClick={() => onUpdateClip(clip.id, { zIndex: (clip.zIndex ?? 0) + 1 })}
              className="h-7 flex-1 rounded bg-white/[0.06] hover:bg-white/15 flex items-center justify-center gap-1 text-[11px] text-white/60">
              ↑ 上移
            </button>
            <button type="button" title="下移一层" onClick={() => onUpdateClip(clip.id, { zIndex: (clip.zIndex ?? 0) - 1 })}
              className="h-7 flex-1 rounded bg-white/[0.06] hover:bg-white/15 flex items-center justify-center gap-1 text-[11px] text-white/60">
              ↓ 下移
            </button>
          </div>
          <div className="text-[10px] text-white/30 px-0.5">当前层级: {clip.zIndex ?? 0}</div>
        </>
      )}

      {isVisual && (
        <>
          <SectionTitle>滤镜</SectionTitle>
          <div className="grid grid-cols-4 gap-1 mb-2">
            {FILTER_PRESETS.map((fp) => (
              <button key={fp.id} type="button" onClick={() => onApplyFilterPreset(clip.id, fp.id)}
                className="h-7 rounded bg-white/[0.06] hover:bg-white/15 text-[10px] text-white/70 truncate px-1">
                {fp.name}
              </button>
            ))}
          </div>
          <SliderRow label="强度" value={Math.round(f.strength)} min={0} max={100} step={1} suffix="%" onChange={(v) => setF({ strength: v })} />
          <SliderRow label="亮度" value={Math.round(f.brightness)} min={0} max={200} step={1} suffix="%" onChange={(v) => setF({ brightness: v })} />
          <SliderRow label="对比度" value={Math.round(f.contrast)} min={0} max={200} step={1} suffix="%" onChange={(v) => setF({ contrast: v })} />
          <SliderRow label="饱和度" value={Math.round(f.saturate)} min={0} max={200} step={1} suffix="%" onChange={(v) => setF({ saturate: v })} />
          <SliderRow label="色温" value={Math.round(f.temperature)} min={-100} max={100} step={1} onChange={(v) => setF({ temperature: v })} />
          <SliderRow label="模糊" value={Math.round(f.blur * 10) / 10} min={0} max={20} step={0.5} suffix="px" onChange={(v) => setF({ blur: v })} />
          <SliderRow label="锐化" value={Math.round(f.sharpen)} min={0} max={100} step={1} suffix="%" onChange={(v) => setF({ sharpen: v })} />
          <SliderRow label="黑白" value={Math.round(f.grayscale)} min={0} max={100} step={1} suffix="%" onChange={(v) => setF({ grayscale: v })} />
          <SliderRow label="棕褐" value={Math.round(f.sepia)} min={0} max={100} step={1} suffix="%" onChange={(v) => setF({ sepia: v })} />
        </>
      )}

      {isVisual && clip.transition && (
        <>
          <SectionTitle>转场</SectionTitle>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-white/55">
              {TRANSITION_DEFS.find((d) => d.type === clip.transition!.type)?.name ?? clip.transition.type}
            </span>
            <button type="button" onClick={() => onRemoveTransition(clip.id)} title="移除转场"
              className="h-6 px-2 rounded bg-white/[0.06] hover:bg-[#f01b5c]/20 text-[10px] text-white/60 hover:text-[#f01b5c] flex items-center gap-1">
              <Trash2 size={10} />移除
            </button>
          </div>
          <SliderRow label="时长" value={Math.round(clip.transition.duration * 100) / 100} min={0.2} max={Math.min(3, clip.duration * 0.9)} step={0.1} suffix="s"
            onChange={(v) => onSetTransitionDuration(clip.id, v)} />
          <div className="text-[10px] text-white/25 px-0.5">在本片段开头与上一相邻片段叠化（更多类型见左栏「转场」）</div>
        </>
      )}

      {hasAudio && (
        <>
          <SectionTitle>音频</SectionTitle>
          <SliderRow label="音量" value={Math.round(p.volume * 100)} min={0} max={200} step={1} suffix="%" onChange={(v) => set({ volume: v / 100 })} />
          {asset.type === 'video' && (
            clip.sourceMuted ? (
              <div className="mt-1 text-[10px] text-white/30 px-0.5">音频已分离到音频轨</div>
            ) : (
              <button type="button" onClick={() => onDetachAudio(clip.id)} title="把视频自带声音拆成独立音频片段"
                className="mt-1 w-full h-7 rounded bg-white/[0.06] hover:bg-white/15 flex items-center justify-center gap-1.5 text-[11px] text-white/70">
                <AudioLines size={12} />分离音频
              </button>
            )
          )}
        </>
      )}

      <SectionTitle>淡入淡出</SectionTitle>
      <SliderRow label="淡入" value={Math.round(p.fadeIn * 10) / 10} min={0} max={Math.max(1, clip.duration)} step={0.1} suffix="s" onChange={(v) => set({ fadeIn: v })} />
      <SliderRow label="淡出" value={Math.round(p.fadeOut * 10) / 10} min={0} max={Math.max(1, clip.duration)} step={0.1} suffix="s" onChange={(v) => set({ fadeOut: v })} />

      {sourceDur != null && (
        <>
          <SectionTitle>裁剪</SectionTitle>
          <SliderRow label="入点" value={Math.round(clip.trimStart * 100) / 100} min={0} max={sourceDur} step={0.1} suffix="s" onChange={setTrimStart} />
          <SliderRow label="出点" value={Math.round(clip.trimEnd * 100) / 100} min={0} max={sourceDur} step={0.1} suffix="s" onChange={setTrimEnd} />
        </>
      )}

      <SectionTitle>预设</SectionTitle>
      <div className="flex gap-1 mb-1.5">
        <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="预设名称"
          className="flex-1 h-7 rounded bg-white/[0.06] text-[11px] text-white/80 px-2 border border-white/10 outline-none focus:border-[#f01b5c]/50" />
        <button type="button" title="保存当前属性为预设" onClick={() => { onSavePreset(presetName, clip.id); setPresetName(''); }}
          className="h-7 px-2 rounded bg-white/[0.06] hover:bg-white/15 flex items-center justify-center text-white/60">
          <Save size={12} />
        </button>
      </div>
      {presets.length === 0 ? (
        <div className="text-[10px] text-white/25 py-1">暂无预设</div>
      ) : (
        presets.map((pr) => (
          <div key={pr.id} className="flex items-center gap-1 mb-1">
            <button type="button" onClick={() => onApplyPreset(pr.id, clip.id)} title="应用预设"
              className="flex-1 h-7 rounded bg-white/[0.06] hover:bg-white/15 flex items-center gap-1.5 px-2 text-[11px] text-white/70 truncate">
              <Bookmark size={11} />{pr.name}
            </button>
            <button type="button" onClick={() => onDeletePreset(pr.id)} title="删除预设"
              className="h-7 w-7 rounded bg-white/[0.06] hover:bg-[#f01b5c]/20 flex items-center justify-center text-white/40 hover:text-[#f01b5c]">
              <Trash2 size={11} />
            </button>
          </div>
        ))
      )}

      <SectionTitle>信息</SectionTitle>
      <InfoRow label="类型" value={asset.type} />
      <InfoRow label="起点" value={formatTime(clip.start)} />
      <InfoRow label="时长" value={formatTime(clip.duration)} />
      {asset.width ? <InfoRow label="分辨率" value={`${asset.width}×${asset.height}`} /> : null}
      <InfoRow label="大小" value={formatBytes(asset.size)} />

      <button type="button" onClick={() => onRemoveClip(clip.id)}
        className="mt-4 w-full h-9 rounded-md bg-white/[0.06] hover:bg-[#f01b5c]/20 text-xs text-white/70 hover:text-[#f01b5c] transition-colors">
        从时间线移除
      </button>
    </div>
  );
}

function TextEditor({
  clip, playhead, onSetClipText, onSetClipProps, onUpdateClip, onRemoveClip, onToggleKeyframe,
}: {
  clip: TimelineClip;
  playhead: number;
  onSetClipText: (id: string, patch: Partial<TextClipData>) => void;
  onSetClipProps: (id: string, patch: Partial<ClipProps>) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onRemoveClip: (id: string) => void;
  onToggleKeyframe: (id: string, key: AnimatableKey) => void;
}) {
  const t = clip.text!;
  const localT = Math.max(0, Math.min(clip.duration, playhead - clip.start));
  const p = resolveClipPropsAt(clip, localT); // 使用播放头位置的属性值
  const setT = (patch: Partial<TextClipData>) => onSetClipText(clip.id, patch);
  const setP = (patch: Partial<ClipProps>) => onSetClipProps(clip.id, patch);
  const kfActive = (key: AnimatableKey) => hasKeyframes(clip, key);
  const toggleKf = (key: AnimatableKey) => onToggleKeyframe(clip.id, key);
  const BG_OPTIONS: { label: string; value: string }[] = [
    { label: '无', value: 'transparent' },
    { label: '半黑', value: 'rgba(0,0,0,0.5)' },
    { label: '黑', value: '#000000' },
    { label: '白', value: '#ffffff' },
  ];
  // 把背景色解析为 {hex, alpha} 供自定义编辑；再用 toRgba 组合回 CSS
  const parseBg = (bgStr: string): { hex: string; alpha: number } => {
    if (!bgStr || bgStr === 'transparent') return { hex: '#000000', alpha: 0 };
    const m = bgStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
    if (m) {
      const hex = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
      return { hex, alpha: m[4] !== undefined ? Number(m[4]) : 1 };
    }
    if (/^#[0-9a-fA-F]{6}$/.test(bgStr)) return { hex: bgStr, alpha: 1 };
    return { hex: '#000000', alpha: 1 };
  };
  const toRgba = (hex: string, alpha: number): string => {
    if (alpha <= 0) return 'transparent';
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
  };
  const bg = parseBg(t.bgColor);
  return (
    <div className="flex-1 overflow-y-auto p-3 text-white/85">
      <SectionTitle>文字内容</SectionTitle>
      <textarea
        value={t.content}
        onChange={(e) => setT({ content: e.target.value })}
        rows={3}
        placeholder="输入文字…"
        className="w-full rounded bg-white/[0.06] text-sm text-white/85 px-2 py-1.5 border border-white/10 outline-none focus:border-[#f01b5c]/50 resize-none"
      />

      <SectionTitle>样式</SectionTitle>
      <SliderRow label="字号" value={Math.round(t.fontSize * 10) / 10} min={2} max={30} step={0.5} suffix="%" onChange={(v) => setT({ fontSize: v })} />
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[11px] text-white/40 w-12">颜色</span>
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : '#ffffff'} onChange={(e) => setT({ color: e.target.value })} className="h-6 w-10 rounded bg-transparent border border-white/10 cursor-pointer" />
      </div>
      <div className="flex items-center gap-1 py-1.5">
        <span className="text-[11px] text-white/40 w-12">背景</span>
        {BG_OPTIONS.map((b) => (
          <button key={b.label} type="button" onClick={() => setT({ bgColor: b.value })}
            className={`h-6 px-2 rounded text-[10px] ${t.bgColor === b.value ? 'bg-[#f01b5c]/30 text-white' : 'bg-white/[0.06] text-white/60'}`}>
            {b.label}
          </button>
        ))}
        <input
          type="color"
          title="自定义背景色"
          value={bg.hex}
          onChange={(e) => setT({ bgColor: toRgba(e.target.value, bg.alpha > 0 ? bg.alpha : 1) })}
          className="h-6 w-8 rounded bg-transparent border border-white/10 cursor-pointer"
        />
      </div>
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[11px] text-white/40 w-12">背景透明</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(bg.alpha * 100)}
          onChange={(e) => setT({ bgColor: toRgba(bg.hex, Number(e.target.value) / 100) })}
          className="flex-1 accent-[#f01b5c]"
        />
        <span className="text-[11px] text-white/55 tabular-nums w-9 text-right">{Math.round(bg.alpha * 100)}%</span>
      </div>
      <div className="flex items-center gap-1 py-1.5">
        <span className="text-[11px] text-white/40 w-12">字形</span>
        <button type="button" onClick={() => setT({ fontWeight: t.fontWeight === 'bold' ? 'normal' : 'bold' })}
          className={`h-6 w-7 rounded text-xs font-bold ${t.fontWeight === 'bold' ? 'bg-[#f01b5c]/30 text-white' : 'bg-white/[0.06] text-white/60'}`}>B</button>
        <button type="button" onClick={() => setT({ fontStyle: t.fontStyle === 'italic' ? 'normal' : 'italic' })}
          className={`h-6 w-7 rounded text-xs italic ${t.fontStyle === 'italic' ? 'bg-[#f01b5c]/30 text-white' : 'bg-white/[0.06] text-white/60'}`}>I</button>
        <span className="w-2" />
        {(['left', 'center', 'right'] as const).map((al) => (
          <button key={al} type="button" onClick={() => setT({ align: al })}
            className={`h-6 px-2 rounded text-[10px] ${t.align === al ? 'bg-[#f01b5c]/30 text-white' : 'bg-white/[0.06] text-white/60'}`}>
            {al === 'left' ? '左' : al === 'center' ? '中' : '右'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[11px] text-white/40 w-12">字体</span>
        <select value={t.fontFamily} onChange={(e) => setT({ fontFamily: e.target.value })}
          className="flex-1 h-7 rounded bg-white/[0.06] text-xs text-white/80 px-1.5 border border-white/10 outline-none">
          {FONT_FAMILIES.map((ff) => <option key={ff.value} value={ff.value} className="bg-[#222]">{ff.label}</option>)}
        </select>
      </div>

      <SectionTitle>变换（◆ 可打关键帧）</SectionTitle>
      <SliderRow label="位置 X" value={Math.round(p.x * 10) / 10} min={-100} max={100} step={1} suffix="%" onChange={(v) => setP({ x: v })} kfKey="x" kfActive={kfActive('x')} onToggleKf={toggleKf} />
      <SliderRow label="位置 Y" value={Math.round(p.y * 10) / 10} min={-100} max={100} step={1} suffix="%" onChange={(v) => setP({ y: v })} kfKey="y" kfActive={kfActive('y')} onToggleKf={toggleKf} />
      <SliderRow label="缩放" value={Math.round(p.scale * 100)} min={10} max={400} step={1} suffix="%" onChange={(v) => setP({ scale: v / 100 })} kfKey="scale" kfActive={kfActive('scale')} onToggleKf={toggleKf} />
      <SliderRow label="旋转" value={Math.round(p.rotation)} min={-180} max={180} step={1} suffix="°" onChange={(v) => setP({ rotation: v })} kfKey="rotation" kfActive={kfActive('rotation')} onToggleKf={toggleKf} />
      <SliderRow label="不透明度" value={Math.round(p.opacity * 100)} min={0} max={100} step={1} suffix="%" onChange={(v) => setP({ opacity: v / 100 })} kfKey="opacity" kfActive={kfActive('opacity')} onToggleKf={toggleKf} />

      <SectionTitle>时长与动画</SectionTitle>
      <SliderRow label="显示时长" value={Math.round(clip.duration * 10) / 10} min={0.2} max={30} step={0.1} suffix="s" onChange={(v) => onUpdateClip(clip.id, { duration: v, trimStart: 0, trimEnd: v })} />
      <SliderRow label="淡入" value={Math.round(p.fadeIn * 10) / 10} min={0} max={Math.max(1, clip.duration)} step={0.1} suffix="s" onChange={(v) => setP({ fadeIn: v })} />
      <SliderRow label="淡出" value={Math.round(p.fadeOut * 10) / 10} min={0} max={Math.max(1, clip.duration)} step={0.1} suffix="s" onChange={(v) => setP({ fadeOut: v })} />

      <div className="flex items-center gap-2 py-1.5 mt-2">
        <span className="text-[11px] text-white/40 w-12">入场</span>
        <select value={t.entrance || 'fade'} onChange={(e) => setT({ entrance: e.target.value as any })}
          className="flex-1 h-7 rounded bg-white/[0.06] text-xs text-white/80 px-1.5 border border-white/10 outline-none">
          <option value="none" className="bg-[#222]">无动画</option>
          <option value="fade" className="bg-[#222]">淡入</option>
          <option value="slide-up" className="bg-[#222]">上滑入</option>
          <option value="slide-down" className="bg-[#222]">下滑入</option>
          <option value="slide-left" className="bg-[#222]">左滑入</option>
          <option value="slide-right" className="bg-[#222]">右滑入</option>
          <option value="zoom-in" className="bg-[#222]">放大入</option>
          <option value="zoom-out" className="bg-[#222]">缩小入</option>
          <option value="bounce" className="bg-[#222]">弹跳入</option>
        </select>
      </div>
      {t.entrance && t.entrance !== 'none' && (
        <SliderRow label="时长" value={Math.round((t.entranceDuration ?? 0.6) * 10) / 10} min={0.1} max={3} step={0.1} suffix="s" onChange={(v) => setT({ entranceDuration: v })} />
      )}
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[11px] text-white/40 w-12">出场</span>
        <select value={t.exit || 'fade'} onChange={(e) => setT({ exit: e.target.value as any })}
          className="flex-1 h-7 rounded bg-white/[0.06] text-xs text-white/80 px-1.5 border border-white/10 outline-none">
          <option value="none" className="bg-[#222]">无动画</option>
          <option value="fade" className="bg-[#222]">淡出</option>
          <option value="slide-up" className="bg-[#222]">上滑出</option>
          <option value="slide-down" className="bg-[#222]">下滑出</option>
          <option value="slide-left" className="bg-[#222]">左滑出</option>
          <option value="slide-right" className="bg-[#222]">右滑出</option>
          <option value="zoom-in" className="bg-[#222]">放大出</option>
          <option value="zoom-out" className="bg-[#222]">缩小出</option>
          <option value="bounce" className="bg-[#222]">弹跳出</option>
        </select>
      </div>
      {t.exit && t.exit !== 'none' && (
        <SliderRow label="时长" value={Math.round((t.exitDuration ?? 0.6) * 10) / 10} min={0.1} max={3} step={0.1} suffix="s" onChange={(v) => setT({ exitDuration: v })} />
      )}

      <button type="button" onClick={() => onRemoveClip(clip.id)}
        className="mt-4 w-full h-9 rounded-md bg-white/[0.06] hover:bg-[#f01b5c]/20 text-xs text-white/70 hover:text-[#f01b5c] transition-colors">
        从时间线移除
      </button>
    </div>
  );
}

function PropertyPanel({
  clip, asset, width, playhead, selectedCount, hasClipboard, presets,
  onSetClipProps, onApplyToSelected, onUpdateClip, onSetClipSpeed, onToggleKeyframe,
  onCopyProps, onPasteProps, onResetProps, onSavePreset, onApplyPreset, onDeletePreset, onDetachAudio,
  onSetClipFilters, onApplyFilterPreset, onSetTransitionDuration, onRemoveTransition, onSetClipText, onRemoveClip,
}: PropertyPanelProps) {
  return (
    <aside style={{ width }} className="shrink-0 flex flex-col bg-[#1b1b1b] border-l border-white/10">
      <div className="h-10 flex items-center px-4 text-sm font-semibold text-white/80 border-b border-white/10">
        属性
      </div>
      {clip && clip.text ? (
        <TextEditor
          clip={clip}
          playhead={playhead}
          onSetClipText={onSetClipText}
          onSetClipProps={onSetClipProps}
          onUpdateClip={onUpdateClip}
          onRemoveClip={onRemoveClip}
          onToggleKeyframe={onToggleKeyframe}
        />
      ) : !clip || !asset ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-white/30">
          选择时间线上的片段以编辑属性
        </div>
      ) : (
        <PropertyEditor
          clip={clip} asset={asset} playhead={playhead} selectedCount={selectedCount}
          hasClipboard={hasClipboard} presets={presets}
          onSetClipProps={onSetClipProps} onApplyToSelected={onApplyToSelected}
          onUpdateClip={onUpdateClip} onSetClipSpeed={onSetClipSpeed} onToggleKeyframe={onToggleKeyframe}
          onCopyProps={onCopyProps} onPasteProps={onPasteProps} onResetProps={onResetProps}
          onSavePreset={onSavePreset} onApplyPreset={onApplyPreset} onDeletePreset={onDeletePreset}
          onDetachAudio={onDetachAudio}
          onSetClipFilters={onSetClipFilters} onApplyFilterPreset={onApplyFilterPreset}
          onSetTransitionDuration={onSetTransitionDuration} onRemoveTransition={onRemoveTransition}
          onRemoveClip={onRemoveClip}
        />
      )}
    </aside>
  );
}

export default memo(PropertyPanel);


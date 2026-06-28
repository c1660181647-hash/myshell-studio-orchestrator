import { memo } from 'react';
import type { EditorAsset, TimelineClip, TransitionType } from '../types';
import { TRANSITION_DEFS } from '../types';

interface TransitionLibraryProps {
  selectedClip: TimelineClip | null;
  selectedAsset: EditorAsset | null;
  onSetTransition: (clipId: string, type: TransitionType) => void;
  onRemoveTransition: (clipId: string) => void;
}

// 各转场的微缩演示动画（CSS，hover 时播放），纯装饰
const DEMO_CLASS: Record<TransitionType, string> = {
  fade: 'tr-demo-fade',
  dissolve: 'tr-demo-fade',
  'wipe-left': 'tr-demo-wipe-l',
  'wipe-right': 'tr-demo-wipe-r',
  'wipe-up': 'tr-demo-wipe-u',
  'wipe-down': 'tr-demo-wipe-d',
  'slide-left': 'tr-demo-slide-l',
  'slide-right': 'tr-demo-slide-r',
  'zoom-in': 'tr-demo-zoom-in',
  'zoom-out': 'tr-demo-zoom-out',
};

function TransitionLibrary({ selectedClip, selectedAsset, onSetTransition, onRemoveTransition }: TransitionLibraryProps) {
  const isVisual = selectedAsset?.type === 'video' || selectedAsset?.type === 'image';
  const canApply = Boolean(selectedClip && isVisual);
  const current = selectedClip?.transition?.type ?? null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 text-[11px] text-white/40 border-b border-white/5">
        {canApply ? '点击套用到选中片段（在片段开头与上一段叠化）' : '选择视频/图片片段后套用转场'}
      </div>
      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2 auto-rows-min content-start">
        {/* 无转场 */}
        <button
          type="button"
          disabled={!canApply}
          onClick={() => selectedClip && onRemoveTransition(selectedClip.id)}
          className={`group relative rounded-md overflow-hidden border bg-[#252525] disabled:opacity-40 ${current === null ? 'border-[#f01b5c]' : 'border-white/10 hover:border-white/25'}`}
        >
          <div className="aspect-video flex items-center justify-center text-white/30 text-[11px]">无</div>
          <div className="px-1.5 py-1 text-[11px] text-white/80 text-center">无转场</div>
        </button>
        {TRANSITION_DEFS.map((def) => (
          <button
            key={def.type}
            type="button"
            disabled={!canApply}
            onClick={() => selectedClip && onSetTransition(selectedClip.id, def.type)}
            className={`group relative rounded-md overflow-hidden border bg-[#252525] disabled:opacity-40 ${current === def.type ? 'border-[#f01b5c]' : 'border-white/10 hover:border-[#f01b5c]'}`}
          >
            <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-[#3a4a6a] to-[#6a4a7a]">
              {/* 微缩演示：底层定格 + 上层按转场类型动画 */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#caa46a] to-[#b06a8a]" />
              <div className={`absolute inset-0 bg-gradient-to-br from-[#3a4a6a] to-[#6a4a7a] ${DEMO_CLASS[def.type]}`} />
            </div>
            <div className="px-1.5 py-1 text-[11px] text-white/80 text-center truncate">{def.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default memo(TransitionLibrary);

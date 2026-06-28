import { memo } from 'react';
import type { EditorAsset, TimelineClip } from '../types';
import { FILTER_PRESETS, DEFAULT_CLIP_FILTERS } from '../types';
import { filterCss, temperatureOverlay } from '../utils';

interface FilterLibraryProps {
  selectedClip: TimelineClip | null;
  selectedAsset: EditorAsset | null;
  onApplyFilterPreset: (clipId: string, presetId: string) => void;
}

function FilterLibrary({ selectedClip, selectedAsset, onApplyFilterPreset }: FilterLibraryProps) {
  const isVisual = selectedAsset?.type === 'video' || selectedAsset?.type === 'image';
  const canApply = Boolean(selectedClip && isVisual);
  const thumb = isVisual ? selectedAsset?.thumbnail : undefined;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 text-[11px] text-white/40 border-b border-white/5">
        {canApply ? '点击预设套用到选中片段' : '选择时间线上的视频/图片片段后套用滤镜'}
      </div>
      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2 auto-rows-min content-start">
        {FILTER_PRESETS.map((fp) => {
          const f = { ...DEFAULT_CLIP_FILTERS, ...fp.filters };
          const tempOv = temperatureOverlay(f);
          return (
            <button
              key={fp.id}
              type="button"
              disabled={!canApply}
              onClick={() => selectedClip && onApplyFilterPreset(selectedClip.id, fp.id)}
              className="group relative rounded-md overflow-hidden border border-white/10 hover:border-[#f01b5c] bg-[#252525] disabled:opacity-40 disabled:hover:border-white/10"
            >
              <div className="relative aspect-video flex items-center justify-center bg-gradient-to-br from-[#4a5a7a] via-[#7a6a8a] to-[#caa46a]" style={{ isolation: 'isolate' }}>
                {thumb ? (
                  <img src={thumb} alt="" draggable={false} style={{ filter: filterCss(f) }} className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0" style={{ filter: filterCss(f) }} />
                )}
                {tempOv && (
                  <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: tempOv.color, opacity: tempOv.opacity, mixBlendMode: 'soft-light' }} />
                )}
              </div>
              <div className="px-1.5 py-1 text-[11px] text-white/80 text-center truncate">{fp.name}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(FilterLibrary);

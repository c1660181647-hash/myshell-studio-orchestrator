import { memo, useRef, useState } from 'react';
import { Upload, Film, Music, Image as ImageIcon, Plus } from 'lucide-react';
import type { EditorAsset } from '../types';
import { formatTime, formatBytes } from '../utils';
import { ASSET_DND_MIME } from './TimelinePanel';

interface AssetPanelProps {
  assets: EditorAsset[];
  selectedAssetId: string | null;
  uploading: boolean;
  hydrating?: boolean;
  onUpload: (files: FileList) => void;
  onSelectAsset: (id: string) => void;
  onAddToTimeline: (id: string) => void;
}

const TYPE_ICON = { video: Film, audio: Music, image: ImageIcon } as const;

function AssetPanel({
  assets,
  selectedAssetId,
  uploading,
  hydrating,
  onUpload,
  onSelectAsset,
  onAddToTimeline,
}: AssetPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const handleAssetClick = (id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd 点击：切换多选
      setSelectedAssetIds((prev) =>
        prev.includes(id) ? prev.filter((aid) => aid !== id) : [...prev, id]
      );
    } else if (e.shiftKey && selectedAssetId) {
      // Shift 点击：范围多选
      const currentIdx = assets.findIndex((a) => a.id === selectedAssetId);
      const targetIdx = assets.findIndex((a) => a.id === id);
      if (currentIdx !== -1 && targetIdx !== -1) {
        const [start, end] = currentIdx < targetIdx ? [currentIdx, targetIdx] : [targetIdx, currentIdx];
        const rangeIds = assets.slice(start, end + 1).map((a) => a.id);
        setSelectedAssetIds(rangeIds);
      }
    } else {
      // 普通点击：单选
      setSelectedAssetIds([]);
      onSelectAsset(id);
    }
  };

  const handleAddSelectedToTimeline = () => {
    const idsToAdd = selectedAssetIds.length > 0 ? selectedAssetIds : selectedAssetId ? [selectedAssetId] : [];
    idsToAdd.forEach((id) => onAddToTimeline(id));
    setSelectedAssetIds([]);
  };

  // 框选功能
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // 只在空白区域或 grid 容器上触发框选
    const target = e.target as HTMLElement;
    if (!target.classList.contains('asset-grid-container') && !target.classList.contains('asset-grid')) {
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top + (containerRef.current?.scrollTop || 0);

    setSelecting(true);
    setSelectionBox({ x: startX, y: startY, w: 0, h: 0 });

    const handleMouseMove = (ev: MouseEvent) => {
      if (!rect || !containerRef.current) return;
      const currentX = ev.clientX - rect.left;
      const currentY = ev.clientY - rect.top + containerRef.current.scrollTop;

      const w = currentX - startX;
      const h = currentY - startY;

      const boxX = w < 0 ? currentX : startX;
      const boxY = h < 0 ? currentY : startY;
      const boxW = Math.abs(w);
      const boxH = Math.abs(h);

      setSelectionBox({ x: boxX, y: boxY, w: boxW, h: boxH });

      // 实时检测框选中的素材
      const gridElements = containerRef.current?.querySelectorAll('[data-asset-id]');
      const selected: string[] = [];
      gridElements?.forEach((el) => {
        const assetRect = el.getBoundingClientRect();
        const assetId = el.getAttribute('data-asset-id');
        if (!assetId) return;

        const scrollTop = containerRef.current?.scrollTop || 0;
        const elLeft = assetRect.left - rect.left;
        const elRight = elLeft + assetRect.width;
        const elTop = assetRect.top - rect.top + scrollTop;
        const elBottom = elTop + assetRect.height;

        const boxLeft = Math.min(startX, currentX);
        const boxRight = Math.max(startX, currentX);
        const boxTop = Math.min(startY, currentY);
        const boxBottom = Math.max(startY, currentY);

        if (boxLeft < elRight && boxRight > elLeft && boxTop < elBottom && boxBottom > elTop) {
          selected.push(assetId);
        }
      });
      setSelectedAssetIds(selected);
    };

    const handleMouseUp = () => {
      setSelecting(false);
      setSelectionBox(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-24 rounded-lg border-2 border-dashed border-white/15 hover:border-white/30 flex flex-col items-center justify-center gap-1.5 text-white/50 hover:text-white/70 transition-colors disabled:opacity-50"
        >
          <Upload size={20} />
          <span className="text-xs">{uploading ? '处理中…' : '上传视频 / 音频 / 图片'}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {selectedAssetIds.length > 0 && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-md bg-[#f01b5c]/10 border border-[#f01b5c]/30 flex items-center gap-2">
          <span className="text-xs text-white/70 flex-1">已选 {selectedAssetIds.length} 个素材</span>
          <button
            type="button"
            onClick={handleAddSelectedToTimeline}
            className="h-6 px-2 rounded bg-[#f01b5c] text-white text-xs hover:bg-[#f01b5c]/90"
          >
            添加到时间线
          </button>
          <button
            type="button"
            onClick={() => setSelectedAssetIds([])}
            className="h-6 px-2 rounded bg-white/10 text-white/70 text-xs hover:bg-white/20"
          >
            取消
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        className="asset-grid-container flex-1 overflow-y-auto px-3 pb-3 relative"
        style={{ userSelect: 'none' }}
      >
        <div className="asset-grid grid grid-cols-2 gap-2 auto-rows-min content-start" onMouseDown={handleMouseDown}>
          {hydrating && Array.from({ length: 4 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="rounded-md overflow-hidden border border-white/10 bg-[#252525]">
              <div className="aspect-video bg-white/5 animate-pulse" />
              <div className="px-1.5 py-1 space-y-1">
                <div className="h-2.5 w-3/4 rounded bg-white/5 animate-pulse" />
                <div className="h-2 w-1/2 rounded bg-white/5 animate-pulse" />
              </div>
            </div>
          ))}
          {!hydrating && assets.length === 0 && (
            <div className="col-span-2 flex flex-col items-center gap-2 text-center py-10">
              <Upload size={28} className="text-white/20" />
              <div className="text-xs text-white/40">还没有素材</div>
              <div className="text-[11px] text-white/25">点上方按钮上传，或从画布拖入</div>
            </div>
          )}
          {!hydrating && assets.map((asset) => {
            const Icon = TYPE_ICON[asset.type];
            const selected = asset.id === selectedAssetId;
            const inMultiSelection = selectedAssetIds.includes(asset.id);
            return (
              <div
                key={asset.id}
                data-asset-id={asset.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(ASSET_DND_MIME, asset.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onMouseDown={(e) => {
                  e.stopPropagation(); // 阻止冒泡到框选
                }}
                onClick={(e) => handleAssetClick(asset.id, e)}
                className={`group relative rounded-md overflow-hidden cursor-pointer border ${
                  inMultiSelection
                    ? 'border-[#f01b5c] ring-2 ring-[#f01b5c]/50'
                    : selected
                    ? 'border-[#f01b5c]'
                    : 'border-white/10 hover:border-white/25'
                } bg-[#252525]`}
              >
                <div className="aspect-video flex items-center justify-center bg-black/40">
                  {asset.thumbnail ? (
                    <img src={asset.thumbnail} alt={asset.name} draggable={false} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <Icon size={22} className="text-white/40" />
                  )}
                  {asset.duration ? (
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white/80">
                      {formatTime(asset.duration)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    title="添加到时间线"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToTimeline(asset.id);
                    }}
                    className="absolute top-1 right-1 h-6 w-6 rounded-full bg-[#f01b5c] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Plus size={14} />
                  </button>
                  {inMultiSelection && (
                    <div className="absolute top-1 left-1 h-5 w-5 rounded-full bg-[#f01b5c] text-white flex items-center justify-center text-[10px] font-bold">
                      ✓
                    </div>
                  )}
                </div>
                <div className="px-1.5 py-1">
                  <div className="truncate text-[11px] text-white/80">{asset.name}</div>
                  <div className="text-[10px] text-white/35">{formatBytes(asset.size)}</div>
                </div>
              </div>
            );
          })}
        </div>

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
  );
}

export default memo(AssetPanel);

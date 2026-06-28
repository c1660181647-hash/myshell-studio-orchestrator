import { memo } from 'react';
import { Type, Plus } from 'lucide-react';
import type { TextClipData } from '../types';
import { TEXT_STYLE_PRESETS, DEFAULT_TEXT_DATA } from '../types';

interface TextLibraryProps {
  onAddText: (preset?: Partial<TextClipData>) => void;
}

function TextLibrary({ onAddText }: TextLibraryProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={() => onAddText()}
          className="w-full h-11 rounded-lg bg-[#f01b5c]/90 hover:bg-[#f01b5c] flex items-center justify-center gap-2 text-sm font-medium text-white"
        >
          <Plus size={16} /> 添加文字
        </button>
        <div className="mt-1 text-[11px] text-white/35">在播放头位置创建文字片段</div>
      </div>

      <div className="px-3 pb-2 text-[11px] text-white/40">样式预设</div>
      <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-2">
        {TEXT_STYLE_PRESETS.map((preset) => {
          const d = { ...DEFAULT_TEXT_DATA, ...preset.data };
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onAddText(preset.data)}
              className="group relative h-14 rounded-md overflow-hidden border border-white/10 hover:border-[#f01b5c] bg-gradient-to-br from-[#3a4a6a] to-[#5a4a6a] flex items-center justify-center"
              title={`添加「${preset.name}」文字`}
            >
              <span
                className="px-2 py-0.5 rounded max-w-[88%] truncate"
                style={{
                  fontSize: 15,
                  color: d.color,
                  backgroundColor: d.bgColor,
                  fontWeight: d.fontWeight,
                  fontStyle: d.fontStyle,
                  fontFamily: d.fontFamily,
                  textShadow: d.bgColor === 'transparent' ? '0 1px 4px rgba(0,0,0,0.6)' : 'none',
                }}
              >
                {preset.name}
              </span>
              <span className="absolute top-1 left-1 text-white/40"><Type size={11} /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(TextLibrary);

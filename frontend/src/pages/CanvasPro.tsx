import { ArrowLeft, ExternalLink, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const CANVASPRO_ENTRY = '/ai-canvaspro/index.html';

export default function CanvasPro() {
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const src = useMemo(
    () => `${CANVASPRO_ENTRY}?embedded=studio&reload=${reloadKey}`,
    [reloadKey],
  );

  return (
    <main className="relative h-full w-full overflow-hidden bg-Cr-Bg-soft-v2">
      <iframe
        key={reloadKey}
        title="AI CanvasPro"
        src={src}
        className="h-full w-full border-0"
        allow="clipboard-read; clipboard-write; fullscreen; web-share"
      />
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-[130] flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/dreamy')}
          className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2/90 px-3 text-sm font-semibold text-Cr-text-default-v2 shadow-[0_10px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl active:bg-Cr-beta-white-8-v2"
          aria-label="Back to Studio"
          title="Back to Studio"
        >
          <ArrowLeft size={16} />
          <span>Studio</span>
        </button>
        <div className="pointer-events-auto flex items-center gap-2 rounded-full-v2 border border-Cr-border-default-v2 bg-Cr-Bg-surface-default-v2/90 p-1 shadow-[0_10px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-full-v2 text-Cr-text-default-v2 active:bg-Cr-beta-white-8-v2"
            aria-label="Reload AI CanvasPro"
            title="Reload AI CanvasPro"
          >
            <RotateCcw size={16} />
          </button>
          <a
            href={CANVASPRO_ENTRY}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-9 items-center justify-center rounded-full-v2 text-Cr-text-default-v2 active:bg-Cr-beta-white-8-v2"
            aria-label="Open AI CanvasPro in a new tab"
            title="Open AI CanvasPro in a new tab"
          >
            <ExternalLink size={16} />
          </a>
        </div>
      </div>
    </main>
  );
}

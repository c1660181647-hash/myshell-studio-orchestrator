import { useEffect, useMemo, useState } from 'react';
import { X, Download, Keyboard } from 'lucide-react';
import AssetPanel from '../features/editor/components/AssetPanel';
import FilterLibrary from '../features/editor/components/FilterLibrary';
import TransitionLibrary from '../features/editor/components/TransitionLibrary';
import TextLibrary from '../features/editor/components/TextLibrary';
import PreviewPanel from '../features/editor/components/PreviewPanel';
import TimelinePanel from '../features/editor/components/TimelinePanel';
import PropertyPanel from '../features/editor/components/PropertyPanel';
import ExportDialog from '../features/editor/export/ExportDialog';
import KeyboardHelp from '../features/editor/components/KeyboardHelp';
import EditorErrorBoundary from '../features/editor/components/EditorErrorBoundary';
import { useEditorStore, BASE_PPS } from '../features/editor/store';

export default function VideoEditor({ projectId, onBack }: { projectId?: string; onBack: () => void }) {
  const assets = useEditorStore((s) => s.assets);
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const uploading = useEditorStore((s) => s.uploading);
  const hydrating = useEditorStore((s) => s.hydrating);
  const pxPerSecond = useEditorStore((s) => s.pxPerSecond);
  const playhead = useEditorStore((s) => s.playhead);
  const playing = useEditorStore((s) => s.playing);
  const playbackRate = useEditorStore((s) => s.playbackRate);
  const playDirection = useEditorStore((s) => s.playDirection);
  const previewQuality = useEditorStore((s) => s.previewQuality);
  const loop = useEditorStore((s) => s.loop);
  const inPoint = useEditorStore((s) => s.inPoint);
  const outPoint = useEditorStore((s) => s.outPoint);
  const aspectRatio = useEditorStore((s) => s.aspectRatio);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const clipboard = useEditorStore((s) => s.clipboard);
  const presets = useEditorStore((s) => s.presets);
  const toolMode = useEditorStore((s) => s.toolMode);

  const hydrate = useEditorStore((s) => s.hydrate);
  const addAssets = useEditorStore((s) => s.addAssets);
  const addToTimeline = useEditorStore((s) => s.addToTimeline);
  const updateClip = useEditorStore((s) => s.updateClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const removeSelectedClip = useEditorStore((s) => s.removeSelectedClip);
  const selectAsset = useEditorStore((s) => s.selectAsset);
  const selectClip = useEditorStore((s) => s.selectClip);
  const setZoom = useEditorStore((s) => s.setZoom);
  const seek = useEditorStore((s) => s.seek);
  const togglePlay = useEditorStore((s) => s.togglePlay);
  const stop = useEditorStore((s) => s.stop);
  const pause = useEditorStore((s) => s.pause);
  const shuttle = useEditorStore((s) => s.shuttle);
  const setPreviewQuality = useEditorStore((s) => s.setPreviewQuality);
  const tick = useEditorStore((s) => s.tick);
  const setPlaybackRate = useEditorStore((s) => s.setPlaybackRate);
  const toggleLoop = useEditorStore((s) => s.toggleLoop);
  const stepFrame = useEditorStore((s) => s.stepFrame);
  const setInPoint = useEditorStore((s) => s.setInPoint);
  const setOutPoint = useEditorStore((s) => s.setOutPoint);
  const clearInOut = useEditorStore((s) => s.clearInOut);
  const setAspectRatio = useEditorStore((s) => s.setAspectRatio);
  const addClipToTrack = useEditorStore((s) => s.addClipToTrack);
  const addTrack = useEditorStore((s) => s.addTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const toggleTrackLocked = useEditorStore((s) => s.toggleTrackLocked);
  const toggleTrackMuted = useEditorStore((s) => s.toggleTrackMuted);
  const toggleTrackHidden = useEditorStore((s) => s.toggleTrackHidden);
  const setTrackHeight = useEditorStore((s) => s.setTrackHeight);
  const reorderTrack = useEditorStore((s) => s.reorderTrack);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const setClipProps = useEditorStore((s) => s.setClipProps);
  const copyClipProps = useEditorStore((s) => s.copyClipProps);
  const pasteClipProps = useEditorStore((s) => s.pasteClipProps);
  const resetClipProps = useEditorStore((s) => s.resetClipProps);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);
  const toggleClipSelection = useEditorStore((s) => s.toggleClipSelection);
  const applyPropsToSelected = useEditorStore((s) => s.applyPropsToSelected);
  const toggleKeyframe = useEditorStore((s) => s.toggleKeyframe);
  const savePreset = useEditorStore((s) => s.savePreset);
  const applyPreset = useEditorStore((s) => s.applyPreset);
  const deletePreset = useEditorStore((s) => s.deletePreset);
  const detachAudio = useEditorStore((s) => s.detachAudio);
  const setClipFilters = useEditorStore((s) => s.setClipFilters);
  const applyFilterPreset = useEditorStore((s) => s.applyFilterPreset);
  const setClipTransition = useEditorStore((s) => s.setClipTransition);
  const setTransitionDuration = useEditorStore((s) => s.setTransitionDuration);
  const removeTransition = useEditorStore((s) => s.removeTransition);
  const addTextClip = useEditorStore((s) => s.addTextClip);
  const setClipText = useEditorStore((s) => s.setClipText);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const splitClip = useEditorStore((s) => s.splitClip);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const saveNow = useEditorStore((s) => s.saveNow);
  const selectAllClips = useEditorStore((s) => s.selectAllClips);
  const beginDrag = useEditorStore((s) => s.beginDrag);
  const endDrag = useEditorStore((s) => s.endDrag);

  // 时间线整块高度（可拖分隔条调整）
  const [timelineHeight, setTimelineHeight] = useState(288);

  // 导出对话框
  const [showExportDialog, setShowExportDialog] = useState(false);
  // 快捷键帮助面板
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  // 左栏标签：素材 / 滤镜 / 转场 / 文字
  const [leftTab, setLeftTab] = useState<'assets' | 'filters' | 'transitions' | 'text'>('assets');
  // 播放预览实时帧率（性能监控）
  const [fps, setFps] = useState(0);
  const beginTimelineResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = timelineHeight;
    const onMove = (ev: PointerEvent) => {
      const next = startH - (ev.clientY - startY); // 向上拖增高
      setTimelineHeight(Math.min(window.innerHeight - 160, Math.max(140, next)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 左栏 / 右属性面板宽度（可拖竖直分隔条调整，会话内有效）
  const [leftWidth, setLeftWidth] = useState(288);
  const [rightWidth, setRightWidth] = useState(256);
  const beginLeftResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftWidth;
    const onMove = (ev: PointerEvent) => setLeftWidth(Math.min(560, Math.max(200, startW + (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const beginRightResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth;
    const onMove = (ev: PointerEvent) => setRightWidth(Math.min(560, Math.max(200, startW - (ev.clientX - startX)))); // 向左拖增宽
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 进入编辑器：按当前画布项目加载持久化数据（IndexedDB）
  useEffect(() => {
    console.log('[VideoEditor] hydrate with projectId:', projectId);
    void hydrate(projectId);
  }, [projectId, hydrate]);

  // 播放主时钟：rAF 驱动，仅在 playing 时运行；tick 到末尾会自动停止
  useEffect(() => {
    if (!playing) {
      setFps(0);
      return;
    }
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsWindowStart = last;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      tick(dt);
      // 每累计 ~0.5s 统计一次平均帧率
      frames += 1;
      const elapsed = now - fpsWindowStart;
      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        fpsWindowStart = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, tick]);

  // 键盘快捷键（输入控件聚焦时不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+Z: 撤销
      if (cmdOrCtrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Cmd/Ctrl+Shift+Z: 重做
      if (cmdOrCtrl && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }

      // Cmd/Ctrl+C: 复制片段属性
      if (cmdOrCtrl && e.key === 'c' && selectedClipId) {
        e.preventDefault();
        copyClipProps(selectedClipId);
        return;
      }

      // Cmd/Ctrl+V: 粘贴片段属性
      if (cmdOrCtrl && e.key === 'v' && selectedClipId && clipboard) {
        e.preventDefault();
        pasteClipProps(selectedClipId);
        return;
      }

      // Cmd/Ctrl+X: 剪切片段（复制属性后删除）
      if (cmdOrCtrl && e.key === 'x' && selectedClipId) {
        e.preventDefault();
        copyClipProps(selectedClipId);
        removeSelectedClip();
        return;
      }

      // Cmd/Ctrl+B: 在播放头位置切割选中片段
      if (cmdOrCtrl && e.key === 'b' && selectedClipId) {
        e.preventDefault();
        const clip = clips.find((c) => c.id === selectedClipId);
        if (clip && playhead > clip.start && playhead < clip.start + clip.duration) {
          splitClip(selectedClipId, playhead);
        }
        return;
      }

      // Cmd/Ctrl+A: 全选片段
      if (cmdOrCtrl && e.key === 'a') {
        e.preventDefault();
        selectAllClips();
        return;
      }

      // Cmd/Ctrl+S: 手动保存（立即落盘，不等 600ms 防抖）
      if (cmdOrCtrl && e.key === 's') {
        e.preventDefault();
        saveNow();
        return;
      }

      // Cmd/Ctrl+D: 取消全部选择
      if (cmdOrCtrl && e.key === 'd') {
        e.preventDefault();
        selectClip(null);
        return;
      }

      // Cmd/Ctrl+加号: 放大时间线
      if (cmdOrCtrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoom(Math.min(200, pxPerSecond * 1.2));
        return;
      }

      // Cmd/Ctrl+减号: 缩小时间线
      if (cmdOrCtrl && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        setZoom(Math.max(4, pxPerSecond / 1.2));
        return;
      }

      // Cmd/Ctrl+0: 重置缩放
      if (cmdOrCtrl && e.key === '0') {
        e.preventDefault();
        setZoom(BASE_PPS);
        return;
      }

      // Cmd/Ctrl+1/2/3: 预览画质 高清/标准/流畅
      if (cmdOrCtrl && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        setPreviewQuality(e.key === '1' ? 'full' : e.key === '2' ? 'standard' : 'draft');
        return;
      }

      // Cmd/Ctrl+E: 打开导出对话框
      if (cmdOrCtrl && e.key === 'e') {
        e.preventDefault();
        setShowExportDialog(true);
        return;
      }

      // ?: 打开快捷键帮助（? 需 Shift+/ 输入，故不能排除 shiftKey）
      if (e.key === '?' && !cmdOrCtrl) {
        e.preventDefault();
        setShowKeyboardHelp((v) => !v);
        return;
      }

      // Esc: 关闭快捷键帮助
      if (e.key === 'Escape' && showKeyboardHelp) {
        e.preventDefault();
        setShowKeyboardHelp(false);
        return;
      }

      // Home/End: 跳到时间线首/尾
      if (e.key === 'Home') {
        e.preventDefault();
        seek(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        seek(clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0));
        return;
      }

      // 单键快捷键：按住 Cmd/Ctrl 时一律不触发，避免与上面的组合键及浏览器快捷键（Ctrl+J/K/L 等）冲突
      if (cmdOrCtrl) return;
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          removeSelectedClip();
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepFrame(e.shiftKey ? -10 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepFrame(e.shiftKey ? 10 : 1);
          break;
        case 'i':
        case 'I':
          setInPoint();
          break;
        case 'o':
        case 'O':
          setOutPoint();
          break;
        case 'x':
        case 'X':
          clearInOut();
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          shuttle(-1); // 倒放，连按加速
          break;
        case 'k':
        case 'K':
          e.preventDefault();
          pause(); // 暂停
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          shuttle(1); // 正放，连按加速
          break;
        case 'c':
        case 'C':
          if (!cmdOrCtrl) {
            e.preventDefault();
            setToolMode('cut');
          }
          break;
        case 'v':
        case 'V':
          if (!cmdOrCtrl) {
            e.preventDefault();
            setToolMode('select');
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    removeSelectedClip, togglePlay, stepFrame, setInPoint, setOutPoint, clearInOut, setToolMode,
    undo, redo, selectedClipId, copyClipProps, pasteClipProps, clipboard, clips, playhead, splitClip,
    selectAllClips, saveNow, seek, selectClip, setZoom, pxPerSecond, setShowExportDialog, showKeyboardHelp,
    shuttle, pause, setPreviewQuality
  ]);

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );
  const selectedClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) ?? null,
    [clips, selectedClipId],
  );
  const selectedClipAsset = useMemo(
    () => (selectedClip ? assets.find((a) => a.id === selectedClip.assetId) ?? null : null),
    [assets, selectedClip],
  );
  // 时间线为空时的回退预览：跟随"最后点击的对象"
  const fallbackAsset = selectedClip ? selectedClipAsset : selectedAsset;

  return (
    <>
    <div className="absolute inset-0 z-10 flex flex-col bg-[#141414] text-white">
      <header className="h-12 shrink-0 flex items-center px-4 gap-4 bg-[#1f1f1f] border-b border-white/10">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white"
        >
          <X size={16} /> 关闭
        </button>
        <h1 className="flex-1 text-center text-sm font-semibold text-white/90">
          视频剪辑{hydrating ? ' · 加载中…' : ''}
        </h1>
        <button
          type="button"
          onClick={() => setShowKeyboardHelp(true)}
          title="键盘快捷键（?）"
          className="flex items-center justify-center h-8 w-8 rounded-md text-white/60 hover:text-white hover:bg-white/10"
        >
          <Keyboard size={16} />
        </button>
        <button
          type="button"
          onClick={() => setShowExportDialog(true)}
          title="导出视频"
          className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#f01b5c]/90 text-sm font-medium hover:bg-[#f01b5c]"
        >
          <Download size={15} /> 导出
        </button>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* 左栏：素材 / 滤镜 标签切换（后续转场/文字也按此模式加标签） */}
        <aside style={{ width: leftWidth }} className="shrink-0 flex flex-col bg-[#1b1b1b] border-r border-white/10">
          <div className="h-10 shrink-0 flex items-center px-2 gap-1 border-b border-white/10">
            <button
              type="button"
              onClick={() => setLeftTab('assets')}
              className={`h-7 px-3 rounded text-xs font-semibold ${leftTab === 'assets' ? 'bg-white/[0.1] text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              素材
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('filters')}
              className={`h-7 px-3 rounded text-xs font-semibold ${leftTab === 'filters' ? 'bg-white/[0.1] text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              滤镜
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('transitions')}
              className={`h-7 px-3 rounded text-xs font-semibold ${leftTab === 'transitions' ? 'bg-white/[0.1] text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              转场
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('text')}
              className={`h-7 px-3 rounded text-xs font-semibold ${leftTab === 'text' ? 'bg-white/[0.1] text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              文字
            </button>
          </div>
          <EditorErrorBoundary key={leftTab} label="左栏面板">
          {leftTab === 'assets' ? (
            <AssetPanel
              assets={assets}
              selectedAssetId={selectedAssetId}
              uploading={uploading}
              hydrating={hydrating}
              onUpload={addAssets}
              onSelectAsset={selectAsset}
              onAddToTimeline={addToTimeline}
            />
          ) : leftTab === 'filters' ? (
            <FilterLibrary
              selectedClip={selectedClip}
              selectedAsset={selectedClipAsset}
              onApplyFilterPreset={applyFilterPreset}
            />
          ) : leftTab === 'transitions' ? (
            <TransitionLibrary
              selectedClip={selectedClip}
              selectedAsset={selectedClipAsset}
              onSetTransition={setClipTransition}
              onRemoveTransition={removeTransition}
            />
          ) : (
            <TextLibrary onAddText={addTextClip} />
          )}
          </EditorErrorBoundary>
        </aside>
        {/* 左栏宽度分隔条（向右拖增宽） */}
        <div
          onPointerDown={beginLeftResize}
          style={{ touchAction: 'none' }}
          title="拖动调整左栏宽度"
          className="w-1.5 shrink-0 cursor-ew-resize bg-white/[0.04] hover:bg-[#f01b5c]/60"
        />
        <EditorErrorBoundary label="预览">
        <PreviewPanel
          clips={clips}
          assets={assets}
          tracks={tracks}
          playhead={playhead}
          playing={playing}
          playbackRate={playbackRate}
          playDirection={playDirection}
          loop={loop}
          fps={fps}
          aspectRatio={aspectRatio}
          previewQuality={previewQuality}
          fallbackAsset={fallbackAsset}
          selectedClipIds={selectedClipIds}
          onTogglePlay={togglePlay}
          onStop={stop}
          onSetPlaybackRate={setPlaybackRate}
          onSetPreviewQuality={setPreviewQuality}
          onToggleLoop={toggleLoop}
          onSetAspectRatio={setAspectRatio}
          onSetClipProps={setClipProps}
          onSetClipText={setClipText}
          onSelectClip={selectClip}
          onUpdateClip={updateClip}
        />
        </EditorErrorBoundary>
        {/* 右栏宽度分隔条（向左拖增宽） */}
        <div
          onPointerDown={beginRightResize}
          style={{ touchAction: 'none' }}
          title="拖动调整属性面板宽度"
          className="w-1.5 shrink-0 cursor-ew-resize bg-white/[0.04] hover:bg-[#f01b5c]/60"
        />
        <EditorErrorBoundary label="属性面板">
        <PropertyPanel
          width={rightWidth}
          clip={selectedClip}
          asset={selectedClipAsset}
          playhead={playhead}
          selectedCount={selectedClipIds.length}
          hasClipboard={clipboard !== null}
          presets={presets}
          onSetClipProps={setClipProps}
          onApplyToSelected={applyPropsToSelected}
          onUpdateClip={updateClip}
          onSetClipSpeed={setClipSpeed}
          onToggleKeyframe={toggleKeyframe}
          onCopyProps={copyClipProps}
          onPasteProps={pasteClipProps}
          onResetProps={resetClipProps}
          onSavePreset={savePreset}
          onApplyPreset={applyPreset}
          onDeletePreset={deletePreset}
          onDetachAudio={detachAudio}
          onSetClipFilters={setClipFilters}
          onApplyFilterPreset={applyFilterPreset}
          onSetTransitionDuration={setTransitionDuration}
          onRemoveTransition={removeTransition}
          onSetClipText={setClipText}
          onRemoveClip={removeClip}
        />
        </EditorErrorBoundary>
      </div>

      {/* 时间线高度分隔条（向上拖增高） */}
      <div
        onPointerDown={beginTimelineResize}
        style={{ touchAction: 'none' }}
        title="拖动调整时间线高度"
        className="h-1.5 shrink-0 cursor-ns-resize bg-white/[0.04] hover:bg-[#f01b5c]/60"
      />

      <EditorErrorBoundary label="时间线">
      <TimelinePanel
        tracks={tracks}
        clips={clips}
        assets={assets}
        selectedClipId={selectedClipId}
        selectedClipIds={selectedClipIds}
        pxPerSecond={pxPerSecond}
        playhead={playhead}
        inPoint={inPoint}
        outPoint={outPoint}
        basePps={BASE_PPS}
        toolMode={toolMode}
        onSelectClip={selectClip}
        onToggleClipSelection={toggleClipSelection}
        onUpdateClip={updateClip}
        onBeginDrag={beginDrag}
        onEndDrag={endDrag}
        onSeek={seek}
        onZoom={setZoom}
        onAddClipToTrack={addClipToTrack}
        onAddTrack={addTrack}
        onRemoveTrack={removeTrack}
        onToggleLocked={toggleTrackLocked}
        onToggleMuted={toggleTrackMuted}
        onToggleHidden={toggleTrackHidden}
        onSetTrackHeight={setTrackHeight}
        onReorderTrack={reorderTrack}
        snapEnabled={snapEnabled}
        onToggleSnap={toggleSnap}
        onSetToolMode={setToolMode}
        onSplitClip={splitClip}
        height={timelineHeight}
      />
      </EditorErrorBoundary>
    </div>

    {/* 导出对话框 */}
    {showExportDialog && <ExportDialog onClose={() => setShowExportDialog(false)} />}

    {/* 快捷键帮助面板 */}
    {showKeyboardHelp && <KeyboardHelp onClose={() => setShowKeyboardHelp(false)} />}
    </>
  );
}

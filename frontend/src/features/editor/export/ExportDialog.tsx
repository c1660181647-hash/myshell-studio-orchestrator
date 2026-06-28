// Phase 6: 导出对话框 UI（简单导出 + 完整导出，输出 WebM）
import { useState } from 'react';
import { useEditorStore } from '../store';
import { exportSimpleVideo, downloadBlob } from './simpleExport';
import { exportFullVideo, type ExportResolution, type ExportProgress } from './exportService';
import { X, Download, Loader2 } from 'lucide-react';

interface ExportDialogProps {
  onClose: () => void;
}

export default function ExportDialog({ onClose }: ExportDialogProps) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // 导出选项
  const [mode, setMode] = useState<'simple' | 'full'>('simple');
  const [resolution, setResolution] = useState<ExportResolution>('720p');
  const [fps, setFps] = useState<number>(24);
  const [includeAudio, setIncludeAudio] = useState(true);

  const clips = useEditorStore(s => s.clips);
  const assets = useEditorStore(s => s.assets);
  const tracks = useEditorStore(s => s.tracks);
  const aspectRatio = useEditorStore(s => s.aspectRatio);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setProgress(0);
    setPhase('');

    try {
      let blob: Blob;

      if (mode === 'simple') {
        // 简单导出（第一步）
        blob = await exportSimpleVideo(clips, assets, aspectRatio, (percent) => {
          setProgress(Math.round(percent * 100));
          setPhase('录制视频');
        });
      } else {
        // 完整导出（第二步）
        blob = await exportFullVideo(
          clips,
          assets,
          tracks,
          aspectRatio,
          { resolution, includeAudio, fps },
          (prog: ExportProgress) => {
            setProgress(Math.round(prog.percent));
            setPhase(prog.message);
          }
        );
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      // 根据 blob 类型决定扩展名
      const ext = blob.type.includes('mp4') || blob.type.includes('h264') ? 'mp4' : 'webm';
      const filename = `video_export_${timestamp}.${ext}`;

      downloadBlob(blob, filename);

      // 成功后关闭对话框
      setTimeout(() => {
        onClose();
      }, 500);

    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">导出视频</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>

        {/* 导出模式选择 */}
        {!exporting && (
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-gray-700">导出模式</label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 rounded border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="simple"
                  checked={mode === 'simple'}
                  onChange={(e) => setMode(e.target.value as 'simple')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">快速导出（测试版）</div>
                  <div className="text-xs text-gray-500">
                    仅导出视频片段，不包含滤镜/转场/文字/音频
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="full"
                  checked={mode === 'full'}
                  onChange={(e) => setMode(e.target.value as 'full')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">完整导出</div>
                  <div className="text-xs text-gray-500">
                    包含滤镜/文字/关键帧/变换/音频（转场暂不支持导出）
                  </div>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* 导出选项 */}
        {!exporting && mode === 'full' && (
          <div className="mb-4 space-y-3 rounded bg-gray-50 p-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">分辨率</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as ExportResolution)}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="720p" className="text-gray-900">720p (推荐)</option>
                <option value="1080p" className="text-gray-900">1080p (较慢)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">帧率 (FPS)</label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value={24} className="text-gray-900">24 fps (电影标准，推荐)</option>
                <option value={25} className="text-gray-900">25 fps (PAL 标准)</option>
                <option value={30} className="text-gray-900">30 fps (流畅，较慢)</option>
                <option value={60} className="text-gray-900">60 fps (高帧率，很慢)</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                帧率越高越流畅，但导出速度越慢
              </p>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
              />
              <span className="text-sm text-gray-700">包含音频</span>
            </label>
          </div>
        )}

        {/* 导出格式说明 */}
        {!exporting && (
          <div className="mb-4 rounded bg-blue-50 p-3 text-xs text-blue-700">
            <strong>导出格式：</strong> WebM
          </div>
        )}

        {/* 进度条 */}
        {exporting && (
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-gray-600">{phase || '导出中...'}</span>
              <span className="font-semibold text-blue-600">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-600">
            <strong>错误：</strong> {error}
          </div>
        )}

        {/* 按钮组 */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {exporting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                导出中
              </>
            ) : (
              <>
                <Download size={16} />
                开始导出
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Phase 6 Step 2: 导出协调服务
// 整合 Canvas 渲染器、视频编码器、音频混音器

import type { TimelineClip, EditorAsset, TimelineTrack } from '../types';
import { CanvasRenderer } from './canvasRenderer';
import { VideoEncoderWrapper, detectExportCapability } from './videoEncoder';
import { mixAudio, audioBufferToWav } from './audioMixer';
import { RealtimeAudioPlayer } from './realtimeAudioPlayer';

export type ExportResolution = '720p' | '1080p';

export interface ExportOptions {
  resolution: ExportResolution;
  includeAudio: boolean;
  fps: number;
}

/**
 * 导出进度回调
 */
export interface ExportProgress {
  phase: 'rendering' | 'encoding' | 'audio' | 'finalizing';
  percent: number;
  message: string;
}

/**
 * 完整视频导出（包含所有功能：滤镜/转场/文字/关键帧/音频）
 */
export async function exportFullVideo(
  clips: TimelineClip[],
  assets: EditorAsset[],
  tracks: TimelineTrack[],
  aspectRatio: string,
  options: ExportOptions,
  onProgress: (progress: ExportProgress) => void
): Promise<Blob> {
  // 1. 解析分辨率
  const [width, height] = getResolution(options.resolution, aspectRatio);
  const fps = options.fps; // 使用用户选择的帧率
  const duration = Math.max(...clips.map(c => c.start + c.duration), 0.1);
  const totalFrames = Math.ceil(duration * fps);

  onProgress({ phase: 'rendering', percent: 0, message: '初始化渲染器...' });

  // 2. 初始化渲染器
  const renderer = new CanvasRenderer(width, height);
  const canvas = renderer.getCanvas();

  // 3. 初始化音频播放器（如果需要）
  let audioPlayer: RealtimeAudioPlayer | null = null;
  let audioStream: MediaStream | undefined = undefined;

  if (options.includeAudio) {
    onProgress({ phase: 'rendering', percent: 0, message: '准备音频...' });
    audioPlayer = new RealtimeAudioPlayer();
    await audioPlayer.prepare(clips, assets);
    audioStream = audioPlayer.getStream();
  }

  // 4. 初始化编码器
  const capability = detectExportCapability();
  onProgress({
    phase: 'rendering',
    percent: 0,
    message: `使用 ${capability === 'webcodecs' ? 'WebCodecs' : 'MediaRecorder'} 编码...`
  });

  const encoder = new VideoEncoderWrapper(canvas, width, height, fps, audioStream);
  const assetsMap = new Map(assets.map(a => [a.id, a]));

  try {
    // 5. 逐帧渲染和编码
    if (encoder.getMode() === 'webcodecs') {
      // WebCodecs 模式：逐帧编码
      for (let i = 0; i < totalFrames; i++) {
        const t = i / fps;
        await renderer.renderFrame(clips, assetsMap, tracks, t);
        await encoder.encodeFrame();

        if (i % 10 === 0) {
          onProgress({
            phase: 'rendering',
            percent: (i / totalFrames) * 80,
            message: `渲染帧 ${i + 1}/${totalFrames}`
          });
        }
      }
    } else {
      // MediaRecorder 模式：手动控制录制（不依赖实时帧率）

      // 1. 先预渲染所有帧到临时 Canvas 数组
      onProgress({ phase: 'rendering', percent: 0, message: '预渲染帧...' });

      const tempCanvases: HTMLCanvasElement[] = [];
      for (let i = 0; i < totalFrames; i++) {
        const t = i / fps;
        await renderer.renderFrame(clips, assetsMap, tracks, t);

        // 复制当前帧到临时 Canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.drawImage(canvas, 0, 0);
        tempCanvases.push(tempCanvas);

        if (i % 10 === 0) {
          onProgress({
            phase: 'rendering',
            percent: (i / totalFrames) * 50,
            message: `预渲染 ${i + 1}/${totalFrames}`
          });
        }
      }

      // 2. 使用新的 Canvas 以稳定帧率播放
      onProgress({ phase: 'rendering', percent: 50, message: '开始录制...' });

      const playbackCanvas = document.createElement('canvas');
      playbackCanvas.width = canvas.width;
      playbackCanvas.height = canvas.height;
      const playbackCtx = playbackCanvas.getContext('2d')!;

      // 重新创建编码器（使用 playbackCanvas）
      const playbackEncoder = new VideoEncoderWrapper(playbackCanvas, width, height, fps, audioStream);
      playbackEncoder.start();

      // ⚠️ 关键：在开始回放前才启动音频，确保音画同步
      if (audioPlayer) {
        await audioPlayer.start();
      }

      // 3. 以稳定速率播放预渲染的帧
      const frameDuration = 1000 / fps;
      const startTime = performance.now();

      for (let i = 0; i < tempCanvases.length; i++) {
        // 绘制预渲染的帧
        playbackCtx.drawImage(tempCanvases[i], 0, 0);

        // 等待到下一帧时间
        const targetTime = startTime + (i + 1) * frameDuration;
        const now = performance.now();
        const waitTime = targetTime - now;

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        if (i % 10 === 0) {
          onProgress({
            phase: 'rendering',
            percent: 50 + (i / tempCanvases.length) * 45,
            message: `录制 ${i + 1}/${tempCanvases.length}`
          });
        }
      }

      // 等待录制完成
      await new Promise(resolve => setTimeout(resolve, 500));

      // 完成编码
      const videoBlob = await playbackEncoder.finalize();

      // 清理临时 Canvas
      tempCanvases.length = 0;

      onProgress({ phase: 'finalizing', percent: 100, message: '导出完成！' });
      return videoBlob;
    }

    // 6. 完成视频编码
    onProgress({ phase: 'encoding', percent: 95, message: '完成视频编码...' });
    const videoBlob = await encoder.finalize();

    // 音频已经包含在视频中了（MediaRecorder 模式）
    onProgress({ phase: 'finalizing', percent: 100, message: '导出完成！' });

    return videoBlob;

  } finally {
    // 7. 清理资源
    renderer.dispose();
    if (audioPlayer) {
      audioPlayer.dispose();
    }
  }
}

/**
 * 解析分辨率 "720p" -> [1280, 720]
 */
function getResolution(resolution: ExportResolution, aspectRatio: string): [number, number] {
  const [w, h] = parseAspectRatio(aspectRatio);
  const aspect = w / h;

  if (resolution === '720p') {
    const height = 720;
    const width = Math.round(height * aspect);
    return [width, height];
  } else {
    const height = 1080;
    const width = Math.round(height * aspect);
    return [width, height];
  }
}

/**
 * 解析画布比例 "16:9" -> [16, 9]
 */
function parseAspectRatio(ratio: string): [number, number] {
  const parts = ratio.split(':').map(Number);
  if (parts.length === 2 && parts.every(n => !isNaN(n) && n > 0)) {
    return [parts[0], parts[1]];
  }
  return [16, 9]; // 默认
}

// Phase 6 Step 1: 简单导出验证
// 用 MediaRecorder 录制单视频轨，验证技术可行性

import type { TimelineClip, EditorAsset } from '../types';

/**
 * 简化版导出：只支持单视频轨，无滤镜/转场/文字
 * 用于验证 MediaRecorder 可行性
 */
export async function exportSimpleVideo(
  clips: TimelineClip[],
  assets: EditorAsset[],
  aspectRatio: string,
  onProgress: (percent: number) => void
): Promise<Blob> {
  // 1. 过滤出视频片段（忽略文字、音频）
  const videoClips = clips
    .filter(c => !c.text && assets.find(a => a.id === c.assetId && a.type === 'video'))
    .sort((a, b) => a.start - b.start);

  if (videoClips.length === 0) {
    throw new Error('没有视频片段可导出');
  }

  // 2. 解析画布尺寸
  const [w, h] = parseAspectRatio(aspectRatio);

  // 3. 创建隐藏的 canvas 和 video 元素
  const canvas = document.createElement('canvas');
  canvas.width = 1280; // 默认 720p 宽度
  canvas.height = Math.round(canvas.width * h / w);
  canvas.style.display = 'none';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  const video = document.createElement('video');
  video.style.display = 'none';
  video.muted = true;
  video.playsInline = true;
  document.body.appendChild(video);

  // 4. 使用 MediaRecorder 录制 canvas
  const stream = canvas.captureStream(30);

  // 检测浏览器支持的编码格式
  const mimeType = getSupportedMimeType();
  if (!mimeType) {
    throw new Error('浏览器不支持视频录制（需要 MediaRecorder API）');
  }

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000 // 提高比特率到 8Mbps
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // 5. 开始录制
  recorder.start(1000); // 每秒收集一次数据（更稳定）

  try {
    let processedDuration = 0;
    const totalDuration = videoClips.reduce((sum, c) => sum + c.duration, 0);

    for (let i = 0; i < videoClips.length; i++) {
      const clip = videoClips[i];
      const asset = assets.find(a => a.id === clip.assetId)!;

      // 加载视频
      video.src = asset.url;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });

      // 跳到入点
      video.currentTime = clip.trimStart;
      await new Promise(resolve => {
        video.onseeked = resolve;
      });

      // 播放并录制片段
      const clipDuration = clip.duration;
      const startTime = performance.now();

      await video.play();

      // 录制循环：每帧绘制到 canvas
      await new Promise<void>((resolve) => {
        const renderFrame = () => {
          const elapsed = (performance.now() - startTime) / 1000;

          if (elapsed >= clipDuration || video.ended) {
            video.pause();
            resolve();
            return;
          }

          // 绘制当前帧到 canvas（居中 object-contain）
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const videoAspect = video.videoWidth / video.videoHeight;
          const canvasAspect = canvas.width / canvas.height;

          let drawW = canvas.width;
          let drawH = canvas.height;
          let drawX = 0;
          let drawY = 0;

          if (videoAspect > canvasAspect) {
            drawH = canvas.width / videoAspect;
            drawY = (canvas.height - drawH) / 2;
          } else {
            drawW = canvas.height * videoAspect;
            drawX = (canvas.width - drawW) / 2;
          }

          ctx.drawImage(video, drawX, drawY, drawW, drawH);

          requestAnimationFrame(renderFrame);
        };

        renderFrame();
      });

      processedDuration += clipDuration;
      onProgress(processedDuration / totalDuration);
    }

    // 6. 停止录制
    recorder.stop();

    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        canvas.remove();
        video.remove();

        if (chunks.length === 0) {
          reject(new Error('录制失败：未捕获到视频数据'));
          return;
        }

        resolve(new Blob(chunks, { type: mimeType }));
      };

      recorder.onerror = (e) => {
        canvas.remove();
        video.remove();
        reject(new Error(`录制错误: ${e}`));
      };
    });

  } catch (err) {
    canvas.remove();
    video.remove();
    throw err;
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

/**
 * 检测浏览器支持的 MIME 类型（优先级排序）
 * 优先 H.264（兼容性最好），其次 VP9/VP8
 */
function getSupportedMimeType(): string | null {
  const types = [
    'video/mp4;codecs=h264',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4'
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return null;
}

/**
 * 下载 Blob 为文件
 */
export function downloadBlob(blob: Blob, filename?: string) {
  // 根据 MIME 类型决定扩展名
  let ext = 'webm';
  if (blob.type.includes('mp4') || blob.type.includes('h264')) {
    ext = 'mp4';
  }

  const finalFilename = filename || `video_export_${Date.now()}.${ext}`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalFilename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

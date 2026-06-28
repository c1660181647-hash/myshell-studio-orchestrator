// 格式转换器：使用 ffmpeg.wasm 将 WebM 转换为 MP4

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoading = false;

/**
 * 获取或初始化 FFmpeg 实例（单例）
 */
async function getFFmpeg(onProgress?: (message: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) {
    return ffmpegInstance;
  }

  // 防止并发初始化
  if (ffmpegLoading) {
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (ffmpegInstance) {
          clearInterval(check);
          resolve(null);
        }
      }, 100);
    });
    return ffmpegInstance!;
  }

  ffmpegLoading = true;
  onProgress?.('正在加载 FFmpeg（首次使用需下载 ~31MB）...');

  try {
    const ffmpeg = new FFmpeg();

    // 监听加载进度
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    // 加载 FFmpeg
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });

    ffmpegInstance = ffmpeg;
    onProgress?.('FFmpeg 加载完成');
    return ffmpeg;
  } finally {
    ffmpegLoading = false;
  }
}

/**
 * 将 WebM 转换为 MP4
 */
export async function convertWebMToMP4(
  webmBlob: Blob,
  onProgress?: (message: string) => void
): Promise<Blob> {
  onProgress?.('准备转换格式...');

  const ffmpeg = await getFFmpeg(onProgress);

  try {
    // 1. 写入输入文件
    onProgress?.('写入临时文件...');
    const inputData = await fetchFile(webmBlob);
    await ffmpeg.writeFile('input.webm', inputData);

    // 2. 执行转换（使用快速预设，保持音频）
    onProgress?.('正在转换为 MP4...');
    await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264',          // H.264 视频编码
      '-preset', 'fast',          // 快速预设
      '-crf', '23',               // 质量（18=高质量，23=平衡，28=低质量）
      '-c:a', 'aac',              // AAC 音频编码
      '-b:a', '128k',             // 音频比特率
      '-movflags', '+faststart',  // 优化网络播放
      'output.mp4'
    ]);

    // 3. 读取输出文件
    onProgress?.('读取转换结果...');
    const outputData = await ffmpeg.readFile('output.mp4');

    // 4. 清理临时文件
    await ffmpeg.deleteFile('input.webm');
    await ffmpeg.deleteFile('output.mp4');

    onProgress?.('格式转换完成');

    // 5. 返回 Blob
    return new Blob([outputData], { type: 'video/mp4' });

  } catch (err) {
    console.error('FFmpeg conversion error:', err);
    throw new Error(`格式转换失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 检测是否支持格式转换
 */
export function supportsFormatConversion(): boolean {
  return typeof SharedArrayBuffer !== 'undefined';
}

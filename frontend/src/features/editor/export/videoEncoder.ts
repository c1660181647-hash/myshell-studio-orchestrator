// Phase 6 Step 2: 视频编码器
// 使用 MediaRecorder（兼容性好）或 WebCodecs（性能好）编码视频帧

/**
 * 检测浏览器支持的导出能力
 * 注意：WebCodecs 暂时禁用，因为需要 WebM Muxer 库才能正确打包
 */
export function detectExportCapability(): 'webcodecs' | 'mediarecorder' | 'none' {
  // 暂时强制使用 MediaRecorder（已验证可用）
  // if (typeof VideoEncoder !== 'undefined') {
  //   return 'webcodecs';
  // }
  if (typeof MediaRecorder !== 'undefined') {
    return 'mediarecorder';
  }
  return 'none';
}

/**
 * 基于 MediaRecorder 的视频编码器（全浏览器兼容）
 */
export class MediaRecorderEncoder {
  private stream: MediaStream;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];

  constructor(canvas: HTMLCanvasElement, fps: number = 30, audioStream?: MediaStream) {
    // 获取 Canvas 视频流
    const videoStream = canvas.captureStream(fps);

    // 如果有音频流，合并视频和音频轨道
    if (audioStream && audioStream.getAudioTracks().length > 0) {
      this.stream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioStream.getAudioTracks()
      ]);
    } else {
      this.stream = videoStream;
    }

    const mimeType = this.getSupportedMimeType();
    if (!mimeType) {
      throw new Error('浏览器不支持视频录制（MediaRecorder API）');
    }

    this.recorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 128_000
    });

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };
  }

  /**
   * 开始录制
   */
  start(): void {
    this.chunks = [];
    this.recorder.start(100); // 每 100ms 收集一次数据
  }

  /**
   * 停止录制并获取结果
   */
  async finalize(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.recorder.onstop = () => {
        if (this.chunks.length === 0) {
          reject(new Error('录制失败：未捕获到视频数据'));
          return;
        }
        const mimeType = this.recorder.mimeType;
        resolve(new Blob(this.chunks, { type: mimeType }));
      };

      this.recorder.onerror = (e) => {
        reject(new Error(`录制错误: ${e}`));
      };

      this.recorder.stop();
    });
  }

  /**
   * 获取支持的 MIME 类型
   */
  private getSupportedMimeType(): string | null {
    const types = [
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
}

/**
 * 基于 WebCodecs 的视频编码器（仅 Chrome/Edge，性能更好）
 */
export class WebCodecsEncoder {
  private encoder: VideoEncoder;
  private chunks: EncodedVideoChunk[] = [];
  private frameCount: number = 0;
  private fps: number;

  constructor(width: number, height: number, fps: number = 30) {
    this.fps = fps;

    this.encoder = new VideoEncoder({
      output: (chunk) => {
        this.chunks.push(chunk);
      },
      error: (e) => {
        console.error('WebCodecs encoding error:', e);
      }
    });

    this.encoder.configure({
      codec: 'vp09.00.10.08', // VP9 Profile 0
      width,
      height,
      bitrate: 5_000_000,
      framerate: fps,
      latencyMode: 'quality'
    });
  }

  /**
   * 编码单帧
   */
  async encodeFrame(canvas: HTMLCanvasElement): Promise<void> {
    // 从 Canvas 创建 VideoFrame
    const videoFrame = new VideoFrame(canvas, {
      timestamp: (this.frameCount * 1_000_000) / this.fps // 微秒
    });

    // 编码
    this.encoder.encode(videoFrame, { keyFrame: this.frameCount % 30 === 0 });

    // 清理
    videoFrame.close();
    this.frameCount++;
  }

  /**
   * 完成编码并获取结果
   */
  async finalize(): Promise<Blob> {
    await this.encoder.flush();

    // 将 chunks 打包成 WebM 容器
    // 注意：这里简化了，实际需要使用 WebM Muxer 库
    // 暂时返回原始数据
    const data = new Uint8Array(
      this.chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0)
    );

    let offset = 0;
    for (const chunk of this.chunks) {
      const arr = new Uint8Array(chunk.byteLength);
      chunk.copyTo(arr);
      data.set(arr, offset);
      offset += chunk.byteLength;
    }

    return new Blob([data], { type: 'video/webm' });
  }
}

/**
 * 统一的视频编码器接口
 */
export class VideoEncoderWrapper {
  private impl: MediaRecorderEncoder | WebCodecsEncoder;
  private mode: 'mediarecorder' | 'webcodecs';
  private canvas: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement, width: number, height: number, fps: number = 30, audioStream?: MediaStream) {
    const capability = detectExportCapability();

    if (capability === 'webcodecs') {
      this.mode = 'webcodecs';
      this.impl = new WebCodecsEncoder(width, height, fps);
      this.canvas = canvas;
    } else if (capability === 'mediarecorder') {
      this.mode = 'mediarecorder';
      this.impl = new MediaRecorderEncoder(canvas, fps, audioStream);
    } else {
      throw new Error('浏览器不支持视频编码（需要 WebCodecs 或 MediaRecorder API）');
    }
  }

  /**
   * 开始编码
   */
  start(): void {
    if (this.mode === 'mediarecorder') {
      (this.impl as MediaRecorderEncoder).start();
    }
  }

  /**
   * 编码单帧（仅 WebCodecs 模式）
   */
  async encodeFrame(): Promise<void> {
    if (this.mode === 'webcodecs' && this.canvas) {
      await (this.impl as WebCodecsEncoder).encodeFrame(this.canvas);
    }
  }

  /**
   * 完成编码
   */
  async finalize(): Promise<Blob> {
    return this.impl.finalize();
  }

  /**
   * 获取编码模式
   */
  getMode(): string {
    return this.mode;
  }
}

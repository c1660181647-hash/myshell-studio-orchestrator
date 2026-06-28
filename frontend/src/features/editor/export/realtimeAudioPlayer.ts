// 实时音频播放器 - 用于导出时同步播放音频（让 MediaRecorder 录制）

import type { TimelineClip, EditorAsset } from '../types';
import { clipSpeed, resolveClipPropsAt } from '../utils';
import { getAssetBlob } from '../storage';

/**
 * 实时音频播放器
 * 在渲染时同步播放音频，让 MediaRecorder 可以录制
 */
export class RealtimeAudioPlayer {
  private audioContext: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private clips: TimelineClip[] = [];
  private assets: EditorAsset[] = [];

  constructor() {
    this.audioContext = new AudioContext({ sampleRate: 48000 });
    this.destination = this.audioContext.createMediaStreamDestination();
  }

  /**
   * 准备音频（提前加载，但不调度播放）
   */
  async prepare(clips: TimelineClip[], assets: EditorAsset[]): Promise<void> {
    this.clips = clips;
    this.assets = assets;

    // 1. 收集所有音频片段
    const audioClips = clips.filter(c => {
      if (c.sourceMuted) return false;
      const asset = assets.find(a => a.id === c.assetId);
      return asset && (asset.type === 'audio' || asset.type === 'video');
    });

    // 2. 预加载音频数据（但不调度播放）
    for (const clip of audioClips) {
      try {
        const asset = assets.find(a => a.id === clip.assetId);
        if (!asset) continue;

        // 检查是否已加载
        if (this.audioBuffers.has(clip.assetId)) continue;

        const blob = await getAssetBlob(clip.assetId);
        if (!blob) continue;

        const arrayBuffer = await blob.arrayBuffer();
        const buffer = await this.audioContext.decodeAudioData(arrayBuffer);

        this.audioBuffers.set(clip.assetId, buffer);
      } catch (err) {
        console.warn(`Failed to load audio for clip ${clip.id}:`, err);
      }
    }
  }

  /**
   * 开始播放（真正调度音频）
   */
  async start(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // 现在才调度所有音频片段的播放
    const audioClips = this.clips.filter(c => {
      if (c.sourceMuted) return false;
      const asset = this.assets.find(a => a.id === c.assetId);
      return asset && (asset.type === 'audio' || asset.type === 'video');
    });

    // 记录开始时间
    const baseTime = this.audioContext.currentTime;

    for (const clip of audioClips) {
      try {
        const buffer = this.audioBuffers.get(clip.assetId);
        if (!buffer) continue;

        // 创建音频源
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        // 设置播放速度
        const speed = clipSpeed(clip);
        source.playbackRate.value = speed;

        // 创建增益节点（音量控制）
        const gainNode = this.audioContext.createGain();
        const props = resolveClipPropsAt(clip, 0);
        gainNode.gain.value = props.volume;

        // 应用淡入淡出
        this.applyFade(gainNode.gain, clip, props, baseTime);

        // 连接音频图
        source.connect(gainNode).connect(this.destination);

        // 调度播放（相对于 baseTime）
        const startTime = baseTime + clip.start;
        const offset = clip.trimStart;
        source.start(startTime, offset);
        source.stop(startTime + clip.duration);

        this.scheduledSources.push(source);
      } catch (err) {
        console.warn(`Failed to schedule audio clip ${clip.id}:`, err);
      }
    }
  }

  /**
   * 获取音频流（供 MediaRecorder 使用）
   */
  getStream(): MediaStream {
    return this.destination.stream;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.scheduledSources.forEach(s => {
      try {
        s.stop();
        s.disconnect();
      } catch (e) {
        // 已经停止
      }
    });
    this.scheduledSources = [];
    this.audioContext.close();
  }

  /**
   * 应用淡入淡出
   */
  private applyFade(
    gainParam: AudioParam,
    clip: TimelineClip,
    props: { volume: number; fadeIn: number; fadeOut: number },
    baseTime: number
  ): void {
    const startTime = baseTime + clip.start;
    const duration = clip.duration;
    const volume = props.volume;

    // 淡入
    if (props.fadeIn > 0) {
      gainParam.setValueAtTime(0, startTime);
      gainParam.linearRampToValueAtTime(volume, startTime + props.fadeIn);
    } else {
      gainParam.setValueAtTime(volume, startTime);
    }

    // 淡出
    if (props.fadeOut > 0) {
      const fadeOutStart = startTime + duration - props.fadeOut;
      gainParam.setValueAtTime(volume, fadeOutStart);
      gainParam.linearRampToValueAtTime(0, startTime + duration);
    }
  }
}

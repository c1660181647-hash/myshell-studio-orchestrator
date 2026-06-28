// Phase 6 Step 3: 音频混音器
// 使用 Web Audio API 离线混音多轨音频

import type { TimelineClip, EditorAsset } from '../types';
import { clipSpeed, resolveClipPropsAt } from '../utils';
import { getAssetBlob } from '../storage';

/**
 * 音频混音器：使用 Web Audio API 离线渲染多轨音频
 */
export async function mixAudio(
  clips: TimelineClip[],
  assets: EditorAsset[],
  duration: number,
  onProgress?: (percent: number) => void
): Promise<AudioBuffer | null> {
  // 1. 收集所有音频源（音频片段 + 视频片段的音轨）
  const audioClips = clips.filter(c => {
    if (c.sourceMuted) return false; // 视频音轨已静音
    const asset = assets.find(a => a.id === c.assetId);
    return asset && (asset.type === 'audio' || asset.type === 'video');
  });

  if (audioClips.length === 0) {
    return null; // 无音频
  }

  // 2. 创建离线音频上下文
  const sampleRate = 48000;
  const audioCtx = new OfflineAudioContext(2, duration * sampleRate, sampleRate);

  // 3. 为每个片段创建音频图
  let processed = 0;
  for (const clip of audioClips) {
    try {
      await addAudioClip(audioCtx, clip, assets);
    } catch (err) {
      console.warn(`Failed to add audio clip ${clip.id}:`, err);
    }

    processed++;
    if (onProgress) {
      onProgress(processed / audioClips.length);
    }
  }

  // 4. 离线渲染
  return await audioCtx.startRendering();
}

/**
 * 添加单个音频片段到音频上下文
 */
async function addAudioClip(
  audioCtx: OfflineAudioContext,
  clip: TimelineClip,
  assets: EditorAsset[]
): Promise<void> {
  const asset = assets.find(a => a.id === clip.assetId);
  if (!asset) return;

  // 1. 获取音频数据
  const blob = await getAssetBlob(clip.assetId);
  if (!blob) return;

  const arrayBuffer = await blob.arrayBuffer();
  const buffer = await audioCtx.decodeAudioData(arrayBuffer);

  // 2. 创建音频源
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  // 3. 设置播放速度
  const speed = clipSpeed(clip);
  source.playbackRate.value = speed;

  // 4. 创建增益节点（音量控制）
  const gainNode = audioCtx.createGain();
  const props = resolveClipPropsAt(clip, 0); // 简化：使用起始属性
  gainNode.gain.value = props.volume;

  // 5. 应用淡入淡出
  applyFade(gainNode.gain, clip, props);

  // 6. 连接音频图
  source.connect(gainNode).connect(audioCtx.destination);

  // 7. 调度播放
  const startTime = clip.start;
  const offset = clip.trimStart;
  const clipDuration = clip.duration;

  source.start(startTime, offset);
  source.stop(startTime + clipDuration);
}

/**
 * 应用淡入淡出到增益参数
 */
function applyFade(
  gainParam: AudioParam,
  clip: TimelineClip,
  props: { volume: number; fadeIn: number; fadeOut: number }
): void {
  const startTime = clip.start;
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

/**
 * 将 AudioBuffer 转换为 WAV Blob
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const length = buffer.length * buffer.numberOfChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  // WAV 头部
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, buffer.numberOfChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * buffer.numberOfChannels * 2, true); // byte rate
  view.setUint16(32, buffer.numberOfChannels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, length, true);

  // 写入音频数据
  const channels = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

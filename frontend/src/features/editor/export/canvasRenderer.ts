// Phase 6 Step 2: Canvas 渲染器
// 逐帧渲染时间线到 OffscreenCanvas，复用 PreviewPanel 的所有计算逻辑

import type { TimelineClip, EditorAsset, TimelineTrack, ClipFilters, TextClipData, TransitionType } from '../types';
import {
  resolveClipPropsAt,
  clipFilters,
  clipCrop,
  filterCss,
  transitionNeedsUnderlay,
  textAnimationStyle,
  textExitAnimationStyle,
  clipSpeed,
  temperatureOverlay,
} from '../utils';

// 转场在导出端的数值修饰（对应 utils.transitionStyles 的 CSS 输出，转成 Canvas 可用的数值）
interface TransitionMods {
  alpha?: number;            // 整体透明度（fade/dissolve/zoom）
  scale?: number;            // 额外缩放（zoom，绕媒体中心）
  translateXFrac?: number;   // 横向位移（slide，单位=媒体显示宽度的倍数）
  translateYFrac?: number;
  inset?: { t: number; r: number; b: number; l: number }; // 揭开裁剪（wipe，各边裁掉的比例）
}

/**
 * Canvas 渲染器：逐帧渲染时间线
 * 复用 PreviewPanel 的计算逻辑，将 DOM 渲染转换为 Canvas 绘制
 */
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private videoCache: Map<string, HTMLVideoElement> = new Map();
  private imageCache: Map<string, HTMLImageElement> = new Map();

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
  }

  /**
   * 渲染单帧
   */
  async renderFrame(
    clips: TimelineClip[],
    assets: Map<string, EditorAsset>,
    tracks: TimelineTrack[],
    playhead: number
  ): Promise<void> {
    // 重置所有可能被上一帧残留的上下文状态，确保每帧从干净的画布开始。
    // 关键 bug 根因：renderTransition 会改 globalAlpha 且不在 save/restore 内，若不重置，
    // 下一帧的清屏 fillRect 会以 <1 透明度绘制 → 上一帧擦不掉 → 旋转/运动文字叠成"一堆/重影"。
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.filter = 'none';
    this.ctx.shadowColor = 'rgba(0,0,0,0)';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 0;

    // 清空画布（不透明黑底，强制触发新帧）
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. 获取当前时刻的可见片段（复用 PreviewPanel 的逻辑）
    const activeClips = this.getActiveClips(clips, tracks, playhead);

    // 2. 按轨道顺序渲染每个片段
    for (const clip of activeClips) {
      if (clip.text) {
        await this.renderText(clip, playhead);
      } else {
        const asset = assets.get(clip.assetId);
        if (asset) {
          await this.renderMedia(clip, asset, playhead, clips, assets);
        }
      }
    }

    // 强制触发 Canvas 更新（确保 captureStream 捕获新帧）
    // 通过读取一个像素来强制渲染完成
    this.ctx.getImageData(0, 0, 1, 1);
  }

  /**
   * 获取当前帧的可见片段（按 zIndex 和轨道顺序排序）
   */
  private getActiveClips(
    clips: TimelineClip[],
    tracks: TimelineTrack[],
    playhead: number
  ): TimelineClip[] {
    // 获取所有在当前时刻活跃的片段
    const active = clips.filter(c => {
      const track = tracks.find(t => t.id === c.trackId);
      if (!track || track.hidden) return false;
      return playhead >= c.start && playhead < c.start + c.duration;
    });

    // 按轨道顺序和 zIndex 排序（下层在前，上层在后）
    const trackOrder = new Map(tracks.map((t, i) => [t.id, i]));
    active.sort((a, b) => {
      const aOrder = trackOrder.get(a.trackId) ?? 999;
      const bOrder = trackOrder.get(b.trackId) ?? 999;
      if (aOrder !== bOrder) return bOrder - aOrder; // 轨道顺序：数值大的在上（视频1在最上）
      return (a.zIndex ?? 0) - (b.zIndex ?? 0); // 同轨道内：zIndex 小的在下
    });

    return active;
  }

  /**
   * 渲染媒体片段（视频/图片）。若片段带转场，先画上一相邻片段的定格末帧作垫底，
   * 再带转场修饰画当前片段（与预览 FrozenLayer + transitionStyles 一致）。
   */
  private async renderMedia(
    clip: TimelineClip,
    asset: EditorAsset,
    playhead: number,
    allClips: TimelineClip[],
    assets: Map<string, EditorAsset>
  ): Promise<void> {
    const localT = playhead - clip.start;
    const tr = clip.transition;
    const inTr = tr ? localT >= 0 && localT < tr.duration : false;

    // 转场垫底：fade 之外的转场需要把"上一相邻片段"定格在末帧画在底层做叠化
    if (inTr && tr && transitionNeedsUnderlay(tr.type)) {
      const prev = this.prevAdjacentClip(clip, allClips);
      const prevAsset = prev ? assets.get(prev.assetId) : null;
      if (prev && prevAsset) {
        // 定格在 prev 末帧前一点（避开 EOF 黑帧，与预览 FrozenLayer 的 -0.04 一致）
        const prevEndLocal = Math.max(0, prev.duration - 0.04);
        await this.drawMediaFrame(prev, prevAsset, prevEndLocal);
      }
    }

    // 当前片段（转场期内带修饰）
    const mods = inTr && tr ? this.transitionMods(tr.type, localT / tr.duration) : undefined;
    await this.drawMediaFrame(clip, asset, localT, mods);
  }

  /**
   * 绘制单个媒体片段的某一帧到 canvas（含变换/裁剪/滤镜/色温/淡入淡出）。
   * 可选 mods 施加转场修饰（透明度/缩放/位移/揭开裁剪），全部在 save/restore 内，
   * 不泄漏任何 ctx 状态（这是"重影 bug"的根因，务必保持）。
   */
  private async drawMediaFrame(
    clip: TimelineClip,
    asset: EditorAsset,
    localT: number,
    mods?: TransitionMods
  ): Promise<void> {
    const props = resolveClipPropsAt(clip, localT);
    const fade = this.calculateFade(props, localT, clip.duration);
    const trAlpha = mods?.alpha ?? 1;

    const speed = clipSpeed(clip);
    const sourceTime = clip.trimStart + localT * speed;
    const mediaEl = await this.getMediaElement(asset, sourceTime);
    if (!mediaEl) return;

    const crop = clipCrop(clip);
    const filters = clipFilters(clip);

    this.ctx.save();

    // 透明度：片段 opacity × 淡入淡出 × 转场 alpha
    this.ctx.globalAlpha = props.opacity * fade * trAlpha;

    const frameW = this.canvas.width;
    const frameH = this.canvas.height;
    const centerX = frameW / 2;
    const centerY = frameH / 2;
    const offsetX = (props.x / 100) * frameW;
    const offsetY = (props.y / 100) * frameH;

    // 变换（位置/旋转/缩放/镜像）
    this.ctx.translate(centerX + offsetX, centerY + offsetY);
    this.ctx.rotate((props.rotation * Math.PI) / 180);
    this.ctx.scale(props.scale * (clip.flipH ? -1 : 1), props.scale * (clip.flipV ? -1 : 1));

    // 转场缩放（zoom，绕媒体中心=当前原点）
    if (mods?.scale != null) this.ctx.scale(mods.scale, mods.scale);

    this.ctx.filter = this.convertFiltersToCanvas(filters);

    // object-contain 显示尺寸
    const mediaW = asset.width || 1920;
    const mediaH = asset.height || 1080;
    const mediaAspect = mediaW / mediaH;
    const frameAspect = frameW / frameH;
    let fitW = frameW;
    let fitH = frameH;
    if (mediaAspect > frameAspect) {
      fitH = frameW / mediaAspect;
    } else {
      fitW = frameH * mediaAspect;
    }

    // 裁剪
    const cropL = crop.left * fitW;
    const cropR = crop.right * fitW;
    const cropT = crop.top * fitH;
    const cropB = crop.bottom * fitH;
    const visibleW = fitW - cropL - cropR;
    const visibleH = fitH - cropT - cropB;
    const drawX = -visibleW / 2;
    const drawY = -visibleH / 2;

    // 转场位移（slide，单位=显示尺寸的倍数）
    if (mods?.translateXFrac) this.ctx.translate(mods.translateXFrac * visibleW, 0);
    if (mods?.translateYFrac) this.ctx.translate(0, mods.translateYFrac * visibleH);

    // 转场揭开裁剪（wipe）：裁到揭开的矩形区域
    if (mods?.inset) {
      const { t, r, b, l } = mods.inset;
      this.ctx.beginPath();
      this.ctx.rect(drawX + l * visibleW, drawY + t * visibleH, visibleW * (1 - l - r), visibleH * (1 - t - b));
      this.ctx.clip();
    }

    const srcX = (cropL / fitW) * mediaW;
    const srcY = (cropT / fitH) * mediaH;
    const srcW = (visibleW / fitW) * mediaW;
    const srcH = (visibleH / fitH) * mediaH;
    this.ctx.drawImage(mediaEl, srcX, srcY, srcW, srcH, drawX, drawY, visibleW, visibleH);

    // 色温叠加（用 globalCompositeOperation 模拟 soft-light）
    const tempOverlay = temperatureOverlay(filters);
    if (tempOverlay) {
      this.ctx.globalCompositeOperation = 'soft-light';
      this.ctx.fillStyle = tempOverlay.color;
      this.ctx.globalAlpha = tempOverlay.opacity * props.opacity * fade * trAlpha;
      this.ctx.fillRect(drawX, drawY, visibleW, visibleH);
      this.ctx.globalCompositeOperation = 'source-over';
    }

    this.ctx.restore();
  }

  /**
   * 渲染文字片段
   */
  private async renderText(clip: TimelineClip, playhead: number): Promise<void> {
    const localT = playhead - clip.start;
    const txt = clip.text!;
    const props = resolveClipPropsAt(clip, localT);

    // 1. 计算入场/出场动画
    const entranceDur = txt.entranceDuration ?? 0.6;
    const exitDur = txt.exitDuration ?? 0.6;
    let animOpacity = 1;
    let animTransform = 'none';

    if (localT < entranceDur) {
      // 入场动画
      const p = localT / entranceDur;
      const anim = textAnimationStyle(txt.entrance, p);
      animOpacity = anim.opacity;
      animTransform = anim.transform;
    } else if (localT > clip.duration - exitDur) {
      // 出场动画
      const p = (localT - (clip.duration - exitDur)) / exitDur;
      const anim = textExitAnimationStyle(txt.exit, p);
      animOpacity = anim.opacity;
      animTransform = anim.transform;
    }

    this.ctx.save();

    // 2. 全局透明度
    this.ctx.globalAlpha = props.opacity * animOpacity;

    // 3. 计算位置和变换
    const frameW = this.canvas.width;
    const frameH = this.canvas.height;
    const centerX = frameW / 2;
    const centerY = frameH / 2;
    const offsetX = (props.x / 100) * frameW;
    const offsetY = (props.y / 100) * frameH;

    this.ctx.translate(centerX + offsetX, centerY + offsetY);
    this.ctx.rotate((props.rotation * Math.PI) / 180);
    this.ctx.scale(props.scale, props.scale);

    // 4. 解析文字动画的 transform（简单支持 translateY/scale）
    this.applyTextAnimationTransform(animTransform);

    // 5. 绘制文字
    const fontSize = (txt.fontSize / 100) * frameH;
    const fontWeight = txt.fontWeight === 'bold' ? 'bold' : 'normal';
    const fontStyle = txt.fontStyle === 'italic' ? 'italic' : 'normal';
    this.ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${txt.fontFamily}`;
    this.ctx.textAlign = txt.align as CanvasTextAlign;
    this.ctx.textBaseline = 'middle';

    // 自动折行：与预览一致，按画面宽度 90% 折行（预览也用 frame.w*0.9，两边折行点一致）
    const wrapWidth = frameW * 0.9;
    const lines = this.wrapText(txt.content, wrapWidth);
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const startY = -totalHeight / 2 + lineHeight / 2;
    const maxWidth = Math.max(0, ...lines.map((l) => this.ctx.measureText(l).width));

    // 背景框左边缘：与文字实际水平范围对齐（文字在 x=0 按 textAlign 绘制）
    // center→居中于0；left→左边缘在0；right→右边缘在0
    const bgLeftEdge = txt.align === 'left' ? 0 : txt.align === 'right' ? -maxWidth : -maxWidth / 2;
    // 内边距按字号比例，近似预览 px-2/py-1 的观感（预览固定像素，导出全分辨率，故用比例匹配）
    const padX = fontSize * 0.2;
    const padY = fontSize * 0.1;

    // 6. 绘制背景（圆角，对齐文字，与预览 rounded 一致）
    const hasBg = txt.bgColor !== 'transparent';
    if (hasBg) {
      this.ctx.fillStyle = txt.bgColor;
      const bx = bgLeftEdge - padX;
      const by = startY - lineHeight / 2 - padY;
      const bw = maxWidth + padX * 2;
      const bh = totalHeight + padY * 2;
      const r = Math.min(padY * 1.5, bh / 2, bw / 2);
      this.ctx.beginPath();
      if (typeof this.ctx.roundRect === 'function') {
        this.ctx.roundRect(bx, by, bw, bh, r);
      } else {
        this.ctx.rect(bx, by, bw, bh);
      }
      this.ctx.fill();
    }

    // 7. 绘制文字内容
    // 透明背景时加柔和阴影提升可读性（对齐预览的 textShadow）。
    // 用零偏移 + 纯模糊：偏移量在设备坐标系下计算、不随 rotate 旋转，会导致旋转时阴影错位；
    // 零偏移的对称光晕则旋转安全。阴影状态在 save/restore 内、每帧开头也会重置，不会泄漏。
    this.ctx.fillStyle = txt.color;
    if (!hasBg) {
      this.ctx.shadowColor = 'rgba(0,0,0,0.6)';
      this.ctx.shadowBlur = fontSize * 0.18;
      this.ctx.shadowOffsetX = 0;
      this.ctx.shadowOffsetY = 0;
    }
    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      const x = this.getTextX(txt.align, 0);
      this.ctx.fillText(line, x, y);
    });

    this.ctx.restore();
  }

  /**
   * 转场垫底片段：同轨上结束最晚、且在本片段开始之前的片段（与预览 prevAdjacentClip 一致）
   */
  private prevAdjacentClip(c: TimelineClip, allClips: TimelineClip[]): TimelineClip | null {
    let best: TimelineClip | null = null;
    let bestEnd = -Infinity;
    for (const o of allClips) {
      if (o.trackId !== c.trackId || o.id === c.id) continue;
      const end = o.start + o.duration;
      if (end <= c.start + 0.06 && end > bestEnd) { best = o; bestEnd = end; }
    }
    return best;
  }

  /**
   * 转场类型+进度 → Canvas 数值修饰（镜像 utils.transitionStyles 的 CSS 输出）。
   * p: 0..1。fade/dissolve→alpha；wipe→inset 揭开裁剪；slide→位移；zoom→alpha+缩放。
   * CSS inset 语法为 inset(top right bottom left)，k=1-t 表示该边裁掉的比例。
   */
  private transitionMods(type: TransitionType, p: number): TransitionMods {
    const t = Math.max(0, Math.min(1, p));
    const k = 1 - t;
    switch (type) {
      case 'fade':
      case 'dissolve':
        return { alpha: t };
      case 'wipe-left':  // 从左揭开：右侧裁掉 k
        return { inset: { t: 0, r: k, b: 0, l: 0 } };
      case 'wipe-right': // 从右揭开：左侧裁掉 k
        return { inset: { t: 0, r: 0, b: 0, l: k } };
      case 'wipe-up':    // 从上揭开：底部裁掉 k
        return { inset: { t: 0, r: 0, b: k, l: 0 } };
      case 'wipe-down':  // 从下揭开：顶部裁掉 k
        return { inset: { t: k, r: 0, b: 0, l: 0 } };
      case 'slide-left':
        return { translateXFrac: k };
      case 'slide-right':
        return { translateXFrac: -k };
      case 'zoom-in':
        return { alpha: t, scale: 0.6 + 0.4 * t };
      case 'zoom-out':
        return { alpha: t, scale: 1.4 - 0.4 * t };
      default:
        return {};
    }
  }

  /**
   * 获取媒体元素（video 或 image）
   */
  private async getMediaElement(
    asset: EditorAsset,
    time: number
  ): Promise<HTMLVideoElement | HTMLImageElement | null> {
    if (asset.type === 'image') {
      return this.loadImage(asset.url);
    } else if (asset.type === 'video') {
      return this.loadVideo(asset.url, time);
    }
    return null;
  }

  /**
   * 加载图片（带缓存）
   */
  private loadImage(url: string): Promise<HTMLImageElement> {
    const cached = this.imageCache.get(url);
    if (cached) {
      return Promise.resolve(cached);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * 加载视频并跳转到指定时间（优化版：减少 seek 次数）
   */
  private async loadVideo(url: string, time: number): Promise<HTMLVideoElement> {
    let video = this.videoCache.get(url);
    if (!video) {
      video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      this.videoCache.set(url, video);

      await new Promise((resolve, reject) => {
        video!.onloadedmetadata = resolve;
        video!.onerror = reject;
      });
    }

    // 只有当时间差超过阈值时才 seek（避免频繁 seek）
    const timeDiff = Math.abs(video.currentTime - time);
    if (timeDiff > 0.1) {
      video.currentTime = time;
      // 等待 seek 完成，但设置超时避免卡死
      await Promise.race([
        new Promise(resolve => {
          video!.onseeked = resolve;
        }),
        new Promise(resolve => setTimeout(resolve, 100)) // 100ms 超时
      ]);
    }

    return video;
  }

  /**
   * 计算淡入淡出系数
   */
  private calculateFade(props: any, localT: number, duration: number): number {
    let fade = 1;
    if (props.fadeIn > 0 && localT < props.fadeIn) {
      fade *= localT / props.fadeIn;
    }
    if (props.fadeOut > 0 && localT > duration - props.fadeOut) {
      fade *= (duration - localT) / props.fadeOut;
    }
    return Math.max(0, Math.min(1, fade));
  }

  /**
   * 将 CSS filter 转换为 Canvas filter 字符串
   */
  private convertFiltersToCanvas(filters: ClipFilters): string {
    // Canvas filter 语法与 CSS 基本相同
    return filterCss(filters);
  }

  /**
   * 应用文字动画的 transform（简化版）
   */
  private applyTextAnimationTransform(transform: string): void {
    if (transform === 'none') return;

    // 解析 translateY / scale
    const translateYMatch = transform.match(/translateY\(([^)]+)\)/);
    const scaleMatch = transform.match(/scale\(([^)]+)\)/);

    if (translateYMatch) {
      const percent = parseFloat(translateYMatch[1]);
      if (!isNaN(percent)) {
        this.ctx.translate(0, (percent / 100) * this.canvas.height);
      }
    }

    if (scaleMatch) {
      const scale = parseFloat(scaleMatch[1]);
      if (!isNaN(scale)) {
        this.ctx.scale(scale, scale);
      }
    }
  }

  /**
   * 文字自动折行（与预览一致：按给定像素宽度折行）。
   * 支持中英文混排：中日韩/全角字符可逐字断行，英文按单词断行，保留显式 \n。
   * 注意：调用前 this.ctx.font 必须已设置（measureText 依赖当前字体）。
   */
  private wrapText(text: string, maxWidth: number): string[] {
    const out: string[] = [];
    const CJK = '\\u3040-\\u30ff\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef';
    const tokenRe = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, 'g');
    for (const para of text.split('\n')) {
      if (para === '') { out.push(''); continue; }
      const tokens = para.match(tokenRe) || [para];
      let line = '';
      for (const tok of tokens) {
        const candidate = line + tok;
        if (line !== '' && this.ctx.measureText(candidate).width > maxWidth) {
          out.push(line.replace(/\s+$/, ''));
          line = /^\s+$/.test(tok) ? '' : tok; // 行首不留空白
        } else {
          line = candidate;
        }
      }
      out.push(line.replace(/\s+$/, ''));
    }
    return out.length ? out : [''];
  }

  /**
   * 获取文字 X 坐标（根据对齐方式）
   */
  private getTextX(align: string, textWidth: number): number {
    switch (align) {
      case 'left':
        return -textWidth / 2;
      case 'right':
        return textWidth / 2;
      default:
        return 0;
    }
  }

  /**
   * 获取 Canvas 元素（用于编码）
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.videoCache.forEach(v => {
      v.pause();
      v.src = '';
    });
    this.videoCache.clear();
    this.imageCache.clear();
  }
}

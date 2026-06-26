/**
 * PromptCardVideo — 卡片 hover 自动播放视频
 *
 * 设计：
 *   - hover 触发：先取全局视频加载队列槽位（限制同时下载数=2，避免网络阻塞）
 *     → 设 src → 视频 onCanPlay 移除 loading → onPlaying 加 .is-playing
 *   - 视频就绪后：父级 wrapper 加 .is-playing → cover fade-out + video fade-in（无缝替换）
 *   - 离开时：pause + 重置 currentTime + 移除 .is-playing（保留 src 复用）
 *   - 组件卸载：释放队列槽位
 *
 * 队列是模块级单例，所有卡片共享 2 个并发下载槽位。
 */

import { useEffect, useRef } from 'react';

/** 全局视频加载队列：限制同时下载数，避免 hover 多个卡片时网络拥堵 */
class VideoLoadQueue {
  private activeCount = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<() => void> {
    if (this.activeCount < this.max) {
      this.activeCount++;
      return Promise.resolve(() => this.release());
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => {
        this.activeCount++;
        resolve(() => this.release());
      });
    });
  }

  private release() {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}

const videoQueue = new VideoLoadQueue(2);

interface PromptCardVideoProps {
  src: string;
  title: string;
}

export default function PromptCardVideo({ src, title }: PromptCardVideoProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const acquiredRef = useRef(false);

  async function handleEnter() {
    const v = videoRef.current;
    const slot = slotRef.current;
    if (!v || !slot) return;

    // 1) 取队列槽位（限并发）
    if (!acquiredRef.current) {
      releaseRef.current = await videoQueue.acquire();
      acquiredRef.current = true;
    }

    // 2) 首次 hover：设 src + 触发下载
    if (!v.src) {
      v.src = src;
      v.load();
      slot.classList.add('is-loading');
    }

    // 3) play（muted 通常会被允许；失败忽略）
    v.play().catch(() => {
      /* autoplay 失败：忽略 */
    });
  }

  function handleLeave() {
    const v = videoRef.current;
    const slot = slotRef.current;
    if (!v || !slot) return;
    v.pause();
    v.currentTime = 0;
    slot.classList.remove('is-playing');
    slot.classList.remove('is-loading');
    // 保留 src：下次 hover 不再下载
  }

  function handleCanPlay() {
    const slot = slotRef.current;
    if (slot) slot.classList.remove('is-loading');
  }

  function handlePlaying() {
    const slot = slotRef.current;
    if (slot) slot.classList.add('is-playing');
  }

  // 卸载时释放队列槽位
  useEffect(() => {
    return () => {
      if (releaseRef.current) {
        releaseRef.current();
        releaseRef.current = null;
        acquiredRef.current = false;
      }
    };
  }, []);

  return (
    <div
      ref={slotRef}
      className="prompt-video-slot"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div className="video-loader" aria-hidden="true">
        <span className="video-loader-dot" />
        <span className="video-loader-dot" />
        <span className="video-loader-dot" />
      </div>
      <video
        ref={videoRef}
        className="prompt-hover-video"
        data-src={src}
        loop
        playsInline
        muted
        preload="none"
        onCanPlay={handleCanPlay}
        onPlaying={handlePlaying}
        aria-label={title}
      />
    </div>
  );
}
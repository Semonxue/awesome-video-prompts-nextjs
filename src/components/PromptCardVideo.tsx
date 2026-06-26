/**
 * PromptCardVideo — 卡片 hover 自动播放视频
 *
 * 设计：
 *   - hover 监听由父级 PromptCard 负责（直接监听 .prompt-image-wrapper，更可靠），
 *     本组件通过 forwardRef 暴露 imperative API（play / pause）供父级调用
 *   - 父级 hover 进入 → play（设 src + load + play，自动处理队列并发）
 *   - 父级 hover 离开 → pause + 重置 currentTime + 移除 .is-playing（保留 src 复用）+ 释放队列槽位
 *   - 视频就绪后：父级 wrapper 加 .is-playing → cover fade-out + video fade-in（无缝替换）
 *
 * 队列是模块级单例，所有卡片共享 2 个并发下载槽位。
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

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

export interface PromptCardVideoHandle {
  play: () => Promise<void>;
  pause: () => void;
}

interface PromptCardVideoProps {
  src: string;
  title: string;
}

const PromptCardVideo = forwardRef<PromptCardVideoHandle, PromptCardVideoProps>(function PromptCardVideo(
  { src, title },
  ref,
) {
  const slotRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const acquiredRef = useRef(false);

  async function play() {
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

  function pause() {
    const v = videoRef.current;
    const slot = slotRef.current;
    if (!v || !slot) return;
    v.pause();
    v.currentTime = 0;
    slot.classList.remove('is-playing');
    slot.classList.remove('is-loading');
    // 保留 src：下次 hover 不再下载
    // 释放队列槽位
    if (releaseRef.current) {
      releaseRef.current();
      releaseRef.current = null;
      acquiredRef.current = false;
    }
  }

  useImperativeHandle(ref, () => ({ play, pause }), []);

  // 卸载时释放队列槽位（如果还在 hover 中）
  useEffect(() => {
    return () => {
      if (releaseRef.current) {
        releaseRef.current();
        releaseRef.current = null;
        acquiredRef.current = false;
      }
    };
  }, []);

  function handleCanPlay() {
    const slot = slotRef.current;
    if (slot) slot.classList.remove('is-loading');
  }

  function handlePlaying() {
    const slot = slotRef.current;
    if (slot) slot.classList.add('is-playing');
  }

  return (
    <div ref={slotRef} className="prompt-video-slot">
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
});

export default PromptCardVideo;

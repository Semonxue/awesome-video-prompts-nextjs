'use client';

/**
 * PromptCardVideo — 卡片 hover 自动播放视频
 *
 * Phase 1 实现：mouseenter/mouseleave 切换 src + play/pause
 * 性能优化：src 设为 data-src，hover 时才设 src（避免 N 个 video 同时下载）
 */
import { useRef } from 'react';

interface PromptCardVideoProps {
  src: string;
  title: string;
}

export default function PromptCardVideo({ src, title }: PromptCardVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);

  function handleEnter() {
    const v = videoRef.current;
    if (!v) return;
    if (!v.src) {
      v.src = src;
      v.load();
      if (loaderRef.current) loaderRef.current.style.display = 'flex';
    }
    v.play().catch(() => {
      // autoplay 失败：忽略（多数浏览器允许 muted video play）
    });
  }

  function handleLeave() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  }

  function handlePlaying() {
    if (videoRef.current) videoRef.current.style.opacity = '1';
    if (loaderRef.current) loaderRef.current.style.display = 'none';
  }

  return (
    <>
      <div
        ref={loaderRef}
        style={{
          display: 'none',
          position: 'absolute',
          inset: 0,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 4,
          background: 'rgba(0,0,0,0.1)',
        }}
      >
        <span
          style={{
            color: 'white',
            fontWeight: 500,
            background: 'rgba(0,0,0,0.6)',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          Loading...
        </span>
      </div>
      <video
        ref={videoRef}
        className="prompt-hover-video"
        data-src={src}
        loop
        playsInline
        muted
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onPlaying={handlePlaying}
        aria-label={title}
        style={{
          display: 'none',
          opacity: 0,
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 5,
          transition: 'opacity 0.3s',
        }}
      />
    </>
  );
}
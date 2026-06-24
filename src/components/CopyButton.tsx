'use client';

/**
 * CopyButton — 复制提示词按钮
 * Client Component（需要 navigator.clipboard）
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface CopyButtonProps {
  /** 要复制的文本（一般是 prompt description） */
  text: string;
  /** 按钮变体：icon-only / text */
  variant?: 'icon' | 'text';
}

export default function CopyButton({ text, variant = 'icon' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const t = useTranslations('prompt');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // 老浏览器 / 非安全上下文：降级到 textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // give up silently — user can long-press to copy
      }
      document.body.removeChild(ta);
    }
  }

  if (variant === 'text') {
    return (
      <button
        type="button"
        className="copy-btn-text"
        onClick={handleCopy}
        aria-label={t('copyPrompt')}
        style={{
          background: 'var(--accent-primary)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 16px',
          fontSize: '14px',
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {copied ? t('copied') : t('copyPrompt')}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      aria-label={t('copyPrompt')}
      title={copied ? t('copied') : t('copyPrompt')}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        color: copied ? 'var(--accent-primary)' : 'var(--text-secondary)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
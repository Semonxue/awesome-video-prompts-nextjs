'use client';

/**
 * LangSwitcher — 语言切换器（客户端组件）
 * 切换时保持当前路径，只替换 locale 段
 */
import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { Locale } from '@/i18n/request';

interface LangSwitcherProps {
  currentLocale: Locale;
  locales: readonly Locale[];
}

export default function LangSwitcher({ currentLocale, locales }: LangSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname() || '/';

  // 点外面关闭
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  /**
   * 切换 locale 时保持当前路径
   * 例：/en/prompts/foo → /zh/prompts/foo
   * 例：/en → /zh
   */
  function buildHref(target: Locale): string {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return `/${target}`;
    // 第一段是 locale，替换；其余保留
    segments[0] = target;
    return '/' + segments.join('/');
  }

  const currentName = currentLocale.toUpperCase();

  return (
    <div className="language-switcher" ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="lang-dropdown"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {currentName}
      </button>
      <ul className={`lang-menu ${open ? 'show' : ''}`} role="listbox">
        {locales.map((loc) => (
          <li key={loc} role="option" aria-selected={loc === currentLocale}>
            <Link
              href={buildHref(loc)}
              className="lang-item"
              onClick={() => setOpen(false)}
            >
              {localeDisplayName(loc)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function localeDisplayName(loc: Locale): string {
  return {
    en: 'English',
    zh: '中文',
    ja: '日本語',
  }[loc];
}
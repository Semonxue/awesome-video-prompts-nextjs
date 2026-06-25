/**
 * Header — 双层结构（header-default + header-compact）
 *
 * 视觉对齐线上 awesomevideoprompts.com：
 *  - header-default: 默认滚动前，含 logo + 导航 + 完整搜索区（intro + 搜索框 + model tabs + tag tabs）
 *  - header-compact:  滚动 >100px 简化版（logo + 搜索框），fixed 浮在视口顶部
 *
 * 滚动切换由 'use client' + scroll listener 实现
 * 文案通过 next-intl useTranslations 走 i18n
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import LangSwitcher from './LangSwitcher';
import { locales, type Locale } from '@/i18n/request';

interface Props {
  locale: string;
  activeTag?: string;
  activeModel?: string;
  /** 模型 tabs 数据 */
  modelOptions?: { slug: string; name: string; count: number }[];
  /** 标签 tabs 数据 */
  tagOptions?: { slug: string; name: string; count: number }[];
  /** 总数（用于 intro text） */
  totalCount?: number;
}

export function Header({
  locale,
  activeTag,
  activeModel,
  modelOptions = [],
  tagOptions = [],
  totalCount = 0,
}: Props) {
  const t = useTranslations('header');
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const [compact, setCompact] = useState(false);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);

  // 滚动监听：>100px 切换 compact 模式
  useEffect(() => {
    function onScroll() {
      setCompact(window.scrollY > 100);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (activeTag) params.set('tag', activeTag);
    if (activeModel) params.set('model', activeModel);
    if (q.trim()) params.set('q', q.trim());
    const qs = params.toString();
    router.push(qs ? `/${locale}?${qs}` : `/${locale}`);
  }

  // 默认显示前 N 个 + 折叠
  const MODELS_INITIAL = 10;
  const TAGS_INITIAL = 11;
  const visibleModels = modelsExpanded ? modelOptions : modelOptions.slice(0, MODELS_INITIAL);
  const visibleTags = tagsExpanded ? tagOptions : tagOptions.slice(0, TAGS_INITIAL);
  const hiddenModelsCount = Math.max(0, modelOptions.length - MODELS_INITIAL);
  const hiddenTagsCount = Math.max(0, tagOptions.length - TAGS_INITIAL);

  return (
    <header className={`site-header${compact ? ' header-compact' : ''}`}>
      {/* 默认 header（intro + 搜索 + model tabs + tag tabs） */}
      <div className="header-default" style={{ display: compact ? 'none' : 'block' }}>
        <div className="header-container">
          <Link href={`/${locale}`} className="logo-group">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <span className="site-title-text">{t('siteTitle')}</span>
          </Link>

          {/* 右侧：GitHub / Twitter / Lang */}
          <nav className="header-nav">
            <a
              href="https://github.com/Semonxue/awesome-video-prompts"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link"
              aria-label="GitHub"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77 5.44 5.44 0 003.5 8.55c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" />
              </svg>
            </a>
            <a
              href="https://x.com/semonxue"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link"
              aria-label="Twitter"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zM17.61 20.644h2.039L6.486 3.24H4.298z" />
              </svg>
            </a>
            <LangSwitcher currentLocale={locale as Locale} locales={locales} />
          </nav>
        </div>

        {/* 搜索区（intro + search + model tabs + tag tabs） */}
        <div className="search-section">
          <p className="intro-text">
            {t('introPrefix')}{' '}
            <a
              href="https://github.com/Semonxue/awesome-video-prompts"
              target="_blank"
              rel="noopener noreferrer"
              className="text-decoration-none"
            >
              {t('openSourceLink')}
            </a>{' '}
            {t('introMiddle')} · {t('introSuffix', { count: totalCount.toLocaleString() })}
          </p>
          <div className="search-area">
            <div className="search-row">
              <form className="search-box-wrapper" onSubmit={handleSearch} role="search">
                <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="search"
                  className="search-input"
                  placeholder={t('searchPlaceholder')}
                  id="search-input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label={t('searchAriaLabel')}
                />
              </form>

              {modelOptions.length > 0 && (
                <div className={`model-tags${modelsExpanded ? ' expanded' : ''}`}>
                  <Link href={`/${locale}`} className={`model-tag${!activeModel ? ' active' : ''}`} data-model="all">
                    {t('all')}
                  </Link>
                  {visibleModels.map((m) => (
                    <Link
                      key={m.slug}
                      href={`/${locale}?model=${m.slug}`}
                      className={`model-tag${activeModel === m.slug ? ' active' : ''}`}
                      data-model={m.slug}
                    >
                      {m.name} <span className="tag-count">{m.count}</span>
                    </Link>
                  ))}
                  {hiddenModelsCount > 0 && (
                    <button
                      type="button"
                      className="model-tag more"
                      onClick={() => setModelsExpanded((v) => !v)}
                    >
                      {modelsExpanded ? t('showLess') : t('showMore', { count: hiddenModelsCount })}
                    </button>
                  )}
                </div>
              )}
            </div>

            {tagOptions.length > 0 && (
              <div className="content-tag-area">
                <div className={`content-tags${tagsExpanded ? ' expanded' : ''}`}>
                  <Link href={`/${locale}`} className={`content-tag${!activeTag ? ' active' : ''}`} data-tag="all">
                    {t('all')}
                  </Link>
                  {visibleTags.map((tt) => (
                    <Link
                      key={tt.slug}
                      href={`/${locale}?tag=${tt.slug}`}
                      className={`content-tag${activeTag === tt.slug ? ' active' : ''}`}
                      data-tag={tt.slug}
                    >
                      {tt.name} <span className="tag-count">{tt.count}</span>
                    </Link>
                  ))}
                  {hiddenTagsCount > 0 && (
                    <button
                      type="button"
                      className="content-tag more"
                      onClick={() => setTagsExpanded((v) => !v)}
                    >
                      {tagsExpanded ? t('showLess') : t('showMore', { count: hiddenTagsCount })}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compact header（滚动 >100px 浮在视口顶部） */}
      <div className="header-compact-inner" style={{ display: compact ? 'flex' : 'none' }}>
        <div className="header-container">
          <Link href={`/${locale}`} className="logo-group">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <span className="site-title-text">{t('siteTitle')}</span>
          </Link>
          <form className="search-box-wrapper compact" onSubmit={handleSearch} role="search">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              className="search-input"
              placeholder={t('searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t('searchAriaLabel')}
            />
          </form>
          <LangSwitcher currentLocale={locale as Locale} locales={locales} />
        </div>
      </div>
    </header>
  );
}

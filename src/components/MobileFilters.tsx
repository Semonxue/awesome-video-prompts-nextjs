'use client';

/**
 * MobileFilters — 移动端筛选抽屉
 * Phase 1 占位：渲染 UI 骨架，无实际筛选逻辑
 * Phase 3 接 D1 查询 + URL 参数同步
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';

export default function MobileFilters() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <div className="mobile-filters">
      <button
        type="button"
        className="mobile-filter-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Toggle filters"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 16px',
          fontSize: 13,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {t('filter.allModels')}
      </button>

      {open && (
        <div
          className="mobile-filter-panel"
          style={{
            marginTop: 8,
            padding: 16,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
            {t('empty.phaseOneHint')}
          </p>
        </div>
      )}
    </div>
  );
}
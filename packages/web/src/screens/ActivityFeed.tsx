// 활동 기록 (01 문서 8.2·9장, 캔버스 SeaScreenMain 아래 1080×190). 필터 전체/작업/회의/경제/성격, 최근 것이 위
import { useState } from 'react';
import type { FeedItem, FeedKind } from '@tycoon/core';
import { Icon, type IconName } from '../icons/Icon';
import { noticeText, usePrefs } from '../live/prefs';
import { FilterChip } from '../ui';
import { t } from '../i18n';
import './screens.css';

// 종류 = 색 + 아이콘 (M10). 색은 SeaScreenMain 활동 기록 점
const KIND: Record<FeedKind, { icon: IconName; bg: string }> = {
  task: { icon: 'working', bg: 'var(--st-working)' },
  meeting: { icon: 'meeting', bg: 'var(--st-meeting)' },
  economy: { icon: 'vault', bg: 'var(--paper)' },
  personality: { icon: 'personality', bg: 'var(--slot5-tint)' },
};
const FILTERS = ['all', 'task', 'meeting', 'economy', 'personality'] as const;
export type FeedFilter = (typeof FILTERS)[number];

/**
 * 필터를 거친 기록, 최근 것이 앞 (상태의 feed는 최근 것이 뒤).
 * key = 내용 + 같은 내용 중 몇 번째(오래된 쪽부터) — 새 기록이 앞에 붙어도 있던 행의 key가 그대로라 React가 한 줄만 넣는다.
 * (순번 key면 스냅샷마다 모든 행이 한 칸씩 밀려 500줄을 다시 쓴다)
 */
export function visibleFeed(feed: FeedItem[], filter: FeedFilter) {
  const seen = new Map<string, number>();
  const out: (FeedItem & { key: string })[] = [];
  for (const f of feed) {
    if (filter !== 'all' && f.kind !== filter) continue;
    const base = `${f.at}|${f.kind}|${f.text}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ ...f, key: `${base}|${n}` });
  }
  return out.reverse();
}

/** 'HH:MM' (내 컴퓨터 시각) */
const hhmm = (at: number) => new Date(at).toTimeString().slice(0, 5);

export function ActivityFeed({ feed }: { feed: FeedItem[] }) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const { speech } = usePrefs(); // 회의 안건 글자 (01 문서 10장)
  const items = visibleFeed(feed, filter);
  return (
    <section className="af" aria-label={t('feed.title')}>
      <div className="af__bar">
        <h2>{t('feed.title')}</h2>
        <div role="group" aria-label={t('feed.filter')} className="af__filters">
          {FILTERS.map((f) => (
            <FilterChip key={f} selected={f === filter} onClick={() => setFilter(f)}>
              {t(`feed.${f}`)}
            </FilterChip>
          ))}
        </div>
      </div>
      {/* ponytail: 500개까지 전부 그린다. 스냅샷마다 느려지면 앞 100개만 */}
      {/* 스크롤 목록은 브라우저가 키보드 포커스를 준다 → 일부러 받고 이름·링을 붙인다 */}
      <ol className="af__list" tabIndex={0} aria-label={t('feed.title')}>
        {items.length === 0 && <li className="af__row af__row--empty">{t('feed.empty')}</li>}
        {items.map((f) => (
          <li key={f.key} className="af__row" data-kind={f.kind}>
            <time className="af__time" dateTime={new Date(f.at).toISOString()}>
              {hhmm(f.at)}
            </time>
            <span className="af__dot" style={{ background: KIND[f.kind].bg }}>
              <Icon name={KIND[f.kind].icon} size={12} />
            </span>
            <span className="af__text">{noticeText(f, speech)}</span>
            <span className="af__kind">{t(`feed.${f.kind}`)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

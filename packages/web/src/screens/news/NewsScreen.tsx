// 마을 신문 (M18, 06 문서 9장, D27): 월 달력 + 그날 신문(1면 · 기사 · 단신 · 옆 칸). 하루 = 이 컴퓨터의 날짜(자정 기준, 브라우저 시간대).
// 경제 패널과 같은 틀(.ec 머리·카드)을 쓴다. 계산은 paper.ts (순수)
import type { DayRecord, GameConfig, VillageState } from '@tycoon/core';
import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { Icon } from '../../icons/Icon';
import { noticeText, usePrefs } from '../../live/prefs';
import { Button } from '../../ui';
import { Face } from '../building/BuildingScreen';
import { fetchEconomy } from '../economy/api';
import { compact, tipText } from '../economy/EconomyScreen';
import { dayKey, isDayKey, paper, workDays, type Story } from './paper';
import './news.css';

export interface NewsScreenProps {
  state: VillageState;
  cfg: GameConfig;
  projectId: string;
  onBack: () => void;
  /** 주소의 날짜 `YYYY-MM-DD`. '' = 오늘 */
  date: string;
  /** 다른 날짜를 고르면 (주소가 바뀐다) */
  onDate: (date: string) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const WEEK = t('news.weekdays').split(' ');
const parts = (key: string) => key.split('-').map(Number) as [number, number, number];

function dur(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return t('building.sec', { n: sec });
  const m = Math.floor(sec / 60);
  return m < 60 ? t('building.min', { n: m }) : t('building.hour', { h: Math.floor(m / 60), m: m % 60 });
}

/** 얼굴 + 이름 (팀원 또는 외부인 종류) */
function Who({ s, cfg, id }: { s: VillageState; cfg: GameConfig; id: string }) {
  return (
    <span className="nw-who">
      <Face s={s} cfg={cfg} id={id} />
      <span>{s.members[id]?.name ?? id}</span>
    </span>
  );
}

/** 걸린 시간 · 도구 수 · 테스트 결과 */
const facts = (x: Story) =>
  [
    x.ms === null ? '' : t('building.took', { d: dur(x.ms) }),
    t('news.tools', { n: x.task.toolCalls }),
    t(`news.quality.${x.task.quality}`),
  ]
    .filter(Boolean)
    .join(' · ');

function Calendar({
  ym,
  day,
  today,
  days,
  onMonth,
  onDate,
}: {
  ym: string;
  day: string;
  today: string;
  days: Map<string, number>;
  onMonth: (ym: string) => void;
  onDate: (d: string) => void;
}) {
  const [y, m] = parts(ym);
  const lead = new Date(y, m - 1, 1).getDay();
  const n = new Date(y, m, 0).getDate();
  const keys = Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
  const max = Math.max(0, ...keys.map((k) => days.get(k) ?? 0));
  const shift = (k: number) => {
    const d = new Date(y, m - 1 + k, 1);
    onMonth(dayKey(d.getTime()).slice(0, 7));
  };
  return (
    <section className="ui-card ec-card nw-cal" aria-label={t('news.calendar')}>
      <div className="nw-calhead">
        <Button size="m" aria-label={t('news.prev')} onClick={() => shift(-1)}>
          ‹
        </Button>
        <h2 className="ec-h2">{t('news.month', { y, m })}</h2>
        <Button size="m" aria-label={t('news.next')} onClick={() => shift(1)}>
          ›
        </Button>
      </div>
      <div className="nw-week" aria-hidden="true">
        {WEEK.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <ol className="nw-days">
        {keys.map((k, i) => {
          const v = days.get(k);
          const label = [
            t('news.day', { m, d: i + 1 }),
            v === undefined ? t('news.dayRest') : t('news.dayWork', { n: fmt(Math.round(v)) }),
            k === today ? t('news.today') : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={k} style={i === 0 ? { gridColumnStart: lead + 1 } : undefined}>
              <button
                type="button"
                className={`nw-day${k === today ? ' nw-day--today' : ''}`}
                aria-label={label}
                aria-pressed={k === day}
                aria-current={k === today ? 'date' : undefined}
                onClick={() => onDate(k)}
              >
                {i + 1}
                {v !== undefined && (
                  // 진하기 = 그달 가장 많이 일한 날에 견준 일의 양
                  <span className="nw-dot" style={{ opacity: 0.3 + 0.7 * (max > 0 ? v / max : 0) }} />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function NewsScreen({ state: s, cfg, projectId, onBack, date, onDate }: NewsScreenProps) {
  const { speech } = usePrefs();
  const today = dayKey(Date.now());
  const day = isDayKey(date) ? date : today;
  // 보는 달: 날짜가 바뀌면(주소·뒤로) 그 달로 돌아간다
  const [shown, setShown] = useState({ day, ym: day.slice(0, 7) });
  const ym = shown.day === day ? shown.ym : day.slice(0, 7);

  // 지난 경제 기록은 SSE 상태에서 잘려 있다 (HISTORY_KEEP) → 경제 패널처럼 GET /economy로 전부, 실패하면 상태의 기록
  const own = s.economy.history;
  const [remote, setRemote] = useState<DayRecord[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchEconomy(projectId, 'all').then(
      (r) => live && setRemote(r.history),
      () => live && setRemote(null),
    );
    return () => {
      live = false;
    };
  }, [projectId, own.length, own.at(-1)?.day]);

  const p = paper(s, cfg, remote ?? own, day);
  const side = p.side;
  const [y, m, d] = parts(day);
  const summary = (x: Story) =>
    x.task.summary && <p className="nw-summary">{speech ? x.task.summary : t('news.hidden')}</p>;

  return (
    <div className="ec nw">
      <div className="ec-head">
        <button type="button" className="ec-back" onClick={onBack}>
          {t('news.village')}
        </button>
        <h1 className="ec-title">{t('news.title')}</h1>
        <span className="ec-meta">{t('news.date', { y, m, d, w: WEEK[new Date(y, m - 1, d).getDay()] ?? '' })}</span>
      </div>

      <div className="nw-body">
        <Calendar
          ym={ym}
          day={day}
          today={today}
          days={workDays(s, cfg)}
          onMonth={(v) => setShown({ day, ym: v })}
          onDate={onDate}
        />

        <div className="ec-col">
          {p.front ? (
            <>
              <article className="ui-card ec-card nw-front">
                <span className="nw-kicker">{t('news.front')}</span>
                <h2 className="nw-headline">{p.front.task.subject}</h2>
                {p.front.who && <Who s={s} cfg={cfg} id={p.front.who} />}
                {summary(p.front)}
                <p className="ec-meta">{facts(p.front)}</p>
              </article>
              {p.subs.length > 0 && (
                <section className="ui-card ec-card" aria-label={t('news.subs')}>
                  <h2 className="ec-h2">{t('news.subs')}</h2>
                  <ul className="nw-list">
                    {p.subs.map((x) => (
                      <li key={x.task.id} className="nw-sub">
                        <h3 className="nw-subhead">{x.task.subject}</h3>
                        {x.who && <Who s={s} cfg={cfg} id={x.who} />}
                        {summary(x)}
                        <p className="ec-meta">{facts(x)}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {p.briefs.length > 0 && (
                <section className="ui-card ec-card" aria-label={t('news.briefs')}>
                  <h2 className="ec-h2">{t('news.briefs')}</h2>
                  <ul className="nw-list nw-briefs">
                    {p.briefs.map((x) => (
                      <li key={x.task.id}>
                        {x.task.subject}
                        {x.who && <span className="ec-meta"> · {s.members[x.who]?.name ?? x.who}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <section className="ui-card ec-card ec-empty" role="status">
              <h2 className="ec-h2">{t('news.empty')}</h2>
              <p className="ec-meta">{t('news.emptyHint')}</p>
            </section>
          )}
        </div>

        <section className="ui-card ec-card nw-side" aria-label={t('news.side')}>
          <h2 className="ec-h2">{t('news.side')}</h2>
          <dl className="nw-facts">
            <dt>{t('news.done')}</dt>
            <dd>{fmt(side.done)}</dd>
            <dt>{t('news.earned', { currency: t('currency') })}</dt>
            <dd>{fmt(side.earned)}</dd>
            <dt>{t('news.spent')}</dt>
            <dd>{fmt(side.spent)}</dd>
            <dt>{t('news.fund')}</dt>
            <dd>
              {side.fund === null ? (
                <span className="ec-tone--flat">{t('news.noRecord')}</span>
              ) : side.fund === 0 ? (
                t('news.even')
              ) : (
                <span className={`ec-tone--${side.fund > 0 ? 'good' : 'bad'}`}>
                  {t(side.fund > 0 ? 'news.surplus' : 'news.deficit', { n: fmt(Math.abs(side.fund)) })}
                </span>
              )}
            </dd>
            <dt>{t('news.weather')}</dt>
            <dd className="nw-weather">
              <Icon name={side.weather.kind} size={20} />
              {t(`weather.${side.weather.kind}`)}
            </dd>
            <dt>{t('news.best')}</dt>
            <dd>
              {side.best ? (
                <>
                  <Who s={s} cfg={cfg} id={side.best.id} />
                  <span className="ec-meta">{t('economy.effPer', { n: compact(side.best.perPoint) })}</span>
                </>
              ) : (
                t('news.none')
              )}
            </dd>
            <dt>{t('news.growth')}</dt>
            <dd>
              {side.growth.length ? (
                <ul className="nw-list">
                  {side.growth.map((f, i) => (
                    <li key={i}>{noticeText(f, speech)}</li>
                  ))}
                </ul>
              ) : (
                t('news.none')
              )}
            </dd>
            <dt>{t('news.tip')}</dt>
            <dd>
              {side.tip ? (
                <>
                  <Who s={s} cfg={cfg} id={side.tip.id} />
                  <span className="ec-meta">{tipText(side.tip.tip)}</span>
                </>
              ) : (
                t('news.none')
              )}
            </dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

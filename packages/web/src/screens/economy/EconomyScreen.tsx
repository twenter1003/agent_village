// 경제 패널 (01 문서 8.7 + 구현 메모, 03 문서 6장, 캔버스 SeaScreenEconomy): 상단 바 아래를 덮는 상세 화면.
// 기간 필터 한 줄 → 지표 타일 3개 → 2열(기금 흐름·주별 금고 흐름 / 잔고·효율) 또는 표. 기간은 아래 전부에 같이 적용.
// 물가·금리·중앙은행은 없다 (D20). 지금 값은 상단 바와 같은 실시간 상태, 시계열은 GET /economy (실패하면 상태의 economy.history).
import { efficiency, slotTone, topCause, type Tip } from '@tycoon/core';
import type { DayRecord, GameConfig, Member, VillageState } from '@tycoon/core';
import { useEffect, useState, type ReactNode } from 'react';
import { Prop } from '../../assets/sea/Asset';
import { t } from '../../i18n';
import { Icon } from '../../icons/Icon';
import { toAccessory, toSpecies } from '../../live/sceneFromState';
import { Critter } from '../../render/Critter';
import { Button, Toggle } from '../../ui';
import { fetchEconomy, type EconomyRange } from './api';
import { FlowChart, TipRow, type WeekBar } from './charts';
import './economy.css';

const RANGES: EconomyRange[] = ['7d', '30d', 'all'];
const SPAN: Record<EconomyRange, number> = { '7d': 7, '30d': 30, all: Infinity };

const fmt = (n: number) => n.toLocaleString('ko-KR');
const signed = (n: number) => `${n < 0 ? '−' : '+'}${fmt(Math.abs(n))}`;
/** 기금 흐름 줄 값: 들어옴 = 수입 색, 나감 = 지출 색, 0은 부호·색 없이 */
function FlowNum({ n }: { n: number }) {
  return (
    <span className={`ec-fnum ec-tone--${n > 0 ? 'good' : n < 0 ? 'bad' : 'flat'}`}>{n ? signed(n) : fmt(0)}</span>
  );
}
/** 큰 토큰 수를 짧게: 12,300 → 1.2만, 3,400,000 → 340만 */
export const compact = (n: number) =>
  new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const jobLabel = (job: string) => (t(`jobs.${job}`) === `jobs.${job}` ? job : t(`jobs.${job}`));
type EffRow = ReturnType<typeof efficiency>['rows'][number];
const pct = (x: number) => Math.round(x * 100);
/** 도구 이름: mcp__Claude_Browser__computer → computer (Claude_Browser) */
const toolName = (tool: string) => {
  const [head, server, ...rest] = tool.split('__');
  return head === 'mcp' && server && rest.length ? `${rest.join('__')} (${server})` : tool;
};
/** 영수증 원인 이름 (01 문서 6.7-2): base | output | rebuild | talk | tool:<이름> */
export const partLabel = (k: string) =>
  k.startsWith('tool:') ? t('house.parts.tool', { tool: toolName(k.slice(5)) }) : t(`house.parts.${k}`);
/** 모델 id를 짧게: claude-haiku-4-5-20251001 → haiku-4-5, 빠른 모드 표시 */
export const modelLabel = (k: string) =>
  k
    .replace(/^claude-/, '')
    .replace(/-\d{8}/, '')
    .replace(/ fast$/, ` (${t('house.fast')})`);
/** 처방 팁 한 줄 (6.7-3) */
export function tipText(x: Tip) {
  const vars = { p: pct(x.p), n: x.n ?? 0 };
  if (x.key !== 'tool') return t(`house.tip.${x.key}`, vars);
  const tool = x.tool ?? '';
  const how = tool.startsWith('mcp__')
    ? 'mcp'
    : t(`house.toolHow.${tool}`) === `house.toolHow.${tool}`
      ? 'other'
      : tool;
  return t('house.tip.tool', { ...vars, tool: toolName(tool), how: t(`house.toolHow.${how}`) });
}
/** 효율 줄 아래 한 줄: 주원인 (6.7). 급여 보정은 없다 (D20) */
const effSub = (r: EffRow) => {
  const cause = topCause(r.m.receipt.parts);
  return cause ? t('economy.effCause', { name: partLabel(cause.key), p: pct(cause.share) }) : '';
};
/** 효율 값 글자 (D23): 일 1점당 토큰 / 끝낸 실행 없음 / 실패만 / 토큰 기록 없음 */
export const effValue = (r: EffRow) =>
  r.runs === 0
    ? t('economy.effNone')
    : r.why === 'noTokens'
      ? t('economy.effNoTokens')
      : r.perPoint === Infinity
        ? t('economy.effFailed')
        : t('economy.effPer', { n: compact(r.perPoint) });
/** 팀 금고(팀원 잔고 합) 기준 수입·지출. 팀장 토큰값·팀장 가구·광장 소품은 기금에서 나가 기금 흐름 카드에 (D21) */
export const income = (r: DayRecord) => r.wages;
// 토큰 비용 (D11)·자재비 (06 문서 5.3)는 옛 기록엔 없다
export const spending = (r: DayRecord) => r.tax + r.purchases + (r.tokens ?? 0) + (r.materials ?? 0);

/** 기간 = 게임 날 번호로 (01 8.7 구현 메모): 7일 = day > 오늘 − 7 */
export const inRange = (history: DayRecord[], today: number, range: EconomyRange) =>
  history.filter((r) => r.day > today - SPAN[range]);

/** 주 k = ⌊(오늘 − day) / 7⌋, 0 = 이번 주. 가장 오래된 주 → 이번 주 순, 빈 주도 0으로 */
export function weekly(rows: DayRecord[], today: number): (WeekBar & { k: number })[] {
  const k = (r: DayRecord) => Math.floor((today - r.day) / 7);
  const oldest = Math.max(-1, ...rows.map(k));
  return Array.from({ length: oldest + 1 }, (_, i) => {
    const w = oldest - i;
    const of = rows.filter((r) => k(r) === w);
    return {
      k: w,
      label: w === 0 ? t('economy.thisWeek') : t('economy.weeksAgo', { n: w }),
      income: of.reduce((n, r) => n + income(r), 0),
      spending: of.reduce((n, r) => n + spending(r), 0),
    };
  });
}

/** ▲/▼ + 색 (글자 토큰). up이 좋은 일이면 good=true. 모양(화살표)이 색 없이도 방향을 말한다 */
function Delta({ diff, text, good }: { diff: number; text: string; good: boolean }) {
  const tone = diff === 0 ? 'flat' : diff > 0 === good ? 'good' : 'bad';
  return (
    <span className={`ec-tile__delta ec-tone--${tone}`}>
      {diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : ''}
      {text}
    </span>
  );
}

function Tile({
  label,
  value,
  children,
  deco,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
  deco?: ReactNode;
}) {
  return (
    <div className="ui-card ec-tile">
      <span className="ec-tile__label">{label}</span>
      <span className="ec-tile__val">{value}</span>
      {children}
      {deco}
    </div>
  );
}

function Face({ m }: { m: Member }) {
  return (
    <span className="ec-face" style={{ background: `var(--slot${slotTone(m.slot)}-tint)` }} aria-hidden="true">
      <Critter
        species={toSpecies(m.species)}
        variant={m.variant}
        accessory={toAccessory(m.accessory)}
        mode="face"
        scale={0.24}
        animate={false}
      />
    </span>
  );
}

function Hardship() {
  return (
    <span className="ec-hard">
      <Icon name="blocked" size={14} />
      {t('economy.hardship')}
    </span>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <section className="ui-card ec-card">
      <h2 className="ec-h2">{title}</h2>
      <table className="ec-table" aria-label={title}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export interface EconomyScreenProps {
  projectId: string;
  state: VillageState;
  /** 수집기가 투영에 쓰는 설정 (SSE config) — 효율 창·표본 수 */
  cfg: GameConfig;
  /** 마을로 돌아가기 */
  onBack: () => void;
}

export function EconomyScreen({ projectId, state: s, cfg, onBack }: EconomyScreenProps) {
  const [range, setRange] = useState<EconomyRange>('30d');
  const [table, setTable] = useState(false);
  const [remote, setRemote] = useState<{ range: EconomyRange; history: DayRecord[] } | null>(null);
  const [loading, setLoading] = useState(false);

  // 새 하루 기록이 오면 다시 받는다. 받는 동안은 앞 그림을 흐리게 둔다 (dataviz: 다시 받아도 틀 유지)
  const own = s.economy.history;
  const lastDay = own.at(-1)?.day ?? -1;
  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchEconomy(projectId, range)
      .then(
        (r) => live && setRemote({ range, history: r.history }),
        () => live && setRemote(null),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [projectId, range, own.length, lastDay]);

  const source = remote?.range === range ? remote.history : own;
  const today = Math.max(s.clock.day, source.at(-1)?.day ?? 0);
  const rows = inRange(source, today, range);
  const weeks = weekly(rows, today);
  const since = t(`economy.since.${range}`);

  // 지표 (지금 값 = 실시간 상태, 상단 바와 같은 합). 팀원 잔고 목록에 팀장은 없다 — 팀장 지갑 = 기금 (D21)
  const members = Object.values(s.members).sort((a, b) => b.balance - a.balance || a.slot - b.slot);
  const vault = members.reduce((n, m) => n + m.balance, 0);
  const workers = members.filter((m) => !m.isLeader);
  const first = rows[0];
  const vault0 = first ? Object.values(first.balances).reduce((n, v) => n + v, 0) : 0;
  const wk = weeks.find((w) => w.k === 0) ?? { income: 0, spending: 0 };
  const prev = weeks.find((w) => w.k === 1);

  // 기금 흐름 (D21, 06 문서 3.3): 기간 기록 합 + 오늘(아직 정산 전, 어느 기간에나 든다) — 지금 기금과 맞게.
  // 못 낸 팀장 토큰값은 돈이 아니라 기록. 옛 기록·상태엔 없을 수 있어 0으로
  const sum = (k: 'tax' | 'leaderTokens' | 'leaderUnpaid' | 'leaderPurchases' | 'works') =>
    rows.reduce((n, r) => n + (r[k] ?? 0), s.economy.today[k] ?? 0);
  const flow = {
    tax: sum('tax'),
    leader: sum('leaderTokens'),
    furniture: sum('leaderPurchases'), // 사용자가 사 준 팀장 가구 (D21)
    unpaid: sum('leaderUnpaid'),
    works: sum('works'), // 레벨업 공사비 + 공공시설 (06 문서 6.4)
  };
  const weekTip = (i: number) => {
    const w = weeks[i];
    return (
      w && (
        <>
          <b className="ec-tip__val">{w.label}</b>
          <TipRow series={1} label={t('economy.income')} value={signed(w.income)} />
          <TipRow series={2} label={t('economy.spending')} value={signed(-w.spending)} />
        </>
      )
    );
  };

  // 효율 순위 (D23, 06 문서 3.6): 잔고와 따로, 최근 window개 실행의 일 1점당 토큰. 기간 필터와 무관. 막대 = 1위 ÷ 나
  const eff = efficiency(s, cfg);
  const best = eff.rows.find((r) => r.rank === 1)?.perPoint ?? 0;
  const few = (r: EffRow) => (r.why === 'few' ? t('economy.effFew', { k: r.runs, min: cfg.efficiency.minTasks }) : '');
  const team =
    eff.team.perPoint !== null
      ? t('economy.effTeam', {
          k: fmt(Math.round(eff.team.points)),
          n: compact(eff.team.perPoint),
          p: Math.round(eff.team.leaderShare * 100),
        })
      : t('economy.effTeamNone');
  const ctx = s.mainCtx && t('economy.effCtx', { n: compact(s.mainCtx.tokens) });
  const effMeta = t('economy.effMeta', { n: cfg.efficiency.window });
  const efficient = table ? (
    <Table
      title={t('economy.eff')}
      head={[
        t('economy.member'),
        t('economy.job'),
        t('economy.perPoint'),
        t('economy.effRuns'),
        t('economy.effRank'),
        t('economy.effCauseHead'),
      ]}
      rows={eff.rows.map((r) => {
        const cause = topCause(r.m.receipt.parts);
        return [
          r.m.name,
          jobLabel(r.m.job),
          effValue(r),
          String(r.runs),
          r.rank ?? (few(r) || '—'),
          cause ? `${partLabel(cause.key)} ${pct(cause.share)}%` : '—',
        ];
      })}
    />
  ) : (
    <section className="ui-card ec-card">
      <div className="ec-cardhead">
        <h2 className="ec-h2">{t('economy.eff')}</h2>
        <span className="ec-meta">{effMeta}</span>
      </div>
      <p className="ec-meta">{[team, ctx].filter(Boolean).join(' · ')}</p>
      {eff.rows.length === 0 ? (
        <p className="ec-meta">{t('economy.effEmpty')}</p>
      ) : (
        <ol className="ec-bars">
          {eff.rows.map((r) => (
            <li key={r.m.id} className={`ec-erow${r.rank ? '' : ' ec-erow--out'}`} data-member={r.m.id}>
              <span className="ec-rank">{r.rank ?? '–'}</span>
              <span className="ec-who">
                <Face m={r.m} />
                <span className="ec-who__name">{r.m.name}</span>
                <span className="ec-job">{jobLabel(r.m.job)}</span>
              </span>
              <span className="ec-track" aria-hidden="true">
                {r.rank !== null && r.perPoint !== Infinity && (
                  <span className="ec-fill" style={{ width: `${(best / r.perPoint) * 100}%` }} />
                )}
              </span>
              <span className="ec-bnum">
                {effValue(r)}
                {few(r) && <span className="ec-meta">{few(r)}</span>}
              </span>
              {effSub(r) && <span className="ec-meta ec-esub">{effSub(r)}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const empty = rows.length === 0;

  // 기금 흐름 카드 (D21): 표로 보기에서도 같은 줄 (이미 글자라)
  const fundCard = (
    <section className="ui-card ec-card ec-fund">
      <div className="ec-cardhead">
        <h2 className="ec-h2">{t('economy.flow')}</h2>
        <span className="ec-meta">{since}</span>
      </div>
      <p className="ec-meta">{t('economy.fundHint')}</p>
      <div className="ec-frow">
        <span>{t('economy.flowIn')}</span>
        <FlowNum n={flow.tax} />
      </div>
      <div className="ec-frow">
        <span>{t('economy.flowLeader')}</span>
        <FlowNum n={-flow.leader} />
      </div>
      <div className="ec-frow">
        <span>{t('economy.flowWorks')}</span>
        <FlowNum n={-flow.works} />
      </div>
      <div className="ec-frow">
        <span>{t('economy.flowLeaderFurniture')}</span>
        <FlowNum n={-flow.furniture} />
      </div>
      {/* 돈이 아니라 기록 — 부호 없이, 흐리게 (06 문서 3.3) */}
      <div className="ec-frow ec-frow--sub">
        <span>{t('economy.flowUnpaid')}</span>
        <span className="ec-fnum">{fmt(flow.unpaid)}</span>
      </div>
      <div className="ec-frow ec-frow--total">
        <span>{t('economy.fundNow')}</span>
        <span className="ec-fnum">{fmt(s.economy.fund)}</span>
      </div>
      {s.economy.deficit && (
        <p className="ec-deficit" role="note">
          <span className="ec-hard">
            <Icon name="blocked" size={14} />
            {t('economy.deficit')}
          </span>
          <span className="ec-meta">{t('economy.deficitHint')}</span>
        </p>
      )}
    </section>
  );

  const balances = table ? (
    <Table
      title={t('economy.balances')}
      head={[t('economy.member'), t('economy.balance'), t('economy.state')]}
      rows={workers.map((m) => [m.name, fmt(m.balance), m.hardship ? t('economy.hardship') : t('economy.ok')])}
    />
  ) : (
    <section className="ui-card ec-card">
      <div className="ec-cardhead">
        <h2 className="ec-h2">{t('economy.balances')}</h2>
        <span className="ec-meta">{t('economy.balancesMeta', { currency: t('currency') })}</span>
      </div>
      <ul className="ec-bars">
        {workers.map((m) => (
          <li key={m.id} className="ec-brow" data-member={m.id}>
            <span className="ec-who">
              <Face m={m} />
              <span className="ec-who__name">{m.name}</span>
            </span>
            <span className="ec-track" aria-hidden="true">
              <span
                className="ec-fill"
                style={{
                  width: `${workers[0] && workers[0].balance > 0 ? (m.balance / workers[0].balance) * 100 : 0}%`,
                }}
              />
            </span>
            <span className="ec-bnum">
              {fmt(m.balance)}
              {m.hardship && <Hardship />}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className={`ec${loading ? ' ec--loading' : ''}`}>
      <div className="ec-head">
        <button type="button" className="ec-back" onClick={onBack}>
          {t('economy.village')}
        </button>
        <h1 className="ec-title">{t('economy.title')}</h1>
        <Toggle
          label={t('economy.range')}
          options={RANGES.map((r) => ({ value: r, label: t(`economy.ranges.${r}`) }))}
          value={range}
          onChange={setRange}
        />
        <span className="ec-meta">{t('economy.meta', { currency: t('currency') })}</span>
        {/* 날은 에이전트가 일한 시간으로만 간다 → 쉬는 동안 정산이 안 오는 까닭 (01 문서 6.2·8.7) */}
        <span className="ec-meta">
          {t('economy.nextDay', { n: Math.ceil((s.clock.dayStartMs + s.clock.dayMs - s.clock.activeMs) / 60_000) })}
        </span>
        <span className="ec-grow" />
        <Button size="m" className="ec-tablebtn" aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {t('economy.table')}
        </Button>
      </div>

      <section className="ec-tiles" aria-label={t('economy.tiles')}>
        <Tile
          label={t('economy.vaultLabel', { vault: t('vault') })}
          value={
            <>
              <Icon name="coin" size={24} title={t('currency')} />
              {fmt(vault)}
            </>
          }
          deco={
            <span className="ec-tile__deco" aria-hidden="true">
              <Prop kind="prop.chest" scale={0.55} />
            </span>
          }
        >
          {/* 퍼센트는 기준이 작거나 0이면 뜻이 없다 → 기간 동안 늘고 준 만큼. 다른 타일처럼 화살표 + 부호 없는 수 */}
          {first && <Delta diff={vault - vault0} text={`${fmt(Math.abs(vault - vault0))} · ${since}`} good />}
        </Tile>
        <Tile label={t('economy.weekIncome')} value={fmt(wk.income)}>
          {prev ? (
            <Delta
              diff={wk.income - prev.income}
              text={t('economy.vsLastWeek', { n: fmt(Math.abs(wk.income - prev.income)) })}
              good
            />
          ) : (
            <span className="ec-tile__delta ec-tone--flat">{t('economy.incomeParts')}</span>
          )}
        </Tile>
        <Tile label={t('economy.weekSpending')} value={fmt(wk.spending)}>
          {prev ? (
            <Delta
              diff={wk.spending - prev.spending}
              text={`${fmt(Math.abs(wk.spending - prev.spending))} · ${t('economy.spendingParts')}`}
              good={false}
            />
          ) : (
            <span className="ec-tile__delta ec-tone--flat">{t('economy.spendingParts')}</span>
          )}
        </Tile>
      </section>

      <div className="ec-body">
        <div className="ec-col">
          {fundCard}
          {empty ? (
            <section className="ui-card ec-card ec-empty" role="status">
              <h2 className="ec-h2">{t('economy.empty')}</h2>
              <p className="ec-meta">{t('economy.emptyHint')}</p>
            </section>
          ) : table ? (
            <Table
              title={t('economy.flowTable', { vault: t('vault') })}
              head={[t('economy.week'), t('economy.income'), t('economy.spending'), t('economy.net')]}
              rows={[...weeks]
                .reverse()
                .map((w) => [w.label, signed(w.income), signed(-w.spending), signed(w.income - w.spending)])}
            />
          ) : (
            <section className="ui-card ec-card">
              <div className="ec-cardhead">
                <h2 className="ec-h2">{t('economy.vaultFlow', { vault: t('vault') })}</h2>
                <span className="ec-meta">{t('economy.flowMeta')}</span>
                <span className="ec-grow" />
                <span className="ec-legend">
                  <span className="ec-key ec-key--1" aria-hidden="true" />
                  {t('economy.income')} ({t('economy.incomeParts')})
                </span>
                <span className="ec-legend">
                  <span className="ec-key ec-key--2" aria-hidden="true" />
                  {t('economy.spending')}
                </span>
              </div>
              <FlowChart
                weeks={weeks}
                fmt={fmt}
                label={`${t('economy.flowSummary', { n: weeks.length, inc: fmt(wk.income), exp: fmt(wk.spending) })} · ${t('economy.weekKeys')}`}
                tip={weekTip}
              />
            </section>
          )}
        </div>

        <div className="ec-col">
          {balances}
          {efficient}
        </div>
      </div>
    </div>
  );
}

// 앱 안 설명서 (M17, 06 문서 11장, D29): 목차 + 장. 글자는 이름 사전(guide 블록), 규칙 숫자는 cfg,
// 그림은 실제 에셋·캐릭터 컴포넌트 (스크린샷 없음 — 규칙·그림이 바뀌어도 설명서가 낡지 않게). 틀은 설정 화면(st-*)과 같다
import { useEffect, useRef, type ReactNode } from 'react';
import { ERAS, type GameConfig, type VillageState } from '@tycoon/core';
import { Building } from '../../assets/sea/Building';
import { t } from '../../i18n';
import { Icon } from '../../icons/Icon';
import { jobLook, toAccessory, toSpecies } from '../../live/sceneFromState';
import { Critter, critterName } from '../../render/Critter';
import type { Role } from '../../render/critterSvg';
import '../settings/settings.css';
import '../economy/economy.css';
import './guide.css';

export interface GuideScreenProps {
  state: VillageState;
  cfg: GameConfig;
  projectId: string;
  onBack: () => void;
  /** 주소의 장 id. '' = 맨 위 */
  section: string;
  /** 목차에서 장을 고르면 (주소가 바뀐다) */
  onSection: (id: string) => void;
}

/** 장 id (주소 `&guide=<id>`) — 순서 = 목차 (06 문서 11장) */
export const SECTIONS = [
  'start',
  'connect',
  'growth',
  'members',
  'economy',
  'efficiency',
  'news',
  'alerts',
  'settings',
  'privacy',
  'trouble',
] as const;
type Vars = Record<string, string | number>;

const fmt = (n: number) => n.toLocaleString('ko-KR');
const pct = (x: number) => Math.round(x * 100);
const ERA_ICON = { village: 'eraVillage', town: 'eraTown', city: 'eraCity', capital: 'eraCapital' } as const;
const WEATHER = ['storm', 'cloudy', 'rainbow', 'sunny', 'calm'] as const;
const EXAMPLE_CALLS = 15; // 급여 예시 = 보통 실행 (06 문서 3.4)

/** 본문 {자리}: 바다 이름은 이름 사전, 규칙 숫자는 cfg에서 */
function varsOf(cfg: GameConfig): Vars {
  const e = cfg.economy;
  const w = cfg.workplace.levels;
  const eff = cfg.efficiency;
  const sky = cfg.weather;
  const lv3 = w[2]?.level ?? 1;
  return {
    appName: t('ui.appName'),
    currency: t('currency'),
    vault: t('vault'),
    hall: t('owner.hall'),
    leaderHouse: t('owner.leaderHouse'),
    library: t('facilities.library'),
    plan: t('facilities.plan'),
    agency: t('facilities.agency'),
    ...Object.fromEntries(cfg.publicWorks.map((p) => [p.id, t(`works.${p.id}`)])),
    landmark2: t('works.landmark2'),
    palace: t('works.palace'),
    leaderSpecies: critterName(toSpecies(cfg.roster.leaderSpecies)),
    floor3: t('workplace.floor.3'),
    big: t('workplace.floor.4'),
    lv3,
    lvBig: w[w.length - 1]?.level ?? 1,
    maxLv: cfg.village.levels.length,
    waitMaterials: t('workplace.waiting.materials'),
    waitLevel: t('workplace.waiting.level', { n: lv3 }),
    wage: e.wagePerCall,
    qPass: e.quality.testsPassed,
    qNone: e.quality.noTests,
    qFail: e.quality.failed,
    exampleCalls: EXAMPLE_CALLS,
    example: fmt(Math.round(e.wagePerCall * EXAMPLE_CALLS * e.quality.noTests)),
    tax: pct(e.taxRate),
    perPearl: fmt(e.tokens.perPearl),
    reserve: pct(e.autoBuy.keepReserveRatio),
    saveFrom: pct(e.autoBuy.saveFromGauge),
    maxPerDay: e.autoBuy.maxPerDay,
    hardship: t('economy.hardship'),
    deficit: t('economy.deficit'),
    dayMin: Math.round(cfg.time.gameDayMs / 6000) / 10,
    window: eff.window,
    minRuns: eff.minTasks,
    alertRatio: eff.alert.ratio,
    alertMin: fmt(eff.alert.minTokens),
    ctxWarn: fmt(eff.leaderCtxWarn),
    failStreak: cfg.status.blockedOnToolFailureStreak,
    base: t('house.parts.base'),
    output: t('house.parts.output'),
    rebuild: t('house.parts.rebuild'),
    talk: t('house.parts.talk'),
    speech: t('settings.speech'),
    bubbles: t('settings.bubbles'),
    zoom: t('settings.zoom'),
    pokeWorking: t('poke.working'),
    pokeResting: t('poke.resting'),
    keep: t(cfg.collector.keepLastMessage ? 'guide.keepOn' : 'guide.keepOff'),
    weatherRuns: sky.recent,
    stormBlocked: sky.stormBlocked,
    stormFail: pct(sky.stormFailRatio),
    cloudyFail: pct(sky.cloudyFailRatio),
    rainbowWindow: sky.rainbowWindow,
    rainbowPassed: sky.rainbowPassed,
  };
}

const Fig = ({ cap, children }: { cap: ReactNode; children: ReactNode }) => (
  <figure className="gd-fig">
    {children}
    <figcaption>{cap}</figcaption>
  </figure>
);
const lv = (n: number) => t('workplace.lv', { n });

/** 본문의 "@이름" 자리 그림·표 */
const FIGS: Record<string, (cfg: GameConfig, v: Vars) => ReactNode> = {
  // 일터 1층 → 큰 건물 (06 문서 5.3·14.1): 첫 직업 프리셋 그림, 층 표는 cfg.workplace.levels
  floors: (cfg) => {
    const rows = cfg.workplace.levels;
    const preset = cfg.jobPresets[0] ?? cfg.fallbackPreset;
    const label = (i: number) => t(`workplace.floor.${i === rows.length - 1 ? 4 : i + 1}`);
    return (
      <>
        <div className="gd-figs">
          {rows.map((_, i) => (
            <Fig key={i} cap={label(i)}>
              <Building {...jobLook(preset, i + 1, i === rows.length - 1)} slot={1} scale={0.5} />
            </Fig>
          ))}
        </div>
        <table className="ec-table">
          <thead>
            <tr>
              {(['floor', 'points', 'cost', 'level'] as const).map((k) => (
                <th key={k}>{t(`guide.th.${k}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <th scope="row">{label(i)}</th>
                <td>{i === 0 ? t('guide.firstWork') : fmt(r.points)}</td>
                <td>{fmt(r.cost)}</td>
                <td>{r.level > 1 ? lv(r.level) : t('guide.none')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  },
  // 시대 4개 = 시대 아이콘 + 그 시대 시청 그림 (06 문서 6.3)
  eras: (cfg) => (
    <div className="gd-figs">
      {ERAS.map((e) => {
        const at = cfg.village.levels.flatMap((l, i) => (l.era === e ? [i + 1] : []));
        return (
          <Fig
            key={e}
            cap={
              <>
                <Icon name={ERA_ICON[e]} size={18} />
                {t(`eras.${e}`)} · {at.length > 1 ? `${lv(at[0] ?? 1)}~${at[at.length - 1] ?? 1}` : lv(at[0] ?? 1)}
              </>
            }
          >
            <Building body={`hall-${e}`} slot={1} scale={e === 'capital' ? 0.4 : 0.5} />
          </Fig>
        );
      })}
    </div>
  ),
  // 레벨 표 (06 문서 6.1): 여는 것 = 그 레벨이 필요한 일터 층 + 공공시설
  levels: (cfg) => {
    const floors = cfg.workplace.levels;
    return (
      <table className="ec-table">
        <thead>
          <tr>
            {(['lv', 'era', 'villagePoints', 'levelCost', 'opens'] as const).map((k) => (
              <th key={k}>{t(`guide.th.${k}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cfg.village.levels.map((r, i) => {
            const n = i + 1;
            const opens = [
              ...floors.flatMap((f, j) =>
                f.level === n && j > 0 ? [t(`workplace.floor.${j === floors.length - 1 ? 4 : j + 1}`)] : [],
              ),
              ...cfg.publicWorks.filter((p) => p.level === n).map((p) => t(`works.${p.id}`)),
            ];
            return (
              <tr key={n}>
                <th scope="row">{lv(n)}</th>
                <td>{t(`eras.${r.era}`)}</td>
                <td>{fmt(r.points)}</td>
                <td>{i === 0 ? t('guide.none') : fmt(r.cost)}</td>
                <td>{opens.join(' · ') || t('guide.none')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  },
  works: (cfg) => (
    <table className="ec-table">
      <thead>
        <tr>
          {(['work', 'price', 'opens'] as const).map((k) => (
            <th key={k}>{t(`guide.th.${k === 'opens' ? 'level' : k}`)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cfg.publicWorks.map((p) => (
          <tr key={p.id}>
            <th scope="row">{t(`works.${p.id}`)}</th>
            <td>{fmt(p.cost)}</td>
            <td>{lv(p.level)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
  // 팀장 · 도감 앞 팀원(직업 소품) · 외부인 3 · 자동 변형 (01 문서 3.1·3.2)
  critters: (cfg) => {
    const lead = cfg.jobPresets.find((p) => p.id === 'lead');
    const jobs = cfg.jobPresets.filter((p) => p !== lead);
    const first = toSpecies(cfg.roster.speciesCycle[0] ?? 'bear');
    return (
      <div className="gd-figs">
        <Fig cap={t('guide.leader')}>
          <Critter
            species={toSpecies(cfg.roster.leaderSpecies)}
            accessory={toAccessory(lead?.accessory ?? null)}
            scale={0.6}
            animate={false}
          />
        </Fig>
        {cfg.roster.speciesCycle.slice(0, jobs.length).map((sp, i) => {
          const job = jobs[i];
          return (
            <Fig key={sp} cap={job ? t(`jobs.${job.id}`) : ''}>
              <Critter
                species={toSpecies(sp)}
                accessory={toAccessory(job?.accessory ?? null)}
                scale={0.6}
                animate={false}
              />
            </Fig>
          );
        })}
        {Object.entries(cfg.visitors).map(([kind, v]) => (
          <Fig key={kind} cap={t('guide.visitor', { kind, place: t(`facilities.${v.facility}`) })}>
            <Critter species={toSpecies('visitor')} role={v.cap as Role} scale={0.6} animate={false} />
          </Fig>
        ))}
        {[1, 2].map((n) => (
          <Fig key={n} cap={t('guide.variant', { name: critterName(first, n), n: n + 1 })}>
            <Critter species={first} variant={n} scale={0.6} animate={false} />
          </Fig>
        ))}
      </div>
    );
  },
  pearl: (_, v) => (
    <div className="gd-figs gd-figs--row">
      <span className="gd-chip">
        <Icon name="coin" size={28} />
        {v.currency}
      </span>
      <span className="gd-chip">
        <Icon name="vault" size={28} />
        {v.vault}
      </span>
    </div>
  ),
  // 날씨 5개 (06 문서 10장): 조건 숫자는 cfg.weather
  weather: (_, v) => (
    <table className="ec-table">
      <thead>
        <tr>
          <th>{t('guide.th.weather')}</th>
          <th>{t('guide.th.when')}</th>
        </tr>
      </thead>
      <tbody>
        {WEATHER.map((k) => (
          <tr key={k}>
            <th scope="row">
              <span className="gd-chip">
                <Icon name={k} size={22} />
                {t(`weather.${k}`)}
              </span>
            </th>
            <td>{t(`guide.sky.${k}`, v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
};

/** 본문 한 줄씩: 문단 · "- " 목록 · "# " 소제목 · "$ " 명령·식 · "@" 그림 */
function Body({ text, cfg, v }: { text: string; cfg: GameConfig; v: Vars }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      out.push(
        <ul key={out.length}>
          {list.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    const k = out.length;
    if (line.startsWith('# ')) out.push(<h3 key={k}>{line.slice(2)}</h3>);
    else if (line.startsWith('$ '))
      out.push(
        <pre key={k} className="hg__code">
          {line.slice(2)}
        </pre>,
      );
    else if (line.startsWith('@'))
      out.push(
        <div key={k} className="gd-art">
          {FIGS[line.slice(1)]?.(cfg, v)}
        </div>,
      );
    else out.push(<p key={k}>{line}</p>);
  }
  flush();
  return <>{out}</>;
}

export function GuideScreen({ cfg, onBack, section, onSection }: GuideScreenProps) {
  const cur = SECTIONS.find((s) => s === section) ?? SECTIONS[0];
  const v = varsOf(cfg);
  const root = useRef<HTMLDivElement>(null);
  // 장을 바꾸면 맨 위부터 (긴 장을 내려 읽다 목차를 눌러도)
  useEffect(() => {
    if (root.current) root.current.scrollTop = 0;
  }, [cur]);

  return (
    <div className="st" ref={root}>
      <div className="st-head">
        <button type="button" className="st-back" onClick={onBack}>
          {t('guide.back')}
        </button>
        <h1 className="st-title">{t('guide.title')}</h1>
      </div>
      <div className="gd-cols">
        <nav className="ui-card gd-toc" aria-label={t('guide.toc')}>
          <ol>
            {SECTIONS.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  data-section={id}
                  aria-current={id === cur ? 'true' : undefined}
                  onClick={() => onSection(id)}
                >
                  {t(`guide.s.${id}.title`, v)}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <article className="ui-card st-card gd-body" data-section={cur} aria-labelledby="gd-title">
          <h2 id="gd-title">{t(`guide.s.${cur}.title`, v)}</h2>
          <Body text={t(`guide.s.${cur}.body`, v)} cfg={cfg} v={v} />
        </article>
      </div>
    </div>
  );
}

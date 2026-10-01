// 일터 상세 (06 문서 13장, 01 문서 8.5, 03 문서 5·6장, 캔버스 SeaScreenBuilding): 상단 바 아래 일터 장면 820 + 정보 패널 620 —
// 층·게이지·다음 층 조건(점수·자재비·레벨)·최근 일·쌓은 일, 이름 바꾸기.
// 상단 바는 밖에서 얹는다. 1초 시계(포즈)만 다시 그리고, 캐릭터 프레임은 Critter가 전역 틱으로 DOM을 고친다.
import {
  cleanBuildingName,
  runPoints,
  slotTone,
  type AgentRun,
  type Building as Workplace,
  type GameConfig,
  type VillageState,
} from '@tycoon/core';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import sea from '../../../../../design/theme-map.sea.json';
import { Prop } from '../../assets/sea/Asset';
import { t } from '../../i18n';
import { Icon } from '../../icons/Icon';
import { poseFor, workSite } from '../../live/movement';
import {
  activeSite,
  actorsFromState,
  ownerOf,
  siteStage,
  toAccessory,
  toSpecies,
  workplaceName,
} from '../../live/sceneFromState';
import { Critter } from '../../render/Critter';
import type { Role } from '../../render/critterSvg';
import { Button, Chip, VillageProgress } from '../../ui';
import { completeFxOn } from '../../world/constructionFx';
import { OwnedBuilding } from '../../world/Village';
import { renameBuilding } from './api';
import './building.css';

const S = 1.7; // 캔버스 SeaScreenBuilding 공사 장면 배율 (선 굵기는 에셋이 3/S로 보정)
// 현장 캐릭터 자리 (캔버스 좌표: 건물 svg 왼쪽 위 = 0,0). 앞 두 자리는 보드 그대로, 나머지는 부지 앞줄
const SPOTS = [
  [-16, 162],
  [51, 193],
  [118, 162],
  [-62, 186],
  [164, 190],
] as const;

/** 캔버스 좌표 → 장면 가운데(.bd-site) 기준 px. 건물 가운데(80)가 장면 가운데 */
const at = (x: number, y: number) => ({ left: (x - 80) * S, top: y * S });

const seaOf = (g: 'body' | 'roof', id: string) => (sea[g] as Record<string, string>)[id] ?? id;
// 점수·잔고는 내림: 문턱과 견주는 값이라 74.8을 "75 / 75"로 보이면 ✗와 어긋난다 (06 문서 5.4)
const fmt = (n: number) => Math.floor(n).toLocaleString('ko-KR');
const FLOORS = [1, 2, 3, 4] as const;

/** 프리셋 → 바다 건물 모양 + 종류 이름. 마을(sceneFromState workLook)과 같은 규칙: 2층부터 2층 몸통 */
export function look(cfg: GameConfig, presetId: string | undefined, floor: number) {
  const p = cfg.jobPresets.find((x) => x.id === presetId) ?? cfg.fallbackPreset;
  const body = floor >= 2 ? p.body2f : p.body1f;
  return { body: seaOf('body', body), roof: seaOf('roof', p.roof), sign: p.sign, type: t(`buildings.${p.building}`) };
}

function dur(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return t('building.sec', { n: sec });
  const m = Math.floor(sec / 60);
  return m < 60 ? t('building.min', { n: m }) : t('building.hour', { h: Math.floor(m / 60), m: m % 60 });
}
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toTimeString().slice(0, 5)}`;
};
/** 1초 시계 (경과 시간·예상·포즈). wakeAt이 앞에 있으면 그 순간에도 한 번 (반짝임이 1초 늦게 꺼지지 않게) */
function useNow(wakeAt: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const wait = wakeAt - Date.now();
    if (!(wait > 0 && wait < 2 ** 31)) return;
    const id = setTimeout(() => setNow(Date.now()), wait + 50); // 50: 타이머가 살짝 빨리 깨도 (LiveApp과 같음)
    return () => clearTimeout(id);
  }, [wakeAt]);
  return now;
}

/** 얼굴(슬롯 tint 원, 24). 팀원이 아니면 외부인 종류(복어, 모자 = 시설) */
export function Face({ s, cfg, id }: { s: VillageState; cfg: GameConfig; id: string }) {
  const m = s.members[id];
  const cap = (cfg.visitors as Record<string, { cap: string } | undefined>)[id]?.cap ?? 'general';
  return (
    <span
      className="bd-face"
      style={{ background: `var(--slot${m ? slotTone(m.slot) : 'x'}-tint)` }}
      aria-hidden="true"
    >
      {m ? (
        <Critter
          species={toSpecies(m.species)}
          variant={m.variant}
          accessory={toAccessory(m.accessory)}
          mode="face"
          scale={0.24}
          animate={false}
        />
      ) : (
        <Critter species={toSpecies('visitor')} role={cap as Role} mode="face" scale={0.24} animate={false} />
      )}
    </span>
  );
}

/** 얼굴 + 이름 */
function Who({ s, cfg, id }: { s: VillageState; cfg: GameConfig; id: string }) {
  return (
    <span className="bd-who">
      <Face s={s} cfg={cfg} id={id} />
      <span className="bd-who__name">{s.members[id]?.name ?? id}</span>
    </span>
  );
}

/** 이 일터에 쌓인 끝난 실행 (새 것부터): 주인의 실행 중 부지를 잡은 뒤 ~ 다음 일터를 잡기 전에 끝난 것 */
export function workplaceRuns(s: VillageState, b: Workplace): AgentRun[] {
  const next = Object.values(s.buildings).find((x) => x.memberId === b.memberId && x.n === b.n + 1);
  return Object.values(s.runs)
    .filter(
      (r) =>
        r.memberId === b.memberId &&
        r.endedAt !== null &&
        r.endedAt >= b.startedAt &&
        (!next || r.endedAt < next.startedAt),
    )
    .sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0));
}

/** 실행의 작업 제목: 짝지어진 작업(Agent 호출 대체), 없으면 그 실행이 기여한 작업(01 문서 5.3 기여), 없으면 undefined */
function runTitle(s: VillageState, r: AgentRun): string | undefined {
  const own = r.taskId ? s.tasks[r.taskId] : undefined;
  const mid = r.memberId;
  const k =
    own ??
    Object.values(s.tasks).find(
      (x) =>
        mid !== null &&
        (x.contributions[mid] ?? 0) > 0 &&
        (x.startedAt ?? x.createdAt) <= (r.endedAt ?? Infinity) &&
        (x.completedAt ?? Infinity) >= r.startedAt,
    );
  return k?.subject;
}

/** 층 스텝 (03 문서 5장 스텝 모양): 1층·2층·3층·큰 건물. 지난 층은 체크, 공사 중(0)이면 현재 칸 없음 */
export function FloorSteps({ floor }: { floor: number }) {
  return (
    <ol className="bd-steps" aria-label={t('workplace.floors')}>
      {FLOORS.map((f) => (
        <li
          key={f}
          className={`bd-step bd-step--${f < floor ? 'done' : f === floor ? 'cur' : 'todo'}`}
          aria-current={f === floor ? 'step' : undefined}
        >
          <span className="bd-step__dot">{f <= floor ? <Icon name="done" size={16} strokeWidth={3} /> : f}</span>
          <span className="bd-step__name">{t(`workplace.floor.${f}`)}</span>
        </li>
      ))}
    </ol>
  );
}

/** 다음 층 조건 (06 문서 5.4): 셋 다 맞으면 다음 급여·정산 때 오른다 */
function Next({ s, cfg, b }: { s: VillageState; cfg: GameConfig; b: Workplace }) {
  const next = b.floor > 0 ? cfg.workplace.levels[b.floor] : undefined;
  if (!next)
    return (
      <p className="bd-meta">
        {b.floor > 0 ? t('workplace.gaugeMax', { points: fmt(b.points) }) : t('workplace.firstWork')}
      </p>
    );
  const bal = s.members[b.memberId]?.balance ?? 0;
  const rows = [
    ['points', `${fmt(b.points)} / ${fmt(next.points)}`, b.points >= next.points],
    ['cost', `${fmt(bal)} / ${fmt(next.cost)}`, bal >= next.cost],
    ['level', `${t('workplace.lv', { n: s.level })} / ${t('workplace.lv', { n: next.level })}`, s.level >= next.level],
  ] as const;
  return (
    <ul className="bd-conds">
      {rows.map(([k, v, ok]) => (
        <li key={k} className="bd-cond" data-cond={k} data-ok={String(ok)}>
          <Icon name={ok ? 'done' : 'close'} size={12} title={t(ok ? 'workplace.met' : 'workplace.unmet')} />
          <span>{t(`workplace.cond.${k}`)}</span>
          <span className="bd-cond__val">{v}</span>
        </li>
      ))}
    </ul>
  );
}

/** 이름 + 바꾸기 (버튼 → 입력 → 저장/취소). 저장 결과는 SSE 스냅샷이 가져온다 */
function NameRow({
  name,
  projectId,
  buildingId,
  chip,
}: {
  name: string;
  projectId: string;
  buildingId: string;
  chip: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null); // null = 보기
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errId = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (draft !== null || !refocus.current) return;
    refocus.current = false;
    btn.current?.focus(); // 닫으면 포커스를 "이름 바꾸기"로 돌려준다
  }, [draft]);
  const close = () => {
    refocus.current = true;
    setDraft(null);
    setErr(null);
  };

  if (draft === null)
    return (
      <div className="bd-head">
        <h1 className="bd-name">{name}</h1>
        {chip}
        <span className="bd-grow" />
        <Button ref={btn} variant="quiet" size="m" onClick={() => setDraft(name)}>
          {t('building.rename')}
        </Button>
      </div>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = cleanBuildingName(draft);
    if (v === null) return setErr(t('building.nameRule'));
    if (v === name) return close();
    setBusy(true);
    try {
      await renameBuilding(projectId, buildingId, v);
      close();
    } catch (x) {
      setErr(t('building.saveFailed', { why: x instanceof Error ? x.message : String(x) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="bd-rename" onSubmit={(e) => void submit(e)}>
      <div className="bd-head">
        <input
          aria-label={t('building.nameLabel')}
          value={draft}
          autoFocus
          aria-invalid={err !== null}
          aria-describedby={err !== null ? errId : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
        />
        <Button type="submit" variant="primary" size="m" disabled={busy}>
          {t('building.save')}
        </Button>
        <Button variant="quiet" size="m" disabled={busy} onClick={close}>
          {t('building.cancel')}
        </Button>
      </div>
      {err !== null && (
        <p id={errId} role="alert" className="bd-error">
          {err}
        </p>
      )}
    </form>
  );
}

export interface BuildingScreenProps {
  state: VillageState;
  /** 수집기가 투영에 쓰는 설정 (SSE config) — 층 조건·반짝임이 프로젝터와 같은 수치로 */
  cfg: GameConfig;
  projectId: string;
  buildingId: string;
  /** 마을로 돌아가기 */
  onBack: () => void;
}

export function BuildingScreen({ state: s, cfg, projectId, buildingId, onBack }: BuildingScreenProps) {
  // 주소에서 온 id → own 키만 (?building=constructor가 Object.prototype을 집지 않게). 옛 작업 건물 id(b3)는 없다 → 안내 (06 문서 5.9)
  const b = Object.hasOwn(s.buildings, buildingId) ? s.buildings[buildingId] : undefined;
  const now = useNow((b?.floorAt ?? 0) + cfg.buildings.completeFxMs); // 조기 반환 전에 (훅 순서)
  const sh = `${useId().replace(/\W/g, '')}-sh`;
  if (!b)
    return (
      <div className="bd bd--missing" role="status">
        <p>{t('building.notFound')}</p>
        <Button onClick={onBack}>{t('building.back')}</Button>
      </div>
    );

  const m = s.members[b.memberId];
  const name = workplaceName(s, cfg, b);
  const shape = look(cfg, m?.job, b.floor);
  const working = !!m?.currentRunId;
  const big = b.floor >= cfg.workplace.levels.length;
  // 마을(sceneFromState workLook)과 같은 그림: 0층은 도구 전 예정 부지 → 기초, 1층부터 완공 + 주인이 일하면 비계·자재 더미
  const stage = b.floor > 0 ? 'done' : siteStage(s, b);
  const scaffold = working && b.floor > 0 && !big;
  const next = b.floor > 0 ? cfg.workplace.levels[b.floor] : undefined;
  const fx = completeFxOn(b.floorAt ?? undefined, now, cfg.buildings.completeFxMs); // 마을과 같은 창 (floorAt부터 3초)
  const runs = workplaceRuns(s, b);

  // 이 일터에서 일하는 캐릭터 (마을 targets와 같은 규칙: 주인은 자기 일터, 외부인·팀장은 지금 일하는 팀원의 일터)
  const site = activeSite(s);
  const crew = actorsFromState(s, cfg, now).filter(
    (a) => (a.status === 'working' || a.status === 'blocked') && workSite(s, a.id, site)?.id === b.id,
  );
  const placed = crew
    .map((a, i) => {
      const [x, y] = SPOTS[i % SPOTS.length] ?? SPOTS[0];
      return { a, i, x: x + Math.floor(i / SPOTS.length) * 12, y };
    })
    .sort((p, q) => p.y - q.y);

  const chip = (
    <Chip className="ui-chip--status">
      <span className="ui-chip__dot" style={{ background: b.floor > 0 ? 'var(--slot4)' : 'var(--st-working)' }}>
        <Icon name={b.floor > 0 ? 'complete' : 'working'} size={12} />
      </span>
      {t(`workplace.floor.${Math.min(b.floor, 4)}`)}
    </Chip>
  );
  const waiting = b.waiting && next && (
    <Chip className="bd-wait" data-waiting={b.waiting}>
      {b.waiting === 'materials' ? t('workplace.waiting.materials') : t('workplace.waiting.level', { n: next.level })}
    </Chip>
  );

  return (
    <div className="bd">
      <main className="bd-scene">
        <svg className="bd-rays" viewBox="0 0 820 832" preserveAspectRatio="none" aria-hidden="true">
          <path d="M120 -10L200 -10L80 842L-10 842Z" fillOpacity={0.18} />
          <path d="M560 -10L610 -10L500 842L440 842Z" fillOpacity={0.14} />
        </svg>
        <nav className="bd-crumb" aria-label={t('building.where')}>
          <button type="button" className="bd-crumb__link" onClick={onBack}>
            {t('building.village')}
          </button>
          <span className="bd-crumb__sep" aria-hidden="true">
            ›
          </span>
          <span className="bd-crumb__here">{name}</span>
        </nav>

        <div className="bd-site">
          <svg width={300 * S} height={170 * S} viewBox="-60 130 300 170" style={at(-60, 130)} aria-hidden="true">
            <defs>
              <radialGradient id={sh}>
                <stop offset="0" style={{ stopColor: 'var(--ink)', stopOpacity: 0.26 }} />
                <stop offset="0.6" style={{ stopColor: 'var(--ink)', stopOpacity: 0.15 }} />
                <stop offset="1" style={{ stopColor: 'var(--ink)', stopOpacity: 0 }} />
              </radialGradient>
            </defs>
            <g strokeWidth={3 / S} strokeLinejoin="round" style={{ stroke: 'var(--ink)' }}>
              <polygon points="-48,208 80,272 80,284 -48,220" style={{ fill: 'var(--basalt-l)' }} />
              <polygon points="80,272 208,208 208,220 80,284" style={{ fill: 'var(--basalt-r)' }} />
              <polygon points="80,144 208,208 80,272 -48,208" style={{ fill: 'var(--sand-top)' }} />
            </g>
            <path
              d="M0 204Q5 201 10 204M140 236Q145 233 150 236M150 190Q155 187 160 190"
              fill="none"
              strokeWidth={1.8 / S}
              strokeLinecap="round"
              style={{ stroke: 'var(--sand-l)' }}
            />
            <ellipse cx="88" cy="214" rx="60" ry="26" fill={`url(#${sh})`} />
          </svg>
          {(scaffold || stage === 'foundation') && (
            <div style={at(-64, 80)}>
              <Prop kind="prop.materials" scale={S} />
            </div>
          )}
          <div style={at(0, 0)} data-floor={b.floor}>
            <OwnedBuilding
              {...shape}
              slot={m ? slotTone(m.slot) : 'x'}
              stage={stage}
              scaffold={scaffold}
              fx={fx}
              scale={S}
              owner={m && b.floor > 0 ? ownerOf(m, m.name) : undefined}
            />
          </div>
          {placed.map(({ a, i, x, y }) => (
            <div key={a.id} style={at(x, y)} data-actor={a.id}>
              <Critter
                species={a.species}
                accessory={a.accessory}
                role={a.role}
                pose={poseFor(a, false, now, i)}
                scale={0.45 * S}
                phase={i}
              />
            </div>
          ))}
        </div>

        <section className="ui-card bd-stepcard">
          <FloorSteps floor={b.floor} />
        </section>
      </main>

      <aside className="bd-info" aria-label={t('building.info')}>
        <section className="ui-card bd-card">
          <NameRow key={b.id} name={name} projectId={projectId} buildingId={b.id} chip={chip} />
          <p className="bd-meta">{t('workplace.started', { at: when(b.startedAt), x: b.lot.x, y: b.lot.y })}</p>
          <div className="bd-owner">
            <span>{t('workplace.owner', { type: shape.type })}</span>
            <Who s={s} cfg={cfg} id={b.memberId} />
          </div>
          {b.floor > 0 && (
            <div className="bd-prog">
              {next && <VillageProgress done={b.points} total={next.points} label={t('workplace.gaugeLabel')} />}
              <span className="bd-count">
                {next
                  ? t('workplace.gauge', { points: fmt(b.points), next: fmt(next.points) })
                  : t('workplace.gaugeMax', { points: fmt(b.points) })}
              </span>
              {waiting}
            </div>
          )}
        </section>

        <section className="ui-card bd-card">
          <h2 className="bd-h2">{t('workplace.next')}</h2>
          <Next s={s} cfg={cfg} b={b} />
        </section>

        <section className="ui-card bd-card">
          <div className="bd-cardhead">
            <h2 className="bd-h2">{t('workplace.runs')}</h2>
            <span className="bd-meta">{t('workplace.runsHint')}</span>
          </div>
          {runs.length === 0 ? (
            <p className="bd-meta">{t('workplace.noRuns')}</p>
          ) : (
            <ul className="bd-tasks">
              {runs.slice(0, 8).map((r) => (
                <li key={r.runId} className="bd-task" data-run={r.runId}>
                  <span className="bd-task__subject">
                    {runTitle(s, r) ?? t('workplace.noTask', { type: r.agentType })}
                  </span>
                  <span className="bd-task__time">
                    {t('workplace.plus', { n: fmt(runPoints(r, cfg)) })} ·{' '}
                    {t('building.took', { d: dur((r.endedAt ?? r.startedAt) - r.startedAt) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ui-card bd-card">
          <h2 className="bd-h2">{t('workplace.contrib')}</h2>
          <p className="bd-meta" data-contrib="">
            {t('workplace.contribText', { runs: runs.length, points: fmt(b.points), paid: fmt(b.paid) })}
          </p>
        </section>

        <div className="bd-actions">
          <Button onClick={onBack}>{t('building.back')}</Button>
        </div>
      </aside>
    </div>
  );
}

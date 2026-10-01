// 집 상세 (01 문서 8.4, 03 문서 6장: 방 장면 1000 + 정보 패널 440, 캔버스 SeaScreenHouse). 상단 바는 밖에서 얹는다.
// 가구 옮기기는 화면 안 초안(draft)에서만 바뀌고 저장 때 PUT → 결과는 SSE 스냅샷이 가져온다.
import {
  AXES,
  canPlace,
  efficiency,
  findSpot,
  type GameConfig,
  type Member,
  type OwnedFurniture,
  type Placement,
  type VillageState,
  slotTone,
  tips,
} from '@tycoon/core';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { t } from '../../i18n';
import { Icon } from '../../icons/Icon';
import { toAccessory, toSpecies } from '../../live/sceneFromState';
import { Critter, critterName } from '../../render/Critter';
import { cellFromPoint, fabricSlot, RoomScene, type RoomItem } from '../../room/RoomScene';
import { Button, Chip, driftText, JobChip, MbtiChip, StatusChip } from '../../ui';
import { compact, effValue, modelLabel, partLabel, tipText } from '../economy/EconomyScreen';
import { saveMoves } from './api';
import './house.css';

const S = 1.6; // 캔버스 SeaScreenHouse 방 배율
const fmt = (n: number) => n.toLocaleString('ko-KR');
/** 지갑 줄 부호: 0이면 부호 없이 ("−0"이 아니게) */
const signed = (sign: '+' | '−', n: number) => (n ? `${sign}${fmt(n)}` : fmt(0));
const jobLabel = (job: string) => (t(`jobs.${job}`) === `jobs.${job}` ? job : t(`jobs.${job}`));
const STEP: Record<string, [number, number] | undefined> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

/** 지갑 (01 문서 8.4 화면 메모): 급여는 실행 단위 (D20, 06 문서 3.4) — 오늘 급여 = 마지막 정산 뒤 끝난 내 실행의 급여 합,
 *  최근 = 가장 새 실행 (세전). 이름 = 짝지어진 작업(Agent 호출 대체)이면 작업 이름, 아니면 에이전트 종류.
 *  오늘 자재비 = 오늘 층을 올리며 낸 일터 자재비 (core materialsToday, 06 문서 5.3) */
export function wallet(s: VillageState, m: Member) {
  const since = s.economy.history.at(-1)?.at ?? -Infinity;
  const pays = Object.values(s.runs)
    .flatMap((r) =>
      r.memberId === m.id && r.wage
        ? [{ at: r.endedAt ?? r.lastAt, task: (r.taskId && s.tasks[r.taskId]?.subject) || r.agentType, n: r.wage }]
        : [],
    )
    .sort((a, b) => a.at - b.at);
  return {
    today: pays.filter((p) => p.at > since).reduce((n, p) => n + p.n, 0),
    last: pays.at(-1) ?? null,
    bought: m.furniture.filter((f) => f.day === s.clock.day).reduce((n, f) => n + f.price, 0),
    materials: m.materialsToday,
  };
}

export interface HouseScreenProps {
  state: VillageState;
  /** 수집기가 투영에 쓰는 설정 (SSE config) — 가구 칸·효율 규칙이 서버와 같게 */
  cfg: GameConfig;
  projectId: string;
  memberId: string;
  /** 마을로 돌아가기 */
  onBack: () => void;
  /** 다른 화면으로 (가구 상점). 없으면 상점 버튼을 숨긴다 */
  onNavigate?: (to: { screen: 'shop' | 'house'; memberId: string }) => void;
}

type Drag = { id: string; dx: number; dy: number; at: Placement; ok: boolean };

export function HouseScreen({ state: s, cfg, projectId, memberId, onBack, onNavigate }: HouseScreenProps) {
  const [draft, setDraft] = useState<ReadonlyMap<string, Placement | null> | null>(null); // null = 보기 모드
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scene = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  // 모드를 바꾸면 누른 버튼이 사라진다 → 포커스가 body로 떨어지지 않게: 들어가면 첫 가구(없으면 첫 도구), 나오면 '가구 옮기기'
  const editing = draft !== null;
  const was = useRef(editing);
  useEffect(() => {
    if (was.current === editing) return;
    was.current = editing;
    const first = editing ? scene.current?.querySelector('button') : null;
    (first ?? [...(tools.current?.querySelectorAll('button') ?? [])].find((b) => !b.disabled))?.focus();
  }, [editing]);

  // 주소에서 온 id → own 키만 (BuildingScreen과 같음)
  const m0 = Object.hasOwn(s.members, memberId) ? s.members[memberId] : undefined;
  if (!m0)
    return (
      <div className="hs hs--missing" role="status">
        <p>{t('house.notFound')}</p>
        <Button onClick={onBack}>{t('house.back')}</Button>
      </div>
    );

  const owned: OwnedFurniture[] = m0.furniture.map((f) =>
    draft?.has(f.id) ? { ...f, placed: draft.get(f.id) ?? null } : f,
  );
  const m: Member = { ...m0, furniture: owned }; // canPlace·findSpot은 초안으로 본다
  const byId = (id: string | null) => owned.find((f) => f.id === id);
  // 효율 한 줄 (D12, 01 문서 6.6): 순위 = 경제 패널과 같은 계산. 입주 전이면 없음
  const eff = efficiency(s, cfg);
  const er = eff.rows.find((r) => r.m.id === m0.id);
  const effLine = m0.isLeader
    ? t('house.effLeader')
    : er &&
      [
        effValue(er),
        er.rank
          ? t('house.effRank', { rank: er.rank, total: eff.ranked })
          : er.why === 'few' && t('economy.effFew', { k: er.runs, min: cfg.efficiency.minTasks }),
      ]
        .filter(Boolean)
        .join(' · ');
  // 토큰 영수증 (D13, 01 문서 6.7-2·3): 큰 원인 5개 + 그 밖, 모델 비중, 줄이는 법
  const rc = m0.receipt;
  const sorted = Object.entries(rc.parts).sort((a, b) => b[1] - a[1]);
  const spent = sorted.reduce((a, [, x]) => a + x, 0);
  // 1% 아래는 그 밖으로 (SubagentHandback 같은 내부 도구가 줄을 차지하지 않게)
  const shown = sorted.slice(0, 5).filter(([, x]) => x >= spent / 100);
  const rest = sorted.slice(shown.length);
  const bars: [string, string, number][] = shown.map(([k, x]) => [k, partLabel(k), x]);
  if (rest.length)
    bars.push(['other', t('house.receiptOther', { n: rest.length }), rest.reduce((a, [, x]) => a + x, 0)]);
  const modelSum = Object.values(rc.models).reduce((a, x) => a + x, 0);
  const models = Object.entries(rc.models)
    .sort((a, b) => b[1] - a[1])
    .map(([k, x]) => `${modelLabel(k)} ${Math.round((x / modelSum) * 100)}%`)
    .join(', ');
  const ctx = m0.isLeader ? s.mainCtx : null;
  const advice = tips(s, m0).map(tipText);
  const spec = (kind: string) => cfg.furniture.find((f) => f.id === kind);
  const name = (kind: string) => t(`furniture.${kind}`);
  const items: RoomItem[] = owned.flatMap((f) => {
    const placed = drag?.id === f.id ? drag.at : f.placed;
    return placed ? [{ id: f.id, kind: f.kind, fabric: f.fabric, placed }] : [];
  });
  const selected = byId(sel);
  const mark = drag
    ? { kind: byId(drag.id)?.kind ?? '', placed: drag.at, ok: drag.ok }
    : editing && selected?.placed
      ? { kind: selected.kind, placed: selected.placed, ok: true }
      : null;

  const put = (id: string, p: Placement | null) => {
    setMsg(null);
    setDraft((d) => new Map(d).set(id, p));
  };
  /** 옮기기: 놓을 수 없으면 그대로 두고 까닭 한 줄 */
  const tryPut = (id: string, p: Placement | null) => {
    const f = byId(id);
    if (!f) return;
    if (p === null || canPlace(m, f.kind, p, cfg, id)) put(id, p);
    else setMsg(t('house.blocked'));
  };
  /** 돌리기는 2×1만 (01 문서 8.4) — 버튼 비활성과 같은 조건, R 키도 이 길 */
  const rotate = (id: string) => {
    const f = byId(id);
    if (f?.placed && spec(f.kind)?.tiles === '2x1') tryPut(id, { ...f.placed, rot: f.placed.rot ? 0 : 1 });
  };
  const place = (id: string) => {
    const f = byId(id);
    const p = f && findSpot(m, f.kind, cfg);
    if (!p) return setMsg(t('house.noSpot'));
    put(id, p);
    setSel(id);
  };
  const onItemKeyDown = (id: string, e: KeyboardEvent) => {
    const p = byId(id)?.placed;
    const d = STEP[e.key];
    if (!p) return;
    if (d) {
      e.preventDefault();
      setSel(id);
      tryPut(id, { ...p, x: p.x + d[0], y: p.y + d[1] });
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      rotate(id);
    } else if (e.key === 'Escape') setSel(null);
  };
  const onItemPointerDown = (id: string, e: PointerEvent) => {
    const p = byId(id)?.placed;
    const el = scene.current;
    if (!p || !el || e.button !== 0) return;
    e.preventDefault();
    const c = cellFromPoint(el, e.clientX, e.clientY, S);
    setSel(id);
    setMsg(null);
    setDrag({ id, dx: c.x - p.x, dy: c.y - p.y, at: p, ok: true }); // 잡은 칸 기준으로 따라감
    el.setPointerCapture?.(e.pointerId); // 장면 밖으로 끌어도 놓기(up)를 받게
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const f = byId(drag?.id ?? null);
    if (!drag || !f) return;
    const c = cellFromPoint(e.currentTarget, e.clientX, e.clientY, S);
    const at = { ...drag.at, x: c.x - drag.dx, y: c.y - drag.dy };
    if (at.x !== drag.at.x || at.y !== drag.at.y) setDrag({ ...drag, at, ok: canPlace(m, f.kind, at, cfg, f.id) });
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (drag.ok) put(drag.id, drag.at);
    else setMsg(t('house.blocked'));
    setDrag(null);
  };
  const stop = () => {
    setDraft(null);
    setSel(null);
    setDrag(null);
    setMsg(null);
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await saveMoves(projectId, m0, draft, cfg);
      stop();
    } catch (x) {
      setMsg(t('house.saveFailed', { why: x instanceof Error ? x.message : String(x) }));
    } finally {
      setBusy(false);
    }
  };

  const w = wallet(s, m0);
  const leader = m0.isLeader;
  const p = m0.personality;
  const [lo = 50, hi = 50] = cfg.personality.flipHysteresis; // 이 띠 안에서는 글자가 안 바뀜 (7장)
  const inRoom = owned.filter((f) => f.placed).length;
  const species = toSpecies(m0.species);
  const accessory = toAccessory(m0.accessory);

  return (
    <div className="hs">
      <main className="hs-scene">
        <nav className="hs-crumb" aria-label={t('house.where')}>
          <button type="button" className="hs-crumb__link" onClick={onBack}>
            {t('house.village')}
          </button>
          <span className="hs-crumb__sep" aria-hidden="true">
            ›
          </span>
          <span className="hs-crumb__here">{t('house.title', { name: m0.name })}</span>
        </nav>
        <div className="hs-tools" ref={tools}>
          {editing ? (
            <>
              <Button
                size="m"
                disabled={busy || !selected?.placed || spec(selected.kind)?.tiles !== '2x1'}
                onClick={() => sel && rotate(sel)}
              >
                {t('house.rotate')}
              </Button>
              <Button size="m" disabled={busy || !selected?.placed} onClick={() => sel && tryPut(sel, null)}>
                {t('house.toStorage')}
              </Button>
              <Button size="m" variant="quiet" disabled={busy} onClick={stop}>
                {t('house.cancel')}
              </Button>
              <Button size="m" variant="primary" disabled={busy} onClick={() => void save()}>
                {t('house.save')}
              </Button>
            </>
          ) : (
            <Button size="m" disabled={owned.length === 0} onClick={() => setDraft(new Map())}>
              <Icon name="move" size={18} />
              {t('house.move')}
            </Button>
          )}
        </div>

        {m0.movedInAt === null && <p className="hs-notyet ui-card">{t('house.notYet')}</p>}
        <RoomScene
          ref={scene}
          className="hs-room"
          cfg={cfg}
          items={items}
          scale={S}
          label={t('house.scene', { name: m0.name })}
          who={
            m0.status === 'resting' && !m0.departed && m0.movedInAt !== null
              ? { species, variant: m0.variant, accessory, pose: 'rest' }
              : null
          }
          mark={mark}
          edit={
            editing
              ? {
                  selected: sel,
                  name: (i) => t('house.item', { name: name(i.kind), x: i.placed.x, y: i.placed.y }),
                  onItemPointerDown,
                  onItemKeyDown,
                  onItemClick: setSel,
                }
              : null
          }
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        />

        <div className="hs-foot">
          {editing && <p className="hs-hint">{t('house.moveHint')}</p>}
          <p className="hs-msg" role="status">
            {msg}
          </p>
          <div className="hs-chips">
            <Chip>{t('house.placedCount', { n: owned.length, m: inRoom })}</Chip>
            <Chip>{t('house.builtIn')}</Chip>
          </div>
        </div>
      </main>

      <aside className="hs-info" aria-label={t('house.info')}>
        <section className="ui-card hs-card hs-profile">
          <span className="hs-face" style={{ background: `var(--slot${slotTone(m0.slot)}-tint)` }} aria-hidden="true">
            <Critter
              species={species}
              variant={m0.variant}
              accessory={accessory}
              mode="face"
              scale={1}
              animate={false}
            />
          </span>
          <div className="hs-profile__main">
            <div className="hs-names">
              <h1 className="hs-name">{m0.name}</h1>
              <JobChip slot={slotTone(m0.slot)}>{jobLabel(m0.job)}</JobChip>
              <MbtiChip letters={p.letters} drifting={p.drifting} />
            </div>
            <StatusChip status={m0.status} icon={<Icon name={m0.status} size={12} />} />
            <span className="hs-meta hs-animal">{critterName(species, m0.variant)}</span>
            <span className="hs-meta">{t('house.slot', { id: m0.id, n: m0.slot })}</span>
          </div>
        </section>

        <section className="ui-card hs-card hs-pers">
          <div className="hs-cardhead">
            <h2 className="hs-h2">
              {t('personality.title')}{' '}
              <span className="hs-mbti">
                {[...p.letters].map((c, i) => (
                  <span key={i} className={AXES[i] === p.drifting?.axis ? 'hs-drift' : undefined}>
                    {c}
                  </span>
                ))}
              </span>
            </h2>
            <span className="hs-meta">
              {p.samples.length
                ? t('personality.meta', { n: cfg.personality.window, d: cfg.personality.maxDriftPerDay })
                : t('personality.seed')}
            </span>
          </div>
          {AXES.map((axis) => {
            const [a = '', b = ''] = axis;
            const v = Math.round(p[axis]);
            const drift = p.drifting?.axis === axis ? driftText(p.letters, p.drifting) : null;
            const label = t('personality.axis', { a, b, va: 100 - v, vb: v });
            return (
              <div
                key={axis}
                className={`hs-ax${drift ? ' hs-ax--drift' : ''}`}
                data-axis={axis}
                role="img"
                aria-label={drift ? `${label} · ${drift}` : label}
              >
                <span aria-hidden="true">{a}</span>
                <span className="hs-ax__track" aria-hidden="true">
                  <span className="hs-ax__band" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
                  <span className="hs-ax__mid" />
                  <span className="hs-ax__mark" style={{ left: `${p[axis]}%` }} />
                </span>
                <span aria-hidden="true">{b}</span>
                {drift && (
                  <span className="hs-ax__drift" aria-hidden="true">
                    {drift}
                  </span>
                )}
              </div>
            );
          })}
          {p.reason && <p className="hs-reason">{p.reason}</p>}
        </section>

        <section className="ui-card hs-card">
          <div className="hs-cardhead">
            <h2 className="hs-h2">{t('house.wallet')}</h2>
            <span className="hs-balance">
              <Icon name="coin" size={20} title={t('currency')} />
              {fmt(leader ? s.economy.fund : m0.balance)}
            </span>
          </div>
          {/* 팀장 = 시장: 지갑 = 마을 기금, 세금으로 벌고 팀장 토큰값을 낸다 (D21, 06 문서 4장) */}
          {leader && <p className="hs-meta">{t('house.cityVault')}</p>}
          {(leader ? s.economy.deficit : m0.hardship) && (
            <p className="hs-hardship" role="note">
              <span className="hs-hardship__dot" aria-hidden="true">
                <Icon name="blocked" size={12} />
              </span>
              <span>
                <strong>{t(leader ? 'economy.deficit' : 'house.hardship')}</strong> ·{' '}
                {t(leader ? 'economy.deficitHint' : 'house.hardshipHint')}
              </span>
            </p>
          )}
          {leader ? (
            <div className="hs-row">
              <span>{t('house.taxToday')}</span>
              <span className="hs-num hs-num--in">{signed('+', s.economy.today.tax)}</span>
            </div>
          ) : (
            <>
              <div className="hs-row">
                <span>{t('house.todayPay')}</span>
                <span className="hs-num hs-num--in">{signed('+', w.today)}</span>
              </div>
              <p className="hs-meta">
                {w.last ? t('house.lastPay', { task: w.last.task, n: fmt(w.last.n) }) : t('house.noPay')}
              </p>
            </>
          )}
          <div className="hs-row">
            <span>{t('house.bought')}</span>
            <span className="hs-num hs-num--out">{signed('−', w.bought)}</span>
          </div>
          {/* 층이 오를 때 잔고에서 한 번 (06 문서 5.3). 팀장은 일터가 없다 */}
          {!leader && (
            <div className="hs-row">
              <span>{t('house.materials')}</span>
              <span className="hs-num hs-num--out">{signed('−', w.materials)}</span>
            </div>
          )}
          {/* 쓴 토큰만큼 낸다 (D11, 01 문서 6.2). 팀장 몫은 기금에서 */}
          <div className="hs-row">
            <span>{t(leader ? 'house.leaderTokens' : 'house.tokens')}</span>
            <span className="hs-num hs-num--out">
              {signed('−', leader ? s.economy.today.leaderTokens : m0.tokenCostToday)}
            </span>
          </div>
          <p className="hs-meta">
            {t('house.tokensHint', { n: compact(m0.tokens), per: compact(cfg.economy.tokens.perPearl) })}
          </p>
          {effLine && <p className="hs-meta">{effLine}</p>}
        </section>

        <section className="ui-card hs-card hs-receipt">
          <div className="hs-cardhead">
            <h2 className="hs-h2">{t('house.receipt')}</h2>
            {rc.runs > 0 && (
              <span className="hs-meta">
                {t(m0.isLeader ? 'house.receiptMetaLeader' : 'house.receiptMeta', { runs: rc.runs, calls: rc.calls })}
              </span>
            )}
          </div>
          {ctx && (
            <>
              <p className="hs-meta">{t('house.ctx', { n: compact(ctx.tokens), per: compact(ctx.perCall) })}</p>
              {ctx.tokens >= cfg.efficiency.leaderCtxWarn && (
                <p className="hs-meta hs-warn">{t('house.ctxWarn', { warn: compact(cfg.efficiency.leaderCtxWarn) })}</p>
              )}
            </>
          )}
          {spent <= 0 ? (
            <p className="hs-meta">{t('house.receiptNone')}</p>
          ) : (
            <>
              <ul className="hs-rc">
                {bars.map(([k, label, x]) => (
                  <li key={k} data-part={k}>
                    <span className="hs-rc__name">{label}</span>
                    <span className="hs-rc__track" aria-hidden="true">
                      <span className="hs-rc__fill" style={{ width: `${(x / spent) * 100}%` }} />
                    </span>
                    <span className="hs-rc__num">
                      {compact(Math.round(x))} · {Math.round((x / spent) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
              {models && <p className="hs-meta">{t('house.receiptModels', { list: models })}</p>}
              <h3 className="hs-h3">{t('house.tipsHead')}</h3>
              <ul className="hs-tips">
                {(advice.length ? advice : [t('house.noTips')]).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="ui-card hs-card">
          <div className="hs-cardhead">
            <h2 className="hs-h2">{t('house.furniture', { n: owned.length })}</h2>
            <span className="hs-meta">{t('house.inStorage', { n: owned.length - inRoom })}</span>
          </div>
          {owned.length === 0 ? (
            <p className="hs-meta">{t('house.none')}</p>
          ) : (
            <ul className="hs-list">
              {owned.map((f) => (
                <li key={f.id} className={`hs-fi${f.placed ? '' : ' hs-fi--stored'}`} data-fid={f.id}>
                  {f.fabric && (
                    <span
                      className="hs-swatch"
                      style={{ background: `var(--slot${fabricSlot(f.fabric)})` }}
                      title={t(`furniture.fabric.${f.fabric}`)}
                    />
                  )}
                  {name(f.kind)}
                  {!f.placed && <span className="hs-meta"> · {t('house.storage')}</span>}
                  {editing && !f.placed && !spec(f.kind)?.outdoor && (
                    <button type="button" className="hs-fi__place" onClick={() => place(f.id)}>
                      {t('house.place')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="hs-actions">
          {onNavigate && (
            <Button
              className="hs-grow"
              variant={editing ? 'secondary' : 'primary'}
              onClick={() => onNavigate({ screen: 'shop', memberId: m0.id })}
            >
              <Icon name="shop" size={18} />
              {t('house.shop')}
            </Button>
          )}
          <Button onClick={onBack}>{t('house.back')}</Button>
        </div>
      </aside>
    </div>
  );
}

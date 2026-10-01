// 팀원 패널 (01 문서 8.2, 03 문서 5장 팀원 카드·외부인 행, 캔버스 SeaTeamPanel). 폭 360
import { useEffect, useRef } from 'react';
import {
  currentWorkplace,
  defaultConfig,
  type GameConfig,
  type Member,
  type MemberStatus,
  type VillageState,
  slotTone,
} from '@tycoon/core';
import { Icon } from '../icons/Icon';
import { JobChip, MbtiChip, StatusChip } from '../ui';
import type { MemberView } from '../live/movement';
import { usePrefs } from '../live/prefs';
import { toAccessory, toSpecies, workplaceName } from '../live/sceneFromState';
import { Critter } from '../render/Critter';
import type { Role } from '../render/critterSvg';
import { t } from '../i18n';
import './screens.css';

const fmt = (n: number) => n.toLocaleString('ko-KR');
/** 사전에 없는 직업(사용자 프리셋)은 id 그대로 */
const jobLabel = (job: string) => (t(`jobs.${job}`) === `jobs.${job}` ? job : t(`jobs.${job}`));

/** 작업 줄: 지금 하는 작업 + 자기 일터·층 (회의 중이면 회의 안건 — 설정으로 끄면 '회의 중', 쉬면 대기).
 *  작업 없이 일해도 일터·층은 보인다 (일 점수는 실행 단위, 06 문서 5.2) */
function taskLine(
  s: VillageState,
  cfg: GameConfig,
  m: Member,
  status: MemberStatus,
  speech: boolean,
): { text: string; where?: string; idle?: boolean } {
  if (status === 'meeting') return { text: (speech && s.meeting?.preview) || t('status.meeting') };
  if (status === 'resting') return { text: t('team.idle'), idle: true };
  const task = m.currentTaskId ? s.tasks[m.currentTaskId] : undefined;
  const b = currentWorkplace(s, m.id);
  const where = b && `${workplaceName(s, cfg, b)} ${t(`workplace.floor.${Math.min(b.floor, 4)}`)}`;
  return task ? { text: task.subject, where } : { text: t('team.noTask'), where, idle: true };
}

/** 상태 줄 (SeaTeamPanel "작업 중 · 일터", SeaUI "막힘 · 테스트 실패", 물범 "휴식 · 바위 위"). 곳을 모르면 상태만 */
export function statusText(m: Member, status: MemberStatus, v?: MemberView) {
  if (v?.place === 'rock') return t('status.restOnRock');
  const detail = status === 'blocked' ? m.blocked && t(`status.why.${m.blocked}`) : v && t(`status.at.${v.place}`);
  return detail ? `${t(`status.${status}`)} · ${detail}` : t(`status.${status}`);
}

export interface TeamPanelProps {
  state: VillageState;
  selectedId?: string | null;
  onSelect?: (memberId: string) => void;
  /** 마을과 같은 시계로 본 상태·곳 (live/movement memberViews). 없으면 스냅샷의 상태만 */
  views?: ReadonlyMap<string, MemberView>;
  /** 수집기 설정 (SSE config) — 일터 종류 이름이 마을과 같은 직업 프리셋으로 */
  cfg?: GameConfig;
}

export function TeamPanel({ state: s, selectedId, onSelect, views, cfg = defaultConfig }: TeamPanelProps) {
  const { speech } = usePrefs(); // 회의 안건 글자 (01 문서 10장)
  // 캐릭터를 누르면 강조된 카드가 보이게 (패널이 넘칠 때). 이미 보이면 그대로
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedId)
      panel.current?.querySelector(`[data-member="${CSS.escape(selectedId)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);
  const members = Object.values(s.members).sort((a, b) => +a.departed - +b.departed || a.slot - b.slot);
  const active = members.filter((m) => !m.departed);
  const visitors = Object.values(s.visitors).sort((a, b) => a.startedAt - b.startedAt);
  return (
    <aside className="tp" aria-label={t('team.label')} ref={panel}>
      <div className="tp__head">
        <h2>
          {t('team.members')} <span className="tp__count">{active.length}</span>
        </h2>
        {/* md 팀원 수 + md 없이 일해서 들어온 수 (01 문서 3.1 D9) */}
        <span className="tp__meta">
          {t('team.agents', { n: active.filter((m) => !m.isLeader && m.fromMd).length })}
          {active.some((m) => !m.isLeader && !m.fromMd) &&
            ` · ${t('team.others', { n: active.filter((m) => !m.isLeader && !m.fromMd).length })}`}
        </span>
      </div>
      {members.map((m) => {
        const view = views?.get(m.id);
        const status = view?.status ?? m.status;
        const line = taskLine(s, cfg, m, status, speech);
        const selected = m.id === selectedId;
        const waiting = m.movedInAt === null; // 입주 전 (01 문서 3.3)
        return (
          <button
            key={m.id}
            type="button"
            className={`ui-card tp-card${selected ? ' ui-card--selected' : ''}${m.departed || waiting ? ' tp-card--departed' : ''}`}
            aria-pressed={selected}
            data-member={m.id}
            onClick={() => onSelect?.(m.id)}
          >
            <span className="tp-card__row">
              <span
                className="tp-face"
                style={{ background: `var(--slot${slotTone(m.slot)}-tint)` }}
                aria-hidden="true"
              >
                <Critter
                  species={toSpecies(m.species)}
                  variant={m.variant}
                  accessory={toAccessory(m.accessory)}
                  mode="face"
                  scale={0.5}
                  animate={false}
                />
              </span>
              <span className="tp-card__main">
                <span className="tp-card__names">
                  <span className="tp-card__name">{m.name}</span>
                  <JobChip slot={slotTone(m.slot)} sm>
                    {jobLabel(m.job)}
                  </JobChip>
                  <MbtiChip letters={m.personality.letters} drifting={m.personality.drifting} sm />
                </span>
                {m.departed || waiting ? (
                  <span className="tp__meta">{t(waiting ? 'team.notYet' : 'team.departed')}</span>
                ) : (
                  <StatusChip status={status} icon={<Icon name={status} size={12} />}>
                    {statusText(m, status, view)}
                  </StatusChip>
                )}
              </span>
              <span className="tp-card__bal">
                {/* 팀장 지갑 = 마을 기금 (D21) */}
                <Icon name="coin" size={18} title={t('currency')} />
                {fmt(m.isLeader ? s.economy.fund : m.balance)}
              </span>
            </span>
            {!m.departed && !waiting && (
              <span className={`tp-card__task${line.idle ? ' tp-card__task--idle' : ''}`}>
                <span className="tp-card__task-text">{line.text}</span>
                {line.where && <span className="tp__meta">{line.where}</span>}
              </span>
            )}
          </button>
        );
      })}
      <div className="tp__head tp__head--visitors">
        <h2>
          {t('team.visitors')} <span className="tp__count">{visitors.length}</span>
        </h2>
        <span className="tp__meta">{t('team.noHouse')}</span>
      </div>
      {visitors.map((v) => (
        <div key={v.runId} className="tp-visitor" data-visitor={v.runId}>
          <span className="tp-face tp-face--visitor" aria-hidden="true">
            <Critter
              species={toSpecies('visitor')}
              role={defaultConfig.visitors[v.kind].cap as Role}
              mode="face"
              scale={0.4}
              animate={false}
            />
          </span>
          <span className="tp-visitor__name">
            {v.kind} <span className="tp-visitor__fac">{t(`facilities.${v.facility}`)}</span>
          </span>
        </div>
      ))}
    </aside>
  );
}

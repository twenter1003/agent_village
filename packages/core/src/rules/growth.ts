// 마을이 자라는 순서 (01 문서 3.3, D8·D9): 빈 모래섬 → 첫 일에 광장·팀장 집 → 팀원은 처음 일할 때 입주(집) →
// 시설은 그 외부인이 처음 올 때. 한 번 생긴 것은 사라지지 않는다. applyRuns보다 먼저 돈다 (새 팀원을 먼저 만들어야 실행이 팀원에 붙음)
import type { GameConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import { findLot, type Lot, type Zone } from '../layout/lots';
import { LEADER_ID, type Facility, type Member, type VillageState, type VisitorKind } from '../projector/types';
import { configure, join } from './roster';

/** 이미 잡힌 부지 (집·시설·일터·시청·공원·랜드마크) */
export const occupiedLots = (s: VillageState): Lot[] => [
  ...Object.values(s.houses).map((h) => h.lot),
  ...Object.values(s.facilities),
  ...Object.values(s.buildings).map((b) => b.lot),
  ...(s.hall ? [s.hall] : []),
  ...s.publicWorks.flatMap((w) => (w.lot ? [w.lot] : [])),
];

/** 부지 잡기: 구역들을 차례로 보고, 다 차면 섬을 넓혀(ring + 1) 다시 (D10, 02 문서 8.1). maxRing까지 없으면 null */
export function placeLot(s: VillageState, zones: Zone[], cfg: GameConfig, size: 2 | 3 = 2): Lot | null {
  for (;;) {
    const occupied = occupiedLots(s);
    for (const z of zones) {
      const lot = findLot(z, occupied, s.ring, size);
      if (lot) return lot;
    }
    if (s.ring >= cfg.layout.maxRing) return null;
    s.ring++;
  }
}

/** 입주: 집을 짓는다 (입주 지원금 없음, D20). 서쪽 구역에 자리가 없으면 집 없이 (활동 기록 한 줄) */
function moveIn(s: VillageState, m: Member, at: number, cfg: GameConfig, quiet = false) {
  if (m.movedInAt !== null) return;
  m.movedInAt = at;
  if (s.houses[m.id]) return;
  const lot = placeLot(s, ['west'], cfg);
  if (!lot) {
    s.feed.push({ at, kind: 'task', text: `집 지을 자리가 없음: ${m.name}`, ref: m.id });
    return;
  }
  s.houses[m.id] = { memberId: m.id, lot };
  if (!quiet) s.feed.push({ at, kind: 'task', text: `${m.name} 입주 · 집을 지었어요`, ref: m.id });
}

/** 규칙 테스트·개발 데모용: 마을을 세우고 떠나지 않은 팀원을 슬롯 순으로 모두 입주시킨다 (활동 기록 없이). 같은 상태를 돌려준다 */
export function moveInAll(s: VillageState, at: number, cfg: GameConfig): VillageState {
  s.foundedAt ??= at;
  for (const m of Object.values(s.members).sort((a, b) => a.slot - b.slot))
    if (!m.departed) moveIn(s, m, at, cfg, true);
  return s;
}

/** 마을 세우기: 광장·길 + 시청 + 팀장 입주 (첫 일) */
function found(s: VillageState, at: number, cfg: GameConfig) {
  if (s.foundedAt !== null) return;
  s.foundedAt = at;
  s.feed.push({ at, kind: 'task', text: '마을을 세웠어요 · 광장과 시청이 생겼어요' });
  s.hall = placeLot(s, ['north'], cfg, 3); // 시청 (06 문서 6.3): 광장 북쪽 가까이, 해저 궁전(3×3)까지 그 자리
  const leader = s.members[LEADER_ID];
  if (leader) moveIn(s, leader, at, cfg);
}

export function applyGrowth(s: VillageState, e: DomainEvent, cfg: GameConfig): void {
  const work =
    e.t === 'PromptSubmitted' ||
    e.t === 'AgentRunStarted' ||
    e.t === 'TaskCreated' ||
    e.t === 'AgentCalled' ||
    (e.t === 'ToolUsed' && e.runId === null); // 메인 세션 도구 호출 (프롬프트를 못 봤어도)
  if (!work) return;
  found(s, e.at, cfg);
  if (e.t !== 'AgentRunStarted' || s.runs[e.runId]?.endedAt === null) return; // 중복 시작은 applyRuns가 버린다
  const type = e.agentType;
  if (Object.hasOwn(cfg.visitors, type) || !type) {
    // 기본 에이전트 = 외부인. 그 시설이 처음이면 짓는다 (이름 없는 실행은 applyRuns가 인력사무소 외부인으로)
    const f = (cfg.visitors[(type || 'general-purpose') as VisitorKind]?.facility ?? 'agency') as Facility;
    if (s.facilities[f]) return;
    const lot = placeLot(s, ['north'], cfg);
    if (lot) s.facilities[f] = lot;
    return;
  }
  // 팀원: md에 없으면 이 자리에서 등록 (01 문서 3.1, D9). 떠난 팀원이 다시 일하면 돌아온다
  let m: Member | null | undefined = s.members[type];
  if (m?.isLeader) return;
  if (!m) {
    m = join(s, type, cfg);
    if (!m) return; // 자리(maxSlots)가 없으면 applyRuns가 외부인으로
    configure(s, cfg);
  }
  if (m.departed) {
    m.departed = false;
    m.fromMd = false; // md 없이 일하는 팀원이 됐다 → 다음 roster가 다시 떠남으로 돌리지 않는다
  }
  moveIn(s, m, e.at, cfg);
}

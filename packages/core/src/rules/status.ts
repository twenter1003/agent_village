import type { GameConfig } from '../config/config';
import type { VillageState } from '../projector/types';

/** 모든 팀원의 status를 at 시각 기준으로 다시 계산 (01 문서 4장). 우선순위: 막힘 > 회의 > 작업 > 휴식.
 *  팀장(메인 세션)은 메인 턴 동안 작업 중 — 마지막 훅 이벤트 뒤 activeGapCapMs까지 (버려진 턴이 영원히 일하지 않게) */
export function deriveStatus(s: VillageState, at: number, cfg: GameConfig): void {
  const mt = s.meeting && at < s.meeting.until ? s.meeting : null;
  const mainWorking = s.clock.mainTurn && at - s.clock.lastEventAt < cfg.time.activeGapCapMs;
  for (const m of Object.values(s.members))
    m.status = m.blocked
      ? 'blocked'
      : mt?.participants.includes(m.id)
        ? 'meeting'
        : m.currentRunId || (m.isLeader && mainWorking)
          ? 'working'
          : 'resting';
}

// 광장 회의 (01 문서 4.1, 결정 D3). applyRuns 다음에 돈다 → 이번 실행이 s.runs에 이미 있다
import type { GameConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import { nextId } from '../projector/project';
import type { Meeting, VillageState } from '../projector/types';

/** 회의 시작: 활동 기록 '회의' + 직접 닫는 토스트 (01 문서 9장) */
function open(s: VillageState, m: Meeting) {
  s.meeting = m;
  // 킥오프는 안건(프롬프트)이 없어 까닭을 적는다 (01 문서 9장)
  const text = `광장 회의 시작 · ${m.kind === 'kickoff' ? '병렬 작업 킥오프' : m.preview}`;
  s.feed.push({ at: m.startedAt, kind: 'meeting', text });
  s.toasts.push({ id: nextId(s, 'toast'), at: m.startedAt, kind: 'meeting', text, sticky: true });
}

export function applyMeeting(s: VillageState, e: DomainEvent, cfg: GameConfig): void {
  const c = cfg.meetings;
  if (s.meeting && e.at >= s.meeting.until) s.meeting = null;
  switch (e.t) {
    case 'PromptSubmitted':
      // 팀장과 쉬고 있는(실행 없는) 팀원이 모인다. 앱이 넣은 메시지(서브에이전트 보고 등)는 회의가 아니다 (4.1)
      if (c.onUserPrompt && !e.injected)
        open(s, {
          kind: 'prompt',
          startedAt: e.at,
          until: e.at + c.maxMs,
          preview: e.preview || '…',
          participants: Object.values(s.members)
            .filter((m) => !m.departed && m.movedInAt !== null && m.currentRunId === null) // 입주 전은 마을에 없다
            .map((m) => m.id),
        });
      return;
    case 'AgentRunStarted': {
      if (s.meeting?.kind === 'prompt') s.meeting = null; // 첫 서브에이전트 시작 → 흩어짐
      if (!s.runs[e.runId]?.memberId) return;
      // 킥오프: kickoffWindowMs 안에 시작해 아직 도는(병렬) 팀원이 kickoffWhenParallel명 이상. 이미 킥오프 중이면 기존 참가자 유지
      const ids = new Set(s.meeting?.kind === 'kickoff' ? s.meeting.participants : []);
      for (const r of Object.values(s.runs))
        if (r.memberId && r.endedAt === null && e.at - r.startedAt <= c.kickoffWindowMs) ids.add(r.memberId);
      if (ids.size < c.kickoffWhenParallel) return;
      const m: Meeting = {
        kind: 'kickoff',
        startedAt: e.at,
        until: e.at + c.kickoffMs,
        preview: '…',
        participants: [...ids],
      };
      // 킥오프 중에 늦게 온 팀원은 합류만, 알림은 다시 내지 않는다
      if (s.meeting?.kind === 'kickoff') s.meeting = { ...m, startedAt: s.meeting.startedAt };
      else open(s, m);
      return;
    }
    case 'MainTurnEnded':
      if (s.meeting?.kind === 'prompt') s.meeting = null;
      return;
    default:
      return;
  }
}

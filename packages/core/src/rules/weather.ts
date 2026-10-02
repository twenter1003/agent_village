// 날씨 = 팀 상태 (M19, 06 문서 10장, D28). 상태에서 계산하는 순수 함수 — 상태에 저장하지 않는다
import type { GameConfig } from '../config/config';
import { activeUntil } from '../projector/project';
import type { AgentRun, VillageState } from '../projector/types';

/** 정본 id (바다 이름은 theme-map labels.weather). 위에서부터 먼저 */
export type WeatherKind = 'storm' | 'cloudy' | 'rainbow' | 'sunny' | 'calm';

export interface Weather {
  kind: WeatherKind;
  /** 본 실행 수 (최근 끝난 실행, 최대 cfg.weather.recent) */
  runs: number;
  /** 그중 실패한 실행 (runFailed) */
  failures: number;
  /** 지금 막힌 팀원 수 */
  blocked: number;
  /** 최근 cfg.weather.rainbowWindow개 중 테스트가 통과한 실행 */
  passed: number;
}

/** 날씨의 실패한 실행: ok === false, 또는 테스트가 실패만 하고 통과 없이 끝남.
 *  Claude Code SubagentStop은 성공 여부를 알려 주지 않아 ok가 늘 true다 (events/normalize) — 테스트 결과로 본다 */
export const runFailed = (r: AgentRun) => r.ok === false || (r.testsFailed > 0 && r.testsPassed === 0);

const last = <T>(xs: T[], n: number) => xs.slice(Math.max(0, xs.length - n)); // slice(-0)은 전부라 쓰지 않는다

/** 끝난 실행 목록(오래된 것 → 최근)과 막힌 팀원 수, 일하는 중인지로 날씨. 신문(그날 실행만)도 이것을 쓴다.
 *  안 끝난 실행은 빼고 endedAt 순(같으면 runId)으로 다시 세운다 — 순서가 섞인 목록을 넘겨도 같다 */
export function weatherFrom(runs: AgentRun[], blocked: number, active: boolean, cfg: GameConfig): Weather {
  const w = cfg.weather;
  const ended = runs
    .filter((r) => r.endedAt !== null)
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0) || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  const recent = last(ended, w.recent);
  const failures = recent.filter(runFailed).length;
  const ratio = recent.length ? failures / recent.length : 0;
  const window = last(ended, w.rainbowWindow);
  const passed = window.filter((r) => r.testsPassed > 0).length;
  const kind: WeatherKind = !active
    ? 'calm'
    : blocked >= w.stormBlocked || ratio >= w.stormFailRatio
      ? 'storm'
      : blocked > 0 || ratio >= w.cloudyFailRatio
        ? 'cloudy'
        : passed >= w.rainbowPassed && !window.some(runFailed)
          ? 'rainbow'
          : 'sunny';
  return { kind, runs: recent.length, failures, blocked, passed };
}

/** 지금 마을의 날씨: 최근 끝난 실행(팀원·외부인) + 지금 막힌 팀원(팀장 포함 — 상태 규칙의 막힘과 같다) + 일하는 중.
 *  일하는 중 = 메인 턴 또는 진행 중 실행이 마지막 훅 이벤트 뒤 activeGapCapMs 안 (활동 시간과 같은 상한, 01 문서 6.2) —
 *  끝 이벤트를 잃은 실행이 날씨를 영영 '일하는 중'으로 두지 않게 */
export function weatherOf(s: VillageState, cfg: GameConfig): Weather {
  const blocked = Object.values(s.members).filter((m) => m.blocked !== null).length;
  return weatherFrom(Object.values(s.runs), blocked, s.clock.now < activeUntil(s, cfg), cfg);
}

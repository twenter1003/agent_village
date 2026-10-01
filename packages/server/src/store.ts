// 마을별 상태를 메모리에 둔다. 모든 변화는 raw_events에 먼저 기록하고 같은 길(apply)로 투영 → 재생 = 실시간 (02 문서 1장, 6.1)
import { createHash } from 'node:crypto';
import {
  activeUntil,
  dedupeKey,
  defaultConfig,
  initialState,
  makeConfig,
  normalize,
  project,
  summarize,
  type DayRecord,
  type GameConfig,
  type Raw,
  type TycoonConfig,
  type VillageState,
} from '@tycoon/core';
import { openDb } from './db';
import { readRoster } from './roster';
import { settingsPath } from './settings';
import { readTokens } from './tokens';

/** 상태에 남기는 경제 기록 날 수 (M̄ 7일·30일 보기 + 여유). 더 옛날 것은 Village.days로 옮긴다 —
 *  상태는 이벤트마다 통째로 복제·SSE로 나가서, 1시간 = 하루면 1년에 8760개가 매번 2MB가 된다 (02 문서 9장) */
export const HISTORY_KEEP = 60;
/** 일하는 마을에 시계 줄('clock' → Tick)을 넣는 간격 (01 문서 6.2 활동 시간). e2e는 TYCOON_CLOCK_MS + overrides.time.gameDayMs로 짧게 */
export const CLOCK_MS = Number(process.env.TYCOON_CLOCK_MS) || 10_000;

export interface Village {
  id: string;
  cwd: string;
  state: VillageState;
  cfg: GameConfig;
  lastAt: number;
  roster: string; // 마지막 roster 내용 (바뀔 때만 새로 기록)
  /** 상태에서 옮긴 옛 경제 기록 (HISTORY_KEEP보다 앞). 메모리에만 — 재생이 다시 만든다. /economy?range=all이 앞에 붙인다 */
  days: DayRecord[];
}

/** Claude 프로젝트 폴더 이름처럼: '/work/my-shop-app' → '-work-my-shop-app'.
 *  영문 밖 글자(한글 폴더)는 다 '-'가 돼 겹치니 해시를 붙인다 (01 문서 3장: 폴더 하나 = 마을 하나) */
export const projectId = (cwd: string) =>
  cwd.replace(/[^a-zA-Z0-9]/g, '-') +
  (/\P{ASCII}/u.test(cwd) ? `-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}` : '');
const rosterKey = (p: Raw) => JSON.stringify([p.agents, p.tycoon]);

export function createStore(dbPath: string, onChange: (v: Village) => void) {
  const db = openDb(dbPath);
  const villages = new Map<string, Village>();
  const sessions = new Map<string, string>(); // session_id → 마을. 세션 중 cd 해도 같은 마을에 남는다

  /** 저장된 요약 한 줄 → 상태. 실시간과 재생이 이 함수 하나를 쓴다 */
  function apply(id: string, p: Raw) {
    const at = Date.parse(String(p._t));
    let v = villages.get(id);
    if (!v) {
      // 새 마을의 첫 줄은 늘 roster(ingest가 먼저 기록) → 그 설정으로 시작값(하루 길이)을 심는다. core replay와 같게
      const cfg = makeConfig(p.hook_event_name === 'roster' ? (p.tycoon as TycoonConfig | undefined) : undefined);
      v = {
        id,
        cwd: String(p.cwd ?? ''),
        state: initialState(id, cfg),
        cfg,
        lastAt: at,
        roster: '',
        days: [],
      };
      villages.set(id, v);
    }
    v.lastAt = Math.max(v.lastAt, at);
    if (p.hook_event_name === 'roster') {
      v.cfg = makeConfig((p.tycoon ?? undefined) as TycoonConfig | undefined);
      v.roster = rosterKey(p);
    }
    for (const e of normalize(p))
      try {
        v.state = project(v.state, e, v.cfg);
      } catch (err) {
        console.error('[collector] project', e.t, err); // 규칙 하나가 터져도 수집은 계속
      }
    const h = v.state.economy.history;
    if (h.length > HISTORY_KEEP) v.days = v.days.concat(h.splice(0, h.length - HISTORY_KEEP));
    return v;
  }

  /** dedupe=false: 중복을 보지 않는다 (수집기가 찍은 시각밖에 없는 훅, 바뀔 때만 쓰는 roster·clock) */
  function record(id: string, p: Raw, dedupe: boolean) {
    if (db.insert(id, p, dedupe ? `${id}|${dedupeKey(p)}` : null)) onChange(apply(id, p));
  }

  /** 팀원 목록(프로젝트 .claude/agents + 마을 설정, D14)을 읽어 바뀌었을 때만 roster 줄로 */
  function reroster(id: string, cwd: string, _t: string) {
    const roster: Raw = { _t, hook_event_name: 'roster', cwd, ...readRoster(cwd, settingsPath(dbPath, id)) };
    if (rosterKey(roster) !== villages.get(id)?.roster) record(id, roster, false);
  }

  return {
    villages,

    /** 훅 원문 한 건: 요약 → 저장 → 투영. SessionStart거나 처음 보는 마을이면 팀원 목록도 읽는다 */
    ingest(raw: Raw) {
      // roster·clock·ui는 수집기만 만든다. 밖에서 오면 받지 않는다 (요약이 roster 필드를 버려 팀원이 전부 '떠남', ui는 위조)
      if (raw.hook_event_name === 'roster' || raw.hook_event_name === 'clock' || raw.hook_event_name === 'ui') return;
      // 실제 훅 본문엔 시각이 없어 받은 시각을 찍는다. 이 시각은 중복 판단에 쓰지 않는다 (같은 ms의 다른 훅을 버리게 됨)
      const stamped = typeof raw._t !== 'string' || Number.isNaN(Date.parse(raw._t));
      if (stamped) raw._t = new Date().toISOString();
      const cwd = typeof raw.cwd === 'string' ? raw.cwd : '';
      if (!cwd) return; // 마을을 정할 수 없음
      const sid = typeof raw.session_id === 'string' ? raw.session_id : '';
      const id = sessions.get(sid) ?? projectId(cwd);
      if (sid) sessions.set(sid, id);
      // 수집기가 세션 중간에 켜져 SessionStart를 못 봤어도 팀원이 있게, 이벤트보다 먼저 (01 문서 3.1)
      // 프롬프트마다도 다시 읽는다 — 세션 도중에 에이전트를 추가해도 다음 프롬프트에 목록에 오른다 (바뀔 때만 기록)
      const h = raw.hook_event_name;
      if (h === 'SessionStart' || h === 'UserPromptSubmit' || !villages.get(id)?.roster)
        reroster(id, cwd, String(raw._t));
      // 토큰 사용량 (D11): 서브에이전트·메인 턴이 끝날 때 기록 파일에서 숫자만 (못 읽으면 없음)
      Reflect.deleteProperty(raw, 'tokens'); // 밖에서 보낸 값은 믿지 않는다 (비용 조작)
      Reflect.deleteProperty(raw, 'usage');
      const read = readTokens(raw);
      if (read) Object.assign(raw, read); // tokens + usage (영수증 재료, D13)
      const p = summarize(raw, (villages.get(id)?.cfg ?? defaultConfig).collector);
      record(id, p, !stamped || typeof p.tool_use_id === 'string');
    },

    /** raw_events를 seq 순서로 처음부터 재생. only가 있으면 그 마을만 */
    rebuild(only?: string) {
      if (only) villages.delete(only);
      else villages.clear();
      for (const r of db.rows(only)) {
        if (r.session_id) sessions.set(r.session_id, r.project);
        apply(r.project, JSON.parse(r.payload) as Raw);
      }
    },

    /** 게임 시계: 일하는 마을에만 'clock' 줄(→ Tick, 시간만 흐름)을 기록하고 투영 → 도구 호출 없는 긴 실행 중에도 날이 제때
     *  넘어간다. 날은 프로젝터가 활동 시간으로 정한다 (01 문서 6.2). activeUntil이 지난 마을은 더 넣어도 시간이 안 늘어 멈춘다 */
    tick(now = Date.now()) {
      for (const v of villages.values())
        if (now < activeUntil(v.state, v.cfg))
          record(v.id, { _t: new Date(now).toISOString(), hook_event_name: 'clock', cwd: v.cwd }, false);
    },

    /** 설정 화면이 tycoon.json을 쓴 뒤 (01 문서 10장): 팀원 목록을 다시 읽어 roster 줄 → 재생해도 같다 */
    reroster(id: string) {
      const v = villages.get(id);
      if (v) reroster(id, v.cwd, new Date().toISOString());
    },

    /** 사용자 행동(이름 바꾸기·가구 사기·옮기기)을 'ui' 줄로 먼저 기록하고 같은 길로 투영 → 재생해도 남는다 (02 문서 9장) */
    ui(id: string, body: Raw) {
      const v = villages.get(id);
      if (v) record(id, { ...body, _t: new Date().toISOString(), hook_event_name: 'ui', cwd: v.cwd }, false);
    },

    close: () => db.close(),
  };
}

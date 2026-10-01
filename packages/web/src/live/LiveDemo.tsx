// /dev/village?live=stress | ?live=build | ?live=capital | ?live=<projectId> — 실시간 마을 확인. stress = 팀원 20명이 4초마다 상태를 바꿔 걸어 다님 (02 문서 8.3)
// build = 일터 하나가 1.5초마다 예정 부지 → 기초 → 1층 → … → 큰 건물 (06 문서 5장: 거품, 반짝임, 비계·게이지, 환호). 다시 보려면 새로고침
// capital = Lv.10 해저 수도(80×80, 시청 궁전, 공공시설 전부, 팀원 20) — 성능 확인용 (e2e/perf.spec.ts)
import { seedPersonality } from '@tycoon/core';
import {
  buildPublicWork,
  findLot,
  initialState,
  LEADER_ID,
  levelUp,
  makeConfig,
  occupiedLots,
  type Lot,
  type MemberStatus,
  type Slot,
  type VillageState,
  type Zone,
} from '@tycoon/core';
import { useEffect, useState } from 'react';
import { Camera } from '../world/Camera';
import { liveWorld, LiveVillage } from '../world/LiveVillage';
import { useVillage } from './api';

const cfg = makeConfig();
const STATUS: MemberStatus[] = ['working', 'resting', 'meeting', 'working', 'blocked'];

/** 결정적 가짜 상태. round가 바뀌면 팀원 상태가 한 칸씩 돈다 */
export function stressState(round: number, members = 20, ring = 1): VillageState {
  const s = initialState('stress');
  s.ring = ring; // 일터 3×3이 여럿 들어가게 (ring 1이면 남·동 8곳)
  s.level = 7; // 3층·큰 건물 임시 그림도 보이게
  const taken: Lot[] = Object.values(s.facilities);
  const lot = (z: Zone, size: 2 | 3 = 2) => {
    const l = findLot(z, taken, s.ring, size);
    if (l) taken.push(l);
    return l;
  };
  const species = cfg.roster.speciesCycle;
  const jobs = cfg.jobPresets.map((p) => p.id);
  const meeting: string[] = [];
  for (let i = 0; i < members; i++) {
    const id = i === 0 ? LEADER_ID : `m${i}`;
    const status = STATUS[(i + round) % STATUS.length] ?? 'resting';
    const busy = status === 'working' || status === 'blocked';
    const runId = busy ? `r${i}` : null;
    if (runId)
      s.runs[runId] = {
        runId,
        agentType: id,
        memberId: id,
        visitorKind: null,
        startedAt: 0,
        endedAt: null,
        lastAt: 0,
        ok: null,
        toolCalls: i * 3,
        failStreak: 0,
        testsPassed: 0,
        testsFailed: 0,
        openPre: {},
      };
    if (status === 'meeting') meeting.push(id);
    s.members[id] = {
      id,
      slot: ((i % 6) + 1) as Slot,
      name: id,
      description: '',
      fromMd: true,
      movedInAt: 0,
      job: jobs[i % jobs.length] ?? 'other',
      species: species[i % species.length] ?? 'bear',
      variant: 0,
      accessory: null,
      isLeader: i === 0,
      departed: false,
      status,
      blocked: status === 'blocked' ? 'permission' : null,
      currentRunId: runId,
      currentTaskId: null,
      cheerUntil: null,
      balance: 0,
      furniture: [],
      hardship: false,
      boughtToday: 0,
      tokens: 0,
      tokenCostToday: 0,
      materialsToday: 0,
      eff: { recent: [] },
      receipt: { parts: {}, runs: 0, calls: 0, models: {} },
      personality: seedPersonality('ISTJ'),
    };
    const h = lot('west');
    if (h) s.houses[id] = { memberId: id, lot: h };
  }
  // 일터: 팀원 순서대로 남 → 동, 층은 0~4를 돌며 (06 문서 5장)
  for (let i = 1; i < members; i++) {
    const l = lot('south', 3) ?? lot('east', 3);
    if (!l) break;
    const id = `w1:m${i}`;
    s.buildings[id] = {
      id,
      memberId: `m${i}`,
      n: 1,
      name: '',
      lot: l,
      floor: i % 5,
      points: (i % 5) * 120,
      paid: 0,
      waiting: null,
      startedAt: i,
      floorAt: null,
    };
  }
  s.meeting = {
    kind: 'prompt',
    startedAt: 0,
    until: Number.MAX_SAFE_INTEGER,
    preview: 'stress',
    participants: meeting,
  };
  (['Explore', 'Plan', 'general-purpose'] as const).forEach((kind, k) => {
    s.visitors[`v${k}`] = { runId: `v${k}`, kind, facility: cfg.visitors[kind].facility as 'library', startedAt: k };
  });
  s.seq = round;
  return s;
}

/** build 데모: stress 마을(팀원 4명)의 m3 일터가 예정 부지 → 기초 → 1층 → 2층 → 3층 → 큰 건물 (06 문서 5장) */
export function buildState(step: number, at: number): VillageState {
  const s = stressState(0, 4);
  const b = s.buildings['w1:m3'];
  const m = s.members.m3;
  const r = s.runs[m?.currentRunId ?? ''];
  if (!b || !m || !r) return s;
  const floor = Math.min(4, Math.max(0, step - 1));
  Object.assign(b, { floor, points: floor * 120, floorAt: floor > 0 ? at : null });
  r.toolCalls = step === 0 ? 0 : 5;
  if (floor > 1) m.cheerUntil = at + cfg.buildings.cheerMs; // 1층은 환호 없음 (06 문서 5.9)
  s.seq = step;
  return s;
}

/** capital 데모 (06 문서 6장): stress 마을(팀원 20명)을 Lv.10 해저 수도로 — ring 8(80×80), 시청 해저 궁전, 공원·길 포장·랜드마크 둘,
 *  길가·광장 둘레 소품을 자리가 찰 때까지. 성능 확인용 (e2e/perf.spec.ts) */
export function capitalState(round: number): VillageState {
  const s = stressState(round, 20, 7); // 일터 19곳이 다 들어가게 처음부터 ring 7, 레벨업 하나가 8로
  s.hall = findLot('north', occupiedLots(s), s.ring, 3);
  s.level = 9;
  s.economy.fund = 1_000_000;
  const b = Object.values(s.buildings)[0];
  if (b) b.points += 100_000; // Lv.10 점수
  for (let d = 1; d <= 120; d++) {
    levelUp(s, 0, cfg);
    buildPublicWork(s, d, 0, cfg);
  }
  return s;
}

export function LiveDemo({ source }: { source: string }) {
  const stress = source === 'stress';
  const build = source === 'build';
  const capital = source === 'capital';
  const make = capital ? capitalState : stressState;
  const { state, connected } = useVillage(stress || build || capital ? null : source);
  const [fake, setFake] = useState(() => (build ? buildState(0, Date.now()) : make(0)));
  useEffect(() => {
    if (!stress && !build && !capital) return;
    const t = build
      ? setInterval(() => setFake((s) => (s.seq < 5 ? buildState(s.seq + 1, Date.now()) : s)), 1500)
      : setInterval(() => setFake((s) => make(s.seq + 1)), 4000);
    return () => clearInterval(t);
  }, [stress, build, capital, make]);
  const s = stress || build || capital ? fake : state;
  return (
    <div style={{ width: '100vw', height: '100vh' }} data-connected={stress || build || capital || connected}>
      <Camera worldW={liveWorld(s).w} worldH={liveWorld(s).h}>
        {s && <LiveVillage state={s} />}
      </Camera>
    </div>
  );
}

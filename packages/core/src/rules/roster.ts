// 팀원 등록 (01 문서 3.1, D9). tycoon.json의 바다 id는 여기서 정본 id로 바꾼다 (05 문서 3.2).
// md 팀원은 목록에만 올리고, 집은 처음 일할 때 짓는다 (rules/growth.ts, 01 문서 3.3)
import { normalizeTycoon, type GameConfig, type MemberConf, type TycoonConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import { seedPersonality } from './personality';
import { LEADER_ID, type Member, type Slot, type VillageState } from '../projector/types';

/** 새 팀원 한 명 (잔고 0 — 입주 지원금 없음, D20). 가장 낮은 빈 슬롯. 슬롯이 없으면 null */
export function join(
  s: VillageState,
  id: string,
  cfg: GameConfig,
  opts: { description?: string; fromMd?: boolean; slot?: Slot } = {},
): Member | null {
  let slot = opts.slot ?? 1;
  if (opts.slot === undefined) {
    const used = new Set<number>(Object.values(s.members).map((m) => m.slot));
    while (used.has(slot)) slot++;
  }
  if (slot > cfg.roster.maxSlots) return null;
  return (s.members[id] = {
    id,
    slot: slot as Slot,
    name: id,
    description: opts.description ?? '',
    fromMd: opts.fromMd ?? false,
    movedInAt: null,
    job: cfg.fallbackPreset.id,
    species: cfg.roster.leaderSpecies,
    variant: 0,
    accessory: null,
    isLeader: false,
    departed: false,
    status: 'resting',
    blocked: null,
    currentRunId: null,
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
    personality: seedPersonality(cfg.fallbackPreset.mbtiSeed), // 직업이 정해지면 configure가 다시 씨앗
  });
}

/** 동물·직업·소품을 설정(s.conf)과 기본 규칙으로 (01 문서 3.1-2·3). 떠난 팀원은 그대로 둔다.
 *  동물 순환은 슬롯 순으로 센 자리 — 새 팀원이 와도 기존 팀원 동물이 안 바뀐다.
 *  도감을 한 바퀴 다 쓰면 다음 바퀴는 같은 동물 + 변형 번호 (D16) */
export function configure(s: VillageState, cfg: GameConfig): void {
  const accessoryOf = (conf: MemberConf | undefined, job: string) =>
    conf?.accessory !== undefined ? conf.accessory : (cfg.jobPresets.find((p) => p.id === job)?.accessory ?? null);
  const members = Object.values(s.members).sort((a, b) => a.slot - b.slot);
  const cycle = cfg.roster.speciesCycle;
  let i = 0;
  for (const m of members) {
    if (m.isLeader) {
      const l = s.conf.leader;
      m.name = l?.label ?? '팀장';
      m.job = l?.job ?? 'lead';
      m.species = l?.species ?? cfg.roster.leaderSpecies;
      m.accessory = accessoryOf(l, m.job);
      continue;
    }
    const conf = s.conf.members[m.id];
    const k = conf?.species === undefined ? i++ : -1; // 자동 배정 자리 (설정으로 고른 팀원은 세지 않음)
    const species = k < 0 ? (conf?.species ?? '') : (cycle[k % cycle.length] ?? cfg.roster.leaderSpecies);
    if (m.departed) continue;
    // 직업은 이름만 본다 — 설명엔 일하는 대상(API·UI)이 섞여 다르게 걸린다 (D17)
    const text = m.name.toLowerCase();
    // 영문 키워드는 단어 첫머리에서만 (guides의 ui, development의 pm은 아님). 한글은 조사가 붙으니 포함이면 된다
    const words = text.split(/[^a-z0-9]+/);
    const hit = (k: string) => (/^[a-z0-9]+$/.test(k) ? words.some((w) => w.startsWith(k)) : text.includes(k));
    m.job = conf?.job ?? cfg.jobPresets.find((p) => p.keywords.some(hit))?.id ?? cfg.fallbackPreset.id;
    m.species = species;
    m.variant = k >= 0 && cycle.length ? Math.floor(k / cycle.length) : 0;
    m.accessory = accessoryOf(conf, m.job);
  }
  // 성격 씨앗 = 직업 프리셋 mbtiSeed (7장). 작업으로 한 번이라도 움직였으면(samples) 그대로 둔다. 회의 참가 시각은 둔다
  for (const m of Object.values(s.members))
    if (m.personality.samples.length === 0)
      m.personality = {
        ...seedPersonality((cfg.jobPresets.find((p) => p.id === m.job) ?? cfg.fallbackPreset).mbtiSeed),
        lastMeetingAt: m.personality.lastMeetingAt,
      };
}

export function applyRoster(s: VillageState, e: DomainEvent, cfg: GameConfig): void {
  if (e.t !== 'RosterLoaded') return;
  const t = normalizeTycoon((e.tycoon ?? {}) as TycoonConfig);
  s.conf = { members: t.members ?? {}, ...(t.leader ? { leader: t.leader } : {}) };

  // 팀장은 md 없이도 항상 슬롯 1 (결정 D1). 입주는 마을이 처음 일할 때 (3.3)
  if (cfg.roster.leaderFromMainSession && !s.members[LEADER_ID]) {
    const l = join(s, LEADER_ID, cfg, { slot: 1 });
    if (l) l.isLeader = true;
  }

  // md 팀원: 받은 순서(수집기가 파일 이름순으로 준다, 3.1-4)로 가장 낮은 빈 슬롯
  const byName = new Map(e.agents.map((a) => [a.name, a]));
  const ignored: string[] = [];
  for (const a of e.agents) {
    const m = s.members[a.name];
    if (m) {
      m.description = a.description;
      m.fromMd = true;
      continue;
    }
    if (!join(s, a.name, cfg, { description: a.description, fromMd: true })) ignored.push(a.name);
  }
  // md가 사라짐: 입주한 팀원은 떠난 팀원(흐리게), 입주 전이면 목록에서 뺀다 — 마을에 남긴 것이 없다 (3.1-1·5)
  for (const m of Object.values(s.members)) {
    if (!m.fromMd || m.isLeader || byName.has(m.id)) {
      if (byName.has(m.id)) m.departed = false;
      continue;
    }
    if (m.movedInAt === null) Reflect.deleteProperty(s.members, m.id);
    else m.departed = true;
  }
  configure(s, cfg);

  if (ignored.length)
    s.feed.push({
      at: e.at,
      kind: 'task',
      text: `팀원 자리(${cfg.roster.maxSlots})가 꽉 차서 등록 못 함: ${ignored.join(', ')}`,
    });
}

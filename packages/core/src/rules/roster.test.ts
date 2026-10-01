import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { defaultConfig, makeConfig } from '../config/config';
import type { AgentDef, DomainEvent } from '../events/normalize';
import type { Raw } from '../events/summarize';
import { initialState } from '../projector/project';
import { LEADER_ID } from '../projector/types';
import { moveInAll } from './growth';
import { applyRoster } from './roster';

const dir = new URL('../../../../examples/target-project/.claude/', import.meta.url);
const exampleAgents: AgentDef[] = readdirSync(new URL('agents/', dir))
  .sort() // 수집기처럼 파일 이름순
  .map((f) => {
    const md = readFileSync(new URL(`agents/${f}`, dir), 'utf8');
    return { name: md.match(/^name: (.+)$/m)?.[1] ?? '', description: md.match(/^description: (.+)$/m)?.[1] ?? '' };
  });
const seaTycoon = JSON.parse(readFileSync(new URL('tycoon.sea.json', dir), 'utf8')) as Raw;
const roster = (agents: AgentDef[], tycoon: Raw | null = null, at = 1): DomainEvent => ({
  t: 'RosterLoaded',
  at,
  agents,
  tycoon,
});
const load = (agents: AgentDef[], tycoon: Raw | null = null, cfg = defaultConfig) => {
  const s = initialState('p');
  applyRoster(s, roster(agents, tycoon), cfg);
  return s;
};
const pick = (s: ReturnType<typeof load>) =>
  Object.values(s.members).map((m) => [m.id, m.slot, m.species, m.job, m.accessory, s.houses[m.id]?.lot]);

test('예시 프로젝트 + 바다 tycoon: 정본 id로 저장, 빠진 소품은 직업 프리셋. 집은 입주할 때 (01 문서 3.3)', () => {
  const s = load(exampleAgents, seaTycoon);
  // roster만으로는 목록에만: 집·잔고 없음, 입주 전
  expect(Object.values(s.members).map((m) => [m.id, m.movedInAt, m.balance, s.houses[m.id]])).toEqual([
    [LEADER_ID, null, 0, undefined],
    ['backend-dev', null, 0, undefined],
    ['frontend-dev', null, 0, undefined],
    ['qa-reviewer', null, 0, undefined],
  ]);
  moveInAll(s, 1, defaultConfig);
  expect(pick(s)).toEqual([
    [LEADER_ID, 1, 'penguin', 'lead', 'bowtie', { x: 4, y: 10 }],
    ['backend-dev', 2, 'bear', 'backend', 'glasses', { x: 1, y: 10 }],
    ['frontend-dev', 3, 'rabbit', 'frontend', 'beret', { x: 4, y: 13 }],
    ['qa-reviewer', 4, 'raccoon', 'qa', 'magnifier', { x: 1, y: 13 }],
  ]);
  expect(s.members[LEADER_ID]).toMatchObject({ name: '팀장', isLeader: true, status: 'resting', balance: 0 }); // 입주 지원금 없음 (D20)
  expect(s.feed).toEqual([]);
});

test('tycoon 없으면 키워드로 직업, speciesCycle 순서로 동물', () => {
  const [be, ...rest] = exampleAgents; // docs-writer.md는 파일 이름순으로 backend-dev.md 다음
  const s = load([...(be ? [be] : []), { name: 'docs-writer', description: '문서 정리' }, ...rest]);
  expect(pick(s).map(([id, slot, species, job, acc]) => [id, slot, species, job, acc])).toEqual([
    [LEADER_ID, 1, 'penguin', 'lead', 'bowtie'],
    ['backend-dev', 2, 'bear', 'backend', 'glasses'],
    ['docs-writer', 3, 'rabbit', 'other', null],
    ['frontend-dev', 4, 'raccoon', 'frontend', 'beret'], // 팀장 동물(펭귄)은 팀원 순서에서 빠진다 (01 문서 3.1-3, D16)
    ['qa-reviewer', 5, 'gentoo', 'qa', 'magnifier'],
  ]);
  // 16×16 서쪽 구역은 4채까지 → 5번째 입주 때 섬을 넓혀 집을 짓는다 (D10)
  moveInAll(s, 1, defaultConfig);
  expect(s.ring).toBe(1);
  expect(s.houses['qa-reviewer']).toBeDefined();
  expect(s.feed).toEqual([]);
});

test('입주한 팀원은 md가 사라지면 떠난 팀원, 돌아오면 복귀. 슬롯·집·잔고·기존 동물 유지', () => {
  const s = moveInAll(load(exampleAgents), 1, defaultConfig);
  const before = structuredClone(s.houses);
  const bd = s.members['backend-dev'];
  if (bd) bd.balance = 999;
  applyRoster(s, roster(exampleAgents.filter((a) => a.name === 'frontend-dev')), defaultConfig);
  expect(Object.values(s.members).map((m) => [m.id, m.departed])).toEqual([
    [LEADER_ID, false],
    ['backend-dev', true],
    ['frontend-dev', false],
    ['qa-reviewer', true],
  ]);
  expect(s.houses).toEqual(before);

  // 이름순으로 앞서는 새 팀원이 와도 가장 낮은 빈 슬롯(5)을 받고, 기존 팀원 동물은 그대로
  applyRoster(s, roster([...exampleAgents, { name: 'api-gw', description: '' }]), defaultConfig);
  expect(pick(s).map(([id, slot, species]) => [id, slot, species])).toEqual([
    [LEADER_ID, 1, 'penguin'],
    ['backend-dev', 2, 'bear'],
    ['frontend-dev', 3, 'rabbit'],
    ['qa-reviewer', 4, 'raccoon'],
    ['api-gw', 5, 'gentoo'],
  ]);
  expect(s.members['backend-dev']).toMatchObject({ departed: false, balance: 999, job: 'backend' });
  expect(s.members['api-gw']?.job).toBe('backend'); // 'api' 키워드
});

test('tycoon이 바뀌면 설정 필드만 갱신. 소품 null도 그대로 따른다', () => {
  const s = load(exampleAgents);
  applyRoster(
    s,
    roster(exampleAgents, { members: { 'qa-reviewer': { species: 'otter', accessory: null } } }),
    defaultConfig,
  );
  expect(s.members['qa-reviewer']).toMatchObject({ slot: 4, species: 'rabbit', job: 'qa', accessory: null });
});

test('maxSlots를 넘는 md는 무시하고 기록 한 줄 (기본 99 — 사실상 제한 없음, D10)', () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  expect(Object.keys(load(names.map((name) => ({ name, description: '' }))).members)).toHaveLength(9);
  const six = makeConfig({ overrides: { roster: { maxSlots: 6 } } });
  const s = load(
    names.map((name) => ({ name, description: '' })),
    null,
    six,
  );
  expect(Object.values(s.members).map((m) => [m.id, m.slot])).toEqual([
    [LEADER_ID, 1],
    ['a', 2],
    ['b', 3],
    ['c', 4],
    ['d', 5],
    ['e', 6],
  ]);
  expect(s.feed[0]?.text).toBe('팀원 자리(6)가 꽉 차서 등록 못 함: f, g, h');
});

test('팀장 끄면 팀원이 슬롯 1부터, 집은 서쪽 구역에 결정적으로', () => {
  const cfg = makeConfig({ overrides: { roster: { leaderFromMainSession: false } } });
  const a = moveInAll(load(exampleAgents, null, cfg), 1, cfg);
  expect(Object.keys(a.houses)).toHaveLength(3);
  expect(a.members[LEADER_ID]).toBeUndefined();
  expect(a.members['backend-dev']?.slot).toBe(1);
  expect(a).toEqual(moveInAll(load(exampleAgents, null, cfg), 1, cfg));
  for (const { lot } of Object.values(a.houses)) expect(lot.x + 1 < 6 && lot.y >= 10).toBe(true);
});

test('RosterLoaded 외의 이벤트는 건드리지 않는다', () => {
  const s = initialState('p');
  applyRoster(s, { t: 'GameDayTick', at: 1, day: 1 }, defaultConfig);
  expect(s).toEqual(initialState('p'));
});

test('슬롯은 받은 순서(파일 이름순), md 이름이 leader여도 팀장과 따로 (3.1-1·4)', () => {
  const s = load([
    { name: 'zeta', description: '' }, // a.md
    { name: 'leader', description: 'Coordinates the team' }, // b.md
  ]);
  expect(pick(s).map(([id, slot, , job]) => [id, slot, job])).toEqual([
    [LEADER_ID, 1, 'lead'],
    ['zeta', 2, 'other'],
    ['leader', 3, 'lead'],
  ]);
});

test('직업 키워드는 단어 첫머리에서만 (guides의 ui, development의 pm, feedback의 db는 아님) (3.1-3)', () => {
  const s = load([
    { name: 'user-guides', description: '' },
    { name: 'development-helper', description: '' },
    { name: 'feedback-triage', description: '' },
    { name: 'tester', description: '' },
    { name: 'api-gw', description: '' },
    { name: '백엔드-담당', description: '' },
  ]);
  expect(Object.values(s.members).map((m) => [m.id, m.job])).toEqual([
    [LEADER_ID, 'lead'],
    ['user-guides', 'other'],
    ['development-helper', 'other'],
    ['feedback-triage', 'other'],
    ['tester', 'qa'],
    ['api-gw', 'backend'],
    ['백엔드-담당', 'backend'],
  ]);
});

test('직업은 이름만 본다, 설명은 안 본다 (D17): ETL 팀', () => {
  const s = load([
    { name: 'backend-engineer', description: '' },
    { name: 'data-ai-engineer', description: 'UI 데이터 파이프라인' },
    { name: 'legal-counsel', description: '토스증권 Open API 약관 검토' },
    { name: 'planner', description: '' },
    { name: 'pm', description: '' },
    { name: 'supervisor', description: 'Reviews and tests backend work' },
    { name: 'ui-designer', description: '' },
    { name: 'ux-designer', description: '' },
  ]);
  expect(Object.fromEntries(Object.values(s.members).map((m) => [m.id, m.job]))).toEqual({
    [LEADER_ID]: 'lead',
    'backend-engineer': 'backend',
    'data-ai-engineer': 'other',
    'legal-counsel': 'other',
    planner: 'other',
    pm: 'lead',
    supervisor: 'other',
    'ui-designer': 'frontend',
    'ux-designer': 'frontend',
  });
});

test('입주 전 팀원의 md가 사라지면 목록에서 뺀다 — 마을에 남긴 것이 없다 (01 문서 3.1-1)', () => {
  const s = load(exampleAgents);
  applyRoster(s, roster(exampleAgents.filter((a) => a.name === 'frontend-dev')), defaultConfig);
  expect(Object.keys(s.members)).toEqual([LEADER_ID, 'frontend-dev']);
  expect(s.feed).toEqual([]);
});

test('동물 도감 (01 문서 D15·D16): 팀장 동물을 뺀 도감 순서대로, 다 쓰면 같은 순서에 변형 번호, 설정으로 고른 팀원은 변형 없음', () => {
  const cycle = defaultConfig.roster.speciesCycle;
  expect(cycle).not.toContain(defaultConfig.roster.leaderSpecies); // 팀장과 같은 동물인 팀원이 없다
  expect(cycle).toHaveLength(19);
  const agents = Array.from({ length: 25 }, (_, i) => ({
    name: `agent-${String(i).padStart(2, '0')}`,
    description: '',
  }));
  const s = load(agents);
  const team = Object.values(s.members)
    .filter((m) => !m.isLeader)
    .sort((a, b) => a.slot - b.slot);
  expect(team.slice(0, 19).map((m) => m.species)).toEqual(cycle);
  expect(team.slice(0, 19).every((m) => m.variant === 0)).toBe(true);
  expect(team.slice(19).map((m) => [m.species, m.variant])).toEqual(cycle.slice(0, 6).map((sp) => [sp, 1]));
  expect(new Set(team.map((m) => `${m.species}/${m.variant}`)).size).toBe(25); // 25명 모두 다른 모습
  // 새 팀원이 와도 기존 팀원 동물은 그대로
  const more = load([...agents, { name: 'zz-new', description: '' }]);
  expect(more.members['agent-03']?.species).toBe('gentoo');
  // 설정으로 고른 팀원은 변형 없음, 자동 순서에서도 빠진다
  const picked = load(agents, { members: { 'agent-20': { species: 'otter' } } } as unknown as Raw);
  expect(picked.members['agent-20']).toMatchObject({ species: 'rabbit', variant: 0 });
  expect(picked.members['agent-21']).toMatchObject({ species: 'rabbit', variant: 1 });
});

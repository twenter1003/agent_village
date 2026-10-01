import { describe, expect, test } from 'vitest';
import { makeConfig } from '../config/config';
import { normalize, type DomainEvent, type Placement } from '../events/normalize';
import { project, replay } from '../projector/project';
import type { Member, OwnedFurniture, VillageState } from '../projector/types';
import { canPlace, findSpot, purchaseError, ROOM } from './furniture';
import { moveInAll } from './growth';

const cfg = makeConfig();
const T0 = Date.parse('2026-09-30T10:00:00.000Z');
const roster: DomainEvent = {
  t: 'RosterLoaded',
  at: T0,
  agents: [
    { name: 'backend-dev', description: 'API' },
    { name: 'qa-reviewer', description: 'test' },
  ],
  tycoon: null,
};
const buy = (memberId: string, kind: string, fabric: string | null = null, sec = 1): DomainEvent => ({
  t: 'FurniturePurchased',
  at: T0 + sec * 1000,
  memberId,
  kind,
  fabric,
});
const move = (memberId: string, furnitureId: string, placed: Placement | null, sec = 2): DomainEvent => ({
  t: 'FurnitureMoved',
  at: T0 + sec * 1000,
  memberId,
  furnitureId,
  placed,
});
/** 급여로 잔고 만들기 (입주 지원금 없음, D20): who의 실행 하나가 도구 tools번 → 끝나면 세후 26 × tools − 세금 20%
 *  (25번 = 650 − 130 = 520). k = 몇 번째 벌이 (실행 id). 구매(1초)보다 먼저 */
const earn = (who: string, tools: number, k = 0): DomainEvent[] => {
  const at = T0 + 100 + k * 20;
  const runId = `earn-${who}-${k}`;
  return [
    { t: 'AgentRunStarted', at, runId, agentType: who },
    ...Array.from({ length: tools }, (): DomainEvent => ({
      t: 'ToolUsed',
      at: at + 1,
      runId,
      tool: 'Read',
      phase: 'post',
      ok: true,
      kind: 'read',
      isTest: false,
    })),
    { t: 'AgentRunEnded', at: at + 2, runId, ok: true },
  ];
};
/** roster 뒤 모두 입주한 마을 (집은 처음 일할 때 짓지만 여기서는 가구 규칙만 본다, 01 문서 3.3) */
const village = (...events: DomainEvent[]) =>
  events.reduce((s, e) => project(s, e, cfg), moveInAll(replay('p', [roster], cfg), T0, cfg));

/** 가구를 손으로 놓은 팀원 */
function room(...items: [kind: string, x: number, y: number, rot?: 0 | 1][]): Member {
  const s = village();
  const m = s.members['backend-dev'];
  if (!m) throw new Error('no member');
  m.furniture = items.map(([kind, x, y, rot = 0], i): OwnedFurniture => ({
    id: `f${i}`,
    kind,
    fabric: null,
    price: 0,
    day: 0,
    by: 'user',
    placed: { x, y, rot },
  }));
  return m;
}

test('findSpot: 뒤 모서리부터 x+y 순, 같으면 x 작은 칸 → 36칸이 차면 창고 (8.4)', () => {
  const m = room();
  const order: string[] = [];
  for (let i = 0; i < ROOM * ROOM + 1; i++) {
    const p = findSpot(m, 'desk', cfg);
    order.push(p ? `${p.x},${p.y}` : 'null');
    if (p) m.furniture.push({ id: `d${i}`, kind: 'desk', fabric: null, price: 0, day: 0, by: 'user', placed: p });
  }
  expect(order.slice(0, 6)).toEqual(['0,0', '0,1', '1,0', '0,2', '1,1', '2,0']);
  expect(new Set(order.slice(0, 36)).size).toBe(36);
  expect(order[36]).toBe('null');
});

test('findSpot 2×1: rot 0이 막히면 같은 칸에서 rot 1, 겹치지 않는다', () => {
  expect(findSpot(room(), 'bed', cfg)).toEqual({ x: 0, y: 0, rot: 0 });
  expect(findSpot(room(['desk', 1, 0]), 'bed', cfg)).toEqual({ x: 0, y: 0, rot: 1 });
  // (0,0) 막힘 → 다음 칸 (0,1): rot 0 = (0,1)(1,1)
  expect(findSpot(room(['plant', 0, 0]), 'rug', cfg)).toEqual({ x: 0, y: 1, rot: 0 });
});

test('canPlace: 방 밖·겹침·1×1 rot 1은 안 됨, 러그도 칸을 차지, 옮기는 자신과는 안 겹침', () => {
  const m = room(['rug', 2, 2], ['desk', 0, 5]);
  expect(canPlace(m, 'bed', { x: 5, y: 0, rot: 0 }, cfg)).toBe(false); // (6,0) 방 밖
  expect(canPlace(m, 'bed', { x: 5, y: 0, rot: 1 }, cfg)).toBe(true);
  expect(canPlace(m, 'bed', { x: 5, y: 5, rot: 1 }, cfg)).toBe(false);
  expect(canPlace(m, 'bed', { x: -1, y: 0, rot: 0 }, cfg)).toBe(false);
  expect(canPlace(m, 'lamp', { x: 3, y: 2, rot: 0 }, cfg)).toBe(false); // 러그 두 번째 칸
  expect(canPlace(m, 'lamp', { x: 3, y: 3, rot: 0 }, cfg)).toBe(true);
  expect(canPlace(m, 'lamp', { x: 3, y: 3, rot: 1 }, cfg)).toBe(false);
  expect(canPlace(m, 'bed', { x: 0, y: 4, rot: 1 }, cfg)).toBe(false); // (0,5) 책상
  expect(canPlace(m, 'rug', { x: 3, y: 2, rot: 0 }, cfg, 'f0')).toBe(true); // 자기 자리에서 한 칸 옮기기
  expect(canPlace(m, 'lamp', { x: 0.5, y: 0, rot: 0 } as Placement, cfg)).toBe(false);
  expect(canPlace(m, 'sofa', { x: 0, y: 0, rot: 0 }, cfg)).toBe(false);
});

test('벽 가구(책장)는 오른쪽 뒤 벽 y=0 줄만, 밖 가구(꽃밭)는 방에 못 놓고 창고', () => {
  expect(findSpot(room(['desk', 0, 0]), 'bookcase', cfg)).toEqual({ x: 1, y: 0, rot: 0 });
  expect(canPlace(room(), 'bookcase', { x: 0, y: 1, rot: 0 }, cfg)).toBe(false);
  const wall = room(...Array.from({ length: ROOM }, (_, x): [string, number, number] => ['plant', x, 0]));
  expect(findSpot(wall, 'bookcase', cfg)).toBeNull();
  expect(findSpot(room(), 'flowers', cfg)).toBeNull();
  expect(canPlace(room(), 'flowers', { x: 3, y: 3, rot: 0 }, cfg)).toBe(false);
});

test('사용자 구매: 잔고에서 빼고 오늘 지출·가구·활동 기록, 자리는 findSpot, 가격은 고정 basePrice (6.4, D20)', () => {
  const s = village(
    ...earn('backend-dev', 25),
    ...earn('qa-reviewer', 25, 1),
    buy('backend-dev', 'armchair', 'coral'),
    buy('qa-reviewer', 'desk'),
  );
  expect(s.members['backend-dev']).toMatchObject({ balance: 220 }); // 520 − 300
  expect(s.members['backend-dev']?.furniture).toEqual([
    {
      id: `u${T0 + 1000}`,
      kind: 'armchair',
      fabric: 'coral',
      price: 300,
      day: 0,
      by: 'user',
      placed: { x: 0, y: 0, rot: 0 },
    },
  ]);
  expect(s.members['qa-reviewer']).toMatchObject({ balance: 260 });
  expect(s.economy.today.purchases).toBe(560);
  expect(s.feed.filter((f) => f.kind === 'economy').map((f) => f.text)).toEqual([
    'backend-dev 가구 구매 · 300',
    'qa-reviewer 가구 구매 · 260',
  ]);

  // 팀장 가구는 기금에서 (D21): 세금 130 + 130 = 260 → 책상(260)은 산다 (기금 = 가격이면 된다), 다음 화분은 재생에서 paid 0으로 들어온다
  const mayor = village(
    ...earn('backend-dev', 25),
    ...earn('qa-reviewer', 25, 1),
    buy('@leader', 'desk', null, 1),
    buy('@leader', 'plant', null, 2),
  );
  // 다음 화분은 기금이 0이라 재생에서는 paid 0으로 들어온다 (06 문서 3.5). 살 때 막는 건 서버 409
  expect(mayor.members['@leader']?.furniture.map((f) => [f.kind, f.paid])).toEqual([
    ['desk', undefined],
    ['plant', 0],
  ]);
  expect(mayor.members['@leader']?.balance).toBe(0);
  // 기금에서 나간 팀장 가구는 팀원 가구 지출(purchases)과 따로 (팀 금고 흐름에 섞이지 않게)
  expect(mayor.economy).toMatchObject({ fund: 0, today: { purchases: 0, leaderPurchases: 260 } });
});

test('잘못된 구매는 무시: 없는·떠난 팀원, 모르는 가구, 색 규칙, 프로토타입 키 (잔고 부족은 purchaseError만 막고 재생은 받는다)', () => {
  const s = village();
  s.members['qa-reviewer'] = { ...(s.members['qa-reviewer'] as Member), departed: true };
  const bad: [DomainEvent, ReturnType<typeof purchaseError>][] = [
    [buy('nobody', 'desk'), 'member'],
    [buy('__proto__', 'desk'), 'member'],
    [buy('qa-reviewer', 'desk'), 'departed'],
    [buy('backend-dev', 'sofa'), 'kind'],
    [buy('backend-dev', 'toString'), 'kind'],
    [buy('backend-dev', 'armchair', null), 'fabric'],
    [buy('backend-dev', 'armchair', 'pink'), 'fabric'],
    [buy('backend-dev', 'desk', 'coral'), 'fabric'],
  ];
  for (const [e, why] of bad) {
    if (e.t !== 'FurniturePurchased') continue;
    expect(purchaseError(s, e.memberId, e.kind, e.fabric, cfg)).toBe(why);
    expect(project(s, e, cfg)).toEqual({ ...s, clock: { ...s.clock, now: e.at } });
  }
  expect(purchaseError(s, 'backend-dev', 'bed', 'blue', cfg)).toBe('balance'); // 서버는 살 때 막는다 (409)
  expect(purchaseError(s, '@leader', 'plant', null, cfg)).toBe('balance'); // 팀장 지갑 = 마을 기금 (D21), 비었음
  s.economy.fund = 80;
  expect(purchaseError(s, '@leader', 'plant', null, cfg)).toBeNull(); // 팀장도 산다
});

test('사용자가 산 가구는 재생에서 잔고가 모자라도 남는다: 가진 만큼만 내고 0에서 멈춤 (06 문서 3.5)', () => {
  // 잔고 520 → 의자 300 → 220 → 의자 300은 220만 낸다
  const s = village(
    ...earn('backend-dev', 25),
    buy('backend-dev', 'armchair', 'coral'),
    buy('backend-dev', 'armchair', 'blue', 2),
  );
  const m = s.members['backend-dev'] as Member;
  expect(m.balance).toBe(0);
  expect(m.furniture).toMatchObject([
    { kind: 'armchair', price: 300 },
    { kind: 'armchair', fabric: 'blue', price: 300, paid: 220, by: 'user', placed: { x: 0, y: 1, rot: 0 } },
  ]);
  expect(m.furniture[0]).not.toHaveProperty('paid'); // 값을 다 냈으면 paid는 없다
  expect(s.economy.today.purchases).toBe(520); // 낸 만큼 (300 + 220)
  expect(s.feed.filter((f) => f.kind === 'economy').map((f) => f.text)).toEqual([
    'backend-dev 가구 구매 · 300',
    'backend-dev 가구 구매 · 300',
  ]);
  // 잔고 0이어도 재생에서는 들어온다 (공짜지만 수집기가 살 때 확인한 줄이다)
  const zero = village(buy('backend-dev', 'bed', 'blue'));
  expect(zero.members['backend-dev']).toMatchObject({ balance: 0, furniture: [{ kind: 'bed', price: 520, paid: 0 }] });
  expect(zero.economy.today.purchases).toBe(0);
});

test('팀장이 사용자 구매로 산 가구도 기금이 모자라면 가진 만큼만 (기금 0에서 멈춤, leaderPurchases는 낸 만큼)', () => {
  // 세금 130으로 기금 130 → 책상 260은 130만 낸다
  const s = village(...earn('backend-dev', 25), buy('@leader', 'desk'));
  expect(s.economy).toMatchObject({ fund: 0, today: { purchases: 0, leaderPurchases: 130 } });
  expect(s.members['@leader']?.furniture).toMatchObject([{ kind: 'desk', price: 260, paid: 130, by: 'user' }]);
  expect(s.members['@leader']?.balance).toBe(0);
});

test('옮기기: 놓을 수 있는 자리·창고만, 겹침·방 밖·모르는 가구는 무시', () => {
  let s = village(...earn('backend-dev', 25), buy('backend-dev', 'desk')); // → (0,0), 잔고 260
  s.members['backend-dev'] = { ...(s.members['backend-dev'] as Member), balance: 2000 };
  s = project(s, buy('backend-dev', 'bed', 'blue'), cfg); // (0,0)이 막혀 (0,1) rot 0 = (0,1)(1,1)
  const ids = (st: VillageState) => st.members['backend-dev']?.furniture ?? [];
  const [desk, bed] = ids(s);
  expect(desk).toMatchObject({ kind: 'desk', placed: { x: 0, y: 0, rot: 0 } });
  expect(bed).toMatchObject({ kind: 'bed', placed: { x: 0, y: 1, rot: 0 } });
  const place = (st: VillageState, id: string) => ids(st).find((f) => f.id === id)?.placed;

  const deskId = desk?.id ?? '';
  const bedId = bed?.id ?? '';
  expect(place(project(s, move('backend-dev', deskId, { x: 1, y: 1, rot: 0 }), cfg), deskId)).toEqual({
    x: 0,
    y: 0,
    rot: 0,
  }); // 침대 칸
  expect(place(project(s, move('backend-dev', bedId, { x: 5, y: 5, rot: 0 }), cfg), bedId)).toEqual({
    x: 0,
    y: 1,
    rot: 0,
  }); // 방 밖
  expect(place(project(s, move('backend-dev', bedId, { x: 1, y: 1, rot: 0 }), cfg), bedId)).toEqual({
    x: 1,
    y: 1,
    rot: 0,
  }); // 자기 칸과 겹쳐도 됨
  expect(place(project(s, move('backend-dev', bedId, { x: 5, y: 4, rot: 1 }), cfg), bedId)).toEqual({
    x: 5,
    y: 4,
    rot: 1,
  });
  const stored = project(s, move('backend-dev', deskId, null), cfg);
  expect(place(stored, deskId)).toBeNull();
  expect(place(project(stored, move('backend-dev', deskId, { x: 0, y: 0, rot: 0 }), cfg), deskId)).toEqual({
    x: 0,
    y: 0,
    rot: 0,
  });
  for (const e of [move('backend-dev', 'f999', null), move('nobody', deskId, null), move('__proto__', deskId, null)])
    expect(project(s, e, cfg)).toEqual({ ...s, clock: { ...s.clock, now: e.at } });
});

test("ui 줄 → 정규화 → 재생: 두 번 재생하면 같고, 줄의 가구 종류는 'furniture' 필드", () => {
  // backend-dev가 일해서(실행) 입주하고 급여를 받은 뒤 (01 문서 3.3, D20). 사용자 가구 id = u<구매 시각> (D30)
  const pre = [roster, ...earn('backend-dev', 25)];
  const [f1, f2] = [`u${T0 + 1000}`, `u${T0 + 2000}`];
  const _t = (sec: number) => new Date(T0 + sec * 1000).toISOString();
  const lines = [
    { _t: _t(1), hook_event_name: 'ui', kind: 'purchase', memberId: 'backend-dev', furniture: 'rug', fabric: 'green' },
    { _t: _t(2), hook_event_name: 'ui', kind: 'purchase', memberId: 'backend-dev', furniture: 'plant', fabric: null },
    {
      _t: _t(3),
      hook_event_name: 'ui',
      kind: 'move',
      memberId: 'backend-dev',
      furnitureId: f1,
      placed: { x: 3, y: 4, rot: 1 },
    },
    { _t: _t(4), hook_event_name: 'ui', kind: 'move', memberId: 'backend-dev', furnitureId: f2, placed: null },
  ];
  const ui = lines.flatMap(normalize);
  expect(ui.map((e) => e.t)).toEqual(['FurniturePurchased', 'FurniturePurchased', 'FurnitureMoved', 'FurnitureMoved']);
  const events = [...pre, ...ui];
  const a = replay('p', events, cfg);
  expect(a).toEqual(replay('p', events, cfg));
  expect(a.members['backend-dev']?.furniture.map((f) => [f.id, f.kind, f.placed])).toEqual([
    [f1, 'rug', { x: 3, y: 4, rot: 1 }],
    [f2, 'plant', null],
  ]);
});

describe('가구 id는 구매 이벤트에서 (D30): 규칙이 바뀌어 재생해도 사용자가 옮긴 자리가 남는다', () => {
  const noAuto = makeConfig({ overrides: { economy: { autoBuy: { enabled: false } } } });
  const play = (c: typeof cfg, ...events: DomainEvent[]) =>
    events.reduce((s, e) => project(s, e, c), moveInAll(replay('p', [roster], c), T0, c));
  const at2 = T0 + 90_000;
  const events: DomainEvent[] = [
    ...earn('backend-dev', 600), // 잔고 12,480 → 다음 층 자재비 8,000을 남기고도 자동 구매가 돈다 (06 문서 6.4)
    buy('backend-dev', 'desk'),
    { t: 'GameDayTick', at: T0 + 60_000, day: 1 },
    buy('backend-dev', 'plant', null, 90),
    move('backend-dev', `u${at2}`, { x: 5, y: 5, rot: 0 }, 91),
  ];

  test('자동 구매가 켜졌든 꺼졌든 사용자 가구 id·옮긴 자리가 같다. 자동 구매 id = a<날>.<팀원>.<그날 몇 번째>', () => {
    const on = play(cfg, ...events).members['backend-dev']?.furniture ?? [];
    const off = play(noAuto, ...events).members['backend-dev']?.furniture ?? [];
    expect(on.filter((f) => f.by === 'auto').map((f) => f.id)).toEqual(['a1.backend-dev.0']);
    expect(off.filter((f) => f.by === 'auto')).toEqual([]);
    for (const list of [on, off])
      expect(list.filter((f) => f.by === 'user').map((f) => [f.id, f.kind, f.placed])).toEqual([
        [`u${T0 + 1000}`, 'desk', { x: 0, y: 0, rot: 0 }],
        [`u${at2}`, 'plant', { x: 5, y: 5, rot: 0 }],
      ]);
  });

  test('옛 번호 id(f21)를 가리키는 옮기기 줄은 아무것도 바꾸지 않는다 (한 번 초기화)', () => {
    const s = play(cfg, ...events);
    for (const e of [move('backend-dev', 'f21', null, 100), move('@leader', `u${at2}`, null, 100)])
      expect(project(s, e, cfg)).toEqual({ ...s, clock: { ...s.clock, now: e.at } });
  });

  test('같은 ms에 같은 팀원이 두 개 사면 뒤 것에 -1, 다른 팀원은 겹쳐도 그대로', () => {
    const s = play(
      cfg,
      ...earn('backend-dev', 200),
      ...earn('qa-reviewer', 200, 1),
      buy('backend-dev', 'plant', null, 5),
      buy('backend-dev', 'plant', null, 5),
      buy('qa-reviewer', 'plant', null, 5),
    );
    const id = `u${T0 + 5000}`;
    expect(s.members['backend-dev']?.furniture.map((f) => f.id)).toEqual([id, `${id}-1`]);
    expect(s.members['qa-reviewer']?.furniture.map((f) => f.id)).toEqual([id]);
  });
});

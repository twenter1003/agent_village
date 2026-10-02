// 수집기 통합 테스트 (02 문서 10장): 임시 DB + 아무 포트. 4777(개발 서버)은 건드리지 않는다
import {
  appendFileSync,
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VillageState } from '@tycoon/core';
import { openDb } from './db';
import { startServer } from './http';
import { createStore, HISTORY_KEEP, projectId } from './store';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite'); // db.ts 참고
const root = fileURLToPath(new URL('../../../', import.meta.url));
const lines = readFileSync(join(root, 'fixtures/sample-session.jsonl'), 'utf8').split('\n').filter(Boolean);
const tmp = mkdtempSync(join(tmpdir(), 'tycoon-'));
const dbPath = join(tmp, 'nested', 'tycoon.db'); // mkdir -p 확인
const ID = '-work-my-shop-app';

let srv: Awaited<ReturnType<typeof startServer>>;
const url = (p: string) => `http://127.0.0.1:${srv.port}${p}`;
const post = (body: string) => fetch(url('/hook'), { method: 'POST', body });
const state = async (id = ID) => (await (await fetch(url(`/api/projects/${id}/state`))).json()) as VillageState;
const count = (where = '1') => {
  const db = new DatabaseSync(dbPath);
  try {
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM raw_events WHERE ${where}`).get() as { n: number }).n);
  } finally {
    db.close();
  }
};
/** 비동기 처리가 끝났는지: 새 이벤트 하나를 보내고 그게 저장될 때까지 기다린다 (처리는 도착 순서) */
let mark = 0;
const settle = async () => {
  const before = count();
  await post(
    JSON.stringify({
      _t: new Date(Date.UTC(2020, 0, 1, 0, 0, ++mark)).toISOString(),
      hook_event_name: 'Stop',
      session_id: 'mark',
      cwd: '/mark',
    }),
  );
  await vi.waitFor(() => expect(count()).toBeGreaterThan(before)); // 처음 보는 마을이면 roster도 같이
};
/** fetch는 Host를 못 바꾼다 → node:http */
const raw = (path: string, headers: Record<string, string>, method = 'GET') =>
  new Promise<number>((ok, fail) =>
    request({ host: '127.0.0.1', port: srv.port, path, method, headers }, (res) => {
      res.resume();
      ok(res.statusCode ?? 0);
    })
      .on('error', fail)
      .end(
        method === 'POST'
          ? JSON.stringify({ hook_event_name: 'Stop', session_id: 'x', cwd: '/work/victim' })
          : undefined,
      ),
  );

beforeAll(async () => {
  srv = await startServer(0, dbPath);
  await fetch(url('/health')); // fetch 첫 호출 준비 시간을 재기에서 뺀다
});
afterAll(async () => {
  await srv.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('collector', () => {
  it('픽스처 전부 즉시 204 → 작업 6개, 일터 2곳 (일한 팀원 qa-reviewer·backend-dev)', async () => {
    for (const line of lines) {
      const t0 = performance.now();
      const res = await post(line);
      expect(res.status).toBe(204);
      expect(performance.now() - t0).toBeLessThan(50);
    }
    await vi.waitFor(async () => expect(Object.keys((await state()).tasks)).toHaveLength(6));
    expect(Object.keys((await state()).buildings).sort()).toEqual(['w1:backend-dev', 'w1:qa-reviewer']);
    expect(count(`project = '${ID}'`)).toBe(lines.length + 1); // + 빈 roster (폴더 없음 → 팀장만)
    const list = (await (await fetch(url('/api/projects'))).json()) as { id: string; cwd: string }[];
    expect(list.map((p) => p.cwd)).not.toContain('/work/my-shop-app'); // 폴더가 없으면 목록에서 숨김 (D32)
    expect((await fetch(url(`/api/projects/${ID}/state`))).status).toBe(200); // 기록·상태는 그대로
  });

  it('마을 목록은 폴더가 있는 마을만: 지우면 빠지고 다시 만들면 돌아온다 (D32)', async () => {
    const cwd = join(tmp, 'gone-project');
    mkdirSync(cwd);
    await post(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'gone', cwd }));
    const cwds = async () =>
      ((await (await fetch(url('/api/projects'))).json()) as { cwd: string }[]).map((p) => p.cwd);
    await vi.waitFor(async () => expect(await cwds()).toContain(cwd));
    rmSync(cwd, { recursive: true });
    expect(await cwds()).not.toContain(cwd);
    mkdirSync(cwd);
    expect(await cwds()).toContain(cwd);
  });

  it('같은 이벤트를 다시 보내도 두 번 저장하지 않는다', async () => {
    const before = count(`project = '${ID}'`);
    for (const line of lines) await post(line);
    await settle();
    expect(count(`project = '${ID}'`)).toBe(before);
  });

  it('깨진 JSON·배열·1MB 초과·밖에서 온 내부 이벤트도 204, 서버는 살아 있다', async () => {
    const forged = (hook: string) =>
      JSON.stringify({ _t: '2026-09-29T13:30:00.000Z', hook_event_name: hook, cwd: '/work/my-shop-app' });
    for (const body of ['{not json', '[]', 'null', '', 'x'.repeat((1 << 20) + 1), forged('roster'), forged('clock')])
      expect((await post(body)).status).toBe(204);
    await settle();
    expect(await (await fetch(url('/health'))).text()).toBe('ok');
    expect(count(`project = '${ID}' AND hook IN ('roster', 'clock')`)).toBe(1); // 처음 빈 roster 하나뿐
  });

  it('SessionStart → .claude/agents와 tycoon.json을 읽어 roster 기록, 바뀔 때만', async () => {
    const cwd = join(tmp, 'proj');
    cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
    cpSync(join(root, 'examples/target-project/.claude/tycoon.sea.json'), join(cwd, '.claude/tycoon.json'));
    const id = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const start = (sec: number) =>
      post(
        JSON.stringify({ _t: `2026-09-29T14:00:0${sec}.000Z`, hook_event_name: 'SessionStart', session_id: 'r', cwd }),
      );
    const rosters = () => count(`project = '${id}' AND hook = 'roster'`);

    await start(1);
    await vi.waitFor(() => expect(rosters()).toBe(1));
    const s = await state(id);
    expect(Object.keys(s.members).sort()).toEqual(['@leader', 'backend-dev', 'frontend-dev', 'qa-reviewer']);
    expect(s.members['backend-dev']?.species).toBe('bear'); // 바다 id(seal) → 정본 id

    await start(2); // 그대로면 기록 안 함
    await settle();
    expect(rosters()).toBe(1);

    rmSync(join(cwd, '.claude/agents/qa-reviewer.md'));
    await start(3);
    await vi.waitFor(() => expect(rosters()).toBe(2));
    // 한 번도 일하지 않은(입주 전) 팀원은 md가 사라지면 목록에서 빠진다 (01 문서 3.1-1, D9)
    expect((await state(id)).members['qa-reviewer']).toBeUndefined();

    // 세션 도중에 에이전트를 추가하면 다음 프롬프트에 목록에 오른다 (01 문서 3.1-1)
    writeFileSync(join(cwd, '.claude/agents/pm.md'), '---\nname: pm\ndescription: 계획\n---\n');
    await post(
      JSON.stringify({
        _t: '2026-09-29T14:00:04.000Z',
        hook_event_name: 'UserPromptSubmit',
        session_id: 'r',
        cwd,
        prompt: 'x',
      }),
    );
    await vi.waitFor(() => expect(rosters()).toBe(3));
    expect((await state(id)).members.pm).toMatchObject({ fromMd: true, movedInAt: null });
    // 메인 턴을 닫아 둔다 (다음 테스트는 이 마을이 쉬는 중이라고 본다)
    await post(JSON.stringify({ _t: '2026-09-29T14:00:04.500Z', hook_event_name: 'Stop', session_id: 'r', cwd }));
    await settle();
  });

  it('게임 시계: 일하는 마을에만 clock 줄(→ Tick), 진짜 이벤트가 상한(10분)보다 오래 끊기면 멈춤 (01 문서 6.2)', () => {
    const last = Date.parse('2026-09-29T13:27:00.000Z'); // 픽스처 마지막 훅(Stop). a3 실행은 아직 열려 있다
    const clocks = (id = ID) => count(`project = '${id}' AND hook = 'clock'`);
    const before = srv.store.villages.get(ID)?.state.clock.activeMs ?? NaN;
    srv.store.tick(last + 60_000);
    expect(clocks()).toBe(1);
    expect(srv.store.villages.get(ID)?.state.clock).toMatchObject({ activeMs: before + 60_000, day: 0 });
    // 상한 끝(열린 a3의 마지막 이벤트 13:26:10 + 10분)을 넘긴 첫 줄은 하나 넣는다 — 끝을 잃은 실행이 '일하는 중'으로 남지 않게.
    // 시간은 상한까지만 늘고, 그 뒤로는 넣지 않는다
    srv.store.tick(last + 600_000);
    expect(clocks()).toBe(2);
    expect(srv.store.villages.get(ID)?.state.clock.activeMs).toBe(before + 550_000);
    srv.store.tick(last + 700_000);
    expect(clocks()).toBe(2);
    // 쉬는 마을(SessionStart만: 열린 실행·메인 턴 없음)엔 넣지 않는다
    srv.store.tick(Date.parse('2026-09-29T14:00:04.000Z'));
    expect(clocks(projectId(join(tmp, 'proj')))).toBe(0);
  });

  it("옛 DB의 'clock' 줄(벽시계 day)은 Tick으로 재생 — 날은 활동 시간으로만 (01 문서 6.2)", () => {
    const path = join(tmp, 'old.db');
    const cwd = '/work/old';
    const id = projectId(cwd);
    const db = openDb(path);
    const line = (t: string, hook: string, extra: object = {}) =>
      db.insert(id, { _t: `2026-09-01T${t}:00.000Z`, hook_event_name: hook, session_id: 'o', cwd, ...extra }, null);
    line('09:00', 'SessionStart');
    line('10:00', 'clock', { day: 1 }); // M7 수집기가 벽시계로 만든 줄 — 쉬는 동안
    line('10:05', 'SubagentStart', { agent_id: 'a1', agent_type: 'Explore' });
    line('11:05', 'clock', { day: 2 }); // 실행이 열린 채 1시간 → 상한 10분만
    db.close();
    const mem = createStore(path, () => {});
    mem.rebuild();
    const s = mem.villages.get(id)?.state;
    expect(s?.clock).toMatchObject({ day: 0, activeMs: 600_000, now: Date.parse('2026-09-01T11:05:00.000Z') });
    expect(s?.economy.history).toEqual([]);
    mem.close();
  });

  it("사용자 행동('ui' 줄)은 시계 줄 상한을 다시 열지 않는다 — 방치형 게임 클릭이 날을 흘리지 않게 (01 문서 6.2, 리뷰)", () => {
    let changes = 0;
    const mem = createStore(join(tmp, 'ui.db'), () => changes++);
    const cwd = '/work/orphan';
    // 중단된 턴(Stop 없음) + SubagentStop을 잃은 실행 — 마지막 훅 이벤트에서 10분이 한참 지났다
    const hook = (hook_event_name: string, extra = {}) =>
      mem.ingest({ _t: '2026-09-29T13:00:00.000Z', hook_event_name, session_id: 'u', cwd, ...extra });
    hook('UserPromptSubmit');
    hook('SubagentStart', { agent_id: 'z', agent_type: 'Explore' });
    mem.ui(projectId(cwd), { kind: 'rename', buildingId: 'nope', name: 'x' });
    const before = changes;
    mem.tick(Date.now() + 1000);
    expect(changes).toBe(before);
    mem.close();
  });

  it('SSE: 접속하자마자 설정(config) + 전체 스냅샷, 설정은 바뀔 때만 다시 (02 문서 9장)', async () => {
    const cwd = join(tmp, 'cfg');
    const id = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const tycoon = (over: object) =>
      writeFileSync(join(cwd, '.claude/tycoon.json'), JSON.stringify({ overrides: { buildings: over } }));
    cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
    tycoon({ cheerMs: 1500 });
    const hook = (name: string, sec: number) =>
      post(JSON.stringify({ _t: `2026-09-29T15:00:0${sec}.000Z`, hook_event_name: name, session_id: 'cfg', cwd }));
    await hook('SessionStart', 1);
    await vi.waitFor(async () => expect((await fetch(url(`/api/projects/${id}/state`))).status).toBe(200));

    const ac = new AbortController();
    const reader = (await fetch(url(`/api/projects/${id}/stream`), { signal: ac.signal })).body?.getReader();
    let seen = '';
    /** 스냅샷 n개를 받을 때까지 모은다 */
    const until = async (n: number) => {
      while ((seen.match(/event: state/g) ?? []).length < n) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        seen += new TextDecoder().decode(chunk.value);
      }
    };
    await until(1);
    expect(seen).toMatch(/^event: config\ndata: \{.*"cheerMs":1500.*\n\nevent: state\ndata: \{"project":/s);
    await hook('Stop', 2); // 설정 그대로 → 스냅샷만
    await until(2);
    expect(seen.match(/event: config/g)).toHaveLength(1);
    tycoon({ cheerMs: 2500 }); // tycoon.json을 고치고 새 세션 → roster → 설정 다시
    await hook('SessionStart', 3);
    await until(4);
    ac.abort();
    expect(seen.match(/event: config/g)).toHaveLength(2);
    expect(seen.slice(seen.lastIndexOf('event: config'))).toContain('"cheerMs":2500');
  });

  it('건물 이름 바꾸기: ui 줄로 기록 → 투영 → SSE로 보냄, 잘못된 본문 400, 없는 마을·건물 404 (02 문서 9장)', async () => {
    const bid = 'w1:qa-reviewer';
    const put = (body: string, id = ID, b = bid) =>
      fetch(url(`/api/projects/${id}/buildings/${encodeURIComponent(b)}/name`), { method: 'PUT', body });
    const uiRows = () => count(`project = '${ID}' AND hook = 'ui'`);

    const ac = new AbortController();
    const res = await fetch(url(`/api/projects/${ID}/stream`), { signal: ac.signal });
    const reader = res.body?.getReader();
    expect((await put(JSON.stringify({ name: '  로그인   마을 ' }))).status).toBe(204);
    let seen = '';
    while (!seen.includes('"name":"로그인 마을"')) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      seen += new TextDecoder().decode(chunk.value);
    }
    ac.abort();
    expect((await state()).buildings[bid]).toMatchObject({ name: '로그인 마을' });
    expect(uiRows()).toBe(1);

    const bad = ['{not json', '', 'null', '[]', '5', '{}', '{"name":""}', '{"name":"   "}', '{"name":5}'];
    for (const body of [...bad, JSON.stringify({ name: 'x'.repeat(25) })]) expect((await put(body)).status).toBe(400);
    const ok = JSON.stringify({ name: 'x' });
    expect((await put(ok, '-work-nope')).status).toBe(404);
    expect((await put(ok, ID, 'b999')).status).toBe(404);
    expect((await put(ok, ID, '__proto__')).status).toBe(404);
    // 콜론을 인코딩하지 않은 id도 같은 일터 (본문이 틀려 400 = 일터는 찾았다), 깨진 % 인코딩은 404
    const rawPut = (b: string, body: string) =>
      fetch(url(`/api/projects/${ID}/buildings/${b}/name`), { method: 'PUT', body });
    expect((await rawPut(bid, '{"name":""}')).status).toBe(400);
    expect((await rawPut('w1%3', ok)).status).toBe(404);
    expect((await rawPut('%E0%A4%A', ok)).status).toBe(404);
    const host = `127.0.0.1:${srv.port}`;
    expect(
      await raw(
        `/api/projects/${ID}/buildings/${encodeURIComponent(bid)}/name`,
        { host, origin: 'https://evil.example' },
        'PUT',
      ),
    ).toBe(403);
    // 밖에서 온 ui 줄(위조)은 버린다
    await post(
      JSON.stringify({
        _t: '2026-09-29T13:40:00.000Z',
        hook_event_name: 'ui',
        kind: 'rename',
        buildingId: bid,
        name: '위조',
        session_id: 'x',
        cwd: '/work/my-shop-app',
      }),
    );
    await settle();
    expect(uiRows()).toBe(1);
    expect((await state()).buildings[bid]?.name).toBe('로그인 마을');
  });

  it('가구 사기: ui 줄 → 투영, 400·404·409, 밖에서 온 ui 줄은 버림, replay도 같다 (02 문서 9장)', async () => {
    const cwd = join(tmp, 'shop');
    const id = projectId(cwd);
    cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
    await post(
      JSON.stringify({ _t: '2026-09-30T10:00:00.000Z', hook_event_name: 'SessionStart', session_id: 'shop', cwd }),
    );
    await vi.waitFor(async () => expect((await state(id)).members['backend-dev']).toBeDefined());
    // 가구는 입주한 팀원만 산다 (01 문서 3.3): 첫 프롬프트 = 마을 세우기(팀장 입주), 서브에이전트 시작 = 팀원 입주
    const hook = (e: Record<string, unknown>) => post(JSON.stringify({ session_id: 'shop', cwd, ...e }));
    // 입주 지원금이 없어(D20) 급여로 잔고를 만든다: 실행이 도구 n번 → 끝나면 26 × n − 세금 20% (실행마다, 작업 없이도)
    // backend-dev 15번 = 312, frontend-dev 60번 = 1,248, 세금 78 + 312 = 기금 390
    await hook({ hook_event_name: 'UserPromptSubmit', prompt: '가구 사기' });
    const tools = [15, 60, 0];
    for (const [i, agent_type] of ['backend-dev', 'frontend-dev', 'qa-reviewer'].entries()) {
      const agent_id = `shop-${i}`;
      await hook({ hook_event_name: 'SubagentStart', agent_id, agent_type });
      for (let k = 0; k < (tools[i] ?? 0); k++)
        await hook({ hook_event_name: 'PostToolUse', agent_id, agent_type, tool_name: 'Read', tool_input: {} });
      await hook({ hook_event_name: 'SubagentStop', agent_id, agent_type });
    }
    await vi.waitFor(async () => expect((await state(id)).members['qa-reviewer']?.movedInAt).not.toBeNull());
    const buy = (body: string, p = id) => fetch(url(`/api/projects/${p}/purchase`), { method: 'POST', body });
    const b = (memberId: string, kind: string, fabric?: unknown) => JSON.stringify({ memberId, kind, fabric });
    const uiRows = () => count(`project = '${id}' AND hook = 'ui'`);

    expect((await buy(b('backend-dev', 'armchair', 'coral'))).status).toBe(204);
    expect((await buy(b('@leader', 'desk'))).status).toBe(204); // fabric 없음 = null
    const s = await state(id);
    expect(s.members['backend-dev']).toMatchObject({ balance: 12 }); // 312 − 300
    expect(s.members['backend-dev']?.furniture).toMatchObject([
      { kind: 'armchair', fabric: 'coral', price: 300, by: 'user', placed: { x: 0, y: 0, rot: 0 } },
    ]);
    expect(s.members['@leader']?.furniture).toMatchObject([{ kind: 'desk', fabric: null, price: 260 }]);
    expect(s.members['@leader']?.balance).toBe(0); // 팀장 가구는 기금에서 (D21)
    expect(s.economy.fund).toBe(390 - 260);
    expect(s.economy.today).toMatchObject({ purchases: 300, leaderPurchases: 260 }); // 팀장 가구는 기금 지출로 따로
    expect(uiRows()).toBe(2);

    const cases: [string, number][] = [
      ['{not json', 400],
      ['', 400],
      ['null', 400],
      ['[]', 400],
      [JSON.stringify({ kind: 'desk' }), 400],
      [b('qa-reviewer', 'desk', 5), 400],
      [b('qa-reviewer', 'armchair'), 400], // 천 가구인데 색 없음
      [b('qa-reviewer', 'armchair', 'pink'), 400],
      [b('qa-reviewer', 'desk', 'coral'), 400], // 천 가구가 아닌데 색
      [b('nobody', 'desk'), 404],
      [b('__proto__', 'desk'), 404],
      [b('qa-reviewer', 'sofa'), 409],
      [b('qa-reviewer', 'constructor'), 409],
      [b('qa-reviewer', 'bed', 'blue'), 409], // 잔고 0 (일한 적 없음)
      [b('backend-dev', 'plant'), 409], // 잔고 12
    ];
    for (const [body, code] of cases) expect([body, (await buy(body)).status]).toEqual([body, code]);
    expect(uiRows()).toBe(2); // 잔고 부족(409)을 포함해 거절된 구매는 줄을 남기지 않는다 (재생은 줄을 믿으므로, 06 문서 3.5)
    expect((await buy(b('qa-reviewer', 'desk'), '-work-nope')).status).toBe(404);
    const host = `127.0.0.1:${srv.port}`;
    expect(await raw(`/api/projects/${id}/purchase`, { host, origin: 'https://evil.example' }, 'POST')).toBe(403);
    // 밖에서 온 ui 줄(위조)은 버린다
    await post(
      JSON.stringify({ hook_event_name: 'ui', kind: 'purchase', memberId: 'qa-reviewer', furniture: 'plant', cwd }),
    );
    await settle();
    expect(uiRows()).toBe(2);

    rmSync(join(cwd, '.claude/agents/qa-reviewer.md'));
    await post(
      JSON.stringify({ _t: '2026-09-30T10:00:05.000Z', hook_event_name: 'SessionStart', session_id: 'shop', cwd }),
    );
    await vi.waitFor(async () => expect((await state(id)).members['qa-reviewer']?.departed).toBe(true));
    expect((await buy(b('qa-reviewer', 'desk'))).status).toBe(409);

    const before = await state(id);
    expect(await (await fetch(url(`/api/projects/${id}/replay`), { method: 'POST' })).json()).toEqual(before);
  });

  it('가구 옮기기: 놓을 수 있는 자리·창고 204, 모양 400, 없는 팀원·가구 404, 겹침·방 밖·벽 409 (01 문서 8.4)', async () => {
    const id = projectId(join(tmp, 'shop'));
    const uiRows = () => count(`project = '${id}' AND hook = 'ui'`);
    const [chair] = (await state(id)).members['backend-dev']?.furniture ?? [];
    const [desk] = (await state(id)).members['@leader']?.furniture ?? [];
    const put = (mid: string, fid: string, body: unknown, p = id) =>
      fetch(url(`/api/projects/${p}/members/${mid}/furniture/${fid}`), {
        method: 'PUT',
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    const where = async (mid: string, fid = '') =>
      (await state(id)).members[mid]?.furniture.find((f) => f.id === fid)?.placed;
    const rows = uiRows();

    expect((await put('backend-dev', chair?.id ?? '', { placed: { x: 2, y: 3, rot: 0 } })).status).toBe(204);
    expect(await where('backend-dev', chair?.id)).toEqual({ x: 2, y: 3, rot: 0 });
    expect((await put('%40leader', desk?.id ?? '', { placed: null })).status).toBe(204); // 창고, URL 디코드
    expect(await where('@leader', desk?.id)).toBeNull();
    expect(uiRows()).toBe(rows + 2);

    const bad: [string, string, unknown, number][] = [
      ['backend-dev', chair?.id ?? '', '{not json', 400],
      ['backend-dev', chair?.id ?? '', {}, 400],
      ['backend-dev', chair?.id ?? '', { placed: { x: 1.5, y: 0, rot: 0 } }, 400],
      ['backend-dev', chair?.id ?? '', { placed: { x: 1, y: 0, rot: 2 } }, 400],
      ['backend-dev', chair?.id ?? '', { placed: { x: 6, y: 0, rot: 0 } }, 409],
      ['backend-dev', chair?.id ?? '', { placed: { x: 1, y: 0, rot: 1 } }, 409], // 1×1은 rot 0만
      ['backend-dev', 'f999', { placed: null }, 404],
      ['nobody', chair?.id ?? '', { placed: null }, 404],
      ['__proto__', chair?.id ?? '', { placed: null }, 404],
      ['%E0%A4%A', chair?.id ?? '', { placed: null }, 404],
    ];
    for (const [mid, fid, body, code] of bad)
      expect([mid, body, (await put(mid, fid, body)).status]).toEqual([mid, body, code]);
    expect((await put('backend-dev', chair?.id ?? '', { placed: null }, '-work-nope')).status).toBe(404);
    // 겹침·벽: frontend-dev(잔고 1,248)가 책장(220 → 벽 줄 첫 칸 0,0)과 화분(80 → 0,1)을 산다
    const buy = (kind: string) =>
      fetch(url(`/api/projects/${id}/purchase`), {
        method: 'POST',
        body: JSON.stringify({ memberId: 'frontend-dev', kind }),
      });
    expect([(await buy('bookcase')).status, (await buy('plant')).status]).toEqual([204, 204]);
    const [shelf, plant] = (await state(id)).members['frontend-dev']?.furniture ?? [];
    expect([shelf?.placed, plant?.placed]).toEqual([
      { x: 0, y: 0, rot: 0 },
      { x: 0, y: 1, rot: 0 },
    ]);
    expect((await put('frontend-dev', plant?.id ?? '', { placed: { x: 0, y: 0, rot: 0 } })).status).toBe(409);
    expect((await put('frontend-dev', shelf?.id ?? '', { placed: { x: 3, y: 3, rot: 0 } })).status).toBe(409); // 벽 줄 아님
    expect((await put('frontend-dev', shelf?.id ?? '', { placed: { x: 2, y: 0, rot: 0 } })).status).toBe(204);
    expect(uiRows()).toBe(rows + 5); // 옮기기 3 + 사기 2 (거절은 기록 안 함)
    const host = `127.0.0.1:${srv.port}`;
    expect(
      await raw(
        `/api/projects/${id}/members/backend-dev/furniture/${chair?.id ?? ''}`,
        { host, origin: 'https://evil.example' },
        'PUT',
      ),
    ).toBe(403);

    const before = await state(id);
    expect(await (await fetch(url(`/api/projects/${id}/replay`), { method: 'POST' })).json()).toEqual(before);
  });

  it('경제 패널: 마지막 기록의 day에서 게임 7일·30일 안, all·없음은 전부, 다른 range 400 (02 문서 9장)', async () => {
    await post(
      JSON.stringify({
        _t: '2026-09-30T11:00:00.000Z',
        hook_event_name: 'Stop',
        session_id: 'econ',
        cwd: '/work/econ',
      }),
    );
    await vi.waitFor(() => expect(srv.store.villages.get('-work-econ')).toBeDefined());
    const v = srv.store.villages.get('-work-econ');
    if (!v) throw new Error('no village');
    // ponytail: 기록은 economy.ts 정산이 만든다. 여기선 range 자르기만 보려고 메모리 상태에 직접 넣는다
    const all = Array.from({ length: 40 }, (_, i) => ({
      day: i + 1,
      at: 0,
      wages: 0,
      tax: 0,
      purchases: 0,
      tokens: 0,
      leaderTokens: 0,
      leaderUnpaid: 0,
      leaderPurchases: 0,
      materials: 0,
      works: 0,
      fund: 0,
      balances: {},
    }));
    v.days = all.slice(0, 15); // 상태에서 옮겨 둔 옛 기록 (HISTORY_KEEP) — all에만 붙는다
    v.state.economy.history = all.slice(15);
    const get = async (q: string) => {
      const res = await fetch(url(`/api/projects/-work-econ/economy${q}`));
      return {
        status: res.status,
        body: res.status === 200 ? ((await res.json()) as { history: { day: number }[] }) : null,
      };
    };
    const days = async (q: string) => (await get(q)).body?.history.map((r) => r.day);
    expect(await days('?range=7d')).toEqual([34, 35, 36, 37, 38, 39, 40]);
    expect((await days('?range=30d'))?.[0]).toBe(11);
    expect(await days('?range=all')).toEqual(all.map((r) => r.day));
    expect(await days('')).toHaveLength(40);
    expect((await get('?range=1y')).status).toBe(400);
    expect((await get('?range=constructor')).status).toBe(400);
    expect((await fetch(url('/api/projects/-work-nope/economy?range=7d'))).status).toBe(404);
    const body = (await get('?range=7d')).body;
    expect(body).toMatchObject({
      fund: 0,
      deficit: false,
      members: [{ id: '@leader', balance: 0, hardship: false }], // 아직 일하지 않은 마을: 팀장도 입주 전 (01 문서 3.3)
    });
    expect(body).not.toHaveProperty('plaza'); // 광장 소품 → 공공시설 (06 문서 6.4)
    expect(body).not.toHaveProperty('priceIndex'); // 물가·금리 없음 (D20)
    expect(body).not.toHaveProperty('rate');
  });

  it('경제 기록은 상태에 최근 HISTORY_KEEP일만, 옛날은 Village.days로 (한 줄에 100일을 넘어도, 재생도 같다)', () => {
    const cwd = join(tmp, 'long');
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(join(cwd, '.claude/tycoon.json'), JSON.stringify({ overrides: { time: { gameDayMs: 1000 } } }));
    const mem = createStore(join(tmp, 'long.db'), () => {});
    const t0 = Date.parse('2026-09-30T00:00:00.000Z');
    mem.ingest({ _t: new Date(t0).toISOString(), hook_event_name: 'SessionStart', session_id: 'long', cwd });
    // 실행이 열린 채 시계 줄 하나가 100초 뒤 → 활동 100초 = 100일 (01 문서 6.2)
    mem.ingest({
      _t: new Date(t0).toISOString(),
      hook_event_name: 'SubagentStart',
      session_id: 'long',
      cwd,
      agent_id: 'a1',
    });
    mem.tick(t0 + 100 * 1000);
    const v = mem.villages.get(projectId(cwd));
    expect(v?.state.economy.history.map((r) => r.day)).toEqual(Array.from({ length: HISTORY_KEEP }, (_, i) => i + 41));
    expect(v?.days.map((r) => r.day)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    const [state, days] = [v?.state, v?.days];
    mem.rebuild();
    expect(mem.villages.get(projectId(cwd))).toMatchObject({ state, days });
    mem.close();
  });

  it('설정 저장: 타이쿤 저장 공간에 정본 id로 합쳐 쓰고 백업, 프로젝트 폴더는 안 건드림, roster를 다시 읽는다, 400·404·409 (01 문서 10장·D14, 02 문서 9장)', async () => {
    const cwd = join(tmp, 'settings');
    const id = projectId(cwd);
    const legacy = join(cwd, '.claude/tycoon.json'); // 옛 방식으로 프로젝트에 있던 설정 — 읽기만
    const file = join(dirname(dbPath), 'settings', `${id}.json`);
    cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
    cpSync(join(root, 'examples/target-project/.claude/tycoon.sea.json'), legacy);
    const original = readFileSync(legacy, 'utf8');
    const project = () => readdirSync(join(cwd, '.claude'), { recursive: true }).map(String).sort();
    const projectBefore = project();
    await post(
      JSON.stringify({ _t: '2026-09-30T11:00:00.000Z', hook_event_name: 'SessionStart', session_id: 'set', cwd }),
    );
    await vi.waitFor(async () => expect((await state(id)).members['backend-dev']).toBeDefined());
    const put = (body: unknown, p = id) =>
      fetch(url(`/api/projects/${p}/settings`), {
        method: 'PUT',
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    const rosters = () => count(`project = '${id}' AND hook = 'roster'`);
    const before = rosters();

    const res = await put({
      members: { 'backend-dev': { species: 'otter', job: 'qa', accessory: 'starfishPin' } }, // 바다 id
      leader: { species: 'seal', job: 'lead', accessory: null },
      gameDayMs: 600_000,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: file, backup: null }); // 우리 파일은 처음 → 백업 없음
    expect(readFileSync(legacy, 'utf8')).toBe(original); // 프로젝트의 옛 파일은 그대로
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      members: Record<string, unknown>;
      leader: unknown;
      $comment: string;
    };
    expect(saved.members['backend-dev']).toEqual({ species: 'rabbit', job: 'qa', accessory: 'beret' }); // 정본 id
    expect(saved.members['qa-reviewer']).toEqual({ species: 'hamster', job: 'qa' }); // 안 보낸 팀원은 그대로
    expect(saved.leader).toEqual({ species: 'bear', job: 'lead', accessory: null, label: '팀장' });
    expect(saved).toMatchObject({
      theme: 'sea',
      projectName: 'my-shop-app',
      overrides: { time: { gameDayMs: 600_000 } },
    });
    expect(saved.$comment).toContain('바다 테마 예시');
    expect(rosters()).toBe(before + 1);
    const s = await state(id);
    expect(s.members['backend-dev']).toMatchObject({ species: 'rabbit', job: 'qa', accessory: 'beret' });
    expect(s.members['@leader']).toMatchObject({ species: 'bear', accessory: null });
    expect(s.clock.dayMs).toBe(600_000);
    // 같은 값을 또 쓰면 roster는 그대로(바뀔 때만), 백업은 직전 내용
    const now = readFileSync(file, 'utf8');
    expect((await put({ members: { 'backend-dev': { species: 'bear', job: 'qa', accessory: 'beret' } } })).status).toBe(
      200,
    );
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe(now);
    expect(rosters()).toBe(before + 2);
    expect((await put({})).status).toBe(200);
    expect(rosters()).toBe(before + 2);

    const bad: [unknown, number][] = [
      ['{not json', 400],
      ['null', 400],
      [{ members: [] }, 400],
      [{ members: { 'backend-dev': { species: 'fox', job: 'qa', accessory: null } } }, 400],
      [{ members: { 'backend-dev': { species: 'visitor', job: 'qa', accessory: null } } }, 400],
      [{ members: { 'backend-dev': { species: 'bear', job: 'chef', accessory: null } } }, 400],
      [{ members: { 'backend-dev': { species: 'bear', job: 'qa', accessory: 'seaWalkHelmet' } } }, 400],
      [{ members: { 'backend-dev': { species: 'bear', job: 'qa' } } }, 400], // 소품 없음은 null로
      [{ gameDayMs: 1000 }, 400],
      [{ gameDayMs: 90_000.5 }, 400],
      [{ gameDayMs: '600000' }, 400],
      [{ members: { nobody: { species: 'bear', job: 'qa', accessory: null } } }, 404],
      [{ members: { '@leader': { species: 'bear', job: 'qa', accessory: null } } }, 404], // 팀장은 leader로
      ['{"members":{"__proto__":{"species":"bear","job":"qa","accessory":null}}}', 404],
      [{ members: { constructor: { species: 'bear', job: 'qa', accessory: null } } }, 404],
    ];
    for (const [body, status] of bad) expect([body, (await put(body)).status]).toEqual([body, status]);
    expect((await put({}, 'nope')).status).toBe(404);
    // 우리 파일이 생기면 프로젝트의 옛 파일은 더 안 읽는다
    writeFileSync(legacy, JSON.stringify({ members: { 'qa-reviewer': { species: 'bear', job: 'backend' } } }));
    // 손으로 적은 목록 밖 값("devops")도 그 팀원의 지금 값과 같으면 받는다 → 다른 칸만 바꿀 수 있다 (M9 리뷰)
    const hand = JSON.parse(readFileSync(file, 'utf8')) as { members: Record<string, unknown> };
    hand.members['qa-reviewer'] = { species: 'raccoon', job: 'devops' };
    writeFileSync(file, JSON.stringify(hand));
    await post(
      JSON.stringify({ _t: '2026-09-30T11:05:00.000Z', hook_event_name: 'SessionStart', session_id: 'set', cwd }),
    );
    await vi.waitFor(async () => expect((await state(id)).members['qa-reviewer']?.job).toBe('devops'));
    const qa = (job: string) => ({ members: { 'qa-reviewer': { species: 'bear', job, accessory: null } } });
    expect((await put(qa('devops'))).status).toBe(200);
    expect((await put(qa('sre'))).status).toBe(400); // 지금 값도 목록도 아님
    // 쓰기가 실패하면(읽기 전용 폴더) 500, 파일은 그대로, 임시 파일을 남기지 않는다
    const before500 = readFileSync(file, 'utf8');
    chmodSync(dirname(file), 0o555);
    const failed = await put({ gameDayMs: 120_000 });
    chmodSync(dirname(file), 0o755);
    expect(failed.status).toBe(500);
    expect(readFileSync(file, 'utf8')).toBe(before500);
    expect(readdirSync(dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // 깨진 파일은 덮어쓰지 않는다
    writeFileSync(file, '{ "members": ');
    expect(await (await put({ gameDayMs: 60_000 })).json()).toEqual({ error: 'unreadable' });
    expect(readFileSync(file, 'utf8')).toBe('{ "members": ');
    // .claude 폴더가 없는 마을(픽스처 cwd)도 저장된다 — 우리 저장 공간에 쓰니까
    const r = await put({ gameDayMs: 60_000 }, ID);
    expect([r.status, await r.json()]).toEqual([
      200,
      { path: join(dirname(dbPath), 'settings', `${ID}.json`), backup: null },
    ]);
    // 프로젝트 폴더에는 아무것도 생기거나 바뀌지 않았다 (옛 파일은 위에서 테스트가 직접 고친 것뿐)
    expect(project()).toEqual(projectBefore);
    // 재생도 같다 (roster 줄로 남음)
    const live = await state(id);
    expect(await (await fetch(url(`/api/projects/${id}/replay`), { method: 'POST' })).json()).toEqual(live);
  });

  it('토큰 비용 (D11): 훅의 기록 파일 경로로 서브에이전트·팀장 몫을 읽어 낸다, 본문에 끼운 tokens는 무시, 요약본엔 숫자만', async () => {
    const cwd = join(tmp, 'tokens');
    const id = projectId(cwd);
    cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
    const main = join(tmp, 'tk-session.jsonl');
    const usage = (id: string, output: number, side = false) =>
      `${JSON.stringify({ isSidechain: side, message: { id, content: '비밀 대화', usage: { output_tokens: output } } })}\n`;
    writeFileSync(main, usage('m1', 20_000)); // 팀장 100,000 → 진주 100
    mkdirSync(join(tmp, 'tk-session', 'subagents'), { recursive: true });
    writeFileSync(join(tmp, 'tk-session', 'subagents', 'agent-tk1.jsonl'), usage('x1', 60_000, true)); // 300,000 → 300
    const hook = (e: Record<string, unknown>) =>
      post(JSON.stringify({ session_id: 'tk', cwd, transcript_path: main, ...e }));
    await hook({ hook_event_name: 'SessionStart' });
    await hook({ hook_event_name: 'UserPromptSubmit', prompt: '토큰' });
    await hook({ hook_event_name: 'SubagentStart', agent_id: 'tk1', agent_type: 'backend-dev' });
    // 급여를 먼저 벌어 둔다 (D20 입주 지원금 없음): 도구 15번 → 390, 세금 78. 급여를 낸 뒤 토큰을 청구한다
    for (let k = 0; k < 15; k++)
      await hook({ hook_event_name: 'PostToolUse', agent_id: 'tk1', agent_type: 'backend-dev', tool_name: 'Read' });
    await hook({
      hook_event_name: 'SubagentStop',
      agent_id: 'tk1',
      agent_type: 'backend-dev',
      tokens: { output: 1e9 },
    });
    await hook({ hook_event_name: 'Stop' });
    await vi.waitFor(async () => expect((await state(id)).members['@leader']?.tokens).toBe(100_000));
    const s = await state(id);
    // 팀원: 312 − 토큰 300 = 12. 팀장: 기금 78로 100 중 78만 내고 22는 못 냄 → 시청 적자 (D21)
    expect(s.members['backend-dev']).toMatchObject({ balance: 12, tokens: 300_000, hardship: false });
    expect(s.economy).toMatchObject({
      fund: 0,
      deficit: true,
      today: { wages: 390, tax: 78, tokens: 300, leaderTokens: 78, leaderUnpaid: 22 },
    });
    expect(await (await fetch(url(`/api/projects/${id}/economy`))).json()).toMatchObject({ fund: 0, deficit: true });
    // 기록에 남는 건 숫자 4개뿐 (대화 내용·가짜 값 없음)
    const db = new DatabaseSync(dbPath);
    const rows = db
      .prepare(`SELECT payload FROM raw_events WHERE project = ? AND hook IN ('SubagentStop', 'Stop')`)
      .all(id) as { payload: string }[];
    db.close();
    expect(rows.map((r) => (JSON.parse(r.payload) as { tokens?: unknown }).tokens)).toEqual([
      { input: 0, output: 60_000, cacheWrite: 0, cacheRead: 0 },
      { input: 0, output: 20_000, cacheWrite: 0, cacheRead: 0 },
    ]);
    expect(rows.some((r) => r.payload.includes('비밀'))).toBe(false);
    // 메인 기록이 자라면 다음 Stop은 새로 쓴 몫만 (20,000 → 30,000: 50,000 → 진주 50, 기금이 비어 다 못 냄)
    appendFileSync(main, usage('m2', 10_000));
    await hook({ hook_event_name: 'Stop' });
    await vi.waitFor(async () => expect((await state(id)).members['@leader']?.tokens).toBe(150_000));
    expect((await state(id)).economy.today).toMatchObject({ leaderTokens: 78, leaderUnpaid: 72 });
    // 이어 받은 서브에이전트(같은 agent_id, 01 문서 6.1): 수집기는 기록 파일 누적(80,000)을 붙이고, 뒤 구간은 늘어난 몫만 낸다
    appendFileSync(join(tmp, 'tk-session', 'subagents', 'agent-tk1.jsonl'), usage('x2', 20_000, true));
    await hook({ hook_event_name: 'SubagentStart', agent_id: 'tk1', agent_type: 'backend-dev' });
    await hook({ hook_event_name: 'SubagentStop', agent_id: 'tk1', agent_type: 'backend-dev' });
    await vi.waitFor(async () => expect((await state(id)).runs['tk1#2']?.tokens).toBe(100_000));
    const again = await state(id);
    expect(again.members['backend-dev']?.tokens).toBe(400_000);
    expect(again.runs.tk1).not.toHaveProperty('cum'); // 누적은 수집기 안에만
    const db2 = new DatabaseSync(dbPath);
    const last = db2
      .prepare(`SELECT payload FROM raw_events WHERE project = ? AND hook = 'SubagentStop' ORDER BY seq DESC LIMIT 1`)
      .get(id) as { payload: string };
    db2.close();
    expect((JSON.parse(last.payload) as { tokens: { output: number } }).tokens.output).toBe(80_000);
  });

  it('없는 경로 404, replay는 같은 상태 (이름 바꾸기 포함)', async () => {
    expect((await fetch(url('/nope'))).status).toBe(404);
    expect((await fetch(url(`/api/projects/${ID}/buildings/b1/name/x`), { method: 'PUT' })).status).toBe(404);
    const before = await state();
    expect(Object.values(before.buildings)[0]?.name).toBe('로그인 마을');
    expect(await (await fetch(url(`/api/projects/${ID}/replay`), { method: 'POST' })).json()).toEqual(before);
  });

  it('다른 사이트(Origin)·DNS 리바인딩(Host)은 403, 저장하지 않는다 (02 문서 2.3)', async () => {
    const host = `127.0.0.1:${srv.port}`;
    expect(await raw('/hook', { host, origin: 'https://evil.example', 'content-type': 'text/plain' }, 'POST')).toBe(
      403,
    );
    expect(await raw(`/api/projects/${ID}/state`, { host: `attacker.example:${srv.port}` })).toBe(403);
    expect(
      await raw(`/api/projects/${ID}/state`, { host: `localhost:${srv.port}`, origin: 'http://localhost:5173' }),
    ).toBe(200);
    await settle();
    expect(count(`project = '-work-victim'`)).toBe(0);
  });

  it('다른 프로세스가 DB를 읽고 있어도 저장한다 (WAL)', async () => {
    const reader = new DatabaseSync(dbPath);
    reader.exec('BEGIN');
    reader.prepare('SELECT COUNT(*) FROM raw_events').get(); // 읽기 잠금을 쥔 채로
    try {
      await settle();
    } finally {
      reader.exec('COMMIT');
      reader.close();
    }
  });

  it('SessionStart 없이 처음 본 마을도 팀원 목록을 먼저 읽는다, tycoon으로 최종 메시지 끄기', async () => {
    const cwd = join(tmp, 'mid');
    cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
    writeFileSync(
      join(cwd, '.claude/tycoon.json'),
      JSON.stringify({ overrides: { collector: { keepLastMessage: false } } }),
    );
    const hook = (h: string, sec: number, extra: object = {}) =>
      post(JSON.stringify({ _t: `2026-09-29T15:00:0${sec}.000Z`, hook_event_name: h, session_id: 'm', cwd, ...extra }));
    await hook('SubagentStart', 1, { agent_id: 'a1', agent_type: 'backend-dev' });
    await hook('SubagentStop', 2, { agent_id: 'a1', agent_type: 'backend-dev', last_assistant_message: 'SECRET-LAST' });
    await settle();
    const s = await state(projectId(cwd));
    expect(s.runs.a1).toMatchObject({ memberId: 'backend-dev', endedAt: Date.parse('2026-09-29T15:00:02.000Z') });
    expect(s.runs.a1?.lastMessage).toBeUndefined();
    expect(count(`payload LIKE '%SECRET-LAST%'`)).toBe(0);
  });

  it('최종 메시지는 수집기 안(성격 계산)에만 — /state·SSE·/replay 스냅샷에서는 뺀다 (M8 리뷰, 02 문서 2.3)', async () => {
    const cwd = join(tmp, 'wire');
    const id = projectId(cwd);
    cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
    const hook = (h: string, sec: number, extra: object = {}) =>
      post(JSON.stringify({ _t: `2026-09-29T16:00:0${sec}.000Z`, hook_event_name: h, session_id: 'w', cwd, ...extra }));
    await hook('SubagentStart', 1, { agent_id: 'a1', agent_type: 'backend-dev' });
    await hook('SubagentStop', 2, { agent_id: 'a1', agent_type: 'backend-dev', last_assistant_message: 'SECRET-WIRE' });
    await settle();
    expect(srv.store.villages.get(id)?.state.runs.a1?.lastMessage).toBe('SECRET-WIRE');
    const s = await state(id);
    expect(s.runs.a1).toMatchObject({ memberId: 'backend-dev', endedAt: Date.parse('2026-09-29T16:00:02.000Z') });
    expect(JSON.stringify(s)).not.toContain('SECRET-WIRE');
    const ac = new AbortController();
    const reader = (await fetch(url(`/api/projects/${id}/stream`), { signal: ac.signal })).body?.getReader();
    let seen = '';
    while (!seen.includes('event: state')) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      seen += new TextDecoder().decode(chunk.value);
    }
    ac.abort();
    expect(seen).toContain('"a1"');
    expect(seen).not.toContain('SECRET-WIRE');
    expect(await (await fetch(url(`/api/projects/${id}/replay`), { method: 'POST' })).text()).not.toContain('SECRET');
  });

  it('_t 없는 훅: 받은 시각으로 중복을 판단하지 않는다, tool_use_id가 있으면 판단한다', async () => {
    const where = `project = '-work-no-t'`;
    const body = (extra: object) => JSON.stringify({ session_id: 'n', cwd: '/work/no-t', ...extra });
    vi.useFakeTimers({ toFake: ['Date'] }); // 같은 ms에 받은 것처럼
    try {
      await post(body({ hook_event_name: 'UserPromptSubmit', prompt: 'a' }));
      await post(body({ hook_event_name: 'UserPromptSubmit', prompt: 'b' }));
      await post(body({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'tu1' }));
      await post(body({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'tu1' }));
      await settle();
    } finally {
      vi.useRealTimers();
    }
    expect(count(`${where} AND hook = 'UserPromptSubmit'`)).toBe(2);
    expect(count(`${where} AND hook = 'PreToolUse'`)).toBe(1);
  });

  it('agent_id가 __proto__여도 다른 마을·Object.prototype을 건드리지 않는다', async () => {
    await post(
      JSON.stringify({
        hook_event_name: 'SubagentStop',
        cwd: '/work/other',
        agent_id: '__proto__',
        last_assistant_message: 'x',
      }),
    );
    await settle();
    expect((Object.prototype as Record<string, unknown>).lastMessage).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).endedAt).toBeUndefined();
  });

  it('한글 폴더 이름이 길이만 같아도 다른 마을, 영문 경로 id는 그대로', () => {
    expect(projectId('/Users/kim/쇼핑몰')).not.toBe(projectId('/Users/kim/블로그'));
    expect(projectId('/work/my-shop-app')).toBe(ID);
  });

  it('같은 DB로 다시 시작하면 같은 상태 (바꾼 이름도, 산 가구·옮긴 자리도)', async () => {
    const before = await state();
    const shop = await state(projectId(join(tmp, 'shop')));
    await srv.close();
    srv = await startServer(0, dbPath);
    expect(await state()).toEqual(before);
    expect(await state(projectId(join(tmp, 'shop')))).toEqual(shop);
    expect(Object.values(before.buildings)[0]).toMatchObject({ name: '로그인 마을' });
  });
});

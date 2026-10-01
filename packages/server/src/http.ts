// 수집기 HTTP (02 문서 9장). 127.0.0.1에만 바인딩. /hook은 판단 없이 항상 즉시 204 (02 문서 1장 원칙 1)
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  canPlace,
  cleanBuildingName,
  isPlacement,
  purchaseError,
  type GameConfig,
  type Raw,
  type VillageState,
} from '@tycoon/core';
import { parseSettings, settingsPath, writeTycoon } from './settings';
import { CLOCK_MS, createStore, type Village } from './store';

const BODY_LIMIT = 1 << 20;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/** DNS 리바인딩·다른 사이트의 요청을 막는다 (02 문서 2.3): Host는 루프백 이름, Origin은 없거나(curl) 루프백 */
const trusted = (req: IncomingMessage) =>
  LOOPBACK.test(req.headers.host ?? '') &&
  (req.headers.origin === undefined || LOOPBACK.test(req.headers.origin.replace(/^http:\/\//, '')));
const PING_MS = 25_000;
/** URL 조각 디코드 (%40leader → @leader). 깨진 % 인코딩은 빈 문자열 → 404 */
const decode = (v = '') => {
  try {
    return decodeURIComponent(v);
  } catch {
    return '';
  }
};

/** 화면으로 보내는 상태: 실행의 최종 메시지(성격 계산용 요약본)·토큰 누적(구간 차이 계산용)은 수집기 안에만 (02 문서 2.3) */
const view = (s: VillageState) => ({
  ...s,
  runs: Object.fromEntries(Object.entries(s.runs).map(([k, { lastMessage: _m, cum: _c, ...r }]) => [k, r])),
});

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
// 연결마다 마지막으로 보낸 설정. v.cfg는 roster 때만 새 객체라 같으면 다시 안 보낸다
const sentCfg = new WeakMap<ServerResponse, GameConfig>();
/** 스냅샷 보내기 (02 문서 9장). 설정이 처음이거나 바뀌었으면 그 앞에 event: config (화면도 같은 규칙 수치로)
 *  ponytail: 바뀔 때마다 전체 스냅샷. 크기가 문제되면 JSON Patch (event: patch) */
function push(v: Village, targets: Iterable<ServerResponse>) {
  const state = `event: state\ndata: ${JSON.stringify(view(v.state))}\n\n`;
  for (const res of targets) {
    if (sentCfg.get(res) !== v.cfg) res.write(`event: config\ndata: ${JSON.stringify(v.cfg)}\n\n`);
    sentCfg.set(res, v.cfg);
    res.write(state);
  }
}

/** 본문을 끝까지 받는다. BODY_LIMIT를 넘으면 null */
function readBody(req: IncomingMessage, done: (text: string | null) => void) {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('error', () => {}); // 끊긴 요청은 무시
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size <= BODY_LIMIT) chunks.push(c);
  });
  req.on('end', () => done(size > BODY_LIMIT ? null : Buffer.concat(chunks).toString('utf8')));
}

export async function startServer(port: number, dbPath: string) {
  const streams = new Map<string, Set<ServerResponse>>();
  const store = createStore(dbPath, (v) => {
    const set = streams.get(v.id);
    if (set?.size) push(v, set);
  });
  store.rebuild();

  function hook(req: IncomingMessage, res: ServerResponse) {
    readBody(req, (text) => {
      res.writeHead(204).end(); // 처리보다 먼저 응답
      if (text === null) return;
      setImmediate(() => {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return; // 깨진 JSON은 조용히 무시
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        try {
          store.ingest(raw as Raw);
        } catch (err) {
          console.error('[collector] ingest', err);
        }
      });
    });
  }

  /** 쓰기 요청: 본문(JSON)을 끝까지 받아 handle에. 깨진 JSON·1MB 초과는 undefined → 각자 400. 예외는 500 */
  function write(req: IncomingMessage, res: ServerResponse, what: string, handle: (body: unknown) => void) {
    readBody(req, (text) => {
      try {
        let body: unknown;
        try {
          body = JSON.parse(text ?? '');
        } catch {
          // 깨진 JSON → undefined
        }
        handle(body); // 본문을 받는 동안 재생(/replay)이 마을을 새로 만들 수 있어 마을은 handle 안에서 찾는다
      } catch (err) {
        console.error(`[collector] ${what}`, err);
        if (!res.headersSent) json(res, 500, { error: 'internal' });
      }
    });
  }

  /** 일터 이름 바꾸기 (02 문서 9장, 06 문서 5.6): 본문 { name }, 규칙은 01 문서 5.3. bid는 URL 디코드 (w1%3Abackend-dev) */
  const rename = (req: IncomingMessage, res: ServerResponse, id: string, bid: string) =>
    write(req, res, 'rename', (body) => {
      const v = store.villages.get(id);
      if (!v) return json(res, 404, { error: 'unknown project' });
      if (!Object.hasOwn(v.state.buildings, bid)) return json(res, 404, { error: 'unknown building' });
      const clean = cleanBuildingName((body as { name?: unknown } | null)?.name);
      if (clean === null) return json(res, 400, { error: 'invalid name' });
      store.ui(v.id, { kind: 'rename', buildingId: bid, name: clean });
      res.writeHead(204).end();
    });

  /** 가구 사기 (02 문서 9장, 01 문서 6.4): 본문 { memberId, kind, fabric }. 검사는 프로젝터와 같은 purchaseError */
  const purchase = (req: IncomingMessage, res: ServerResponse, id: string) =>
    write(req, res, 'purchase', (body) => {
      const v = store.villages.get(id);
      if (!v) return json(res, 404, { error: 'unknown project' });
      const b = (body ?? {}) as { memberId?: unknown; kind?: unknown; fabric?: unknown };
      const fabric = b.fabric ?? null;
      if (
        typeof b.memberId !== 'string' ||
        typeof b.kind !== 'string' ||
        (fabric !== null && typeof fabric !== 'string')
      )
        return json(res, 400, { error: 'invalid body' });
      const why = purchaseError(v.state, b.memberId, b.kind, fabric, v.cfg);
      if (why) return json(res, why === 'member' ? 404 : why === 'fabric' ? 400 : 409, { error: why });
      // 줄의 kind는 행동 이름 → 가구 종류는 furniture (02 문서 5.1)
      store.ui(v.id, { kind: 'purchase', memberId: b.memberId, furniture: b.kind, fabric });
      res.writeHead(204).end();
    });

  /** 가구 옮기기 (02 문서 9장, 01 문서 8.4): 본문 { placed: {x, y, rot} | null(창고) } */
  const move = (req: IncomingMessage, res: ServerResponse, id: string, mid: string, fid: string) =>
    write(req, res, 'move', (body) => {
      const v = store.villages.get(id);
      if (!v) return json(res, 404, { error: 'unknown project' });
      const m = Object.hasOwn(v.state.members, mid) ? v.state.members[mid] : undefined;
      const f = m?.furniture.find((x) => x.id === fid);
      if (!m || !f) return json(res, 404, { error: 'unknown furniture' });
      const placed = (body as { placed?: unknown } | null)?.placed;
      if (placed !== null && !isPlacement(placed)) return json(res, 400, { error: 'invalid placement' });
      if (placed && !canPlace(m, f.kind, placed, v.cfg, f.id)) return json(res, 409, { error: 'cannot place' });
      const p = placed && { x: placed.x, y: placed.y, rot: placed.rot };
      store.ui(v.id, { kind: 'move', memberId: m.id, furnitureId: f.id, placed: p });
      res.writeHead(204).end();
    });

  /** 설정 저장 (02 문서 9장, 01 문서 10장·D14): 타이쿤 저장 공간의 마을 설정에 합쳐 쓰고 roster를 다시 읽는다. 200 { path, backup } */
  const settings = (req: IncomingMessage, res: ServerResponse, id: string) =>
    write(req, res, 'settings', (body) => {
      const v = store.villages.get(id);
      if (!v) return json(res, 404, { error: 'unknown project' });
      const patch = parseSettings(body, v.state, v.cfg);
      if (patch === 400) return json(res, 400, { error: 'invalid body' });
      if (patch === 404) return json(res, 404, { error: 'unknown member' });
      const done = writeTycoon(settingsPath(dbPath, v.id), v.cwd, patch);
      if (typeof done === 'string') return json(res, 409, { error: done });
      console.log(`[collector] settings → ${done.path}${done.backup ? ` (backup ${done.backup})` : ''}`);
      try {
        store.reroster(v.id);
      } catch (err) {
        // 파일은 이미 바뀌었다 → 저장은 성공. 팀원 목록은 다음 SessionStart가 다시 읽는다
        console.error('[collector] settings reroster', err);
      }
      json(res, 200, done);
    });

  /** 경제 패널 (02 문서 9장): history는 마지막 기록의 day에서 게임 7일·30일 안, all(또는 없음)은 전부 (옮겨 둔 옛 기록 + 상태) */
  function economy(res: ServerResponse, v: Village, range: string | null) {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : range === null || range === 'all' ? Infinity : 0;
    if (!days) return json(res, 400, { error: 'invalid range' });
    const e = v.state.economy;
    const last = e.history[e.history.length - 1]?.day ?? 0;
    return json(res, 200, {
      fund: e.fund,
      deficit: e.deficit,
      history: v.days.concat(e.history).filter((r) => r.day > last - days),
      members: Object.values(v.state.members).map(({ id, balance, hardship }) => ({ id, balance, hardship })),
    });
  }

  function stream(res: ServerResponse, id: string) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const set = streams.get(id) ?? new Set();
    streams.set(id, set.add(res));
    res.on('close', () => set.delete(res));
    const v = store.villages.get(id);
    if (v) push(v, [res]); // 아직 없는 마을이면 첫 이벤트 때 보낸다
  }

  const server = createServer((req, res) => {
    try {
      if (!trusted(req)) return json(res, 403, { error: 'forbidden' });
      const [path = '', query = ''] = (req.url ?? '').split('?');
      const id = /^\/api\/projects\/([^/]+)/.exec(path)?.[1];
      const rest = id ? path.slice(`/api/projects/${id}`.length) : '';
      const bid = /^\/buildings\/([^/]+)\/name$/.exec(rest)?.[1];
      const fur = /^\/members\/([^/]+)\/furniture\/([^/]+)$/.exec(rest);
      const sub = bid ? '/buildings/:bid/name' : fur ? '/members/:mid/furniture/:fid' : rest;
      const v = id ? store.villages.get(id) : undefined;
      switch (`${req.method} ${id ? `:id${sub}` : path}`) {
        case 'POST /hook':
          return hook(req, res);
        case 'GET /health':
          return res.writeHead(200).end('ok');
        case 'GET /api/projects':
          return json(
            res,
            200,
            [...store.villages.values()]
              .sort((a, b) => b.lastAt - a.lastAt)
              .map((p) => ({ id: p.id, cwd: p.cwd, lastAt: p.lastAt })),
          );
        case 'GET :id/state':
          return v ? json(res, 200, view(v.state)) : json(res, 404, { error: 'unknown project' });
        case 'GET :id/stream':
          return stream(res, id ?? '');
        case 'POST :id/replay': {
          // 개발용. 재생이 끝날 때까지 이벤트 루프가 서서 /hook도 기다린다 → Claude Code가 도는 동안은 쓰지 않는다
          // ponytail: 재생은 이벤트마다 상태 전체를 복제해 길어질수록 느리다. 느려지면 snapshots 표 (db.ts)
          store.rebuild(id);
          const r = id ? store.villages.get(id) : undefined;
          if (!r) return json(res, 404, { error: 'unknown project' });
          push(r, streams.get(r.id) ?? []);
          return json(res, 200, view(r.state));
        }
        case 'GET :id/economy':
          return v
            ? economy(res, v, new URLSearchParams(query).get('range'))
            : json(res, 404, { error: 'unknown project' });
        case 'POST :id/purchase':
          return purchase(req, res, id ?? '');
        case 'PUT :id/settings':
          return settings(req, res, id ?? '');
        case 'PUT :id/buildings/:bid/name':
          return rename(req, res, id ?? '', decode(bid));
        case 'PUT :id/members/:mid/furniture/:fid':
          return move(req, res, id ?? '', decode(fur?.[1]), decode(fur?.[2]));
        default:
          return json(res, 404, { error: 'not found' });
      }
    } catch (err) {
      console.error('[collector]', req.method, req.url, err);
      if (!res.headersSent) json(res, 500, { error: 'internal' });
    }
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');

  const timers = [
    setInterval(() => {
      try {
        store.tick();
      } catch (err) {
        console.error('[collector] clock', err);
      }
    }, CLOCK_MS),
    setInterval(() => {
      for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
    }, PING_MS),
  ];
  for (const t of timers) t.unref();

  return {
    port: (server.address() as AddressInfo).port,
    store,
    close: async () => {
      for (const t of timers) clearInterval(t);
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
      store.close();
    },
  };
}

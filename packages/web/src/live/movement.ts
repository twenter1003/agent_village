// 캐릭터 이동 (02 문서 8.2)과 상태 → 포즈 (01 문서 4장). 순수 함수. now는 화면 쪽에서 넘긴다.
import {
  currentWorkplace,
  isPlaza,
  isRoad,
  type GameConfig,
  type Lot,
  type MemberStatus,
  type VillageState,
} from '@tycoon/core';
import sea from '../../../../design/theme-map.sea.json';
import { asset } from '../assets/sea/Asset';
import type { PoseName } from '../render/rig';
import { activeSite, actorsFromState, frontTiles, sceneFromState, type Actor, type LiveScene } from './sceneFromState';

export interface Pt {
  x: number;
  y: number;
}
export interface Target extends Pt {
  lift?: number; // 바위 위에 앉기: 발을 화면 위로 (px, 에셋 data-seat)
  stay?: boolean; // 막힘: 이미 마을에 있으면 제자리 (01 문서 4장)
}

export const SPEED = 1.5; // 타일/초
// ponytail: 길 1, 모래 2.5 → 길로 조금 돌아가는 정도. 너무 돌면 낮춘다
export const SAND_COST = 2.5;

/**
 * 길 칸 우선 A* (4방향). 막힌 칸(부지·광장 가구)은 피하되 출발·도착 칸은 막혀 있어도 된다.
 * 반환 = 지나갈 칸 중심들 + 마지막은 정확한 목적지. 길이 없으면 곧장 목적지.
 * 좌표는 그리기 좌표: 한 변 = √blocked.length, off = 섬을 넓힌 만큼 민 양 (길 칸 판단은 상태 좌표로, D10)
 */
export function findPath(blocked: Uint8Array, from: Pt, to: Pt, off = 0): Pt[] {
  const MAP = Math.round(Math.sqrt(blocked.length));
  const cost = (x: number, y: number) => (isRoad(x - off, y - off) || isPlaza(x - off, y - off) ? 1 : SAND_COST);
  const tile = (v: number) => Math.min(MAP - 1, Math.max(0, Math.floor(v)));
  const N = MAP * MAP;
  const start = tile(from.y) * MAP + tile(from.x);
  const goal = tile(to.y) * MAP + tile(to.x);
  const tx = goal % MAP,
    ty = (goal - tx) / MAP;
  const g = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const f = (i: number) => (g[i] ?? Infinity) + Math.abs((i % MAP) - tx) + Math.abs(Math.floor(i / MAP) - ty);
  g[start] = 0;
  // ponytail: 열린 목록을 배열로 훑는다 O(n²). 16×16~32×32면 충분, 섬을 많이 넓혀(ring 3+) 느려지면 이진 힙
  const open = [start];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f(open[k] ?? 0) < f(open[bi] ?? 0)) bi = k;
    const cur = open[bi] ?? start;
    open[bi] = open[open.length - 1] ?? cur;
    open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % MAP,
      cy = (cur - cx) / MAP;
    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= MAP || ny >= MAP) continue;
      const n = ny * MAP + nx;
      if (closed[n] || (blocked[n] && n !== goal)) continue;
      const c = (g[cur] ?? Infinity) + cost(nx, ny);
      if (c < (g[n] ?? Infinity)) {
        g[n] = c;
        prev[n] = cur;
        open.push(n);
      }
    }
  }
  if (goal !== start && prev[goal] === -1) return [{ x: to.x, y: to.y }];
  const path: Pt[] = [];
  for (let i = goal; i !== start && i >= 0; i = prev[i] ?? -1)
    path.unshift({ x: (i % MAP) + 0.5, y: Math.floor(i / MAP) + 0.5 });
  path[path.length ? path.length - 1 : 0] = { x: to.x, y: to.y };
  return path;
}

/** 걷는 캐릭터의 이동 부분 (LiveVillage Walker) */
export interface Mover extends Pt {
  path: Pt[];
  goal: string; // 목적지 키. 바뀌면 길을 다시 찾는다
  lift: number; // 지금 발 높이 (바위 위 = ROCK_LIFT). 떠나는 첫걸음에 0, 도착하면 goalLift
  goalLift: number;
}

/**
 * 새 목적지 (02 문서 8.2). 막힘(stay)이면 가던 길도 멈추고 그 자리에 선다 (01 문서 4장 "제자리").
 * 발 높이는 여기서 안 바꾼다 — 환호로 멈춘 동안 바위에서 떨어지지 않게 (advance가 첫걸음에 내린다)
 */
export function retarget(w: Mover, t: Target, blocked: Uint8Array, off = 0) {
  if (t.stay) {
    if (w.path.length) {
      w.path = [];
      w.goal = `${w.x},${w.y}`;
    }
    return;
  }
  const goal = `${t.x},${t.y}`;
  if (goal === w.goal) return;
  w.goal = goal;
  w.goalLift = t.lift ?? 0;
  w.path = findPath(blocked, w, t, off);
}

/** step + 발 높이: 걷는 동안 바닥, 도착하면 목적지 높이 */
export function advance(w: Mover, dist: number): number {
  const sdx = step(w, dist);
  w.lift = w.path.length ? 0 : w.goalLift;
  return sdx;
}

/** 경로를 따라 dist(타일)만큼 간다. 반환 = 마지막 걸음의 화면 x 방향 (+ 오른쪽, 0 = 안 움직임) */
export function step(w: Pt & { path: Pt[] }, dist: number): number {
  let sdx = 0;
  while (dist > 1e-9 && w.path.length) {
    const p = w.path[0] as Pt;
    const dx = p.x - w.x,
      dy = p.y - w.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-9) sdx = dx - dy; // iso: 화면 x ∝ (x − y)
    if (d <= dist) {
      w.x = p.x;
      w.y = p.y;
      w.path.shift();
      dist -= d;
    } else {
      w.x += (dx / d) * dist;
      w.y += (dy / d) * dist;
      dist = 0;
    }
  }
  return sdx;
}

const seat = asset('prop.rock').data;
/** 바위 윗면까지 높이 = anchor y − seat y (48,128 → 48,103: 25px) */
export const ROCK_LIFT = Number((seat.anchor ?? '0,0').split(',')[1]) - Number((seat.seat ?? '0,0').split(',')[1]);
const REST_SPOT = sea.rules.restSpot as Record<string, string>; // 05 문서 S5: 물범 → 바위

const center = ([x, y]: [number, number]): Target => ({ x: x + 0.5, y: y + 0.5 });

/**
 * 상태별 목적지 (02 문서 8.2). 작업 = 자기 일터 앞 칸, 회의 = 게시판 앞 반원, 휴식 = 자기 집 문 앞
 * (물범은 가까운 빈 바위), 막힘 = 제자리(stay), 외부인 = 자기 시설 앞 / 공사 돕기.
 * 같은 부지로 가는 캐릭터는 앞 칸을 나눠 쓴다 (actors 순서대로).
 */
export function targets(s: VillageState, scene: LiveScene, actors: Actor[]): Map<string, Target> {
  const out = new Map<string, Target>();
  const used = new Map<string, number>();
  const { map: M, off } = scene; // 상태 좌표(부지·집·시설) → 그리기 좌표는 + off (D10)
  const wall = (x: number, y: number) => x < M && y < M && scene.blocked[y * M + x] === 1;
  // 바로 앞(화면 아래) 칸이 부지·가구면 앞 건물에 가려진다 → 그런 자리는 맨 뒤로 (뒷줄 집 문 앞, 인력 부두 뒤 해도실)
  const hidden = ([x, y]: [number, number]) => wall(x, y + 1) || wall(x + 1, y + 1);
  const near = (lot: Lot, key: string, n = 2): Target | null => {
    const open = frontTiles({ x: lot.x + off, y: lot.y + off }, M, n).filter(([x, y]) => !scene.blocked[y * M + x]);
    const spots = [...open.filter((p) => !hidden(p)), ...open.filter(hidden)];
    const i = used.get(key) ?? 0;
    used.set(key, i + 1);
    const t = spots[i % Math.max(1, spots.length)];
    return t ? center(t) : null;
  };
  const board = scene.props.find((p) => p.kind === 'board') ?? { x: 6 + off, y: 8 + off };
  const meeting = (s.meeting?.participants ?? []).filter((id) =>
    actors.some((a) => a.id === id && a.status === 'meeting'),
  );
  const site = activeSite(s);
  const sat = new Set<string>();
  let spare = 0;

  for (const a of actors) {
    const house = s.houses[a.id];
    let t: Target | null = null;
    if (a.status === 'meeting') {
      // 게시판 앞(화면 아래쪽) 반원. 25°~105°: 분수·집 부지를 밟지 않는 범위
      const n = Math.max(1, meeting.length);
      const i = Math.max(0, meeting.indexOf(a.id));
      const ang = ((25 + (80 * (i + 0.5)) / n) * Math.PI) / 180;
      t = { x: board.x + 0.5 + 1.4 * Math.cos(ang), y: board.y + 0.5 + 1.4 * Math.sin(ang) };
    } else if (a.status === 'working' || a.status === 'blocked') {
      // 시장은 시청에서 일한다 (06 문서 5.9·6.3). 시청이 없거나 팀원이면 자기 일터 / 지금 일하는 팀원의 일터
      const hall = a.isLeader && s.hall ? s.hall : null;
      const b = hall ? undefined : workSite(s, a.id, site);
      const key = hall ? 'hall' : `work:${b?.id ?? ''}`;
      const foot = scene.buildings.find((x) => x.id === key)?.foot ?? 2;
      t = hall ? near(hall, 'hall', foot) : b ? near(b.lot, b.id, foot) : null;
    } else if (a.status === 'visiting' && a.visitor) {
      const f = s.facilities[a.visitor.facility]; // 외부인이 처음 올 때 지은 시설 (01 문서 3.3)
      t = f ? near(f, a.visitor.facility) : null;
    } else if (a.status === 'resting' && REST_SPOT[a.species]) {
      const ref = house ? { x: house.lot.x + 1 + off, y: house.lot.y + 1 + off } : board;
      const rock = scene.props
        .filter((p) => p.kind === REST_SPOT[a.species] && !sat.has(`${p.x},${p.y}`) && !hidden([p.x, p.y]))
        .sort((p, q) => Math.hypot(p.x - ref.x, p.y - ref.y) - Math.hypot(q.x - ref.x, q.y - ref.y))[0];
      if (rock) {
        sat.add(`${rock.x},${rock.y}`);
        t = { x: rock.x + 0.5, y: rock.y + 0.5, lift: ROCK_LIFT };
      }
    }
    t ??= house ? near(house.lot, `house:${a.id}`) : null;
    t ??= { x: 6.5 + off + (spare++ % 4), y: 9.5 + off }; // 집도 현장도 없으면 광장 앞줄
    out.set(a.id, a.status === 'blocked' ? { ...t, stay: true } : t);
  }
  return out;
}

/** 일하는 곳 (06 문서 5장·5.9): 자기 일터, 일터가 없는 팀장·외부인은 지금 일하는 팀원의 일터 */
export const workSite = (s: VillageState, id: string, site = activeSite(s)) => currentWorkplace(s, id) ?? site;

export type Place = 'site' | 'hall' | 'plaza' | 'home' | 'rock';
export interface MemberView {
  status: MemberStatus;
  place: Place;
}

/**
 * 팀원 카드 상태 줄 (01 문서 8.2, SeaTeamPanel "작업 중 · 일터"). 마을(LiveVillage)과 같은 규칙·같은 seed·같은 시계(now)라
 * 회의가 이벤트 없이 끝나도 카드와 마을이 어긋나지 않는다. 바위 = 05 문서 S5 "휴식 · 바위 위"
 */
export function memberViews(s: VillageState, cfg: GameConfig, now: number): Map<string, MemberView> {
  const actors = actorsFromState(s, cfg, now);
  const tg = targets(s, sceneFromState(s, cfg), actors);
  const site = activeSite(s);
  const out = new Map<string, MemberView>();
  for (const a of actors) {
    if (a.visitor || a.status === 'visiting') continue;
    const working = a.status === 'working' || a.status === 'blocked';
    const place: Place = tg.get(a.id)?.lift
      ? 'rock'
      : a.status === 'meeting'
        ? 'plaza'
        : working && a.isLeader && s.hall
          ? 'hall'
          : working && workSite(s, a.id, site)
            ? 'site'
            : s.houses[a.id]
              ? 'home'
              : 'plaza';
    out.set(a.id, { status: a.status, place });
  }
  return out;
}

export const ALT_MS = 4000; // 망치질 ↔ 나르기 번갈아 (01 문서 4장 "도구 사용이 많으면")

/**
 * 상태 → 포즈. 환호 > 이동 > 상태. 이동은 walk로 요청하고 그릴 때 종의 move(swim)로 바뀐다 (rig.resolvePose).
 * 공사 돕는 외부인은 자재를 나른다 (01 문서 3.2)
 */
export function poseFor(
  a: Pick<Actor, 'status' | 'heavy' | 'cheerUntil' | 'visitor'>,
  moving: boolean,
  now: number,
  phase = 0,
): PoseName {
  if (a.cheerUntil !== null && now < a.cheerUntil) return 'cheer';
  if (moving) return 'walk';
  switch (a.status) {
    case 'working':
      return a.visitor || (a.heavy && Math.floor((now + phase * 700) / ALT_MS) % 2 === 1) ? 'carry' : 'hammer';
    case 'meeting':
      return 'talk';
    case 'resting':
      return 'rest';
    default:
      return 'stand'; // 막힘(머리 위 '!'), 시설 옆 외부인
  }
}

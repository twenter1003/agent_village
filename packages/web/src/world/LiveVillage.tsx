// 실시간 마을 (M5): VillageState → 장면 + 걸어 다니는 캐릭터.
// 위치는 rAF에서 setAttribute로만 바꾸고, React는 포즈·방향·앞뒤 순서·상태가 바뀔 때만 다시 그린다 (02 문서 7.4, 8.4).
// 공사 연출: 단계·층 거품도 같은 rAF에서 DOM으로, 층이 오른 반짝임은 창이 열리고 닫힐 때만 다시 그린다 (06 문서 5.4).
import { makeConfig, mapSize, type GameConfig, type VillageState } from '@tycoon/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Stage } from '../assets/sea/Building';
import { t } from '../i18n';
import { advance, findPath, poseFor, retarget, SPEED, targets, type Mover } from '../live/movement';
import { dropTile, HOLD_MS, pokePose, pokeText, POKE_MS, pressIntent } from '../live/poke';
import {
  actorsFromState,
  frontTiles,
  sceneFromState,
  workplaceName,
  type Actor,
  type LiveScene,
} from '../live/sceneFromState';
import { Critter } from '../render/Critter';
import { byDepth, iso, unIso, world } from '../render/iso';
import type { PoseName } from '../render/rig';
import { reducedMotion, usePrefs } from '../live/prefs';
import { completeFxOn, POP_MS, popBubbles, stageUp } from './constructionFx';
import { Ground } from './Ground';
import { NameTag } from './OwnerSign';
import { bubbleSources, critterOrigin, DEPARTED_OPACITY, S, staticEnts, type Ent } from './Village';
import { WaterFx } from './WaterFx';
import { Alert, FloorBadge, Gauge, Say, Sleep, Speech, VisitorTag } from './WorldUi';

interface Walker extends Mover {
  flip: boolean;
  pose: PoseName;
  frame?: number; // 고정 프레임 (누르기 동작 줄이기, live/poke pokePose)
  phase: number;
  drawn: string;
}

/** 캐릭터를 누른 채 (06 문서 8장). off = 누른 곳 → 발(월드 px). held = 집어 들었음 */
interface Grab {
  id: string;
  pointerId: number;
  type: string;
  x0: number;
  y0: number;
  t0: number;
  dist: number;
  off: { x: number; y: number };
  held: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const SYNC_MS = 500; // 화면 시계로 목적지 다시 보기 (회의 끝·환호 끝처럼 이벤트 없이 바뀌는 것)
const SORT_MS = 250; // 앞뒤 순서 다시 보기
const defaultCfg = makeConfig();
const phaseOf = (id: string) => [...id].reduce((h, c) => h + c.charCodeAt(0), 0) % 7;
const statusKey = (list: Actor[]) => list.map((a) => `${a.id}:${a.status}`).join('|');
const SVG_NS = 'http://www.w3.org/2000/svg';
/** 누르기 칸의 z-index = 그림 깊이 d (byDepth). 0.1px 단위 정수 → 건물 뒤로 간 캐릭터 칸이 건물 칸 밑으로 */
const zOf = (d: number) => Math.round(d * 10);
// 단계 바뀜 거품 한 알 (WaterFx 거품과 같은 모양)
const BUBBLE =
  '<g opacity="0"><circle r="2" fill-opacity="0.6" stroke-width="1.6" style="fill: var(--bubble); stroke: var(--ink)"></circle>' +
  '<circle cx="-0.8" cy="-0.8" r="0.7" style="fill: var(--sheen)"></circle></g>';

/** 마을 그림 크기 (카메라): 섬을 넓히면 같이 커진다 (D10) */
export const liveWorld = (s: VillageState | null) => world(mapSize(s?.ring ?? 0));
/** 누를 수 있는 장면 id 머리 (live/sceneFromState): 일터 `work:<core 일터 id>`, 집 `house:<memberId>` */
const WORK = 'work:';
const HOUSE = 'house:';

export function LiveVillage({
  state,
  cfg = defaultCfg,
  fx = true,
  labels = true,
  selectedId,
  onSelect,
  onBuildingClick,
}: {
  state: VillageState;
  cfg?: GameConfig;
  fx?: boolean;
  labels?: boolean;
  /** 강조할 팀원 (팀원 카드를 누르면). 발밑에 --coin 원판 */
  selectedId?: string | null;
  /** 팀원 캐릭터를 누르면 (01 문서 8.2 "캐릭터 누르기 → 카드 강조") */
  onSelect?: (memberId: string) => void;
  /**
   * 일터(06 문서 13장 일터 상세)·집(01 문서 8.4 집 상세)·시청(06 문서 6.4 경제 패널)을 누르면.
   * 인자 = 장면 건물 id: `work:<core 일터 id>` | `house:<memberId>` | 시청 `hall`.
   * 시설 `facility:<library|plan|agency>`는 아직 누를 곳을 만들지 않는다
   */
  onBuildingClick?: (buildingId: string) => void;
}) {
  const prefs = usePrefs(); // 거품 효과·회의 안건 글자 (01 문서 10장)
  // 누르기 동작 줄이기 (06 문서 8장): 운영체제 "움직임 줄이기" 또는 거품 효과 끔
  const calm = reducedMotion() || !prefs.bubbles;
  const scene = useMemo(() => sceneFromState(state, cfg), [state, cfg]);
  // 한 변 타일 수: 섬을 넓히면 커진다 (D10). rAF 루프는 처음 그린 함수를 계속 쓰므로 거기선 live.current.scene.map을 읽는다
  const M = scene.map;
  const W = world(M);
  // 완공 반짝임 중인 장면 건물 id들 ('|'로 이음). rAF가 창이 열리고 닫힐 때만 바꾼다
  const [fxKey, setFxKey] = useState('');
  const statics = useMemo(() => {
    const on = new Set(fxKey.split('|'));
    const bs = scene.buildings.map((b) => (on.has(b.id) ? { ...b, fx: true } : b));
    return staticEnts(bs, scene.props, M).sort(byDepth);
  }, [scene, fxKey, M]);
  const sources = useMemo(() => bubbleSources(scene.props, M), [scene, M]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [, setRev] = useState(0);

  const walkers = useRef(new Map<string, Walker>());
  const gEls = useRef(new Map<string, Element>());
  const uiEls = useRef(new Map<string, HTMLElement>());
  const live = useRef({ state, scene, cfg, statics, actors, order: '', fxKey, calm });
  const rootRef = useRef<HTMLDivElement>(null);
  const pokes = useRef(new Map<string, number>()); // 누른 캐릭터 → 누른 시각 (performance.now). 화면 놀이라 상태에 안 남긴다
  const grab = useRef<Grab | null>(null);
  const dragged = useRef(false); // 이번 누르기가 끌어 옮기기였나 (그러면 click은 누르기가 아니다)
  const popLayer = useRef<SVGGElement>(null);
  const stages = useRef(new Map<string, Stage>());
  const floors = useRef(new Map<string, number>());
  const pops = useRef<{ el: SVGGElement; start: number }[]>([]);
  const built = useRef(new Set<string>()); // 본 적 있는 집·시설 (새로 생기면 거품)
  const painted = useRef(false);
  const level = useRef<number | null>(null); // 본 마을 레벨 (오르면 섬 가운데 거품, 06 문서 6.1)
  const stateSeen = useRef<VillageState | null>(null);
  live.current.state = state;
  live.current.scene = scene;
  live.current.cfg = cfg;
  live.current.statics = statics;
  live.current.calm = calm;

  const offSeen = useRef(scene.off); // 걷던 캐릭터 좌표가 기준으로 삼은 off
  const place = (id: string, w: Walker, force = false) => {
    const c = iso(w.x, w.y, live.current.scene.map);
    const [sx, sy] = [c.sx, c.sy - w.lift];
    const key = `${sx.toFixed(1)},${sy.toFixed(1)}`;
    if (!force && key === w.drawn) return;
    w.drawn = key;
    gEls.current.get(id)?.setAttribute('transform', critterOrigin(sx, sy));
    const ui = uiEls.current.get(id);
    if (!ui) return;
    ui.style.transform = `translate(${sx}px, ${sy}px)`;
    ui.style.zIndex = String(zOf(c.sy + 0.5)); // charEnts와 같은 깊이
  };
  const charEnts = (list: Actor[]) =>
    list.flatMap((a) => {
      const w = walkers.current.get(a.id);
      if (!w) return [];
      const c = iso(w.x, w.y, live.current.scene.map);
      return [{ d: c.sy + 0.5, sx: c.sx, key: `c:${a.id}`, a, w }];
    });
  const orderOf = (list: Actor[]) =>
    [...live.current.statics, ...charEnts(list)]
      .sort(byDepth)
      .map((e) => e.key)
      .join('|');

  /**
   * 상태 → 목적지. 처음 스냅샷의 캐릭터는 목적지에 바로 둔다 (열었을 때 이미 일하는 중).
   * 그 뒤에 나타난 외부인은 자기 시설 문 앞에서, 새로 입주한 팀원은 막 지은 자기 집 문 앞에서 나와 걸어간다 (01 문서 3.2·3.3)
   */
  const sync = () => {
    const { state: s, scene: sc, cfg: c } = live.current;
    const list = actorsFromState(s, c, Date.now());
    const tg = targets(s, sc, list);
    const ws = walkers.current;
    // 섬이 넓어졌다 (D10): 그리기 좌표가 d만큼 밀렸으니 걷던 캐릭터·길도 같이 민다 (튀지 않게)
    const d = sc.off - offSeen.current;
    if (d) {
      for (const w of ws.values()) {
        w.x += d;
        w.y += d;
        w.path = w.path.map((p) => ({ x: p.x + d, y: p.y + d }));
        w.goal = '';
        w.drawn = '';
      }
      offSeen.current = sc.off;
    }
    for (const a of list) {
      const t = tg.get(a.id);
      if (!t) continue;
      const w = ws.get(a.id);
      if (w) {
        retarget(w, t, sc.blocked, sc.off);
        continue;
      }
      const lot = a.visitor ? s.facilities[a.visitor.facility] : s.houses[a.id]?.lot;
      const door =
        lot && stateSeen.current ? frontTiles({ x: lot.x + sc.off, y: lot.y + sc.off }, sc.map)[0] : undefined;
      const from = door ? { x: door[0] + 0.5, y: door[1] + 0.5 } : t;
      ws.set(a.id, {
        x: from.x,
        y: from.y,
        path: from === t ? [] : findPath(sc.blocked, from, t, sc.off),
        goal: `${t.x},${t.y}`,
        lift: from === t ? (t.lift ?? 0) : 0,
        goalLift: t.lift ?? 0,
        flip: false,
        pose: 'stand',
        phase: phaseOf(a.id),
        drawn: '',
      });
    }
    for (const id of ws.keys()) if (!list.some((a) => a.id === id)) ws.delete(id);
    const changed = statusKey(list) !== statusKey(live.current.actors) || s !== stateSeen.current;
    live.current.actors = list;
    stateSeen.current = s;
    if (changed) setActors(list);
  };

  useEffect(sync, [state, scene, cfg]);

  const drawPops = (now: number) => {
    pops.current = pops.current.filter(({ el, start }) => {
      const k = (now - start) / POP_MS;
      if (k >= 1) return void el.remove();
      popBubbles(Math.max(0, k)).forEach((b, j) => {
        const g = el.children[j];
        g?.setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})`);
        g?.setAttribute('opacity', b.o.toFixed(2));
        g?.firstElementChild?.setAttribute('r', b.r.toFixed(1));
      });
      return true;
    });
  };

  // 장면이 바뀔 때 (그리기 직후, 화면에 나오기 전): 새 건물·단계가 올라간 현장·층이 오른 일터 → 거품
  useLayoutEffect(() => {
    const now = performance.now();
    const pop = (b: { x: number; y: number }) => {
      const layer = popLayer.current;
      if (!layer) return;
      const c = iso(b.x + 1, b.y + 1, M);
      const el = layer.appendChild(document.createElementNS(SVG_NS, 'g'));
      el.setAttribute('transform', `translate(${c.sx} ${c.sy - 24})`);
      el.innerHTML = BUBBLE.repeat(5);
      pops.current.push({ el, start: now });
    };
    for (const b of scene.buildings) {
      const fresh = !built.current.has(b.id);
      built.current.add(b.id);
      const stage = b.stage ?? 'done';
      const floor = b.floor ?? 0;
      // 새로 생긴 집·시설·일터 부지, 예정 → 기초, 층이 오른 일터 → 거품 (처음 그린 장면은 조용히, 01 문서 3.3·06 문서 5.4)
      const up = stageUp(stages.current.get(b.id), stage) || floor > (floors.current.get(b.id) ?? floor);
      if (painted.current && (fresh || up)) pop(b);
      stages.current.set(b.id, stage);
      floors.current.set(b.id, floor);
    }
    if (painted.current && level.current !== null && scene.level > level.current)
      pop({ x: 7 + scene.off, y: 7 + scene.off }); // 광장 가운데
    level.current = scene.level;
    painted.current = true;
  }, [scene]); // M은 고정, 나머지는 ref

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSync = last;
    let lastSort = last;
    const frame = (tm: number) => {
      const dt = Math.min(0.1, (tm - last) / 1000);
      last = tm;
      if (tm - lastSync > SYNC_MS) {
        lastSync = tm;
        sync();
      }
      const now = Date.now();
      let dirty = false;
      const g = grab.current;
      for (const a of live.current.actors) {
        const w = walkers.current.get(a.id);
        if (!w) continue;
        const held = !!g?.held && g.id === a.id;
        const since = pokes.current.get(a.id);
        if (since !== undefined && tm - since >= POKE_MS) {
          pokes.current.delete(a.id); // 말풍선 끝
          dirty = true;
        }
        const cheering = a.cheerUntil !== null && now < a.cheerUntil; // 환호하는 2초는 멈춘다
        if (!held && !cheering && w.path.length) {
          const sdx = advance(w, dt * SPEED);
          if (Math.abs(sdx) > 1e-6 && sdx > 0 !== w.flip) {
            w.flip = sdx > 0; // 화면 오른쪽으로 가면 반전 (02 문서 7.4)
            dirty = true;
          }
        }
        const pk = pokePose(pokes.current.get(a.id), held, tm, live.current.calm);
        const pose = pk?.pose ?? poseFor(a, w.path.length > 0 && !cheering, now, w.phase);
        if (pose !== w.pose || pk?.frame !== w.frame) {
          w.pose = pose;
          w.frame = pk?.frame;
          dirty = true;
        }
        place(a.id, w);
      }
      drawPops(tm);
      const { state: s, cfg: c } = live.current;
      const fxNow = Object.values(s.buildings)
        .filter((b) => completeFxOn(b.floorAt ?? undefined, now, c.buildings.completeFxMs))
        .map((b) => WORK + b.id)
        .join('|');
      if (fxNow !== live.current.fxKey) {
        live.current.fxKey = fxNow;
        setFxKey(fxNow);
      }
      if (tm - lastSort > SORT_MS) {
        lastSort = tm;
        const order = orderOf(live.current.actors);
        if (order !== live.current.order) dirty = true;
      }
      if (dirty) setRev((r) => r + 1);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []); // 루프는 한 번만. 최신 상태는 live ref로 읽는다

  const bindG = (id: string) => (el: SVGGElement | null) => {
    const w = walkers.current.get(id);
    if (!el) return void gEls.current.delete(id);
    gEls.current.set(id, el);
    if (w) place(id, w, true);
  };
  const bindUi = (id: string) => (el: HTMLDivElement | null) => {
    const w = walkers.current.get(id);
    if (!el) return void uiEls.current.delete(id);
    uiEls.current.set(id, el);
    if (w) place(id, w, true);
  };

  // ── 캐릭터 누르기·끌어 옮기기 (06 문서 8장): 화면 놀이 — 상태·이벤트·수집기 호출 없음 ──
  /** 화면 좌표 → 마을 그림(월드) px. 카메라 확대는 그림 상자 크기로 푼다 */
  const toWorld = (cx: number, cy: number) => {
    const r = rootRef.current?.getBoundingClientRect();
    const Wd = world(live.current.scene.map);
    const k = r?.width ? Wd.w / r.width : 1;
    return { x: (cx - (r?.left ?? 0)) * k, y: (cy - (r?.top ?? 0)) * k };
  };
  const lift = (g: Grab) => {
    g.held = true;
    const w = walkers.current.get(g.id);
    if (w) w.lift = 0; // 바위 위였어도 — 뜬 높이는 held 포즈가 맡는다
    setRev((r) => r + 1);
  };
  const drop = (id: string) => {
    const w = walkers.current.get(id);
    if (!w) return;
    // 가장 가까운 걸을 수 있는 칸에 내려놓고, 거기서 원래 가던 곳으로 (지금 이동 규칙, 02 문서 8.2)
    Object.assign(w, dropTile(live.current.scene.blocked, w), { lift: 0, path: [], goal: '' });
    place(id, w, true);
    sync();
    setRev((r) => r + 1);
  };
  const release = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g || g.pointerId !== e.pointerId) return;
    clearTimeout(g.timer);
    grab.current = null;
    if (!g.held) return; // 그냥 누르기 → click이 버둥
    dragged.current = true;
    drop(g.id);
  };
  const press = (a: Actor) => ({
    'data-grab': '',
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      dragged.current = false;
      const w = walkers.current.get(a.id);
      if (e.button !== 0 || !w) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const p = toWorld(e.clientX, e.clientY);
      const c = iso(w.x, w.y, live.current.scene.map);
      const g: Grab = {
        id: a.id,
        pointerId: e.pointerId,
        type: e.pointerType,
        x0: e.clientX,
        y0: e.clientY,
        t0: performance.now(),
        dist: 0,
        off: { x: c.sx - p.x, y: c.sy - p.y },
        held: false,
      };
      // 터치는 0.3초 누르고 있으면 (그동안 6px 안) 집는다
      if (e.pointerType === 'touch')
        g.timer = setTimeout(() => {
          if (grab.current === g && pressIntent('touch', g.dist, HOLD_MS) === 'grab') lift(g);
        }, HOLD_MS);
      grab.current = g;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = grab.current;
      if (!g || g.pointerId !== e.pointerId) return;
      if (!g.held) {
        g.dist = Math.max(g.dist, Math.hypot(e.clientX - g.x0, e.clientY - g.y0));
        const intent = pressIntent(g.type, g.dist, performance.now() - g.t0);
        if (intent === 'pan') {
          clearTimeout(g.timer);
          grab.current = null; // 터치로 바로 끌면 마을 끌기 (Camera)
          return;
        }
        if (intent === 'wait') return;
        lift(g);
      }
      e.stopPropagation(); // 들고 있는 동안 마을은 안 움직인다
      const w = walkers.current.get(g.id);
      if (!w) return;
      const p = toWorld(e.clientX, e.clientY);
      Object.assign(w, unIso(p.x + g.off.x, p.y + g.off.y, live.current.scene.map));
      place(g.id, w);
    },
    onPointerUp: release,
    onPointerCancel: release,
    onClick: (e: React.MouseEvent) => {
      if (e.detail > 0 && dragged.current) return; // 끌어 옮기기는 누르기가 아니다 (키보드 Enter·Space는 detail 0)
      pokes.current.set(a.id, performance.now());
      setRev((r) => r + 1);
      if (!a.visitor) onSelect?.(a.id); // 하던 동작(카드 강조)은 그대로
    },
  });
  const saying = (id: string) => pokes.current.has(id) || (grab.current?.held === true && grab.current.id === id);

  const ents: Ent[] = [
    ...statics,
    ...charEnts(actors).map(({ d, sx, key, a, w }) => ({
      d,
      sx,
      key,
      el: (
        <g ref={bindG(a.id)} data-walker={a.id}>
          {a.id === selectedId && (
            // 선택 표시: 발(64S, 126S) 밑 원판. 03 문서 5장 카드 선택처럼 --coin + --ink 선 3
            <ellipse
              data-selected=""
              cx={64 * S}
              cy={126 * S}
              rx={30}
              ry={13}
              style={{ fill: 'var(--coin)', stroke: 'var(--ink)' }}
              strokeWidth={3}
            />
          )}
          <Critter
            species={a.species}
            variant={a.variant}
            accessory={a.accessory}
            role={a.role}
            pose={w.pose}
            frame={w.frame}
            flip={w.flip}
            phase={w.phase}
            scale={S}
            // 버둥이면 땀방울 거품 (동작 줄이기면 없음)
            bubbles={(w.pose === 'flail' || w.pose === 'held') && !calm ? true : undefined}
          />
        </g>
      ),
    })),
  ].sort(byDepth);
  live.current.order = ents.map((e) => e.key).join('|');

  const speaker =
    actors.find((a) => a.status === 'meeting' && a.isLeader) ?? actors.find((a) => a.status === 'meeting');

  return (
    <div ref={rootRef} style={{ position: 'relative', width: W.w, height: W.h }}>
      <Ground map={M} founded={scene.founded} paved={scene.paved} />
      <svg width={W.w} height={W.h} viewBox={`0 0 ${W.w} ${W.h}`} style={{ position: 'absolute', overflow: 'visible' }}>
        {ents.map((e) => (
          <g key={e.key}>{e.el}</g>
        ))}
        {/* 단계 바뀜 거품: rAF가 직접 붙이고 뗀다 */}
        {fx && prefs.bubbles && <g ref={popLayer} data-layer="fx-site" pointerEvents="none" />}
        {fx && <WaterFx worldW={W.w} sources={sources} bubbles={prefs.bubbles} />}
      </svg>
      {labels && <Gauges scene={scene} M={M} />}
      <Badges scene={scene} M={M} />
      {labels && <NameTags scene={scene} M={M} />}
      {onBuildingClick && <BuildingHits scene={scene} state={state} cfg={cfg} M={M} onClick={onBuildingClick} />}
      {actors.map((a) => {
        const w = walkers.current.get(a.id);
        // 누르면 머리 위 말풍선 = 지금 상태 (06 문서 8장). 그동안 '!'·zz·회의 말풍선은 이것이 대신한다
        const say = saying(a.id) && pokeText(a, state);
        const kids = [
          say && <Say key="say" x={0} y={0} text={say} />,
          !say && labels && a.status === 'blocked' && <Alert key="alert" x={0} y={0} />,
          !say && labels && w?.pose === 'rest' && <Sleep key="sleep" x={0} y={0} />,
          labels && a.tag && <VisitorTag key="tag" x={0} y={0} text={a.tag} />,
          !say && labels && a === speaker && (
            <Speech key="speech" x={0} y={0} text={(prefs.speech && state.meeting?.preview) || '…'} />
          ),
          // 팀원·팀장·외부인 모두 누르기·끌기 (06 문서 8장). 팀원은 카드 강조도 (01 문서 8.2)
          <button
            key="hit"
            type="button"
            aria-label={a.name}
            aria-pressed={onSelect && !a.visitor ? a.id === selectedId : undefined}
            className="lv-hit"
            style={hit}
            {...press(a)}
          />,
        ].filter(Boolean);
        return (
          <div
            key={a.id}
            ref={bindUi(a.id)}
            data-walker-ui={a.id}
            data-poked={say ? '' : undefined}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
          >
            {kids}
          </div>
        );
      })}
    </div>
  );
}

// 캐릭터 위 투명 버튼 (몸 크기 0.45배 ≈ 44×60). 포커스 링(3px --focus, 간격 3)은 screens.css .lv-hit:focus-visible
const hit = {
  position: 'absolute',
  left: -22,
  top: -60,
  width: 44,
  height: 62,
  padding: 0,
  border: 0,
  borderRadius: 14,
  background: 'transparent',
  cursor: 'pointer',
  pointerEvents: 'auto',
} as const;

/**
 * 일터·집·시청 `hall` 누르기 (06 문서 13장·6.4, 01 문서 8.4): 부지 위 투명 버튼. 겹치면 그림과 같은 깊이 순(z-index) —
 * 앞에 선 캐릭터는 캐릭터가, 건물 뒤로 간 캐릭터 자리는 건물이 눌린다
 */
function BuildingHits({
  scene,
  state,
  cfg,
  M,
  onClick,
}: {
  scene: LiveScene;
  state: VillageState;
  cfg: GameConfig;
  M: number;
  onClick: (buildingId: string) => void;
}) {
  const label = (id: string, stage?: string) => {
    if (id === 'hall') return t('world.hall');
    if (id.startsWith(HOUSE)) return t('world.house', { name: state.members[id.slice(HOUSE.length)]?.name ?? '' });
    const key = id.slice(WORK.length);
    const b = Object.hasOwn(state.buildings, key) ? state.buildings[key] : undefined;
    const name = b ? workplaceName(state, cfg, b) : t('world.unnamed');
    return t(stage === 'done' ? 'world.building' : 'world.construction', { name });
  };
  return scene.buildings
    .filter((b) => b.id === 'hall' || b.id.startsWith(WORK) || b.id.startsWith(HOUSE))
    .map((b) => ({ b, c: iso(b.x + 1, b.y + 1, M), h: b.body.endsWith('2f') ? 180 : 142 }))
    .map(({ b, c, h }) => (
      <button
        key={b.id}
        type="button"
        aria-label={label(b.id, b.stage)}
        data-building-hit={b.id}
        onClick={() => onClick(b.id)}
        className="lv-hit"
        // 에셋 기준점(부지 가운데) 기준: 좌우 ±58 (부지 폭), 아래 +30 (기초 앞 모서리), 위는 층수만큼
        // zIndex = staticEnts 건물 깊이 (c.sy)
        style={{
          ...hit,
          left: c.sx - 58,
          top: c.sy + 30 - h,
          width: 116,
          height: h,
          borderRadius: 16,
          zIndex: zOf(c.sy),
        }}
      />
    ));
}

/** 건물 이름표 (06 문서 7장): 부지 앞 모서리(가운데 +32)에 걸쳐 가운데 정렬. 주인이 있는 건물만 */
const TAG_DY = 26;
function NameTags({ scene, M }: { scene: LiveScene; M: number }) {
  return scene.buildings.map((b) => {
    if (!b.owner) return null;
    const c = iso(b.x + 1, b.y + 1, M);
    return (
      <NameTag key={b.id} x={c.sx} y={c.sy + TAG_DY} owner={b.owner} dim={b.departed ? DEPARTED_OPACITY : undefined} />
    );
  });
}

/** 게이지를 지붕 꼭대기 위로 (06 문서 5.9 "머리 위"): 꼭대기 = 가운데 − 102(1층 몸통)·−142(2층), 막대 아래가 그보다 24 위 */
const GAUGE_LIFT = { '1f': 70, '2f': 110 };

/** 일터 게이지 (06 문서 5.2): 주인이 일하는 동안. 떠난 주인이면 건물처럼 흐리게 */
function Gauges({ scene, M }: { scene: LiveScene; M: number }) {
  return scene.gauges.map((g) => {
    const b = scene.buildings[g.building];
    if (!b) return null;
    const p = iso(b.x + 1, b.y + 1, M);
    const lift = GAUGE_LIFT[b.body.endsWith('2f') ? '2f' : '1f'];
    const dim = b.departed ? DEPARTED_OPACITY : undefined;
    return <Gauge key={b.id} x={p.sx} y={p.sy - lift} pct={g.pct} label={g.label} dim={dim} />;
  });
}

/** 임시 층 배지 (06 문서 14장) — 그림 몫이라 labels와 상관없이 늘 */
function Badges({ scene, M }: { scene: LiveScene; M: number }) {
  return scene.buildings.map((b) => {
    if (!b.badge) return null;
    const p = iso(b.x + 1, b.y + 1, M);
    return <FloorBadge key={b.id} x={p.sx} y={p.sy} text={b.badge} dim={b.departed ? DEPARTED_OPACITY : undefined} />;
  });
}

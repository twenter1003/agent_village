// 방 장면 (01 문서 8.4, 03 문서 3.5 room.shell, 캔버스 SeaScreenHouse · SeaScreenShop): 벽 2면·둥근 창·수면 액자·
// 난파선 목재 마루 + 가구 + 쉬는 팀원. 방 단위 = 타일 64×32, 바닥 위 꼭짓점이 원점. scale배로 그리고 선은 화면에서 3px
// (가구·캐릭터는 에셋이 1/scale 보정, 껍데기는 3/scale). 칸 규칙(겹침·벽 가구·밖 가구)은 core canPlace·findSpot — 여기는 그리기만.
import { ROOM, type GameConfig, type Placement } from '@tycoon/core';
import { useId, type ComponentProps, type KeyboardEvent, type PointerEvent } from 'react';
import sea from '../../../../design/theme-map.sea.json';
import { asset, Prop, type Slot } from '../assets/sea/Asset';
import { Critter } from '../render/Critter';
import { TILE_H, TILE_W } from '../render/iso';
import type { PoseName, SpeciesId } from '../render/rig';
import './room.css';

// 캔버스 바다 15(배율 1.6)에서 잰 값 (03 문서 3.5)
const WALL = 106.25; // 170 / 1.6
const EDGE = 5; // 벽 두께 8 / 1.6
const LIP = 9; // 마루 옆면 14 / 1.6
const PX = 1 / 1.6; // 창·액자·광택 줄은 캔버스 px 좌표 그대로 이 배율로
export const WHO = 0.9 / 1.6; // 캐릭터 배율

export interface RoomItem {
  id: string;
  kind: string; // 정본 가구 id
  fabric: string | null;
  placed: Placement;
}

const spec = (kind: string, cfg: GameConfig) => cfg.furniture.find((f) => f.id === kind);

/** 차지 칸 (01 문서 8.4, core canPlace와 같은 규칙): 2×1은 rot 0이면 x쪽, rot 1이면 y쪽으로 한 칸 더 */
export function cellsOf(kind: string, p: Placement, cfg: GameConfig): [number, number][] {
  if (spec(kind, cfg)?.tiles !== '2x1') return [[p.x, p.y]];
  return [[p.x, p.y], p.rot ? [p.x, p.y + 1] : [p.x + 1, p.y]];
}

/** 차지 칸 가운데 (칸 좌표) = 에셋 기준점 (03 문서 2.1) */
function center(kind: string, p: Placement, cfg: GameConfig) {
  const cs = cellsOf(kind, p, cfg);
  const mean = (i: 0 | 1) => cs.reduce((n, c) => n + c[i], 0) / cs.length + 0.5;
  return { u: mean(0), v: mean(1) };
}

/** 그리는 순서 (02 문서 7.2를 방에): 바닥 층(러그) 먼저, 그다음 차지 칸 가운데의 x+y, 같으면 화면 x */
export function depthSort<T extends { u: number; v: number; floor?: boolean }>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => +!a.floor - +!b.floor || a.u + a.v - (b.u + b.v) || a.u - a.v - (b.u - b.v));
}

/** 정본 가구 id → 바다 에셋 (theme-map furniture 표, 꽃밭은 prop 표의 anemone) */
export function furnitureAsset(kind: string) {
  const f = (sea.furniture as Record<string, string | undefined>)[kind];
  if (f) return `furniture.${f}`;
  const p = (sea.prop as Record<string, string | undefined>)[kind];
  return p ? `prop.${p}` : `furniture.${kind}`;
}

/** 천 색(cfg.fabricColors) → 슬롯 색 (03 문서 3.5, 캔버스 17 견본과 같은 값) */
export const FABRIC_SLOT: Record<string, Slot | undefined> = { blue: 1, coral: 2, mustard: 3, green: 4, lavender: 5 };
export const fabricSlot = (fabric: string | null): Slot => (fabric === null ? undefined : FABRIC_SLOT[fabric]) ?? 3;

/** 칸 좌표 (u, v) → 방 좌표 */
export const toRoom = (u: number, v: number) => ({ sx: ((u - v) * TILE_W) / 2, sy: ((u + v) * TILE_H) / 2 });

/** 방 좌표 → 칸 */
export function cellAt(sx: number, sy: number) {
  const a = sy / (TILE_H / 2);
  const b = sx / (TILE_W / 2);
  return { x: Math.floor((a + b) / 2), y: Math.floor((a - b) / 2) };
}

/** 장면 상자 (방 단위): 원점(바닥 위 꼭짓점)의 자리와 크기. 벽 모서리 뚜껑 위 1 여유 */
export function roomBox(size = ROOM) {
  const hw = (size * TILE_W) / 2 + EDGE;
  const oy = WALL + EDGE + 1;
  return { ox: hw, oy, w: 2 * hw, h: oy + size * TILE_H + LIP };
}

/** 화면 좌표(clientX/Y) → 칸. el = 장면 뿌리 (RoomScene의 div) */
export function cellFromPoint(el: Element, clientX: number, clientY: number, scale: number, size = ROOM) {
  const r = el.getBoundingClientRect();
  const { ox, oy } = roomBox(size);
  return cellAt((clientX - r.left) / scale - ox, (clientY - r.top) / scale - oy);
}

/** 쉬는 팀원 자리: 빈 칸 중 방 가운데에서 가까운 칸 (같으면 앞 줄) */
export function restCell(items: readonly RoomItem[], cfg: GameConfig, size = ROOM): [number, number] | null {
  const taken = new Set(items.flatMap((i) => cellsOf(i.kind, i.placed, cfg).map(String)));
  const c = size / 2;
  const dist = ([x, y]: [number, number]) => Math.abs(x - c) + Math.abs(y - c);
  const free = Array.from({ length: size * size }, (_, i): [number, number] => [i % size, Math.floor(i / size)]).filter(
    (p) => !taken.has(String(p)),
  );
  return free.sort((p, q) => dist(p) - dist(q))[0] ?? null;
}

const pts = (xs: { sx: number; sy: number }[]) => xs.map((p) => `${p.sx},${p.sy}`).join(' ');

/** 차지 칸 바깥 테두리 (방 좌표 다각형) */
function footprint(kind: string, p: Placement, cfg: GameConfig) {
  const cs = cellsOf(kind, p, cfg);
  const x0 = Math.min(...cs.map((c) => c[0]));
  const y0 = Math.min(...cs.map((c) => c[1]));
  const x1 = Math.max(...cs.map((c) => c[0])) + 1;
  const y1 = Math.max(...cs.map((c) => c[1])) + 1;
  return pts([toRoom(x0, y0), toRoom(x1, y0), toRoom(x1, y1), toRoom(x0, y1)]);
}

/** 방 껍데기 (캔버스 SeaScreenHouse 인라인 SVG). 칸 선은 옮기기 모드만 */
function Shell({ size, scale: S, grid }: { size: number; scale: number; grid: boolean }) {
  const sh = `${useId().replace(/\W/g, '')}-sh`;
  const { ox, oy, w, h } = roomBox(size);
  const hw = (size * TILE_W) / 2;
  const hh = (size * TILE_H) / 2;
  const D = 2 * hh;
  const k = size / ROOM;
  // 창·액자는 6×6 벽의 같은 비율 자리로 (벽 기울기 0.5를 따라 옮김)
  const shift = (side: 1 | -1, t: number) => `translate(${side * (hw - 192) * t} ${(hh - 96) * t})`;
  const w3 = 3 / S;
  const inPx = (n: number) => n / (S * PX); // 캔버스 px 무리 안의 선 굵기
  const lines = (from: (i: number) => [number, number], to: (i: number) => [number, number]) =>
    Array.from({ length: size - 1 }, (_, n) => {
      const a = toRoom(...from(n + 1));
      const b = toRoom(...to(n + 1));
      return `M${a.sx} ${a.sy}L${b.sx} ${b.sy}`;
    }).join('');
  return (
    <svg className="rs-shell" width={w * S} height={h * S} viewBox={`${-ox} ${-oy} ${w} ${h}`} aria-hidden="true">
      <defs>
        <radialGradient id={sh}>
          <stop offset="0" style={{ stopColor: 'var(--ink)', stopOpacity: 0.18 }} />
          <stop offset="1" style={{ stopColor: 'var(--ink)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <ellipse cx={3 * k} cy={D + 20.5} rx={206 * k} ry={37.5 * k} fill={`url(#${sh})`} />
      <g strokeWidth={w3} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: 'var(--ink)' }}>
        <polygon points={`0,0 ${-hw},${hh} ${-hw},${hh - WALL} 0,${-WALL}`} style={{ fill: 'var(--nacre-r)' }} />
        <polygon points={`0,0 ${hw},${hh} ${hw},${hh - WALL} 0,${-WALL}`} style={{ fill: 'var(--nacre-l)' }} />
        <polygon
          points={`${-hw - EDGE},${hh - WALL - 2.5} ${-hw},${hh - WALL} ${-hw},${hh} ${-hw - EDGE},${hh - 2.5}`}
          style={{ fill: 'var(--cap-edge)' }}
        />
        <polygon
          points={`${hw},${hh - WALL} ${hw + EDGE},${hh - WALL - 2.5} ${hw + EDGE},${hh - 2.5} ${hw},${hh}`}
          style={{ fill: 'var(--cap-edge)' }}
        />
        <polygon
          points={`${-EDGE},${-WALL - 2.5} 0,${-WALL} ${-hw},${hh - WALL} ${-hw - EDGE},${hh - WALL - 2.5}`}
          style={{ fill: 'var(--nacre-top)' }}
        />
        <polygon
          points={`0,${-WALL} ${EDGE},${-WALL - 2.5} ${hw + EDGE},${hh - WALL - 2.5} ${hw},${hh - WALL}`}
          style={{ fill: 'var(--nacre-top)' }}
        />
        <polygon
          points={`${-EDGE},${-WALL - 2.5} 0,${-WALL - 5} ${EDGE},${-WALL - 2.5} 0,${-WALL}`}
          style={{ fill: 'var(--nacre-top)' }}
        />
        <polygon points={`${-hw},${hh} 0,${D} 0,${D + LIP} ${-hw},${hh + LIP}`} style={{ fill: 'var(--wreck-l)' }} />
        <polygon points={`0,${D} ${hw},${hh} ${hw},${hh + LIP} 0,${D + LIP}`} style={{ fill: 'var(--wreck-r)' }} />
        <polygon points={`0,0 ${hw},${hh} 0,${D} ${-hw},${hh}`} style={{ fill: 'var(--wreck-top)' }} />
      </g>
      {/* 마루 널 (x 방향 줄). 옮기기 모드는 y 방향 줄도 → 칸이 보이게 */}
      <path
        d={lines(
          (v) => [0, v],
          (v) => [size, v],
        )}
        fill="none"
        strokeWidth={2 / S}
        strokeLinecap="round"
        style={{ stroke: 'var(--wreck-l)' }}
      />
      {grid && (
        <path
          className="rs-grid"
          d={lines(
            (u) => [u, 0],
            (u) => [u, size],
          )}
          fill="none"
          strokeWidth={2 / S}
          strokeDasharray={`${4 / S} ${4 / S}`}
          style={{ stroke: 'var(--wreck-l)' }}
        />
      )}
      {/* 자개 광택 줄 */}
      <path
        transform={`scale(${PX * k})`}
        d="M-260 0Q-180 -42 -100 -70M100 -70Q180 -32 260 0"
        fill="none"
        strokeWidth={4 / (S * PX * k)}
        strokeLinecap="round"
        strokeOpacity={0.8}
        style={{ stroke: 'var(--nacre-sheen-1)' }}
      />
      {/* 둥근 창 (오른쪽 벽) */}
      <g transform={`${shift(1, 0.47)} scale(${PX}) matrix(1 0.5 0 1 143 -38)`}>
        <circle r="31" strokeWidth={inPx(3)} style={{ fill: 'var(--brass-l)', stroke: 'var(--ink)' }} />
        <circle r="23" strokeWidth={inPx(2.5)} style={{ fill: 'var(--water-bg-2)', stroke: 'var(--ink)' }} />
        <path d="M-12 4C-8 0 -2 0 2 4C-2 8 -8 8 -12 4ZM1 4L6 0.5L6 7.5Z" style={{ fill: 'var(--fish-school)' }} />
        <path
          d="M-15 -8A17 17 0 0 1 -6 -16"
          fill="none"
          strokeWidth={inPx(3)}
          strokeLinecap="round"
          style={{ stroke: 'var(--sheen)' }}
        />
        <g style={{ fill: 'var(--brass-r)' }}>
          <circle cy="-27" r="2" />
          <circle cx="27" r="2" />
          <circle cy="27" r="2" />
          <circle cx="-27" r="2" />
        </g>
      </g>
      {/* 수면 풍경 액자 (왼쪽 벽) */}
      <g transform={`${shift(-1, 0.5)} scale(${PX})`} strokeLinejoin="round" style={{ stroke: 'var(--ink)' }}>
        <polygon
          points="-133.1,-3.4 -184.3,22.2 -184.3,-27.8 -133.1,-53.4"
          strokeWidth={inPx(3)}
          style={{ fill: 'var(--wreck-top)' }}
        />
        <polygon
          points="-138.1,-10.4 -179.3,10.2 -179.3,-22.8 -138.1,-43.4"
          strokeWidth={inPx(3)}
          style={{ fill: 'var(--water-bg-1)' }}
        />
        <path
          d="M-179.3 2L-170 -4L-160 -3L-150 -10L-138.1 -14L-138.1 -10.4L-179.3 10.2Z"
          strokeWidth={inPx(1.5)}
          style={{ fill: 'var(--slot1)' }}
        />
        <circle cx="-154" cy="-29" r="4.5" strokeWidth={inPx(1.5)} style={{ fill: 'var(--coin)' }} />
      </g>
    </svg>
  );
}

export interface RoomEdit {
  /** 고른 가구 (aria-pressed) */
  selected: string | null;
  /** 가구 버튼 이름 ("대합 침대 · (3, 0)") */
  name: (i: RoomItem) => string;
  onItemPointerDown: (id: string, e: PointerEvent) => void;
  onItemKeyDown: (id: string, e: KeyboardEvent) => void;
  onItemClick: (id: string) => void;
}

export interface RoomSceneProps extends Omit<ComponentProps<'div'>, 'children'> {
  cfg: GameConfig;
  /** 방에 놓인 가구 (창고 것은 빼고) */
  items: readonly RoomItem[];
  /** 화면 px / 방 단위. 집 1.6 (캔버스 15), 상점 미리보기는 칸에 맞춰 줄임 */
  scale: number;
  /** 방 한 변 칸 수 (6×6 = core ROOM, 3×3도 그려짐) */
  size?: number;
  /** 방 안의 팀원 (없으면 빈 방). 빈 칸 중 가운데에서 가까운 칸 */
  who?: { species: SpeciesId; variant?: number; accessory: string; pose: PoseName } | null;
  /** 칸 표시: 놓일 자리 = 자홍 점선(--focus), 못 놓는 자리 = --danger. 가구 위에 그림 */
  mark?: { kind: string; placed: Placement; ok: boolean } | null;
  /** 옮기기 모드: 칸 선 + 가구가 진짜 <button> */
  edit?: RoomEdit | null;
  /** 장면 이름 (role=group) */
  label: string;
}

export function RoomScene({
  cfg,
  items,
  scale: S,
  size = ROOM,
  who,
  mark,
  edit,
  label,
  className,
  style,
  ...rest
}: RoomSceneProps) {
  const { ox, oy, w, h } = roomBox(size);
  const at = (u: number, v: number) => {
    const { sx, sy } = toRoom(u, v);
    return { x: (ox + sx) * S, y: (oy + sy) * S };
  };
  const spot = who ? restCell(items, cfg, size) : null;
  const list = [
    ...items.map((item) => ({
      ...center(item.kind, item.placed, cfg),
      floor: spec(item.kind, cfg)?.layer === 'floor',
      item,
    })),
    ...(spot ? [{ u: spot[0] + 0.5, v: spot[1] + 0.5, item: null }] : []),
  ];
  // 깊이는 z-index로 — DOM 순서가 바뀌면 화살표로 옮기던 가구 버튼이 포커스를 잃는다
  const z = new Map(depthSort(list).map((d, i) => [d, i + 1]));
  const bad = mark && !mark.ok ? edit?.selected : null;

  return (
    <div
      role="group"
      aria-label={label}
      className={`rs${edit ? ' rs--edit' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, width: w * S, height: h * S }}
      {...rest}
    >
      <Shell size={size} scale={S} grid={!!edit} />
      {list.map((d) => {
        const { item } = d;
        const p = at(d.u, d.v);
        const zIndex = z.get(d);
        if (!item) {
          if (!who) return null;
          return (
            <div
              key="who"
              className="rs-who"
              style={{ left: p.x - 64 * WHO * S, top: p.y - 126 * WHO * S, zIndex }}
              data-cell={spot?.join(',')}
            >
              <Critter
                species={who.species}
                variant={who.variant}
                accessory={who.accessory}
                pose={who.pose}
                scale={WHO * S}
                bubbles
              />
            </div>
          );
        }
        const id = furnitureAsset(item.kind);
        const [ax = 0, ay = 0] = (asset(id).data.anchor ?? '').split(',').map(Number);
        const pos = {
          left: p.x - ax * S,
          top: p.y - ay * S,
          zIndex,
          transform: item.placed.rot ? 'scaleX(-1)' : undefined, // 1×2 = 좌우 반전 (03 문서 2.1)
        };
        const pic = <Prop kind={id} scale={S} fab={fabricSlot(item.fabric)} />;
        const cls = `rs-item${item.id === bad ? ' rs-item--bad' : ''}`;
        return edit ? (
          <button
            key={item.id}
            type="button"
            className={cls}
            style={pos}
            data-fid={item.id}
            aria-label={edit.name(item)}
            aria-pressed={edit.selected === item.id}
            onPointerDown={(e) => edit.onItemPointerDown(item.id, e)}
            onKeyDown={(e) => edit.onItemKeyDown(item.id, e)}
            onClick={() => edit.onItemClick(item.id)}
          >
            {pic}
          </button>
        ) : (
          <div key={item.id} className={cls} style={pos} data-fid={item.id}>
            {pic}
          </div>
        );
      })}
      {mark && (
        <svg
          className={`rs-mark rs-mark--${mark.ok ? 'ok' : 'bad'}`}
          style={{ zIndex: list.length + 1 }}
          width={w * S}
          height={h * S}
          viewBox={`${-ox} ${-oy} ${w} ${h}`}
          aria-hidden="true"
        >
          <polygon
            points={footprint(mark.kind, mark.placed, cfg)}
            strokeWidth={2.5 / S}
            strokeDasharray={`${5 / S} ${4 / S}`}
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

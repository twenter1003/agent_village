// 정적 마을 장면: 바닥 → 깊이 정렬된 건물·소품·캐릭터 → 물 효과 → 월드 UI (02 문서 7.2, 05 문서 3.4)
import { memo, useMemo, type ReactNode } from 'react';
import { Building, type BuildingProps } from '../assets/sea/Building';
import { asset, Prop } from '../assets/sea/Asset';
import { Critter, type CritterProps } from '../render/Critter';
import { byDepth, iso, world } from '../render/iso';
import { rig } from '../render/rig';
import { Ground } from './Ground';
import { OwnerSign, type Owner } from './OwnerSign';
import { useSwayFrame } from './sway';
import { WaterFx } from './WaterFx';
import { Progress, Sleep, Speech, Typing, VisitorTag } from './WorldUi';

/**
 * departed = 떠난 팀원의 집: 건물 전체를 흐리게 (01 문서 3.1-5). ghost(몸만 투명)는 지붕 미리보기용.
 * owner가 있으면 간판 자리에 주인 얼굴 간판 (06 문서 7장) — 그림 간판(sign)은 그리지 않는다
 */
export type SceneBuilding = Omit<BuildingProps, 'scale'> & {
  x: number;
  y: number;
  id?: string;
  departed?: boolean;
  owner?: Owner;
};
export interface SceneProp {
  x: number;
  y: number;
  kind: string;
  phase?: number;
}
export interface Scene {
  map: number;
  buildings: SceneBuilding[];
  props: SceneProp[];
  characters: (CritterProps & { x: number; y: number; depthY?: number })[];
  worldUi: {
    kind: string;
    char?: number;
    building?: number;
    text?: string;
    done?: number;
    partial?: number;
    total?: number;
  }[];
}

/** 깊이 정렬 항목 (7.2): d = 기준점 sy */
export interface Ent {
  d: number;
  sx: number;
  key: string;
  el: ReactNode;
}

export const S = rig.worldScale;
/** 캐릭터 발 위치 → svg 왼쪽 위 (Critter viewBox -64 -126) */
export const critterOrigin = (sx: number, sy: number) => `translate(${sx - 64 * S} ${sy - 126 * S})`;

/** 떠난 팀원 집 불투명도 = 팀원 패널의 떠난 카드(.tp-card--departed)와 같게 */
export const DEPARTED_OPACITY = 0.55;

// 8.4-2: 건물·소품은 memo → 스냅샷이 와도 바뀐 것만 다시 그림
// data-building = 장면 건물 id: LiveVillage가 골조 clip을 DOM으로 올린다 (M6)
const BuildingAt = memo(function BuildingAt({ x, y, map, id, departed, ...b }: SceneBuilding & { map: number }) {
  const c = iso(x + 1, y + 1, map);
  return (
    <g
      data-building={id}
      transform={`translate(${c.sx - 80} ${c.sy - 208})`}
      opacity={departed ? DEPARTED_OPACITY : undefined}
    >
      <Building {...b} />
    </g>
  );
});

/** 얼굴 간판 자리 = 부지 가운데 기준 sign.* 판 가운데 (1층 왼쪽 벽, matrix(1 0.5 0 1 54 221)의 (12, −25) → (66, 202) − (80, 208)) */
export const SIGN_AT = { dx: -14, dy: -6, size: 34 };

/**
 * 건물 그림 + 주인 얼굴 간판 (06 문서 7장, D25): 일터 상세·격자 카드도 마을(SignAt)과 같은 자리에 얼굴, 그림 간판은 빼고.
 * 배율 scale로 넣어도 간판 선은 3 그대로 — 바깥 svg는 viewBox 없이 px (Building이 선을 3/s로 보정하는 것과 같다)
 */
export function OwnedBuilding({ owner, scale = 1, ...b }: BuildingProps & { owner?: Owner }) {
  if (!owner) return <Building {...b} scale={scale} />;
  return (
    <svg width={160 * scale} height={256 * scale} aria-hidden="true">
      <Building {...b} sign="none" scale={scale} />
      <g transform={`translate(${(80 + SIGN_AT.dx) * scale} ${(208 + SIGN_AT.dy) * scale})`}>
        <OwnerSign owner={owner} size={SIGN_AT.size * scale} />
      </g>
    </svg>
  );
}

// 얼굴 간판은 건물과 따로 memo (주인 칸이 모두 원시값이라 스냅샷이 와도 안 바뀌면 그대로)
const SignAt = memo(function SignAt({
  x,
  y,
  map,
  departed,
  ...owner
}: Owner & { x: number; y: number; map: number; departed?: boolean }) {
  const c = iso(x + 1, y + 1, map);
  return (
    <g
      transform={`translate(${c.sx + SIGN_AT.dx} ${c.sy + SIGN_AT.dy})`}
      opacity={departed ? DEPARTED_OPACITY : undefined}
    >
      <OwnerSign owner={owner} size={SIGN_AT.size} />
    </g>
  );
});

const propBox = (kind: string) => {
  const a = asset(`prop.${kind}`);
  const [w = 1, h = 1] = (a.data.tiles ?? '1x1').split('x').map(Number);
  const [ax = 0, ay = 0] = (a.data.anchor ?? '0,0').split(',').map(Number);
  return { w, h, ax, ay };
};

/** 흔들리는 소품만 타이머를 본다 (나머지는 memo 그대로) */
function Swaying({ kind, phase = 0 }: { kind: string; phase?: number }) {
  return <Prop kind={kind} sway={useSwayFrame() + phase} />;
}

const PropAt = memo(function PropAt({ x, y, kind, phase, map }: SceneProp & { map: number }) {
  const { w, h, ax, ay } = propBox(kind);
  const c = iso(x + w / 2, y + h / 2, map);
  const id = `prop.${kind}`;
  return (
    <g transform={`translate(${c.sx - ax} ${c.sy - ay})`}>
      {asset(id).data.sway ? <Swaying kind={id} phase={phase} /> : <Prop kind={id} />}
    </g>
  );
});

/** 건물·소품 → 깊이 정렬 항목. 실시간 마을(LiveVillage)도 같이 쓴다 */
export function staticEnts(buildings: SceneBuilding[], props: SceneProp[], M: number): Ent[] {
  const out: Ent[] = [];
  buildings.forEach(({ owner, ...b }, i) => {
    const c = iso(b.x + 1, b.y + 1, M);
    const el = owner ? (
      <>
        <BuildingAt {...b} sign="none" map={M} />
        <SignAt {...owner} x={b.x} y={b.y} map={M} departed={b.departed} />
      </>
    ) : (
      <BuildingAt {...b} map={M} />
    );
    out.push({ d: c.sy, sx: c.sx, key: b.id ?? `b${i}`, el });
  });
  for (const p of props) {
    const { w, h } = propBox(p.kind);
    const c = iso(p.x + w / 2, p.y + h / 2, M);
    out.push({ d: c.sy - 0.5, sx: c.sx, key: `${p.kind}@${p.x},${p.y}`, el: <PropAt {...p} map={M} /> });
  }
  return out;
}

/** 거품 줄기 소스: 대합 분수 물줄기 위, 보물상자 뚜껑, 섬 가장자리 두 곳 (SeaFx SOURCES 기준) */
export function bubbleSources(props: SceneProp[], M: number) {
  const out: [number, number, number][] = [];
  for (const p of props) {
    if (p.kind === 'clamfountain') {
      const c = iso(p.x + 1, p.y + 1, M);
      out.push([c.sx + 1, c.sy - 144, 0]);
    }
    if (p.kind === 'chest') {
      const c = iso(p.x + 0.5, p.y + 0.5, M);
      out.push([c.sx - 2, c.sy - 74, 7]);
    }
  }
  const r = iso(M, M / 2, M),
    l = iso(0, M * 0.6, M);
  out.push([r.sx - 82, r.sy - 2, 13], [l.sx + 80, l.sy - 42, 20]);
  return out;
}

export function Village({ scene, fx = true, labels = true }: { scene: Scene; fx?: boolean; labels?: boolean }) {
  const M = scene.map;
  const W = world(M);
  const ents = useMemo(() => {
    const out = staticEnts(scene.buildings, scene.props, M);
    scene.characters.forEach(({ x, y, depthY, ...ch }, i) => {
      const c = iso(x, y, M);
      out.push({
        d: depthY ?? c.sy + 0.5,
        sx: c.sx,
        key: `c${i}`,
        el: (
          <g transform={critterOrigin(c.sx, c.sy)}>
            <Critter {...ch} scale={S} />
          </g>
        ),
      });
    });
    return out.sort(byDepth);
  }, [scene, M]);

  const charPos = (i?: number) => {
    const c = scene.characters[i ?? -1];
    return c ? iso(c.x, c.y, M) : null;
  };
  const sources = useMemo(() => bubbleSources(scene.props, M), [scene, M]);

  return (
    <div style={{ position: 'relative', width: W.w, height: W.h }}>
      <Ground map={M} />
      <svg width={W.w} height={W.h} viewBox={`0 0 ${W.w} ${W.h}`} style={{ position: 'absolute', overflow: 'visible' }}>
        {ents.map((e) => (
          <g key={e.key}>{e.el}</g>
        ))}
        {fx && <WaterFx worldW={W.w} sources={sources} />}
      </svg>
      {labels &&
        scene.worldUi.map((u, i) => {
          const c = charPos(u.char);
          if (u.kind === 'speech' && c) return <Speech key={i} x={c.sx} y={c.sy} text={u.text ?? '…'} />;
          if (u.kind === 'typing' && c) return <Typing key={i} x={c.sx} y={c.sy} />;
          if (u.kind === 'sleep' && c) return <Sleep key={i} x={c.sx} y={c.sy} />;
          if (u.kind === 'visitorTag' && c) return <VisitorTag key={i} x={c.sx} y={c.sy} text={u.text ?? ''} />;
          const b = scene.buildings[u.building ?? -1];
          if (u.kind === 'progress' && b) {
            const p = iso(b.x + 1, b.y + 1, M);
            return (
              <Progress key={i} x={p.sx} y={p.sy} done={u.done ?? 0} partial={u.partial ?? 0} total={u.total ?? 0} />
            );
          }
          return null;
        })}
    </div>
  );
}

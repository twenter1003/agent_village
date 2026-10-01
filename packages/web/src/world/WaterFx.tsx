// 바다 월드 층 (05 문서 3.4). 모두 pointer-events: none. 원본 200ms 타이머 → 150ms 전역 틱에 묶고 거리만 비례 (×0.75).
import { useEffect, useRef } from 'react';
import { subscribe } from '../render/ticker';

const K = 150 / 200;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** 화면 고정 빛줄기 4개 (카메라를 따라가지 않음). 1440×900 기준 좌표를 늘려 씀 */
export function LightRays({ front = false }: { front?: boolean }) {
  const rays = front
    ? ['M170 -10L262 -10L96 910L-20 910Z', 'M880 -10L960 -10L812 910L716 910Z']
    : [
        'M170 -10L262 -10L96 910L-20 910Z',
        'M520 -10L572 -10L420 910L352 910Z',
        'M880 -10L960 -10L812 910L716 910Z',
        'M1250 -10L1300 -10L1180 910L1120 910Z',
      ];
  const op = front ? [0.07, 0.07] : [0.2, 0.14, 0.18, 0.12];
  return (
    <svg
      viewBox="0 0 1440 900"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {rays.map((d, i) => (
        <path key={i} d={d} style={{ fill: 'var(--sheen)' }} fillOpacity={op[i]} />
      ))}
    </svg>
  );
}

const FISH_OFF = [
  [0, 0],
  [26, -10],
  [30, 12],
  [58, -2],
  [62, 18],
  [90, 6],
  [96, -14],
] as const;

export function fishPositions(tick: number, worldW: number) {
  const loop = worldW + 550;
  const baseX = worldW + 100 - ((tick * 2.5 * K) % loop);
  return FISH_OFF.map(([dx, dy], k) => ({ x: r1(baseX + dx), y: r1(40 + dy + Math.sin((tick * K) / 4 + k) * 2) }));
}

/** 거품 줄기: 소스마다 4개, 수명 28틱(200ms) → 37틱(150ms) */
export function streamBubbles(tick: number, sources: [number, number, number][]) {
  const life = Math.round(28 / K);
  return sources.flatMap(([sx, sy, ph], si) =>
    [0, 1, 2, 3].map((j) => {
      const t = (tick + Math.round((ph + j * 7) / K)) % life;
      const tt = t * K; // 원본 틱 단위 시간
      const r = 2.4 + ((j + si) % 3) * 1.1 + tt * 0.05;
      const o = tt < 3 ? tt / 3 : tt > 28 - 7 ? (28 - tt) / 7 : 1;
      return { x: r1(sx + Math.sin(tt / 3 + j + si) * 4), y: r1(sy - tt * 7), r: r1(r), o: r1(Math.max(0, o) * 0.9) };
    }),
  );
}

/** 물고기 떼 + 거품 줄기 (월드 좌표, 건물·캐릭터 위) */
export function WaterFx({
  worldW,
  sources,
  bubbles = true,
}: {
  worldW: number;
  sources: [number, number, number][];
  bubbles?: boolean;
}) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    const fish = [...g.querySelectorAll<SVGGElement>('[data-fish]')];
    const bubs = [...g.querySelectorAll<SVGGElement>('[data-bub]')];
    const draw = (tick: number) => {
      fishPositions(tick, worldW).forEach((p, i) => fish[i]?.setAttribute('transform', `translate(${p.x} ${p.y})`));
      if (bubbles)
        streamBubbles(tick, sources).forEach((b, i) => {
          const el = bubs[i];
          if (!el) return;
          el.setAttribute('transform', `translate(${b.x} ${b.y})`);
          el.setAttribute('opacity', String(b.o));
          el.firstElementChild?.setAttribute('r', String(b.r));
          const h = el.lastElementChild;
          h?.setAttribute('cx', String(r1(-b.r * 0.35)));
          h?.setAttribute('cy', String(r1(-b.r * 0.35)));
          h?.setAttribute('r', String(r1(b.r * 0.3)));
        });
    };
    draw(0);
    return subscribe((t) => draw(t));
  }, [worldW, sources, bubbles]);
  return (
    <g ref={ref} data-layer="fx-water" pointerEvents="none">
      {FISH_OFF.map((_, i) => (
        <g key={i} data-fish>
          <path d="M0 0C5 -5 13 -5 18 0C13 5 5 5 0 0ZM17 0L23 -4.5L23 4.5Z" style={{ fill: 'var(--fish-school)' }} />
          <circle cx={4} cy={-0.8} r={0.9} style={{ fill: 'var(--fish-school-eye)' }} />
        </g>
      ))}
      {bubbles &&
        sources.flatMap((_, si) =>
          [0, 1, 2, 3].map((j) => (
            <g key={`${si}-${j}`} data-bub>
              <circle
                r={2}
                style={{ fill: 'var(--bubble)', stroke: 'var(--ink)' }}
                fillOpacity={0.6}
                strokeWidth={1.6}
              />
              <circle r={0.6} style={{ fill: 'var(--sheen)' }} />
            </g>
          )),
        )}
    </g>
  );
}

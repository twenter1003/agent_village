// 바다 마을 바닥 (05 문서 8장: SeaVillage.dc.html 첫 svg를 보고 코드로). 모래 섬 + 현무암 옆면 14 + 조개 자갈 십자 길 + 넓적돌 광장.
import { memo, useId } from 'react';
import { t } from '../i18n';
import { iso, world } from '../render/iso';

// 결정적 난수 (장식 위치). ponytail: mulberry32, 게임 규칙용 rng는 core에서 따로.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pts = (m: number, ...xy: [number, number][]) =>
  xy
    .map(([x, y]) => {
      const p = iso(x, y, m);
      return `${p.sx},${p.sy}`;
    })
    .join(' ');

/** founded = 마을을 세웠나 (01 문서 3.3). 아니면 길·광장 바닥 없이 빈 모래섬.
 *  paved = 길 포장(06 문서 6.2) — 십자 길을 광장 넓적돌 색으로 */
export const Ground = memo(function Ground({
  map = 16,
  seed = 7,
  founded = true,
  paved = false,
}: {
  map?: number;
  seed?: number;
  founded?: boolean;
  paved?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const W = world(map);
  const M = map;
  const mid = M / 2;
  const top = iso(0, 0, M);
  const right = iso(M, 0, M);
  const bottom = iso(M, M, M);
  const left = iso(0, M, M);
  const r = rng(seed);
  const onIsland = () => ({ x: 0.5 + r() * (M - 1), y: 0.5 + r() * (M - 1) });
  const ripples = Array.from({ length: Math.round(M * M * 0.18) }, () => {
    const { x, y } = onIsland();
    const p = iso(x, y, M);
    const w = 5 + Math.round(r() * 2);
    return `M${p.sx.toFixed(0)} ${p.sy.toFixed(0)}q${w / 2} -3 ${w} 0t${w} 0`;
  }).join('');
  const sandLines = Array.from({ length: Math.round(M * 0.6) }, () => {
    const { x, y } = onIsland();
    const p = iso(x, y, M);
    return `M${p.sx.toFixed(0)} ${p.sy.toFixed(0)}Q${(p.sx + 5).toFixed(0)} ${p.sy - 3} ${(p.sx + 10).toFixed(0)} ${p.sy}`;
  }).join('');
  // 앞쪽 두 가장자리에 조약돌 (동그란 것은 괜찮다: 05 문서 5.4)
  const pebbleColors = ['var(--coral-top)', 'var(--starfish)', 'var(--slot5)'];
  const edge = Array.from({ length: Math.round(M * 0.65) }, (_, i) => {
    const t = (i + 0.5) / Math.round(M * 0.65);
    const [a, b] = t < 0.5 ? [left, bottom] : [bottom, right];
    const k = (t % 0.5) * 2;
    return { cx: a.sx + (b.sx - a.sx) * k, cy: a.sy + (b.sy - a.sy) * k + 7, fill: pebbleColors[i % 3] ?? '' };
  });
  return (
    <svg
      width={W.w}
      height={W.h}
      viewBox={`0 0 ${W.w} ${W.h}`}
      aria-label={t('world.ground')}
      data-paved={paved ? '' : undefined}
      role="img"
      style={{ position: 'absolute', overflow: 'visible' }}
    >
      <defs>
        <clipPath id={`${uid}-top`}>
          <polygon points={pts(M, [0, 0], [M, 0], [M, M], [0, M])} />
        </clipPath>
      </defs>
      {/* 먼 산호 실루엣 + 켈프 (섬 뒤) */}
      <g style={{ fill: 'var(--water-bg-3)', opacity: 0.8 }}>
        <path
          d={`M${left.sx - 208} ${top.sy + 180}C${left.sx - 158} ${top.sy + 130} ${left.sx - 78} ${top.sy + 118} ${left.sx - 18} ${top.sy + 134}C${left.sx + 24} ${top.sy + 88} ${left.sx + 102} ${top.sy + 78} ${left.sx + 158} ${top.sy + 102}C${left.sx + 200} ${top.sy + 72} ${left.sx + 248} ${top.sy + 76} ${left.sx + 284} ${top.sy + 96}L${left.sx + 284} ${top.sy + 290}L${left.sx - 208} ${top.sy + 290}Z`}
        />
        <path
          d={`M${right.sx - 284} ${top.sy + 96}C${right.sx - 246} ${top.sy + 76} ${right.sx - 198} ${top.sy + 72} ${right.sx - 156} ${top.sy + 102}C${right.sx - 100} ${top.sy + 78} ${right.sx - 22} ${top.sy + 88} ${right.sx + 20} ${top.sy + 134}C${right.sx + 80} ${top.sy + 118} ${right.sx + 158} ${top.sy + 130} ${right.sx + 208} ${top.sy + 180}L${right.sx + 208} ${top.sy + 290}L${right.sx - 284} ${top.sy + 290}Z`}
        />
      </g>
      <g stroke="var(--ink)" strokeWidth={3} strokeLinejoin="round">
        <polygon
          style={{ fill: 'var(--basalt-l)' }}
          points={`${left.sx},${left.sy} ${bottom.sx},${bottom.sy} ${bottom.sx},${bottom.sy + 14} ${left.sx},${left.sy + 14}`}
        />
        <polygon
          style={{ fill: 'var(--basalt-r)' }}
          points={`${bottom.sx},${bottom.sy} ${right.sx},${right.sy} ${right.sx},${right.sy + 14} ${bottom.sx},${bottom.sy + 14}`}
        />
        <polygon style={{ fill: 'var(--sand-top)' }} points={pts(M, [0, 0], [M, 0], [M, M], [0, M])} />
      </g>
      <g stroke="var(--ink)" strokeWidth={1.5}>
        {edge.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={2.2 + (i % 3) * 0.2} style={{ fill: p.fill }} />
        ))}
      </g>
      {/* 십자 길 (폭 2) + 광장 4×4 — 마을을 세운 뒤에만 */}
      {founded && (
        <>
          <polygon
            style={{ fill: paved ? 'var(--metal-top)' : 'var(--gravel-top)' }}
            points={pts(M, [0, mid - 1], [M, mid - 1], [M, mid + 1], [0, mid + 1])}
          />
          <polygon
            style={{ fill: paved ? 'var(--metal-top)' : 'var(--gravel-top)' }}
            points={pts(M, [mid - 1, 0], [mid + 1, 0], [mid + 1, M], [mid - 1, M])}
          />
          {/* 길 포장 이음줄 (06 문서 14.1): 가운데 줄 + 두 줄 돌을 반 칸씩 엇갈려. 광장이 그 위를 덮는다 */}
          {paved && (
            <path
              d={[
                `M${pts(M, [0, mid], [M, mid])}M${pts(M, [mid, 0], [mid, M])}`,
                ...Array.from(
                  { length: M },
                  (_, u) =>
                    `M${pts(M, [u, mid - 1], [u, mid])}M${pts(M, [u + 0.5, mid], [u + 0.5, mid + 1])}` +
                    `M${pts(M, [mid - 1, u], [mid, u])}M${pts(M, [mid, u + 0.5], [mid + 1, u + 0.5])}`,
                ),
              ]
                .join('')
                .replace(/ /g, 'L')}
              fill="none"
              style={{ stroke: 'var(--metal-l)' }}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          )}
          <polygon
            style={{ fill: 'var(--metal-top)' }}
            points={pts(M, [mid - 2, mid - 2], [mid + 2, mid - 2], [mid + 2, mid + 2], [mid - 2, mid + 2])}
          />
          <path
            d={[1, 2, 3]
              .map((k) => {
                const a = iso(mid - 2 + k, mid - 2, M),
                  b = iso(mid - 2 + k, mid + 2, M),
                  c = iso(mid - 2, mid - 2 + k, M),
                  d = iso(mid + 2, mid - 2 + k, M);
                return `M${a.sx} ${a.sy}L${b.sx} ${b.sy}M${c.sx} ${c.sy}L${d.sx} ${d.sy}`;
              })
              .join('')}
            fill="none"
            style={{ stroke: 'var(--metal-l)' }}
            strokeWidth={1.5}
          />
        </>
      )}
      <path d={sandLines} fill="none" style={{ stroke: 'var(--sand-l)' }} strokeWidth={1.8} strokeLinecap="round" />
      {/* 물결 빛 무늬 (섬 윗면 안만) */}
      <g
        clipPath={`url(#${uid}-top)`}
        fill="none"
        style={{ stroke: 'var(--sheen)' }}
        strokeOpacity={0.55}
        strokeWidth={2}
        strokeLinecap="round"
      >
        <path d={ripples} />
      </g>
    </svg>
  );
});

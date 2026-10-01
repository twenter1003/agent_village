// 경제 패널 차트 (03 문서 6장 경제 차트 규칙, 캔버스 SeaScreenEconomy): 손으로 그린 SVG, 차트 라이브러리 없음.
// 격자 1px 실선, 막대 ≤ 24 + 데이터 끝만 4px 둥글게. 색은 --chart-1/--chart-2만 (economy.css). 물가·금리 날짜 차트는 D20으로 뺐다.
// 툴팁: 마우스는 가장 가까운 주에 붙고, 키보드는 차트에 포커스 → ←/→/Home/End (01 문서 8.7 구현 메모). 표로 보기가 같은 값을 다 보여 준다.
import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

/** 깔끔한 눈금 (1·2·2.5·5 × 10^k). lo == hi면 위아래로 벌린다 */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) [lo, hi] = [lo - 1, hi + 1];
  const raw = (hi - lo) / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const a = Math.floor(lo / step + 1e-9);
  const b = Math.ceil(hi / step - 1e-9);
  return Array.from({ length: b - a + 1 }, (_, i) => Number(((a + i) * step).toFixed(10)));
}

/** 세로 막대: 기준선 y0에서 데이터 끝 y1까지, 데이터 끝만 r 둥글게 (위·아래 둘 다) */
export function barPath(x: number, w: number, y0: number, y1: number, r = 4): string {
  const rr = Math.min(r, Math.abs(y1 - y0), w / 2);
  const d = y1 < y0 ? rr : -rr; // 모서리가 기준선 쪽으로 돌아오는 방향
  const n = (v: number) => Number(v.toFixed(1));
  return `M${n(x)} ${n(y0)}V${n(y1 + d)}Q${n(x)} ${n(y1)} ${n(x + rr)} ${n(y1)}H${n(x + w - rr)}Q${n(x + w)} ${n(y1)} ${n(x + w)} ${n(y1 + d)}V${n(y0)}Z`;
}

/** 마우스·키보드가 같이 쓰는 "지금 가리키는 칸". 데이터가 줄어 칸이 없어지면 없음 */
function useScrub(n: number, nearest: (e: PointerEvent<HTMLDivElement>) => number | null) {
  const [i, setI] = useState<number | null>(null);
  const at = i !== null && i < n ? i : null;
  const onKeyDown = (e: KeyboardEvent) => {
    const cur = at ?? n - 1;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined || n === 0) return;
    e.preventDefault();
    setI(Math.max(0, Math.min(n - 1, next)));
  };
  return {
    at,
    handlers: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => setI((v) => v ?? n - 1), // 포커스하면 가장 최근 칸부터
      onBlur: () => setI(null),
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        const k = nearest(e);
        if (k !== null) setI(k);
      },
      onPointerLeave: () => setI(null),
    },
  };
}

/** 포인터 x → viewBox x (크기가 0이면 모름 — 그리기 전·테스트 DOM) */
function viewX(e: PointerEvent<HTMLDivElement>, w: number): number | null {
  const r = e.currentTarget.getBoundingClientRect();
  return r.width > 0 ? ((e.clientX - r.left) * w) / r.width : null;
}

/** 툴팁: 값이 앞(굵게), 이름이 뒤. 오른쪽 30%에 들어가면 왼쪽으로 뒤집는다.
 *  읽기 알림(status)은 늘 있고 안의 상자만 넣고 뺀다 — 숨긴 live region을 보이며 채우면 첫 값이 안 읽힌다 */
function Tip({ x, w, children }: { x: number | null; w: number; children: ReactNode }) {
  return (
    <div role="status">
      {x !== null && (
        <div className={`ec-tip${x > w * 0.7 ? ' ec-tip--flip' : ''}`} style={{ left: `${(x / w) * 100}%` }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** 툴팁 한 줄: 계열 색 짧은 선 + 이름 + 값 (03 문서 6장, 막대 계열도 상자 대신 선) */
export function TipRow({ series, label, value }: { series?: 1 | 2; label: string; value?: string }) {
  return (
    <div className="ec-tip__row">
      {series && <span className={`ec-linekey ec-linekey--${series}`} aria-hidden="true" />}
      {label}
      {value !== undefined && <b className="ec-tip__num">{value}</b>}
    </div>
  );
}

export interface WeekBar {
  label: string;
  income: number;
  spending: number;
}

const FW = 500;
const FL = 48;
const FR = 490;

/** 주별 보물상자 흐름: 수입은 기준선 위(--chart-1), 지출은 아래(--chart-2). 둘 사이 2px 틈 (dataviz 바탕 틈) */
export function FlowChart({
  weeks,
  fmt,
  label,
  tip,
}: {
  weeks: WeekBar[];
  fmt: (v: number) => string;
  label: string;
  tip: (i: number) => ReactNode;
}) {
  const H = 222;
  const T = 24;
  const B = 182;
  const Z = (T + B) / 2;
  // 위·아래 같은 눈금. 범위 = 가장 큰 값 + 5% (눈금이 한참 위로 가 막대가 납작해지지 않게), 눈금은 그 안의 것만
  const max = Math.max(1, ...weeks.flatMap((w) => [w.income, w.spending]));
  const top = max * 1.05;
  const ticks = niceTicks(0, max, 2).filter((v) => v <= top);
  const dy = (v: number) => (v / top) * (Z - T - 1);
  const slot = (FR - FL) / Math.max(1, weeks.length);
  const bw = Math.min(24, slot * 0.6);
  const cx = (i: number) => FL + slot * (i + 0.5);
  const every = Math.ceil(52 / slot); // 글자 폭 ~48이 안 겹치게, 이번 주(끝)부터 거꾸로

  const { at, handlers } = useScrub(weeks.length, (e) => {
    const x = viewX(e, FW);
    return x === null ? null : Math.max(0, Math.min(weeks.length - 1, Math.floor((x - FL) / slot)));
  });
  const last = weeks.at(-1);

  return (
    <div className="ec-plot" role="group" aria-label={label} {...handlers}>
      <svg viewBox={`0 0 ${FW} ${H}`} className="ec-svg" aria-hidden="true">
        {at !== null && <rect className="ec-colhi" x={cx(at) - slot / 2} width={slot} y={T - 8} height={B - T + 16} />}
        {ticks.slice(1).flatMap((v) => [
          <line key={`u${v}`} className="ec-gridline" x1={FL} x2={FR} y1={Z - 1 - dy(v)} y2={Z - 1 - dy(v)} />,
          <line key={`d${v}`} className="ec-gridline" x1={FL} x2={FR} y1={Z + 1 + dy(v)} y2={Z + 1 + dy(v)} />,
          <text key={`tu${v}`} className="ec-ax" x={FL - 8} y={Z - 1 - dy(v) + 4} textAnchor="end">
            {fmt(v)}
          </text>,
          <text key={`td${v}`} className="ec-ax" x={FL - 8} y={Z + 1 + dy(v) + 4} textAnchor="end">
            {fmt(v)}
          </text>,
        ])}
        <text className="ec-ax" x={FL - 8} y={Z + 4} textAnchor="end">
          0
        </text>
        {weeks.map((w, i) => (
          <g key={w.label} data-week={i}>
            {w.income > 0 && <path className="ec-inc" d={barPath(cx(i) - bw / 2, bw, Z - 1, Z - 1 - dy(w.income))} />}
            {w.spending > 0 && (
              <path className="ec-exp" d={barPath(cx(i) - bw / 2, bw, Z + 1, Z + 1 + dy(w.spending))} />
            )}
            {(weeks.length - 1 - i) % every === 0 && (
              <text className="ec-ax" x={cx(i)} y={H - 10} textAnchor="middle">
                {w.label}
              </text>
            )}
          </g>
        ))}
        <line className="ec-zero" x1={FL} x2={FR} y1={Z} y2={Z} />
        {last && (
          <>
            <text
              className="ec-end ec-end--sm"
              x={cx(weeks.length - 1)}
              y={Z - 1 - dy(last.income) - 6}
              textAnchor="middle"
            >
              +{fmt(last.income)}
            </text>
            <text
              className="ec-end ec-end--sm"
              x={cx(weeks.length - 1)}
              y={Z + 1 + dy(last.spending) + 16}
              textAnchor="middle"
            >
              −{fmt(last.spending)}
            </text>
          </>
        )}
      </svg>
      <Tip x={at !== null ? cx(at) : null} w={FW}>
        {at !== null && tip(at)}
      </Tip>
    </div>
  );
}

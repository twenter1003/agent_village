// 날씨 겹 (M19, 06 문서 10장, D28): 바다 물빛 위 화면 고정 겹 — 카메라 줌·이동을 따르지 않는다. 바닥처럼 코드로 (03 문서 3.5).
// 폭풍 = 어둠 + 탁함 + 해류 줄무늬 + 소용돌이 거품, 흐림 = 탁한 물빛, 무지개 = 무지갯빛 물결 무늬(코스틱),
// 맑음 = 수면에서 내려오는 빛줄기, 잔잔 = 없음. 움직이는 겹은 바깥 <svg> 하나씩이고 CSS transform·opacity만 움직인다
// (합성기에서 돌아 마을을 다시 그리지 않는다). still(동작 줄이기·거품 끔)이면 물빛만.
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { WeatherKind } from '@tycoon/core';
import './weather.css';

export interface WeatherProps {
  kind: WeatherKind;
  /** 움직이는 효과 끔 (동작 줄이기·거품 효과 끔, 06 문서 10장) */
  still?: boolean;
}

/** 한 주기 = 1440 (무늬 띠는 2주기 너비, 왼쪽으로 반 너비 흐르면 이음새 없이 되풀이) */
const P = 1440;
const H = 900;
const NSS = { vectorEffect: 'non-scaling-stroke' } as const;

/** 해류 줄 [x, y, 길이, 굵기, 불투명도] — 한 주기 안 */
const STREAKS = [
  [60, 120, 260, 4, 0.5],
  [420, 210, 340, 3, 0.4],
  [900, 90, 220, 5, 0.55],
  [1180, 300, 300, 3, 0.4],
  [200, 420, 380, 4, 0.45],
  [760, 520, 260, 3, 0.35],
  [1100, 640, 340, 4, 0.5],
  [340, 760, 300, 3, 0.4],
] as const;
/** 소용돌이 [left %, top %, 너비 %, 시작 시간 차 s (음수 = 돌던 중부터)] */
const SWIRLS = [
  [14, 58, 10, 0],
  [62, 22, 8, -1.1],
  [80, 68, 11, -2.3],
] as const;
/** 반원 호를 넓혀 가며 이은 소용돌이 (가운데 → 바깥 36) */
const SPIRAL = 'M0 0A6 6 0 0 1 12 0A12 12 0 0 1 -12 0A18 18 0 0 1 24 0A24 24 0 0 1 -24 0A30 30 0 0 1 36 0';
/** 소용돌이 끝의 거품 두 알 [cx, cy, r] (WaterFx 거품 모양: 채움 60% + --ink 1.6 테 + 흰 반사점) */
const FOAM = [
  [36, 4, 6],
  [-25, 10, 4],
] as const;
/** 물결 [y, 진폭] — 색은 --caustic-1~5 */
const WAVES = [
  [110, 18],
  [280, 22],
  [450, 16],
  [620, 24],
  [790, 18],
] as const;
const L = 360; // 물결 파장 (주기 1440의 약수)
/** 사인 비슷한 물결: x0부터 띠 끝(2P)까지 반 파장씩 이어 간다 */
const wave = (y: number, a: number, x0: number) =>
  `M${x0} ${y}q${L / 4} ${-a} ${L / 2} 0` + `t${L / 2} 0`.repeat(Math.ceil((2 * P - x0) / (L / 2)));
/** 빛줄기 두 겹 (기본 빛줄기 LightRays와 다른 자리) */
const RAYS = [
  ['M300 -10L390 -10L250 910L140 910Z', 'M760 -10L820 -10L700 910L620 910Z', 'M1080 -10L1170 -10L1040 910L930 910Z'],
  ['M40 -10L100 -10L10 910L-60 910Z', 'M520 -10L560 -10L470 910L420 910Z', 'M1320 -10L1380 -10L1290 910L1220 910Z'],
];

/** 띠 = 너비 200%, 2주기. 왼쪽으로 반 너비 흐른다 */
const Band = ({ className, children }: { className: string; children: ReactNode }) => (
  <svg className={`wx__band ${className}`} viewBox={`0 0 ${2 * P} ${H}`} preserveAspectRatio="none">
    {children}
    <g transform={`translate(${P} 0)`}>{children}</g>
  </svg>
);

function Storm() {
  const streaks = (shift: number) =>
    STREAKS.map(([x, y, len, w, op], i) => (
      <path
        key={i}
        d={`M${(x + shift) % P} ${y + (shift ? 50 : 0)}l${len} ${-len * 0.12}`}
        style={{ stroke: 'var(--sheen)', ...NSS }}
        strokeWidth={w}
        strokeOpacity={op}
        strokeLinecap="round"
      />
    ));
  return (
    <>
      <Band className="wx__move wx__current wx__current--far">{streaks(720)}</Band>
      <Band className="wx__move wx__current">{streaks(0)}</Band>
      {SWIRLS.map(([left, top, width, delay], i) => (
        <svg
          key={i}
          className="wx__move wx__swirl"
          viewBox="-50 -50 100 100"
          style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, animationDelay: `${delay}s` }}
        >
          <path
            d={SPIRAL}
            fill="none"
            style={{ stroke: 'var(--bubble)' }}
            strokeWidth={5}
            strokeOpacity={0.75}
            strokeLinecap="round"
          />
          {FOAM.map(([cx, cy, r], j) => (
            <g key={j}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fillOpacity={0.6}
                strokeWidth={1.6}
                style={{ fill: 'var(--bubble)', stroke: 'var(--ink)', ...NSS }}
              />
              <circle cx={cx - r * 0.35} cy={cy - r * 0.35} r={r * 0.3} style={{ fill: 'var(--sheen)' }} />
            </g>
          ))}
        </svg>
      ))}
    </>
  );
}

function Caustics() {
  const lines = (flip: boolean) =>
    WAVES.map(([y, a], i) => (
      <path
        key={i}
        d={flip ? wave(y + 40, -a, 0) : wave(y, a, 0)}
        fill="none"
        style={{ stroke: `var(--caustic-${flip ? 5 - i : i + 1})`, ...NSS }}
        strokeWidth={6}
        strokeOpacity={0.55}
        strokeLinecap="round"
      />
    ));
  return (
    <>
      <Band className="wx__move wx__caustic">{lines(false)}</Band>
      <Band className="wx__move wx__caustic wx__caustic--cross">{lines(true)}</Band>
    </>
  );
}

const Rays = () =>
  RAYS.map((rays, i) => (
    <svg
      key={i}
      className={`wx__move wx__rays${i ? ' wx__rays--late' : ''}`}
      viewBox={`0 0 ${P} ${H}`}
      preserveAspectRatio="none"
    >
      {rays.map((d) => (
        <path key={d} d={d} style={{ fill: 'var(--light-ray)' }} />
      ))}
    </svg>
  ));

/** 날씨 겹 한 장. 담는 칸(position 있는 상자)을 꽉 채우고 누르기를 막지 않는다 */
export function Weather({ kind, still = false }: WeatherProps) {
  if (kind === 'calm') return null;
  return (
    <div className="wx" data-weather={kind} aria-hidden="true">
      {(kind === 'storm' || kind === 'cloudy') && <div className="wx__murk" />}
      {kind === 'storm' && <div className="wx__dark" />}
      {!still && kind === 'storm' && <Storm />}
      {!still && kind === 'rainbow' && <Caustics />}
      {!still && kind === 'sunny' && <Rays />}
    </div>
  );
}

/**
 * 카메라 칸에 붙이는 날씨 (화면 고정). anchor = 카메라 안 마을 루트 (Camera 루트 > 변환 div > 마을).
 * 변환 div 바로 뒤에 끼워 앞 빛줄기·확대 버튼 아래에 둔다 — 버튼은 어두워지지 않는다.
 * ponytail: Camera DOM 구조에 기댄다. Camera가 겹 슬롯(prop)을 받게 되면 포털 대신 그리로
 */
export function CameraWeather({ anchor, ...props }: WeatherProps & { anchor: RefObject<HTMLElement | null> }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  // useEffect: 부모(마을 루트)의 ref는 자식 layout effect 뒤에 붙는다
  useEffect(() => {
    const frame = anchor.current?.parentElement;
    const cam = frame?.parentElement;
    if (!frame || !cam) return;
    const el = document.createElement('div');
    cam.insertBefore(el, frame.nextSibling);
    setHost(el);
    return () => el.remove();
  }, [anchor]);
  return host && createPortal(<Weather {...props} />, host);
}

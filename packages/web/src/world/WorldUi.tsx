// 월드 UI (03 문서 5장 · 캔버스 바다 09 labels): 말풍선, 머리 위 상태, 현장 진행 점, 일터 게이지·층 배지, 외부인 이름표. 월드 좌표 HTML.
import type { CSSProperties } from 'react';
import { t } from '../i18n';

const box: CSSProperties = {
  position: 'absolute',
  background: 'var(--paper)',
  border: '2.5px solid var(--ink)',
  borderRadius: 14,
  whiteSpace: 'nowrap',
};

/** 말풍선 꼬리: 위 가장자리가 풍선 테두리를 덮는다 */
const Tail = ({ style }: { style: CSSProperties }) => (
  <svg width={20} height={14} viewBox="0 0 20 14" aria-hidden="true" style={style}>
    <path
      d="M2 0L10 12L16 0"
      style={{ fill: 'var(--paper)', stroke: 'var(--ink)' }}
      strokeWidth={2.5}
      strokeLinejoin="round"
    />
    <rect x={0} y={-3} width={20} height={4} style={{ fill: 'var(--paper)' }} />
  </svg>
);

export function Speech({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <>
      <div style={{ ...box, left: x - 118, top: y - 82, padding: '6px 12px', fontSize: 13 }}>{text}</div>
      <Tail style={{ position: 'absolute', left: x - 38, top: y - 52 }} />
    </>
  );
}

/** 캐릭터 누르기 말풍선 (06 문서 8장): 머리 위 가운데, 꼬리 끝 = 발 위 68 (들어 올린 머리보다 위). 긴 작업 제목은 줄임표 */
export function Say({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div
      data-poke-say=""
      role="status"
      style={{
        position: 'absolute',
        left: x,
        top: y - 68,
        transform: 'translate(-50%, -100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          ...box,
          position: 'relative',
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          padding: '6px 12px',
          fontSize: 'var(--fs-sub)',
        }}
      >
        {text}
      </div>
      <Tail style={{ marginTop: -2.5 }} />
    </div>
  );
}

export function Typing({ x, y }: { x: number; y: number }) {
  return (
    <div
      role="status"
      aria-label={t('status.meeting')}
      style={{ ...box, left: x + 32, top: y - 84, display: 'flex', gap: 4, padding: '8px 10px' }}
    >
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-2)' }} />
      ))}
    </div>
  );
}

export function Sleep({ x, y }: { x: number; y: number }) {
  return (
    <div
      aria-label={t('status.resting')}
      style={{
        position: 'absolute',
        left: x + 18,
        top: y - 69,
        fontFamily: 'var(--font-display)',
        fontSize: 18,
        color: 'var(--text-2)',
      }}
    >
      z<span style={{ fontSize: 13, verticalAlign: 8 }}>z</span>
    </div>
  );
}

/** 머리 위 상태 (03 문서 5장, Cards.dc 월드 UI): 지름 32 원 + 상태 색 + 아이콘 + 아래 꼬리. 막힘 '!' */
export function Alert({ x, y }: { x: number; y: number }) {
  return (
    <svg
      role="img"
      aria-label={t('status.blocked')}
      width={38}
      height={44}
      viewBox="-19 -19 38 44"
      style={{ position: 'absolute', left: x - 19, top: y - 107, overflow: 'visible' }}
    >
      <circle r={16} style={{ fill: 'var(--st-blocked)', stroke: 'var(--ink)' }} strokeWidth={3} />
      <path d="M0 -9V2M0 8V8.5" fill="none" style={{ stroke: 'var(--text)' }} strokeWidth={3} strokeLinecap="round" />
      <path
        d="M-6 14L0 22L6 14"
        style={{ fill: 'var(--st-blocked)', stroke: 'var(--ink)' }}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 망치 원 (현장 진행 점·일터 게이지 앞) */
function Hammer({ x, y }: { x: number; y: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: x - 82,
        top: y - 74,
        width: 26,
        height: 26,
        boxSizing: 'border-box',
        border: '2.5px solid var(--ink)',
        borderRadius: '50%',
        background: 'var(--coin)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24">
        <path
          d="M5 19.5L13 11.5M10.5 6.5L14.5 3.5L20.5 9.5L17.5 13.5Z"
          fill="none"
          style={{ stroke: 'var(--text)' }}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** 현장 진행 점: 완료 = --coin, 진행 중 = --slot3-tint, 남음 = --paper. 앞에 망치 아이콘 */
export function Progress({
  x,
  y,
  done,
  partial,
  total,
}: {
  x: number;
  y: number;
  done: number;
  partial: number;
  total: number;
}) {
  const dot = (bg: string, i: number) => (
    <span
      key={i}
      style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid var(--ink)', background: bg }}
    />
  );
  return (
    <>
      <Hammer x={x} y={y} />
      <div
        role="img"
        aria-label={t('world.site', { done, total })}
        style={{
          ...box,
          borderWidth: 2,
          borderRadius: 999,
          left: x - 49,
          top: y - 72,
          display: 'flex',
          gap: 3,
          padding: '4px 7px',
        }}
      >
        {Array.from({ length: total }, (_, i) =>
          dot(i < done ? 'var(--coin)' : i < done + partial ? 'var(--slot3-tint)' : 'var(--paper)', i),
        )}
      </div>
    </>
  );
}

/** 일터 게이지 (06 문서 5.2): 망치 원 + 알약 막대. 채움 --coin = 일 점수 ÷ 다음 층 점수. y = 막대 위 + 70 (진행 점과 같은 기준), dim = 떠난 주인 */
export function Gauge({ x, y, pct, label, dim }: { x: number; y: number; pct: number; label: string; dim?: number }) {
  return (
    <div style={{ opacity: dim }}>
      <Hammer x={x} y={y} />
      <div
        role="img"
        aria-label={label}
        data-gauge=""
        style={{
          ...box,
          borderWidth: 2,
          borderRadius: 999,
          left: x - 49,
          top: y - 70,
          width: 72,
          height: 14,
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--coin)' }} />
      </div>
    </div>
  );
}

export function VisitorTag({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <span
      style={{
        position: 'absolute',
        left: x - 22,
        top: y + 7,
        padding: '1px 7px',
        background: 'var(--slotx-tint)',
        border: '2px dashed var(--ink)',
        borderRadius: 999,
        fontSize: 11,
      }}
    >
      {text}
    </span>
  );
}

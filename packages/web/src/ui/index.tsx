// UI 키트 (03 문서 5장 UI 컴포넌트 명세). 모양은 ui.css, 색은 토큰만 — 테마 분기 없음 (05 문서 7장).
// 아이콘은 ReactNode로 받는다. 상태 = 색 + 아이콘 (M10 접근성), 누르는 것은 진짜 <button>.
import './ui.css';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { AXES, type MemberStatus, type Personality } from '@tycoon/core';
import type { Slot } from '../assets/sea/Asset';
import { t } from '../i18n';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

// ponytail: 닫기·체크 두 개만 여기 직접 그림 (Type.dc.html 경로). icons 모듈이 자리 잡으면 그걸로 교체.
const stroke = (d: string, size: number, width: number) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

export type ButtonProps = ComponentProps<'button'> & {
  /** 주(화면당 하나) · 보조(기본) · 조용한 · 위험 */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  /** L 44 / M 36. 조용한 버튼은 항상 36 */
  size?: 'l' | 'm';
};

export function Button({ variant = 'secondary', size = 'l', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, className)} {...rest} />;
}

export type IconButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  /** 아이콘만 있는 버튼이라 필수 (뱃지가 있으면 "알림 3개"처럼 숫자까지) */
  'aria-label': string;
  /** 22px 아이콘 */
  icon: ReactNode;
  /** 오른쪽 위 숫자 뱃지. 0이면 안 보임 */
  badge?: number;
};

export function IconButton({ icon, badge, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx('ui-btn ui-btn--secondary ui-iconbtn', className)} {...rest}>
      {icon}
      {badge !== undefined && <Badge count={badge} />}
    </button>
  );
}

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** 전환 토글 (마을/격자). role=group + aria-pressed */
export function Toggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="ui-toggle">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className="ui-toggle__opt"
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type ChipProps = ComponentProps<'span'> & {
  /** 작은 칩 20 (팀원 패널) */
  sm?: boolean;
};

export function Chip({ sm, className, ...rest }: ChipProps) {
  return <span className={cx('ui-chip', sm && 'ui-chip--sm', className)} {...rest} />;
}

/** 상태 칩: 왼쪽 20 원(상태 색 + 12px 아이콘). 글자 기본값은 이름 사전의 상태 이름 */
export function StatusChip({
  status,
  icon,
  children,
}: {
  status: MemberStatus;
  icon: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Chip className="ui-chip--status">
      <span className="ui-chip__dot" style={{ background: `var(--st-${status})` }}>
        {icon}
      </span>
      {children ?? t(`status.${status}`)}
    </Chip>
  );
}

/** 직업 칩: 슬롯 tint 바탕 + deep 글자. 외부인(x)은 점선 */
export function JobChip({ slot, sm, children }: { slot: Slot; sm?: boolean; children: ReactNode }) {
  return (
    <Chip
      sm={sm}
      className={cx('ui-chip--job', slot === 'x' && 'ui-chip--dashed')}
      style={{ background: `var(--slot${slot}-tint)`, color: `var(--slot${slot}-deep)` }}
    >
      {children}
    </Chip>
  );
}

/** 바뀌는 중인 축 한 줄 "T가 F 쪽으로 38%" (01 문서 7장). 글자 이름 중 N(엔)만 받침이 있어 '이' */
export function driftText(letters: string, d: NonNullable<Personality['drifting']>) {
  const from = letters[AXES.indexOf(d.axis)] ?? '';
  return t('personality.drift', { from, ga: from === 'N' ? '이' : '가', to: d.toward, pct: Math.round(d.percent) });
}

/** MBTI 칩 (03 문서 5장): 바뀌는 중인 축(Personality.drifting)의 글자만 라벤더. 이름 "성격 ISTJ, T가 F 쪽으로 38%" */
export function MbtiChip({
  letters,
  drifting,
  sm,
}: {
  letters: string;
  drifting?: Personality['drifting'];
  sm?: boolean;
}) {
  const at = drifting ? AXES.indexOf(drifting.axis) : -1;
  const drift = drifting ? driftText(letters, drifting) : undefined;
  return (
    <Chip
      sm={sm}
      className="ui-chip--mbti"
      role="img"
      aria-label={drift ? t('personality.chipDrift', { letters, drift }) : t('personality.chip', { letters })}
      title={drift}
    >
      {[...letters].map((c, i) => (
        <span key={i} className={i === at ? 'ui-mbti-drift' : undefined}>
          {c}
        </span>
      ))}
    </Chip>
  );
}

export type FilterChipProps = Omit<ComponentProps<'button'>, 'aria-pressed'> & { selected: boolean };

/** 필터 칩 (높이 32): 선택 = --coin 바탕 + 체크 */
export function FilterChip({ selected, className, children, type = 'button', ...rest }: FilterChipProps) {
  return (
    <button type={type} aria-pressed={selected} className={cx('ui-chip ui-chip--filter', className)} {...rest}>
      {selected && stroke('M5 12.5L9.5 17L19 7.5', 14, 3)}
      {children}
    </button>
  );
}

/** 숫자 뱃지. 100 이상은 99+, 0 이하는 안 그림 */
export function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="ui-badge">{count > 99 ? '99+' : count}</span>;
}

export type CardProps = ComponentProps<'div'> & { selected?: boolean };

/** 카드. 링크·버튼 카드가 필요하면 그 요소에 className="ui-card"를 직접 붙인다 */
export function Card({ selected, className, ...rest }: CardProps) {
  return <div className={cx('ui-card', selected && 'ui-card--selected', className)} {...rest} />;
}

export interface ToastProps {
  /** 44 타일 안 아이콘 */
  icon: ReactNode;
  /** 타일 바탕. 기본 --slot3-tint (완공·급여) */
  tint?: string;
  title: ReactNode;
  desc?: ReactNode;
  /** 제목 아래 버튼 줄 ("광장 보기") */
  action?: ReactNode;
  /** 막힘·실패: role=alert + --danger 테두리. 아니면 역할 없음 — 늘 있는 스택이 role=status (01 문서 9장) */
  alert?: boolean;
  /** ms. 있으면 아래 4px 막대가 줄고 끝나면 onDone. 없으면 직접 닫을 때까지 (01 문서 9장) */
  duration?: number;
  /** 사라질 때 (시간이 다 됨 또는 닫기) */
  onDone: () => void;
}

// ponytail: 마우스를 올려도 멈추지 않음. 같은 내용이 활동 기록에 남아서(01 문서 9장). 불편하면 hover 일시정지 추가.
export function Toast({ icon, tint = 'var(--slot3-tint)', title, desc, action, alert, duration, onDone }: ToastProps) {
  // 부모가 매 스냅샷마다 새 onDone을 줘도 타이머가 다시 시작되지 않게
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!duration) return;
    const id = setTimeout(() => done.current(), duration);
    return () => clearTimeout(id);
  }, [duration]);

  return (
    <div role={alert ? 'alert' : undefined} className={cx('ui-toast', alert && 'ui-toast--alert')}>
      <div className="ui-toast__tile" style={{ background: tint }}>
        {icon}
      </div>
      <div className="ui-toast__body">
        <span className="ui-toast__title">{title}</span>
        {desc && <span className="ui-toast__desc">{desc}</span>}
        {action && <div className="ui-toast__action">{action}</div>}
      </div>
      <button type="button" aria-label={t('ui.close')} className="ui-toast__close" onClick={onDone}>
        {stroke('M6 6L18 18M18 6L6 18', 18, 2)}
      </button>
      {!!duration && <span className="ui-toast__bar" style={{ animationDuration: `${duration}ms` }} />}
    </div>
  );
}

/** 다음 레벨 진행 (상단 바): 높이 16 알약, 채움 --coin + 오른쪽 끝 선. 폭 기본 180 */
export function VillageProgress({
  done,
  total,
  label,
  className,
}: {
  done: number;
  total: number;
  label: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0; // 내림: 다 차기 전엔 100% 아님
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cx('ui-vprog', className)}
    >
      <div className="ui-vprog__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

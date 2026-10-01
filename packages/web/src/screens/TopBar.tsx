// 상단 바 (01 문서 8.1, 캔버스 SeaTopBar). 높이 68, 아래 테두리 3 (03 문서 6장)
import { useEffect, useId, useRef, useState } from 'react';
import { initialState, levelOf, makeConfig, type GameConfig, type Toast, type VillageState } from '@tycoon/core';
import { Icon } from '../icons/Icon';
import { IconButton, VillageProgress } from '../ui';
import type { ProjectInfo } from '../live/api';
import { noticeText, usePrefs } from '../live/prefs';
import { t } from '../i18n';
import './screens.css';

const fmt = (n: number) => n.toLocaleString('ko-KR');
/** 마을 이름 = cwd 마지막 폴더 */
const projectName = (p: ProjectInfo) => p.cwd.split(/[\\/]/).filter(Boolean).pop() ?? p.id;

const DEFAULT_CFG = makeConfig();
const EMPTY = initialState('');

export interface TopBarProps {
  state: VillageState | null;
  projects: ProjectInfo[];
  currentProjectId: string | null;
  onProjectChange: (id: string) => void;
  /** 알림 뱃지 (아직 닫지 않은 토스트 수) */
  unread: number;
  /** 알림 목록을 열면 = 모두 읽음 (01 문서 8.1 화면 메모 M9) */
  onReadAll?: () => void;
  /** 금고·마을 기금 칩 → 경제 패널 (01 문서 8.1, D21) */
  onEconomy?: () => void;
  /** 설정 버튼 → 설정 화면 (01 문서 10장). 없으면 비활성 */
  onSettings?: () => void;
  /** 마을 레벨 표 (06 문서 6.1). 없으면 기본 설정 */
  cfg?: GameConfig;
}

/** 알림 목록에 보이는 최근 알림 수 */
export const RECENT_NOTIFICATIONS = 20;
const clock = (at: number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

/** 알림 버튼 + 아래 목록 칸 (01 문서 8.1 화면 메모 M9). 열면 모두 읽음, Esc·바깥 누르기로 닫고 Esc면 포커스를 버튼으로 */
function Notifications({ toasts, unread, onReadAll }: { toasts: Toast[]; unread: number; onReadAll?: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { speech } = usePrefs(); // 회의 안건 글자 (01 문서 10장)
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    addEventListener('pointerdown', down);
    addEventListener('keydown', key);
    return () => {
      removeEventListener('pointerdown', down);
      removeEventListener('keydown', key);
    };
  }, [open]);
  const recent = toasts.slice(-RECENT_NOTIFICATIONS).reverse();
  return (
    <div
      className="tb__notif"
      ref={wrap}
      // Tab으로 밖에 나가면 닫는다 — 열린 채 두면 Esc가 다른 화면(이름 바꾸기 취소)에서도 가로챘다
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <IconButton
        ref={button}
        className="tb__iconbtn"
        aria-label={t('topbar.notifications', { n: unread })}
        aria-expanded={open}
        aria-controls={id}
        icon={<Icon name="bell" size={22} />}
        badge={unread}
        onClick={() => {
          if (!open) onReadAll?.();
          setOpen(!open);
        }}
      />
      {open && (
        // 넘치면 스크롤되는 칸이라 키보드로도 들어갈 수 있게 (활동 기록 .af__list와 같음)
        <section id={id} className="tb__notif-box ui-card" aria-label={t('notifications.title')} tabIndex={0}>
          <h2 className="tb__notif-title">{t('notifications.title')}</h2>
          {recent.length ? (
            <ul className="tb__notif-list">
              {recent.map((x) => (
                <li key={x.id} data-kind={x.kind}>
                  <span className="tb__notif-text">{noticeText(x, speech)}</span>
                  <time className="tb__notif-at" dateTime={new Date(x.at).toISOString()}>
                    {clock(x.at)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tb__notif-empty">{t('notifications.empty')}</p>
          )}
        </section>
      )}
    </div>
  );
}

export function TopBar({
  state,
  projects,
  currentProjectId,
  onProjectChange,
  unread,
  onReadAll,
  onEconomy,
  onSettings,
  cfg = DEFAULT_CFG,
}: TopBarProps) {
  // 마을 레벨 칸 (06 문서 13장·6.4): 막대 = 이 레벨 안에서 다음 레벨까지 일 점수,
  // 보조 글자 = 일·기금 / 다음 레벨 조건. 기금 조건 = 공사비 + 그날 팀장 토큰값 (core levelUp과 같은 조건)
  const lv = levelOf(state ?? EMPTY, cfg);
  const vars = lv.next && {
    n: lv.level + 1,
    name: t(`eras.${lv.next.era}`),
    points: fmt(Math.floor(lv.points)),
    need: fmt(lv.next.points),
    fund: fmt(Math.floor(lv.fund)),
    cost: fmt(Math.ceil(lv.next.cost + lv.bill)),
    base: fmt(lv.next.cost),
    bill: fmt(Math.ceil(lv.bill)),
  };
  const chip = t('level.chip', { n: lv.level, name: t(`eras.${lv.era}`) });
  const sub = vars ? t('level.sub', vars) : t('level.max');
  const span = lv.next ? lv.next.points - lv.cur.points : 1;
  const done = lv.next ? Math.max(0, lv.points - lv.cur.points) : 1;
  // 팀 금고 = 팀원 잔고 합계 (01 문서 6.5)
  const vault = state ? Object.values(state.members).reduce((sum, m) => sum + m.balance, 0) : 0;
  const deficit = !!state?.economy.deficit;
  const known = projects.some((x) => x.id === currentProjectId);
  return (
    <header className="tb">
      <a href="/" className="tb__logo" aria-label={`${t('ui.appName')} · ${t('topbar.home')}`}>
        <span className="tb__mark">
          <Icon name="home" strokeWidth={2.2} />
        </span>
        <span className="tb__name">
          {t('ui.appName')} <span className="tb__town">{t('town')}</span>
        </span>
      </a>
      <label className="tb__pick">
        <select
          aria-label={t('topbar.project')}
          value={currentProjectId ?? ''}
          onChange={(e) => onProjectChange(e.target.value)}
        >
          {!currentProjectId && (
            <option value="" disabled>
              {t('topbar.project')}
            </option>
          )}
          {currentProjectId && !known && <option value={currentProjectId}>{currentProjectId}</option>}
          {projects.map((x) => (
            <option key={x.id} value={x.id} title={x.cwd}>
              {projectName(x)}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={16} />
      </label>
      <span className="tb__grow" />
      <button
        type="button"
        className="tb__prog tb__level"
        // 이름은 글자 그대로 (안의 진행 막대 값이 이름에 섞이지 않게). 좁으면 보조 글자가 줄임표 — title엔 전부
        aria-label={`${chip} · ${sub}`}
        title={`${vars ? t('level.next', vars) : t('level.max')} · ${t('topbar.economy')}`}
        onClick={onEconomy}
      >
        <span className="tb__prog-title">{chip}</span>
        <VillageProgress done={done} total={span} label={t('level.progress')} />
        <span className="tb__sub">{sub}</span>
      </button>
      {/* 금고·마을 기금 → 경제 패널 (캔버스 SeaTopBar: 둘 다 링크, --lift-press). 기금 = 팀장 지갑 (D21) */}
      <button type="button" className="tb__chip tb__chip--vault" title={t('topbar.economy')} onClick={onEconomy}>
        <Icon name="coin" size={22} />
        {t('vault')} <span className="tb__num">{fmt(vault)}</span>
      </button>
      <button
        type="button"
        className={`tb__chip tb__chip--fund${deficit ? ' tb__chip--deficit' : ''}`}
        title={
          deficit
            ? `${t('economy.deficit')} · ${t('economy.deficitHint')}`
            : `${t('economy.fundHint')} · ${t('topbar.economy')}`
        }
        onClick={onEconomy}
      >
        {deficit ? <Icon name="blocked" size={22} title={t('economy.deficit')} /> : <Icon name="coin" size={22} />}
        {t('economy.fund')} <span className="tb__num">{fmt(state?.economy.fund ?? 0)}</span>
      </button>
      <Notifications toasts={state?.toasts ?? []} unread={unread} onReadAll={onReadAll} />
      {/* 마을이 없으면(설정할 곳 없음) aria-disabled + 비활성 색. 포커스는 남는다 */}
      <IconButton
        className="tb__iconbtn"
        aria-label={t('topbar.settings')}
        aria-disabled={onSettings ? undefined : 'true'}
        icon={<Icon name="settings" size={22} />}
        onClick={onSettings}
      />
    </header>
  );
}

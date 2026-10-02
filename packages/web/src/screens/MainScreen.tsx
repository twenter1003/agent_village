// 메인 화면 조립 (01 문서 8.2, 03 문서 6장, 캔버스 SeaScreenMain): 상단 바 68 / 마을 1080×642 + 활동 기록 1080×190 / 팀원 패널 360×832.
// 마을은 밖에서 넣는다 (live/). 1440×900이 아니면 마을 칸만 늘고 준다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GameConfig, VillageState } from '@tycoon/core';
import { t } from '../i18n';
import { Icon } from '../icons/Icon';
import type { ProjectInfo } from '../live/api';
import type { MemberView } from '../live/movement';
import { StatusChip, Toggle } from '../ui';
import { ActivityFeed } from './ActivityFeed';
import { TeamPanel } from './TeamPanel';
import { pendingToasts, toastKey, ToastStack } from './ToastStack';
import { TopBar } from './TopBar';
import './screens.css';

export interface MainScreenProps {
  /** 아직 스냅샷이 없으면 null (상단 바만) */
  state: VillageState | null;
  projects: ProjectInfo[];
  currentProjectId: string | null;
  onProjectChange: (id: string) => void;
  /** 마을 뷰 (카메라·캐릭터). 1080×642 칸을 채운다 */
  village: ReactNode;
  /** 강조할 팀원 카드 (캐릭터를 누르면 밖에서 바꾼다) */
  selectedId?: string | null;
  /** 팀원 카드를 누르면 (강조 + 그 팀원 집, 01 문서 8.2) */
  onSelect?: (memberId: string) => void;
  /** 상단 바 금고·마을 기금 칩 → 경제 패널 (01 문서 8.1). 없으면 칩을 누를 수 없다 */
  onEconomy?: () => void;
  /** 팀원 카드 상태·곳 (마을과 같은 시계, live/movement memberViews) */
  views?: ReadonlyMap<string, MemberView>;
  /** 수집기 설정 (SSE config) — 팀원 카드의 일터 이름 */
  cfg?: GameConfig;
  /** 상세 (건물 M6, 집·상점·경제 M7). 있으면 상단 바 아래를 덮는다. 마을은 지우지 않고 가린다 → 돌아오면 카메라·걷던 자리 그대로 */
  detail?: ReactNode;
  /** 지금 상세가 무엇인지 (집 → 상점처럼 상세끼리 옮기면 포커스를 새 상세로) */
  detailKey?: string;
  /** 마을/격자 보기 (01 문서 8.3). onModeChange가 있으면 마을 칸 왼쪽 위(16, 16)에 토글 하나 — 두 보기가 같은 토글을 써서 바꿔도 포커스가 남는다 */
  mode?: 'village' | 'grid';
  onModeChange?: (mode: 'village' | 'grid') => void;
  /** 격자 보기 내용 (mode가 grid일 때). 마을 칸 + 활동 기록 자리를 덮고, 위 80px은 토글 줄 몫으로 비워 둔다 */
  grid?: ReactNode;
  /** 상단 바 설정 버튼 → 설정 화면 (01 문서 10장) */
  onSettings?: () => void;
  /** 상단 바 신문 버튼 → 신문 달력 (06 문서 9장) */
  onNews?: () => void;
  /** 상단 바 "?" 버튼 → 설명서 (06 문서 11장) */
  onGuide?: () => void;
  /** 수집기 끊김 칩 (마을 칸 위 가운데). 마을·격자 어느 보기에서도 보이게 마을 밖에 둔다 */
  offline?: boolean;
}

export function MainScreen({
  state,
  projects,
  currentProjectId,
  onProjectChange,
  village,
  selectedId,
  onSelect,
  onEconomy,
  views,
  cfg,
  detail,
  detailKey,
  mode = 'village',
  onModeChange,
  grid,
  onSettings,
  onNews,
  onGuide,
  offline,
}: MainScreenProps) {
  // 상세를 열면 포커스를 상세로, 닫으면 처음 연 버튼으로 돌려준다 (가려진 버튼에 포커스가 남지 않게).
  // 상세끼리 옮기면(집 → 상점) 새 상세로 — 누른 버튼이 사라졌다
  const detailRef = useRef<HTMLDivElement>(null);
  const open = Boolean(detail);
  useEffect(() => {
    if (!open) return;
    const from = document.activeElement;
    return () => {
      // 포커스가 상세와 같이 사라졌을 때만 (상세를 연 채 상단 바 드롭다운으로 마을을 바꾸면 드롭다운에 남는다)
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && from instanceof HTMLElement) from.focus();
    };
  }, [open]);
  useEffect(() => {
    if (open) detailRef.current?.focus();
  }, [open, detailKey]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const toasts = state ? pendingToasts(state, dismissed, Date.now()) : [];
  const dismiss = (id: string) => {
    if (state) setDismissed((d) => new Set(d).add(toastKey(state, id)));
  };
  // 알림 목록을 열면 모두 읽음 = 떠 있는 토스트를 다 닫는다 (01 문서 8.1 화면 메모 M9)
  const readAll = () => {
    if (state) setDismissed((d) => new Set([...d, ...toasts.map((x) => toastKey(state, x.id))]));
  };
  const showGrid = mode === 'grid' && grid;
  return (
    <div className={`ms${detail ? ' ms--detail' : ''}${showGrid ? ' ms--grid' : ''}`}>
      <TopBar
        state={state}
        projects={projects}
        currentProjectId={currentProjectId}
        onProjectChange={onProjectChange}
        unread={toasts.length}
        onReadAll={readAll}
        onEconomy={onEconomy}
        onSettings={onSettings}
        onNews={onNews}
        onGuide={onGuide}
        cfg={cfg}
      />
      <main className="ms__village">{village}</main>
      <ActivityFeed feed={state?.feed ?? []} />
      {showGrid && <div className="ms__grid">{grid}</div>}
      {onModeChange && (
        <div className="ms__mode">
          <Toggle
            label={t('grid.view')}
            value={mode}
            onChange={onModeChange}
            options={[
              { value: 'village', label: t('grid.village'), icon: <Icon name="villageView" size={18} /> },
              { value: 'grid', label: t('grid.grid'), icon: <Icon name="gridView" size={18} /> },
            ]}
          />
          {showGrid && <span className="ms__hint">{t('grid.hint')}</span>}
        </div>
      )}
      {offline && (
        <div className="ms__offline" role="status">
          <StatusChip status="blocked" icon={<Icon name="blocked" size={12} />}>
            {t('ui.offline')}
          </StatusChip>
        </div>
      )}
      {state ? (
        <TeamPanel state={state} selectedId={selectedId} onSelect={onSelect} views={views} cfg={cfg} />
      ) : (
        <div className="tp" />
      )}
      {detail && (
        <div className="ms__detail" ref={detailRef} tabIndex={-1}>
          {detail}
        </div>
      )}
      {/* 마을 칸 오른쪽 위. 마을 밖에 둬서 상세를 연 동안에도 보이고 읽힌다 (마을은 visibility로 가려짐) */}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

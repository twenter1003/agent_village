// 토스트 (01 문서 9장, 03 문서 5장, 캔버스 Cards·SeaScreenMain). 마을 오른쪽 위, 최대 3개, 새 것이 위
import type { Toast as ToastState, ToastKind, VillageState } from '@tycoon/core';
import { Icon, type IconName } from '../icons/Icon';
import { noticeText, usePrefs } from '../live/prefs';
import { Toast } from '../ui';
import './screens.css';

/** 자동으로 사라지는 토스트의 시간 (SeaUI 보드 "자동으로 사라짐 5초") */
export const AUTO_MS = 5000;
export const MAX_TOASTS = 3;

// 타일 색 + 아이콘 (캔버스 Cards 토스트 6종. 실패는 바다 보드 SeaUI 막힘 토스트 = --slot2-tint + --danger 테두리)
const KIND: Record<ToastKind, { icon: IconName; tint: string }> = {
  complete: { icon: 'complete', tint: 'var(--slot3-tint)' },
  salary: { icon: 'coin', tint: 'var(--slot3-tint)' },
  meeting: { icon: 'meeting', tint: 'var(--meeting-tint)' },
  personality: { icon: 'personality', tint: 'var(--slot5-tint)' },
  failure: { icon: 'blocked', tint: 'var(--slot2-tint)' },
  tokens: { icon: 'coin', tint: 'var(--slot2-tint)' }, // 비싼 실행·팀장 대화 크기 (01 문서 6.7)
};

/** 닫은 토스트 키. 토스트 id는 마을마다 toast1부터라 마을 id를 붙인다 */
export const toastKey = (s: VillageState, id: string) => `${s.project}/${id}`;

/**
 * 아직 보여 줄 토스트, 새 것이 앞. 직접 닫는 것(회의·실패)은 닫을 때까지,
 * 자동은 보는 사람 시계(now) 기준 AUTO_MS 안에 생긴 것만 — 페이지를 열 때 지난 토스트가 줄줄이 뜨지 않게.
 * (게임 시계 = 마지막 이벤트 시각이라, 완공이 마지막 이벤트면 새로고침마다 다시 떴다. 반짝임 completeFxOn과 같은 시계)
 * ponytail: 닫은 목록은 화면 상태라 새로 고치면 직접 닫는 토스트가 다시 뜬다. 서버 쪽 닫기는 나중에.
 */
export const pendingToasts = (s: VillageState, dismissed: ReadonlySet<string>, now: number) => {
  // 팀원마다 가장 새 실패 토스트 (다시 막히면 새 토스트가 뜨므로 옛것은 내린다)
  const lastFailure = new Map<string, string>();
  for (const x of s.toasts) if (x.kind === 'failure' && x.ref) lastFailure.set(x.ref, x.id);
  /** 직접 닫는 토스트도 그 상태가 끝나면 내린다: 회의가 끝났거나, 막힘이 풀렸거나 (01 문서 9장) */
  const live = (x: ToastState) =>
    x.kind === 'meeting'
      ? !!s.meeting && s.meeting.startedAt === x.at && now < s.meeting.until
      : x.kind === 'failure' && x.ref
        ? !!s.members[x.ref]?.blocked && lastFailure.get(x.ref) === x.id
        : true;
  return s.toasts
    .filter((x) => !dismissed.has(toastKey(s, x.id)) && (x.sticky ? live(x) : now - x.at < AUTO_MS))
    .reverse();
};

/** 새 것이 앞인 목록에서 위 3개만. 스택이 늘 있는 live region — 비어 있어도 둬야 첫 토스트가 읽힌다 (01 문서 9장) */
export function ToastStack({ toasts, onDismiss }: { toasts: ToastState[]; onDismiss: (id: string) => void }) {
  const { speech } = usePrefs(); // 회의 안건 글자 (01 문서 10장)
  return (
    <div className="ts" role="status">
      {toasts.slice(0, MAX_TOASTS).map((x) => {
        const [title, ...rest] = noticeText(x, speech).split(' · ');
        return (
          <Toast
            key={x.id}
            icon={<Icon name={KIND[x.kind].icon} />}
            tint={KIND[x.kind].tint}
            title={title}
            desc={rest.join(' · ') || undefined}
            alert={x.kind === 'failure'}
            duration={x.sticky ? undefined : AUTO_MS}
            onDone={() => onDismiss(x.id)}
          />
        );
      })}
    </div>
  );
}

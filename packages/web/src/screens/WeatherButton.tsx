// 상단 바 날씨 (M19, 06 문서 10장, D28): 아이콘 + 누르면 이유 ("실패 3번 · 막힘 1명")
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { weatherFrom, weatherOf, type GameConfig, type VillageState, type Weather } from '@tycoon/core';
import { Icon } from '../icons/Icon';
import { IconButton } from '../ui';
import { t } from '../i18n';

export interface WeatherButtonProps {
  state: VillageState | null;
  cfg: GameConfig;
}

/** 이유 한 줄: 폭풍·흐림·맑음은 실패·막힘, 무지개는 테스트 통과, 잔잔은 쉬는 중 */
export function weatherReason(w: Weather): string {
  if (w.kind === 'calm') return t('weather.idle');
  if (w.kind === 'rainbow') return t('weather.passed', { n: w.passed });
  const parts = [
    w.failures > 0 && t('weather.failures', { n: w.failures }),
    w.blocked > 0 && t('weather.blocked', { n: w.blocked }),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('weather.steady');
}

// ponytail: 열기/닫기는 TopBar Notifications와 같은 코드 (Esc·바깥 누르기·Tab으로 나감). 셋째가 생기면 훅으로 묶는다
export function WeatherButton({ state, cfg }: WeatherButtonProps) {
  const w = useMemo(() => (state ? weatherOf(state, cfg) : weatherFrom([], 0, false, cfg)), [state, cfg]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
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
  const name = t(`weather.${w.kind}`);
  return (
    <div
      className="tb__weather"
      ref={wrap}
      data-weather={w.kind}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <IconButton
        ref={button}
        className="tb__iconbtn"
        aria-label={name}
        aria-expanded={open}
        aria-controls={id}
        icon={<Icon name={w.kind} size={22} />}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <section id={id} className="tb__weather-box ui-card" aria-label={t('weather.title')}>
          <h2 className="tb__weather-title">
            <Icon name={w.kind} size={22} />
            {name}
          </h2>
          <p className="tb__weather-why">{weatherReason(w)}</p>
          {w.kind !== 'calm' && <p className="tb__weather-basis">{t('weather.basis', { runs: w.runs })}</p>}
        </section>
      )}
    </div>
  );
}

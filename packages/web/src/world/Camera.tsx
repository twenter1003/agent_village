// 카메라 (02 문서 7.5): 드래그 이동, 휠·버튼 확대/축소 min(0.6, 전체 보기)~1.6, 전체 보기. 줌은 선 보정하지 않는다.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Icon } from '../icons/Icon';
import { usePrefs } from '../live/prefs';
import { IconButton } from '../ui';
import { LightRays } from './WaterFx';

const MAX_ZOOM = 1.6;
const MIN_ZOOM = 0.6;
/** 전체 보기에서 잘라도 되는 월드 여백(px) — world()의 바깥 여백(옆 88, 아래 24) 안이라 섬은 안 잘린다.
 *  16칸 마을에선 예전 "꽉 차게 ×1.1"과 거의 같다 */
const FIT_TRIM = { x: 54, y: 24 };
/** 전체 보기 배율 (02 문서 7.5, 2026-10-01): 섬 전체가 늘 보인다 — 큰 섬이면 0.6보다 작아도 된다 */
export const fitZoom = (cw: number, ch: number, worldW: number, worldH: number) =>
  Math.min(MAX_ZOOM, cw / (worldW - 2 * FIT_TRIM.x), ch / (worldH - 2 * FIT_TRIM.y));
/** 손으로 줄이는 바닥 = min(0.6, 전체 보기 배율) — 큰 섬도 전체 보기까지는 줄일 수 있다 */
export const clampZoom = (z: number, fit: number) => Math.min(MAX_ZOOM, Math.max(Math.min(MIN_ZOOM, fit), z));
const DRAG_PX = 5;
/** 이보다 줄여 보면 건물 이름표(.lv-tag)를 숨기고 얼굴 간판만 둔다 (06 문서 7장). 12px 이름표가 9px 밑으로 작아지는 곳 */
export const TAG_MIN_ZOOM = 0.75;
/** 처음 맞춤 배율 (M20): 전체 보기, 다만 이름표가 숨는 배율보다 작아지면 그 배율로 가운데(광장)를 — 수도(80×80)에서
 *  전체 보기는 그림이 너무 작았다. 섬 전체는 "마을 전체 보기" 버튼 */
export const homeZoom = (all: number) => Math.max(all, TAG_MIN_ZOOM);

export function Camera({ worldW, worldH, children }: { worldW: number; worldH: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState({ z: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(0); // 이번 누르기에서 끈 거리(px). 끌었으면 버튼 click을 막는다
  const touched = useRef(false); // 사람이 끌거나 확대했나. 안 했으면 칸 크기가 바뀔 때 다시 맞춘다
  const floor = useRef(MIN_ZOOM); // 손으로 줄이는 바닥 (휠 처리기는 처음 함수를 계속 써서 ref로)

  /** 가운데 맞춤. z = 배율, 'home' = 처음 맞춤(homeZoom), 없으면 전체 보기 배율. 섬이 커지면(worldW·H가 바뀌면) 다시 불린다 */
  const fit = useCallback(
    (zoom?: number | 'home') => {
      const el = ref.current;
      if (!el) return;
      const all = fitZoom(el.clientWidth, el.clientHeight, worldW, worldH);
      floor.current = Math.min(MIN_ZOOM, all);
      const z = zoom === 'home' ? homeZoom(all) : (zoom ?? all);
      setCam({ z, tx: (el.clientWidth - worldW * z) / 2, ty: (el.clientHeight - worldH * z) / 2 });
    },
    [worldW, worldH],
  );
  // 처음 배율 = 설정 "확대 기본값" (01 문서 10장). 설정을 바꾸면 그 배율로 다시 맞춘다
  const { zoom } = usePrefs();
  const home = useCallback(() => {
    touched.current = false;
    fit(zoom === 'fit' ? 'home' : zoom);
  }, [fit, zoom]);
  useEffect(home, [home]);

  // 창 크기가 바뀌면 (QA 2026-09-30: 처음 맞춘 자리에 남아 마을이 한쪽으로 잘렸다) — 손대기 전이면 다시 맞추고,
  // 손댔으면 보던 곳이 가운데에 남게 늘어난 만큼의 절반을 옮긴다
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let size = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const next = { w: el.clientWidth, h: el.clientHeight };
      const dw = next.w - size.w;
      const dh = next.h - size.h;
      size = next;
      if (!dw && !dh) return;
      if (!touched.current) return home();
      setCam((c) => ({ ...c, tx: c.tx + dw / 2, ty: c.ty + dh / 2 }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [home]);

  const zoomAt = (factor: number, cx: number, cy: number) => {
    touched.current = true;
    setCam((c) => {
      const z = clampZoom(c.z * factor, floor.current);
      return { z, tx: cx - ((cx - c.tx) * z) / c.z, ty: cy - ((cy - c.ty) * z) / c.z };
    });
  };
  const center = () => [(ref.current?.clientWidth ?? 0) / 2, (ref.current?.clientHeight ?? 0) / 2] as const;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'linear-gradient(var(--water-bg-1), var(--water-bg-2) 55%, var(--water-bg-3))',
        cursor: drag.current ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      data-far={cam.z < TAG_MIN_ZOOM ? '' : undefined}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        moved.current = 0;
        // 캐릭터 누르기 칸(data-grab, 06 문서 8장): 마우스·펜으로 끌면 마을이 아니라 캐릭터를 옮긴다.
        // 터치는 0.3초 누르기 전까지 마을 끌기 — 캐릭터를 집으면 LiveVillage가 움직임을 여기로 안 보낸다
        if (e.pointerType !== 'touch' && (e.target as HTMLElement).closest('[data-grab]'))
          return void (drag.current = null);
        // 마을 건물·캐릭터 버튼 위에서도 끌 수 있게 (M6 건물 누르기 칸이 넓다). 버튼 위면 캡처하지 않는다 — 캡처하면 click이 버튼에 안 간다
        if (!(e.target as HTMLElement).closest('button')) e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // 버튼 위에서 시작한 끌기는 캡처가 없어 밖에서 뗀 pointerup을 못 받는다 → 뗀 채 움직이면 끝
        if (e.buttons === 0) return void (drag.current = null);
        moved.current += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
        touched.current = true;
        setCam((c) => ({ ...c, tx: c.tx + e.clientX - d.x, ty: c.ty + e.clientY - d.y }));
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => (drag.current = null)}
      onClickCapture={(e) => {
        if (e.detail > 0 && moved.current > DRAG_PX) e.stopPropagation(); // 끌기였으면 누르기가 아니다 (키보드는 detail 0)
      }}
    >
      <LightRays />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.z})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
      <LightRays front />
      {/* 캔버스 SeaScreenMain: 왼쪽 아래 세로 44px 버튼. 거품 효과 끄기는 설정 화면 (01 문서 10장) */}
      <div style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <IconButton
          aria-label={t('camera.zoomIn')}
          icon={<Icon name="zoomIn" size={22} />}
          onClick={() => zoomAt(1.15, ...center())}
        />
        <IconButton
          aria-label={t('camera.zoomOut')}
          icon={<Icon name="zoomOut" size={22} />}
          onClick={() => zoomAt(1 / 1.15, ...center())}
        />
        <IconButton
          aria-label={t('camera.fit')}
          icon={<Icon name="fitAll" size={22} />}
          onClick={() => {
            fit();
            touched.current = false;
          }}
        />
      </div>
    </div>
  );
}

// 해초·켈프·말미잘 흔들림 (03 문서 3.2 흔들림 구멍, 캔버스 SeaProp): 900ms마다 두 장면을 번갈아. 타이머 하나를 흔들리는 소품끼리 같이 쓴다.
// 운영체제 "움직임 줄이기"면 장면을 바꾸지 않는다 (01 문서 10장)
import { useSyncExternalStore } from 'react';
import { reducedMotion } from '../live/prefs';

export const SWAY_MS = 900;
let frame = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const subs = new Set<() => void>();

function subscribe(fn: () => void) {
  subs.add(fn);
  if (!timer && !reducedMotion())
    timer = setInterval(() => {
      frame ^= 1;
      subs.forEach((s) => s());
    }, SWAY_MS);
  return () => {
    subs.delete(fn);
    if (subs.size) return;
    clearInterval(timer);
    timer = undefined;
  };
}

/** 지금 흔들림 장면 0·1 */
export const useSwayFrame = () => useSyncExternalStore(subscribe, () => frame);

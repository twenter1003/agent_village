// 전역 150ms 타이머 하나로 모든 캐릭터를 움직인다 (02 문서 7.4). React 상태를 거치지 않는다.
import { rig } from './rig';

type Sub = (tick: number, prev: number) => void;
const subs = new Set<Sub>();
let tick = 0;
let timer: ReturnType<typeof setInterval> | undefined;

export function subscribe(fn: Sub) {
  subs.add(fn);
  timer ??= setInterval(() => {
    const prev = tick++;
    for (const s of subs) s(tick, prev);
  }, rig.frameMs);
  return () => {
    subs.delete(fn);
    if (subs.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
export const currentTick = () => tick;

// 공사 연출 (06 문서 5.4, 03 문서 3.1): 반짝임 창, 단계·층이 바뀔 때 거품. 순수 — now는 화면 쪽 시계
import type { Stage } from '../assets/sea/Building';

export const POP_MS = 1200; // 단계 바뀜 거품 수명
export const STAGES: Stage[] = ['planned', 'foundation', 'frame', 'done'];

/** 완공 반짝임(fx.complete)을 보일 때인가: 완공 뒤 ms 동안만. 한참 뒤에 열면 안 보인다 (03 문서 3.1 "3초 뒤 제거") */
export const completeFxOn = (completedAt: number | undefined, now: number, ms: number) =>
  completedAt !== undefined && now >= completedAt && now < completedAt + ms;

/** 단계가 앞으로 나아갔나 (처음 보는 건물·되돌아감은 아님) */
export const stageUp = (was: Stage | undefined, now: Stage) =>
  was !== undefined && STAGES.indexOf(now) > STAGES.indexOf(was);

/** 단계 바뀜 거품 5개 (WaterFx 거품 모양): k = 0~1, 현장 가운데 기준 좌표 */
export const popBubbles = (k: number) =>
  [0, 1, 2, 3, 4].map((j) => ({
    x: (j - 2) * 18 + Math.sin(k * 5 + j) * 3,
    y: -k * 60 - (j % 2) * 10,
    r: 2 + (j % 3) * 0.8 + k * 1.2,
    o: (1 - k) * 0.9,
  }));

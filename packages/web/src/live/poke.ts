// 캐릭터 누르기·끌어 옮기기 (06 문서 8장, D26). 화면 놀이 — 게임 상태·이벤트·수집기에 남지 않는다. 순수 함수.
import type { VillageState } from '@tycoon/core';
import { t } from '../i18n';
import type { PoseName } from '../render/rig';
import type { Pt } from './movement';
import type { Actor } from './sceneFromState';

export const POKE_MS = 1200; // 아둥바둥
export const TILT_MS = 300; // 동작 줄이기: 한 번 기울이기
export const DRAG_PX = 6; // 누른 채 이만큼 넘게 끌면 집어 든다
export const HOLD_MS = 300; // 터치는 이만큼 누른 뒤에야 (그전 움직임은 마을 끌기)

/** 누른 채 움직인 거리(px)·누른 시간(ms) → 기다림 | 집어 듦 | 마을 끌기 */
export function pressIntent(pointerType: string, dist: number, ms: number): 'wait' | 'grab' | 'pan' {
  if (pointerType !== 'touch') return dist > DRAG_PX ? 'grab' : 'wait';
  if (dist > DRAG_PX) return 'pan';
  return ms >= HOLD_MS ? 'grab' : 'wait';
}

/**
 * 누른 뒤 포즈. since = 누른 시각(없으면 안 누름), held = 들고 있음, calm = 동작 줄이기·거품 효과 끔.
 * calm이면 버둥 대신 flail 첫 프레임(기울임)을 잠깐, 들고 있어도 held 첫 프레임에 멈춘다. null = 원래 포즈
 */
export function pokePose(
  since: number | undefined,
  held: boolean,
  now: number,
  calm: boolean,
): { pose: PoseName; frame?: number } | null {
  if (held) return calm ? { pose: 'held', frame: 0 } : { pose: 'held' };
  if (since === undefined || now - since >= (calm ? TILT_MS : POKE_MS)) return null;
  return calm ? { pose: 'flail', frame: 0 } : { pose: 'flail' };
}

/** 머리 위 말풍선 = 지금 상태 */
export function pokeText(a: Actor, s: VillageState): string {
  if (a.visitor)
    return a.status === 'working'
      ? t('poke.helping')
      : t('poke.workingOn', { task: t(`facilities.${a.visitor.facility}`) });
  switch (a.status) {
    case 'working': {
      const task = s.tasks[a.taskId ?? '']?.subject;
      return task ? t('poke.workingOn', { task }) : t('poke.working');
    }
    case 'blocked': {
      const why = s.members[a.id]?.blocked;
      return why ? `${t('poke.blocked')} · ${t(`poke.why.${why}`)}` : t('poke.blocked');
    }
    case 'meeting':
      return t('poke.meeting');
    default:
      return t('poke.resting');
  }
}

/** 놓은 자리(타일 좌표) → 가장 가까운 걸을 수 있는 칸 가운데. blocked = 한 변 √n 격자 (sceneFromState) */
export function dropTile(blocked: Uint8Array, p: Pt): Pt {
  const M = Math.round(Math.sqrt(blocked.length));
  let best = { x: 0.5, y: 0.5 };
  let bd = Infinity;
  for (let y = 0; y < M; y++)
    for (let x = 0; x < M; x++) {
      if (blocked[y * M + x]) continue;
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
      if (d < bd) [bd, best] = [d, { x: x + 0.5, y: y + 0.5 }];
    }
  return best;
}

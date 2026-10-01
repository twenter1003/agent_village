// 테스트 전용: 골든(빈 섬에서 자라는 중, 01 문서 3.3)을 "다 자란 마을"로 — 시설 3채(인력 부두 → 해도실 → 탐사 기지, 광장에 가까운 순),
// 집은 슬롯 순, 모두 입주. 그리기·이동 테스트가 한 가지 배치를 보게 (M3~M9 기준 배치와 같다)
import { findLot, occupiedLots, type Facility, type VillageState } from '@tycoon/core';

export function fullVillage(s: VillageState): VillageState {
  s.foundedAt ??= 0;
  s.hall = null; // 시청·공공시설은 그 테스트가 직접 (M14) — M3~M9 기준 배치 그대로
  s.publicWorks = [];
  s.facilities = {};
  s.houses = {};
  for (const f of ['agency', 'plan', 'library'] as Facility[]) {
    const lot = findLot('north', occupiedLots(s));
    if (lot) s.facilities[f] = lot;
  }
  for (const m of Object.values(s.members).sort((a, b) => a.slot - b.slot)) {
    if (m.departed) continue;
    m.movedInAt ??= 0; // 입주 지원금은 없다 (D20) — 잔고가 필요한 테스트는 직접 넣는다
    const lot = findLot('west', occupiedLots(s));
    if (lot) s.houses[m.id] = { memberId: m.id, lot };
  }
  return s;
}

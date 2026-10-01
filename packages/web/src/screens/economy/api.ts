// 경제 패널 시계열 (02 문서 9장 GET /api/projects/:id/economy?range=7d|30d|all).
// 실패하면(수집기 꺼짐·옛 수집기 501) 부르는 쪽이 상태의 economy.history로 대신한다 (01 문서 8.7 구현 메모)
import type { DayRecord } from '@tycoon/core';

export type EconomyRange = '7d' | '30d' | 'all';

export interface EconomyResponse {
  fund: number;
  deficit: boolean; // 시청 적자 (D21)
  history: DayRecord[];
  members: { id: string; balance: number; hardship: boolean }[];
}

/** 모양이 틀리면(history가 배열이 아님) Error → 대신 상태를 쓴다 */
export async function fetchEconomy(projectId: string, range: EconomyRange): Promise<EconomyResponse> {
  const url = `/api/projects/${encodeURIComponent(projectId)}/economy?range=${range}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const body = (await r.json()) as EconomyResponse;
  if (!Array.isArray(body?.history)) throw new Error(`${url} → history 없음`);
  return body;
}

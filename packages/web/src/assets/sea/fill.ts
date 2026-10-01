// 구멍 채우기 (03 문서 4장 3). k = 1 / 배율 (선 굵기 보정).
export interface FillParams {
  k?: number;
  colors?: Partial<Record<'roof' | 'roofL' | 'roofR' | 'tint' | 'fab' | 'fabL' | 'fabR', string>>;
  uid?: string; // clipId (인스턴스마다 달라야 함)
  clipY?: number;
  sway?: number; // 흔들림 장면 0·1 (+ phase). 없으면 곧게 (03 문서 3.2 흔들림 구멍)
}

// 두 번 그리기 외곽선: 안쪽 선 굵기 + 3.5k. ponytail: 3.5는 캔버스 w6/w25 쌍에서 잰 값, 캔버스와 비교해 조정.
const OUTLINE_INNER: Record<string, number> = { cor: 5, corB: 7, tenB: 5, logB: 14 };

/** 선 굵기 구멍 wN: 한 자리 = N, 두 자리 = N/10, 배율 보정 × k. 해당 없으면 null */
export function strokeHole(name: string, k: number): string | null {
  const w = /^w(\d+)$/.exec(name)?.[1];
  return w ? String((w.length === 1 ? Number(w) : Number(w) / 10) * k) : null;
}

export function fillAsset(inner: string, p: FillParams = {}): string {
  const k = p.k ?? 1;
  return inner.replace(/\{\{(\w+)\}\}/g, (hole, name: string) => {
    const w = strokeHole(name, k);
    if (w) return w;
    if (name in OUTLINE_INNER) return String((OUTLINE_INNER[name] ?? 0) + 3.5 * k);
    if (name === 'clipId') return p.uid ?? 'clip';
    if (name === 'clipY') return String(p.clipY ?? 0);
    // 캔버스 SeaProp: 밑동(48,128) ±3°, 말미잘 촉수 뿌리(48,108) ±4°
    if (name === 'sw') return p.sway === undefined ? '' : `rotate(${p.sway % 2 ? 3 : -3} 48 128)`;
    if (name === 'swA') return p.sway === undefined ? '' : `rotate(${p.sway % 2 ? 4 : -4} 48 108)`;
    const c = p.colors?.[name as keyof NonNullable<FillParams['colors']>];
    if (c) return c;
    throw new Error(`fillAsset: 채우지 못한 구멍 ${hole}`);
  });
}

// 부지 배치 (02 문서 8.1). 맵 16×16, 가운데 4×4 광장, 광장을 지나는 폭 2 십자 길.
// 넓히기 (D10): 좌표는 처음 16×16 기준 그대로(광장 가운데 (8, 8)), ring k면 타일 범위 [-4k, 16 + 4k) — 이미 놓인 부지는 안 움직인다
export interface Lot {
  x: number; // 부지의 왼쪽 위 타일
  y: number;
  size?: 3; // 한 변 칸 수. 없으면 2 (집·시설). 일터는 3×3을 예약한다 (06 문서 5.1)
}
export const lotSize = (l: Lot): 2 | 3 => l.size ?? 2;
export type Zone = 'north' | 'west' | 'south' | 'east';

export const MAP = 16;
const MID = MAP / 2;
/** 넓힐 때 한쪽에 붙는 칸 수 */
export const RING_STEP = 4;
/** ring k의 한 변 타일 수와, 그릴 때 좌표를 0부터로 미는 양 */
export const mapSize = (ring = 0) => MAP + 2 * RING_STEP * ring;
export const mapOffset = (ring = 0) => RING_STEP * ring;
export const isRoad = (x: number, y: number) => (x >= MID - 1 && x < MID + 1) || (y >= MID - 1 && y < MID + 1);
export const isPlaza = (x: number, y: number) => x >= MID - 2 && x < MID + 2 && y >= MID - 2 && y < MID + 2;

const inZone: Record<Zone, (x: number, y: number) => boolean> = {
  north: (x, y) => x < MID - 2 && y < MID - 2,
  west: (x, y) => x < MID - 2 && y >= MID + 2,
  south: (x, y) => x >= MID + 2 && y >= MID + 2,
  east: (x, y) => x >= MID + 2 && y < MID - 2,
};

/** 부지가 덮는 칸 (왼쪽 위부터 줄마다) */
export function lotTiles(l: Lot): [number, number][] {
  const n = lotSize(l);
  const out: [number, number][] = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push([l.x + dx, l.y + dy]);
  return out;
}

/** 구역 안에서 광장에 가까운 순서로 첫 빈 size×size 칸. 다른 부지(크기 섞임)와 1칸 이상 간격. ring = 섬 넓힘 단계. 없으면 null */
export function findLot(zone: Zone, occupied: Lot[], ring = 0, size: 2 | 3 = 2): Lot | null {
  const cands: Lot[] = [];
  const lo = -mapOffset(ring);
  const hi = MAP + mapOffset(ring);
  for (let y = lo; y <= hi - size; y++)
    for (let x = lo; x <= hi - size; x++) {
      const l: Lot = size === 3 ? { x, y, size } : { x, y };
      if (!lotTiles(l).every(([tx, ty]) => inZone[zone](tx, ty) && !isRoad(tx, ty) && !isPlaza(tx, ty))) continue;
      // 간격 1칸: 두 부지 사이에 빈 줄이 하나 이상
      const near = (o: Lot) =>
        x < o.x + lotSize(o) + 1 && o.x < x + size + 1 && y < o.y + lotSize(o) + 1 && o.y < y + size + 1;
      if (occupied.some(near)) continue;
      cands.push(l);
    }
  const d = (l: Lot) => Math.hypot(l.x + size / 2 - MID, l.y + size / 2 - MID);
  cands.sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x);
  return cands[0] ?? null;
}

/** 그 부지가 있는 구역 (두 번째 랜드마크는 첫 랜드마크의 반대 구역, 06 문서 6.4) */
export const zoneOf = (l: Lot): Zone => (Object.keys(inZone) as Zone[]).find((z) => inZone[z](l.x, l.y)) ?? 'north';

/** 광장 둘레 (06 문서 6.2 벤치·꽃밭): 길·광장·부지 구역 밖 칸 6곳. 광장 가로등 (10,6)·(9,10)은 뺀다 (01 문서 6.2 M7 자리 그대로) */
export const PLAZA_RIM: [number, number][] = [
  [10, 9],
  [6, 10],
  [5, 6],
  [9, 5],
  [5, 9],
  [6, 5],
];

/** 길가 (06 문서 6.2 가로등): 십자 길 양옆 줄(x 6·9, y 6·9 — 부지 구역 밖이라 부지와 안 겹침)에서 광장 끝부터 2칸째, 그 뒤 4칸마다.
 *  가까운 순, 같은 거리면 북 → 동 → 남 → 서. 섬이 넓어지면 늘어난다 (ring k: 8 × (k + 2)곳) */
export function roadsideSpots(ring: number): [number, number][] {
  const out: [number, number][] = [];
  for (let d = 2; d <= 6 + RING_STEP * ring; d += 4)
    out.push(
      [MID - 2, MID - 2 - d],
      [MID + 1, MID - 2 - d],
      [MID + 1 + d, MID - 2],
      [MID + 1 + d, MID + 1],
      [MID + 1, MID + 1 + d],
      [MID - 2, MID + 1 + d],
      [MID - 2 - d, MID + 1],
      [MID - 2 - d, MID - 2],
    );
  return out;
}

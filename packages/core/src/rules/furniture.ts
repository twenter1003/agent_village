// 가구 사기·옮기기와 방 배치 (01 문서 6.4, 8.4). 방은 6×6 칸, 겹침 금지. 순수.
import type { GameConfig } from '../config/config';
import type { DomainEvent, Placement } from '../events/normalize';
import type { Member, VillageState } from '../projector/types';
import { furniturePrice } from './economy';

export const ROOM = 6;

const spec = (kind: string, cfg: GameConfig) => cfg.furniture.find((f) => f.id === kind);
/** 프로토타입 키(__proto__ 등)는 팀원이 아니다 */
const memberOf = (s: VillageState, id: string) => (Object.hasOwn(s.members, id) ? s.members[id] : undefined);

/** 본문 모양: 정수 x·y, rot 0|1 (방 안인지는 canPlace). 서버 400과 프로젝터가 같이 쓴다 */
export function isPlacement(v: unknown): v is Placement {
  const p = v as Placement | null;
  return (
    typeof p === 'object' &&
    p !== null &&
    Number.isInteger(p.x) &&
    Number.isInteger(p.y) &&
    (p.rot === 0 || p.rot === 1)
  );
}

/** 8.4 차지하는 칸: 2×1은 rot 0이면 x쪽, rot 1이면 y쪽으로 한 칸 더 */
function cells(tiles: string, p: Placement): [number, number][] {
  if (tiles !== '2x1') return [[p.x, p.y]];
  return [[p.x, p.y], p.rot ? [p.x, p.y + 1] : [p.x + 1, p.y]];
}

/** 8.4 놓을 수 있는가: 방 안, 1×1은 rot 0, 벽 가구는 오른쪽 뒤 벽(y=0) 줄, 밖 가구는 방에 못 놓음,
 *  그 팀원의 다른 놓인 가구와 안 겹침. skip = 옮기는 가구 자신 */
export function canPlace(m: Member, kind: string, p: Placement, cfg: GameConfig, skip?: string): boolean {
  const f = spec(kind, cfg);
  if (!f || f.outdoor || !isPlacement(p) || (f.tiles !== '2x1' && p.rot !== 0)) return false;
  const mine = cells(f.tiles, p);
  if (mine.some(([x, y]) => x < 0 || y < 0 || x >= ROOM || y >= ROOM)) return false;
  if (f.against === 'wall-right' && mine.some(([, y]) => y !== 0)) return false;
  const taken = new Set<string>();
  for (const o of m.furniture)
    if (o.placed && o.id !== skip)
      for (const [x, y] of cells(spec(o.kind, cfg)?.tiles ?? '1x1', o.placed)) taken.add(`${x},${y}`);
  return mine.every(([x, y]) => !taken.has(`${x},${y}`));
}

/** 빈 칸을 찾아 놓을 자리. 없으면 null (창고). 자동 구매(economy.ts)와 사용자 구매가 같이 쓴다.
 *  8.4 순서: 뒤 모서리(0,0)부터 x+y가 작은 칸, 같으면 x가 작은 칸, 2×1은 rot 0 → 1 */
export function findSpot(m: Member, kind: string, cfg: GameConfig): Placement | null {
  for (let d = 0; d <= 2 * (ROOM - 1); d++)
    for (let x = Math.max(0, d - ROOM + 1); x <= Math.min(d, ROOM - 1); x++)
      for (const rot of [0, 1] as const) {
        const p = { x, y: d - x, rot };
        if (canPlace(m, kind, p, cfg)) return p;
      }
  return null;
}

/** 6.4 사용자 구매 검사. 통과면 null. 서버 응답 코드(404·409·400)와 프로젝터가 같이 쓴다 */
export function purchaseError(
  s: VillageState,
  memberId: string,
  kind: string,
  fabric: string | null,
  cfg: GameConfig,
): 'member' | 'departed' | 'kind' | 'fabric' | 'balance' | null {
  const m = memberOf(s, memberId);
  if (!m) return 'member';
  if (m.departed || m.movedInAt === null) return 'departed'; // 입주 전은 방이 없다 (01 문서 3.3)
  const f = spec(kind, cfg);
  const price = furniturePrice(kind, cfg);
  if (!f || price === null) return 'kind';
  if (f.fabric ? !(fabric !== null && cfg.fabricColors.includes(fabric)) : fabric !== null) return 'fabric';
  const wallet = m.isLeader ? s.economy.fund : m.balance; // 팀장 지갑 = 마을 기금 (D21)
  return wallet >= price ? null : 'balance';
}

export function applyFurniture(s: VillageState, e: DomainEvent, cfg: GameConfig): void {
  if (e.t === 'FurniturePurchased') {
    const m = memberOf(s, e.memberId);
    const price = furniturePrice(e.kind, cfg);
    // 잘못된 줄은 버린다. 잔고 부족은 버리지 않는다: 사용자가 직접 산 가구는 수집기가 살 때 잔고를 확인했고,
    // 규칙이 바뀌어도 남는다 (06 문서 3.5). 가진 만큼만 내고 0에서 멈춘다
    const why = m && purchaseError(s, e.memberId, e.kind, e.fabric, cfg);
    if (!m || price === null || (why && why !== 'balance')) return;
    const paid = Math.max(0, Math.min(price, m.isLeader ? s.economy.fund : m.balance));
    // 팀장 가구는 기금 지출로 따로 적는다 (D21) — 팀원 가구 지출(purchases)은 팀 금고 흐름
    if (m.isLeader) {
      s.economy.fund -= paid;
      s.economy.today.leaderPurchases += paid;
    } else {
      m.balance -= paid;
      s.economy.today.purchases += paid;
    }
    const placed = findSpot(m, e.kind, cfg);
    // id = 구매 시각 (D30): 규칙이 바뀌어 재생해도 같아서 옮기기 줄이 계속 맞는다. 같은 팀원이 같은 ms에 또 사면 -k
    let id = `u${e.at}`;
    for (let k = 1; m.furniture.some((x) => x.id === id); k++) id = `u${e.at}-${k}`;
    m.furniture.push({
      id,
      kind: e.kind,
      fabric: e.fabric,
      price,
      ...(paid < price && { paid }),
      day: s.clock.day,
      by: 'user',
      placed,
    });
    // 가구 이름·화폐 단위는 테마 글자라 넣지 않는다 (05 문서 3.1)
    s.feed.push({ at: e.at, kind: 'economy', text: `${m.name} 가구 구매 · ${price}`, ref: m.id });
  }
  if (e.t === 'FurnitureMoved') {
    const m = memberOf(s, e.memberId);
    const f = m?.furniture.find((x) => x.id === e.furnitureId);
    if (!m || !f) return;
    const p = e.placed;
    if (p === null || canPlace(m, f.kind, p, cfg, f.id)) f.placed = p && { x: p.x, y: p.y, rot: p.rot };
  }
}

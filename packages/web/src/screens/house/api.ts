// 가구 옮기기 (02 문서 9장 PUT /api/projects/:id/members/:mid/furniture/:fid, 본문 { placed }). 결과는 SSE 스냅샷으로 온다.
// 칸 규칙은 서버·프로젝터와 같은 core canPlace (01 문서 8.4)
import { canPlace, type GameConfig, type Member, type Placement } from '@tycoon/core';

/** 실패하면 서버가 준 { error } 또는 상태 코드로 Error */
export async function moveFurniture(
  projectId: string,
  memberId: string,
  furnitureId: string,
  placed: Placement | null,
): Promise<void> {
  const e = encodeURIComponent;
  const url = `/api/projects/${e(projectId)}/members/${e(memberId)}/furniture/${e(furnitureId)}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ placed }),
  });
  if (r.ok) return;
  const body = (await r.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof body?.error === 'string' ? body.error : String(r.status));
}

const same = (a: Placement | null, b: Placement | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.rot === b.rot);

/** 저장 순서 (01 문서 8.4 화면 메모): 서버가 PUT 하나씩 검사하므로 지금 놓이는 것부터. 모두 막히면(자리 바꾸기)
 *  아직 방에 있는 것 하나를 창고로 뺐다가 나중에 놓는다 → 중간 상태에서도 겹치지 않는다 */
export function moveSteps(m: Member, draft: ReadonlyMap<string, Placement | null>, cfg: GameConfig) {
  const cur = m.furniture.map((f) => ({ ...f }));
  const todo = [...draft].filter(([id, p]) => cur.some((f) => f.id === id && !same(f.placed, p)));
  const steps: { id: string; placed: Placement | null }[] = [];
  const apply = (id: string, placed: Placement | null) => {
    steps.push({ id, placed });
    for (const f of cur) if (f.id === id) f.placed = placed;
  };
  while (todo.length) {
    const room = { ...m, furniture: cur };
    const i = todo.findIndex(([id, p]) => {
      const f = cur.find((x) => x.id === id);
      return p === null || (f !== undefined && canPlace(room, f.kind, p, cfg, id));
    });
    const next = todo[i];
    if (next) {
      todo.splice(i, 1);
      apply(...next);
      continue;
    }
    const park = todo.find(([id]) => cur.find((f) => f.id === id)?.placed);
    if (!park) break; // 창고에서도 못 놓는 자리 → 보내지 않음 (화면이 이미 막는다)
    apply(park[0], null);
  }
  return steps;
}

/** 옮긴 것 모두 저장. 중간에 실패하면 거기서 멈추고 Error (이미 보낸 것은 스냅샷에 남는다) */
export async function saveMoves(
  projectId: string,
  m: Member,
  draft: ReadonlyMap<string, Placement | null>,
  cfg: GameConfig,
): Promise<void> {
  for (const s of moveSteps(m, draft, cfg)) await moveFurniture(projectId, m.id, s.id, s.placed);
}

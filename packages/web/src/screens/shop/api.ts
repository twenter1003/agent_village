// 가구 사기 (02 문서 9장 POST /api/projects/:id/purchase, 본문 { memberId, kind, fabric }). 결과는 SSE 스냅샷으로 온다.
// 검사는 서버·프로젝터와 같은 core purchaseError (잔고 부족 = 409)

/** 'poor' = 잔고 부족(409). 그 밖의 실패는 서버가 준 { error } 또는 상태 코드로 Error */
export async function purchase(
  projectId: string,
  memberId: string,
  kind: string,
  fabric: string | null,
): Promise<'ok' | 'poor'> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/purchase`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberId, kind, fabric }),
  });
  if (r.ok) return 'ok';
  if (r.status === 409) return 'poor';
  const body = (await r.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof body?.error === 'string' ? body.error : String(r.status));
}

// 건물 이름 바꾸기 (02 문서 9장 PUT /api/projects/:id/buildings/:bid/name). 결과는 SSE 스냅샷으로 온다 → 응답 본문은 안 읽음.
// 이름 규칙은 서버·프로젝터와 같은 core cleanBuildingName (01 문서 5.3)
/** 실패하면 서버가 준 { error } 또는 상태 코드로 Error */
export async function renameBuilding(projectId: string, buildingId: string, name: string): Promise<void> {
  const url = `/api/projects/${encodeURIComponent(projectId)}/buildings/${encodeURIComponent(buildingId)}/name`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (r.ok) return;
  const body = (await r.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof body?.error === 'string' ? body.error : String(r.status));
}

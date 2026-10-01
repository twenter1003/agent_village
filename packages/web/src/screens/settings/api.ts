// 설정 저장 (02 문서 9장 PUT /api/projects/:id/settings). 바뀐 팀원 목록은 SSE 스냅샷·config로 온다
import type { MemberConf } from '@tycoon/core';

export interface SettingsBody {
  members?: Record<string, Required<MemberConf>>;
  leader?: Required<MemberConf>;
  gameDayMs?: number;
}

/** 쓴 파일과 백업 경로. 실패하면 서버가 준 { error }(noClaudeDir·unreadable…) 또는 상태 코드로 Error */
export async function saveSettings(
  projectId: string,
  body: SettingsBody,
): Promise<{ path: string; backup: string | null }> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = (await r.json().catch(() => null)) as { error?: unknown; path?: string; backup?: string | null } | null;
  if (!r.ok) throw new Error(typeof res?.error === 'string' ? res.error : String(r.status));
  return { path: res?.path ?? '', backup: res?.backup ?? null };
}

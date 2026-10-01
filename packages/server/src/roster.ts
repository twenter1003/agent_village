// 팀원 목록 읽기 (01 문서 3.1): 프로젝트의 .claude/agents/*.md frontmatter(읽기만) + 마을 설정(D14). 없으면 빈 값
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDef, Raw } from '@tycoon/core';

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

// ponytail: YAML 파서 대신 한 줄짜리 `key: value`만 읽는다. 여러 줄 description이 나오면 yaml 패키지
const field = (fm: string, key: string) =>
  (new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(fm)?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');

/** 마을 설정 (01 문서 D14): 타이쿤 저장 공간의 파일(own), 없으면 프로젝트의 옛 .claude/tycoon.json을 읽기만.
 *  깨진 JSON → null (기본 규칙, 바다 id 정규화는 규칙 roster.ts가 한다) */
export function readTycoon(cwd: string, own?: string): Raw | null {
  for (const path of [own, join(cwd, '.claude', 'tycoon.json')]) {
    if (!path || !existsSync(path)) continue;
    try {
      const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function readRoster(cwd: string, own?: string): { agents: AgentDef[]; tycoon: Raw | null } {
  const dir = join(cwd, '.claude', 'agents');
  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch {
    // 폴더 없음 → 팀원 없음
  }
  const agents: AgentDef[] = [];
  for (const f of files) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(join(dir, f)))?.[1] ?? '';
    const name = field(fm, 'name');
    if (name) agents.push({ name, description: field(fm, 'description') });
  }
  return { agents, tycoon: readTycoon(cwd, own) };
}

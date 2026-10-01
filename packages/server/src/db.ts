// raw_events 저장 (02 문서 5.1). append-only — 지우지 않는다. 규칙이 바뀌면 재생으로 상태를 다시 만든다
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Raw } from '@tycoon/core';

// vite 5(vitest)가 'node:sqlite'의 node: 접두어를 떼서 못 찾는다 → 런타임에 꺼낸다
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/** 수집기와 tools/replay.ts가 같은 DB를 본다. TYCOON_DB로 바꿀 수 있다 */
export const DB_PATH = process.env.TYCOON_DB ?? join(homedir(), '.subagent-tycoon', 'tycoon.db');

export interface RawRow {
  project: string;
  session_id: string | null;
  payload: string;
}

export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // WAL: 다른 프로세스가 읽어도(pnpm replay) 쓰기가 막히지 않는다. 동기 호출이라 기다림은 짧게
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=200');
  // ponytail: snapshots 표(재생 체크포인트)는 뺐다. 시작·재생이 느려지면 추가
  db.exec(`CREATE TABLE IF NOT EXISTS raw_events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,
    project     TEXT NOT NULL,
    session_id  TEXT,
    hook        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    dedupe_key  TEXT UNIQUE
  )`);
  const ins = db.prepare(
    'INSERT OR IGNORE INTO raw_events (received_at, project, session_id, hook, payload, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const sel = db.prepare(
    'SELECT project, session_id, payload FROM raw_events WHERE :p IS NULL OR project = :p ORDER BY seq',
  );
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    /** 새로 들어갔으면 true, 중복이면 false. key가 null이면 중복을 보지 않는다 */
    insert: (project: string, p: Raw, key: string | null) =>
      Number(
        ins.run(
          new Date().toISOString(),
          project,
          str(p.session_id),
          str(p.hook_event_name) ?? '',
          JSON.stringify(p),
          key,
        ).changes,
      ) > 0,
    rows: (project?: string) => sel.all({ p: project ?? null }) as unknown as RawRow[],
    close: () => db.close(),
  };
}

// 재생 (02 문서 6.1, 04 문서 M4). 상태 JSON을 stdout으로 낸다
//   pnpm replay <project-id|cwd>  수집기 DB(TYCOON_DB)의 raw_events를 처음부터
//   pnpm replay <file.jsonl>      훅 원문 로그 한 줄씩 → 수집기와 같은 길(요약 → 저장 → 정규화 → 투영), 메모리 DB
// 둘 다 수집기 store를 그대로 쓴다 → 실시간과 같은 결과
import { existsSync, readFileSync } from 'node:fs';
import { DB_PATH } from '../packages/server/src/db';
import { createStore, projectId } from '../packages/server/src/store';

const arg = process.argv[2];
if (!arg) {
  console.error('사용법: pnpm replay <project-id | cwd | file.jsonl>');
  process.exit(1);
}

let out: unknown;
if (arg.endsWith('.jsonl')) {
  // SessionStart마다 cwd의 .claude/agents를 읽는 것도 수집기와 같다 (없으면 팀장만)
  const lines = readFileSync(arg, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  // 훅 본문엔 시각이 없다. _t가 없으면 수집기가 지금 시각을 찍어 재생할 때마다 결과가 달라진다 (02 문서 10장)
  const bad = lines.findIndex((l) => typeof l._t !== 'string' || Number.isNaN(Date.parse(l._t)));
  if (bad >= 0) {
    console.error(`${bad + 1}번째 줄에 _t(ISO 시각)가 없음: 녹화할 때 시각을 넣어야 재생이 결정적이다`);
    process.exit(1);
  }
  const store = createStore(':memory:', () => {});
  for (const line of lines) store.ingest(line);
  const states = [...store.villages.values()].map((v) => v.state);
  out = states.length === 1 ? states[0] : states;
} else {
  if (!existsSync(DB_PATH)) {
    console.error(`DB 없음: ${DB_PATH}`);
    process.exit(1);
  }
  const id = arg.startsWith('/') ? projectId(arg) : arg;
  const store = createStore(DB_PATH, () => {});
  store.rebuild(id);
  out = store.villages.get(id)?.state;
  if (!out) {
    store.rebuild();
    console.error(`없는 마을: ${id}\n있는 마을: ${[...store.villages.keys()].join(', ') || '(없음)'}`);
    process.exit(1);
  }
}
console.log(JSON.stringify(out, null, 2));

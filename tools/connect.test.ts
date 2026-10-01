// 설치 도구 (02 문서 1장): 사용자 프로젝트에는 훅만, 나만 쓰는 settings.local.json에(또는 --global이면 전역 설정에). 겹치지 않게, 몇 번 돌려도 같게, 다른 파일은 안 건드림
// 실제 ~/.claude는 절대 건드리지 않는다: 모든 호출에 임시 home을 넘긴다
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { connect, connectGlobal } from './connect';

const dir = mkdtempSync(join(tmpdir(), 'tycoon-connect-'));
const home = join(dir, 'home'); // 빈 전역 설정
afterAll(() => rmSync(dir, { recursive: true, force: true }));
type Settings = { hooks: Record<string, { hooks: { command: string }[] }[]> } & Record<string, unknown>;
const json = (p: string) => JSON.parse(readFileSync(join(dir, p), 'utf8')) as Settings;
const ours = (groups: { hooks: { command: string }[] }[] = []) =>
  groups.filter((g) => g.hooks.some((h) => h.command.includes('127.0.0.1:4777/hook'))).length;
/** 폴더 안 모든 파일 경로 (안 건드렸는지 비교용) */
const files = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(d, e.name)).map((x) => `${e.name}/${x}`) : [e.name],
  );

test('훅만 settings.local.json에 합치고, 팀 공유 settings.json에 이미 있는 이벤트는 건너뜀. 에이전트·다른 설정·git은 그대로', () => {
  mkdirSync(join(dir, '.claude/agents'), { recursive: true });
  mkdirSync(join(dir, '.git/info'), { recursive: true });
  const shared = {
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'curl http://127.0.0.1:4777/hook' }] }] },
  };
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify(shared));
  const mine = {
    permissions: { allow: ['Bash(ls)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo 내 훅' }] }] },
  };
  writeFileSync(join(dir, '.claude/settings.local.json'), JSON.stringify(mine));
  writeFileSync(join(dir, '.claude/agents/qa.md'), '내 QA');
  writeFileSync(join(dir, '.git/info/exclude'), '# 내 설정\n');

  expect(connect(dir, { home }).ok).toBe(true);
  const local = json('.claude/settings.local.json');
  expect(local.permissions).toEqual(mine.permissions);
  expect(ours(local.hooks.SessionStart)).toBe(0); // 공유 설정에 있어서 두 번 보내지 않음
  expect(ours(local.hooks.Stop)).toBe(1);
  expect(local.hooks.PreToolUse?.map((g) => g.hooks[0]?.command)).toEqual([
    'echo 내 훅',
    expect.stringContaining('127.0.0.1:4777/hook'),
  ]);
  // 바뀐 것은 settings.local.json(+ 백업)뿐
  expect(files(dir).sort()).toEqual([
    '.claude/agents/qa.md',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.claude/settings.local.json.tycoon.bak',
    '.git/info/exclude',
  ]);
  expect(readFileSync(join(dir, '.claude/settings.json'), 'utf8')).toBe(JSON.stringify(shared));
  expect(readFileSync(join(dir, '.claude/agents/qa.md'), 'utf8')).toBe('내 QA');
  expect(readFileSync(join(dir, '.git/info/exclude'), 'utf8')).toBe('# 내 설정\n');

  // 다시 돌려도 같다
  const before = readFileSync(join(dir, '.claude/settings.local.json'), 'utf8');
  expect(connect(dir, { home }).log).toEqual(['· 훅은 이미 설치돼 있어요 (127.0.0.1:4777/hook)']);
  expect(readFileSync(join(dir, '.claude/settings.local.json'), 'utf8')).toBe(before);
});

test('깨진 settings.local.json은 건드리지 않고 실패, 포트는 TYCOON_PORT를 따른다', () => {
  const broken = mkdtempSync(join(dir, 'broken-'));
  mkdirSync(join(broken, '.claude'));
  writeFileSync(join(broken, '.claude/settings.local.json'), '{ 깨짐');
  expect(connect(broken, { home }).ok).toBe(false);
  expect(readFileSync(join(broken, '.claude/settings.local.json'), 'utf8')).toBe('{ 깨짐');

  const other = mkdtempSync(join(dir, 'port-'));
  connect(other, { port: 4800, home });
  const text = readFileSync(join(other, '.claude/settings.local.json'), 'utf8');
  expect(text).toContain('127.0.0.1:4800/hook');
  expect(text).not.toContain('4777');
  expect(existsSync(join(other, '.claude/agents'))).toBe(false);
});

test('--global: 전역 settings.json의 다른 설정·다른 훅은 그대로 두고 우리 훅만 추가, .tycoon.bak, 두 번 돌려도 같음', () => {
  const h = mkdtempSync(join(dir, 'home-'));
  mkdirSync(join(h, '.claude'));
  const mine = {
    model: 'opus',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo 내 전역 훅' }] }] },
  };
  writeFileSync(join(h, '.claude/settings.json'), JSON.stringify(mine));
  expect(connectGlobal({ home: h }).ok).toBe(true);
  const g = JSON.parse(readFileSync(join(h, '.claude/settings.json'), 'utf8')) as Settings;
  expect(g.model).toBe('opus');
  expect(g.hooks.PreToolUse?.map((x) => x.hooks[0]?.command)).toEqual([
    'echo 내 전역 훅',
    expect.stringContaining('127.0.0.1:4777/hook'),
  ]);
  expect(ours(g.hooks.Stop)).toBe(1);
  expect(readFileSync(join(h, '.claude/settings.json.tycoon.bak'), 'utf8')).toBe(JSON.stringify(mine));
  const before = readFileSync(join(h, '.claude/settings.json'), 'utf8');
  expect(connectGlobal({ home: h }).log).toEqual(['· 훅은 이미 설치돼 있어요 (127.0.0.1:4777/hook)']);
  expect(readFileSync(join(h, '.claude/settings.json'), 'utf8')).toBe(before);

  // .claude 폴더가 없으면 만든다
  const fresh = mkdtempSync(join(dir, 'home-'));
  expect(connectGlobal({ home: fresh }).ok).toBe(true);
  expect(ours((JSON.parse(readFileSync(join(fresh, '.claude/settings.json'), 'utf8')) as Settings).hooks.Stop)).toBe(1);
});

test('전역에 이미 있는 이벤트는 프로젝트 모드가 건너뜀, 전부 있으면 프로젝트에 아무것도 안 만듦', () => {
  const h = mkdtempSync(join(dir, 'home-'));
  connectGlobal({ home: h });
  const p = mkdtempSync(join(dir, 'proj-'));
  expect(connect(p, { home: h }).log[0]).toContain('전역');
  expect(files(p)).toEqual([]);

  // 전역에 SessionStart만 있으면 그것만 건너뜀
  const partial = mkdtempSync(join(dir, 'home-'));
  mkdirSync(join(partial, '.claude'));
  writeFileSync(
    join(partial, '.claude/settings.json'),
    JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'curl http://127.0.0.1:4777/hook' }] }] },
    }),
  );
  const q = mkdtempSync(join(dir, 'proj-'));
  connect(q, { home: partial });
  const local = JSON.parse(readFileSync(join(q, '.claude/settings.local.json'), 'utf8')) as Settings;
  expect(ours(local.hooks.SessionStart)).toBe(0);
  expect(ours(local.hooks.Stop)).toBe(1);
});

test('--global: 전역 설정이 깨진 JSON이면 쓰지 않고 실패', () => {
  const h = mkdtempSync(join(dir, 'home-'));
  mkdirSync(join(h, '.claude'));
  writeFileSync(join(h, '.claude/settings.json'), '{ 깨짐');
  expect(connectGlobal({ home: h }).ok).toBe(false);
  expect(readFileSync(join(h, '.claude/settings.json'), 'utf8')).toBe('{ 깨짐');
  expect(files(h)).toEqual(['.claude/settings.json']);
});

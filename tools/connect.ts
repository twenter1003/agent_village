// 설치 도구 (02 문서 1장 "설치 도구"): pnpm connect <프로젝트 경로> | pnpm connect --global
// 사용자 프로젝트에는 관여하지 않는다 — 마을에 필요한 훅만, 나만 쓰는 .claude/settings.local.json에 합친다.
// --global이면 사용자 전역 ~/.claude/settings.json에 (모든 프로젝트, 프로젝트 폴더엔 아무것도 안 생김. D22).
// 에이전트·다른 설정·git 설정은 건드리지 않는다. 그 사람이 만든 에이전트는 수집기가 읽기만 한다.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Hook = { type: string; command: string; async?: boolean };
type Hooks = Record<string, { matcher?: string; hooks: Hook[] }[]>;

const root = resolve(import.meta.dirname, '..');
const EXAMPLE = join(root, 'examples/target-project/.claude/settings.json');
const LOCAL = '.claude/settings.local.json';
const GLOBAL = '.claude/settings.json'; // <home> 아래

/** 이 이벤트에 수집기로 보내는 훅이 이미 있나 */
const hasOurs = (groups: unknown, url: string) =>
  Array.isArray(groups) &&
  groups.some((g: { hooks?: Hook[] }) =>
    g.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(url)),
  );

const hooksOf = (s: Record<string, unknown>) => (s.hooks && typeof s.hooks === 'object' ? s.hooks : {}) as Hooks;

/** 우리 훅을 settings에 합친다. 이벤트마다 같은 수집기 주소 훅이 settings나 others(팀 공유 settings.json·전역 설정)에 있으면 건너뜀 */
export function mergeHooks(
  settings: Record<string, unknown>,
  ours: Hooks,
  url: string,
  others: Record<string, unknown>[] = [],
) {
  const hooks = { ...hooksOf(settings) };
  const shared = others.map(hooksOf);
  const added: string[] = [];
  for (const [event, groups] of Object.entries(ours)) {
    if (hasOurs(hooks[event], url) || shared.some((h) => hasOurs(h[event], url))) continue;
    hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] : []), ...groups];
    added.push(event);
  }
  return { settings: { ...settings, hooks }, added };
}

/** JSON 파일 읽기: 없으면 {}, 깨졌으면 null (그 파일은 쓰지 않는다) */
function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return {};
  try {
    const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const ourHooks = (url: string) =>
  (JSON.parse(readFileSync(EXAMPLE, 'utf8').replaceAll('127.0.0.1:4777/hook', url)) as { hooks: Hooks }).hooks;

/** 설정 파일 path에 우리 훅을 합쳐 쓴다: 다른 설정 그대로, .tycoon.bak(사용자가 만든 .bak을 덮지 않게), 임시 파일 → 바꿔 끼움, 깨진 JSON이면 안 씀 */
function install(path: string, label: string, note: string, url: string, others: Record<string, unknown>[] = []) {
  const current = readJson(path);
  if (!current)
    return { ok: false, log: [`✗ ${label}가 올바른 JSON이 아니라 건드리지 않았어요. 고친 뒤 다시 실행하세요`] };
  const { settings, added } = mergeHooks(current, ourHooks(url), url, others);
  if (added.length === 0) return { ok: true, log: [`· 훅은 이미 설치돼 있어요 (${url})`] };
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, `${path}.tycoon.bak`);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  return { ok: true, log: [`✓ 훅 ${added.length}개 → ${label} (${note}, 수집기 ${url})`] };
}

/** 프로젝트 하나: 그 폴더의 settings.local.json. 전역 설정에 이미 있는 이벤트도 건너뜀 */
export function connect(dir: string, { port = 4777, home = homedir() } = {}) {
  const url = `127.0.0.1:${port}/hook`;
  const global = readJson(join(home, GLOBAL)) ?? {};
  if (mergeHooks({}, ourHooks(url), url, [global]).added.length === 0)
    return { ok: true, log: [`· 전역(~/${GLOBAL})에 이미 연결돼 있어 쓸 게 없어요 (${url})`] };
  const shared = readJson(join(dir, '.claude/settings.json')) ?? {};
  return install(join(dir, LOCAL), LOCAL, '나만 쓰는 설정', url, [shared, global]);
}

/** 모든 프로젝트: 사용자 전역 <home>/.claude/settings.json */
export function connectGlobal({ port = 4777, home = homedir() } = {}) {
  return install(join(home, GLOBAL), `~/${GLOBAL}`, '모든 프로젝트', `127.0.0.1:${port}/hook`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.TYCOON_PORT) || 4777;
  const target = process.argv[2];
  if (!target) {
    console.error('사용법: pnpm connect <프로젝트 경로>  또는  pnpm connect --global (모든 프로젝트)');
    process.exit(1);
  }
  if (target === '--global') {
    const { ok, log } = connectGlobal({ port });
    console.log(
      [
        ...log,
        ...(ok
          ? [
              '',
              '모든 프로젝트에 연결됐어요. 이 저장소에서 pnpm dev → 아무 폴더에서나 Claude Code 세션을 새로 열면 그 폴더의 마을이 생겨요.',
              `되돌리기: ~/${GLOBAL}.tycoon.bak으로 바꾸거나, 그 파일에서 127.0.0.1:${port}/hook 이 든 훅을 지우세요.`,
            ]
          : []),
      ].join('\n'),
    );
    process.exit(ok ? 0 : 1);
  }
  const dir = resolve(target);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`폴더가 없어요: ${dir}`);
    process.exit(1);
  }
  const { ok, log } = connect(dir, { port });
  console.log(
    [
      dir,
      ...log,
      '',
      `그 프로젝트의 다른 파일(에이전트·설정·git)은 건드리지 않았어요. git을 쓰면 ${LOCAL}은 올리지 마세요.`,
      '다음: 이 저장소에서 pnpm dev → 그 프로젝트에서 Claude Code를 새로 열면 마을이 생겨요',
    ].join('\n'),
  );
  if (!ok) process.exit(1);
}

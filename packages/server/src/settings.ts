// 설정 화면 저장 (01 문서 10장 화면 메모 M9·D14, 02 문서 9장): 타이쿤 저장 공간의 마을 설정 파일에 합쳐 쓴다.
// 사용자 프로젝트 폴더에는 쓰지 않는다 — 검사하고, 깨진 파일은 두고, 백업하고, 임시 파일을 바꿔 끼운다.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ACCESSORY_IDS,
  canonicalAccessory,
  canonicalSpecies,
  LEADER_ID,
  SPECIES_IDS,
  type GameConfig,
  type Member,
  type MemberConf,
  type VillageState,
} from '@tycoon/core';

export const DAY_MIN_MS = 60_000;
export const DAY_MAX_MS = 86_400_000;

export interface SettingsPatch {
  members: Record<string, Required<MemberConf>>;
  leader?: Required<MemberConf>;
  gameDayMs?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 마을 설정 파일 (D14): DB 폴더 옆 settings/<마을 id>.json (기본 ~/.subagent-tycoon/settings/) */
export const settingsPath = (dbPath: string, id: string) => join(dirname(dbPath), 'settings', `${id}.json`);

/** 팀원 하나의 세 값. 바다 id도 받아 정본 id로 (05 문서 3.2). 목록 밖이어도 지금 값과 같으면 받는다
 *  (손으로 적은 "devops" 같은 값 때문에 다른 칸을 못 바꾸지 않게, 01 문서 10장). 틀리면 null */
function memberConf(v: unknown, cfg: GameConfig, now: Member): Required<MemberConf> | null {
  if (!isObj(v) || typeof v.species !== 'string' || typeof v.job !== 'string') return null;
  const species = canonicalSpecies(v.species);
  const accessory =
    v.accessory === null ? null : typeof v.accessory === 'string' ? canonicalAccessory(v.accessory) : '';
  const jobs = [...cfg.jobPresets.map((p) => p.id), cfg.fallbackPreset.id];
  if (!SPECIES_IDS.includes(species) && species !== now.species) return null;
  if (!jobs.includes(v.job) && v.job !== now.job) return null;
  if (accessory !== null && !ACCESSORY_IDS.includes(accessory) && accessory !== now.accessory) return null;
  return { species, job: v.job, accessory };
}

/** 본문 검사: 400(모양·값) / 404(없는·떠난 팀원) / 통과하면 patch */
export function parseSettings(body: unknown, s: VillageState, cfg: GameConfig): SettingsPatch | 400 | 404 {
  if (!isObj(body)) return 400;
  const patch: SettingsPatch = { members: {} };
  if (body.members !== undefined) {
    if (!isObj(body.members)) return 400;
    for (const [name, v] of Object.entries(body.members)) {
      const m = Object.hasOwn(s.members, name) ? s.members[name] : undefined;
      if (!m || m.departed || m.isLeader) return 404;
      const conf = memberConf(v, cfg, m);
      if (!conf) return 400;
      patch.members[name] = conf;
    }
  }
  if (body.leader !== undefined) {
    const leader = s.members[LEADER_ID];
    if (!leader) return 404;
    const conf = memberConf(body.leader, cfg, leader);
    if (!conf) return 400;
    patch.leader = conf;
  }
  if (body.gameDayMs !== undefined) {
    const d = body.gameDayMs;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < DAY_MIN_MS || d > DAY_MAX_MS) return 400;
    patch.gameDayMs = d;
  }
  return patch;
}

/** 마을 설정 파일(path)에 합쳐 쓴다. 모르는 키($comment, projectName, 다른 overrides, 팀장 label)는 그대로.
 *  우리 파일이 아직 없으면 프로젝트의 옛 .claude/tycoon.json 내용을 시작값으로 (그 파일은 읽기만) */
export function writeTycoon(
  path: string,
  cwd: string,
  patch: SettingsPatch,
): { path: string; backup: string | null } | 'unreadable' {
  let old: Record<string, unknown> = {};
  const existed = existsSync(path);
  if (existed) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!isObj(parsed)) return 'unreadable';
      old = parsed;
    } catch {
      return 'unreadable'; // 깨진 JSON은 사람이 고치게 둔다
    }
  } else {
    try {
      const legacy: unknown = JSON.parse(readFileSync(join(cwd, '.claude', 'tycoon.json'), 'utf8'));
      if (isObj(legacy)) old = legacy;
    } catch {
      // 없거나 깨짐 → 빈 설정에서
    }
  }
  const members = isObj(old.members) ? { ...old.members } : {};
  for (const [name, conf] of Object.entries(patch.members))
    members[name] = { ...(isObj(members[name]) ? members[name] : {}), ...conf };
  const next: Record<string, unknown> = { ...old, members };
  if (patch.leader) next.leader = { ...(isObj(old.leader) ? old.leader : {}), ...patch.leader };
  if (patch.gameDayMs !== undefined) {
    const overrides = isObj(old.overrides) ? old.overrides : {};
    const time = isObj(overrides.time) ? overrides.time : {};
    next.overrides = { ...overrides, time: { ...time, gameDayMs: patch.gameDayMs } };
  }
  mkdirSync(dirname(path), { recursive: true });
  const backup = existed ? `${path}.bak` : null;
  if (backup) copyFileSync(path, backup);
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true }); // 찌꺼기를 남기지 않는다. 원래 파일은 그대로 (바꿔 끼우기 전)
    throw err;
  }
  return { path, backup };
}

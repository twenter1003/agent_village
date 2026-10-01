// game.default.json + .claude/tycoon.json 병합 (01 문서 3.1), 바다 id → 정본(잔디) id 정규화 (05 문서 3.2)
import defaults from '../../../../design/game.default.json';
import seaMap from '../../../../design/theme-map.sea.json';

export type GameConfig = typeof defaults;
export interface MemberConf {
  species?: string;
  job?: string;
  accessory?: string | null;
}
export interface TycoonConfig {
  projectName?: string;
  theme?: string;
  members?: Record<string, MemberConf>;
  leader?: MemberConf & { label?: string };
  overrides?: Record<string, unknown>;
}

/** 거꾸로 표: 여러 개가 한 곳으로 오면 첫 키 (headlamp → glasses) */
function reverse(table: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [land, sea] of Object.entries(table)) out[sea] ??= land;
  return out;
}
const SEA_SPECIES = reverse(seaMap.species);
const SEA_ACCESSORY = reverse(seaMap.accessory);

export const canonicalSpecies = (s: string) => SEA_SPECIES[s] ?? s;
export const canonicalAccessory = (a: string) => SEA_ACCESSORY[a] ?? a;
/** 고를 수 있는 정본 id (설정 화면·수집기 검사, 01 문서 10장). visitor는 외부인 전용 */
export const SPECIES_IDS = Object.keys(seaMap.species).filter((k) => k !== 'visitor');
export const ACCESSORY_IDS = Object.keys(seaMap.accessory);

const isObj = (v: unknown): v is MemberConf => typeof v === 'object' && v !== null;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** tycoon.json은 사람이 손으로 고친다: 객체가 아닌 항목, 문자열이 아닌 값은 버리고 기본 규칙으로 */
export function normalizeTycoon(t: TycoonConfig): TycoonConfig {
  const fix = (m: MemberConf): MemberConf => {
    const species = str(m.species);
    const accessory = str(m.accessory);
    return {
      ...m,
      species: species && canonicalSpecies(species),
      job: str(m.job),
      accessory: accessory ? canonicalAccessory(accessory) : m.accessory === null ? null : undefined,
    };
  };
  return {
    ...t,
    members: Object.fromEntries(
      Object.entries(t.members ?? {}).flatMap(([k, v]): [string, MemberConf][] => (isObj(v) ? [[k, fix(v)]] : [])),
    ),
    leader: isObj(t.leader) ? { ...t.leader, ...fix(t.leader) } : undefined,
  };
}

function deepMerge<T>(base: T, over: unknown): T {
  if (typeof over !== 'object' || over === null || Array.isArray(over)) return (over ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(out[k], v);
  return out as T;
}

/** 시계 수치는 손으로 고친 값을 믿지 않는다: 문자열이면 날이 NaN으로 멈추고, 0이면 정산이 끝없이 돈다 (01 문서 6.2) */
function saneTime(c: GameConfig): GameConfig {
  const t: Partial<GameConfig['time']> = typeof c.time === 'object' && c.time !== null ? c.time : {};
  const day = Number.isInteger(t.gameDayMs) && Number(t.gameDayMs) >= 1000;
  const gap = typeof t.activeGapCapMs === 'number' && Number.isFinite(t.activeGapCapMs) && t.activeGapCapMs >= 0;
  if (day && gap) return c;
  return {
    ...c,
    time: {
      ...defaults.time,
      ...t,
      gameDayMs: day ? Number(t.gameDayMs) : defaults.time.gameDayMs,
      activeGapCapMs: gap ? Number(t.activeGapCapMs) : defaults.time.activeGapCapMs,
    },
  };
}

/** 일터 층 표도 손으로 고친 값을 믿지 않는다 (06 문서 5.3): 줄이 2개보다 적으면 실행마다 새 일터, 숫자가 아니면 층이 영영 안 오르고,
 *  자재비가 음수면 돈이 생기고, 점수가 줄면 층이 건너뛴다 → 기본 표로 */
function saneWorkplace(c: GameConfig): GameConfig {
  const w: unknown = c.workplace;
  const levels = typeof w === 'object' && w !== null ? (w as { levels?: unknown }).levels : undefined;
  const row = (l: unknown): l is { points: number; cost: number; level: number } =>
    typeof l === 'object' &&
    l !== null &&
    ['points', 'cost', 'level'].every((k) => Number.isFinite((l as Record<string, unknown>)[k])) &&
    (l as { cost: number }).cost >= 0;
  const ok =
    Array.isArray(levels) &&
    levels.length >= 2 &&
    levels.every(row) &&
    levels.every((l: { points: number }, i) => i === 0 || l.points >= (levels[i - 1] as { points: number }).points);
  if (ok) return c;
  return {
    ...c,
    workplace: { ...(typeof w === 'object' && w !== null ? w : {}), levels: defaults.workplace.levels },
  } as GameConfig;
}

/** 마을 시대 (06 문서 6.1): 정본 id. 바다 이름은 theme-map labels.eras */
export const ERAS = ['village', 'town', 'city', 'capital'] as const;
export type Era = (typeof ERAS)[number];

/** 마을 레벨 표·공공시설 표도 손으로 고친 값을 믿지 않는다 (06 문서 6장): 숫자가 아니면 레벨이 영영 안 오르고, 값이 음수면
 *  기금이 생기고, 점수가 줄면 레벨을 건너뛰고, 모르는 시대면 시청 층을 모른다 → 기본 표로. 빈 공공시설 표는 받는다 */
function saneVillage(c: GameConfig): GameConfig {
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  const num = (v: unknown, min: number) => typeof v === 'number' && Number.isFinite(v) && v >= min;
  const v: unknown = c.village;
  const levels = obj(v) ? v.levels : undefined;
  const okLevels =
    Array.isArray(levels) &&
    levels.length >= 1 &&
    levels.every(
      (l: unknown, i) =>
        obj(l) &&
        num(l.points, 0) &&
        num(l.cost, 0) &&
        (ERAS as readonly unknown[]).includes(l.era) &&
        (i === 0 || (l.points as number) >= (levels[i - 1] as { points: number }).points),
    );
  const works: unknown = c.publicWorks;
  const okWorks =
    Array.isArray(works) &&
    works.every((w: unknown) => obj(w) && typeof w.id === 'string' && num(w.cost, 0) && num(w.level, 1));
  if (okLevels && okWorks) return c;
  return {
    ...c,
    village: okLevels ? c.village : { ...(obj(v) ? v : {}), levels: defaults.village.levels },
    publicWorks: okWorks ? c.publicWorks : defaults.publicWorks,
  } as GameConfig;
}

export const makeConfig = (t?: TycoonConfig): GameConfig =>
  saneVillage(saneWorkplace(saneTime(deepMerge(defaults, t?.overrides ?? {}))));
export { defaults as defaultConfig };

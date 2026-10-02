// 도메인 상태 (02 문서 6장). 상태에는 정본(잔디) id만 들어간다 (05 문서 3.1). 성격 필드는 M8에서 채운다.
import type { MemberConf } from '../config/config';
import type { Lot } from '../layout/lots';
import type { TaskStatus, Tokens, ToolKind, Usage } from '../events/normalize';

/** 등록 순서 번호 1, 2, … (D10: 제한 없음). 색은 slotTone으로 1..6을 되풀이 */
export type Slot = number;
export type Tone = 1 | 2 | 3 | 4 | 5 | 6;
export const slotTone = (slot: number): Tone => (((((slot - 1) % 6) + 6) % 6) + 1) as Tone;
export type MemberStatus = 'working' | 'meeting' | 'resting' | 'blocked';
export type VisitorKind = 'Explore' | 'Plan' | 'general-purpose';
export type Facility = 'library' | 'plan' | 'agency';
export const LEADER_ID = '@leader'; // md의 name(소문자·하이픈)과 겹치지 않게 '@'

export interface Member {
  id: string; // md 파일의 name 또는 일한 에이전트의 agent_type. 팀장은 LEADER_ID
  slot: Slot;
  name: string;
  description: string; // md의 description (직업 키워드). md 없는 팀원은 ''
  fromMd: boolean; // 프로젝트 .claude/agents에 있는 팀원 (md가 사라지면 떠남·입주 전이면 목록에서 빠짐, 01 문서 3.1)
  movedInAt: number | null; // 처음 일한 시각 = 입주(집). null = 입주 전 (마을에 안 보임, 01 문서 3.3)
  job: string; // jobPresets[].id 또는 fallbackPreset.id
  species: string; // 정본 id (bear|rabbit|raccoon|penguin|…)
  variant: number; // 자동 변형 (D16): 0 = 원래 모습, n = 도감 n바퀴째 (털 염색 + 무늬). 설정에서 동물을 고르면 0
  accessory: string | null; // 정본 id
  isLeader: boolean;
  departed: boolean; // 입주한 팀원의 md가 사라짐 → 흐리게 남김, 다시 일하면 돌아옴 (01 문서 3.1-5)
  status: MemberStatus;
  blocked: 'permission' | 'failures' | null;
  currentRunId: string | null;
  currentTaskId: string | null;
  cheerUntil: number | null; // 일터 층이 오를 때 주인 환호 (cheerMs, 06 문서 5.4)
  balance: number;
  furniture: OwnedFurniture[]; // 산 가구 (방에 놓였거나 창고). M7
  hardship: boolean; // 토큰 비용을 다 못 내 잔고가 0에서 멈춤 → "형편이 어려움", 다 내면 풀림 (06 문서 3.3). 팀장은 늘 false (D21)
  boughtToday: number; // 오늘 자동 구매 수 (autoBuy.maxPerDay)
  tokens: number; // 지금까지 쓴 비용 환산 토큰 (D11, 01 문서 6.2)
  tokenCostToday: number; // 오늘 낸 토큰 비용 (정산 때 0)
  materialsToday: number; // 오늘 낸 일터 자재비 (06 문서 5.3, 정산 때 0)
  eff: Efficiency; // 효율 순위 재료 (D12, 01 문서 6.6)
  receipt: Receipt; // 토큰 영수증 (D13, 01 문서 6.7)
  personality: Personality; // M8 (01 문서 7장)
}

/** 효율 (D23, 06 문서 3.6): 끝난 실행마다 쓴 토큰 ÷ 그 실행의 일 점수. 잔고와 따로 — 양이 아니라 비율 */
export interface Efficiency {
  recent: { runId: string; tokens: number; credit: number }[]; // 최근 efficiency.window개 실행. credit = 일 점수 (도구 호출 × 품질)
}

/** 토큰 영수증 (D13, 01 문서 6.7-2): 지금까지 원인별·모델별 비용 환산 토큰. 원인 = base | output | rebuild | talk | tool:<이름> */
export interface Receipt {
  parts: Record<string, number>;
  runs: number; // 영수증이 있는 실행(팀장은 메인 턴) 수
  calls: number; // 그 실행들의 호출 수
  models: Record<string, number>;
}

export type Axis = 'EI' | 'SN' | 'TF' | 'JP';

/** 성격 (01 문서 7장). 축 점수 0~100: 0 = 앞 글자(E·S·T·J), 100 = 뒤 글자(I·N·F·P) */
export interface Personality {
  EI: number;
  SN: number;
  TF: number;
  JP: number;
  letters: string; // 히스테리시스를 거친 글자 4개 (예: 'ISTJ')
  drifting: { axis: Axis; toward: string; percent: number } | null; // UI "T가 F 쪽으로 38%"
  reason: string; // 가장 크게 움직인 지표로 만든 이유 문장 ("보고에 칭찬·고마움 말이 늘어서", 01 문서 7장 표)
  driftToday: Record<Axis, number>; // 오늘 움직인 양 (maxDriftPerDay 한도)
  samples: PersonalitySample[]; // 최근 personality.window개 작업의 지표
  lastMeetingAt: number | null; // 마지막으로 참가한 회의의 시작 시각 (E/I 불참 판단)
}

/** 작업 하나에서 뽑은 축별 목표 신호 (0~100). 지표가 없는 축은 null */
export interface PersonalitySample {
  taskId: string;
  at: number;
  EI: number | null;
  SN: number | null;
  TF: number | null;
  JP: number | null;
}

/** 가구 한 점 (01 문서 6.4, 8.4). 방은 6×6 칸, placed=null이면 창고 */
export interface OwnedFurniture {
  id: string; // 고정 id (01 문서 D30): 사용자 구매 u<구매 시각>(같은 팀원·같은 ms면 -k), 자동 구매 a<날>.<팀원>.<그날 몇 번째>
  kind: string; // cfg.furniture[].id (정본 id)
  fabric: string | null; // cfg.fabricColors 중 하나 (fabric 가구만)
  price: number; // 산 가격 (정수 코인)
  paid?: number; // 실제로 낸 돈. 가격보다 적을 때만 (재생에서 잔고가 모자란 사용자 구매, 06 문서 3.5)
  day: number; // 산 게임 날
  by: 'auto' | 'user';
  placed: { x: number; y: number; rot: 0 | 1 } | null; // 왼쪽 위 칸, rot 1 = 2×1을 1×2로 돌림
}

/** 게임 하루 기록 (경제 패널 시계열, 02 문서 9 /economy). 물가·금리·관리비·보너스는 없다 (D20) */
export interface DayRecord {
  day: number;
  at: number;
  wages: number; // 그날 끝난 팀원 실행의 급여 합 (세전, D20). 팀장은 급여가 없다
  tax: number;
  purchases: number; // 그날 팀원 가구 지출 합 (잔고에서)
  tokens: number; // 그날 팀원이 낸 토큰 비용 합 (D11)
  leaderTokens: number; // 그날 기금에서 낸 팀장 토큰값 (D21)
  leaderUnpaid: number; // 그날 기금이 모자라 못 낸 팀장 토큰값 (돈이 아니라 기록, 06 문서 3.3)
  leaderPurchases: number; // 그날 기금에서 낸 팀장 가구 (사용자가 사 줌, D21)
  materials: number; // 그날 팀원이 낸 일터 자재비 (06 문서 5.3). 팀원 잔고 = 급여 − 세금 − 가구 − 토큰 − 자재비
  works: number; // 그날 기금에서 낸 레벨업 공사비 + 공공시설 (06 문서 6.4)
  fund: number; // 정산 뒤 마을 기금
  balances: Record<string, number>; // 정산 뒤 팀원 잔고
}

export interface EconomyState {
  fund: number; // 마을 기금 = 팀장 지갑 (D21): 세금(팀원 급여의 taxRate) − 팀장 토큰값 − 팀장 가구 − 레벨업·공공시설. 팀장은 급여가 없다
  deficit: boolean; // 시청 적자: 오늘이나 지난 정산 날에 기금이 팀장 토큰값을 다 못 낸 몫이 있음. 못 낸 몫이 없는 날이 정산되면 꺼짐 (06 문서 3.3)
  today: {
    wages: number;
    tax: number;
    purchases: number;
    tokens: number;
    leaderTokens: number;
    leaderUnpaid: number;
    leaderPurchases: number;
    materials: number;
    works: number;
  }; // 오늘 누적 (정산 때 비움)
  history: DayRecord[];
}

export interface Visitor {
  runId: string;
  kind: VisitorKind;
  facility: Facility;
  startedAt: number;
}

export interface AgentRun {
  runId: string;
  agentType: string;
  memberId: string | null; // 팀원이면 id
  visitorKind: VisitorKind | null; // 외부인이면 종류
  startedAt: number;
  endedAt: number | null;
  lastAt: number; // 이 실행의 마지막 이벤트 시각 (시작 + 그 runId를 단 이벤트) — 활동 시간 상한 기준 (01 문서 6.2)
  ok: boolean | null;
  toolCalls: number;
  failStreak: number; // 연속 도구 실패
  testsPassed: number;
  testsFailed: number;
  openPre: Record<string, number>; // Pre를 받고 Post를 아직 못 받은 도구 이름별 수 (중복 집계 방지)
  lastMessage?: string;
  habits?: RunHabits; // 성격 S/N·J/P 지표 (M8). 첫 도구 호출 때 생김
  tokens?: number; // 이 실행의 비용 환산 토큰 (끝날 때 한 번 청구, D11)
  wage?: number; // 이 실행의 급여(세전). 팀원 실행이 끝날 때 한 번 (D20, 06 문서 3.4). 외부인 실행은 없음
  taskId?: string; // Agent 호출 대체 작업 (01 문서 5.1-5): 끝나면 이 작업이 완료
  cum?: { tokens: Tokens; usage?: Usage }; // 이 구간 끝에서 읽은 기록 파일 누적 — 이어 받은 다음 구간은 이것과의 차이만 청구 (01 문서 6.1). 스냅샷에선 뺀다
}

/** 실행의 도구 습관 (01 문서 7장). 숫자와 도구 이름만 — 입력·출력 원문 없음 */
export interface RunHabits {
  kinds: Partial<Record<ToolKind | 'bigEdit' | 'test', number>>; // 호출 수. 큰 Edit은 bigEdit, 테스트 명령은 test로 따로
  retries: number; // 실패한 도구를 바로 다음 호출에서 다시 부름
  switches: number; // 앞 호출과 다른 도구
  last: string | null; // 앞 호출 도구 이름
  failed: string | null; // 방금 실패한 도구 이름 (다음 호출에서 비움)
}

export interface Task {
  id: string;
  subject: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  contributions: Record<string, number>; // memberId | visitorKind → ms
  quality: 'testsPassed' | 'noTests' | 'failed';
  toolCalls: number;
  salaryPaid: number; // 짝지어진 실행(r.taskId)이 받은 급여(세전) 합. 보여 주기용 기록 — 급여는 실행마다 (D20)
  summary?: string; // 한 줄 요약 (신문, 06 문서 9장): 끝낸 서브에이전트 마지막 보고의 첫 문장 80자. 보고 저장을 껐거나 보고가 없으면 없음
}

/** 팀원 일터 (06 문서 5장, D18·D19). 절대 삭제 안 함. 층·점수·낸 자재비는 내려가지 않는다 */
export interface Building {
  id: string; // `w<n>:<memberId>` — 규칙이 바뀌어 재생해도 같은 id라 사용자 이름(ui rename 줄)이 따라간다 (5.9)
  memberId: string; // 주인. 처음부터 정해진다 (5.6)
  n: number; // 그 팀원의 몇 번째 일터 (1부터, 5.5)
  name: string; // 사용자가 지은 이름. '' = 기본 이름 (화면이 이름 사전으로 "<팀원>의 <종류>", 05 문서 3장)
  lot: Lot; // 3×3 예약 (size 3). 큰 건물 전에는 왼쪽 위 2×2에 서고 나머지는 앞마당
  floor: number; // 0 = 첫 일 공사 중, 1~3층, 4 = 큰 건물 (= workplace.levels.length)
  points: number; // 쌓인 일 점수 (끝난 실행의 도구 호출 × 품질, 5.2)
  paid: number; // 낸 자재비 합 (5.3)
  waiting: 'materials' | 'level' | null; // 게이지는 찼는데 모자란 것 (5.4). 게이지가 덜 찼거나 큰 건물이면 null
  startedAt: number; // 부지를 잡은 시각
  floorAt: number | null; // 마지막으로 층이 오른 시각 (1층 완공 포함) — 반짝임·거품
}

/** 공공시설 종류 (06 문서 6.2). 정본 id — 바다 이름은 theme-map labels.works */
export type WorkKind = 'streetlamp' | 'bench' | 'flowers' | 'park' | 'paving' | 'landmark' | 'landmark2';
/** 공공시설 하나 (06 문서 6.2·6.4). 마을 기금으로 지음, 절대 지우지 않는다 */
export interface PublicWork {
  id: string; // 한 번만 짓는 것 = 종류, 되풀이하는 소품 = `<종류>:<n>` (그 종류 n번째) — 재생해도 같다
  kind: WorkKind;
  day: number; // 지은 게임 날
  cost: number; // 기금에서 낸 값. 두 번째 랜드마크는 0 (마지막 레벨업 공사비에 들어 있음)
  spot: { x: number; y: number } | null; // 가로등·벤치·꽃밭 칸 (상태 좌표). 그 밖 null
  lot: Lot | null; // 공원·랜드마크 3×3 부지 (size 3). 그 밖 null
}

export interface House {
  memberId: string;
  lot: Lot;
}

export interface Meeting {
  kind: 'prompt' | 'kickoff';
  startedAt: number;
  until: number; // 이 시각이 지나면 끝 (maxMs / kickoffMs)
  preview: string;
  participants: string[]; // memberId
}

export type FeedKind = 'task' | 'meeting' | 'economy' | 'personality';
export interface FeedItem {
  at: number;
  kind: FeedKind;
  text: string;
  ref?: string;
}

export type ToastKind = 'complete' | 'salary' | 'meeting' | 'personality' | 'failure' | 'tokens';
export interface Toast {
  id: string;
  at: number;
  kind: ToastKind;
  text: string;
  sticky: boolean; // 회의·실패는 직접 닫거나 그 상태가 끝날 때까지 (01 문서 9장)
  ref?: string; // 실패 = 막힌 팀원 id (막힘이 풀리면 화면이 내린다)
}

/** 게임 시계 (01 문서 6.2 활동 시간, D4). 날은 에이전트가 일한 시간으로만 간다 */
export interface Clock {
  now: number; // 지금까지 본 가장 늦은 이벤트 시각
  day: number; // day + floor((activeMs − dayStartMs) / dayMs) — 내려가지 않음
  activeMs: number; // 일하는 중이었던 시간 누적
  dayStartMs: number; // 오늘(day)이 시작된 activeMs
  dayMs: number; // 지금 쓰는 하루 길이. 설정(gameDayMs)이 바뀌면 지금 날에서 이어 간다 (01 문서 6.2)
  lastEventAt: number; // 마지막 훅 이벤트 시각 (Tick·팀원 목록·사용자 행동 뺌) — 메인 턴 상한(activeGapCapMs)의 기준
  mainTurn: boolean; // 메인 세션 턴 진행 중 (PromptSubmitted ~ MainTurnEnded, 새 세션·세션 끝이 닫음)
}

export interface VillageState {
  project: string;
  clock: Clock;
  members: Record<string, Member>;
  visitors: Record<string, Visitor>; // 실행 중인 외부인 (runId 키)
  runs: Record<string, AgentRun>; // 끝난 실행도 남긴다 (기여 계산)
  tasks: Record<string, Task>;
  buildings: Record<string, Building>; // 팀원 일터 (06 문서 5장). 절대 삭제 안 함
  houses: Record<string, House>; // memberId 키
  facilities: Partial<Record<Facility, Lot>>; // 그 외부인이 처음 올 때 북쪽에 짓는다 (01 문서 3.3)
  taskTool: boolean; // TaskCreate를 본 적 있나. 없으면 Agent 호출 = 작업 (01 문서 5.1-5)
  agentCalls: { callId: string; type: string; taskId: string }[]; // 아직 실행과 짝짓지 못한 Agent 호출 (같은 종류의 다음 실행과)
  mainTokens: Record<string, Tokens>; // 세션마다 팀장에게 청구한 메인 기록 누적 (다음 청구는 차이만, D11)
  mainUsage: Record<string, Usage>; // 세션마다 마지막 영수증 재료 누적 (D13). 최근 MAIN_USAGE_KEEP 세션만 — 치운 세션이 이어지면 tokens로만 청구
  mainCtx: { sessionId: string; tokens: number; perCall: number; at: number; warned: boolean } | null; // 팀장 대화 크기 게이지 (D13, 6.7-4)
  ring: number; // 섬 넓힘 단계 (D10, 02 문서 8.1): 타일 범위 [-4·ring, 16 + 4·ring)
  level: number; // 마을 레벨 (06 문서 6.1). 하루 정산에서만 오르고 내려가지 않는다
  hall: Lot | null; // 시청 (06 문서 6.3): 첫 일에 북쪽 구역 광장 가까이 3×3. 층은 저장하지 않고 레벨의 시대로 (hallFloor)
  publicWorks: PublicWork[]; // 공공시설 (06 문서 6.2), 지은 순서. 절대 삭제 안 함
  foundedAt: number | null; // 마을이 처음 일한 시각 = 광장·길·팀장 집 (01 문서 3.3). null = 빈 모래섬
  conf: { members: Record<string, MemberConf>; leader?: MemberConf & { label?: string } }; // 마지막 roster의 tycoon.json (나중에 입주하는 팀원도 이 설정)
  meeting: Meeting | null;
  feed: FeedItem[]; // 최근 것이 뒤. 500개 유지
  toasts: Toast[];
  seq: number; // 토스트·건물 id용 카운터 (결정적)
  economy: EconomyState;
}

// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { defaultConfig, type FeedItem, type Toast, type VillageState } from '@tycoon/core';
import { memberViews } from '../live/movement';
import { setPrefs } from '../live/prefs';
import { ActivityFeed, visibleFeed } from './ActivityFeed';
import { MainScreen } from './MainScreen';
import { TeamPanel } from './TeamPanel';
import { AUTO_MS, pendingToasts } from './ToastStack';
import { RECENT_NOTIFICATIONS } from './TopBar';
import { fullVillage } from '../test/village';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom의 URL은 file:을 몰라서 경로로
/** 다 자란 마을 (시설 3채·슬롯 순 집·모두 입주): 그리기·이동 논리만 본다 — 자라는 순서는 core growth.test */
const golden = () =>
  fullVillage(
    JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../../fixtures/sample-session.golden.json'), 'utf8'),
    ) as VillageState,
  );

/** 골든의 회의 토스트(toast1)가 가리키는 회의를 아직 열린 채로 (끝난 회의 토스트는 화면이 내린다, 01 문서 9장) */
function liveMeeting(s: VillageState, preview = '로그인 개선 작업 진행해줘') {
  const at = s.toasts.find((x) => x.kind === 'meeting')?.at ?? 0;
  s.meeting = { kind: 'prompt', startedAt: at, until: at + 1e12, preview, participants: [] };
  return s;
}

function render(el: ReactElement) {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(el));
  return { div, root, unmount: () => act(() => root.unmount()) };
}
const texts = (root: Element, sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent ?? '');
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());

test('팀원 패널: 골든 상태 → 카드 4장, 상태·작업 줄, 바위 위 휴식은 prop으로만', () => {
  const s = golden();
  s.economy.fund = 1234;
  const onSelect = vi.fn();
  const r = render(h(TeamPanel, { state: s, selectedId: 'qa-reviewer', onSelect }));
  const cards = r.div.querySelectorAll('button.tp-card');
  expect(cards).toHaveLength(4);
  // 슬롯 순, 바다 얼굴 (bear → seal …)
  expect([...cards].map((c) => c.getAttribute('data-member'))).toEqual([
    '@leader',
    'backend-dev',
    'frontend-dev',
    'qa-reviewer',
  ]);
  expect(cards[1]?.querySelector('[data-asset-id="seal.face"]')?.getAttribute('aria-label')).toBe('점박이물범 얼굴');
  expect(texts(r.div, '.ui-chip--status')[1]).toBe('막힘 · 권한 요청'); // 까닭 (views 없이도 상태에 있음)
  expect(cards[1]?.textContent).toContain('토큰 갱신 API'); // 지금 하는 작업
  expect(cards[1]?.textContent).toContain('backend-dev의 공방 공사 중');
  expect(cards[2]?.textContent).toContain('다음 작업을 기다리는 중');
  expect(cards[3]?.getAttribute('aria-pressed')).toBe('true');
  expect(cards[3]?.classList.contains('ui-card--selected')).toBe(true);
  // 카드 지갑: 팀원 = 잔고, 팀장 = 마을 기금 (D21 — 팀장 잔고는 쓰지 않는다)
  const bal = (i: number) => cards[i]?.querySelector('.tp-card__bal')?.textContent?.replace(/[^\d,]/g, '');
  expect(bal(0)).toBe('1,234');
  expect(bal(1)).toBe((s.members['backend-dev']?.balance ?? -1).toLocaleString('ko-KR'));
  click(cards[0]);
  expect(onSelect).toHaveBeenCalledWith('@leader');
  r.unmount();

  // 곳은 마을과 같은 규칙(memberViews): 물범이 바위 위면 "휴식 · 바위 위", 나머지는 "휴식 · 집" (SeaTeamPanel)
  Object.assign(s.members['backend-dev'] ?? {}, { status: 'resting', blocked: null, currentRunId: null });
  const views = memberViews(s, defaultConfig, s.clock.now);
  const rock = render(h(TeamPanel, { state: s, views }));
  expect(texts(rock.div, '.ui-chip--status')).toEqual(['휴식 · 집', '휴식 · 바위 위', '휴식 · 집', '휴식 · 집']);
  rock.unmount();

  // 카드 상태는 스냅샷이 아니라 views (회의가 이벤트 없이 끝난 뒤): 회의 중 → 작업 중 · 일터
  Object.assign(s.members['frontend-dev'] ?? {}, { status: 'meeting' });
  const live = new Map(views).set('frontend-dev', { status: 'working', place: 'site' });
  const later = render(h(TeamPanel, { state: s, views: live }));
  expect(texts(later.div, '.ui-chip--status')[2]).toBe('작업 중 · 일터');
  later.unmount();
});

test('팀원 카드 일터 줄: 작업 없이 일해도 일터·층, 종류 이름은 마을 설정(cfg)의 직업 프리셋 (06 문서 5.6)', () => {
  const s = golden();
  Object.assign(s.members['backend-dev'] ?? {}, { currentTaskId: null });
  const card = (cfg = defaultConfig) =>
    render(h(TeamPanel, { state: s, cfg })).div.querySelector('[data-member="backend-dev"] .tp-card__task')
      ?.textContent;
  expect(card()).toBe('작업 준비 중backend-dev의 공방 공사 중');
  const cafe = {
    ...defaultConfig,
    jobPresets: defaultConfig.jobPresets.map((p) => (p.id === 'backend' ? { ...p, building: 'cafe' } : p)),
  };
  expect(card(cafe)).toBe('작업 준비 중backend-dev의 카페 공사 중');
});

test('활동 기록: 최근 것이 위, 필터', () => {
  const s = golden();
  const r = render(h(ActivityFeed, { feed: s.feed }));
  const rows = () => [...r.div.querySelectorAll('.af__row')];
  // 새 것이 위: 막힘·입주·일터 1층 완공·입주(작업), 회의, 팀장 입주·마을 세우기(작업) — 01 문서 3.3, 06 문서 5.9
  expect(rows().map((e) => e.getAttribute('data-kind'))).toEqual([
    'task',
    'task',
    'task',
    'task',
    'meeting',
    'task',
    'task',
  ]);
  const chip = (label: string) => [...r.div.querySelectorAll('button')].find((b) => b.textContent === label);
  click(chip('회의'));
  expect(rows().map((e) => e.getAttribute('data-kind'))).toEqual(['meeting']);
  expect(chip('회의')?.getAttribute('aria-pressed')).toBe('true');
  click(chip('경제'));
  expect(texts(r.div, '.af__row')).toEqual(['아직 기록이 없어요']);
  click(chip('전체'));
  expect(rows()).toHaveLength(7);
  // 스크롤 목록은 키보드로 닿으니 이름을 붙인다 (포커스 링은 screens.css)
  expect(r.div.querySelector('ol.af__list')?.getAttribute('tabindex')).toBe('0');
  expect(r.div.querySelector('ol.af__list')?.getAttribute('aria-label')).toBe('활동 기록');
  r.unmount();
});

test('활동 기록: 새 기록이 와도 있던 행은 그대로 (key 고정 → 한 줄만 넣기)', () => {
  const feed: FeedItem[] = golden().feed;
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h(ActivityFeed, { feed })));
  const rows = () => [...div.querySelectorAll('.af__row')];
  const [top] = rows();
  const before = top?.textContent;
  const next: FeedItem = { at: (feed.at(-1)?.at ?? 0) + 1, kind: 'task', text: '새 기록' };
  act(() => root.render(h(ActivityFeed, { feed: [...feed, next] })));
  expect(rows()).toHaveLength(feed.length + 1);
  expect(rows()[0]?.textContent).toContain('새 기록');
  expect(rows()[1]).toBe(top); // 같은 DOM 행이 한 칸 아래로
  expect(top?.textContent).toBe(before); // 내용을 다시 쓰지 않았다
  act(() => root.unmount());
  // 같은 내용이 두 번 있어도 key는 겹치지 않는다
  expect(new Set(visibleFeed([next, next], 'all').map((f) => f.key)).size).toBe(2);
});

test('토스트: 최대 3개 새 것이 위, 자동은 5초 뒤 사라지고 회의·실패는 닫을 때까지', () => {
  vi.useFakeTimers();
  const s = liveMeeting(golden()); // toast1 회의, toast2 실패 (둘 다 sticky)
  const now = s.clock.now;
  vi.setSystemTime(now);
  const auto = (id: string, at: number): Toast => ({ id, at, kind: 'complete', text: `${id} 완공`, sticky: false });
  s.toasts.push(auto('old', now - AUTO_MS - 1), auto('a', now - 2), auto('b', now - 1), auto('c', now));
  expect(pendingToasts(s, new Set(), now).map((x) => x.id)).toEqual(['c', 'b', 'a', 'toast2', 'toast1']);
  // 나이는 보는 사람 시계: 완공이 마지막 이벤트(게임 시계 = 그 시각)여도 한참 뒤에 열면 자동 토스트는 없다
  expect(pendingToasts(s, new Set(), now + 12_000).map((x) => x.id)).toEqual(['toast2', 'toast1']);

  const onEconomy = vi.fn();
  const r = render(
    h(MainScreen, {
      state: s,
      projects: [],
      currentProjectId: s.project,
      onProjectChange: () => {},
      village: null,
      onEconomy,
    }),
  );
  // 알림 버튼 = 목록(M9). 설정 버튼은 열 곳(onSettings)이 없으면 비활성 표시, 포커스는 받는다 (disabled 아님)
  const [level, vault, fund, bellBtn, settings] = r.div.querySelectorAll<HTMLButtonElement>('.tb button');
  expect(bellBtn?.getAttribute('aria-disabled')).toBeNull();
  expect([settings?.getAttribute('aria-disabled'), settings?.hasAttribute('disabled')]).toEqual(['true', false]);
  // 금고·마을 기금 칩 → 경제 패널 (M7·M12). 금고 = 잔고 합, 기금 = 팀장 지갑 (D21). 물가 칩은 없다 (D20)
  const sum = Object.values(s.members).reduce((n, m) => n + m.balance, 0);
  expect(vault?.textContent).toContain(sum.toLocaleString('ko-KR'));
  expect(fund?.textContent).toBe(`마을 기금 ${s.economy.fund.toLocaleString('ko-KR')}`);
  expect(fund?.classList.contains('tb__chip--deficit')).toBe(false);
  expect(fund?.title).toBe('팀장(시장)의 지갑 · 세금으로 벌고 팀장 토큰값을 내요 · 경제 패널 열기');
  expect(r.div.querySelector('.tb')?.textContent).not.toContain('물가');
  expect(level?.textContent).toContain('Lv.1 모래섬 마을');
  click(level);
  click(vault);
  click(fund);
  expect(onEconomy).toHaveBeenCalledTimes(3);
  const shown = () => texts(r.div, '.ts .ui-toast__title');
  const bell = () => r.div.querySelector('.tb__iconbtn')?.getAttribute('aria-label');
  expect(shown()).toEqual(['c 완공', 'b 완공', 'a 완공']);
  expect(bell()).toBe('알림 5개');

  act(() => vi.advanceTimersByTime(AUTO_MS));
  expect(shown()).toEqual(['backend-dev 막힘', '광장 회의 시작']);
  expect(r.div.querySelector('.ts [role="alert"]')?.textContent).toContain('권한 요청을 기다려요');
  // 실패 토스트 타일 = 바다 보드 SeaUI (--slot2-tint, 테두리 --danger)
  expect(r.div.querySelector('.ts [role="alert"] .ui-toast__tile')?.getAttribute('style')).toContain('--slot2-tint');

  act(() => vi.advanceTimersByTime(10 * 60_000));
  expect(shown()).toHaveLength(2);
  click(r.div.querySelector('.ts .ui-toast__close'));
  expect(shown()).toEqual(['광장 회의 시작']);
  expect(bell()).toBe('알림 1개');
  r.unmount();
  vi.useRealTimers();
});

test('토스트는 마을 칸 밖: 건물 상세를 연 동안에도 보인다 (마을·기록·패널만 가림)', () => {
  const s = liveMeeting(golden());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(s.clock.now);
  const props = { state: s, projects: [], currentProjectId: s.project, onProjectChange: () => {}, village: null };
  const r = render(h(MainScreen, { ...props, detail: h('p', null, '상세') }));
  const ts = r.div.querySelector('.ts');
  expect(ts?.parentElement?.classList.contains('ms--detail')).toBe(true); // screens.css: .ms--detail > :not(.tb, .ms__detail, .ts)
  expect(ts?.closest('.ms__village')).toBeNull();
  expect(texts(r.div, '.ts .ui-toast__title')).toEqual(['backend-dev 막힘', '광장 회의 시작']);
  expect(ts?.querySelector('[role="alert"]')).not.toBeNull(); // 실패 토스트가 상세 위에서도 읽힌다
  r.unmount();
  vi.useRealTimers();
});

test('급여 토스트 (M7, 01 문서 9장): 새 것이 위, 자동으로 사라진다 (물가 토스트는 없다, D20)', () => {
  vi.useFakeTimers();
  const s = golden();
  const now = s.clock.now;
  vi.setSystemTime(now);
  s.toasts = [
    { id: 's', at: now - 1, kind: 'salary', text: '3일째 정산 · 급여 120 · 토큰 30', sticky: false },
    { id: 'k', at: now, kind: 'tokens', text: '팀장 대화가 커요 · 12만', sticky: false },
  ];
  const props = { state: s, projects: [], currentProjectId: s.project, onProjectChange: () => {}, village: null };
  const r = render(h(MainScreen, props));
  expect(texts(r.div, '.ts .ui-toast__title')).toEqual(['팀장 대화가 커요', '3일째 정산']);
  expect(texts(r.div, '.ts .ui-toast__desc')).toEqual(['12만', '급여 120 · 토큰 30']);
  act(() => vi.advanceTimersByTime(AUTO_MS));
  expect(texts(r.div, '.ts .ui-toast')).toEqual([]);
  r.unmount();
  vi.useRealTimers();
});

test('상단 바 마을 기금 칩 (D21): 시청 적자면 위험 테두리·글자 + 막힘 아이콘 + 까닭 title', () => {
  const s = golden();
  s.economy.fund = 0;
  s.economy.deficit = true;
  const props = { state: s, projects: [], currentProjectId: s.project, onProjectChange: () => {}, village: null };
  const r = render(h(MainScreen, props));
  const fund = r.div.querySelector<HTMLButtonElement>('.tb__chip--fund');
  expect(fund?.classList.contains('tb__chip--deficit')).toBe(true);
  expect(fund?.textContent).toContain('마을 기금');
  expect(fund?.querySelector('.tb__num')?.textContent).toBe('0');
  expect(fund?.querySelector('[data-icon="blocked"] title')?.textContent).toBe('시청 적자'); // 색만이 아니라 아이콘 + 이름
  expect(fund?.title).toBe(
    '시청 적자 · 기금이 팀장 토큰값을 다 못 냈어요 · 팀원에게 더 맡기고 팀장 대화를 줄이면 풀려요',
  );
  r.unmount();
});

test('상단 바 레벨 칸 (06 문서 13장·6.4): "Lv.4 산호 읍" + 이 레벨 안의 일 점수 진행 + 일·기금 / 다음 레벨(공사비 + 그날 팀장 토큰값), 최고 레벨이면 다 참', () => {
  const [l4, l5] = [defaultConfig.village.levels[3], defaultConfig.village.levels[4]];
  if (!l4 || !l5) throw new Error('레벨 표');
  const fmt = (n: number) => n.toLocaleString('ko-KR');
  const s = golden();
  s.level = 4;
  s.economy.fund = 3200;
  Object.assign(s.economy.today, { leaderTokens: 400, leaderUnpaid: 100 }); // 남길 팀장 토큰값 500
  for (const b of Object.values(s.buildings)) b.points = 0;
  const first = Object.values(s.buildings)[0];
  if (!first) throw new Error('일터');
  first.points = (l4.points + l5.points) / 2; // 이 레벨 안에서 50%
  const props = { state: s, projects: [], currentProjectId: s.project, onProjectChange: () => {}, village: null };
  const r = render(h(MainScreen, props));
  const lv = r.div.querySelector<HTMLButtonElement>('.tb__level');
  expect(lv?.querySelector('.tb__prog-title')?.textContent).toBe('Lv.4 산호 읍');
  expect(lv?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
  const [pts, need, cost] = [fmt(first.points), fmt(l5.points), fmt(l5.cost + 500)];
  expect(lv?.querySelector('.tb__sub')?.textContent).toBe(`일 ${pts} / ${need} · 기금 3,200 / ${cost}`);
  expect(lv?.getAttribute('aria-label')).toBe(`Lv.4 산호 읍 · 일 ${pts} / ${need} · 기금 3,200 / ${cost}`); // 막대 값이 이름에 안 섞이게
  expect(lv?.title).toBe(
    `다음 Lv.5 산호 읍 · 마을 전체 일 점수 ${pts} / ${need} · 기금 3,200 / ${cost} (공사비 ${fmt(l5.cost)} + 그날 팀장 토큰값 500) · 경제 패널 열기`,
  );
  r.unmount();
  s.level = 10;
  const r2 = render(h(MainScreen, props));
  expect(r2.div.querySelector('.tb__level .tb__sub')?.textContent).toBe('최고 레벨');
  expect(r2.div.querySelector('.tb__level [role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  r2.unmount();
});

test('성격 (M8, 01 문서 7·9장): 카드 MBTI = member.personality, 성격 토스트는 자동으로 사라지고, 활동 기록 성격 필터', () => {
  vi.useFakeTimers();
  const s = golden();
  const now = s.clock.now;
  vi.setSystemTime(now);
  const be = s.members['backend-dev'];
  const fe = s.members['frontend-dev'];
  if (!be || !fe) throw new Error('골든 팀원 없음');
  be.personality = { ...be.personality, TF: 57, letters: 'ISFJ', drifting: null }; // T → F로 바뀜 (55를 넘음)
  fe.personality = { ...fe.personality, JP: 62, drifting: { axis: 'JP', toward: 'J', percent: 20 } };
  const text = 'backend-dev 성격이 T → F로 바뀜 · 보고에 칭찬·고마움 말이 늘어서'; // core 7장 형식
  s.toasts = [{ id: 'p1', at: now, kind: 'personality', text, sticky: false }];
  s.feed = [...s.feed.filter((f) => f.kind !== 'personality'), { at: now, kind: 'personality', text }];

  const props = { state: s, projects: [], currentProjectId: s.project, onProjectChange: () => {}, village: null };
  const r = render(h(MainScreen, props));
  // 팀원 카드: 글자는 성격에서 (직업 mbtiSeed 아님), 바뀌는 중인 글자만 라벤더 + 이름에 "P가 J 쪽으로 20%"
  const chip = (id: string) => r.div.querySelector(`.tp-card[data-member="${id}"] .ui-chip--mbti`);
  expect(chip('backend-dev')?.textContent).toBe('ISFJ');
  expect(chip('backend-dev')?.getAttribute('aria-label')).toBe('성격 ISFJ');
  expect(chip('backend-dev')?.querySelector('.ui-mbti-drift')).toBeNull();
  expect(chip('frontend-dev')?.getAttribute('aria-label')).toBe('성격 ENFP, P가 J 쪽으로 20%');
  expect(texts(chip('frontend-dev') ?? r.div, '.ui-mbti-drift')).toEqual(['P']);

  // 토스트: 성격 아이콘 + 라벤더 타일, 자동 (막대가 줄고 5초 뒤 사라짐)
  const toast = r.div.querySelector('.ts .ui-toast');
  expect(toast?.querySelector('.ui-toast__title')?.textContent).toBe('backend-dev 성격이 T → F로 바뀜');
  expect(toast?.querySelector('.ui-toast__desc')?.textContent).toBe('보고에 칭찬·고마움 말이 늘어서');
  expect(toast?.querySelector('.ui-toast__tile [data-icon="personality"]')).not.toBeNull();
  expect(toast?.querySelector('.ui-toast__tile')?.getAttribute('style')).toContain('--slot5-tint');
  expect(toast?.querySelector('.ui-toast__bar')).not.toBeNull();
  // 읽기 알림 (M8 리뷰, 01 8.7과 같은 규칙): live region은 늘 있는 스택, 토스트는 그 안에 들어갈 뿐 (실패만 alert)
  const ts = r.div.querySelector('.ts');
  expect(ts?.getAttribute('role')).toBe('status');
  expect(toast?.getAttribute('role')).toBeNull();
  act(() => vi.advanceTimersByTime(AUTO_MS));
  expect(r.div.querySelector('.ts .ui-toast')).toBeNull();
  expect(r.div.querySelector('.ts')).toBe(ts); // 비어도 남는다 — 다음 토스트의 첫 알림이 읽히게

  // 활동 기록 '성격' 필터 → 성격 줄만
  const chipBtn = [...r.div.querySelectorAll('.af button')].find((b) => b.textContent === '성격');
  click(chipBtn);
  const rows = [...r.div.querySelectorAll('.af__row')];
  expect(rows.map((e) => e.getAttribute('data-kind'))).toEqual(['personality']);
  expect(rows[0]?.querySelector('.af__text')?.textContent).toBe(text);
  expect(rows[0]?.querySelector('[data-icon="personality"]')).not.toBeNull();
  r.unmount();
  vi.useRealTimers();
});

test('알림 목록 (M9, 01 문서 8.1): 열면 모두 읽음(뱃지 0·토스트 닫힘), 새 것부터 20개, Esc·바깥 누르기로 닫힘', () => {
  const s = liveMeeting(golden()); // toast1 회의, toast2 실패 (둘 다 직접 닫는 것)
  for (let i = 0; i < RECENT_NOTIFICATIONS; i++)
    s.toasts.push({
      id: `n${i}`,
      at: s.clock.now - 60_000 + i,
      kind: 'complete',
      text: `건물 ${i} 완공`,
      sticky: false,
    });
  const r = render(
    h(MainScreen, { state: s, projects: [], currentProjectId: s.project, onProjectChange: () => {}, village: null }),
  );
  const bell = r.div.querySelector<HTMLButtonElement>('.tb__notif button');
  expect([bell?.getAttribute('aria-label'), bell?.getAttribute('aria-expanded')]).toEqual(['알림 2개', 'false']);
  expect(r.div.querySelectorAll('.ts .ui-toast')).toHaveLength(2);
  click(bell);
  expect([bell?.getAttribute('aria-label'), bell?.getAttribute('aria-expanded')]).toEqual(['알림 0개', 'true']);
  expect(r.div.querySelector('.ts .ui-toast')).toBeNull(); // 모두 읽음
  const items = texts(r.div, '.tb__notif-list .tb__notif-text');
  expect(items).toHaveLength(RECENT_NOTIFICATIONS);
  expect(items[0]).toBe(`건물 ${RECENT_NOTIFICATIONS - 1} 완공`); // 새 것부터, 옛 회의·실패는 20개 밖
  expect(r.div.querySelector(`#${CSS.escape(bell?.getAttribute('aria-controls') ?? '')}`)).not.toBeNull();
  act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect([bell?.getAttribute('aria-expanded'), document.activeElement]).toEqual(['false', bell]);
  click(bell);
  act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(r.div.querySelector('.tb__notif-box')).toBeNull();
  // 목록 칸은 스크롤되니 Tab으로 들어갈 수 있고, 포커스가 밖으로 나가면 닫힌다 (M9 리뷰)
  click(bell);
  expect(r.div.querySelector('.tb__notif-box')?.getAttribute('tabindex')).toBe('0');
  act(() => r.div.querySelector<HTMLElement>('.tb__notif-box')?.focus());
  expect(r.div.querySelector('.tb__notif-box')).not.toBeNull();
  act(() => r.div.querySelector<HTMLButtonElement>('.tb__chip')?.focus());
  expect(r.div.querySelector('.tb__notif-box')).toBeNull();
  r.unmount();
});

test('회의 안건 글자 끄기 (M9, 01 문서 10장): 토스트·활동 기록·알림 목록·팀원 카드에서 프롬프트가 빠진다', () => {
  const s = golden();
  Object.assign(s.members['frontend-dev'] ?? {}, { status: 'meeting' });
  liveMeeting(s, '비밀 프롬프트');
  const screen = () =>
    h(MainScreen, { state: s, projects: [], currentProjectId: s.project, onProjectChange: () => {}, village: null });
  const r = render(screen());
  const all = () => r.div.textContent ?? '';
  expect(all()).toContain('로그인 개선 작업 진행해줘');
  expect(all()).toContain('비밀 프롬프트');
  act(() => setPrefs({ speech: false }));
  expect(all()).not.toContain('로그인 개선 작업 진행해줘');
  expect(all()).not.toContain('비밀 프롬프트');
  expect(texts(r.div, '.af__text')).toContain('광장 회의 시작');
  expect(texts(r.div, '.ts .ui-toast__title')).toContain('광장 회의 시작');
  click(r.div.querySelector('.tb__notif button'));
  expect(texts(r.div, '.tb__notif-text')).toContain('광장 회의 시작');
  expect(r.div.querySelector('[data-member="frontend-dev"] .tp-card__task-text')?.textContent).toBe('회의 중');
  act(() => setPrefs({ speech: true }));
  expect(all()).toContain('비밀 프롬프트');
  r.unmount();
});

test('마을/격자 토글 (M9, 01 문서 8.3): 토글 하나가 두 보기에 남고, 격자는 마을·활동 기록을 가린다', () => {
  const s = golden();
  const onModeChange = vi.fn();
  const props = { state: s, projects: [], currentProjectId: s.project, onProjectChange: () => {}, village: null };
  const grid = h('section', { className: 'gs' }, '격자 내용');
  const r = render(h(MainScreen, { ...props, onModeChange, grid }));
  const opts = () => [...r.div.querySelectorAll('.ms__mode .ui-toggle__opt')];
  expect(opts().map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
    ['마을', 'true'],
    ['격자', 'false'],
  ]);
  expect([r.div.querySelector('.ms__grid'), r.div.querySelector('.ms__hint')]).toEqual([null, null]);
  click(opts()[1]);
  expect(onModeChange).toHaveBeenCalledWith('grid');
  const toggle = r.div.querySelector('.ms__mode');
  act(() => r.root.render(h(MainScreen, { ...props, onModeChange, grid, mode: 'grid' })));
  expect(r.div.querySelector('.ms')?.classList.contains('ms--grid')).toBe(true);
  expect(r.div.querySelector('.ms__grid')?.textContent).toBe('격자 내용');
  expect(r.div.querySelector('.ms__hint')?.textContent).toContain('카드를 누르면 상세');
  expect(r.div.querySelector('.ms__mode')).toBe(toggle); // 같은 토글 (포커스가 남는다)
  // 마을이 없으면(onModeChange 없음) 토글도 없다
  act(() => r.root.render(h(MainScreen, props)));
  expect(r.div.querySelector('.ms__mode')).toBeNull();
  r.unmount();
});

test('직접 닫는 토스트도 상태가 끝나면 내린다: 끝난 회의, 풀린 막힘, 다시 막히면 새 것만 (01 문서 9장, M9 QA)', () => {
  const s = liveMeeting(golden());
  const ids = (now = s.clock.now) => pendingToasts(s, new Set(), now).map((x) => x.id);
  expect(ids()).toEqual(['toast2', 'toast1']);
  expect(ids(s.clock.now + 2e12)).toEqual(['toast2']); // 회의 until이 지남
  s.meeting = null;
  expect(ids()).toEqual(['toast2']);
  Object.assign(s.members['backend-dev'] ?? {}, { blocked: null }); // 막힘이 풀림
  expect(ids()).toEqual([]);
  // 다시 막힘 → 새 실패 토스트만 (옛것은 계속 내림)
  Object.assign(s.members['backend-dev'] ?? {}, { blocked: 'failures' });
  s.toasts.push({
    id: 'toast9',
    at: s.clock.now,
    kind: 'failure',
    text: 'backend-dev 막힘 · 연속 실패',
    sticky: true,
    ref: 'backend-dev',
  });
  expect(ids()).toEqual(['toast9']);
});

test('입주 전 팀원 카드 (01 문서 3.3): 흐리게, "아직 일하지 않았어요", 작업 줄 없음', () => {
  const s = golden();
  Object.assign(s.members['frontend-dev'] ?? {}, { movedInAt: null, balance: 0 });
  const r = render(h(TeamPanel, { state: s }));
  const card = r.div.querySelector('[data-member="frontend-dev"]');
  expect(card?.classList.contains('tp-card--departed')).toBe(true);
  expect(card?.textContent).toContain('아직 일하지 않았어요');
  expect(card?.querySelector('.tp-card__task')).toBeNull();
  r.unmount();
});

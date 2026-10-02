// 메인 '/' (M5): 수집기 마을 목록 → ?project= 또는 가장 최근 마을 → SSE 실시간 상태 → MainScreen + LiveVillage.
// 카드 누르기 ↔ 캐릭터 강조는 같은 selectedId 하나 (01 문서 8.2).
// 상세 = 같은 페이지 `?project=<id>` + `&building=`(M6) · `&house=` · `&shop=` · `&economy`(M7) · `&settings`(M9) 하나 — 라우터 없이, 새로고침·링크로 바로 열림 (01 문서 8.2 화면 메모).
// 격자 보기 = `&grid` (M9, 01 문서 8.3). 상세를 열어도 남는다
// 신문 = `&news[=YYYY-MM-DD]` (M18, 06 문서 9장), 설명서 = `&guide[=<장 id>]` (M17, 06 문서 11장)
import { useEffect, useMemo, useState } from 'react';
import { fetchProjects, RETRY_MS, useVillage, type ProjectInfo } from '../live/api';
import { memberViews } from '../live/movement';
import { t } from '../i18n';
import { Camera } from '../world/Camera';
import { liveWorld, LiveVillage } from '../world/LiveVillage';
import { BuildingScreen } from './building/BuildingScreen';
import { EconomyScreen } from './economy/EconomyScreen';
import { GridScreen } from './grid/GridScreen';
import { GuideScreen } from './guide/GuideScreen';
import { HouseScreen } from './house/HouseScreen';
import { MainScreen } from './MainScreen';
import { NewsScreen } from './news/NewsScreen';
import { HookGuide } from './settings/HookGuide';
import { SettingsScreen } from './settings/SettingsScreen';
import { ShopScreen } from './shop/ShopScreen';

const SCREENS = ['building', 'house', 'shop', 'economy', 'settings', 'news', 'guide'] as const;
type View = { screen: (typeof SCREENS)[number]; id: string } | null;

const sameList = (a: ProjectInfo[] | null, b: ProjectInfo[]) => JSON.stringify(a) === JSON.stringify(b);
const param = (k: string) => new URLSearchParams(location.search).get(k);
/** 주소의 상세 하나 (앞 것이 이긴다). `&economy`는 값 없이 */
const viewOf = (): View => {
  const q = new URLSearchParams(location.search);
  for (const screen of SCREENS) {
    const id = q.get(screen);
    if (id !== null) return { screen, id };
  }
  return null;
};
const gridOf = () => new URLSearchParams(location.search).has('grid');
export const href = (project: string, v: View = null, grid = false) =>
  `?project=${encodeURIComponent(project)}${grid ? '&grid' : ''}${v ? `&${v.screen}${v.id ? `=${encodeURIComponent(v.id)}` : ''}` : ''}`;

export function LiveApp() {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [down, setDown] = useState(false);
  const [pick, setPick] = useState(() => param('project'));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState(viewOf);
  const [grid, setGrid] = useState(gridOf);

  // 브라우저 뒤로/앞으로: 주소의 마을·상세·보기 모두 다시 읽는다 (건물·팀원 id는 마을마다 따로라 마을이 먼저)
  useEffect(() => {
    const sync = () => {
      setPick(param('project'));
      setView(viewOf());
      setGrid(gridOf());
    };
    addEventListener('popstate', sync);
    return () => removeEventListener('popstate', sync);
  }, []);

  // 마을 목록: 새 마을이 생기면 고르기·빈 화면이 바로 바뀌게 RETRY_MS마다.
  // ponytail: useVillage도 같은 주기로 /api/projects를 부른다(생존 확인). 요청이 문제되면 하나로 합친다
  useEffect(() => {
    const load = () =>
      fetchProjects().then(
        (p) => {
          setProjects((old) => (sameList(old, p) ? old : p));
          setDown(false);
        },
        () => setDown(true),
      );
    void load();
    const timer = setInterval(() => void load(), RETRY_MS);
    return () => clearInterval(timer);
  }, []);

  // ?project=·드롭다운으로 고른 마을. 없거나 목록에 없으면(옛 북마크, DB 초기화) 가장 최근 마을.
  // 목록을 받기 전에는 ?project=를 믿는다 (첫 화면을 빨리)
  const known = pick !== null && (!projects || projects.some((p) => p.id === pick));
  const projectId = known ? pick : (projects?.[0]?.id ?? null);
  // 저절로 고른 마을도 한 번 정하면 고정 — 목록은 최근 순이라 다른 마을에 이벤트가 오면 맨 앞이 바뀐다.
  // 주소에도 적는다(기록은 그대로): 닫기의 "바로 앞 기록" 비교와 뒤로 가기가 이 마을을 가리키게 (01 문서 8.2 M9 리뷰)
  useEffect(() => {
    if (projectId === null || projectId === pick) return;
    setPick(projectId);
    setView(null); // 다른 마을의 상세였다
    history.replaceState(history.state, '', href(projectId, null, gridOf()));
  }, [projectId, pick]);
  useEffect(() => setSelectedId(null), [projectId]); // 다른 마을의 팀원이었다
  const { state, cfg, connected } = useVillage(projectId);

  // 팀원 카드 상태는 마을과 같은 규칙·같은 시계로. 회의가 다음 이벤트 없이 끝나면 그 순간(meeting.until) 한 번 더
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const wait = (state?.meeting?.until ?? 0) - Date.now();
    if (!(wait > 0 && wait < 2 ** 31)) return;
    const id = setTimeout(() => setTick((n) => n + 1), wait + 50); // 50: 타이머가 Date.now보다 살짝 빨리 깨도
    return () => clearTimeout(id);
  }, [state]);
  const views = useMemo(() => (state ? memberViews(state, cfg, Date.now()) : undefined), [state, cfg, tick]);

  /** 마을 바꾸기 (01 문서 8.2 화면 메모 M9): 새 기록 → 뒤로가 앞 마을. 상세는 닫고 보기(격자)는 그대로 */
  const change = (id: string) => {
    setPick(id);
    setView(null);
    history.pushState({ from: location.search }, '', href(id, null, grid));
  };
  /** 화면 옮기기. 바로 앞 기록이 가려는 주소면 뒤로 (닫은 뒤 뒤로가 상세를 다시 열지 않게·기록이 쌓이지 않게, popstate가 바꾼다).
   *  아니면 새 기록 — 링크·새로고침으로 연 상세를 닫을 때도 */
  const go = (v: View) => {
    if (projectId === null) return;
    const to = href(projectId, v, grid);
    if ((history.state as { from?: string } | null)?.from === to) return history.back();
    history.pushState({ from: location.search }, '', to);
    setView(v);
  };
  const back = () => go(null);
  /** 마을 건물 누르기 (LiveVillage 장면 id): 작업 건물 → 건물 상세, 집 → 그 팀원 집, 시청 → 경제. 시설은 아직 없음 */
  const openBuilding = (sceneId: string) => {
    const [kind = '', id = ''] = sceneId.split(/:(.*)/);
    if (kind === 'work') go({ screen: 'building', id });
    else if (kind === 'house') go({ screen: 'house', id });
    else if (kind === 'hall') economy(); // 시청 금고 = 마을 기금 (06 문서 6.4)
  };
  /** 팀원 카드 = 강조 + 그 팀원 집 (01 문서 8.2) */
  const openMember = (id: string) => {
    setSelectedId(id);
    go({ screen: 'house', id });
  };
  const navigate = (to: { screen: 'shop' | 'house'; memberId: string }) => go({ screen: to.screen, id: to.memberId });
  const economy = () => go({ screen: 'economy', id: '' });
  const settings = () => go({ screen: 'settings', id: '' });
  /** 신문: 날짜 없으면 신문 화면이 오늘(이 컴퓨터 날짜)을 고른다. 날짜를 바꾸면 신문 화면이 onDate로 */
  const news = (date = '') => go({ screen: 'news', id: date });
  /** 설명서: 장 id 없으면 목차 맨 위 */
  const guide = (section = '') => go({ screen: 'guide', id: section });
  /** 마을/격자: 기록을 쌓지 않는다 (앞뒤 기록의 from은 그대로) */
  const setMode = (m: 'village' | 'grid') => {
    if (projectId === null) return;
    history.replaceState(history.state, '', href(projectId, view, m === 'grid'));
    setGrid(m === 'grid');
  };
  const project = projects?.find((p) => p.id === projectId);

  const empty = projects?.length === 0;
  const common = state && projectId !== null && { state, cfg, projectId, onBack: back };
  const detail =
    common &&
    view &&
    (view.screen === 'building' ? (
      <BuildingScreen {...common} buildingId={view.id} />
    ) : view.screen === 'house' ? (
      <HouseScreen {...common} memberId={view.id} onNavigate={navigate} />
    ) : view.screen === 'shop' ? (
      // 사는 팀원은 상점 안에서 바뀐다 → 주소의 팀원이 바뀌면 새로
      <ShopScreen key={view.id} {...common} memberId={view.id} onNavigate={navigate} />
    ) : view.screen === 'settings' ? (
      <SettingsScreen {...common} cwd={project?.cwd ?? ''} connected={connected && !down} onGuide={() => guide()} />
    ) : view.screen === 'news' ? (
      <NewsScreen {...common} date={view.id} onDate={(d) => news(d)} />
    ) : view.screen === 'guide' ? (
      <GuideScreen {...common} section={view.id} onSection={(id) => guide(id)} />
    ) : (
      <EconomyScreen {...common} />
    ));
  return (
    <MainScreen
      state={state}
      projects={projects ?? []}
      currentProjectId={projectId}
      onProjectChange={change}
      selectedId={selectedId}
      onSelect={openMember}
      onEconomy={economy}
      onSettings={projectId === null ? undefined : settings}
      onNews={projectId === null ? undefined : () => news()}
      onGuide={projectId === null ? undefined : () => guide()}
      views={views}
      cfg={cfg}
      detail={detail}
      detailKey={view ? `${view.screen}:${view.id}` : undefined}
      mode={grid ? 'grid' : 'village'}
      onModeChange={projectId === null ? undefined : setMode}
      grid={
        state &&
        projectId !== null && (
          <GridScreen
            state={state}
            cfg={cfg}
            views={views}
            hrefOf={(v) => href(projectId, v, true)}
            onOpen={(v) => go(v)}
          />
        )
      }
      village={
        <>
          <Camera worldW={liveWorld(state).w} worldH={liveWorld(state).h}>
            {state && (
              <LiveVillage
                state={state}
                cfg={cfg}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onBuildingClick={openBuilding}
              />
            )}
          </Camera>
          {empty && (
            <div className="ms__empty ui-card" role="status">
              <h2>{t('ui.empty')}</h2>
              <HookGuide connected={!down} />
            </div>
          )}
        </>
      }
      offline={down || Boolean(state && !connected)}
    />
  );
}

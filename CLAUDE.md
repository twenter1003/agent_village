# 서브에이전트 타이쿤

Claude Code 서브에이전트 팀의 활동을 동물 마을로 보여 주는 로컬 방치형 모니터링 웹앱.

## 먼저 읽을 것

0. `docs/HANDOFF.md` — **인수인계. 새 세션은 여기서 시작한다** (현재 상태, 다음 할 일, 사용자 결정, 작업 방식, 환경 주의).
1. `docs/04-작업계획.md` — 마일스톤 체크리스트와 완료 기준, 작업 기록(모든 결정의 근거).
2. `docs/01-기획서.md` — 게임 규칙 (무엇을 만드는지)
3. `docs/02-구현설계서.md` — 구조, 데이터, 렌더링 (어떻게 만드는지)
4. `docs/03-디자인-핸드오프.md` — 에셋·컴포넌트 규격과 추출 방법
5. `docs/05-바다-테마.md` — 바다 테마 규격. **바다만 만든다(01 문서 D7)** — 에셋·토큰·리그·이름은 이 문서가 기준, 테마 팩·전환은 만들지 않는다.
6. `docs/06-도시와-경제.md` — 도시 성장(팀원별 일터·층·마을 레벨)과 경제(진주 = 토큰값을 했는가, 팀장 = 시장), 신문·날씨·설명서·캐릭터 누르기. **M12~M20의 기준** (D18~D29).

정본 데이터: `design/tokens.css`(색·선·글꼴), `design/rig.json`(캐릭터 포즈), `design/game.default.json`(게임 수치). 바다 테마는 `design/tokens-sea.css`, `design/rig.sea.json`, `design/theme-map.sea.json`. 디자인 원본: `design/canvas/*.dc.html` (Claude Design 템플릿 — 그대로 쓰지 말고 SVG와 값만 뽑는다).

## 반드시 지킬 것

- Claude Code를 느리게 하거나 막는 코드는 넣지 않는다. 훅은 비동기·짧은 제한시간·실패 무시, 수집기는 판단을 돌려주지 않는다.
- 색·선 굵기·글꼴은 `design/tokens.css` 값만 쓴다. 새 값이 필요하면 토큰을 먼저 추가하고 03 문서에 이유를 적는다.
- 에셋은 `data-asset-id`, `data-anchor`, `data-pivot`, `data-part`를 유지한다. 캐릭터 파츠는 `id`가 아니라 `data-part`로 찾는다.
- 에셋을 배율 s로 넣으면 선 굵기를 `3 / s`로 보정한다. 마을 전체 줌은 보정하지 않는다.
- 캐릭터 포즈는 파츠의 이동·회전만. 크기 변경 금지. 표정과 소품 칸은 켜고 끄기만.
- 캐릭터 몸 표면에 작은 점 무리를 그리지 않는다. 무늬는 큰 점 3개 이하, 재질 결은 선으로 (03 문서 2장).
- 게임 상태에는 테마를 섞지 않는다. 상태·규칙·테스트는 잔디 id만 쓰고, 화면 글자는 이름 사전에서 꺼낸다 (05 문서 3장).
- 완공된 건물은 어떤 경우에도 지우지 않는다.
- 프로젝터(상태 계산)는 순수 함수. `Date.now()`와 `Math.random()` 직접 호출 금지 — 이벤트 시각과 seed 난수만.
- 원본 이벤트(`raw_events`)는 지우지 않는다. 규칙을 바꾸면 재생으로 상태를 다시 만든다.
- 도구 입력·출력 원문은 저장하지 않는다 (02 문서 2.3).
- 사용자 프로젝트에는 관여하지 않는다. 마을에 필요한 훅(나만 쓰는 `.claude/settings.local.json`) 말고는 쓰지 않고, 그 사람이 만든 에이전트는 읽기만 한다 — 에이전트를 만들어 넣거나 설정·git을 고치지 않는다. 타이쿤의 파일(마을 설정 등)은 타이쿤 저장 공간(`~/.subagent-tycoon/`)에만 둔다 (02 문서 1장 "설치 도구", 01 문서 D14).

## 작업 방식

- 마일스톤 순서대로. 끝날 때마다 `docs/04-작업계획.md`에 체크하고 작업 기록 표에 한 줄.
- 문서와 다르게 구현해야 하면, 코드를 바꾸기 전에 해당 문서에 결정과 이유를 먼저 적는다 (특히 01 문서 11장 결정 목록).
- Claude Code 훅의 이벤트·필드 이름은 버전마다 다를 수 있다. 정규화 코드를 쓰기 전에 설치된 버전 문서를 확인하고, 실제 세션을 녹화해 `fixtures/`에 추가한다.
- UI는 캔버스 보드와 나란히 놓고 비교한다 (`/dev/gallery`, `/dev/characters`).

## 명령


```
pnpm dev      # 수집기 :4777 + 웹 :5173 (메인 `/`, 개발 화면 /dev/gallery·characters·village·ui·icons)
              # 메인 주소: `/?project=<id>` 마을 + 상세 하나: `&building=<bid>` 건물, `&house=<memberId>` 집,
              #   `&shop=<memberId>` 가구 상점, `&economy` 경제 패널. /dev/village?live=build = 일터 하나가 예정 부지 → 1층 → … → 큰 건물로 오르는 재생, ?live=capital = Lv.10 수도 80×80 (성능)
              # 웹 프록시 대상은 TYCOON_COLLECTOR (기본 http://127.0.0.1:4777)
              # 게임 하루 = 에이전트가 일한 시간(활동 시간), 마을 설정 ~/.subagent-tycoon/settings/<id>.json overrides.time.gameDayMs (01 문서 6.2·D14).
              #   일하는 마을엔 수집기가 TYCOON_CLOCK_MS(기본 10000)마다 시계 줄을 넣는다
pnpm test
tools/stable.sh sync|start|stop|restart|status
              # 보는 용 복사본 (~/.subagent-tycoon/app, 수집기 4777·웹 5173). 사용자가 보는 화면은 이것.
              # 저장소에서 pnpm dev를 켜지 않는다 (포트 충돌, 고치는 중 코드로 화면이 깨짐 — 2026-09-30).
              # 개발 확인은 e2e 포트(4798·5174)와 pnpm replay로. 마일스톤이 test·lint·e2e·검토를 통과하면 sync → restart
pnpm lint
pnpm e2e      # Playwright: 수집기 :4798(임시 DB, TYCOON_CLOCK_MS 250) + 웹 :5174 자동 기동, 파일 하나씩(workers 1). SHOTS=<폴더>면 화면 스냅샷
pnpm tokens   # design 토큰 → packages/web/src/tokens.ts
pnpm replay <project-id|cwd|file.jsonl>   # 재생 → 상태 JSON
```

# 서브에이전트 타이쿤

Claude Code 서브에이전트 팀이 일하는 모습을 바닷속 동물 마을로 보여 주는 로컬 모니터링 웹앱.

![팀원들이 일하는 바닷속 마을](docs/images/village.png)

| 마을 레벨 10 해저 수도 | 캐릭터 포즈 |
|---|---|
| ![해저 수도](docs/images/capital.png) | ![캐릭터 시트](docs/images/characters.png) |

## 개발 배경

Claude Code에서 서브에이전트 여러 명에게 일을 나눠 맡기면, 터미널 로그만으로는 지금 누가 일하고 누가 막혔는지, 팀장이 일을 잘 나눠 주는지, 토큰값을 했는지 알기 어렵다. 그래서 이걸 옆 창에 띄워 두고 한눈에 보는 마을로 만들었다. 에이전트는 동물 팀원이 되고, 일한 만큼 일터가 층을 올리고, 토큰을 아끼면 진주가 남는다.

## 프로젝트에 적용하기

Node 22.13+, pnpm 9 필요.

```bash
git clone https://github.com/twenter1003/agent_village.git
cd agent_village
pnpm install
```

훅을 연결한다. 둘 중 하나를 고른다.

```bash
pnpm connect --global
```

```bash
pnpm connect ~/code/my-app
```

- `--global`: 모든 Claude Code 세션이 마을이 된다 (`~/.claude/settings.json`에 훅 추가, 백업 남김).
- 경로 지정: 그 프로젝트만 (`.claude/settings.local.json`에 훅 추가). 프로젝트의 다른 파일은 건드리지 않는다.

켜기:

```bash
pnpm dev
```

`http://localhost:5173`을 열고 그 프로젝트에서 Claude Code를 **새로** 시작하면 마을이 생긴다. 그 프로젝트의 `.claude/agents/*.md` 에이전트가 팀원이 된다.

**[📖 사용 설명서 PDF](docs/guide.pdf)** — 프로젝트 의의, 게임 규칙(주민·경제·마을 성장·성격·날씨·신문), 화면 구성, 기능 설명, 용어 사전까지 타이쿤의 모든 것. 원본은 `docs/guide/src/*.html`이고 `pnpm guide`로 다시 만든다.

앱 안에서도 상단 바 **?** 버튼으로 설명서를 연다 (규칙 숫자를 지금 설정에서 꺼내 늘 최신). 상단 바의 날씨 아이콘은 팀 상태(막힘·실패·테스트 통과), 신문 버튼은 날짜별로 끝낸 일을 정리한 마을 신문이다.

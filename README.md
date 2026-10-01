# 서브에이전트 타이쿤

Claude Code 서브에이전트 팀이 일하는 모습을 바닷속 동물 마을로 보여 주는 로컬 모니터링 웹앱. 누가 일하고 누가 막혔는지, 토큰값을 했는지 마을만 보고 안다.

![바닷속 마을](docs/images/village.png)

## 시작하기

Node 22.13+, pnpm 9 필요.

```bash
git clone https://github.com/twenter1003/agent_village.git
cd agent_village
pnpm install
pnpm connect --global
pnpm dev
```

`http://localhost:5173`을 열고 Claude Code를 새로 시작하면 마을이 생긴다.

## 설명서

**[📖 사용 설명서 (PDF)](docs/guide.pdf)** — 만든 이유, 연결 방법, 게임 규칙, 화면, 환경 변수, 문제 해결.

개발 규칙은 `CLAUDE.md`, 현재 상태는 `docs/HANDOFF.md`.

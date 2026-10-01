#!/bin/sh
# 보는 용 복사본: 검증을 마친 버전만 ~/.subagent-tycoon/app 에서 수집기 4777·웹 5173으로 돌린다.
# 개발(저장소)은 코드가 바뀌면 다시 켜져 화면이 깨질 수 있어서 다른 포트(e2e 4798·5174)만 쓴다.
#   tools/stable.sh sync [원본 폴더]   원본(기본: 이 저장소)을 복사하고 설치 (마일스톤이 테스트·검토를 통과한 뒤에만)
#   tools/stable.sh start | stop | restart | status
set -e
APP="${TYCOON_APP:-$HOME/.subagent-tycoon/app}"
SRC="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
case "$1" in
  sync)
    mkdir -p "$APP"
    rsync -a --delete --exclude node_modules --exclude dist --exclude test-results --exclude playwright-report \
      --exclude /logs --exclude /.claude --exclude /.superpowers "$SRC/" "$APP/"
    (cd "$APP" && pnpm install --offline --frozen-lockfile --silent) ;;
  start)
    mkdir -p "$APP/logs"
    cd "$APP"
    nohup pnpm --filter @tycoon/server exec tsx src/index.ts >logs/server.log 2>&1 &
    nohup pnpm --filter @tycoon/web exec vite --port 5173 --strictPort >logs/web.log 2>&1 & ;;
  stop) pkill -f "$APP/node_modules/" || true ;;
  restart) "$0" stop && sleep 1 && "$0" start ;;
  status) curl -s -m 2 http://127.0.0.1:4777/health && echo " 수집기" ; pgrep -fl "$APP/" || echo "꺼짐" ;;
  *) echo "쓰기: $0 sync [원본] | start | stop | restart | status" >&2; exit 1 ;;
esac

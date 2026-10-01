// 실제 Claude Code 세션 기록 (2026-09-30, 이 프로젝트에 훅을 달고 Claude Code 데스크톱에서 일한 요약본, 서브에이전트 최종 메시지는 뺌).
// 합성 픽스처가 못 잡은 것들: 작업 도구(TaskCreate)가 없는 환경, 앱이 넣은 메시지(<agent-message …>), 턴 도중에 단 훅, 기록 파일의 토큰
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { defaultConfig as cfg } from '../config/config';
import { normalize } from '../events/normalize';
import type { Raw } from '../events/summarize';
import { replay } from './project';
import { LEADER_ID } from './types';

const lines = readFileSync(join(import.meta.dirname, '../../../../fixtures/recorded-2026-09-30.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Raw);
const s = replay('recorded', lines.flatMap(normalize), cfg);

test('실제 세션 필드 이름이 정규화와 맞는다: 서브에이전트 3번, Agent 호출 3번, 메인 도구 호출', () => {
  expect(Object.values(s.runs).map((r) => r.agentType)).toEqual(['Explore', 'claude', 'claude']);
  expect(Object.values(s.runs).every((r) => r.endedAt !== null)).toBe(true);
  expect(Object.values(s.runs).every((r) => (r.tokens ?? 0) > 0)).toBe(true); // 기록 파일에서 읽은 토큰
});

test('턴 도중에 단 훅: 메인 도구 호출로 마을을 세우고 팀장이 일한다, 앱이 넣은 메시지는 회의가 아니다', () => {
  expect(s.foundedAt).not.toBeNull();
  expect(s.members[LEADER_ID]?.movedInAt).not.toBeNull();
  expect(s.feed.some((f) => f.text.startsWith('광장 회의 시작'))).toBe(false);
  expect(s.clock.activeMs).toBeGreaterThan(0);
});

test('md 없는 에이전트(claude)는 팀원, Explore는 외부인 + 탐사 기지, Agent 호출 = 작업, 일한 팀원 = 일터', () => {
  expect(s.members.claude).toMatchObject({ fromMd: false, departed: false });
  expect(s.members.claude?.movedInAt).not.toBeNull();
  expect(s.members.Explore).toBeUndefined();
  expect(Object.keys(s.facilities)).toEqual(['library']);
  expect(s.taskTool).toBe(false);
  const tasks = Object.values(s.tasks);
  expect(tasks.map((t) => t.status)).toEqual(['completed', 'completed', 'completed']);
  expect(tasks.at(-1)?.subject).toBe('Review growth rule code'); // 호출 설명이 제목 (앞 둘은 설명을 남기기 전 기록)
  expect(Object.values(s.buildings).map((b) => [b.id, b.floor, b.points])).toEqual([['w1:claude', 1, 13]]); // 도구 5 + 8번, 자재비 전 (75점)
  // 실행마다 급여 먼저, 그다음 토큰 (D20, 진주 1 = 토큰 1,000): 도구 5·8번 → 130·208 (세금 26·42),
  // 토큰값 115·145 → 첫 실행은 104를 다 내도 모자라 0, 둘째는 166에서 145를 내고 21 (형편이 풀림)
  expect(Object.values(s.runs).map((r) => r.wage)).toEqual([undefined, 130, 208]); // 외부인(Explore)은 급여 없음
  expect(s.members.claude).toMatchObject({ balance: 21, hardship: false });
});

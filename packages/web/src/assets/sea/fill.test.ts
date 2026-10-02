import { expect, test } from 'vitest';
import { assets } from './data';
import { fillAsset } from './fill';

const colors = { roof: '#1', roofL: '#2', roofR: '#3', tint: '#4', fab: '#5', fabL: '#6', fabR: '#7' };

test('선 구멍: 한 자리 = 그대로, 두 자리 = /10, 배율 보정', () => {
  expect(fillAsset('{{w3}} {{w25}} {{cor}}', { k: 2 })).toBe('6 5 12');
});

test('모든 에셋 구멍이 채워진다', () => {
  for (const a of Object.values(assets)) expect(fillAsset(a.inner, { colors })).not.toContain('{{');
});

test('빠진 색은 에러', () => {
  expect(() => fillAsset('{{roof}}')).toThrow('roof');
});

test('05 문서 5.1 에셋 id 전부, data-anchor 유지', () => {
  const ids = Object.keys(assets);
  // + M15 (06 문서 14.1): 3층 2 · 큰 몸통 2 · 시청 4 · 랜드마크 2 · 큰 지붕 3 · 땀방울 1, 직업 장식 5, 공원 1
  expect(ids.filter((i) => /^(body|roof|sign|fx)\./.test(i))).toHaveLength(31);
  expect(ids.filter((i) => i.startsWith('deco.'))).toHaveLength(5);
  expect(ids.filter((i) => i.startsWith('site.'))).toHaveLength(6);
  expect(ids.filter((i) => i.startsWith('furniture.'))).toHaveLength(7);
  expect(ids.filter((i) => i.startsWith('prop.'))).toHaveLength(16);
  expect(ids.filter((i) => i.startsWith('tile.'))).toHaveLength(4);
  for (const a of Object.values(assets)) expect(a.data.anchor).toMatch(/^-?\d+,-?\d+$/); // 땀방울 = 캐릭터 좌표 0,0
});

test('흔들림 구멍: 캔버스 SeaProp 두 장면 — sw 밑동 ±3°, swA 촉수 뿌리 ±4°, 값이 없으면 곧게 (03 문서 3.2)', () => {
  expect(fillAsset('<g transform="{{sw}}"/>', { sway: 0 })).toBe('<g transform="rotate(-3 48 128)"/>');
  expect(fillAsset('<g transform="{{sw}}"/>', { sway: 1 })).toBe('<g transform="rotate(3 48 128)"/>');
  expect(fillAsset('<g transform="{{swA}}"/>', { sway: 2 })).toBe('<g transform="rotate(-4 48 108)"/>'); // 장면 1 + phase 1
  expect(fillAsset('<g transform="{{sw}}"/>')).toBe('<g transform=""/>');
});

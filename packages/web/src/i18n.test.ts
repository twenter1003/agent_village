import { expect, test } from 'vitest';
import { t } from './i18n';

test('바다 이름 사전', () => {
  expect(t('facilities.library')).toBe('탐사 기지');
  expect(t('currency')).toBe('진주');
  expect(t('vault')).toBe('보물상자');
  expect(t('status.restOnRock')).toBe('휴식 · 바위 위');
  expect(t('no.such.key')).toBe('no.such.key');
});

test('자리 채우기 {n}', () => {
  expect(t('level.chip', { n: 4, name: t('eras.town') })).toBe('Lv.4 산호 읍');
  expect(t('topbar.notifications', {})).toBe('알림 {n}개');
});

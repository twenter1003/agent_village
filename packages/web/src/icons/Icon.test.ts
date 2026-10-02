import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, expectTypeOf, test } from 'vitest';
import type { MemberStatus } from '@tycoon/core';
import { ICON_NAMES, Icon, type IconName } from './Icon';

const html = (name: IconName, title?: string) => renderToStaticMarkup(createElement(Icon, { name, title }));

test('바다 아이콘 31종 = Type 17 + SeaUI 8 + chevronDown + move(SeaScreenHouse) + 시대 4 (M15)', () => {
  expect(ICON_NAMES).toHaveLength(31);
});

test.each(ICON_NAMES)('%s: <svg> 한 장, 색은 토큰만', (name) => {
  const s = html(name);
  expect(s).toMatch(/^<svg[^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"/);
  expect(s).toMatch(/<(path|circle|rect)\b/);
  expect(s).not.toMatch(/#[0-9a-f]{3,8}\b/i);
});

test('title이 있으면 이름 붙은 img', () => {
  const s = html('close', '닫기');
  expect(s).toMatch(/role="img"/);
  expect(s).toContain('<title>닫기</title>');
  expect(s).not.toContain('aria-hidden');
});

test('화폐는 --currency 채움 / --currency-d 광택 (03 문서 5장)', () => {
  const s = html('coin');
  expect(s).toContain('fill:var(--currency)');
  expect(s).toContain('stroke:var(--currency-d)');
});

test('상태 id를 그대로 아이콘 이름으로 쓴다', () => {
  expectTypeOf<MemberStatus>().toMatchTypeOf<IconName>();
});

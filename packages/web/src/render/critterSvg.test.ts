// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { applyTick, critterInner, critterVals, DYES, PARTS, variantLook } from './critterSvg';
import { rig, SPECIES } from './rig';

test('모든 종·포즈에서 구멍이 다 채워진다', () => {
  for (const species of SPECIES)
    for (const pose of ['stand', 'walk', 'hammer', 'carry', 'cheer', 'talk', 'rest'] as const)
      expect(critterInner({ species, pose, uid: 'u' })).not.toContain('{{');
});

test('파츠를 data-part로 찾아 틱마다 transform을 바꾼다', () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const o = { species: 'seal' as const, pose: 'walk' as const, uid: 'u' };
  svg.innerHTML = critterInner(o, 0);
  const body = svg.querySelector('[data-part="body"]');
  const before = body?.getAttribute('transform');
  applyTick(svg, o, 2); // 헤엄 rate 2 → 프레임 1
  expect(body?.getAttribute('transform')).not.toBe(before);
  expect(svg.querySelectorAll('[data-part]').length).toBeGreaterThanOrEqual(12);
});

test('햄스터는 소품을 바꿔도 헬멧, 수달 망치는 돌', () => {
  const h = critterInner({ species: 'hamster', accessory: 'captainHat', pose: 'hammer', uid: 'u' });
  expect(h).toMatch(/<g display="inline"><path[^>]*fill="#dcaa48"/); // 헬멧 칼라
  const ot = critterInner({ species: 'otter', pose: 'hammer', uid: 'u' });
  expect(ot).toContain('<g display="inline"><ellipse stroke="#2e4b66" stroke-width="3" fill="#a1acb9"');
});

test('헬멧 공기 호스는 그리지 않는다 (05 문서 S7), 밸브는 남긴다', () => {
  const h = critterInner({ species: 'hamster', uid: 'u' });
  expect(h).not.toContain('M3 -104C10 -114 22 -112 30 -121');
  expect(h).not.toContain('cx="31" cy="-122"');
  expect(h).toContain('y="-106" width="13" height="9.5"');
});

test('부품 라이브러리 (05 문서 6.5): 종의 parts는 모두 템플릿에 있고, 그 종에서만 켜진다', () => {
  expect(PARTS.length).toBeGreaterThanOrEqual(14);
  for (const species of SPECIES) {
    const parts = rig.species[species].parts ?? [];
    for (const p of parts) expect([species, PARTS.includes(p)]).toEqual([species, true]); // 도감 오타
    const v = critterVals({ species, uid: 'u' }, 0);
    expect(PARTS.filter((p) => v[`pt.${p}`] === 'inline').sort()).toEqual([...parts].sort());
  }
  // 원래 네 종은 부품을 안 쓴다 (그림 그대로)
  for (const s of ['seal', 'otter', 'hamster', 'turtle'] as const) expect(rig.species[s].parts).toBeUndefined();
  expect(critterVals({ species: 'gentoo', uid: 'u' }, 0)['c.beak']).toBe('#f29a4a');
});

test('자동 변형 (D16): 1바퀴부터 털 염색 + 무늬(홀수 줄무늬·짝수 눈 무늬), 원래 털과 비슷한 염색은 건너뜀', () => {
  expect(variantLook('seal', 0)).toBeNull();
  const white = critterVals({ species: 'polarbear', uid: 'u', variant: 1 }, 0);
  for (const species of SPECIES)
    for (let v = 1; v <= 8; v++) {
      const look = variantLook(species, v);
      expect(DYES).toContain(look?.dye);
      expect(look?.pattern).toBe(v % 2 ? 'stripes' : 'patch');
      const vals = critterVals({ species, uid: 'u', variant: v }, 0);
      expect(vals['c.fur']).not.toBe(rig.species[species].fur);
      expect(vals['c.fur']).toMatch(/^#[0-9a-f]{6}$/i); // 토큰이 비지 않음 (pnpm tokens)
      expect(vals[`pt.${look?.pattern}`]).toBe('inline');
    }
  expect(white['c.fur']).not.toBe('#f4f5f2'); // 흰 북극곰은 흰 염색을 건너뛴다
  expect(critterInner({ species: 'otter', uid: 'u', variant: 2 })).not.toContain('{{');
});

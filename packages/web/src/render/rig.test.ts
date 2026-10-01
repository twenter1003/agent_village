import { expect, test } from 'vitest';
import { bubble, frameIndex, partTransforms, resolvePose, rig, shadowSize, SPECIES } from './rig';

test('21종 (동물 도감 20 + 복어, 01 문서 D15·D16)', () => {
  expect(SPECIES).toEqual([
    'seal',
    'otter',
    'hamster',
    'turtle',
    'fish',
    'gentoo',
    'polarbear',
    'walrus',
    'sealion',
    'gull',
    'seaotter',
    'clownfish',
    'puffin',
    'dugong',
    'flamingo',
    'harpseal',
    'loggerhead',
    'pelican',
    'elephantseal',
    'emperorchick',
    'iguana',
  ]);
  expect(resolvePose('seal', 'walk')).toBe('swim');
  expect(resolvePose('hamster', 'swim')).toBe('walk');
  expect(SPECIES.filter((s) => resolvePose(s, 'walk') === 'walk')).toEqual([
    'hamster',
    'polarbear',
    'gull',
    'puffin',
    'flamingo',
    'pelican',
    'emperorchick',
    'iguana',
  ]);
  expect(resolvePose('otter', 'hammer')).toBe('hammer');
});

test('바다 포즈가 잔디를 덮고, 없는 포즈는 잔디 것', () => {
  expect(rig.poses.walk.rate).toBe(3);
  expect(rig.poses.carry.prop).toBe('blocks');
  expect(rig.poses.cheer.frames).toHaveLength(2);
});

test('프레임 = floor(tick / rate) % n', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => frameIndex(rig.poses.swim, t))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 0]);
});

test('파츠 transform: 햄스터 얼굴 기본 위치 0,-4', () => {
  const t = partTransforms('hamster', { face: [-3, 0, 0], armR: [0, 0, 70] });
  expect(t.face).toBe('translate(-3 -4) rotate(0 0 -34)');
  expect(t['arm-r']).toBe('translate(0 0) rotate(70 34 -26)');
  expect(partTransforms('otter', {}).tail).toBe('translate(0 0) rotate(0 -30 -12)');
});

test('그림자는 뜨면 작아지고 거품은 수명 안에서 올라간다', () => {
  expect(shadowSize(-12).rx).toBeLessThan(shadowSize(0).rx);
  expect(bubble(0, 5, 0, false).y).toBeLessThan(bubble(0, 1, 0, false).y);
  expect(bubble(0, 0, 0, true).o).toBe(0);
});

test('누르기 포즈 (06 문서 8장): 파츠 이동·회전만 — 크기 변경 없음, 들면 몸·두 발이 같이 떠서 그림자만 땅에 작게', () => {
  for (const name of ['flail', 'held'] as const) {
    const pose = rig.poses[name];
    expect(pose.frames.length).toBeGreaterThanOrEqual(2);
    for (const sp of SPECIES)
      for (const f of pose.frames) {
        for (const v of Object.values(partTransforms(sp, f)))
          expect(v).toMatch(/^translate\(-?[\d.]+ -?[\d.]+\) rotate\(-?[\d.]+ -?[\d.]+ -?[\d.]+\)$/);
        for (const [k, v] of Object.entries(f)) if (k !== 'expr') expect(v, `${name} ${k}`).toHaveLength(3);
      }
  }
  expect(rig.poses.flail.rate).toBe(1); // 빠르게: 한 틱(150ms)마다 프레임
  for (const f of rig.poses.held.frames) {
    const lift = f.body?.[1] ?? 0;
    expect(lift).toBeLessThanOrEqual(-20);
    expect([f.footL?.[1], f.footR?.[1]]).toEqual([lift, lift]);
    expect(shadowSize(lift).rx).toBeLessThan(shadowSize(0).rx);
  }
});

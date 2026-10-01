// 바다 대응표 검사 (05 문서 9장 M11, 01 문서 D7): 상태의 정본(잔디) id가 빠짐없이 바다 id로 가고, 그 바다 에셋이 추출돼 있다.
// 표에 빠진 id가 있으면 그릴 때 "없는 에셋"으로 터지거나 잔디 id 그대로 나간다
import { expect, test } from 'vitest';
import game from '../../../../../design/game.default.json';
import land from '../../../../../design/rig.json';
import sea from '../../../../../design/theme-map.sea.json';
import { SPECIES } from '../../render/rig';
import { assets } from './data';

const missing = (ids: string[]) => ids.filter((id) => !(id in assets));
const presets = [...game.jobPresets, game.fallbackPreset];
const to = (table: Record<string, string>, id: string) => table[id] ?? `(표에 없음 ${id})`;

test('건물: 직업 프리셋의 몸·지붕은 표를 거쳐, 간판은 같은 id로 에셋이 있다', () => {
  expect(
    missing(
      presets.flatMap((p) => [
        `body.${to(sea.body, p.body1f)}`,
        `body.${to(sea.body, p.body2f)}`,
        `roof.${to(sea.roof, p.roof)}`,
        `sign.${p.sign}`,
      ]),
    ),
  ).toEqual([]);
});

test('가구: 방 가구는 furniture 표, 바깥 가구(꽃밭)는 prop 표로', () => {
  expect(
    missing(
      game.furniture.map((f) =>
        'outdoor' in f && f.outdoor ? `prop.${to(sea.prop, f.id)}` : `furniture.${to(sea.furniture, f.id)}`,
      ),
    ),
  ).toEqual([]);
});

test('바닥·소품: 표의 바다 id와 바다 전용 장식이 모두 추출돼 있다', () => {
  expect(missing(Object.values(sea.tile).map((t) => `tile.${t}`))).toEqual([]);
  expect(missing([...Object.values(sea.prop), ...sea.extras.prop].map((p) => `prop.${p}`))).toEqual([]);
});

test('캐릭터: 리그의 종·직업 소품이 모두 바다 종·소품으로 간다', () => {
  expect(Object.keys(land.species).filter((s) => !(SPECIES as string[]).includes(to(sea.species, s)))).toEqual([]);
  const accessories = presets.flatMap((p) => (p.accessory ? [p.accessory] : []));
  expect(accessories.filter((a) => !(a in sea.accessory))).toEqual([]);
  // 이름 사전: 바다 종·소품마다 이름이 있다 (화면 글자)
  expect(Object.values(sea.species).filter((s) => !(s in sea.labels.species))).toEqual([]);
  expect(Object.values(sea.accessory).filter((a) => !(a in sea.labels.accessory))).toEqual([]);
});

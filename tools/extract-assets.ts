// design/canvas/Sea{Building,Prop}.dc.html → packages/web/src/assets/sea/data.ts (03 문서 4장, 바다만)
// 구멍({{…}})은 그대로 두고 런타임 fillAsset()이 채운다.
import { readFileSync, writeFileSync } from 'node:fs';

import type { RawAsset } from '../packages/web/src/assets/sea/types';

export function extractSvgs(html: string): RawAsset[] {
  const out: RawAsset[] = [];
  for (const [, attrs = '', inner = ''] of html.matchAll(
    /<svg\b([^>]*data-asset-id="[^"]+"[^>]*)>([\s\S]*?)<\/svg>/g,
  )) {
    const data: Record<string, string> = {};
    for (const [, k = '', v = ''] of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)) data[k] = v;
    const viewBox = /viewBox="([^"]+)"/.exec(attrs)?.[1] ?? '';
    out.push({ id: data['asset-id'] ?? '', viewBox, data, inner: inner.trim().replace(/\n\s*/g, '') });
  }
  return out;
}

// 캐릭터 한 벌 (SeaCritter). 소품 층의 종 스위치 {{sp.X}}를 소품 스위치 {{acc.Y}}로 바꿔 소품을 갈아 끼울 수 있게 한다.
const ACC_BY_SPECIES: Record<string, string> = {
  seal: 'headlamp',
  otter: 'starfishPin',
  hamster: 'seaWalkHelmet',
  turtle: 'captainHat',
  fish: 'cap',
};
export function extractCritter(html: string): string {
  const inner = /<svg\b[^>]*data-face-box[^>]*>([\s\S]*?)<\/svg>/.exec(html)?.[1] ?? '';
  const a = inner.indexOf('data-part="accessory"');
  const b = inner.indexOf('data-part="carry"');
  if (a < 0 || b < 0) throw new Error('SeaCritter: accessory/carry 파츠를 못 찾음');
  const acc = inner.slice(a, b).replace(/\{\{sp\.(\w+)\}\}/g, (_, sp: string) => `{{acc.${ACC_BY_SPECIES[sp] ?? sp}}}`);
  // 헬멧 공기 호스와 호스 끝 연결구는 그리지 않는다 (05 문서 결정 S7). 밸브는 남긴다.
  const HOSE = [
    /<path[^>]*d="M3 -104C10 -114 22 -112 30 -121"[^>]*><\/path>/g,
    /<circle[^>]*cx="31" cy="-122"[^>]*><\/circle>/g,
  ];
  let out = inner.slice(0, a) + acc + inner.slice(b);
  for (const re of HOSE) {
    if (!re.test(out)) throw new Error(`SeaCritter: 헬멧 호스 모양이 바뀜 (${re.source}) — 05 문서 S7 확인`);
    out = out.replace(re, '');
  }
  return out.trim().replace(/\n\s*/g, '');
}

if (process.argv[1]?.endsWith('extract-assets.ts')) {
  const files = ['SeaBuilding', 'SeaProp'];
  const all = new Map<string, RawAsset>();
  for (const f of files) {
    for (const a of extractSvgs(readFileSync(new URL(`../design/canvas/${f}.dc.html`, import.meta.url), 'utf8'))) {
      if (!all.has(a.id)) all.set(a.id, a);
    }
  }
  const body = `// 생성됨: pnpm assets. 직접 고치지 말 것.\nimport type { RawAsset } from './types';\n\nexport const assets: Record<string, RawAsset> = ${JSON.stringify(Object.fromEntries(all), null, 1)};\n`;
  writeFileSync(new URL('../packages/web/src/assets/sea/data.ts', import.meta.url), body);
  const critter = extractCritter(readFileSync(new URL('../design/canvas/SeaCritter.dc.html', import.meta.url), 'utf8'));
  writeFileSync(
    new URL('../packages/web/src/assets/sea/critter.ts', import.meta.url),
    `// 생성됨: pnpm assets. 직접 고치지 말 것.\nexport const critterTemplate = ${JSON.stringify(critter)};\n`,
  );
  console.log(`${all.size} assets + critter`);
}

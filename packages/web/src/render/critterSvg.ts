// SeaCritter 템플릿을 채우고, 전역 틱마다 DOM을 직접 고친다 (02 문서 7.4, 8.4). 캔버스 renderVals를 옮긴 것.
import { critterTemplate } from '../assets/sea/critter';
import { strokeHole } from '../assets/sea/fill';
import { tokens } from '../tokens';
import {
  bubble,
  eyeArcs,
  frameIndex,
  partTransforms,
  resolvePose,
  rig,
  shadowSize,
  SPECIES,
  type PoseName,
  type SpeciesId,
} from './rig';

export type Role = 'explore' | 'plan' | 'general';
export interface CritterOpts {
  species: SpeciesId;
  pose?: PoseName;
  accessory?: string; // 없으면 종 기본. 햄스터는 늘 헬멧 (lockedAccessory)
  variant?: number; // 자동 변형 (D16): 1부터 털 염색 + 무늬. 0·없음 = 원래 모습
  role?: Role; // 복어 모자 색
  mode?: 'full' | 'face';
  scale?: number;
  flip?: boolean;
  phase?: number;
  shadow?: boolean;
  bubbles?: boolean;
  frame?: number; // 고정 프레임 (-1/없음 = 애니메이션)
  uid: string;
}

const tok = (n: string) => (tokens as Record<string, string>)[n] ?? '';
/** 부품 라이브러리 (05 문서 6.5): 템플릿의 {{pt.부품}} 이름들. 종의 parts에 있는 것만 켠다 */
/** 자동 변형 염색 (D16, 05 문서 6.5): 토큰 --dye-<이름>(털) · --dye-<이름>-d(팔·무늬) */
export const DYES = ['white', 'cream', 'ink', 'rust', 'sand', 'slate', 'rose', 'mint'] as const;
/** 변형 번호 → 염색·무늬. 종마다 시작점이 달라 같은 바퀴의 팀원끼리도 색이 갈린다. 홀수 = 이마 줄무늬, 짝수 = 눈 무늬 */
export function variantLook(species: SpeciesId, variant = 0) {
  if (variant < 1) return null;
  // 원래 털과 비슷한 염색은 건너뛴다 (흰 북극곰에 흰 염색이면 그대로라)
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  const far = (d: string) => {
    const [a, b] = [rgb(tok(`dye-${d}`)), rgb(rig.species[species].fur)];
    return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)) >= 70;
  };
  const start = (variant - 1 + SPECIES.indexOf(species)) % DYES.length;
  const order = DYES.map((_, k) => DYES[(start + k) % DYES.length] ?? 'white');
  const dye = order.find(far) ?? order[0] ?? 'white';
  return { dye, pattern: variant % 2 === 1 ? ('stripes' as const) : ('patch' as const) };
}
export const PARTS = [...new Set([...critterTemplate.matchAll(/\{\{pt\.(\w+)\}\}/g)].map((m) => m[1] ?? ''))];
const vis = (on: boolean) => (on ? 'inline' : 'none');
const r1 = (v: number) => Math.round(v * 10) / 10;

export const accessoryOf = (o: Pick<CritterOpts, 'species' | 'accessory'>) =>
  rig.lockedAccessory[o.species] ?? o.accessory ?? rig.species[o.species].defaultAccessory;

export const bubblesOn = (o: CritterOpts, pose: PoseName) =>
  o.mode !== 'face' && (o.bubbles ?? (pose === 'talk' || accessoryOf(o) === 'seaWalkHelmet'));

function frameAt(o: CritterOpts, tick: number) {
  const poseName = resolvePose(o.species, o.pose ?? 'stand');
  const pose = rig.poses[poseName];
  const fi =
    o.frame !== undefined && o.frame >= 0 ? o.frame % pose.frames.length : frameIndex(pose, tick + (o.phase ?? 0));
  return { poseName, pose, fi, frame: o.mode === 'face' ? {} : (pose.frames[fi] ?? {}) };
}

/** 한 틱의 모든 구멍 값 */
export function critterVals(o: CritterOpts, tick: number): Record<string, string> {
  const sp = rig.species[o.species];
  const { poseName, pose, frame } = frameAt(o, tick);
  const face = o.mode === 'face';
  const lift = frame.body?.[1] ?? 0;
  const ex = frame.expr ?? 'n';
  const acc = accessoryOf(o);
  const isOtter = o.species === 'otter';
  const [eX = 0, eY = 0, eRx = 0, eRy = 0, eHr = 0] = sp.eye;
  const [bX = 0, bY = 0, bRx = 0, bRy = 0] = sp.blush;
  const sh = shadowSize(lift);
  const t = partTransforms(o.species, frame);
  const look = variantLook(o.species, o.variant);
  const v: Record<string, string> = {
    shId: `${o.uid}-sh`,
    shadow: vis(!face && (o.shadow ?? true)),
    shRx: String(sh.rx),
    shRy: String(sh.ry),
    flipT: o.flip ? 'scale(-1 1)' : 'scale(1 1)',
    'c.cap': tok(`cap-${o.role ?? 'general'}`) || tok('cap-general'),
    'c.fur': look ? tok(`dye-${look.dye}`) : sp.fur,
    'c.arm': look ? tok(`dye-${look.dye}-d`) : sp.arm,
    'c.pattern': look ? tok(`dye-${look.dye}-d`) : sp.arm,
    'c.foot': sp.foot,
    'c.face': sp.face ?? sp.fur,
    'c.shade': sp.shade ?? sp.arm,
    'c.beak': sp.beak ?? sp.foot,
    'c.footRx': String(sp.footR[0]),
    'c.footRy': String(sp.footR[1]),
    'c.armRx': String(sp.armR[0]),
    'c.armRy': String(sp.armR[1]),
    'c.earLPv': (sp.earL ?? [-22, -58]).join(','),
    'c.earRPv': (sp.earR ?? [22, -58]).join(','),
    'c.tailPv': (sp.tail ?? [0, -10]).join(','),
    'c.exL': String(-eX),
    'c.exR': String(eX),
    'c.ey': String(eY),
    'c.erx': String(eRx),
    'c.ery': String(eRy),
    'c.hxL': String(r1(-eX - eRx * 0.3)),
    'c.hxR': String(r1(eX - eRx * 0.3)),
    'c.hy': String(r1(eY - eRy * 0.38)),
    'c.hr': String(eHr),
    'c.happy': eyeArcs(o.species, 'happy'),
    'c.sleep': eyeArcs(o.species, 'sleep'),
    'c.bxL': String(-bX),
    'c.bxR': String(bX),
    'c.by': String(bY),
    'c.brx': String(bRx),
    'c.bry': String(bRy),
    'c.hamD': vis(!isOtter), // variantBySpecies: 수달은 망치 대신 돌
    'c.stoneD': vis(isOtter),
    pH: vis(!face && pose.prop === 'hammer'),
    pP: vis(!face && pose.prop === 'blocks'),
    'bub.on': vis(bubblesOn(o, poseName)),
    'e.n': vis(ex === 'n'),
    'e.h': vis(ex === 'h'),
    'e.t': vis(ex === 't'),
    'e.s': vis(ex === 's'),
  };
  for (const s of SPECIES) v[`sp.${s}`] = vis(s === o.species);
  for (const p of PARTS) v[`pt.${p}`] = vis((sp.parts?.includes(p) ?? false) || look?.pattern === p);
  for (const a of Object.keys(rig.accessories)) v[`acc.${a}`] = vis(a === acc);
  const tKeys: Record<string, string> = {
    footL: 'foot-l',
    footR: 'foot-r',
    body: 'body',
    earL: 'ear-l',
    earR: 'ear-r',
    face: 'face',
    armL: 'arm-l',
    armR: 'arm-r',
    tail: 'tail',
  };
  for (const [k, part] of Object.entries(tKeys)) v[`t.${k}`] = t[part] ?? '';
  const collar = acc === 'seaWalkHelmet';
  (['a', 'b', 'c'] as const).forEach((n, i) => {
    for (const [k, val] of Object.entries(bubble(i, tick + (o.phase ?? 0), lift, collar)))
      v[`bub.${n}.${k}`] = String(val);
  });
  return v;
}

export function critterInner(o: CritterOpts, tick = 0): string {
  const v = critterVals(o, tick);
  const k = 1 / (o.scale ?? 1);
  return critterTemplate.replace(/\{\{([\w.]+)\}\}/g, (hole, name: string) => {
    const val = v[name] ?? strokeHole(name, k);
    if (val === null || val === undefined) throw new Error(`critter: 채우지 못한 구멍 ${hole}`);
    return val;
  });
}

/** 틱마다 바뀌는 것만 DOM에 쓴다: 파츠 transform, 표정, 그림자, 거품 */
export function applyTick(root: SVGSVGElement, o: CritterOpts, tick: number) {
  const v = critterVals(o, tick);
  const T: Record<string, string> = {
    'foot-l': 't.footL',
    'foot-r': 't.footR',
    body: 't.body',
    'ear-l': 't.earL',
    'ear-r': 't.earR',
    face: 't.face',
    'arm-l': 't.armL',
    'arm-r': 't.armR',
    tail: 't.tail',
  };
  for (const [part, key] of Object.entries(T))
    root.querySelector(`[data-part="${part}"]`)?.setAttribute('transform', v[key] ?? '');
  for (const [expr, key] of Object.entries({ normal: 'e.n', happy: 'e.h', talk: 'e.t', sleep: 'e.s' }))
    root.querySelector(`[data-expr="${expr}"]`)?.setAttribute('display', v[key] ?? 'none');
  const sh = root.querySelector('[data-part="shadow"]');
  sh?.setAttribute('rx', v.shRx ?? '');
  sh?.setAttribute('ry', v.shRy ?? '');
  const circles = root.querySelectorAll('[data-fx="bubbles"] circle');
  (['a', 'b', 'c'] as const).forEach((n, i) => {
    const [c, h] = [circles[i * 2], circles[i * 2 + 1]];
    const g = (k: string) => v[`bub.${n}.${k}`] ?? '';
    c?.setAttribute('cx', g('x'));
    c?.setAttribute('cy', g('y'));
    c?.setAttribute('r', g('r'));
    c?.setAttribute('opacity', g('o'));
    h?.setAttribute('cx', g('hx'));
    h?.setAttribute('cy', g('hy'));
    h?.setAttribute('r', g('hr'));
    h?.setAttribute('opacity', g('o'));
  });
}

/** 이 틱에 다시 그려야 하나 (프레임이 바뀌었거나 거품이 켜짐) */
export function needsUpdate(o: CritterOpts, prevTick: number, tick: number) {
  const a = frameAt(o, prevTick);
  const b = frameAt(o, tick);
  return a.fi !== b.fi || bubblesOn(o, b.poseName);
}

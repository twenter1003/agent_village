// 캐릭터 리그 (02 문서 7.4). rig.json 위에 rig.sea.json을 덮는다 (05 문서 6장). 순수 함수만.
import land from '../../../../design/rig.json';
import sea from '../../../../design/rig.sea.json';

export type V3 = [number, number, number];
export type FrameKey = 'body' | 'face' | 'armL' | 'armR' | 'footL' | 'footR' | 'earL' | 'earR' | 'tail';
export type Frame = Partial<Record<FrameKey, V3>> & { expr?: string };
export interface Pose {
  rate: number;
  prop?: string;
  frames: Frame[];
}
export type PoseName = 'stand' | 'walk' | 'swim' | 'hammer' | 'carry' | 'cheer' | 'talk' | 'rest' | 'flail' | 'held';
export type SpeciesId = keyof typeof sea.species;
export interface Species {
  name: string;
  fur: string;
  arm: string;
  foot: string;
  footR: number[];
  armR: number[];
  earL: number[] | null;
  earR: number[] | null;
  tail: number[] | null;
  move: string;
  eye: number[];
  blush: number[];
  faceOff: number[];
  defaultAccessory: string;
  /** 동물 도감 (01 문서 D15, 05 문서 6.5): 켤 부품과 부품 색 (주둥이·얼굴 무늬·배 / 귀 안쪽·꼬리 끝 / 부리) */
  parts?: string[];
  face?: string;
  shade?: string;
  beak?: string;
}

export function mergeRig(base: typeof land, over: typeof sea) {
  return {
    frameMs: base.frameMs,
    worldScale: base.worldScale,
    pivots: base.pivots,
    poses: { ...base.poses, ...over.poses } as unknown as Record<PoseName, Pose>,
    species: over.species as Record<SpeciesId, Species>,
    accessories: over.accessories,
    props: over.props,
    lockedAccessory: { hamster: 'seaWalkHelmet' } as Partial<Record<SpeciesId, string>>,
  };
}
export const rig = mergeRig(land, sea);
export const SPECIES = Object.keys(rig.species) as SpeciesId[];

/** 게임은 이동을 walk로 요청한다. 그릴 때 종의 move(swim|walk)로 바꾼다. */
export const resolvePose = (sp: SpeciesId, want: PoseName): PoseName =>
  want === 'walk' || want === 'swim' ? (rig.species[sp].move as PoseName) : want;

export const frameIndex = (pose: Pose, tick: number) => Math.floor(tick / pose.rate) % pose.frames.length;

const Z: V3 = [0, 0, 0];
const tf = (v: V3, pv: readonly number[]) => `translate(${v[0]} ${v[1]}) rotate(${v[2]} ${pv[0]} ${pv[1]})`;
// 캔버스(SeaCritter)와 같게: 귀·꼬리가 없는 종은 빈 칸의 회전 중심을 기본값으로
const EAR_L = [-22, -58];
const EAR_R = [22, -58];
const TAIL = [0, -10];

/** data-part → transform */
export function partTransforms(spId: SpeciesId, frame: Frame): Record<string, string> {
  const sp = rig.species[spId];
  const g = (k: FrameKey) => frame[k] ?? Z;
  const fv = g('face');
  const [fx = 0, fy = 0] = sp.faceOff;
  const pv = rig.pivots;
  return {
    'foot-l': tf(g('footL'), pv['foot-l']),
    'foot-r': tf(g('footR'), pv['foot-r']),
    body: tf(g('body'), pv.body),
    'ear-l': tf(g('earL'), sp.earL ?? EAR_L),
    'ear-r': tf(g('earR'), sp.earR ?? EAR_R),
    face: tf([fv[0] + fx, fv[1] + fy, fv[2]], pv.face),
    'arm-l': tf(g('armL'), pv['arm-l']),
    'arm-r': tf(g('armR'), pv['arm-r']),
    tail: tf(g('tail'), sp.tail ?? TAIL),
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** fx.shadowLift: 몸이 뜬 만큼(lift < 0) 그림자가 작아진다 */
export const shadowSize = (lift: number) => ({ rx: r1(38 + lift * 0.45), ry: r1(9 + lift * 0.12) });

/** fx.bubbles 한 방울. 헬멧이면 칼라 양옆, 아니면 머리 옆에서 올라간다. */
export function bubble(i: number, tick: number, lift: number, collar: boolean) {
  const life = 26;
  const t = (tick + i * 9) % life;
  const side = i % 2 === 0 ? -1 : 1;
  const x = collar
    ? side * (47 + Math.min(t, 6) * 0.5) + Math.sin(t / 2.5 + i) * 2
    : 24 + Math.sin(t / 2.5 + i * 2) * 2.5;
  const y = collar ? -18 + lift - t * 4 : -62 + lift - t * 3.2;
  const r = 2.2 + (i % 3) * 0.9 + t * 0.05;
  const o = t < 3 ? t / 3 : t > life - 6 ? (life - t) / 6 : 1;
  return { x: r1(x), y: r1(y), r: r1(r), o: r1(o * 0.95), hx: r1(x - r * 0.35), hy: r1(y - r * 0.35), hr: r1(r * 0.3) };
}

/** 표정 눈 곡선 (happy: 위로, sleep: 아래로) */
export function eyeArcs(spId: SpeciesId, kind: 'happy' | 'sleep') {
  const [ex = 0, ey = 0, erx = 0] = rig.species[spId].eye;
  const hw = erx + 1;
  const y = kind === 'happy' ? ey + 1.5 : ey;
  const dy = kind === 'happy' ? -6 : 4;
  const arc = (x: number) => `M${r1(x - hw)} ${r1(y)}Q${r1(x)} ${r1(y + dy)} ${r1(x + hw)} ${r1(y)}`;
  return arc(-ex) + arc(ex);
}

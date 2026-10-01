import { assets } from './data';
import { fillAsset, type FillParams } from './fill';
import { tokens } from '../../tokens';

export type Slot = 1 | 2 | 3 | 4 | 5 | 6 | 'x';

const tok = (name: string) => (tokens as Record<string, string>)[name] ?? '';
export const slotColors = (s: Slot) => ({
  roof: tok(`slot${s}`),
  roofL: tok(`slot${s}-l`),
  roofR: tok(`slot${s}-r`),
  tint: tok(`slot${s}-tint`),
});
export const fabColors = (s: Slot) => ({ fab: tok(`slot${s}`), fabL: tok(`slot${s}-l`), fabR: tok(`slot${s}-r`) });

export function asset(id: string) {
  const a = assets[id];
  if (!a) throw new Error(`없는 에셋 ${id}`);
  return a;
}

/** 에셋 한 장을 <g>로. 같은 viewBox끼리 겹쳐 그릴 때 쓴다. */
export function AssetLayer({ id, params, ...rest }: { id: string; params?: FillParams } & React.SVGProps<SVGGElement>) {
  const a = asset(id);
  const data = Object.fromEntries(Object.entries(a.data).map(([k, v]) => [`data-${k}`, v]));
  return <g {...data} {...rest} dangerouslySetInnerHTML={{ __html: fillAsset(a.inner, params) }} />;
}

/** 1×1·2×1·2×2 소품/가구/바닥. 선 보정 k = 1/scale (03 문서 3.2). sway = 흔들림 장면 (해초·켈프·말미잘) */
export function Prop({ kind, scale = 1, fab = 1, sway }: { kind: string; scale?: number; fab?: Slot; sway?: number }) {
  const a = asset(kind);
  const [, , w = 0, h = 0] = a.viewBox.split(' ').map(Number);
  return (
    <svg width={w * scale} height={h * scale} viewBox={a.viewBox} aria-hidden="true">
      <AssetLayer id={kind} params={{ k: 1 / scale, colors: fabColors(fab), sway }} />
    </svg>
  );
}

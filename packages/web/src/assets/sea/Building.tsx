import { useId } from 'react';
import { asset, AssetLayer, slotColors, type Slot } from './Asset';

export type Stage = 'planned' | 'foundation' | 'frame' | 'done';

export interface BuildingProps {
  body: string; // shell-1f | coral-1f | wreck-2f | basalt-2f | wreck-3f | basalt-3f | big-* | hall-* | landmark* (3×3)
  roof?: string | 'none'; // dome | scallop | conch | big-*
  sign?: string | 'none';
  /** 지붕 다음에 겹치는 장식 (큰 건물 직업 장식 big-*, 06 문서 14.1) */
  deco?: string;
  slot?: Slot;
  stage?: Stage;
  progress?: number; // frame 단계에서 골조가 드러난 비율 0~1 (01 문서 5.2)
  fx?: boolean;
  scaffold?: boolean; // 완공 몸통 위 비계 — 주인이 일하는 동안 다음 층 공사 (06 문서 5.9)
  ghost?: boolean;
  scale?: number;
}

/** 골조 clipPath 위쪽 y (03 문서 3.1) */
export const frameClipY = (twoFloors: boolean, progress: number) => 236 - progress * (twoFloors ? 146 : 106);

/** 2×2 1층 왼쪽 벽 간판 판 가운데 (sign.*의 matrix(1 0.5 0 1 54 221)의 (12, −25) → (66, 202) − 기준점 (80, 208)) */
const SIGN_2X2: [number, number] = [-14, -6];

/** 몸통 에셋의 크기·기준점·얼굴 간판 자리 (03 문서 2.1, 06 문서 14.1 `data-sign`). 2×2 = 160×256 · (80, 208), 3×3 = 224×320 · (112, 256) */
export function bodyBox(body: string) {
  const a = asset(`body.${body}`);
  const [, , w = 160, h = 256] = a.viewBox.split(' ').map(Number);
  const [ax = 80, ay = 208] = (a.data.anchor ?? '').split(',').map(Number);
  const [sx, sy] = a.data.sign ? a.data.sign.split(',').map(Number) : SIGN_2X2;
  return { w, h, ax, ay, sign: { dx: sx ?? SIGN_2X2[0], dy: sy ?? SIGN_2X2[1] } };
}

export function Building({
  body,
  roof = 'none',
  sign = 'none',
  deco,
  slot = 1,
  stage = 'done',
  progress = 0,
  fx,
  scaffold,
  ghost,
  scale = 1,
}: BuildingProps) {
  const uid = useId().replace(/:/g, '');
  const two = !body.endsWith('1f'); // 공사 그림은 1층·2층 두 벌 — 3층은 2층 비계
  const colors = slotColors(slot);
  const p = { k: 1 / scale, colors };
  const box = bodyBox(body);
  const wallH = Number(asset(`body.${body}`).data['wall-height'] ?? 0);
  return (
    <svg width={box.w * scale} height={box.h * scale} viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
      {stage === 'planned' && <AssetLayer id="site.planned" params={p} />}
      {(stage === 'foundation' || stage === 'frame') && <AssetLayer id="site.foundation" params={p} />}
      {stage === 'frame' && (
        <>
          <AssetLayer id={`site.frame-${two ? 2 : 1}f`} params={{ ...p, uid, clipY: frameClipY(two, progress) }} />
          <AssetLayer id={`site.scaffold-${two ? 2 : 1}f`} params={p} />
        </>
      )}
      {stage === 'done' && (
        <>
          <AssetLayer id={`body.${body}`} params={p} opacity={ghost ? 0.35 : 1} />
          {roof !== 'none' && <AssetLayer id={`roof.${roof}`} params={p} transform={`translate(0 ${-wallH})`} />}
          {deco && <AssetLayer id={`deco.${deco}`} params={p} />}
          {sign !== 'none' && <AssetLayer id={`sign.${sign}`} params={p} />}
          {scaffold && <AssetLayer id={`site.scaffold-${two ? 2 : 1}f`} params={p} />}
          {fx && <AssetLayer id="fx.complete" params={p} transform={`translate(${box.ax - 80} ${box.ay - 208})`} />}
        </>
      )}
    </svg>
  );
}

import { useId } from 'react';
import { asset, AssetLayer, slotColors, type Slot } from './Asset';

export type Stage = 'planned' | 'foundation' | 'frame' | 'done';

export interface BuildingProps {
  body: string; // shell-1f | coral-1f | wreck-2f | basalt-2f
  roof?: string | 'none'; // dome | scallop | conch
  sign?: string | 'none';
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

export function Building({
  body,
  roof = 'none',
  sign = 'none',
  slot = 1,
  stage = 'done',
  progress = 0,
  fx,
  scaffold,
  ghost,
  scale = 1,
}: BuildingProps) {
  const uid = useId().replace(/:/g, '');
  const two = body.endsWith('2f');
  const colors = slotColors(slot);
  const p = { k: 1 / scale, colors };
  const wallH = Number(asset(`body.${body}`).data['wall-height'] ?? 0);
  return (
    <svg width={160 * scale} height={256 * scale} viewBox="0 0 160 256" aria-hidden="true">
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
          {sign !== 'none' && <AssetLayer id={`sign.${sign}`} params={p} />}
          {scaffold && <AssetLayer id={`site.scaffold-${two ? 2 : 1}f`} params={p} />}
          {fx && <AssetLayer id="fx.complete" params={p} />}
        </>
      )}
    </svg>
  );
}

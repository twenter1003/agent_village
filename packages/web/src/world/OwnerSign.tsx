// 건물 주인 표시 (06 문서 7장, D25): 얼굴 간판(둥근 틀 안 주인 얼굴) + 이름표. 집(M16)·일터(M13)·시청(M14)이 같이 쓴다.
import { useId } from 'react';
import type { Slot } from '../assets/sea/Asset';
import { Critter } from '../render/Critter';
import type { SpeciesId } from '../render/rig';

/** 건물 주인 (live/sceneFromState ownerOf). 얼굴 = 바다 종·자동 변형·소품, 틀·이름표 색 = 슬롯 */
export interface Owner {
  memberId: string;
  species: SpeciesId;
  variant?: number;
  accessory?: string;
  slot: Slot;
  /** 이름표 글자: 팀원 이름, 팀장은 "팀장의 집" 등 */
  tag: string;
}

// 얼굴 자르기 (Critter face viewBox -44 -86 88 88): 머리 가운데 (0, -40), 머리 폭 72를 창 지름에 맞춘다
const HEAD_Y = -40;
const HEAD_W = 72;

/**
 * 얼굴 간판: 기준점(0,0) = 원 가운데. size = 바깥 지름(px, 배율 1 월드).
 * 틀 = 슬롯 색 띠 + --ink 외곽선 3, 창 = 슬롯 tint 위에 얼굴을 clipPath 원으로. 얼굴은 배율 s로 넣고 Critter가 선을 3/s로 보정한다
 */
export function OwnerSign({ owner, size }: { owner: Owner; size: number }) {
  const clip = `os${useId().replace(/:/g, '')}`;
  const r = size / 2;
  const win = r - 5; // 얼굴 창 반지름: 틀 띠(외곽선 안쪽 3.5)만큼 안
  const s = (win * 2) / HEAD_W;
  const slot = `--slot${owner.slot}`;
  return (
    <g data-owner-sign={owner.memberId} aria-hidden="true">
      <clipPath id={clip}>
        <circle r={win} />
      </clipPath>
      <circle r={r - 1.5} style={{ fill: `var(${slot})`, stroke: 'var(--ink)', strokeWidth: 'var(--sw)' }} />
      <circle r={win} style={{ fill: `var(${slot}-tint)` }} />
      <g clipPath={`url(#${clip})`}>
        <g transform={`translate(${-44 * s} ${-(HEAD_Y + 86) * s})`}>
          <Critter
            mode="face"
            species={owner.species}
            variant={owner.variant}
            accessory={owner.accessory}
            scale={s}
            animate={false}
          />
        </g>
      </g>
      <circle r={win} fill="none" style={{ stroke: 'var(--ink)', strokeWidth: 'var(--sw-detail)' }} />
    </g>
  );
}

/** 이름표 (월드 좌표 HTML): x = 가운데, y = 위. 바탕 슬롯 tint · 글자 슬롯 deep (직업 칩과 같은 짝). 줌 아웃하면 숨긴다 (Camera data-far) */
export function NameTag({ x, y, owner, dim }: { x: number; y: number; owner: Owner; dim?: number }) {
  const slot = `--slot${owner.slot}`;
  return (
    <span
      className="lv-tag"
      data-name-tag={owner.memberId}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translateX(-50%)',
        padding: '0 var(--sp-2)',
        background: `var(${slot}-tint)`,
        color: `var(${slot}-deep)`,
        border: 'var(--ui-line-sm) solid var(--ink)',
        borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-min)',
        lineHeight: 'var(--lh-min)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        opacity: dim,
      }}
    >
      {owner.tag}
    </span>
  );
}

import { useEffect, useId, useMemo, useRef } from 'react';
import { applyTick, critterInner, needsUpdate, variantLook, type CritterOpts } from './critterSvg';
import { currentTick, subscribe } from './ticker';
import { t } from '../i18n';
import { usePrefs } from '../live/prefs';

export type CritterProps = Omit<CritterOpts, 'uid'> & { animate?: boolean };

/** 읽는 이름 = 동물 이름, 자동 변형이면 염색 이름을 앞에 (05 문서 3장) */
export function critterName(species: CritterOpts['species'], variant?: number) {
  const look = variantLook(species, variant);
  return look ? `${t(`dye.${look.dye}`)} ${t(`species.${species}`)}` : t(`species.${species}`);
}

export function Critter({ animate = true, ...props }: CritterProps) {
  // 설정 "거품 효과"를 끄면 거품만 끈다 (포즈는 그대로, 05 문서 5.3)
  const fx = usePrefs().bubbles;
  if (!fx) props = { ...props, bubbles: false };
  const uid = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const face = props.mode === 'face';
  const s = props.scale ?? 1;
  const o: CritterOpts = { ...props, uid };
  const name = critterName(props.species, props.variant);
  const key = JSON.stringify(o);
  const html = useMemo(() => critterInner(o, currentTick()), [key]);
  const optsRef = useRef(o);
  optsRef.current = o;

  useEffect(() => {
    if (!animate || face || !ref.current) return;
    const el = ref.current;
    return subscribe((t, prev) => {
      if (needsUpdate(optsRef.current, prev, t)) applyTick(el, optsRef.current, t);
    });
  }, [animate, face]);

  return (
    <svg
      ref={ref}
      width={(face ? 88 : 128) * s}
      height={(face ? 88 : 138) * s}
      viewBox={face ? '-44 -86 88 88' : '-64 -126 128 138'}
      data-asset-id={`${props.species}.${face ? 'face' : (props.pose ?? 'stand')}`}
      data-anchor="0,0"
      role="img"
      aria-label={face ? t('ui.face', { name }) : name}
      style={{ display: 'block', overflow: 'visible' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

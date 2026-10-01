// 표시 설정 (01 문서 10장 화면 메모 M9): 이 브라우저 localStorage, 마을 공통. 게임 상태·규칙과 무관.
// 사용자가 고른 값만 저장하고, 안 고른 값은 기본값 (거품 효과 기본값은 운영체제 "움직임 줄이기"를 따른다)
import { useSyncExternalStore } from 'react';
import { t } from '../i18n';

export const ZOOMS = ['fit', 0.8, 1, 1.2, 1.4] as const;
export type Zoom = (typeof ZOOMS)[number];
export interface Prefs {
  /** 회의 안건(프롬프트 앞 20자)을 말풍선·팀원 카드·활동 기록·알림에 보인다 */
  speech: boolean;
  /** 캐릭터 거품·물기둥 거품·공사 단계 거품 (05 문서 5.3) */
  bubbles: boolean;
  /** 마을 카메라 처음 배율 */
  zoom: Zoom;
}

const KEY = 'tycoon.prefs';
export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function load(): Partial<Prefs> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Partial<Prefs>) : {};
  } catch {
    return {}; // 막힌 저장소·깨진 값 → 기본값
  }
}
function derive(saved: Partial<Prefs>): Prefs {
  return {
    speech: typeof saved.speech === 'boolean' ? saved.speech : true,
    bubbles: typeof saved.bubbles === 'boolean' ? saved.bubbles : !reducedMotion(),
    zoom: ZOOMS.includes(saved.zoom as Zoom) ? (saved.zoom as Zoom) : 'fit',
  };
}

let saved = load();
let current = derive(saved);
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setPrefs(p: Partial<Prefs>) {
  saved = { ...saved, ...p };
  current = derive(saved);
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // 저장 못 해도 이 탭에서는 바뀐다
  }
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  // 다른 탭에서 바꾸면 따라간다
  const other = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    saved = load();
    current = derive(saved);
    notify();
  };
  addEventListener('storage', other);
  return () => {
    listeners.delete(l);
    removeEventListener('storage', other);
  };
}

export const usePrefs = () => useSyncExternalStore(subscribe, () => current);

/** 회의 글자("광장 회의 시작 · 안건")에서 안건을 숨긴다 (speech 끔) */
export const meetingText = (text: string, speech: boolean) => (speech ? text : (text.split(' · ')[0] ?? text));

/** 한글 끝 글자에 받침이 있으면 a, 없으면 b를 붙인다 (이/가, 을/를) */
const josa = (w: string, a: string, b: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return w + (c >= 0 && c < 11172 && c % 28 === 0 ? b : a);
};

/** 알림·활동 기록 글자 (01 문서 9장). core는 테마를 모르니(05 문서 3.1) 레벨업·공공시설은 ref(`@level:<n>:<시대>`·`@work:<종류>:<값>`)로
 *  이름 사전 글자를 만든다 (06 문서 6.4). 회의는 안건 글자 설정 */
export function noticeText(x: { kind: string; text: string; ref?: string }, speech: boolean): string {
  const [what, a = '', b = ''] = x.ref?.split(':') ?? [];
  if (what === '@level') return t('notice.level', { n: a, name: josa(t(`eras.${b}`), '이', '가') });
  if (what === '@work')
    return b === '0'
      ? t('notice.gift', { name: josa(t(`works.${a}`), '이', '가') })
      : t('notice.work', { name: josa(t(`works.${a}`), '을', '를'), cost: Number(b).toLocaleString('ko-KR') });
  return x.kind === 'meeting' ? meetingText(x.text, speech) : x.text;
}

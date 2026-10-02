// 아이콘 (03 문서 3.4): 24 격자, 선 2, 둥근 끝, 채우지 않음. 색은 currentColor → 기본 --text (base.css body).
// 바다만 (01 문서 D7): 바뀌는 8개는 SeaUI.dc.html, 나머지 17개는 Type.dc.html 그대로. chevronDown은 SeaTopBar 프로젝트 선택.
// 이름은 정본 id (05 문서 3장): 상태 = MemberStatus, 시설 = library/plan/agency. 그래서 <Icon name={m.status} />가 된다.
// ponytail: 12px 칩용 간략형(회의·성격, SeaScreenMain)은 안 만듦. 선만 3으로 굵힌다. 작게 봐서 뭉개지면 그때 추가.

const ICONS = {
  // 화폐 = 진주 (03 문서 5장 화폐 표시: 채움 --currency / 광택 --currency-d). SeaTopBar 잔액 칩의 22 격자를 가운데 놓음.
  coin: (
    <g transform="translate(1 1)">
      <circle cx="11" cy="11" r="8.5" style={{ fill: 'var(--currency)', stroke: 'var(--ink)' }} />
      <path d="M14.5 13.5A5 5 0 0 1 8 15.5" strokeWidth="2.4" style={{ stroke: 'var(--currency-d)' }} />
      <circle cx="8.2" cy="8" r="2" stroke="none" style={{ fill: 'var(--sheen)' }} />
    </g>
  ),
  // 금고 → 보물상자
  vault: <path d="M4 11C4 5.5 20 5.5 20 11V19H4ZM4 11H20M10.5 11V14.5H13.5V11" />,
  price: <path d="M4 16.5L10 10.5L14 14.5L20 8.5M15 8.5H20V13.5" />,
  bell: <path d="M6 16V11A6 6 0 0 1 18 11V16L19.5 18H4.5ZM10 20.5A2 2 0 0 0 14 20.5" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5V6M12 18V20.5M3.5 12H6M18 12H20.5M6 6L7.8 7.8M16.2 16.2L18 18M6 18L7.8 16.2M16.2 7.8L18 6" />
      <circle cx="12" cy="12" r="6" />
    </>
  ),
  working: <path d="M5 19.5L13 11.5M10.5 6.5L14.5 3.5L20.5 9.5L17.5 13.5Z" />,
  meeting: (
    <path d="M5 5.5H19A1.5 1.5 0 0 1 20.5 7V15A1.5 1.5 0 0 1 19 16.5H11L7 19.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" />
  ),
  resting: <path d="M19 14.5A7.5 7.5 0 1 1 9.5 5A6 6 0 0 0 19 14.5Z" />,
  blocked: <path d="M12 4L20.5 19H3.5ZM12 10V14M12 16.8V17" />,
  // 집 → 돔 집
  home: <path d="M3.5 19.5C3.5 11 7.5 5 12 5C16.5 5 20.5 11 20.5 19.5ZM10 19.5V16A2 2 0 0 1 14 16V19.5M12 5V3.5" />,
  villageView: <path d="M12 4L20.5 8.5L12 13L3.5 8.5ZM3.5 12.5L12 17L20.5 12.5" />,
  gridView: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  zoomIn: <path d="M12 5V19M5 12H19" />,
  zoomOut: <path d="M5 12H19" />,
  fitAll: <path d="M4 9V4H9M15 4H20V9M20 15V20H15M9 20H4V15" />,
  done: <path d="M5 12.5L9.5 17L19 7.5" />,
  close: <path d="M6 6L18 18M18 6L6 18" />,
  // 완공 → 반짝·거품
  complete: (
    <>
      <path d="M10 4L11.6 9.4L17 11L11.6 12.6L10 18L8.4 12.6L3 11L8.4 9.4Z" />
      <circle cx="18" cy="17.5" r="2.3" />
      <circle cx="19.2" cy="7" r="1.3" />
    </>
  ),
  // 도서관 → 탐사 기지 (음파)
  library: (
    <>
      <circle cx="6.5" cy="17.5" r="1.8" />
      <path d="M10.5 17.5A4 4 0 0 0 6.5 13.5M14.5 17.5A8 8 0 0 0 6.5 9.5M18.5 17.5A12 12 0 0 0 6.5 5.5" />
    </>
  ),
  // 설계사무소 → 해도실 (나침반)
  plan: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 6.5L14.2 12L12 17.5L9.8 12Z" />
    </>
  ),
  // 인력사무소 → 인력 부두 (닻)
  agency: (
    <>
      <circle cx="12" cy="5" r="1.8" />
      <path d="M12 6.8V20M8.5 10H15.5M5 13.5C5 17.5 8.5 20 12 20C15.5 20 19 17.5 19 13.5M3.5 15L5 13.5L6.5 15M17.5 15L19 13.5L20.5 15" />
    </>
  ),
  shop: (
    <path d="M5 11V8.5A2 2 0 0 1 7 6.5H17A2 2 0 0 1 19 8.5V11M3 12.5A2 2 0 0 1 7 12.5V14.5H17V12.5A2 2 0 0 1 21 12.5V17.5H3ZM5 17.5V19.5M19 17.5V19.5" />
  ),
  personality: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 10V10.5M15 10V10.5M9 14.5C10.6 16 13.4 16 15 14.5" />
    </>
  ),
  time: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12L15 14" />
    </>
  ),
  // 새로: 거품 효과 설정 (05 문서 5.2)
  bubbles: (
    <>
      <circle cx="9" cy="14.5" r="5" />
      <circle cx="16.5" cy="7.5" r="3" />
      <circle cx="18" cy="16.5" r="1.8" />
      <path d="M6.8 12.6A2.6 2.6 0 0 1 8.4 11.4" />
    </>
  ),
  chevronDown: <path d="M6 9L12 15L18 9" />,
  // 가구 옮기기 (SeaScreenHouse 버튼, M7)
  move: (
    <path d="M12 4V20M4 12H20M12 4L9 7M12 4L15 7M12 20L9 17M12 20L15 17M4 12L7 9M4 12L7 15M20 12L17 9M20 12L17 15" />
  ),
  // 레벨 배지 = 마을 시대 (06 문서 14.1): 모래섬 마을 · 산호 읍 · 해저 도시 · 해저 수도
  eraVillage: (
    <path d="M3.5 19.5H20.5M7 19.5C7 14.5 9.2 12 12 12C14.8 12 17 14.5 17 19.5M10.8 19.5V17.5A1.2 1.2 0 0 1 13.2 17.5V19.5M12 12V7L15.5 8.5L12 10" />
  ),
  eraTown: (
    <path d="M4 20H20M12 20V12M12 15.5C9.5 14.5 8 12.5 8 9.5V7M8 9.5C6.5 9 5.5 8 5.5 6.5M12 13C14.5 12 16 10 16 7V5M16 9.5C17.5 9.5 18.5 8.5 18.5 7" />
  ),
  eraCity: <path d="M4 20H20M5.5 20V12.5H9.5V20M9.5 20V8.5A2.5 2.5 0 0 1 14.5 8.5V20M14.5 20V14H18.5V20M12 6V4" />,
  eraCapital: (
    <path d="M3.5 20H20.5M8 20V13C8 10.5 10 9 12 7.5C14 9 16 10.5 16 13V20M4.5 20V12L6 10.5L7.5 12V20M16.5 20V12L18 10.5L19.5 12V20M12 7.5V4.5M10.8 20V17.5A1.2 1.2 0 0 1 13.2 17.5V20" />
  ),
} satisfies Record<string, React.ReactNode>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/**
 * 아이콘 한 개. title이 없으면 장식(aria-hidden), 있으면 이름 붙은 img.
 * 선 굵기: 기본 2, 12px 이하(상태 칩 점 안)는 보드대로 3.
 */
export function Icon({
  name,
  size = 24,
  title,
  strokeWidth = size <= 12 ? 3 : 2,
}: {
  name: IconName;
  size?: number;
  title?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      data-icon={name}
    >
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}

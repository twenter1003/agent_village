// /dev/icons — 캔버스 03 아이콘 24종(Type) + 바다 03 바뀌는 8개(SeaUI)와 나란히 비교. 칸 = 보드의 .ib (44, 테두리 2, 모서리 12)
import { ICON_NAMES, Icon } from '../icons/Icon';

const box: React.CSSProperties = {
  width: 44,
  height: 44,
  boxSizing: 'border-box',
  border: 'var(--ui-line-sm) solid var(--ink)',
  borderRadius: 'var(--r-btn)',
  background: 'var(--cream)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
// 상태 칩 점 (03 문서 5장: 20 원 + 아이콘 12)
const dot: React.CSSProperties = {
  ...box,
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: 'var(--st-working)',
};

export function Icons() {
  return (
    <main style={{ padding: '32px 48px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>icons · {ICON_NAMES.length}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 96px)', gap: 'var(--sp-4) var(--sp-2)' }}>
        {ICON_NAMES.map((n) => (
          <figure key={n} style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={box}>
                <Icon name={n} />
              </div>
              <div style={dot}>
                <Icon name={n} size={12} />
              </div>
            </div>
            <figcaption style={{ font: '11px var(--font-mono)', color: 'var(--text-2)' }}>{n}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}

// /dev/ui — UI 키트 전 컴포넌트·상태 (캔버스 Controls · Cards · SeaUI 보드와 나란히 비교, 03 문서 5장)
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  Chip,
  FilterChip,
  IconButton,
  JobChip,
  MbtiChip,
  StatusChip,
  Toast,
  Toggle,
  VillageProgress,
  type ButtonProps,
} from '../ui';
import type { MemberStatus } from '@tycoon/core';
import type { Slot } from '../assets/sea/Asset';
import { t } from '../i18n';

// ponytail: 보기용 아이콘 경로 몇 개 (Type · SeaUI 보드). 실제 화면은 icons 모듈을 넘긴다.
const ic = (d: string, size = 22, width = 2) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);
const D = {
  working: 'M5 19.5L13 11.5M10.5 6.5L14.5 3.5L20.5 9.5L17.5 13.5Z',
  meeting:
    'M5 5.5H19A1.5 1.5 0 0 1 20.5 7V15A1.5 1.5 0 0 1 19 16.5H11L7 19.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z',
  resting: 'M19 14.5A7.5 7.5 0 1 1 9.5 5A6 6 0 0 0 19 14.5Z',
  blocked: 'M12 4L20.5 19H3.5Z',
  bell: 'M6 16V11A6 6 0 0 1 18 11V16L19.5 18H4.5ZM10 20.5A2 2 0 0 0 14 20.5',
  plus: 'M12 5V19M5 12H19',
  minus: 'M5 12H19',
  sparkle: 'M10 4L11.6 9.4L17 11L11.6 12.6L10 18L8.4 12.6L3 11L8.4 9.4Z',
  alert: 'M12 4L20.5 19H3.5ZM12 10V14M12 16.8V17',
  village: 'M12 4L20.5 8.5L12 13L3.5 8.5ZM3.5 12.5L12 17L20.5 12.5',
  grid: 'M5.5 4H9.5A1.5 1.5 0 0 1 11 5.5V9.5A1.5 1.5 0 0 1 9.5 11H5.5A1.5 1.5 0 0 1 4 9.5V5.5A1.5 1.5 0 0 1 5.5 4ZM14.5 4H18.5A1.5 1.5 0 0 1 20 5.5V9.5A1.5 1.5 0 0 1 18.5 11H14.5A1.5 1.5 0 0 1 13 9.5V5.5A1.5 1.5 0 0 1 14.5 4ZM5.5 13H9.5A1.5 1.5 0 0 1 11 14.5V18.5A1.5 1.5 0 0 1 9.5 20H5.5A1.5 1.5 0 0 1 4 18.5V14.5A1.5 1.5 0 0 1 5.5 13ZM14.5 13H18.5A1.5 1.5 0 0 1 20 14.5V18.5A1.5 1.5 0 0 1 18.5 20H14.5A1.5 1.5 0 0 1 13 18.5V14.5A1.5 1.5 0 0 1 14.5 13Z',
};

const meta: CSSProperties = { fontSize: 'var(--fs-min)', lineHeight: 'var(--lh-min)', color: 'var(--text-2)' };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' };
const h2: CSSProperties = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 22 };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 22px' }}>
      <h2 style={h2}>{title}</h2>
      {children}
    </Card>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={row}>
      <span style={{ width: 120, flexShrink: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>{label}</span>
      {children}
    </div>
  );
}

const states = ['기본', '올림', '눌림', '비활성', '키보드 포커스'] as const;
const force: Record<(typeof states)[number], Partial<ButtonProps> & { 'data-state'?: string }> = {
  기본: {},
  올림: { 'data-state': 'hover' },
  눌림: { 'data-state': 'active' },
  비활성: { disabled: true },
  '키보드 포커스': { 'data-state': 'focus' },
};
const variants: [ButtonProps['variant'], string, string][] = [
  ['primary', '주 버튼', '가구 사기'],
  ['secondary', '보조 버튼', '집 구경'],
  ['quiet', '조용한 버튼', '모두 읽음'],
  ['danger', '위험 버튼', '가구 팔기'],
];
const statuses: MemberStatus[] = ['working', 'meeting', 'resting', 'blocked'];
const slots: [Slot, string][] = [
  [1, '백엔드'],
  [2, '프론트엔드'],
  [3, 'QA'],
  [4, '팀장'],
  [5, '디자인'],
  [6, '문서'],
  ['x', '외부인 · Plan'],
];
const filters = ['전체', '작업', '회의', '경제', '성격'];

export function Ui() {
  const [view, setView] = useState<'village' | 'grid'>('village');
  const [filter, setFilter] = useState('전체');
  const [selected, setSelected] = useState(true);
  const [toasts, setToasts] = useState({ auto: 1, meeting: true, alert: true });

  return (
    <main style={{ padding: '44px 56px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1328 }}>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 40 }}>UI 키트</h1>

      <Section title="버튼">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '140px repeat(5, max-content)',
            gap: '16px 28px',
            alignItems: 'center',
          }}
        >
          <span />
          {states.map((s) => (
            <span key={s} style={meta}>
              {s}
            </span>
          ))}
          {variants.map(([v, name, text]) => (
            <Row key={v} name={name}>
              {states.map((s) => (
                <Button key={s} variant={v} {...force[s]}>
                  {s === '비활성' && v === 'primary' ? '진주 부족' : text}
                </Button>
              ))}
            </Row>
          ))}
        </div>
        <Line label="M 36">
          <Button size="m" variant="primary">
            사기
          </Button>
          <Button size="m">자세히</Button>
          <Button size="m" variant="danger">
            팔기
          </Button>
          <Button size="m" disabled>
            자세히
          </Button>
        </Line>
        <Line label="아이콘 버튼 44">
          <IconButton aria-label="알림 3개" icon={ic(D.bell)} badge={3} />
          <IconButton aria-label="확대" icon={ic(D.plus)} />
          <IconButton aria-label="축소" icon={ic(D.minus)} />
          <IconButton aria-label="축소" icon={ic(D.minus)} disabled />
        </Line>
        <Line label="전환 토글">
          <Toggle
            label="보기 방식"
            value={view}
            onChange={setView}
            options={[
              { value: 'village', label: '마을', icon: ic(D.village, 18) },
              { value: 'grid', label: '격자', icon: ic(D.grid, 18) },
            ]}
          />
        </Line>
      </Section>

      <Section title="칩">
        <Line label="상태">
          {statuses.map((s) => (
            <StatusChip key={s} status={s} icon={ic(D[s], 12, 3)} />
          ))}
          <StatusChip status="resting" icon={ic(D.resting, 12, 3)}>
            {t('status.restOnRock')}
          </StatusChip>
        </Line>
        <Line label="직업">
          {slots.map(([s, name]) => (
            <JobChip key={s} slot={s}>
              {name}
            </JobChip>
          ))}
        </Line>
        <Line label="직업 · 작은">
          {slots.map(([s, name]) => (
            <JobChip key={s} slot={s} sm>
              {name}
            </JobChip>
          ))}
        </Line>
        <Line label="MBTI">
          <MbtiChip letters="ISTJ" />
          <MbtiChip letters="ISTJ" drifting={{ axis: 'TF', toward: 'F', percent: 38 }} />
          <MbtiChip letters="ISTP" drifting={{ axis: 'TF', toward: 'F', percent: 38 }} sm />
          <MbtiChip letters="ENTJ" sm />
          <span style={meta}>변하는 중인 글자만 라벤더 · 툴팁</span>
        </Line>
        <Line label="필터">
          <div role="group" aria-label="활동 기록 필터" style={row}>
            {filters.map((f) => (
              <FilterChip key={f} selected={f === filter} onClick={() => setFilter(f)}>
                {f}
              </FilterChip>
            ))}
          </div>
        </Line>
        <Line label="기본 칩 · 뱃지">
          {/* 상단 바 마을 기금 칩 글자 (D21 — 물가 칩은 D20으로 뺐다) */}
          <Chip>
            {t('economy.fund')} <span style={{ fontFamily: 'var(--font-display)' }}>156</span>
          </Chip>
          <Badge count={3} />
          <Badge count={120} />
          <Badge count={0} />
          <span style={meta}>0은 안 그림</span>
        </Line>
      </Section>

      <Section title="카드">
        <div style={row}>
          <Card style={{ width: 300 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-card)' }}>기본 카드</span>
          </Card>
          <Card selected={selected} style={{ width: 300 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-card)' }}>
              선택 {selected ? '됨' : '안 됨'}
            </span>{' '}
            <Button size="m" variant="quiet" onClick={() => setSelected(!selected)}>
              바꾸기
            </Button>
          </Card>
        </div>
      </Section>

      <Section title="토스트">
        <div style={{ ...row, alignItems: 'flex-start', gap: 16 }}>
          {toasts.auto > 0 && (
            <Toast
              key={toasts.auto}
              icon={ic(D.sparkle, 24)}
              title="수달의 해초 카페 완공!"
              desc="작업 4개 · 기여 수달 3 · 물범 1 · 진주 +80"
              duration={5000}
              onDone={() => setToasts((s) => ({ ...s, auto: 0 }))}
            />
          )}
          {toasts.meeting && (
            <Toast
              icon={ic(D.meeting, 24)}
              tint="var(--meeting-tint)"
              title="광장 회의 시작"
              desc="물범 · 수달 · 바다거북 — 결제 API 스키마"
              action={<Button size="m">광장 보기</Button>}
              onDone={() => setToasts((s) => ({ ...s, meeting: false }))}
            />
          )}
          {toasts.alert && (
            <Toast
              alert
              icon={ic(D.alert, 24)}
              tint="var(--slot2-tint)"
              title="햄스터가 막혔어요"
              desc="테스트가 3번 연달아 실패했어요 · 초소 현장"
              onDone={() => setToasts((s) => ({ ...s, alert: false }))}
            />
          )}
        </div>
        <div style={row}>
          <Button size="m" onClick={() => setToasts((s) => ({ auto: s.auto + 1, meeting: true, alert: true }))}>
            다시 띄우기
          </Button>
          <span style={meta}>완공은 5초 뒤 사라짐 (아래 막대) · 회의·막힘은 닫을 때까지</span>
        </div>
      </Section>

      <Section title="진행 표시">
        <Line label="다음 레벨">
          <VillageProgress done={12} total={20} label={t('level.progress')} />
          <span style={meta}>{t('level.sub', { points: '8,000', need: '10,000', fund: '3,200', cost: '6,500' })}</span>
          <VillageProgress done={0} total={20} label="0%" />
          <VillageProgress done={20} total={20} label="100%" />
        </Line>
      </Section>
    </main>
  );
}

// 그리드 한 줄: 이름 칸 + 상태 5칸
function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{name}</span>
      {children}
    </>
  );
}

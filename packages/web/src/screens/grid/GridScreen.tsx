// 격자 보기 (01 문서 8.3 화면 메모 M9, 캔버스 SeaScreenGrid): 팀원 집 카드 줄 + 팀원 일터 카드 줄 + 공사 중 칩 (06 문서 5장).
// 그림 모양·순서는 마을과 같은 sceneFromState (정본 id → 바다 id). 카드·칩은 모두 링크 → 상세. 위 80px은 MainScreen 토글 줄 몫
import { slotTone } from '@tycoon/core';
import { useMemo, type MouseEvent } from 'react';
import type { GameConfig, VillageState } from '@tycoon/core';
import { t } from '../../i18n';
import { Icon } from '../../icons/Icon';
import type { MemberView } from '../../live/movement';
import { sceneFromState, toAccessory, toSpecies, workplaceName } from '../../live/sceneFromState';
import { Critter } from '../../render/Critter';
import { Chip, JobChip, StatusChip, VillageProgress } from '../../ui';
import { DEPARTED_OPACITY, OwnedBuilding, type SceneBuilding } from '../../world/Village';
import { Face, look } from '../building/BuildingScreen';
import { statusText } from '../TeamPanel';
import './grid.css';

export type GridTarget = { screen: 'building' | 'house'; id: string };

export interface GridScreenProps {
  state: VillageState;
  cfg: GameConfig;
  /** 팀원 카드와 같은 상태·곳 (live/movement memberViews) */
  views?: ReadonlyMap<string, MemberView>;
  /** 카드 링크 주소 (새 탭·주소 복사용) */
  hrefOf: (v: GridTarget) => string;
  /** 카드 누르기 → 같은 페이지에서 상세 (보통 클릭만. 새 탭 클릭은 브라우저에 맡긴다) */
  onOpen: (v: GridTarget) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

/** 그림 칸 170: 건물 배율 1, 1층 -84 · 2층 -72 (캔버스). 주인이 있으면 마을처럼 얼굴 간판 (06 문서 7장) */
function Illo({ b }: { b: SceneBuilding }) {
  return (
    <div className={`gs-card__illo${b.body.endsWith('2f') ? ' gs-card__illo--2f' : ''}`}>
      <OwnedBuilding {...b} />
    </div>
  );
}

export function GridScreen({ state: s, cfg, views, hrefOf, onOpen }: GridScreenProps) {
  const scene = useMemo(() => sceneFromState(s, cfg), [s, cfg]);
  const shapes = useMemo(() => new Map(scene.buildings.map((b) => [b.id, b])), [scene]);
  const link = (to: GridTarget) => ({
    href: hrefOf(to),
    onClick: (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // 새 탭·창은 브라우저
      e.preventDefault();
      onOpen(to);
    },
  });

  const members = Object.values(s.members)
    .filter((m) => s.houses[m.id])
    .sort((a, b) => a.slot - b.slot);
  // 부지 잡은 순 = 마을 장면 순서
  const works = scene.buildings.flatMap((sb) => {
    const b = sb.id.startsWith('work:') ? s.buildings[sb.id.slice(5)] : undefined;
    return b ? [{ b, sb }] : [];
  });
  const cards = works.filter((w) => w.b.floor > 0);
  const sites = works.filter((w) => w.b.floor === 0);

  return (
    <section className="gs" aria-label={t('grid.label')}>
      <div className="gs__head">
        <h2>{t('grid.houses')}</h2>
        <span className="gs-meta">{t('grid.housesMeta', { n: members.length, currency: t('currency') })}</span>
      </div>
      {members.length === 0 ? (
        <p className="gs-empty">{t('grid.noHouses')}</p>
      ) : (
        <div className="gs__cards">
          {members.map((m) => {
            const status = views?.get(m.id)?.status ?? m.status;
            const sb = shapes.get(`house:${m.id}`);
            return (
              <a
                key={m.id}
                className="gs-card"
                data-house={m.id}
                style={m.departed ? { opacity: DEPARTED_OPACITY } : undefined}
                {...link({ screen: 'house', id: m.id })}
              >
                {sb && <Illo b={sb} />}
                <div className="gs-card__body">
                  <div className="gs-card__row">
                    <span
                      className="gs-face"
                      style={{ background: `var(--slot${slotTone(m.slot)}-tint)` }}
                      aria-hidden="true"
                    >
                      <Critter
                        species={toSpecies(m.species)}
                        variant={m.variant}
                        accessory={toAccessory(m.accessory)}
                        mode="face"
                        scale={0.3}
                        animate={false}
                      />
                    </span>
                    <span className="gs-card__name">{t('house.title', { name: m.name })}</span>
                  </div>
                  <div className="gs-card__row">
                    {m.departed ? (
                      <span className="gs-meta">{t('team.departed')}</span>
                    ) : (
                      <StatusChip status={status} icon={<Icon name={status} size={12} />}>
                        {statusText(m, status, views?.get(m.id))}
                      </StatusChip>
                    )}
                  </div>
                  <div className="gs-card__row gs-meta">
                    <span>
                      {t('grid.furniture', {
                        n: m.furniture.length,
                        m: m.furniture.filter((f) => f.placed !== null).length,
                      })}
                    </span>
                    <span className="gs-bal">
                      <Icon name="coin" size={16} title={t('currency')} />
                      {fmt(m.balance)}
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}

      <div className="gs__head gs__head--works">
        <h2>{t('grid.works')}</h2>
        <span className="gs-meta">
          {t('grid.worksMeta', {
            n: works.length,
            site: sites.length,
            waiting: works.filter((w) => w.b.waiting).length,
          })}
        </span>
      </div>
      {works.length === 0 && <p className="gs-empty">{t('grid.noWorks')}</p>}
      {cards.length > 0 && (
        <div className="gs__cards">
          {cards.map(({ b, sb }) => {
            const m = s.members[b.memberId];
            const next = cfg.workplace.levels[b.floor];
            return (
              <a
                key={b.id}
                className="gs-card"
                data-building={b.id}
                style={m?.departed ? { opacity: DEPARTED_OPACITY } : undefined}
                {...link({ screen: 'building', id: b.id })}
              >
                <Illo b={sb} />
                <div className="gs-card__body">
                  <div className="gs-card__row">
                    <span className="gs-card__name">{workplaceName(s, cfg, b)}</span>
                    <JobChip slot={sb.slot ?? 'x'} sm>
                      {look(cfg, m?.job, b.floor).type}
                    </JobChip>
                    <span className="gs-meta gs-end">{t(`workplace.floor.${Math.min(b.floor, 4)}`)}</span>
                  </div>
                  <div className="gs-card__row">
                    {next && (
                      <VillageProgress
                        className="gs-gauge"
                        done={b.points}
                        total={next.points}
                        label={t('workplace.gaugeLabel')}
                      />
                    )}
                    <span className="gs-meta">
                      {next
                        ? t('grid.gauge', { points: fmt(Math.floor(b.points)), next: fmt(next.points) })
                        : t('grid.gaugeMax')}
                    </span>
                    {b.waiting && next && (
                      <Chip sm data-waiting={b.waiting}>
                        {b.waiting === 'materials'
                          ? t('workplace.waiting.materials')
                          : t('workplace.waiting.level', { n: next.level })}
                      </Chip>
                    )}
                    {/* 이름을 바꿔도 주인은 읽힌다 (얼굴은 장식) */}
                    <span
                      className="gs-faces gs-end"
                      role="img"
                      aria-label={t('grid.owner', { name: m?.name ?? b.memberId })}
                    >
                      <Face s={s} cfg={cfg} id={b.memberId} />
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
      {sites.length > 0 && (
        <div className="gs__sites">
          {sites.map(({ b }) => (
            <a key={b.id} className="gs-chip" data-building={b.id} {...link({ screen: 'building', id: b.id })}>
              {t('grid.site', { stage: t('workplace.floor.0'), name: workplaceName(s, cfg, b) })}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

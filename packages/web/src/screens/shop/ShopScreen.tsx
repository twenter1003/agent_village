// 가구 상점 (01 문서 8.6, 03 문서 6장: 목록 1000 4열 + 미리보기 패널 440, 캔버스 SeaScreenShop). 상단 바는 밖에서 얹는다.
// 가격 = core furniturePrice (기준가 고정, D20), 놓일 자리 = core findSpot (서버가 살 때와 같은 규칙). 산 결과는 SSE 스냅샷이 가져온다.
// 팀장 가구는 마을 기금으로 산다 (D21 — 팀장 지갑 = 기금).
import { findSpot, furniturePrice, type GameConfig, type Member, type VillageState, slotTone } from '@tycoon/core';
import { useId, useState, type KeyboardEvent } from 'react';
import { asset, Prop } from '../../assets/sea/Asset';
import { t } from '../../i18n';
import { Icon } from '../../icons/Icon';
import { toAccessory, toSpecies } from '../../live/sceneFromState';
import { Critter } from '../../render/Critter';
import { fabricSlot, furnitureAsset, RoomScene, type RoomItem } from '../../room/RoomScene';
import { Button, Chip } from '../../ui';
import { purchase } from './api';
import './shop.css';

const CARD = 1.25; // 카드 그림 배율 (캔버스)
const PREVIEW = 0.75; // 놓아 보기: 6×6 방을 250 높이 상자에
const TABS = ['all', 'rest', 'work', 'decor'] as const;
type Tab = (typeof TABS)[number];
const fmt = (n: number) => n.toLocaleString('ko-KR');

/** 탭·라디오 묶음 키보드 (ARIA 탭·라디오 패턴): 고른 것만 Tab 자리, ←/→(↑/↓)·Home/End로 옆 것을 고르고 포커스 */
function onRovingKey(e: KeyboardEvent<HTMLButtonElement>) {
  const me = e.currentTarget;
  const all = [...(me.parentElement?.querySelectorAll<HTMLButtonElement>(`[role="${me.getAttribute('role')}"]`) ?? [])];
  const i = all.indexOf(me);
  const j = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: -1 }[e.key];
  const to = j === undefined ? undefined : all.at(j % all.length);
  if (!to) return;
  e.preventDefault();
  to.click();
  to.focus();
}

/** 천 색 기본값: 그 팀원이 아직 없는 색 중 첫째 (02 문서 6.2 "두 번째부터 다른 색"). 천 가구가 아니면 null */
export function defaultFabric(m: Member, kind: string, cfg: GameConfig): string | null {
  if (!cfg.furniture.find((f) => f.id === kind)?.fabric) return null;
  const has = (c: string) => m.furniture.some((f) => f.kind === kind && f.fabric === c);
  return cfg.fabricColors.find((c) => !has(c)) ?? cfg.fabricColors[0] ?? null;
}

export interface ShopScreenProps {
  state: VillageState;
  /** 수집기가 투영에 쓰는 설정 (SSE config) — 가격·자리가 서버와 같게 */
  cfg: GameConfig;
  projectId: string;
  /** 처음 고른 사는 팀원 (화면 안에서 바꿀 수 있음) */
  memberId: string;
  /** 마을로 돌아가기 */
  onBack: () => void;
  /** 다른 화면으로 (그 팀원 집). 없으면 "집으로" 대신 마을로 */
  onNavigate?: (to: { screen: 'shop' | 'house'; memberId: string }) => void;
}

export function ShopScreen({ state: s, cfg, projectId, memberId, onBack, onNavigate }: ShopScreenProps) {
  const buyers = Object.values(s.members)
    .filter((m) => !m.departed && m.movedInAt !== null) // 입주 전은 방이 없다 (01 문서 3.3)
    .sort((a, b) => a.slot - b.slot);
  const [buyerId, setBuyerId] = useState(memberId);
  const [tab, setTab] = useState<Tab>('all');
  const [kind, setKind] = useState(cfg.furniture[0]?.id ?? '');
  const [fabrics, setFabrics] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; alert: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useId();

  const buyer = buyers.find((m) => m.id === buyerId) ?? buyers[0];
  if (!buyer)
    return (
      <div className="sh sh--missing" role="status">
        <p>{t('shop.noMembers')}</p>
        <Button onClick={onBack}>{t('house.back')}</Button>
      </div>
    );

  /** 사는 사람의 지갑: 팀원 = 잔고, 팀장 = 마을 기금 (D21) */
  const walletOf = (m: Member) => (m.isLeader ? s.economy.fund : m.balance);
  const toHouse = () => (onNavigate ? onNavigate({ screen: 'house', memberId: buyer.id }) : onBack());
  const name = (k: string) => t(`furniture.${k}`);
  const priceOf = (k: string) => furniturePrice(k, cfg) ?? 0;
  const fabricOf = (k: string) =>
    cfg.furniture.find((f) => f.id === k)?.fabric ? (fabrics[k] ?? defaultFabric(buyer, k, cfg)) : null;
  const shown = cfg.furniture.filter((f) => tab === 'all' || f.tag === tab);
  const count = (x: Tab) => cfg.furniture.filter((f) => x === 'all' || f.tag === x).length;

  // 오른쪽: 고른 가구
  const f = cfg.furniture.find((x) => x.id === kind);
  const fabric = fabricOf(kind);
  const price = priceOf(kind);
  const spot = findSpot(buyer, kind, cfg); // null = 창고 (자리가 없거나 밖 가구, 01 문서 8.4)
  const items: RoomItem[] = buyer.furniture.flatMap((x) =>
    x.placed ? [{ id: x.id, kind: x.kind, fabric: x.fabric, placed: x.placed }] : [],
  );
  if (spot) items.push({ id: 'preview', kind, fabric, placed: spot });
  const have = walletOf(buyer);
  const short = price - have;

  const buy = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await purchase(projectId, buyer.id, kind, fabric);
      setMsg(
        r === 'ok'
          ? { text: t('shop.bought', { name: name(kind) }), alert: false }
          : { text: t(buyer.isLeader ? 'shop.poorFund' : 'shop.poor'), alert: true },
      );
    } catch (x) {
      setMsg({ text: t('shop.failed', { why: x instanceof Error ? x.message : String(x) }), alert: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sh">
      <main className="sh-list">
        <div className="sh-head">
          <div className="sh-title">
            <nav aria-label={t('shop.where')}>
              <button type="button" className="sh-link" onClick={toHouse}>
                {onNavigate ? t('shop.toHouse') : t('house.back')}
              </button>
            </nav>
            <h1 className="sh-h1">{t('shop.title')}</h1>
          </div>
          <div role="radiogroup" aria-label={t('shop.buyers')} className="sh-buyers">
            <span className="sh-meta">{t('shop.buyer')}</span>
            {buyers.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === buyer.id}
                tabIndex={m.id === buyer.id ? 0 : -1}
                onKeyDown={onRovingKey}
                className="sh-who"
                data-member={m.id}
                onClick={() => {
                  setBuyerId(m.id);
                  setMsg(null);
                }}
              >
                <span
                  className="sh-face"
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
                {m.isLeader ? `${m.name} · ${t('economy.fund')}` : m.name} {fmt(walletOf(m))}
              </button>
            ))}
          </div>
        </div>

        <div role="tablist" aria-label={t('shop.kinds')} className="sh-tabs">
          {TABS.map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={x === tab}
              aria-controls={panel}
              tabIndex={x === tab ? 0 : -1}
              onKeyDown={onRovingKey}
              className="sh-tab"
              onClick={() => setTab(x)}
            >
              {x === 'all' ? t('shop.all') : t(`furniture.tag.${x}`)} {count(x)}
            </button>
          ))}
        </div>

        <div id={panel} role="tabpanel" aria-label={t('shop.kinds')} className="sh-grid">
          {shown.map((x) => {
            const id = furnitureAsset(x.id);
            const [, ay = 0] = (asset(id).data.anchor ?? '').split(',').map(Number);
            const fab = fabricOf(x.id);
            const p = priceOf(x.id);
            const owned = buyer.furniture.filter((o) => o.kind === x.id).length;
            const picked = x.id === kind;
            const size = x.against
              ? t('furniture.wall')
              : x.outdoor
                ? t('furniture.outdoor')
                : t(`furniture.tiles.${x.tiles}`);
            return (
              <article key={x.id} className={`ui-card sh-item${picked ? ' ui-card--selected' : ''}`} data-kind={x.id}>
                <div className="sh-illo" aria-hidden="true">
                  <div style={{ marginTop: 100 - ay * CARD }}>
                    <Prop kind={id} scale={CARD} fab={fabricSlot(fab)} />
                  </div>
                </div>
                <div className="sh-bd">
                  <div className="sh-row">
                    <h2 className="sh-name">{name(x.id)}</h2>
                    <span className="sh-meta">
                      {size} · {t(`furniture.tag.${x.tag}`)}
                    </span>
                  </div>
                  {owned > 0 && <Chip className="sh-owned">{t('shop.owned', { n: owned })}</Chip>}
                  {x.against && <span className="sh-meta">{t('shop.wallOnly')}</span>}
                  {x.outdoor && <span className="sh-meta">{t('shop.yard')}</span>}
                  {fab !== null && (
                    <div role="radiogroup" aria-label={t('shop.fabric')} className="sh-swatches">
                      {cfg.fabricColors.map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={c === fab}
                          aria-label={t(`furniture.fabric.${c}`)}
                          tabIndex={c === fab ? 0 : -1}
                          onKeyDown={onRovingKey}
                          className="sh-sw"
                          style={{ background: `var(--slot${fabricSlot(c)})` }}
                          onClick={() => {
                            setFabrics((d) => ({ ...d, [x.id]: c }));
                            setKind(x.id);
                          }}
                        />
                      ))}
                    </div>
                  )}
                  <div className="sh-row sh-buyrow">
                    <span className="sh-price">
                      <span className="sh-amount">
                        <Icon name="coin" size={18} title={t('currency')} />
                        <span className="sh-num">{fmt(p)}</span>
                      </span>
                    </span>
                    <Button
                      size="m"
                      aria-pressed={picked}
                      aria-label={`${name(x.id)} ${picked ? t('shop.picked') : t('shop.pick')}`}
                      onClick={() => {
                        setKind(x.id);
                        setMsg(null);
                      }}
                    >
                      {picked ? t('shop.picked') : t('shop.pick')}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </main>

      <aside className="sh-side" aria-label={t('shop.preview', { name: buyer.name })}>
        <h2 className="sh-h2">{t('shop.preview', { name: buyer.name })}</h2>
        <div className="sh-preview">
          <RoomScene
            className="sh-room"
            cfg={cfg}
            items={items}
            scale={PREVIEW}
            label={t('shop.previewScene', { name: buyer.name })}
            who={{
              species: toSpecies(buyer.species),
              variant: buyer.variant,
              accessory: toAccessory(buyer.accessory),
              pose: 'cheer',
            }}
            mark={spot ? { kind, placed: spot, ok: true } : null}
          />
        </div>
        <span className="sh-meta" data-spot={spot ? `${spot.x},${spot.y},${spot.rot}` : 'storage'}>
          {spot ? t('shop.previewHint') : f?.outdoor ? t('shop.yard') : t('shop.toStorage')}
        </span>

        <div className="sh-sum">
          <div className="sh-row">
            <span className="sh-sumname">
              {name(kind)}
              {fabric !== null && ` · ${t(`furniture.fabric.${fabric}`)}`}
            </span>
            <span className="sh-amount">
              <Icon name="coin" size={18} title={t('currency')} />
              <span className="sh-num" data-price={price}>
                {fmt(price)}
              </span>
            </span>
          </div>
          <div className="sh-row">
            <span>{buyer.isLeader ? t('economy.fund') : t('shop.balanceOf', { name: buyer.name })}</span>
            <span className="sh-num">
              {fmt(have)} → {short > 0 ? '—' : fmt(have - price)}
            </span>
          </div>
        </div>

        {short > 0 && (
          <p className="sh-short">
            <Icon name="blocked" size={16} />
            {t('shop.short', { c: t('currency'), n: fmt(short) })}
          </p>
        )}
        <div className="sh-actions">
          <Button className="sh-grow" variant="primary" disabled={busy || short > 0} onClick={() => void buy()}>
            {t('shop.buy', { n: fmt(price), c: t('currency') })}
          </Button>
          <Button onClick={toHouse}>{t('shop.cancel')}</Button>
        </div>
        {/* 성공은 늘 있는 status 칸에(숨겼다 보이면 못 읽음), 실패는 넣는 순간 읽히는 alert */}
        <p className="sh-msg" role="status">
          {msg && !msg.alert ? msg.text : ''}
        </p>
        {msg?.alert && (
          <p className="sh-msg sh-msg--alert" role="alert">
            {msg.text}
          </p>
        )}
        <p className="sh-explain">{t('shop.explain')}</p>
      </aside>
    </div>
  );
}

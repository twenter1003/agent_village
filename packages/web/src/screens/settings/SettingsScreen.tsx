// 설정 (01 문서 10장 화면 메모 M9): 팀원 동물·직업·소품 + 게임 하루(이 마을 tycoon.json) · 표시(이 브라우저) · 훅 설치 안내.
// 동물·소품은 바다 이름으로 고르고 정본 id로 보낸다 (05 문서 3.2). 저장은 바꾼 것만
import { useState, type FormEvent } from 'react';
import {
  ACCESSORY_IDS,
  SPECIES_IDS,
  type GameConfig,
  type Member,
  type MemberConf,
  type VillageState,
  slotTone,
} from '@tycoon/core';
import { t } from '../../i18n';
import { Icon } from '../../icons/Icon';
import { reducedMotion, setPrefs, usePrefs, ZOOMS, type Zoom } from '../../live/prefs';
import { toAccessory, toSpecies } from '../../live/sceneFromState';
import { Critter } from '../../render/Critter';
import { rig } from '../../render/rig';
import { Button, Toggle } from '../../ui';
import { saveSettings, type SettingsBody } from './api';
import { HookGuide } from './HookGuide';
import './settings.css';

export interface SettingsScreenProps {
  state: VillageState;
  cfg: GameConfig;
  projectId: string;
  onBack: () => void;
  /** 마을 폴더 (tycoon.json 위치 안내) */
  cwd: string;
  /** 수집기 연결 (훅 설치 안내) */
  connected: boolean;
  /** 설명서 링크 (06 문서 11장, M17이 화면에 붙인다) */
  onGuide?: () => void;
}

type Conf = Required<MemberConf>;
const confOf = (m: Member): Conf => ({ species: m.species, job: m.job, accessory: m.accessory });
/** 사전에 없는 직업(사용자 프리셋)은 id 그대로 */
const jobLabel = (job: string) => (t(`jobs.${job}`) === `jobs.${job}` ? job : t(`jobs.${job}`));
/** 바다 소품 하나에 정본이 여럿이면 첫 키 (headlamp → glasses, 05 문서 3.2) */
const ACCESSORIES = ACCESSORY_IDS.filter(
  (a, i) => ACCESSORY_IDS.findIndex((b) => toAccessory(b) === toAccessory(a)) === i,
);
const DAY_MAX_MIN = 1440;

export function SettingsScreen({ state: s, cfg, projectId, onBack, cwd, connected, onGuide }: SettingsScreenProps) {
  const prefs = usePrefs();
  const [edits, setEdits] = useState<Record<string, Partial<Conf>>>({});
  const [day, setDay] = useState<string | null>(null); // 손대기 전엔 설정값
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean }[]>([]);

  const members = Object.values(s.members)
    .filter((m) => !m.departed)
    .sort((a, b) => a.slot - b.slot);
  const value = (m: Member): Conf => ({ ...confOf(m), ...edits[m.id] });
  const edit = (id: string, p: Partial<Conf>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...p } }));
  const jobs = [...cfg.jobPresets.map((p) => p.id), cfg.fallbackPreset.id];
  const dayMin = cfg.time.gameDayMs / 60_000;
  const dayNum = day === null ? dayMin : Number(day);
  const dayOk = day === null || (Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= DAY_MAX_MIN);
  const changed = members.filter((m) => JSON.stringify(value(m)) !== JSON.stringify(confOf(m)));
  const dirty = changed.length > 0 || (day !== null && dayNum !== dayMin);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !dayOk || busy) return;
    const body: SettingsBody = {};
    for (const m of changed)
      if (m.isLeader) body.leader = value(m);
      else (body.members ??= {})[m.id] = value(m);
    if (day !== null && dayNum !== dayMin) body.gameDayMs = dayNum * 60_000;
    setBusy(true);
    setMsg([{ text: t('settings.saving') }]);
    try {
      const r = await saveSettings(projectId, body);
      setEdits({});
      setDay(null);
      setMsg([
        { text: t('settings.saved', { path: r.path }) },
        ...(r.backup ? [{ text: t('settings.backup', { path: r.backup }) }] : []),
      ]);
    } catch (err) {
      const why = (err as Error).message;
      const known = why === 'unreadable';
      setMsg([{ text: known ? t(`settings.why.${why}`) : t('settings.failed', { why }), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const onOff = [
    { value: 'on', label: t('settings.on') },
    { value: 'off', label: t('settings.off') },
  ] as const;
  return (
    <div className="st">
      <div className="st-head">
        <button type="button" className="st-back" onClick={onBack}>
          {t('settings.village')}
        </button>
        <h1 className="st-title">{t('settings.title')}</h1>
        {onGuide && (
          <button type="button" className="st-back st-guide" onClick={onGuide}>
            <Icon name="help" size={18} />
            {t('guide.open')}
          </button>
        )}
      </div>
      <div className="st-cols">
        {/* 브라우저 기본 검사는 끈다: 하루 길이가 분 단위가 아니면(e2e 2초) 손대지 않은 칸이 저장을 막았다. 검사는 dayOk (01 문서 10장) */}
        <form className="st-col" noValidate onSubmit={(e) => void submit(e)}>
          <section className="ui-card st-card" aria-labelledby="st-members">
            <h2 id="st-members">{t('settings.members')}</h2>
            <p className="st-meta">{t('settings.membersMeta', { cwd })}</p>
            {members.length === 0 && <p className="st-meta">{t('settings.noMembers')}</p>}
            {members.map((m) => {
              const v = value(m);
              const species = toSpecies(v.species);
              const locked = rig.lockedAccessory[species];
              return (
                <fieldset key={m.id} className="st-member" data-member={m.id}>
                  <legend className="st-member__name">
                    <span
                      className="st-face"
                      style={{ background: `var(--slot${slotTone(m.slot)}-tint)` }}
                      aria-hidden="true"
                    >
                      <Critter
                        species={species}
                        variant={v.species === m.species ? m.variant : 0}
                        accessory={toAccessory(v.accessory)}
                        mode="face"
                        scale={0.4}
                        animate={false}
                      />
                    </span>
                    {m.name}
                  </legend>
                  <label className="st-field">
                    <span>{t('settings.species')}</span>
                    <select value={v.species} onChange={(e) => edit(m.id, { species: e.target.value })}>
                      {/* 손으로 적은 목록 밖 값은 id 그대로 맨 앞에 (그대로 두고 다른 칸만 바꿀 수 있게) */}
                      {(SPECIES_IDS.includes(v.species) ? SPECIES_IDS : [v.species, ...SPECIES_IDS]).map((id) => (
                        <option key={id} value={id}>
                          {SPECIES_IDS.includes(id) ? t(`species.${toSpecies(id)}`) : id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="st-field">
                    <span>{t('settings.job')}</span>
                    <select value={v.job} onChange={(e) => edit(m.id, { job: e.target.value })}>
                      {(jobs.includes(v.job) ? jobs : [v.job, ...jobs]).map((id) => (
                        <option key={id} value={id}>
                          {jobLabel(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="st-field">
                    <span>{t('settings.accessory')}</span>
                    {locked ? (
                      // 햄스터는 늘 씨워크 헬멧 (05 문서 3.2) — 저장 값은 그대로 둔다
                      <select disabled value="locked">
                        <option value="locked">{t('settings.locked', { name: t(`accessory.${locked}`) })}</option>
                      </select>
                    ) : (
                      <select
                        value={toAccessory(v.accessory)}
                        onChange={(e) => {
                          const sea = e.target.value;
                          if (sea === toAccessory(v.accessory)) return;
                          edit(m.id, { accessory: ACCESSORIES.find((a) => toAccessory(a) === sea) ?? null });
                        }}
                      >
                        <option value="none">{t('settings.noAccessory')}</option>
                        {v.accessory !== null && !ACCESSORY_IDS.includes(v.accessory) && (
                          <option value={toAccessory(v.accessory)}>{v.accessory}</option>
                        )}
                        {ACCESSORIES.map((id) => (
                          <option key={id} value={toAccessory(id)}>
                            {t(`accessory.${toAccessory(id)}`)}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                </fieldset>
              );
            })}
          </section>
          <section className="ui-card st-card" aria-labelledby="st-day">
            <h2 id="st-day">{t('settings.day')}</h2>
            <p className="st-meta">{t('settings.dayMeta')}</p>
            <label className="st-field">
              <span>{t('settings.dayLabel')}</span>
              <span className="st-num">
                <input
                  type="number"
                  min={1}
                  max={DAY_MAX_MIN}
                  step={1}
                  value={day ?? String(dayMin)}
                  aria-invalid={!dayOk}
                  aria-describedby={dayOk ? undefined : 'st-day-rule'}
                  onChange={(e) => setDay(e.target.value)}
                />
                {t('settings.minutes')}
              </span>
            </label>
            {!dayOk && (
              <p id="st-day-rule" className="st-meta st-meta--error">
                {t('settings.dayRule')}
              </p>
            )}
          </section>
          <div className="st-save">
            <Button variant="primary" type="submit" disabled={!dirty || !dayOk || busy}>
              {t('settings.save')}
            </Button>
            <div role="status" className="st-msg">
              {msg.map((x) => (
                <p key={x.text} className={x.error ? 'st-meta st-meta--error' : 'st-meta'}>
                  {x.error && <Icon name="blocked" size={14} />}
                  {x.text}
                </p>
              ))}
            </div>
          </div>
        </form>
        <div className="st-col">
          <section className="ui-card st-card" aria-labelledby="st-display">
            <h2 id="st-display">{t('settings.display')}</h2>
            <p className="st-meta">{t('settings.displayMeta')}</p>
            <div className="st-pref">
              <span className="st-pref__name">{t('settings.speech')}</span>
              <Toggle
                label={t('settings.speech')}
                options={onOff}
                value={prefs.speech ? 'on' : 'off'}
                onChange={(v) => setPrefs({ speech: v === 'on' })}
              />
              <span className="st-meta">{t('settings.speechHint')}</span>
            </div>
            <div className="st-pref">
              <span className="st-pref__name">{t('settings.bubbles')}</span>
              <Toggle
                label={t('settings.bubbles')}
                options={onOff}
                value={prefs.bubbles ? 'on' : 'off'}
                onChange={(v) => setPrefs({ bubbles: v === 'on' })}
              />
              <span className="st-meta">{t('settings.bubblesHint')}</span>
              {reducedMotion() && <span className="st-meta">{t('settings.reduced')}</span>}
            </div>
            <label className="st-pref">
              <span className="st-pref__name">{t('settings.zoom')}</span>
              <select
                value={String(prefs.zoom)}
                onChange={(e) =>
                  setPrefs({ zoom: (e.target.value === 'fit' ? 'fit' : Number(e.target.value)) as Zoom })
                }
              >
                {ZOOMS.map((z) => (
                  <option key={z} value={String(z)}>
                    {z === 'fit' ? t('settings.zoomFit') : `${z}×`}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="ui-card st-card" aria-labelledby="st-hooks">
            <h2 id="st-hooks">{t('hooks.title')}</h2>
            <HookGuide connected={connected} />
          </section>
        </div>
      </div>
    </div>
  );
}

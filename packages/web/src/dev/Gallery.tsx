// /dev/gallery — 캔버스 바다 06 건물 키트 · 07 공사 단계 · 08 가구·소품 보드와 같은 배열 (dc-import 목록 그대로)
import { defaultConfig, type WeatherKind } from '@tycoon/core';
import { Building } from '../assets/sea/Building';
import { Prop, type Slot } from '../assets/sea/Asset';
import { jobLook } from '../live/sceneFromState';
import { Weather } from '../world/Weather';

// M15 새 그림 (06 문서 14.1): 직업 5종 성장 1층 → 2층 → 3층 → 큰 건물, 시청 시대 4, 랜드마크 2, 공원
const JOBS = [...defaultConfig.jobPresets, defaultConfig.fallbackPreset];
const ERAS = ['village', 'town', 'city', 'capital'];

const bodies = ['shell-1f', 'coral-1f', 'wreck-2f', 'basalt-2f'];
const signs: [string, string, Slot][] = [
  ['coral-1f', 'workshop', 1],
  ['shell-1f', 'cafe', 2],
  ['basalt-2f', 'guard', 3],
  ['wreck-2f', 'hall', 4],
  ['coral-1f', 'work', 5],
  ['shell-1f', 'home', 6],
  ['basalt-2f', 'library', 'x'],
  ['wreck-2f', 'plan', 'x'],
  ['coral-1f', 'agency', 'x'],
];
const furniture: [string, Slot?][] = [
  ['clamchair', 2],
  ['desk'],
  ['shelf'],
  ['coralpot'],
  ['jellylamp'],
  ['clambed', 1],
  ['rug', 5],
];
const props = [
  'kelp',
  'coral',
  'braincoral',
  'seagrass',
  'rock',
  'jellypost',
  'bench',
  'anemone',
  'board',
  'buoyfence',
  'materials',
  'chest',
  'starfish',
  'urchin',
  'clamfountain',
];
const tiles = ['sand', 'gravel', 'plaza', 'rock'];
// M19 날씨 겹 (06 문서 10장): 물빛(Camera 바탕과 같은 그라데이션) 위 일터 하나. 마지막 칸 = 동작 줄이기
const WEATHERS: [WeatherKind, boolean][] = [
  ['storm', false],
  ['cloudy', false],
  ['rainbow', false],
  ['sunny', false],
  ['calm', false],
  ['storm', true],
];
const sea = {
  position: 'relative',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-end',
  width: 240,
  height: 200,
  overflow: 'hidden',
  borderRadius: 14,
  background: 'linear-gradient(var(--water-bg-1), var(--water-bg-2) 55%, var(--water-bg-3))',
} as const;

const Row = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>{title}</h2>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>{children}</div>
  </section>
);
const Cell = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <figure style={{ margin: 0, textAlign: 'center' }}>
    <div style={{ background: 'var(--paper)', borderRadius: 14 }}>{children}</div>
    <figcaption style={{ font: '11px var(--font-mono)', color: 'var(--text-2)' }}>{id}</figcaption>
  </figure>
);

export function Gallery() {
  return (
    <main style={{ padding: '32px 48px' }}>
      <Row title="06 · 몸체">
        {bodies.map((b) => (
          <Cell key={b} id={`body.${b}`}>
            <Building body={b} />
          </Cell>
        ))}
      </Row>
      <Row title="06 · 지붕 (몸체 흐리게)">
        {(['dome', 'scallop', 'conch'] as const).map((r, i) => (
          <Cell key={r} id={`roof.${r}`}>
            <Building body="shell-1f" roof={r} slot={(i + 1) as Slot} ghost />
          </Cell>
        ))}
      </Row>
      <Row title="06 · 간판">
        {signs.map(([b, s, slot]) => (
          <Cell key={s} id={`sign.${s}`}>
            <Building body={b} sign={s} slot={slot} />
          </Cell>
        ))}
      </Row>
      <Row title="06 · 조립">
        <Cell id="coral+scallop+workshop">
          <Building body="coral-1f" roof="scallop" sign="workshop" slot={1} />
        </Cell>
        <Cell id="shell+conch+cafe">
          <Building body="shell-1f" roof="conch" sign="cafe" slot={2} />
        </Cell>
        <Cell id="basalt+dome+guard">
          <Building body="basalt-2f" roof="dome" sign="guard" slot={3} />
        </Cell>
        <Cell id="wreck+scallop+hall">
          <Building body="wreck-2f" roof="scallop" sign="hall" slot={4} />
        </Cell>
      </Row>
      <Row title="07 · 공사 단계 (1층, N=4)">
        <Cell id="planned">
          <Building body="coral-1f" roof="scallop" sign="workshop" stage="planned" />
        </Cell>
        <Cell id="foundation">
          <Building body="coral-1f" roof="scallop" sign="workshop" stage="foundation" />
        </Cell>
        <Cell id="frame 0.5">
          <Building body="coral-1f" roof="scallop" sign="workshop" stage="frame" progress={0.5} />
        </Cell>
        <Cell id="frame 0.75">
          <Building body="coral-1f" roof="scallop" sign="workshop" stage="frame" progress={0.75} />
        </Cell>
        <Cell id="done + fx">
          <Building body="coral-1f" roof="scallop" sign="workshop" stage="done" fx />
        </Cell>
      </Row>
      <Row title="07 · 공사 단계 (2층, N=6)">
        {[0.33, 0.5, 0.67, 0.83].map((p) => (
          <Cell key={p} id={`frame ${p}`}>
            <Building body="basalt-2f" roof="dome" sign="guard" slot={3} stage="frame" progress={p} />
          </Cell>
        ))}
        <Cell id="done">
          <Building body="basalt-2f" roof="dome" sign="guard" slot={3} />
        </Cell>
        <Cell id="done + scaffold">
          <Building body="basalt-2f" roof="dome" sign="guard" slot={3} scaffold />
        </Cell>
      </Row>
      {JOBS.map((p, i) => (
        <Row key={p.id} title={`M15 · 일터 성장 — ${p.label}`}>
          {[1, 2, 3, 4].map((f) => {
            const look = jobLook(p, f, f >= 4);
            return (
              <Cell key={f} id={`${f >= 4 ? '큰 건물' : `${f}층`} · ${look.body}`}>
                <Building {...look} slot={((i % 6) + 1) as Slot} />
              </Cell>
            );
          })}
        </Row>
      ))}
      <Row title="M15 · 시청 (시대) · 랜드마크 · 공원">
        {ERAS.map((e) => (
          <Cell key={e} id={`body.hall-${e}`}>
            <Building body={`hall-${e}`} slot={4} />
          </Cell>
        ))}
        {['landmark', 'landmark2'].map((b) => (
          <Cell key={b} id={`body.${b}`}>
            <Building body={b} slot="x" />
          </Cell>
        ))}
        <Cell id="prop.park">
          <Prop kind="prop.park" />
        </Cell>
      </Row>
      <Row title="M19 · 날씨 (폭풍 · 흐림 · 무지개 · 맑음 · 잔잔 · 폭풍 동작 줄이기)">
        {WEATHERS.map(([k, still]) => (
          <Cell key={`${k}${still}`} id={`weather.${k}${still ? ' · still' : ''}`}>
            <div style={sea}>
              <Building body="coral-1f" roof="scallop" sign="workshop" slot={1} scale={0.75} />
              <Weather kind={k} still={still} />
            </div>
          </Cell>
        ))}
      </Row>
      <Row title="08 · 가구">
        {furniture.map(([f, fab]) => (
          <Cell key={f} id={`furniture.${f}`}>
            <Prop kind={`furniture.${f}`} scale={1.25} fab={fab} />
          </Cell>
        ))}
      </Row>
      <Row title="08 · 소품">
        {props.map((p) => (
          <Cell key={p} id={`prop.${p}`}>
            <Prop kind={`prop.${p}`} scale={1.25} />
          </Cell>
        ))}
      </Row>
      <Row title="08 · 바닥">
        {tiles.map((t) => (
          <Cell key={t} id={`tile.${t}`}>
            <Prop kind={`tile.${t}`} scale={1.25} />
          </Cell>
        ))}
      </Row>
    </main>
  );
}

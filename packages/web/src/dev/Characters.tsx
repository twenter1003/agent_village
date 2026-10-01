// /dev/characters — 캔버스 바다 04 캐릭터 시트 (5종 × 7포즈 + 프로필). ?stress=50 이면 캐릭터 50명 성능 확인.
import { useState } from 'react';
import { Critter } from '../render/Critter';
import type { Role } from '../render/critterSvg';
import { rig, SPECIES, type PoseName } from '../render/rig';

const POSES: PoseName[] = ['stand', 'walk', 'hammer', 'carry', 'cheer', 'talk', 'rest'];
// 캔버스 보드의 phase 배치 그대로
const PHASES: Record<string, number[]> = {
  seal: [0, 1, 2, 3, 4, 5, 6],
  otter: [3, 0, 1, 2, 5, 4, 0],
  hamster: [1, 2, 0, 1, 3, 2, 4],
  turtle: [2, 3, 1, 0, 1, 0, 2],
  fish: [4, 1, 2, 3, 0, 1, 3],
};
const FISH_ROLES: Role[] = ['explore', 'plan', 'general', 'general', 'explore', 'plan', 'general'];

export function Characters() {
  const [animate, setAnimate] = useState(true);
  const [bubbles, setBubbles] = useState(false);
  const stress = Number(new URLSearchParams(location.search).get('stress') ?? 0);

  if (stress > 0)
    return (
      <main style={{ display: 'flex', flexWrap: 'wrap', padding: 16 }}>
        {Array.from({ length: stress }, (_, i) => (
          <Critter key={i} species={SPECIES[i % 5] ?? 'seal'} pose={POSES[i % 7]} phase={i % 7} scale={0.6} bubbles />
        ))}
      </main>
    );

  return (
    <main style={{ padding: '32px 48px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>바다 캐릭터 시트</h1>
      <label>
        <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} /> 움직임
      </label>{' '}
      <label>
        <input type="checkbox" checked={bubbles} onChange={(e) => setBubbles(e.target.checked)} /> 거품 전부 켜기
      </label>
      <table data-sheet="poses" style={{ borderSpacing: 8, marginTop: 16 }}>
        <thead>
          <tr>
            <th />
            {POSES.map((p) => (
              <th key={p} style={{ font: '12px var(--font-mono)', color: 'var(--text-2)' }}>
                {p}
              </th>
            ))}
            <th style={{ font: '12px var(--font-mono)', color: 'var(--text-2)' }}>face</th>
          </tr>
        </thead>
        <tbody>
          {SPECIES.map((sp) => (
            <tr key={sp}>
              <th
                style={{ fontFamily: 'var(--font-display)', fontWeight: 400, textAlign: 'left', whiteSpace: 'nowrap' }}
              >
                {rig.species[sp].name}
              </th>
              {POSES.map((pose, i) => (
                <td key={pose} style={{ background: 'var(--paper)', borderRadius: 14 }}>
                  <Critter
                    species={sp}
                    pose={pose}
                    phase={PHASES[sp]?.[i]}
                    role={sp === 'fish' ? FISH_ROLES[i] : undefined}
                    animate={animate}
                    bubbles={bubbles || undefined}
                  />
                </td>
              ))}
              <td style={{ background: 'var(--paper)', borderRadius: 14 }}>
                <Critter species={sp} mode="face" scale={1.27} role="explore" animate={false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* 자동 변형 (01 문서 D16): 도감을 다 쓰면 n바퀴째 팀원 = 털 염색 + 무늬 */}
      <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, marginTop: 32 }}>자동 변형 (바퀴 1~4)</h2>
      <table data-sheet="variants" style={{ borderSpacing: 8 }}>
        <tbody>
          {SPECIES.filter((sp) => sp !== 'fish').map((sp) => (
            <tr key={sp}>
              <th
                style={{ fontFamily: 'var(--font-display)', fontWeight: 400, textAlign: 'left', whiteSpace: 'nowrap' }}
              >
                {rig.species[sp].name}
              </th>
              {[0, 1, 2, 3, 4].map((v) => (
                <td key={v} style={{ background: 'var(--paper)', borderRadius: 14 }}>
                  <Critter species={sp} variant={v} mode="face" scale={0.9} animate={false} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

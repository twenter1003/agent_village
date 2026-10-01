// /dev/village — 캔버스 바다 09 마을 장면 재현 (fixtures/village-demo.json). ?live=stress|build|capital|<projectId> → 실시간 마을 (M5).
// ?load=target → 02 문서 8.3 성능 목표 부하 (캐릭터 20, 건물 40, 소품 150, 24×24) — e2e/perf.spec.ts가 잰다
import demo from '../../../../fixtures/village-demo.json';
import { LiveDemo } from '../live/LiveDemo';
import { world } from '../render/iso';
import type { PoseName } from '../render/rig';
import { Camera } from '../world/Camera';
import { Village, type Scene } from '../world/Village';

const BODIES = ['shell-1f', 'coral-1f', 'wreck-2f', 'basalt-2f'];
const ROOFS = ['dome', 'scallop', 'conch'];
const SIGNS = ['workshop', 'cafe', 'guard', 'hall', 'home'];
const STAGES = ['done', 'done', 'done', 'frame', 'foundation', 'planned'] as const;
const PROPS = [
  'kelp',
  'seagrass',
  'coral',
  'braincoral',
  'anemone',
  'rock',
  'starfish',
  'urchin',
  'chest',
  'jellypost',
];
const SPECIES = ['seal', 'otter', 'hamster', 'turtle'] as const;
const POSES: PoseName[] = ['walk', 'hammer', 'carry', 'talk', 'stand', 'cheer', 'rest'];

/** 결정적 목표 부하: 건물 40채(8열 × 5줄, 부지 간격 1), 그 아래 소품 150개, 사이 길에 캐릭터 20 */
export function targetScene(): Scene {
  return {
    map: 24,
    buildings: Array.from({ length: 40 }, (_, i) => ({
      x: 1 + (i % 8) * 3,
      y: 1 + Math.floor(i / 8) * 3,
      body: BODIES[i % BODIES.length] ?? 'shell-1f',
      roof: ROOFS[i % ROOFS.length],
      sign: SIGNS[i % SIGNS.length],
      slot: ((i % 6) + 1) as 1,
      stage: STAGES[i % STAGES.length],
      progress: 0.5,
    })),
    props: Array.from({ length: 150 }, (_, i) => ({
      x: i % 24,
      y: 17 + Math.floor(i / 24),
      kind: PROPS[i % PROPS.length] ?? 'kelp',
      phase: i % 2,
    })),
    characters: Array.from({ length: 20 }, (_, i) => ({
      x: 1.5 + i,
      y: 16.5,
      species: SPECIES[i % SPECIES.length] ?? 'seal',
      pose: POSES[i % POSES.length],
      flip: i % 2 === 1,
      phase: i % 7,
    })),
    worldUi: [],
  };
}

export function VillageDemo() {
  const q = new URLSearchParams(location.search);
  const live = q.get('live');
  if (live) return <LiveDemo source={live} />;
  const scene = q.get('load') === 'target' ? targetScene() : (demo as unknown as Scene);
  const W = world(scene.map);
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Camera worldW={W.w} worldH={W.h}>
        <Village scene={scene} />
      </Camera>
    </div>
  );
}

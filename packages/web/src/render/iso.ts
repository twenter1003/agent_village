// iso 좌표 (02 문서 7.1). 월드 원점은 캔버스 바다 09와 같게: 16×16 맵에서 섬 꼭대기 (600,150), 월드 1200×700.
export const TILE_W = 64;
export const TILE_H = 32;

export function world(map: number) {
  return { ox: (TILE_W / 2) * map + 88, oy: 150, w: TILE_W * map + 176, h: TILE_H * map + 188 };
}

export function iso(x: number, y: number, map = 16) {
  const { ox, oy } = world(map);
  return { sx: ox + ((x - y) * TILE_W) / 2, sy: oy + ((x + y) * TILE_H) / 2 };
}

/** 화면(월드 px) → 타일 좌표 (iso 거꾸로). 끌어 옮기기에서 누른 자리를 칸으로 (06 문서 8장) */
export function unIso(sx: number, sy: number, map = 16) {
  const { ox, oy } = world(map);
  const a = (sx - ox) / (TILE_W / 2); // x − y
  const b = (sy - oy) / (TILE_H / 2); // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** 깊이 정렬 (7.2): sy 오름차순, 같으면 sx */
export const byDepth = <T extends { d: number; sx: number }>(a: T, b: T) => a.d - b.d || a.sx - b.sx;

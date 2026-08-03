// ============================================================
// world.js — 시드 기반 필드(격자) 생성
// 모든 플레이어가 같은 SEED를 사용하므로, 맵 데이터를 서버에
// 저장하지 않고도 모든 클라이언트가 동일한 지형을 계산해낸다.
// ============================================================
import { TERRAIN_NODES, WATER } from './data.js';

export const WORLD_SEED = 20260803; // 이 값을 바꾸면 새로운 맵이 생성됨
export const WORLD_SIZE = 200;      // 200 x 200 격자

// mulberry32 시드 난수 생성기 (결정적/재현 가능)
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 좌표 기반 결정적 해시 → 해당 좌표만의 고유 난수를 만든다
function hashXY(x, y) {
  const seed = (WORLD_SEED ^ (x * 374761393) ^ (y * 668265263)) >>> 0;
  return mulberry32(seed)();
}

const NODE_LIST = Object.entries(TERRAIN_NODES); // [key, def][]

/**
 * 특정 좌표의 타일 정보를 계산해서 반환한다 (저장 없이 즉석 계산).
 * returns { terrain: 'plain'|'water'|node_key, node: def|null }
 */
export function getTile(x, y) {
  const r1 = hashXY(x, y);
  const r2 = hashXY(x + 99991, y + 13);

  // 1) 물 타일 판정 (강/호수) - 저밀도 블롭 느낌을 위해 저주파 좌표 사용
  const waterNoise = hashXY(Math.floor(x / 6), Math.floor(y / 6));
  if (waterNoise < WATER.density) {
    return { terrain: 'water', node: null };
  }

  // 2) 자원 노드 판정 - 각 타입이 균일한 확률로 독립 배치
  let acc = 0;
  for (const [key, def] of NODE_LIST) {
    acc += def.density;
    if (r1 < acc) {
      return { terrain: key, node: def };
    }
  }

  // 3) 기본 평지
  return { terrain: 'plain', node: null };
}

// 사각 영역의 타일을 한번에 가져오기 (렌더링용)
export function getTileRange(x0, y0, x1, y1) {
  const tiles = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      tiles.push({ x, y, ...getTile(x, y) });
    }
  }
  return tiles;
}

export function isWater(x, y) {
  return getTile(x, y).terrain === 'water';
}

// 특정 타일이 물 타일에 인접한지 (농지 설치 조건 체크용)
export function isAdjacentToWater(x, y, w, h) {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue; // 내부는 제외
      if (isWater(x + dx, y + dy)) return true;
    }
  }
  return false;
}

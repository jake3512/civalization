// ============================================================
// logic.js — "명령"에 대한 판정 로직 (건설/업그레이드/레시피/연구/전투)
//
// 순수 함수로 작성되어 있어 브라우저(js/game.js)와
// Cloud Functions(functions/shared/logic.js — 이 파일의 복사본) 양쪽에서
// 동일하게 사용할 수 있습니다. DOM이나 Firestore SDK에 의존하지 않습니다.
//
// nation 파라미터는 아래 형태의 "평범한 객체"면 됩니다:
//   { resources, structures, territory(Set), unlocked(Set), research, nextStructId }
// ============================================================
import { STRUCTURES, getUpgradeCost, TECH_TREE, BASE_UNLOCKED } from './data.js';
import { getTile, isAdjacentToWater } from './world.js';

export function tileKey(x, y) { return `${x},${y}`; }

export function footprintTiles(x, y, footprint) {
  const [w, h] = footprint;
  const tiles = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) tiles.push([x + dx, y + dy]);
  return tiles;
}

export function structureAt(nation, x, y) {
  return nation.structures.find(s => {
    const def = STRUCTURES[s.key];
    return footprintTiles(s.x, s.y, def.footprint).some(([tx, ty]) => tx === x && ty === y);
  }) || null;
}

function isAreaFree(nation, x, y, footprint) {
  return footprintTiles(x, y, footprint).every(([tx, ty]) => {
    if (!nation.territory.has(tileKey(tx, ty))) return false;
    return !structureAt(nation, tx, ty);
  });
}

function canAfford(nation, cost) {
  return Object.entries(cost).every(([res, amt]) => (nation.resources[res] || 0) >= amt);
}
function pay(nation, cost) {
  for (const [res, amt] of Object.entries(cost)) nation.resources[res] = (nation.resources[res] || 0) - amt;
}

function addTerritory(nation, cx, cy, radius) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (Math.hypot(x - cx, y - cy) <= radius) nation.territory.add(tileKey(x, y));
    }
  }
}

/**
 * 구조물 건설. dir(0~3)은 벨트 전용 방향.
 * 성공 시 { ok:true, structure }, 실패 시 { ok:false, error }.
 */
export function build(nation, structKey, x, y, dir = 0) {
  const def = STRUCTURES[structKey];
  if (!def) return { ok: false, error: '알 수 없는 구조물' };
  if (!nation.unlocked.has(structKey)) return { ok: false, error: '연구소에서 아직 해금되지 않았습니다' };
  if (!isAreaFree(nation, x, y, def.footprint)) return { ok: false, error: '이 위치에는 건설할 수 없습니다 (영토 밖이거나 이미 점유됨)' };

  if (def.requiresNode) {
    const t = getTile(x, y);
    if (!def.requiresNode.includes(t.terrain)) {
      return { ok: false, error: `이 구조물은 [${def.requiresNode.join(', ')}] 지형 위에만 설치할 수 있습니다` };
    }
  }
  if (def.requiresAdjacent === 'water') {
    const [w, h] = def.footprint;
    if (!isAdjacentToWater(x, y, w, h)) return { ok: false, error: '농지는 물(강/호수) 옆에만 설치할 수 있습니다' };
  }
  if (!canAfford(nation, def.baseCost)) return { ok: false, error: '자원이 부족합니다' };

  pay(nation, def.baseCost);
  const structure = {
    id: nation.nextStructId++, key: structKey, x, y, level: 1,
    recipe: null, dir: structKey === 'belt' ? dir : undefined,
    inputBuffer: {}, idle: false,
  };
  nation.structures.push(structure);

  if (structKey === 'hub') addTerritory(nation, x, y, def.territoryRadius);
  if (structKey === 'capital') addTerritory(nation, x, y, 3);

  return { ok: true, structure };
}

export function upgrade(nation, structId) {
  const s = nation.structures.find(s => s.id === structId);
  if (!s) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  const cost = getUpgradeCost(s.key, s.level);
  if (!cost) return { ok: false, error: '더 이상 레벨을 올릴 수 없습니다 (최대 레벨)' };
  if (!canAfford(nation, cost)) return { ok: false, error: '자원이 부족합니다' };
  pay(nation, cost);
  s.level += 1;
  if (s.key === 'hub') {
    const def = STRUCTURES.hub;
    addTerritory(nation, s.x, s.y, def.territoryRadius + s.level - 1);
  }
  return { ok: true, structure: s };
}

export function setRecipe(nation, structId, recipeKey) {
  const s = nation.structures.find(s => s.id === structId);
  if (!s) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  const def = STRUCTURES[s.key];
  if (!def.recipes || !def.recipes[recipeKey]) return { ok: false, error: '올바르지 않은 레시피' };
  s.recipe = recipeKey;
  return { ok: true, structure: s };
}

/** 연구소 연구 시작 (동시에 하나만 진행 — 단순화된 규칙) */
export function startResearch(nation, structKey) {
  if (nation.unlocked.has(structKey)) return { ok: false, error: '이미 해금된 구조물입니다' };
  const tech = TECH_TREE[structKey];
  if (!tech) return { ok: false, error: '연구할 수 없는 항목입니다' };
  if (nation.research && nation.research.key) return { ok: false, error: '이미 다른 연구가 진행 중입니다' };
  const hasLab = nation.structures.some(s => s.key === 'lab');
  if (!hasLab) return { ok: false, error: '연구소를 먼저 건설해야 합니다' };
  const missing = tech.requires.filter(k => !nation.unlocked.has(k));
  if (missing.length) return { ok: false, error: `선행 연구가 필요합니다: ${missing.join(', ')}` };
  if (!canAfford(nation, tech.cost)) return { ok: false, error: '연구 자원이 부족합니다' };
  pay(nation, tech.cost);
  nation.research = { key: structKey, ticksLeft: tech.time };
  return { ok: true };
}

/**
 * 전투 판정 (프로토타입: 군사 구조물 총합 비교).
 * 승자는 패자 자원의 일부를 약탈한다.
 */
export function resolveBattle(attackerPower, defenderPower, defenderResources) {
  const win = attackerPower >= defenderPower;
  const loot = {};
  if (win) {
    for (const [res, amt] of Object.entries(defenderResources || {})) {
      loot[res] = Math.floor(amt * 0.1); // 10% 약탈
    }
  }
  return { win, loot };
}

export function militaryPower(nation) {
  return nation.structures.reduce((sum, s) => {
    const def = STRUCTURES[s.key];
    if (def.category === 'military') return sum + (def.attack || def.defense || def.baseProduction || 1) * s.level;
    return sum;
  }, 0);
}

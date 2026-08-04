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
import { STRUCTURES, getUpgradeCost, TECH_TREE, BASE_UNLOCKED, WAR, UNITS } from './data.js';
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

/** 구조물 발판의 정중앙 좌표 (영토 확장 시 중심점으로 사용) */
function footprintCenter(x, y, footprint) {
  const [w, h] = footprint;
  return [x + (w - 1) / 2, y + (h - 1) / 2];
}

/** 수도/중심지처럼 레벨에 비례해 영토를 넓히는 구조물의 현재 레벨 기준 반경 */
export function getTerritoryRadius(structKey, level) {
  const def = STRUCTURES[structKey];
  if (!def || !def.territoryRadius) return 0;
  return def.territoryRadius + (level - 1);
}

function canAfford(nation, cost) {
  return Object.entries(cost).every(([res, amt]) => (nation.resources[res] || 0) >= amt);
}
function pay(nation, cost) {
  for (const [res, amt] of Object.entries(cost)) nation.resources[res] = (nation.resources[res] || 0) - amt;
}

function addTerritory(nation, cx, cy, radius) {
  // cx/cy는 짝수 발판(중심지 등)의 경우 x.5 같은 소수일 수 있으므로, 정수 타일
  // 좌표만 순회하도록 항상 정수 경계로 반올림한다 (그렇지 않으면 반경 내 어떤
  // 정수 타일도 순회에 걸리지 않아 영토가 하나도 편입되지 않는다).
  const y0 = Math.floor(cy - radius), y1 = Math.ceil(cy + radius);
  const x0 = Math.floor(cx - radius), x1 = Math.ceil(cx + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
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

  const isCapital = structKey === 'capital';
  if (isCapital && nation.structures.some(s => s.key === 'capital')) {
    return { ok: false, error: '수도는 국가당 하나만 지을 수 있습니다' };
  }
  if (isCapital) {
    // 수도는 스스로 영토를 만들어내는 시작점이라, 기존 영토 안에 있을 필요가 없다.
    const clear = footprintTiles(x, y, def.footprint).every(([tx, ty]) => !structureAt(nation, tx, ty));
    if (!clear) return { ok: false, error: '이 위치에는 건설할 수 없습니다 (이미 점유됨)' };
  } else if (!isAreaFree(nation, x, y, def.footprint)) {
    return { ok: false, error: '이 위치에는 건설할 수 없습니다 (영토 밖이거나 이미 점유됨)' };
  }

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
    recruitQueue: structKey === 'outpost' ? [] : undefined,
  };
  nation.structures.push(structure);

  if (def.territoryRadius) {
    const [cx, cy] = footprintCenter(x, y, def.footprint);
    addTerritory(nation, cx, cy, getTerritoryRadius(structKey, structure.level));
  }

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
  const def = STRUCTURES[s.key];
  if (def.territoryRadius) {
    const [cx, cy] = footprintCenter(s.x, s.y, def.footprint);
    addTerritory(nation, cx, cy, getTerritoryRadius(s.key, s.level));
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

/**
 * 전초기지에서 병력을 모집한다. 국고 골드를 즉시 지불하고 대기열에 넣으며,
 * 실제 병력이 되려면 벨트로 필요한 장비 아이템이 투입되어야 한다 (simulate.js에서 처리).
 */
export function recruitUnit(nation, structId, unitKey, isDefense) {
  const s = nation.structures.find(s => s.id === structId);
  if (!s || s.key !== 'outpost') return { ok: false, error: '전초기지를 찾을 수 없습니다' };
  const unit = isDefense ? UNITS.defense[unitKey] : UNITS.attack[unitKey];
  if (!unit) return { ok: false, error: '알 수 없는 병종입니다' };
  if ((nation.resources.gold || 0) < unit.gold) return { ok: false, error: '국고 골드가 부족합니다' };

  nation.resources.gold -= unit.gold;
  s.recruitQueue = s.recruitQueue || [];
  s.recruitQueue.push({ unitKey, isDefense: !!isDefense, need: { ...unit.equip } });
  return { ok: true };
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
 * 승자는 패자 자원의 일부를 약탈하고, 트로피(COC 스타일)를 교환한다.
 */
export function resolveBattle(attackerPower, defenderPower, defenderResources, attackerTrophies = 0, defenderTrophies = 0) {
  const win = attackerPower >= defenderPower;
  const loot = {};
  if (win) {
    for (const [res, amt] of Object.entries(defenderResources || {})) {
      loot[res] = Math.floor(amt * 0.1); // 10% 약탈 (COC의 창고 보호 비율과 비슷한 상한)
    }
  }

  // 트로피 교환: 상대가 나보다 트로피가 높을수록 승리 시 더 많이 얻고,
  // 패배 시에는 고정 페널티만 잃는다 (COC의 비대칭 트레이드를 단순화한 버전)
  let attackerTrophyDelta, defenderTrophyDelta;
  if (win) {
    const diff = defenderTrophies - attackerTrophies;
    const trade = Math.round(WAR.baseTrophyTrade + diff * 0.08);
    const clamped = Math.max(WAR.minTrophyTrade, Math.min(WAR.maxTrophyTrade, trade));
    attackerTrophyDelta = clamped;
    defenderTrophyDelta = -clamped;
  } else {
    attackerTrophyDelta = -WAR.lossTrophyPenalty;
    defenderTrophyDelta = 0; // 방어 성공 시 방어자는 트로피 변동 없음 (COC와 동일)
  }

  return { win, loot, attackerTrophyDelta, defenderTrophyDelta };
}

/** 공격력: 보유한 공격 유닛들의 전투력 합 (수비 유닛/터렛/방벽은 포함되지 않음) */
export function getAttackPower(nation) {
  const units = (nation.units && nation.units.attack) || {};
  return Object.entries(units).reduce((sum, [key, count]) => sum + (UNITS.attack[key]?.power || 0) * count, 0);
}

/** 방어력: 수비 유닛 + 터렛(레벨 비례, 유휴 상태면 제외) + 방벽(레벨 비례)의 합 */
export function getDefensePower(nation) {
  const units = (nation.units && nation.units.defense) || {};
  let power = Object.entries(units).reduce((sum, [key, count]) => sum + (UNITS.defense[key]?.power || 0) * count, 0);
  for (const s of nation.structures) {
    const def = STRUCTURES[s.key];
    if (!def) continue;
    if (def.category === 'turret' && !s.idle) power += (def.attack || 0) * s.level;
    if (s.key === 'wall') power += (def.defense || 0) * s.level;
  }
  return power;
}

// ---------------- 실드(보호막) · 매치메이킹 ----------------

export function isShielded(nation, now = Date.now()) {
  return (nation.shieldUntil || 0) > now;
}

/**
 * 공격 가능 여부 확인. 불가하면 이유 문자열을 반환한다.
 */
export function canAttack(attacker, defender, now = Date.now()) {
  if (attacker.id === defender.id) return '자기 자신은 공격할 수 없습니다';
  if (isShielded(defender, now)) return '상대가 보호막(실드)으로 보호받고 있습니다';
  return null;
}

/**
 * 공격 실행 결과를 양측 국가 상태에 반영한다 (자원 약탈, 트로피, 실드 갱신).
 * attacker는 공격을 시작하는 순간 자신의 실드를 소모한다 (COC와 동일한 규칙).
 */
export function applyAttackResult(attacker, defender, now = Date.now()) {
  const attackPower = getAttackPower(attacker);
  const defenderPower = getDefensePower(defender);
  const { win, loot, attackerTrophyDelta, defenderTrophyDelta } = resolveBattle(
    attackPower, defenderPower, defender.resources, attacker.trophies || 0, defender.trophies || 0
  );

  if (win) {
    for (const [res, amt] of Object.entries(loot)) {
      defender.resources[res] = Math.max(0, (defender.resources[res] || 0) - amt);
      attacker.resources[res] = (attacker.resources[res] || 0) + amt;
    }
  }

  attacker.trophies = Math.max(0, (attacker.trophies || 0) + attackerTrophyDelta);
  defender.trophies = Math.max(0, (defender.trophies || 0) + defenderTrophyDelta);

  attacker.shieldUntil = 0;                          // 공격하면 자신의 실드는 즉시 해제
  defender.shieldUntil = now + WAR.postAttackShieldMs; // 공격당한 쪽은 새 실드를 얻는다 (연쇄 공격 방지)

  return { win, loot, attackPower, defenderPower, attackerTrophyDelta, defenderTrophyDelta };
}

/**
 * 후보 목록에서 트로피가 비슷하고, 실드가 없고, 내가 아닌 국가를 하나 찾는다.
 * (진짜 COC처럼 트로피 차이가 작을수록 우선순위를 높게 준다)
 */
export function findMatch(myNation, candidates, now = Date.now()) {
  const myTrophies = myNation.trophies || 0;
  const pool = candidates.filter(c =>
    c.id !== myNation.id &&
    !isShielded(c, now) &&
    Math.abs((c.trophies || 0) - myTrophies) <= WAR.matchTrophyRange
  );
  if (!pool.length) return null;
  pool.sort((a, b) => Math.abs((a.trophies || 0) - myTrophies) - Math.abs((b.trophies || 0) - myTrophies));
  // 가장 비슷한 후보 몇 명 중 무작위로 하나 선택 (매번 같은 상대만 나오지 않도록)
  const topPool = pool.slice(0, Math.min(5, pool.length));
  return topPool[Math.floor(Math.random() * topPool.length)];
}

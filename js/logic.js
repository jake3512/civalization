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
import { STRUCTURES, getUpgradeCost, TECH_TREE, BASE_UNLOCKED, WAR, UNITS, BATTLE, TERRAIN_NODES, CAPITAL_REQUIRED_NODES } from './data.js';
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
 * 수도 후보 자리를 평가한다. 수도가 만들어낼 초기 영토(반경) 안에
 * CAPITAL_REQUIRED_NODES의 자원 노드가 각각 최소 1개씩 있어야 한다.
 * 건국 화면에서 실시간 미리보기로도 쓰이므로 nation 없이 좌표만으로 판정한다.
 * returns { ok, found:Set, missing:string[], radius, center:[cx,cy] }
 */
export function capitalSiteReport(x, y) {
  const def = STRUCTURES.capital;
  const [cx, cy] = footprintCenter(x, y, def.footprint);
  const radius = getTerritoryRadius('capital', 1);
  const found = new Set();

  const y0 = Math.floor(cy - radius), y1 = Math.ceil(cy + radius);
  const x0 = Math.floor(cx - radius), x1 = Math.ceil(cx + radius);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (Math.hypot(tx - cx, ty - cy) > radius) continue;
      const terrain = getTile(tx, ty).terrain;
      if (CAPITAL_REQUIRED_NODES.includes(terrain)) found.add(terrain);
    }
  }
  const missing = CAPITAL_REQUIRED_NODES.filter(k => !found.has(k));
  return { ok: missing.length === 0, found, missing, radius, center: [cx, cy] };
}

/**
 * 사각 영역 안에서 수도를 세울 수 있는 칸들을 찾는다 (건국 화면의 후보지 표시용).
 * 칸마다 capitalSiteReport를 돌리면 (칸 수 × 반경 원) 만큼 지형을 다시 계산해 느리므로,
 * 필요한 자원 노드 위치만 한 번 모아두고 각 후보와의 거리만 비교한다.
 */
export function findCapitalSites(x0, y0, x1, y1, limit = 600) {
  const def = STRUCTURES.capital;
  const radius = getTerritoryRadius('capital', 1);
  const pad = Math.ceil(radius) + 2; // 화면 밖 노드도 후보의 영토에 들어올 수 있다

  const nodes = {};
  for (const k of CAPITAL_REQUIRED_NODES) nodes[k] = [];
  for (let y = y0 - pad; y <= y1 + pad; y++) {
    for (let x = x0 - pad; x <= x1 + pad; x++) {
      const t = getTile(x, y).terrain;
      if (nodes[t]) nodes[t].push([x, y]);
    }
  }

  const sites = [];
  for (let y = y0; y <= y1 && sites.length < limit; y++) {
    for (let x = x0; x <= x1 && sites.length < limit; x++) {
      const [cx, cy] = footprintCenter(x, y, def.footprint);
      const all = CAPITAL_REQUIRED_NODES.every(k =>
        nodes[k].some(([nx, ny]) => Math.hypot(nx - cx, ny - cy) <= radius));
      if (all) sites.push([x, y]);
    }
  }
  return sites;
}

/**
 * 시작 지점에서 바깥으로 나선형으로 훑어 가장 가까운 유효 수도 자리를 찾는다.
 * ("추천 위치" 버튼 — 조건을 만족하는 칸이 7% 정도뿐이라 맨손 탐색은 번거롭다)
 */
export function findNearestCapitalSite(startX, startY, maxRadius = 60) {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 링의 테두리만
        const x = startX + dx, y = startY + dy;
        if (capitalSiteReport(x, y).ok) return { x, y };
      }
    }
  }
  return null;
}

/**
 * 건설 가능 여부만 검사하는 순수 함수 (상태를 바꾸지 않는다).
 * build()와 건설 미리보기(고스트) 양쪽에서 같은 규칙을 공유하기 위해 분리했다.
 * 성공 시 { ok:true }, 실패 시 { ok:false, error }.
 */
export function validatePlacement(nation, structKey, x, y) {
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
    const site = capitalSiteReport(x, y);
    if (!site.ok) {
      const names = site.missing.map(k => TERRAIN_NODES[k]?.name || k).join(', ');
      return { ok: false, error: `수도 주변 영토에 ${names}이(가) 없습니다` };
    }
  } else if (!isAreaFree(nation, x, y, def.footprint)) {
    return { ok: false, error: '이 위치에는 건설할 수 없습니다 (영토 밖이거나 이미 점유됨)' };
  }

  if (def.requiresNode) {
    const t = getTile(x, y);
    if (!def.requiresNode.includes(t.terrain)) {
      const names = def.requiresNode.map(k => TERRAIN_NODES[k]?.name || k).join(', ');
      return { ok: false, error: `이 구조물은 [${names}] 지형 위에만 설치할 수 있습니다` };
    }
  }
  if (def.requiresAdjacent === 'water') {
    const [w, h] = def.footprint;
    if (!isAdjacentToWater(x, y, w, h)) return { ok: false, error: '농지는 물(강/호수) 옆에만 설치할 수 있습니다' };
  }
  if (!canAfford(nation, def.baseCost)) return { ok: false, error: '자원이 부족합니다' };
  return { ok: true };
}

/**
 * 구조물 건설. dir(0~3)은 벨트 전용 방향.
 * 성공 시 { ok:true, structure }, 실패 시 { ok:false, error }.
 */
export function build(nation, structKey, x, y, dir = 0) {
  const check = validatePlacement(nation, structKey, x, y);
  if (!check.ok) return check;
  const def = STRUCTURES[structKey];

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
 * 상대와의 트로피 차이에 따른 COC식 트로피 교환량 계산.
 * 승리 시 상대가 나보다 트로피가 높을수록 더 많이 얻고, 패배 시엔 고정 페널티만 잃는다.
 */
function tradeTrophies(win, attackerTrophies, defenderTrophies) {
  if (!win) return { attackerTrophyDelta: -WAR.lossTrophyPenalty, defenderTrophyDelta: 0 };
  const diff = defenderTrophies - attackerTrophies;
  const trade = Math.round(WAR.baseTrophyTrade + diff * 0.08);
  const clamped = Math.max(WAR.minTrophyTrade, Math.min(WAR.maxTrophyTrade, trade));
  return { attackerTrophyDelta: clamped, defenderTrophyDelta: -clamped };
}

/**
 * 실시간 습격 전투(battle.js, 공격자 클라이언트에서 로컬로 시뮬레이션됨)의
 * 결과를 양측 국가 상태에 반영한다. 방어자의 구조물은 전투로 영구 파괴되지
 * 않는다(다음 전투에서도 항상 원래 체력으로 시작) — 오직 자원만 영구 약탈되고,
 * 공격자가 배치했던 유닛은 생존 여부와 무관하게 로스터에서 소모된다.
 *
 * raidResult: { win, destructionPercent, loot, deployedUnits } — battle.js의 endBattle() 결과.
 * 클라이언트가 계산한 loot는 신뢰하지 않고, 방어자가 "현재" 보유한 자원 한도로 다시 클램프한다.
 */
export function applyRaidResult(attacker, defender, raidResult, now = Date.now()) {
  // win은 클라이언트 값을 그대로 믿지 않고 destructionPercent로부터 다시 계산한다
  // (신뢰 경계 — 조작된 win:true를 걸러낸다).
  const destructionPercent = Math.max(0, Math.min(1, Number(raidResult.destructionPercent) || 0));
  const win = !!raidResult.perfectVictory || destructionPercent >= BATTLE.winDestructionPct;
  const { loot } = raidResult;

  const appliedLoot = {};
  for (const [res, amt] of Object.entries(loot || {})) {
    const have = defender.resources[res] || 0;
    const take = Math.max(0, Math.min(have, Math.floor(amt)));
    if (take > 0) appliedLoot[res] = take;
  }
  for (const [res, amt] of Object.entries(appliedLoot)) {
    defender.resources[res] = Math.max(0, (defender.resources[res] || 0) - amt);
    attacker.resources[res] = (attacker.resources[res] || 0) + amt;
  }

  const { attackerTrophyDelta, defenderTrophyDelta } = tradeTrophies(win, attacker.trophies || 0, defender.trophies || 0);
  attacker.trophies = Math.max(0, (attacker.trophies || 0) + attackerTrophyDelta);
  defender.trophies = Math.max(0, (defender.trophies || 0) + defenderTrophyDelta);

  // 배치했던 공격 유닛은 생존 여부와 무관하게 소모된다 (다시 모집해야 함)
  attacker.units = attacker.units || { attack: {}, defense: {} };
  for (const [key, rawCount] of Object.entries(raidResult.deployedUnits || {})) {
    if (!UNITS.attack[key]) continue;
    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
    attacker.units.attack[key] = Math.max(0, (attacker.units.attack[key] || 0) - count);
  }

  attacker.shieldUntil = 0;                          // 공격하면 자신의 실드는 즉시 해제
  defender.shieldUntil = now + WAR.postAttackShieldMs; // 공격당한 쪽은 새 실드를 얻는다 (연쇄 공격 방지)

  return { win, destructionPercent, loot: appliedLoot, attackerTrophyDelta, defenderTrophyDelta };
}

/** 방어력: 수비 유닛 + 터렛(레벨 비례, 유휴 상태면 제외) + 방벽(레벨 비례)의 합 (전투 전 미리보기용) */
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

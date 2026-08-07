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
import { STRUCTURES, getUpgradeCost, TECH_TREE, BASE_UNLOCKED, WAR, UNITS, BATTLE, TERRAIN_NODES, CAPITAL_REQUIRED_NODES, MIN_CAPITAL_DISTANCE, isBeltKey, isRotatable,
         VIRTUAL_RESOURCES, LOGISTICS, getStorageCapacity, getOutputCapacity,
         CROPS, ANIMALS, EXPEDITIONS, START_DISHES, getSellPrice,
         RESOURCES, DIR_VECT } from './data.js';
import { getTile, isAdjacentToWater } from './world.js';

export function tileKey(x, y) { return `${x},${y}`; }

/**
 * 업적용 누적 기록. 국가 상태에 얹어두고 저장에 함께 실린다.
 * (지금 가진 것만으로는 "몇 번 했는가"를 알 수 없어서 따로 센다)
 */
export function bumpStat(nation, key, by = 1) {
  if (!nation) return;
  nation.stats = nation.stats || {};
  nation.stats[key] = (nation.stats[key] || 0) + by;
}

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

// ============================================================
// 보관(창고/수도) — 국고 표시는 "실제로 창고·수도에 든 자원의 합계"다.
// 생산물은 구조물 산출 인벤토리에 쌓이고, 벨트나 수동 이송으로 창고까지
// 옮겨야 국고에 잡히고 건설·연구·모집 비용으로 쓸 수 있다.
// (골드·전력은 실물이 아니라서 창고를 거치지 않고 nation.resources에 직접 둔다)
// ============================================================

/** 자원을 보관할 수 있는 구조물(창고·수도) 목록 */
export function storageStructures(nation) {
  return nation.structures.filter(s => STRUCTURES[s.key]?.storageCapacity > 0);
}

/** 보관 구조물이 현재 담고 있는 총량 */
export function storedTotal(s) {
  return Object.values(s.store || {}).reduce((a, b) => a + b, 0);
}

/** 보관 구조물에 res를 amt만큼 넣을 때 실제로 들어갈 수 있는 양 */
export function acceptableAmount(s, res, amt) {
  const def = STRUCTURES[s.key];
  if (!def || !def.storageCapacity) return 0;
  if (VIRTUAL_RESOURCES.has(res)) return 0;
  s.store = s.store || {};
  // 창고는 한 종류만 — 이미 다른 자원이 들어 있으면 받지 않는다
  if (def.singleResource) {
    const keys = Object.keys(s.store).filter(k => s.store[k] > 0);
    if (keys.length && keys[0] !== res) return 0;
  }
  const room = getStorageCapacity(s.key, s.level) - storedTotal(s);
  return Math.max(0, Math.min(amt, room));
}

/** 보관 구조물에 넣는다. 실제로 들어간 양을 반환 */
export function depositInto(s, res, amt) {
  const take = acceptableAmount(s, res, amt);
  if (take <= 0) return 0;
  s.store = s.store || {};
  s.store[res] = (s.store[res] || 0) + take;
  return take;
}

/** 보관 구조물에서 빼낸다. 실제로 빠진 양을 반환 */
export function withdrawFrom(s, res, amt) {
  s.store = s.store || {};
  const take = Math.max(0, Math.min(amt, s.store[res] || 0));
  if (take <= 0) return 0;
  s.store[res] -= take;
  if (s.store[res] <= 0) delete s.store[res]; // 비면 창고 종류가 풀린다
  return take;
}

/** 국가 전체 보관량 (창고 + 수도) */
export function totalStock(nation, res) {
  return storageStructures(nation).reduce((sum, s) => sum + ((s.store && s.store[res]) || 0), 0);
}

/** 아무 창고에나 넣어본다 (남은 공간이 있는 곳부터). 들어간 양을 반환 */
export function depositAnywhere(nation, res, amt) {
  let left = amt;
  // 이미 같은 자원을 담고 있는 곳 → 빈 창고 → 수도 순으로 채운다
  const targets = storageStructures(nation).sort((a, b) => {
    const aHas = (a.store && a.store[res]) ? 0 : 1;
    const bHas = (b.store && b.store[res]) ? 0 : 1;
    return aHas - bHas;
  });
  for (const s of targets) {
    if (left <= 0) break;
    left -= depositInto(s, res, left);
  }
  return amt - left;
}

/** 창고들에서 res를 amt만큼 꺼낸다. 실제로 꺼낸 양을 반환 */
export function withdrawAnywhere(nation, res, amt) {
  let left = amt;
  for (const s of storageStructures(nation)) {
    if (left <= 0) break;
    left -= withdrawFrom(s, res, left);
  }
  return amt - left;
}

/**
 * 상단 국고 표시용 집계. 실물 자원은 창고·수도에 든 양을 그대로 합산해
 * nation.resources에 반영하고, 골드·전력은 기존 값을 유지한다.
 */
export function recomputeStock(nation) {
  const next = {};
  for (const key of VIRTUAL_RESOURCES) {
    if (nation.resources[key]) next[key] = nation.resources[key];
  }
  for (const s of storageStructures(nation)) {
    for (const [res, amt] of Object.entries(s.store || {})) {
      if (amt > 0) next[res] = (next[res] || 0) + amt;
    }
  }
  nation.resources = next;
}

function canAfford(nation, cost) {
  return Object.entries(cost).every(([res, amt]) => {
    if (VIRTUAL_RESOURCES.has(res)) return (nation.resources[res] || 0) >= amt;
    return totalStock(nation, res) >= amt;
  });
}
function pay(nation, cost) {
  for (const [res, amt] of Object.entries(cost)) {
    if (VIRTUAL_RESOURCES.has(res)) {
      nation.resources[res] = (nation.resources[res] || 0) - amt;
    } else {
      withdrawAnywhere(nation, res, amt); // 실물은 창고에서 실제로 빠진다
    }
  }
  recomputeStock(nation);
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
export function capitalSiteReport(x, y, others = []) {
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
  // 수도 발판(3x3)이 자원 노드를 깔고 앉으면 그 노드는 영영 못 쓴다.
  // 구조물을 철거하는 수단이 없고 수도는 옮길 수도 없어서, 하필 그게 구리
  // 광산이면 수도 4레벨(구리 주괴 필요)에서 되돌릴 수 없이 막힌다.
  // 그래서 아예 그런 자리에는 수도를 못 세우게 막는다.
  const buried = buriedNodes(x, y, def.footprint);
  // 다른 플레이어의 수도와 너무 가까우면 영토가 겹쳐 서로의 자원을 빼앗는다.
  const near = nearestCapital(x, y, others);
  const tooClose = near && near.dist < MIN_CAPITAL_DISTANCE ? near : null;
  return {
    ok: missing.length === 0 && buried.length === 0 && !tooClose,
    found, missing, buried, tooClose, radius, center: [cx, cy],
  };
}

/**
 * 후보 자리에서 가장 가까운 남의 수도. others는 다른 플레이어의 공개 스냅샷
 * (defenseSnapshot)이나 { capital: {x, y}, name } 형태면 된다.
 */
export function nearestCapital(x, y, others = []) {
  let best = null;
  for (const o of others || []) {
    const c = o && o.capital;
    if (!c || typeof c.x !== 'number') continue;
    const dist = Math.hypot(c.x - x, c.y - y);
    if (!best || dist < best.dist) best = { name: o.name, x: c.x, y: c.y, dist };
  }
  return best;
}

/** 이 발판이 깔고 앉게 되는 자원 노드 종류 (되돌릴 수 없으므로 미리 알려준다) */
export function buriedNodes(x, y, footprint) {
  const out = new Set();
  for (const [tx, ty] of footprintTiles(x, y, footprint)) {
    const t = getTile(tx, ty);
    if (t.node) out.add(t.terrain);
  }
  return Array.from(out);
}

/**
 * 사각 영역 안에서 수도를 세울 수 있는 칸들을 찾는다 (건국 화면의 후보지 표시용).
 * 칸마다 capitalSiteReport를 돌리면 (칸 수 × 반경 원) 만큼 지형을 다시 계산해 느리므로,
 * 필요한 자원 노드 위치만 한 번 모아두고 각 후보와의 거리만 비교한다.
 */
export function findCapitalSites(x0, y0, x1, y1, limit = 600, others = []) {
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
      // 노드를 깔고 앉거나 남의 수도에 붙은 자리는 후보에서 뺀다
      // (capitalSiteReport와 같은 규칙)
      if (!all || buriedNodes(x, y, def.footprint).length) continue;
      const near = nearestCapital(x, y, others);
      if (near && near.dist < MIN_CAPITAL_DISTANCE) continue;
      sites.push([x, y]);
    }
  }
  return sites;
}

/**
 * 시작 지점에서 바깥으로 나선형으로 훑어 가장 가까운 유효 수도 자리를 찾는다.
 * ("추천 위치" 버튼 — 조건을 만족하는 칸이 7% 정도뿐이라 맨손 탐색은 번거롭다)
 */
export function findNearestCapitalSite(startX, startY, maxRadius = 60, others = []) {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 링의 테두리만
        const x = startX + dx, y = startY + dy;
        if (capitalSiteReport(x, y, others).ok) return { x, y };
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
      if (site.buried && site.buried.length) {
        const names = site.buried.map(k => TERRAIN_NODES[k]?.name || k).join(', ');
        return { ok: false, error: `수도가 ${names} 위에 놓입니다 — 그 자원을 영영 못 쓰게 되니 한 칸 옮겨주세요` };
      }
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

  bumpStat(nation, 'built');
  pay(nation, def.baseCost);
  const structure = {
    id: nation.nextStructId++, key: structKey, x, y, level: 1,
    recipe: null, dir: isBeltKey(structKey) ? dir : undefined,
    inputBuffer: {}, outputBuffer: {}, idle: false,
    // 보관 구조물(창고·수도)만 실제 재고를 담는다
    store: def.storageCapacity ? {} : undefined,
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

// ============================================================
// 철거
//
// 구조물은 원래 한 번 지으면 되돌릴 수 없었다. 그러다 보니 광산 자리를 창고로
// 덮는 실수 하나가 영구히 남았다. 이제 철거로 되돌릴 수 있되,
//   · 수도는 국가의 시작점이라 철거할 수 없고
//   · 중심지는 철거하면 영토 밖에 붕 뜨는 구조물이 생길 때만 막히고
//     (다른 수도·중심지의 반경이 이미 덮고 있는 구역이면 그대로 남으므로
//      그 위의 구조물은 그냥 둔 채 중심지만 철거할 수 있다)
//   · 철거하는 구조물 안에 들어 있던 자원은 전부 사라진다 (되돌리기 비용)
// 는 규칙을 둔다. 건설비도 돌려주지 않는다.
// ============================================================

/** 이 구조물이 만들어내는 영토 타일 (영토를 넓히지 않는 구조물이면 빈 배열) */
export function territoryTilesOf(nation, s) {
  const def = STRUCTURES[s.key];
  if (!def || !def.territoryRadius) return [];
  const [cx, cy] = footprintCenter(s.x, s.y, def.footprint);
  const radius = getTerritoryRadius(s.key, s.level);
  const out = [];
  const y0 = Math.floor(cy - radius), y1 = Math.ceil(cy + radius);
  const x0 = Math.floor(cx - radius), x1 = Math.ceil(cx + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - cx, y - cy) <= radius) out.push([x, y]);
    }
  }
  return out;
}

/** 철거할 수 있는지 판정만 한다 (버튼 잠금·안내 문구용) */
export function canDemolish(nation, structId) {
  const s = nation.structures.find(st => st.id === structId);
  if (!s) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  if (s.key === 'capital') return { ok: false, error: '수도는 철거할 수 없습니다' };

  if (STRUCTURES[s.key]?.territoryRadius) {
    // 이 중심지를 빼고 영토를 다시 그려본다. 다른 수도·중심지의 반경이 이미
    // 같은 칸을 덮고 있으면 그 칸은 그대로 영토로 남으므로, 그 위의 구조물은
    // 철거를 막지 않는다 (예전에는 "이 중심지의 영토에 서 있다"는 이유만으로
    // 겹친 구역의 구조물까지 전부 먼저 부수라고 했다).
    const after = territoryFromStructures(nation.structures.filter(o => o.id !== s.id));
    const stranded = nation.structures.filter(o => {
      if (o.id === s.id) return false;
      const [w, h] = STRUCTURES[o.key].footprint;
      // 건설과 같은 기준 — 발판이 한 칸이라도 영토를 벗어나면 붕 뜬 것으로 본다
      return footprintTiles(o.x, o.y, [w, h]).some(([x, y]) => !after.has(tileKey(x, y)));
    });
    if (stranded.length) {
      const names = [...new Set(stranded.map(o => STRUCTURES[o.key].name))].slice(0, 3).join(', ');
      return {
        ok: false,
        error: `철거하면 영토 밖으로 밀려나는 구조물이 ${stranded.length}개 있습니다 (${names}${stranded.length > 3 ? ' 등' : ''}) — 먼저 철거해주세요`,
        stranded: stranded.length,
      };
    }
  }
  return { ok: true, structure: s };
}

/** 영토를 처음부터 다시 계산한다 (철거로 줄어들 수 있으므로 누적이 아니라 재구성) */
function recomputeTerritory(nation) {
  nation.territory = territoryFromStructures(nation.structures);
}

/**
 * 구조물 목록만으로 영토를 다시 만든다.
 * 영토는 수도·중심지의 위치와 레벨에서 나오는 값이라 따로 들고 다닐 필요가 없다.
 * 멀티플레이에서 기지 스냅샷을 주고받을 때 이걸 쓰면 타일 수천 개를 네트워크로
 * 보내지 않아도 된다 (공격자 쪽에서 같은 규칙으로 다시 만든다).
 */
export function territoryFromStructures(structures) {
  const set = new Set();
  for (const s of structures || []) {
    for (const [x, y] of territoryTilesOf(null, s)) set.add(tileKey(x, y));
  }
  return set;
}

/** 구조물을 철거한다. 안에 있던 자원은 전부 사라지고 건설비도 돌려주지 않는다. */
export function demolish(nation, structId) {
  const check = canDemolish(nation, structId);
  if (!check.ok) return check;
  const s = check.structure;
  bumpStat(nation, 'demolished');

  // 사라지는 자원을 알려주기 위해 미리 모아둔다 (UI 경고 문구용)
  const lost = {};
  for (const bag of [s.store, s.inputBuffer, s.outputBuffer]) {
    for (const [res, amt] of Object.entries(bag || {})) {
      if (amt > 0) lost[res] = (lost[res] || 0) + amt;
    }
  }

  nation.structures = nation.structures.filter(o => o.id !== structId);
  recomputeTerritory(nation);
  recomputeStock(nation);   // 창고가 사라졌으면 국고 표시도 줄어든다
  return { ok: true, removed: s, lost };
}

/**
 * 이미 설치된 벨트류의 방향을 바꾼다.
 * 벨트는 한 칸씩 이어 깔다 보면 방향을 잘못 잡기 쉬운데, 예전에는 방향을
 * 고치려면 지우고 다시 까는 수밖에 없었다 (철거도 없던 시절엔 아예 불가능).
 */
export function rotateStructure(nation, structId, dir = null) {
  const s = nation.structures.find(st => st.id === structId);
  if (!s) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  if (!isRotatable(s.key)) return { ok: false, error: '방향을 바꿀 수 없는 구조물입니다' };
  s.dir = dir == null ? (((s.dir || 0) + 1) % 4) : (((dir % 4) + 4) % 4);
  return { ok: true, structure: s, dir: s.dir };
}

export function setRecipe(nation, structId, recipeKey) {
  const s = nation.structures.find(s => s.id === structId);
  if (!s) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  const def = STRUCTURES[s.key];
  if (!def.recipes || !def.recipes[recipeKey]) return { ok: false, error: '올바르지 않은 레시피' };
  // 조리소 레시피는 "요리법"이라서, 처음부터 아는 것 말고는 여행으로 배워와야 쓸 수 있다.
  if (s.key === 'kitchen' && !hasGood(nation, `dish:${recipeKey}`)) {
    return { ok: false, error: '아직 배우지 못한 요리법입니다 (여행으로 배워오세요)' };
  }
  s.recipe = recipeKey;
  return { ok: true, structure: s };
}

// ============================================================
// 수동 조작 — 전력이 없거나 벨트가 없어도 손으로 돌릴 수 있게 해주는 장치
// ============================================================

/**
 * 구조물의 산출 인벤토리에서 res를 꺼내 창고(수도 포함)로 손으로 옮긴다.
 * 벨트를 깔기 전이나 벨트가 끊겼을 때 쓰는 수단.
 */
export function manualMoveToStorage(nation, structId, res, amount = LOGISTICS.manualTransfer) {
  const s = nation.structures.find(st => st.id === structId);
  if (!s) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  s.outputBuffer = s.outputBuffer || {};
  const have = s.outputBuffer[res] || 0;
  if (have <= 0) return { ok: false, error: '옮길 자원이 없습니다' };

  const moved = depositAnywhere(nation, res, Math.min(amount, have));
  if (moved <= 0) return { ok: false, error: '창고에 빈 공간이 없습니다 (창고를 더 짓거나 종류를 비워주세요)' };
  s.outputBuffer[res] -= moved;
  if (s.outputBuffer[res] <= 0) delete s.outputBuffer[res];
  recomputeStock(nation);
  return { ok: true, moved };
}

/**
 * 창고에서 자원을 꺼내 구조물의 투입 버퍼로 손으로 넣는다.
 * (레시피 재료를 벨트 없이 직접 공급하는 수단)
 */
export function manualMoveToStructure(nation, structId, res, amount = LOGISTICS.manualTransfer) {
  const s = nation.structures.find(st => st.id === structId);
  if (!s) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  s.inputBuffer = s.inputBuffer || {};

  const room = LOGISTICS.inputCapacity - (s.inputBuffer[res] || 0);
  if (room <= 0) return { ok: false, error: '투입 버퍼가 가득 찼습니다' };
  const moved = withdrawAnywhere(nation, res, Math.min(amount, room));
  if (moved <= 0) return { ok: false, error: '창고에 해당 자원이 없습니다' };
  s.inputBuffer[res] = (s.inputBuffer[res] || 0) + moved;
  recomputeStock(nation);
  return { ok: true, moved };
}

/**
 * 창고·수도의 한 면(0=동 1=남 2=서 3=북)에서 벨트로 내보낼 자원을 지정한다.
 * res를 비우면 그 면은 다시 "아무거나"가 된다. 수도처럼 여러 자원을 담는
 * 보관 구조물에서 원하는 자원만 라인으로 뽑아낼 때 쓴다 (simulate.drainStorageToBelt).
 */
export function setOutFilter(nation, structId, dir, res) {
  const s = nation.structures.find(st => st.id === structId);
  if (!s) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  if (!STRUCTURES[s.key]?.storageCapacity) return { ok: false, error: '보관 구조물이 아닙니다' };
  if (!(dir >= 0 && dir < DIR_VECT.length)) return { ok: false, error: '방향이 올바르지 않습니다' };
  if (res && !RESOURCES[res]) return { ok: false, error: '알 수 없는 자원입니다' };

  s.outFilter = s.outFilter || {};
  if (res) s.outFilter[dir] = res;
  else delete s.outFilter[dir];
  if (!Object.keys(s.outFilter).length) s.outFilter = undefined;
  return { ok: true, dir, res: res || null };
}

/** 창고에 든 자원을 다른 창고로 옮긴다 (종류 정리용) */
export function manualMoveBetweenStorages(nation, fromId, toId, res, amount = LOGISTICS.manualTransfer) {
  const from = nation.structures.find(st => st.id === fromId);
  const to = nation.structures.find(st => st.id === toId);
  if (!from || !to) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  const take = Math.min(amount, (from.store && from.store[res]) || 0);
  if (take <= 0) return { ok: false, error: '옮길 자원이 없습니다' };
  const accepted = acceptableAmount(to, res, take);
  if (accepted <= 0) return { ok: false, error: '대상 창고가 이 자원을 받을 수 없습니다' };
  withdrawFrom(from, res, accepted);
  depositInto(to, res, accepted);
  recomputeStock(nation);
  return { ok: true, moved: accepted };
}

/**
 * 수동 운용 — 전력이 없어도 버튼을 누르고 있는 동안 1사이클씩 직접 돌린다.
 * 생산량은 LOGISTICS.manualOperateRate 배율이 적용되고(사람 손이라 느리다),
 * 산출 인벤토리가 가득 찼거나 재료가 없으면 실패한다.
 */
export function manualOperate(nation, structId) {
  const s = nation.structures.find(st => st.id === structId);
  if (!s) return { ok: false, error: '구조물을 찾을 수 없습니다' };
  const def = STRUCTURES[s.key];
  if (!def) return { ok: false, error: '알 수 없는 구조물' };
  if (def.category !== 'extraction' && def.category !== 'production') {
    return { ok: false, error: '수동으로 운용할 수 있는 구조물이 아닙니다' };
  }

  const rate = LOGISTICS.manualOperateRate;
  const cap = getOutputCapacity(s.key, s.level);
  s.outputBuffer = s.outputBuffer || {};
  s.inputBuffer = s.inputBuffer || {};
  const outUsed = Object.values(s.outputBuffer).reduce((a, b) => a + b, 0);
  const room = cap - outUsed;
  if (room <= 0) return { ok: false, error: '산출 인벤토리가 가득 찼습니다' };

  if (def.category === 'extraction') {
    const t = getTile(s.x, s.y);
    if (!t.node) return { ok: false, error: '자원 노드가 없습니다' };
    const amt = Math.max(1, Math.floor(def.baseProduction * s.level * rate));
    const add = Math.min(amt, room);
    s.outputBuffer[t.node.yields] = (s.outputBuffer[t.node.yields] || 0) + add;
    return { ok: true, produced: { [t.node.yields]: add } };
  }

  // 가공 구조물 — 레시피 재료를 투입 버퍼에서 소모한다
  if (s.key === 'farm' || s.key === 'barn') {
    const plan = s.key === 'farm' ? CROPS[s.crop || 'rice'] : ANIMALS[s.animal || 'cattle'];
    if (!plan) return { ok: false, error: s.key === 'farm' ? '작물을 먼저 고르세요' : '가축을 먼저 고르세요' };
    const amt = Math.max(1, Math.floor(plan.baseYield * s.level * rate));
    const add = Math.min(amt, room);
    s.outputBuffer[plan.yields] = (s.outputBuffer[plan.yields] || 0) + add;
    return { ok: true, produced: { [plan.yields]: add } };
  }
  if (!def.recipes || !s.recipe) return { ok: false, error: '레시피를 먼저 선택하세요' };
  const r = def.recipes[s.recipe];
  const need = {};
  for (const [res, amt] of Object.entries(r.in)) need[res] = amt * s.level;
  const lacking = Object.entries(need).find(([res, amt]) => (s.inputBuffer[res] || 0) < amt);
  if (lacking) return { ok: false, error: `재료가 부족합니다 (${lacking[0]})` };

  for (const [res, amt] of Object.entries(need)) s.inputBuffer[res] -= amt;
  const produced = {};
  const outs = typeof r.out === 'number' ? { [s.recipe]: r.out } : r.out;
  for (const [res, amt] of Object.entries(outs)) {
    const add = Math.min(Math.max(1, Math.floor(amt * s.level * rate)), cap - Object.values(s.outputBuffer).reduce((a, b) => a + b, 0));
    if (add > 0) {
      s.outputBuffer[res] = (s.outputBuffer[res] || 0) + add;
      produced[res] = add;
    }
  }
  if (Object.keys(produced).length) bumpStat(nation, 'manualOps');
  return { ok: true, produced };
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
  bumpStat(nation, 'recruited');
  return { ok: true };
}

// ============================================================
// 농사 · 축산 · 여행 · 판매
// ============================================================

/** 이 국가가 해금한 작물/가축/요리법인지 (예: 'crop:wheat') */
export function hasGood(nation, key) {
  const [kind, name] = key.split(':');
  if (kind === 'crop') return !!CROPS[name]?.start || (nation.unlockedGoods || new Set()).has(key);
  if (kind === 'animal') return !!ANIMALS[name]?.start || (nation.unlockedGoods || new Set()).has(key);
  if (kind === 'dish') return START_DISHES.includes(name) || (nation.unlockedGoods || new Set()).has(key);
  return false;
}

/** 농지에 재배할 작물을 고른다 (해금된 작물만) */
export function setCrop(nation, structId, cropKey) {
  const s = nation.structures.find(st => st.id === structId);
  if (!s || s.key !== 'farm') return { ok: false, error: '농지를 찾을 수 없습니다' };
  if (!CROPS[cropKey]) return { ok: false, error: '알 수 없는 작물입니다' };
  if (!hasGood(nation, `crop:${cropKey}`)) return { ok: false, error: '아직 구하지 못한 작물입니다 (여행으로 종자를 구해오세요)' };
  s.crop = cropKey;
  return { ok: true };
}

/** 축사에서 기를 가축을 고른다 (해금된 가축만) */
export function setAnimal(nation, structId, animalKey) {
  const s = nation.structures.find(st => st.id === structId);
  if (!s || s.key !== 'barn') return { ok: false, error: '축사를 찾을 수 없습니다' };
  if (!ANIMALS[animalKey]) return { ok: false, error: '알 수 없는 가축입니다' };
  if (!hasGood(nation, `animal:${animalKey}`)) return { ok: false, error: '아직 데려오지 못한 가축입니다 (여행으로 들여오세요)' };
  s.animal = animalKey;
  return { ok: true };
}

/**
 * 여행(원정)을 떠난다. 인력을 즉시 지불하고 정해진 틱만큼 진행되며,
 * 끝나면 자원과 새 작물/가축/요리법을 얻는다 (동시에 하나만 — 연구와 같은 규칙).
 */
export function startExpedition(nation, key) {
  const exp = EXPEDITIONS[key];
  if (!exp) return { ok: false, error: '알 수 없는 여행지입니다' };
  if (nation.expedition && nation.expedition.key) return { ok: false, error: '이미 다른 여행이 진행 중입니다' };
  const capLevel = getCapitalLevel(nation);
  if (capLevel < (exp.capitalLevel || 1)) {
    return { ok: false, error: `수도 레벨 ${exp.capitalLevel}이(가) 필요합니다 (현재 ${capLevel})` };
  }
  if ((nation.resources.labor || 0) < exp.labor) return { ok: false, error: `인력이 부족합니다 (${exp.labor} 필요)` };
  nation.resources.labor -= exp.labor;
  nation.expedition = { key, ticksLeft: exp.ticks };
  return { ok: true };
}

/** 여행 완료 처리 — 보상 자원을 창고에 넣고 해금 목록을 갱신한다 */
export function finishExpedition(nation) {
  const cur = nation.expedition;
  if (!cur || !cur.key) return null;
  const exp = EXPEDITIONS[cur.key];
  nation.expedition = null;
  if (!exp) return null;

  nation.unlockedGoods = nation.unlockedGoods || new Set();
  for (const u of exp.unlocks || []) nation.unlockedGoods.add(u);
  const gained = {};
  for (const [res, amt] of Object.entries(exp.rewards || {})) {
    const stored = depositAnywhere(nation, res, amt);
    if (stored > 0) gained[res] = stored; // 창고가 가득 차면 못 받는 몫은 버려진다
  }
  recomputeStock(nation);
  bumpStat(nation, 'expeditions');
  return { key: cur.key, name: exp.name, gained, unlocks: exp.unlocks || [] };
}

/** 창고에 있는 자원을 팔아 국고 골드로 바꾼다 (요리처럼 공정이 깊을수록 비싸다) */
export function sellFromStorage(nation, res, amount) {
  const price = getSellPrice(res);
  if (price <= 0) return { ok: false, error: '팔 수 없는 자원입니다' };
  const have = totalStock(nation, res);
  const qty = Math.max(0, Math.min(Math.floor(amount), have));
  if (qty <= 0) return { ok: false, error: '창고에 재고가 없습니다' };
  withdrawAnywhere(nation, res, qty);
  const earned = price * qty;
  nation.resources.gold = (nation.resources.gold || 0) + earned;
  recomputeStock(nation);
  bumpStat(nation, 'goldEarned', earned);
  return { ok: true, sold: qty, earned };
}

/** 현재 수도 레벨 (수도가 없으면 0) — 연구 단계 판정에 쓰인다 */
export function getCapitalLevel(nation) {
  const cap = nation.structures.find(s => s.key === 'capital');
  return cap ? cap.level : 0;
}

/** 연구소 연구 시작 (동시에 하나만 진행 — 단순화된 규칙) */
export function startResearch(nation, structKey) {
  if (nation.unlocked.has(structKey)) return { ok: false, error: '이미 해금된 구조물입니다' };
  const tech = TECH_TREE[structKey];
  if (!tech) return { ok: false, error: '연구할 수 없는 항목입니다' };
  if (nation.research && nation.research.key) return { ok: false, error: '이미 다른 연구가 진행 중입니다' };
  const hasLab = nation.structures.some(s => s.key === 'lab');
  if (!hasLab) return { ok: false, error: '연구소를 먼저 건설해야 합니다' };
  const capLevel = getCapitalLevel(nation);
  if (capLevel < (tech.capitalLevel || 1)) {
    return { ok: false, error: `수도 레벨 ${tech.capitalLevel}이(가) 필요합니다 (현재 ${capLevel})` };
  }
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

  // 약탈은 실제 재고를 옮긴다. 실물 자원은 창고·수도에서 빼내 공격자 창고에 넣고,
  // 골드 같은 비물질 자원만 수치로 주고받는다. (nation.resources는 창고 합계라서
  // 여기에 직접 써 봐야 다음 틱의 recomputeStock에서 덮어써진다)
  const appliedLoot = {};
  for (const [res, rawAmt] of Object.entries(loot || {})) {
    const want = Math.max(0, Math.floor(Number(rawAmt) || 0));
    if (want <= 0) continue;
    if (VIRTUAL_RESOURCES.has(res)) {
      const take = Math.min(want, defender.resources[res] || 0);
      if (take <= 0) continue;
      defender.resources[res] -= take;
      attacker.resources[res] = (attacker.resources[res] || 0) + take;
      appliedLoot[res] = take;
      continue;
    }
    const taken = withdrawAnywhere(defender, res, Math.min(want, totalStock(defender, res)));
    if (taken <= 0) continue;
    const stored = depositAnywhere(attacker, res, taken);
    // 공격자 창고가 가득 차 못 받은 몫은 그대로 소실된다(전장에 버려진 것으로 본다)
    appliedLoot[res] = stored;
  }
  recomputeStock(defender);
  recomputeStock(attacker);

  const { attackerTrophyDelta, defenderTrophyDelta } = tradeTrophies(win, attacker.trophies || 0, defender.trophies || 0);
  attacker.trophies = Math.max(0, (attacker.trophies || 0) + attackerTrophyDelta);
  defender.trophies = Math.max(0, (defender.trophies || 0) + defenderTrophyDelta);

  // 배치했던 공격 유닛은 생존 여부와 무관하게 소모된다 (다시 모집해야 함)
  consumeDeployedUnits(attacker, raidResult.deployedUnits);

  attacker.shieldUntil = 0;                          // 공격하면 자신의 실드는 즉시 해제
  defender.shieldUntil = now + WAR.postAttackShieldMs; // 공격당한 쪽은 새 실드를 얻는다 (연쇄 공격 방지)

  return { win, destructionPercent, loot: appliedLoot, attackerTrophyDelta, defenderTrophyDelta };
}

/** 배치했던 공격 유닛을 로스터에서 뺀다 (생존 여부와 무관하게 소모) */
function consumeDeployedUnits(attacker, deployedUnits) {
  attacker.units = attacker.units || { attack: {}, defense: {} };
  for (const [key, rawCount] of Object.entries(deployedUnits || {})) {
    if (!UNITS.attack[key]) continue;
    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
    attacker.units.attack[key] = Math.max(0, (attacker.units.attack[key] || 0) - count);
  }
}

// ============================================================
// 비동기 습격 (양쪽이 같은 순간에 접속해 있지 않은 멀티플레이)
//
// applyRaidResult는 공격자와 방어자 객체가 **둘 다 메모리에 있을 때** 쓴다
// (로컬 플레이 / Cloud Functions 서버). 실제 멀티플레이에서는 방어자가
// 접속해 있지 않을 수 있어서, 공격자가 자기 몫을 먼저 반영하고 "습격 리포트"를
// 남기면, 방어자가 다음에 접속했을 때 자기 몫을 반영한다.
//
// 그래서 아래 두 함수는 applyRaidResult를 반으로 쪼갠 것이다:
//   applyRaidToAttacker — 약탈품 획득 · 유닛 소모 · 트로피 · 실드 해제
//   applyRaidToDefender — 약탈 손실 · 트로피 · 실드 획득 (리포트 id로 멱등)
//
// 방어자는 공격자가 보낸 숫자를 그대로 믿지 않는다. 파괴율에서 승패를 다시
// 계산하고, 트로피 변동은 규칙상 가능한 범위로 자르고, 약탈은 지금 실제로
// 가진 재고까지만 빠진다. 즉 조작된 리포트로 뺏을 수 있는 최대치는
// "정직하게 완승했을 때"와 같다.
// ============================================================

/** 습격 리포트를 만든다 (공격자가 전투를 끝낸 직후). 그대로 직렬화해 전송한다. */
export function buildRaidReport(attacker, defenderSnapshot, session, now = Date.now()) {
  const result = session.result || {};
  const destructionPercent = Math.max(0, Math.min(1, Number(result.destructionPercent) || 0));
  const win = !!result.perfectVictory || destructionPercent >= BATTLE.winDestructionPct;
  const { attackerTrophyDelta, defenderTrophyDelta } =
    tradeTrophies(win, attacker.trophies || 0, defenderSnapshot.trophies || 0);
  return {
    id: `${attacker.id}_${now}_${Math.floor(Math.random() * 1e6)}`,
    attackerId: attacker.id, attackerName: attacker.name, attackerColor: attacker.color,
    defenderId: defenderSnapshot.id, defenderName: defenderSnapshot.name,
    win, destructionPercent, perfectVictory: !!result.perfectVictory,
    loot: { ...(result.loot || {}) },
    deployedUnits: { ...(result.deployedUnits || {}) },
    attackerTrophyDelta, defenderTrophyDelta,
    // 방어자가 "어떻게 뚫렸는지" 그대로 재생해 볼 수 있는 기록 (battle.js).
    // 무대가 된 기지 배치도 같이 담는다 — 그 뒤에 기지를 고쳐도 그때 그대로 재생된다.
    replay: {
      seed: session.seed,
      deploys: (session.deployLog || []).map(d => ({ ...d })),
      base: {
        // 영토는 담지 않는다 — 구조물에서 다시 만들어진다 (territoryFromStructures)
        id: defenderSnapshot.id, name: defenderSnapshot.name, color: defenderSnapshot.color,
        capital: defenderSnapshot.capital,
        structures: (defenderSnapshot.structures || []).map(s => ({ ...s })),
        units: { defense: { ...((defenderSnapshot.units && defenderSnapshot.units.defense) || {}) } },
      },
    },
    timestamp: now,
  };
}

/** 공격자 쪽 반영 — 약탈품을 창고에 넣고, 배치한 유닛을 소모하고, 트로피를 받는다. */
export function applyRaidToAttacker(attacker, report, now = Date.now()) {
  const gained = {};
  for (const [res, rawAmt] of Object.entries(report.loot || {})) {
    const want = Math.max(0, Math.floor(Number(rawAmt) || 0));
    if (want <= 0) continue;
    if (VIRTUAL_RESOURCES.has(res)) {
      attacker.resources[res] = (attacker.resources[res] || 0) + want;
      gained[res] = want;
      continue;
    }
    const stored = depositAnywhere(attacker, res, want);   // 창고가 모자라면 그만큼만 받는다
    if (stored > 0) gained[res] = stored;
  }
  recomputeStock(attacker);
  consumeDeployedUnits(attacker, report.deployedUnits);
  attacker.trophies = Math.max(0, (attacker.trophies || 0) + (report.attackerTrophyDelta || 0));
  attacker.shieldUntil = 0;                                 // 공격하면 내 실드는 사라진다
  attacker.raidsSent = (attacker.raidsSent || 0) + 1;
  bumpStat(attacker, report.win ? 'raidsWon' : 'raidsLost');
  if (report.perfectVictory) bumpStat(attacker, 'perfectWins');
  bumpStat(attacker, 'looted', Object.values(gained).reduce((a, b) => a + b, 0));
  return { gained };
}

/**
 * 방어자 쪽 반영 — 같은 리포트를 두 번 받아도 한 번만 적용된다(멱등).
 * 이미 반영한 리포트 id는 nation.seenRaids에 남는다.
 */
export function applyRaidToDefender(defender, report, now = Date.now()) {
  defender.seenRaids = defender.seenRaids || [];
  if (report.id && defender.seenRaids.includes(report.id)) return { applied: false, lost: {} };

  // 승패는 파괴율에서 다시 계산한다 (공격자가 보낸 win 값을 믿지 않는다)
  const destructionPercent = Math.max(0, Math.min(1, Number(report.destructionPercent) || 0));
  const win = !!report.perfectVictory || destructionPercent >= BATTLE.winDestructionPct;

  // 약탈 상한도 파괴율에서 다시 계산한다. 공격자가 부풀린 숫자를 보내도
  // "그 파괴율로 가져갈 수 있는 최대치"를 넘지 못한다.
  const lootMul = report.perfectVictory ? BATTLE.perfectVictoryLootMul : 1;
  const maxFraction = Math.min(1, destructionPercent * BATTLE.lootRatePerHp * lootMul);

  const lost = {};
  for (const [res, rawAmt] of Object.entries(report.loot || {})) {
    const want = Math.max(0, Math.floor(Number(rawAmt) || 0));
    if (want <= 0) continue;
    if (VIRTUAL_RESOURCES.has(res)) {
      const held = defender.resources[res] || 0;
      const take = Math.min(want, Math.floor(held * maxFraction));
      if (take <= 0) continue;
      defender.resources[res] -= take;
      lost[res] = take;
      continue;
    }
    const held = totalStock(defender, res);
    const take = withdrawAnywhere(defender, res, Math.min(want, Math.floor(held * maxFraction)));
    if (take > 0) lost[res] = take;
  }
  recomputeStock(defender);

  // 트로피 변동도 규칙상 가능한 범위로 자른다
  const raw = Number(report.defenderTrophyDelta) || 0;
  const delta = win ? Math.max(-WAR.maxTrophyTrade, Math.min(0, raw)) : 0;
  defender.trophies = Math.max(0, (defender.trophies || 0) + delta);
  defender.shieldUntil = now + WAR.postAttackShieldMs;      // 연쇄 공격 방지

  defender.seenRaids.push(report.id);
  if (defender.seenRaids.length > 100) defender.seenRaids = defender.seenRaids.slice(-100);
  bumpStat(defender, win ? 'defensesLost' : 'defensesWon');
  bumpStat(defender, 'lostToRaids', Object.values(lost).reduce((a, b) => a + b, 0));
  return { applied: true, win, destructionPercent, lost, trophyDelta: delta };
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
  const attackable = candidates.filter(c => c.id !== myNation.id && !isShielded(c, now));
  if (!attackable.length) return null;

  const byTrophyGap = (a, b) =>
    Math.abs((a.trophies || 0) - myTrophies) - Math.abs((b.trophies || 0) - myTrophies);

  // 트로피가 비슷한 상대가 우선이지만, 접속자가 적을 때는 범위를 넘겨서라도
  // 붙여준다. 상대가 분명히 있는데 "찾을 수 없다"고 하면 전쟁 자체가 막힌다.
  const inRange = attackable.filter(c => Math.abs((c.trophies || 0) - myTrophies) <= WAR.matchTrophyRange);
  const pool = (inRange.length ? inRange : attackable).sort(byTrophyGap);
  // 가장 비슷한 후보 몇 명 중 무작위로 하나 선택 (매번 같은 상대만 나오지 않도록)
  const topPool = pool.slice(0, Math.min(5, pool.length));
  return topPool[Math.floor(Math.random() * topPool.length)];
}

/**
 * 다른 플레이어에게 공개하는 국가 스냅샷.
 * 공격자가 이걸 그대로 battle.js에 넣어 전투를 돌리므로, 방어에 필요한 것만
 * 담는다 — 기지 배치(구조물·영토), 수비 로스터, 약탈 대상이 되는 재고, 트로피.
 * 연구 진행이나 레시피 같은 내정 정보는 넘기지 않는다.
 */
export function defenseSnapshot(nation, now = Date.now()) {
  // 영토(타일 수천 개)는 담지 않는다 — 구조물에서 다시 만들 수 있다
  // (territoryFromStructures). 스냅샷은 접속자 수만큼 오가므로 작을수록 좋다.
  return {
    id: nation.id,
    name: nation.name,
    color: nation.color,
    capital: nation.capital,
    trophies: nation.trophies || 0,
    shieldUntil: nation.shieldUntil || 0,
    structures: (nation.structures || []).map(s => ({
      id: s.id, key: s.key, x: s.x, y: s.y, level: s.level, dir: s.dir || 0, idle: !!s.idle,
    })),
    units: { defense: { ...((nation.units && nation.units.defense) || {}) } },
    resources: { ...(nation.resources || {}) },
    defensePower: getDefensePower(nation),
    updatedAt: now,
  };
}

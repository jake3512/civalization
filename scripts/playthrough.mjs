// ============================================================
// scripts/playthrough.mjs — 게임을 실제로 처음부터 끝까지 자동 플레이한다.
//
// check-progression.mjs가 "비용을 감당할 수 있는가"를 추상적으로 따지는 것과
// 달리, 이 스크립트는 진짜 게임 코드(logic.js · simulate.js)로 나라를 세우고
// 구조물을 짓고 매 틱을 돌리며 수도 10레벨 · 전 기술 연구까지 밀어붙인다.
// 그래서 "규칙상으로는 되는데 실제로는 안 되는" 문제(자리가 없다, 자원이
// 창고까지 오지 못한다, 특정 구조물이 영영 멈춰 있다 …)를 잡아낸다.
//
// 실행: node scripts/playthrough.mjs [--from=x,y] [--verbose] [--debug]
//
// 주의: 이 봇은 "게임이 완주 가능한가"를 확인하는 도구지 최적 플레이어가 아니다.
// 자원 배분이 서툴러 일부 시작 지점에서는 중간에 자원을 다 써버리고 정체한다.
// 봇이 멈췄다고 곧 게임이 막힌 것은 아니며, 판정은 "부족: ○○" 자원이 실제로
// 그 시점에 생산 가능한지로 해야 한다.
// ============================================================
import { createNation } from '../js/game.js';
import * as L from '../js/logic.js';
import {
  STRUCTURES, TECH_TREE, RESOURCES, UNITS, CROPS, ANIMALS, EXPEDITIONS,
  LOGISTICS, VIRTUAL_RESOURCES, getUpgradeCost,
} from '../js/data.js';
import { getTile } from '../js/world.js';
import { TERRAIN_NODES } from '../js/data.js';
import { createBattleSession, deployUnit, stepBattle, endBattle, getDestructionPercent } from '../js/battle.js';
import * as gameMod from '../js/game.js';

const VERBOSE = process.argv.includes('--verbose');
const MAX_TICKS = 60000;

const log = [];
const problems = [];
const note = (msg) => { log.push(msg); if (VERBOSE) console.log('   ' + msg); };
const problem = (msg) => { if (!problems.includes(msg)) problems.push(msg); };

// ---------------- 준비: 수도를 세울 자리 찾기 ----------------
// --from x,y 로 다른 시작 지점에서도 돌려볼 수 있다 (지도는 시드 고정이라
// 시작 위치가 곧 "다른 판"이 된다)
const fromArg = (process.argv.find(a => a.startsWith('--from=')) || '').slice(7);
const [fx, fy] = fromArg ? fromArg.split(',').map(Number) : [0, 0];
const site = L.findNearestCapitalSite(fx, fy, 200);
if (!site) { console.error('❌ 수도를 세울 자리를 찾지 못했습니다'); process.exit(1); }
const n = createNation('bot', '자동 플레이 왕국', '#d98e34', site.x, site.y);
console.log(`▶ 건국 (${site.x}, ${site.y})`);

// ---------------- 헬퍼 ----------------
const tiles = () => Array.from(n.territory).map(k => k.split(',').map(Number));
const structsOf = (key) => n.structures.filter(s => s.key === key);
const capital = () => n.structures.find(s => s.key === 'capital');
const stock = (res) => L.totalStock(n, res);
/** 비용을 감당할 수 있는지 (logic.canAfford는 내부 함수라 여기서 같은 판정을 한다) */
const afford = (cost) => Object.entries(cost || {}).every(([r, a]) => stock(r) >= a);
/**
 * "수도 업그레이드에 쓸 몫을 건드리지 않고" 이 비용을 낼 수 있는가.
 * 이 규칙이 없으면 봇이 창고·공장을 계속 지어대느라 수도 업그레이드 자원을
 * 영영 못 모은다 (실제로 그렇게 Lv.4에서 맴돌았다).
 */
function affordSpare(cost) {
  const reserve = getUpgradeCost('capital', capital().level) || {};
  return Object.entries(cost || {}).every(([r, a]) => stock(r) - (reserve[r] || 0) >= a);
}

/** 비어 있는 자리에 구조물을 짓는다. 자원 노드가 필요하면 그 노드 위에 짓는다. */
function buildSomewhere(key, { onNode = null } = {}) {
  const cap = n.structures.find(s => s.key === 'capital');
  const [fw, fh] = STRUCTURES[key].footprint;
  // 수도에서 가까운 칸부터 — 초반에 전력이 닿지 않는 먼 곳에 흩뿌리지 않도록
  const order = tiles().sort((a, b) =>
    Math.hypot(a[0] - cap.x, a[1] - cap.y) - Math.hypot(b[0] - cap.x, b[1] - cap.y));
  for (const [x, y] of order) {
    if (onNode) {
      const t = getTile(x, y);
      if (!t.node || t.node.yields !== onNode) continue;
    } else if (coversNode(x, y, fw, fh)) {
      continue; // 자원 노드 위에 창고·공장을 올려 채굴 자리를 막지 않는다
    }
    const r = L.build(n, key, x, y);
    if (r.ok) return r.structure;
  }
  return null;
}

/** 이 발판이 자원 노드를 덮는가 */
function coversNode(x, y, w, h) {
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) if (getTile(x + dx, y + dy).node) return true;
  }
  return false;
}

/** 지금 모자란 자원 → 목표 수량 (수도 업그레이드 + 할 수 있는 연구 기준) */
function neededNow() {
  const m = new Map();
  const add = (cost, mul = 1.2) => {
    for (const [r, a] of Object.entries(cost || {})) m.set(r, Math.max(m.get(r) || 0, Math.ceil(a * mul)));
  };
  add(getUpgradeCost('capital', capital().level));
  for (const [key, tech] of Object.entries(TECH_TREE)) {
    if (n.unlocked.has(key)) continue;
    if ((tech.capitalLevel || 1) > capital().level) continue;
    add(tech.cost);
  }
  return m;
}

/** 자원 하나를 목표량만큼 쌓으려면 창고가 몇 개 있어야 하는가 */
function warehousesFor(res, amount) {
  const per = STRUCTURES.warehouse.storageCapacity;      // 레벨 1 기준 용량
  const have = structsOf('warehouse').filter(s => (s.store || {})[res] > 0)
    .reduce((sum, s) => sum + per * s.level, 0);
  return Math.max(0, Math.ceil((amount - have) / per));
}

/** 지금 다루는 자원 종류 수 + 여유분 (창고 하나에 한 종류만 들어가므로) */
function warehouseTarget() {
  const kinds = new Set();
  for (const s of n.structures) {
    for (const [r, a] of Object.entries(s.store || {})) if (a > 0) kinds.add(r);
    for (const [r, a] of Object.entries(s.outputBuffer || {})) if (a > 0) kinds.add(r);
  }
  // 한 종류를 창고 하나(500)보다 많이 모아야 하는 자원은 그만큼 창고가 더 필요하다.
  // (수도 상위 레벨은 석재를 2600개씩 요구해서, 종류 수만 세면 용량이 모자라 영영 못 모은다)
  let extra = 0;
  for (const [res, need] of neededNow()) {
    if (VIRTUAL_RESOURCES.has(res)) continue;
    extra += Math.max(0, warehousesFor(res, need) - 1);
  }
  return Math.min(70, Math.max(8, kinds.size + 6 + extra));
}

/** 창고를 늘린다 (창고 하나에 한 종류만 들어가므로 자원 종류만큼 필요하다) */
function ensureWarehouses(count) {
  let made = 0;
  while (structsOf('warehouse').length < count) {
    // 보관 공간은 곧 목표 자원을 모을 수 있느냐의 문제라 항상 필수로 본다.
    // (예비분으로만 짓게 했더니 석재가 용량 상한에 걸려 수도 Lv.3에서 멈췄다)
    if (!afford(STRUCTURES.warehouse.baseCost)) break;
    if (!buildSomewhere('warehouse')) break;
    made++;
  }
  return made;
}

/** 산출 인벤토리에 쌓인 것을 창고로 손으로 옮긴다 (벨트 대신 쓰는 안전한 물류) */
function haulAll() {
  for (const s of n.structures) {
    const out = s.outputBuffer || {};
    for (const [res, amt] of Object.entries(out)) {
      if (amt <= 0) continue;
      let guard = 0;
      while ((s.outputBuffer[res] || 0) > 0 && guard++ < 200) {
        const r = L.manualMoveToStorage(n, s.id, res, LOGISTICS.manualTransfer);
        if (!r.ok || r.moved === 0) break;
      }
    }
  }
}

/** 가공 구조물의 투입 버퍼를 채운다 (레시피 재료 · 발전소 연료) */
function feedAll() {
  for (const s of n.structures) {
    const def = STRUCTURES[s.key];
    let need = null;
    if (s.key === 'power_plant') need = { wood: 2 };
    else if (def.recipes && s.recipe) need = def.recipes[s.recipe].in;
    if (!need) continue;
    for (const res of Object.keys(need)) {
      const have = (s.inputBuffer || {})[res] || 0;
      if (have >= LOGISTICS.inputCapacity * 0.5) continue;
      let guard = 0;
      while (((s.inputBuffer || {})[res] || 0) < LOGISTICS.inputCapacity * 0.5 && guard++ < 30) {
        const r = L.manualMoveToStructure(n, s.id, res, LOGISTICS.manualTransfer);
        if (!r.ok || r.moved === 0) break;
      }
    }
  }
}

/** 어떤 자원을 만들 수 있는 레시피를 가진 구조물 key를 찾는다 */
function producerOf(res) {
  for (const [key, def] of Object.entries(STRUCTURES)) {
    if (def.recipes && def.recipes[res]) return key;
  }
  return null;
}

// ---------------- 플레이 루프 ----------------
let tick = 0;
let lastProgressTick = 0;
let needSpace = false;        // 지을 자리가 없어 영토를 넓혀야 하는 상태
const milestones = [];
const seenIdle = new Map();   // "구조물:사유" -> { first, count }
const everSeen = new Set();   // 한 번이라도 실제로 손에 넣어 본 자원

function play() {
  while (tick < MAX_TICKS) {
    tick++;
    n.tick();
    haulAll();

    // 한 번이라도 실제로 생겨난 자원을 기록해 둔다
    for (const s of n.structures) {
      for (const [r, a] of Object.entries(s.outputBuffer || {})) if (a > 0) everSeen.add(r);
      for (const [r, a] of Object.entries(s.store || {})) if (a > 0) everSeen.add(r);
    }

    // 정지 사유를 모아둔다 (오래 멈춰 있으면 문제로 본다)
    for (const s of n.structures) {
      if (s.idle && s.idleReason) {
        const k = `${s.key}:${s.idleReason}`;
        if (!seenIdle.has(k)) seenIdle.set(k, { first: tick, count: 0 });
        seenIdle.get(k).count++;
      }
    }

    const before = describe();
    act();
    feedAll();
    L.recomputeStock(n);
    if (describe() !== before) lastProgressTick = tick;

    if (capital().level >= STRUCTURES.capital.maxLevel && allResearched()) return true;
    // 8000틱 동안 아무 변화가 없으면 막힌 것으로 본다
    if (tick - lastProgressTick > 8000) return false;
  }
  return false;
}

const allResearched = () => Object.keys(TECH_TREE).every(k => n.unlocked.has(k));
/**
 * "진행 중인가"를 나타내는 지문. 구조물·연구뿐 아니라 **다음 수도 업그레이드에
 * 얼마나 다가갔는지**도 넣는다. 이게 없으면 "지을 건 다 짓고 자원만 모으는
 * 중"인 정상 상태를 멈춘 것으로 잘못 판정한다.
 */
function describe() {
  const cost = getUpgradeCost('capital', capital().level) || {};
  const progress = Object.entries(cost)
    .reduce((a, [r, amt]) => a + Math.min(1, stock(r) / amt), 0);
  return `${capital().level}|${n.unlocked.size}|${n.structures.length}`
    + `|${n.unlockedGoods.size}|${progress.toFixed(2)}`;
}

/** 매 틱 하는 일: 짓기 → 연구 → 여행 → 레시피 설정 → 수도 업그레이드 */
function act() {
  const cap = capital();

  // 0) 창고가 먼저다. 산출 인벤토리가 차면 채굴·가공이 통째로 멈추기 때문에,
  //    광산을 더 짓기 전에 보관 공간부터 확보한다.
  //    (이 순서를 뒤로 미뤘더니 광산이 석재를 다 먹어 창고를 못 짓고,
  //     창고가 없어 석재가 안 쌓이는 교착에 빠졌다)
  ensureWarehouses(warehouseTarget());

  // 1) 채굴 구조물 — 영토 안의 자원 노드마다 하나씩
  for (const [nodeRes, structKey] of [['wood', 'lumber_mill'], ['stone', 'mine'],
                                      ['coal', 'mine'], ['iron_ore', 'mine'],
                                      ['copper_ore', 'mine'], ['gold_ore', 'mine'],
                                      ['mana_stone', 'extractor'], ['crude_oil', 'oil_well']]) {
    if (!n.unlocked.has(structKey)) continue;
    // 채굴은 수입원 자체라 항상 최우선 (예비분을 헐어도 짓는다)
    if (!afford(STRUCTURES[structKey].baseCost)) continue;
    const s = buildSomewhere(structKey, { onNode: nodeRes });
    if (s) note(`t${tick} ${STRUCTURES[structKey].name} 건설 (${nodeRes} 노드)`);
  }

  // 1-1) 중심지(hub)로 영토를 넓힌다.
  //      수도 업그레이드에 필요한 광물이 지금 영토에 없으면 그쪽으로 뻗어 나간다.
  if (tick % 5 === 0) expandTowardMissing();

  // 2) 남아도는 자원은 팔아서 창고 자리를 비운다 (플레이어도 이렇게 한다).
  //    이걸 안 하면 목재·석재가 창고를 다 채워 광석이 들어갈 곳이 없어진다.
  if (tick % 5 === 0) sellSurplus();

  // 3) 연구 — 지금 할 수 있는 것 아무거나
  if (!n.research) {
    for (const key of Object.keys(TECH_TREE)) {
      if (n.unlocked.has(key)) continue;
      const r = L.startResearch(n, key);
      if (r.ok) { note(`t${tick} 연구 시작: ${STRUCTURES[key].name}`); break; }
    }
  }

  // 3-1) 전력 — 수도 범위 밖에 지은 구조물은 발전소를 붙여줘야 돈다
  ensurePower();

  // 4) 가공 구조물 — 아직 못 만드는 자원을 만들 수 있는 구조물을 하나씩 짓는다
  for (const key of ['smelter', 'factory', 'refinery', 'farm', 'barn',
                     'slaughterhouse', 'kitchen', 'lab', 'outpost']) {
    if (!n.unlocked.has(key)) continue;
    const want = ['smelter', 'factory', 'refinery'].includes(key) ? 4 : 2;
    if (structsOf(key).length >= want) continue;
    // 그 종류가 아직 하나도 없으면 예비분을 헐어서라도 짓는다 (없으면 진행 자체가 막힌다)
    const first = structsOf(key).length === 0;
    if (!(first ? afford(STRUCTURES[key].baseCost) : affordSpare(STRUCTURES[key].baseCost))) continue;
    const s = buildSomewhere(key);
    if (s) note(`t${tick} ${STRUCTURES[key].name} 건설`);
    // 지을 자리가 없어서 실패했다면 영토를 넓혀야 한다 (빈 칸이 조각나
    // 2x2 발판이 안 들어가는 경우가 실제로 생긴다)
    else needSpace = true;
  }

  // 5) 레시피 — 지금 재료를 댈 수 있는 것 중에서 고른다.
  //    (재료가 없는 레시피에 고정되면 그 구조물은 영영 멈춘다)
  const assigned = new Map();
  for (const s of n.structures) {
    const def = STRUCTURES[s.key];
    if (!def.recipes) continue;
    if (s.key === 'kitchen') { pickKitchenRecipe(s); continue; }
    const feasible = Object.keys(def.recipes).filter(k =>
      Object.entries(def.recipes[k].in).every(([res, amt]) =>
        stock(res) >= amt || ((s.inputBuffer || {})[res] || 0) >= amt));
    if (!feasible.length) continue;
    // 같은 종류의 구조물끼리는 서로 다른 레시피를 맡아 산출을 고르게 한다
    // 지금 수도 업그레이드/연구에 모자란 자원을 먼저 만든다 (플레이어의 우선순위)
    const need = neededNow();
    const rank = (k) => (need.has(k) && stock(k) < need.get(k) ? 0 : 1) * 1e9 + stock(k);
    const used = assigned.get(s.key) || new Set();
    const pick = feasible.filter(k => !used.has(k)).sort((a, b) => rank(a) - rank(b))[0]
      || feasible.sort((a, b) => rank(a) - rank(b))[0];
    used.add(pick); assigned.set(s.key, used);
    if (s.recipe !== pick) L.setRecipe(n, s.id, pick);
  }

  // 6) 농지/축사 — 고를 수 있는 것 중 하나
  for (const s of structsOf('farm')) {
    if (s.crop) continue;
    for (const k of Object.keys(CROPS)) if (L.setCrop(n, s.id, k).ok) break;
  }
  for (const s of structsOf('barn')) {
    if (s.animal) continue;
    for (const k of Object.keys(ANIMALS)) if (L.setAnimal(n, s.id, k).ok) break;
  }

  // 7) 여행 — 인력이 모이면 순서대로
  if (!n.expedition) {
    for (const key of Object.keys(EXPEDITIONS)) {
      if (L.hasGood(n, (EXPEDITIONS[key].unlocks || [])[0])) continue;
      const r = L.startExpedition(n, key);
      if (r.ok) { note(`t${tick} 여행 출발: ${EXPEDITIONS[key].name}`); break; }
    }
  }

  // 8) 수도 업그레이드
  const upCost = getUpgradeCost('capital', cap.level);
  if (upCost && afford(upCost)) {
    const r = L.upgrade(n, cap.id);
    if (r.ok) {
      milestones.push(`t${tick} 수도 Lv.${cap.level} (구조물 ${n.structures.length}, 해금 ${n.unlocked.size}/${Object.keys(TECH_TREE).length})`);
      console.log(`  ✓ ${milestones[milestones.length - 1]}`);
    }
  }

  // 9) 다른 구조물도 여유가 있으면 올린다 (생산량 확보)
  if (tick % 15 === 0) {
    for (const s of n.structures) {
      if (s.key === 'capital' || s.key === 'belt') continue;
      const c = getUpgradeCost(s.key, s.level);
      // 채굴·가공 구조물의 레벨업은 곧 생산량이라 "투자"로 본다.
      // 수도 업그레이드 예비분에 묶어두면 생산이 안 늘어 영영 못 모은다
      // (수도 비용 배율을 올렸더니 실제로 그렇게 정체했다).
      const invest = s.key === 'warehouse'
        || STRUCTURES[s.key].category === 'extraction'
        || STRUCTURES[s.key].category === 'production';
      if (c && (invest ? afford(c) : affordSpare(c))) L.upgrade(n, s.id);
    }
  }
}

/**
 * 전력이 없어 멈춘 구조물 옆에 발전소를 세운다.
 * 수도 영토 범위 안은 자동 공급이지만, 중심지로 넓힌 먼 땅은 발전소가 필요하다.
 */
function ensurePower() {
  if (!n.unlocked.has('power_plant')) return;
  if (!afford(STRUCTURES.power_plant.baseCost)) return;
  const dark = n.structures.find(s => s.idleReason === '전력 없음');
  if (!dark) return;
  // 멈춘 구조물 가까이에 자리를 잡는다
  const cands = tiles()
    .map(([x, y]) => [x, y, Math.hypot(x - dark.x, y - dark.y)])
    .filter(([, , d]) => d < 12)
    .sort((a, b) => a[2] - b[2]);
  for (const [x, y] of cands) {
    if (L.build(n, 'power_plant', x, y).ok) { note(`t${tick} 발전소 건설 (${dark.key} 주변)`); return; }
  }
}

/** 지금 영토 안에 있는 자원 노드 종류 */
function nodesInTerritory() {
  const set = new Set();
  for (const [x, y] of tiles()) { const t = getTile(x, y); if (t.node) set.add(t.node.yields); }
  return set;
}

/** 원석 → 그 원석에서 나오는 가공품 (수도 비용에서 역으로 필요한 노드를 찾기 위해) */
const ORE_FOR = {
  iron_ingot: 'iron_ore', gold_ingot: 'gold_ore', copper_ingot: 'copper_ore',
  copper_wire: 'copper_ore', petroleum: 'crude_oil', naphtha: 'crude_oil',
  plastic: 'crude_oil', mana_stone: 'mana_stone', coal: 'coal',
};

/**
 * 중심지를 지어 영토를 넓힌다. 아직 손에 넣지 못한 자원 노드 쪽으로 뻗는다.
 * (수도 업그레이드 비용에 필요한 광물이 영토에 없으면 여기서 막히기 때문)
 */
function expandTowardMissing() {
  if (!afford(STRUCTURES.hub.baseCost)) return;   // 확장은 진행에 직결되므로 예비분을 헐어도 된다
  const have = nodesInTerritory();
  const upCost = getUpgradeCost('capital', capital().level) || {};
  // 지금 필요한데 영토에 없는 "원석"만 고른다.
  // (벽돌·판자처럼 노드에서 안 나오는 자원을 목표로 삼으면 영영 못 찾아
  //  확장 자체가 멈춘다 — 실제로 그렇게 막혔었다)
  const oreYields = new Set(Object.values(TERRAIN_NODES).map(d => d.yields));
  const wanted = new Set();
  const wantOre = (res) => {
    const ore = ORE_FOR[res] || res;
    if (oreYields.has(ore) && !have.has(ore)) wanted.add(ore);
  };
  for (const res of Object.keys(upCost)) wantOre(res);
  // 연구에 필요한 원석도 챙긴다 (지금 할 수 있는 연구 기준)
  for (const [key, tech] of Object.entries(TECH_TREE)) {
    if (n.unlocked.has(key)) continue;
    if ((tech.capitalLevel || 1) > capital().level) continue;
    for (const res of Object.keys(tech.cost)) wantOre(res);
  }
  if (!wanted.size) {
    // 필요한 광물은 다 있다. 지을 자리가 모자랄 때만 조금씩 넓힌다.
    if (needSpace || freeTiles() < 40) {
      // 바깥쪽 칸부터 여러 곳을 시도한다 (한 곳만 찔러보면 거기가 막혔을 때
      // 영영 넓히지 못한다)
      for (const [x, y] of frontierTiles(60)) {
        if (L.build(n, 'hub', x, y).ok) { needSpace = false; note(`t${tick} 중심지 건설 (부지 확보)`); break; }
      }
    }
    return;
  }
  // 영토 밖에서 가장 가까운 목표 노드를 찾고, 그 방향의 영토 경계에 중심지를 세운다
  const cap = capital();
  let best = null;
  for (let r = 1; r <= 40; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (const dy of (Math.abs(dx) === r ? range(-r, r) : [-r, r])) {
        const x = cap.x + dx, y = cap.y + dy;
        if (n.territory.has(`${x},${y}`)) continue;
        const t = getTile(x, y);
        if (t.node && wanted.has(t.node.yields)) { best = [x, y]; break; }
      }
      if (best) break;
    }
    if (best) break;
  }
  if (!best) return;
  // 목표에 가장 가까운 "지을 수 있는" 영토 칸에 중심지를 세운다
  const cands = tiles()
    .map(([x, y]) => [x, y, Math.hypot(x - best[0], y - best[1])])
    .sort((a, b) => a[2] - b[2]);
  for (const [x, y] of cands.slice(0, 60)) {
    if (L.build(n, 'hub', x, y).ok) { note(`t${tick} 중심지 건설 → ${best} 방향`); return; }
  }
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** 아직 아무것도 없는 영토 칸 수 (지을 자리가 남았는지) */
function freeTiles() {
  const used = new Set();
  for (const s of n.structures) {
    const [w, h] = STRUCTURES[s.key].footprint;
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) used.add(`${s.x + dx},${s.y + dy}`);
  }
  return tiles().filter(([x, y]) => !used.has(`${x},${y}`)).length;
}

/** 지을 자리가 부족할 때 쓸 바깥쪽 영토 칸들 (먼 곳부터) */
function frontierTiles(limit = 40) {
  const cap = capital();
  return tiles().sort((a, b) =>
    Math.hypot(b[0] - cap.x, b[1] - cap.y) - Math.hypot(a[0] - cap.x, a[1] - cap.y)).slice(0, limit);
}

/**
 * 창고가 꽉 차 물류가 멈추지 않도록 여유분을 판다.
 * 수도 업그레이드에 쓰이는 자원은 필요량의 2배까지는 남겨둔다.
 */
function sellSurplus() {
  const cap = capital();
  const upCost = getUpgradeCost('capital', cap.level) || {};
  // 다음 수도 업그레이드에 쓸 것만 넉넉히 남기고, 나머지는 최소한만 남긴다.
  // (창고 하나에 한 종류만 들어가므로 이것저것 쌓아두면 금세 자리가 없어진다)
  const keepFor = (res) => (upCost[res] ? upCost[res] * 1.6 : 220);
  for (const res of Object.keys(RESOURCES)) {
    if (['gold', 'electricity', 'labor'].includes(res)) continue;
    const over = stock(res) - keepFor(res);
    if (over > 0) L.sellFromStorage(n, res, Math.floor(over));
  }
}

/** 창고에 빈 자리가 거의 없는가 */
function storageTight() {
  let free = 0;
  for (const s of n.structures) {
    const cap2 = STRUCTURES[s.key].storageCapacity;
    if (!cap2) continue;
    const used = Object.values(s.store || {}).reduce((a, b) => a + b, 0);
    free += cap2 * s.level - used;
  }
  return free < 1500;
}

/** 기초 자원이 넉넉할 때만 부수적인 업그레이드에 쓴다 (수도 업그레이드를 굶기지 않도록) */
const stockRich = () => stock('wood') > 900 && stock('stone') > 900;

function pickKitchenRecipe(s) {
  const opts = Object.keys(STRUCTURES.kitchen.recipes)
    .filter(k => L.hasGood(n, `dish:${k}`))
    .filter(k => Object.entries(STRUCTURES.kitchen.recipes[k].in)
      .every(([res]) => stock(res) > 0 || (s.inputBuffer || {})[res] > 0));
  if (!opts.length) return;
  const want = opts.sort((a, b) => stock(a) - stock(b))[0];
  if (s.recipe !== want) L.setRecipe(n, s.id, want);
}

// ---------------- 진단 덤프 (--debug) ----------------
function debugDump() {
  console.log('\n▶ 진단');
  const bykey = {};
  for (const s of n.structures) bykey[s.key] = (bykey[s.key] || 0) + 1;
  console.log('  구조물:', Object.entries(bykey).map(([k, v]) => `${k}×${v}`).join(', '));
  console.log('  재고:', Object.keys(RESOURCES).map(r => [r, stock(r)]).filter(([, v]) => v > 0)
    .map(([r, v]) => `${r}:${v}`).join(', '));
  for (const s of n.structures.filter(x => STRUCTURES[x.key].recipes)) {
    console.log(`  ${s.key}#${s.id} recipe=${s.recipe} in=${JSON.stringify(s.inputBuffer)} out=${JSON.stringify(s.outputBuffer)} idle=${s.idleReason}`);
  }
  const nodes = {};
  for (const [x, y] of tiles()) { const t = getTile(x, y); if (t.node) nodes[t.node.yields] = (nodes[t.node.yields] || 0) + 1; }
  console.log('  영토 내 노드:', Object.entries(nodes).map(([k, v]) => `${k}×${v}`).join(', ') || '(없음)');
  const occupied = {};
  for (const s of n.structures) { const t = getTile(s.x, s.y); if (t.node) occupied[t.node.yields] = (occupied[t.node.yields] || 0) + 1; }
  console.log('  노드 위 구조물:', Object.entries(occupied).map(([k, v]) => `${k}×${v}`).join(', ') || '(없음)');
}

// ---------------- 실행 ----------------
const finished = play();
if (process.argv.includes('--debug')) debugDump();

console.log(`\n▶ ${tick}틱 진행 후 종료`);
console.log(`  수도 레벨      : ${capital().level} / ${STRUCTURES.capital.maxLevel}`);
console.log(`  연구 완료      : ${n.unlocked.size - 8} / ${Object.keys(TECH_TREE).length}`);
console.log(`  구조물         : ${n.structures.length}개`);
console.log(`  여행 해금 상품 : ${n.unlockedGoods.size}개`);

if (capital().level < STRUCTURES.capital.maxLevel) {
  const cost = getUpgradeCost('capital', capital().level);
  const missing = Object.entries(cost || {})
    .filter(([r, a]) => stock(r) < a)
    .map(([r, a]) => `${RESOURCES[r]?.name || r} ${stock(r)}/${a}`);
  problem(`수도 Lv.${capital().level}에서 멈춤 — 부족: ${missing.join(', ') || '(없음)'}`);
}
for (const key of Object.keys(TECH_TREE)) {
  if (!n.unlocked.has(key)) problem(`연구 미완료: ${STRUCTURES[key].name} (수도 Lv.${TECH_TREE[key].capitalLevel} 필요)`);
}

// ---------------- 추가 점검 ----------------
console.log('\n▶ 세부 점검');

// (1) 모든 자원을 실제로 한 번이라도 손에 넣었는가
const never = Object.keys(RESOURCES).filter(r => {
  if (['electricity', 'gold', 'labor'].includes(r)) return false;
  return !everSeen.has(r);
});
if (never.length) note(`한 번도 생산하지 못한 자원: ${never.map(r => RESOURCES[r].name).join(', ')}`);
console.log(`  생산 경험한 자원 : ${everSeen.size} / ${Object.keys(RESOURCES).length - 3}`);

// (2) 오래 멈춰 있던 구조물
const stuck = [...seenIdle.entries()].filter(([, v]) => v.count > tick * 0.6);
console.log(`  정지 사유 종류   : ${seenIdle.size}`);
for (const [k, v] of [...seenIdle.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8)) {
  console.log(`    ${k} — ${v.count}틱 (t${v.first}부터)`);
}
for (const [k, v] of stuck) problem(`거의 내내 멈춰 있던 구조물: ${k} (${v.count}/${tick}틱)`);

// (3) 병력 모집 + 전투가 실제로 되는지
console.log('\n▶ 전투 점검');
runBattleCheck();

/**
 * 병력 모집 → 장비 투입 → 실제 습격 전투까지 한 바퀴 돌려본다.
 * (전투는 공격자 클라이언트가 로컬로 시뮬레이션하므로 여기서 그대로 재현된다)
 */
function runBattleCheck() {
  const out = structsOf('outpost')[0];
  if (!out) { problem('전초기지를 끝내 짓지 못했습니다 (병력을 모집할 수 없음)'); return; }

  n.resources.gold = Math.max(n.resources.gold || 0, 20000);
  const recruited = [];
  for (const [key, unit] of Object.entries(UNITS.attack)) {
    const r = L.recruitUnit(n, out.id, key, false);
    if (!r.ok) { problem(`모집 실패 ${unit.name}: ${r.error}`); continue; }
    recruited.push(key);
  }
  // 장비를 투입 버퍼에 채워 무장까지 끝낸다
  for (let i = 0; i < 400 && (out.recruitQueue || []).length; i++) {
    for (const job of out.recruitQueue) {
      for (const [res, amt] of Object.entries(job.need)) {
        out.inputBuffer[res] = (out.inputBuffer[res] || 0) + amt;
      }
    }
    n.tick();
  }
  const roster = n.units.attack || {};
  const armed = Object.keys(roster).filter(k => roster[k] > 0);
  console.log(`  모집 신청 ${recruited.length}종 → 무장 완료 ${armed.length}종`);
  const notArmed = recruited.filter(k => !(roster[k] > 0));
  if (notArmed.length) {
    problem(`장비를 다 넣었는데도 무장되지 않은 병종: ${notArmed.map(k => UNITS.attack[k].name).join(', ')}`);
  }
  if (!armed.length) return;

  // 상대 기지(자기 자신의 스냅샷)를 상대로 실제 전투를 돌린다
  const defender = JSON.parse(JSON.stringify(n.toJSON()));
  defender.id = 'enemy';
  const deck = {};
  for (const k of armed) deck[k] = Math.min(roster[k], 5);
  const session = createBattleSession(defender, deck, n);
  let placed = 0;
  for (const k of Object.keys(deck)) {
    for (let i = 0; i < deck[k]; i++) {
      // 적 영토 밖(가장자리)에 소환한다
      const r = deployUnit(session, k, defender.capital.x - 14 - i, defender.capital.y - 14);
      if (r.ok) placed++;
    }
  }
  let steps = 0;
  while (!session.ended && steps++ < 4000) stepBattle(session, 0.05);
  endBattle(session);   // 제한 시간까지 갔으면 여기서 결과를 확정한다
  const result = session.result;
  // destructionPercent는 0~1 비율이다 (화면 표시는 ×100)
  const killed = session.structures.filter(s => !s.alive).length;
  console.log(`  전투: 유닛 ${placed}기 소환 · ${steps}스텝 · 파괴 ${killed}/${session.structures.length}동`
    + ` · 파괴율 ${Math.round(result.destructionPercent * 100)}% · ${result.win ? '승리' : '패배'}`);
  console.log(`  약탈 목록: ${Object.entries(result.loot).slice(0, 6).map(([r, a]) => `${RESOURCES[r]?.name || r} ${a}`).join(', ') || '(없음)'}`);
  if (placed === 0) problem('전투에서 유닛을 한 기도 소환하지 못했습니다');
  if (result.destructionPercent === 0) problem('공격 유닛이 적 구조물을 전혀 파괴하지 못했습니다');
  if (result.win && !Object.keys(result.loot).length) problem('승리했는데 약탈물이 하나도 없습니다');

  console.log(`  결과 반영: ${applyRaidResultLocal(defender, result)}`);
}

/** 서버가 하는 것과 같은 방식으로 습격 결과를 방어자·공격자에게 반영해 본다 */
function applyRaidResultLocal(defenderJson, result) {
  try {
    const { Nation } = gameMod;
    const def = Nation.fromJSON(defenderJson);
    // 골드·전력·인력은 창고가 아니라 수치로 관리되므로 읽는 곳이 다르다
    const held = (nation, res) =>
      VIRTUAL_RESOURCES.has(res) ? (nation.resources[res] || 0) : L.totalStock(nation, res);
    // 실물 자원 하나와 비물질 자원 하나를 각각 확인한다
    const physical = Object.keys(result.loot).find(r => !VIRTUAL_RESOURCES.has(r));
    const virt = Object.keys(result.loot).find(r => VIRTUAL_RESOURCES.has(r));
    const snap = {};
    for (const r of [physical, virt].filter(Boolean)) snap[r] = [held(def, r), held(n, r)];

    const out = L.applyRaidResult(n, def, result);   // (공격자, 방어자, 결과)
    if (!out) { problem('applyRaidResult가 아무 결과도 돌려주지 않았습니다'); return '실패'; }

    const parts = [];
    for (const [r, [bd, ba]] of Object.entries(snap)) {
      const ad = held(def, r), aa = held(n, r);
      if (ad >= bd) problem(`약탈했는데 방어자 ${RESOURCES[r]?.name} 재고가 줄지 않았습니다 (${bd}→${ad})`);
      if (aa <= ba) problem(`약탈했는데 공격자 ${RESOURCES[r]?.name} 재고가 늘지 않았습니다 (${ba}→${aa})`);
      parts.push(`${RESOURCES[r]?.name} 방어자 ${bd}→${ad} / 공격자 ${ba}→${aa}`);
    }
    if (!physical) problem('약탈 목록에 실물 자원이 하나도 없습니다 (골드 등 수치 자원만 약탈됨)');
    // 방어자에게 새 보호막이 걸렸는지 (연쇄 공격 방지)
    if (!(def.shieldUntil > Date.now())) problem('공격당한 쪽에 보호막이 걸리지 않았습니다');
    if (n.shieldUntil !== 0) problem('공격한 쪽의 보호막이 해제되지 않았습니다');
    return parts.join(' · ') + ` · 트로피 ${out.attackerTrophyDelta >= 0 ? '+' : ''}${out.attackerTrophyDelta}`;
  } catch (e) {
    problem(`전투 결과 반영 중 오류: ${e.message}`);
    return '오류: ' + e.message;
  }
}

// (1-2) 업적 — 한 판을 끝까지 갔을 때 실제로 몇 개나 달성되는지.
// 달성 불가능한 목표(오타나 지나치게 높은 수치)를 여기서 잡는다.
{
  const A = await import('../js/achievements.js');
  A.checkAchievements(n);
  const score = A.achievementScore(n);
  console.log(`  업적            : ${score.done} / ${score.total}`);
  const missing = A.ACHIEVEMENTS.filter(a => !n.achievements.includes(a.key));
  if (missing.length) {
    console.log('    미달성:');
    for (const a of missing) {
      const p2 = A.achievementProgress(n, a);
      console.log(`      · ${a.name} (${p2.value}/${p2.goal}) — ${a.desc}`);
    }
  }
}

// ---------------- 결과 ----------------
console.log('\n' + '='.repeat(56));
if (!problems.length && finished) {
  console.log('✅ 최종 테크까지 이상 없이 플레이 완료');
} else {
  console.log(`⚠️ 발견된 문제 ${problems.length}건`);
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  process.exitCode = 1;
}

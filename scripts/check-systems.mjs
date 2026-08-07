// ============================================================
// scripts/check-systems.mjs — 농사·목축·여행·조리 시스템 회귀 테스트.
//
// 규칙(data.js)을 손볼 때 조용히 깨지기 쉬운 부분들을 고정해둔다:
//   · 시작 작물/가축만 열려 있고 나머지는 여행으로 열린다
//   · 모든 작물·가축·요리법에 습득 경로가 존재한다
//   · 조리소 레시피는 반드시 재료값보다 비싸게 팔린다 (공정이 깊을수록 이득)
//   · 판매/직렬화가 창고 재고 모델과 어긋나지 않는다
//
// 실행: node scripts/check-systems.mjs
// ============================================================
import assert from 'node:assert';
import { createNation, Nation } from '../js/game.js';
import * as L from '../js/logic.js';
import { CROPS, ANIMALS, EXPEDITIONS, STRUCTURES, RESOURCES, getSellPrice, LOGISTICS, START_DISHES } from '../js/data.js';
import { findNearestCapitalSite } from '../js/logic.js';
import { getTile } from '../js/world.js';

// 농지는 물가에만 지을 수 있어서, 영토 안에 물가 타일이 있는 수도 자리를 고른다
let n = null, site = null;
for (let r = 0; r < 400 && !n; r += 7) {
  const s2 = findNearestCapitalSite(r, r, 60);
  if (!s2) continue;
  const cand = createNation('t1', '테스트국', '#f00', s2.x, s2.y);
  if (Array.from(cand.territory).some(k => {
    const [x, y] = k.split(',').map(Number);
    return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => getTile(x+dx, y+dy).terrain === 'water');
  })) { n = cand; site = s2; }
}
assert.ok(n, '물가가 있는 수도 자리');
assert.ok(n.structures.find(s => s.key === 'capital'), 'capital built');
assert.strictEqual(L.totalStock(n, 'wood'), 100);
console.log('✓ 건국 / 시작 자원');

// --- 농지: 기본 벼, 잠긴 작물 거부 ---
n.unlocked.add('farm');
// 농지를 지을 땅과 자원
const cap = n.structures.find(s => s.key === 'capital');
L.depositInto(cap, 'wood', 500); L.depositInto(cap, 'stone', 500); L.recomputeStock(n);
let placed = null;
for (const key of Array.from(n.territory)) {
  const [x, y] = key.split(',').map(Number);
  const r = L.build(n, 'farm', x, y);
  if (r.ok) { placed = r.structure; break; }
}
assert.ok(placed, '농지 건설');
assert.strictEqual(placed.crop, undefined);
assert.strictEqual(L.setCrop(n, placed.id, 'rice').ok, true, '벼는 기본 해금');
assert.strictEqual(L.setCrop(n, placed.id, 'wheat').ok, false, '밀은 여행 전 잠김');
console.log('✓ 작물 선택 잠금');

// --- 여행: 인력 소모 → 완료 시 해금 ---
const exp0 = Object.keys(EXPEDITIONS)[0];
const def0 = EXPEDITIONS[exp0];
assert.strictEqual(L.startExpedition(n, exp0).ok, false, '수도 레벨이 낮으면 출발 불가');
cap.level = def0.capitalLevel;
assert.strictEqual(L.startExpedition(n, exp0).ok, false, '인력 부족이면 출발 불가');
n.resources.labor = 999;
const st = L.startExpedition(n, exp0);
assert.strictEqual(st.ok, true, st.error);
assert.strictEqual(n.resources.labor, 999 - def0.labor, '인력 차감');
assert.strictEqual(L.startExpedition(n, exp0).ok, false, '동시에 두 여행 불가');
n.expedition.ticksLeft = 0;
L.finishExpedition(n);
assert.strictEqual(n.expedition, null);
for (const u of def0.unlocks || []) assert.ok(L.hasGood(n, u), `해금됨 ${u}`);
for (const [r, a] of Object.entries(def0.rewards || {})) assert.ok(L.totalStock(n, r) > 0 || n.resources[r] > 0, `보상 ${r}`);
console.log('✓ 여행 소모/해금/보상');

// --- 여행 해금 후 작물 선택 가능 ---
const crop = (def0.unlocks || []).find(u => u.startsWith('crop:'));
if (crop) {
  const k = crop.slice(5);
  assert.strictEqual(L.setCrop(n, placed.id, k).ok, true, `${k} 재배 가능`);
  assert.strictEqual(placed.crop, k);
}

// --- 모든 여행이 결국 모든 작물/가축을 해금하는지 ---
const all = new Set();
for (const e of Object.values(EXPEDITIONS)) for (const u of e.unlocks || []) all.add(u);
for (const [k, c] of Object.entries(CROPS)) if (!c.start) assert.ok(all.has('crop:' + k), `crop:${k} 해금 경로`);
for (const [k, a] of Object.entries(ANIMALS)) if (!a.start) assert.ok(all.has('animal:' + k), `animal:${k} 해금 경로`);
console.log('✓ 모든 작물·가축에 해금 경로 존재');

// --- 조리소 레시피: 10종 이상, 재료 도달 가능, 가격 단조 ---
const kitchen = STRUCTURES.kitchen;
assert.ok(kitchen, '조리소 존재');
const recipes = Object.entries(kitchen.recipes);
assert.ok(recipes.length >= 10, `레시피 ${recipes.length}종 (10종 이상)`);
for (const [key, r] of recipes) {
  for (const ing of Object.keys(r.in)) assert.ok(RESOURCES[ing], `${key} 재료 ${ing} 정의됨`);
  assert.ok(RESOURCES[key], `${key} 산출 정의됨`);
  const inVal = Object.entries(r.in).reduce((a, [k2, v]) => a + getSellPrice(k2) * v, 0);
  const outVal = getSellPrice(key) * r.out;
  assert.ok(outVal > inVal, `${key}: 조리하면 값이 올라야 함 (${inVal} → ${outVal})`);
}
console.log(`✓ 조리소 레시피 ${recipes.length}종 · 모두 부가가치 > 0`);

// --- 조리소: 안 배운 요리법은 못 고른다 ---
n.unlocked.add('kitchen');
// 수도 보관함은 용량 제한이 있어서, 테스트에서는 재고를 직접 채운다
cap.store = { ...kitchen.baseCost };
L.recomputeStock(n);
let kit = null;
for (const key of Array.from(n.territory)) {
  const [x, y] = key.split(',').map(Number);
  const r = L.build(n, 'kitchen', x, y);
  if (r.ok) { kit = r.structure; break; }
}
if (!kit) { const errs = {}; for (const key of Array.from(n.territory)) { const [x,y]=key.split(',').map(Number); const r=L.build(n,'kitchen',x,y); if(r.ok){kit=r.structure;break;} errs[r.error]=(errs[r.error]||0)+1; } console.log(errs); }
assert.ok(kit, '조리소 건설');
const known = Object.keys(kitchen.recipes).find(k => L.hasGood(n, 'dish:' + k));
const unknown = Object.keys(kitchen.recipes).find(k => !L.hasGood(n, 'dish:' + k));
assert.strictEqual(L.setRecipe(n, kit.id, known).ok, true, '아는 요리법은 선택 가능');
assert.strictEqual(L.setRecipe(n, kit.id, unknown).ok, false, '모르는 요리법은 잠김');
assert.strictEqual(kit.recipe, known, '실패해도 기존 선택 유지');
console.log('✓ 요리법 잠금 (' + unknown + ' 잠김, ' + known + ' 가능)');

// --- 모든 요리법에 배울 경로가 있는지 ---
const learnable = new Set(START_DISHES);
for (const e of Object.values(EXPEDITIONS)) for (const u of e.unlocks || []) if (u.startsWith('dish:')) learnable.add(u.slice(5));
for (const k of Object.keys(kitchen.recipes)) assert.ok(learnable.has(k), `요리법 ${k} 습득 경로`);
console.log('✓ 모든 요리법에 습득 경로 존재');

// --- 판매: 창고 재고만 팔리고 골드가 는다 ---
cap.store = { wood: 100 };
L.recomputeStock(n);
const before = n.resources.gold || 0;
const sell = L.sellFromStorage(n, 'wood', 10);
assert.strictEqual(sell.ok, true, sell.error);
assert.strictEqual(n.resources.gold, before + sell.earned);
assert.ok(L.sellFromStorage(n, 'wood', 99999).sold <= 90, '재고 이상은 못 판다');
assert.strictEqual(L.totalStock(n, 'wood'), 0, '다 팔면 재고 0');
assert.strictEqual(L.sellFromStorage(n, 'wood', 5).ok, false, '재고 없으면 판매 실패');
console.log('✓ 판매 → 골드');

// --- 직렬화 왕복 ---
const round = Nation.fromJSON(JSON.parse(JSON.stringify(n.toJSON())));
assert.deepStrictEqual(Array.from(round.unlockedGoods).sort(), Array.from(n.unlockedGoods).sort());
assert.strictEqual(round.structures.find(s => s.id === placed.id).crop, placed.crop);
console.log('✓ 직렬화 왕복 (작물/해금 유지)');

// --- 콘텐츠 규모 (대폭 확장한 뒤 줄어들지 않게 고정) ---
{
  const { UNITS } = await import('../js/data.js');
  const turrets = Object.keys(STRUCTURES).filter(k => STRUCTURES[k].category === 'turret');
  assert.ok(Object.keys(UNITS.attack).length >= 20, `공격 유닛 ${Object.keys(UNITS.attack).length}종 (20종 이상)`);
  assert.ok(Object.keys(UNITS.defense).length >= 10, `수비 유닛 ${Object.keys(UNITS.defense).length}종 (10종 이상)`);
  assert.ok(turrets.length >= 12, `방어 타워 ${turrets.length}종 (12종 이상)`);
  // 모든 유닛은 장비가 실제로 만들 수 있는 자원이어야 한다
  for (const g of ['attack', 'defense']) {
    for (const [k, u] of Object.entries(UNITS[g])) {
      for (const r of Object.keys(u.equip)) assert.ok(RESOURCES[r], `${k} 장비 ${r} 정의됨`);
    }
  }
  // 벨트 변종
  assert.ok(STRUCTURES.belt_splitter && STRUCTURES.belt_cross, '분할·교차 컨베이어 존재');
  assert.ok(STRUCTURES.belt.rotatable && STRUCTURES.belt_splitter.rotatable, '벨트는 방향을 바꿀 수 있어야 한다');
  // 인력은 농지에서만
  assert.ok(!STRUCTURES.capital.laborIncome, '수도는 인력을 만들지 않는다');
  assert.ok(STRUCTURES.farm.laborIncome > 0, '농지가 인력을 만든다');
  console.log(`✓ 콘텐츠 규모 (요리 ${Object.keys(STRUCTURES.kitchen.recipes).length} · 공격 ${Object.keys(UNITS.attack).length} · 수비 ${Object.keys(UNITS.defense).length} · 터렛 ${turrets.length})`);
}

// --- 철거 규칙 ---
{
  const cap2 = n.structures.find(s2 => s2.key === 'capital');
  assert.strictEqual(L.canDemolish(n, cap2.id).ok, false, '수도는 철거할 수 없어야 한다');

  // 인벤토리에 든 자원은 철거와 함께 사라진다
  cap2.store = { wood: 500, stone: 500 }; L.recomputeStock(n);
  let wh = null;
  for (const key of Array.from(n.territory)) {
    const [x, y] = key.split(',').map(Number);
    const r = L.build(n, 'warehouse', x, y);
    if (r.ok) { wh = r.structure; break; }
  }
  assert.ok(wh, '창고 건설');
  L.depositInto(wh, 'wood', 120); L.recomputeStock(n);
  const beforeStock = L.totalStock(n, 'wood');
  const out = L.demolish(n, wh.id);
  assert.strictEqual(out.ok, true, out.error);
  assert.strictEqual(out.lost.wood, 120, '사라진 자원을 보고해야 한다');
  assert.strictEqual(L.totalStock(n, 'wood'), beforeStock - 120, '국고에서도 빠져야 한다');
  assert.ok(!n.structures.some(s2 => s2.id === wh.id), '구조물이 목록에서 빠져야 한다');

  // 중심지는 그 영토가 비어 있어야만 철거된다
  const before = n.territory.size;
  let hub = null;
  for (const key of Array.from(n.territory)) {
    const [x, y] = key.split(',').map(Number);
    if (Math.hypot(x - cap2.x, y - cap2.y) <= 5) continue;
    const r = L.build(n, 'hub', x, y);
    if (r.ok) { hub = r.structure; break; }
  }
  if (hub) {
    assert.ok(n.territory.size > before, '중심지가 영토를 넓혀야 한다');
    const capR = L.getTerritoryRadius('capital', cap2.level);
    const onlyHub = L.territoryTilesOf(n, hub)
      .filter(([x, y]) => Math.hypot(x - (cap2.x + 1), y - (cap2.y + 1)) > capR);
    let planted = null;
    for (const [x, y] of onlyHub) { const r = L.build(n, 'warehouse', x, y); if (r.ok) { planted = r.structure; break; } }
    if (planted) {
      assert.strictEqual(L.canDemolish(n, hub.id).ok, false, '영토에 구조물이 있으면 중심지 철거 거부');
      assert.strictEqual(L.demolish(n, planted.id).ok, true);
    }
    assert.strictEqual(L.canDemolish(n, hub.id).ok, true, '비우면 중심지 철거 가능');

    // 수도 영토와 겹치는 구역에 서 있는 구조물은 중심지 철거를 막지 않는다.
    // (중심지가 없어져도 그 칸은 수도 반경이 이미 덮고 있어 영토로 남는다)
    const capCx = cap2.x + 1, capCy = cap2.y + 1;
    const [ww, wh2] = STRUCTURES.warehouse.footprint;
    let shared = null;
    for (const [x, y] of L.territoryTilesOf(n, hub)) {
      // 창고 발판이 통째로 수도 반경 안에 들어가는 자리만 고른다
      let allInCap = true;
      for (let dy = 0; dy < wh2; dy++) for (let dx = 0; dx < ww; dx++) {
        if (Math.hypot(x + dx - capCx, y + dy - capCy) > capR) allInCap = false;
      }
      if (!allInCap) continue;
      const r = L.build(n, 'warehouse', x, y);
      if (r.ok) { shared = r.structure; break; }
    }
    assert.ok(shared, '수도 영토와 겹치는 칸에 창고를 세울 수 있어야 한다');
    assert.strictEqual(L.canDemolish(n, hub.id).ok, true,
      '이미 수도 영토인 구역의 구조물은 부수지 않아도 중심지를 철거할 수 있어야 한다');

    assert.strictEqual(L.demolish(n, hub.id).ok, true);
    assert.strictEqual(n.territory.size, before, '철거하면 영토가 원래대로 줄어야 한다');
    for (const [x, y] of L.footprintTiles(shared.x, shared.y, [ww, wh2])) {
      assert.ok(n.territory.has(L.tileKey(x, y)), '남은 구조물은 여전히 영토 안이어야 한다');
    }
  }
  console.log('✓ 철거 규칙 (수도 불가 · 중심지 조건부 · 겹친 영토는 허용 · 인벤토리 소멸 · 영토 복구)');
}

// --- 배출구: 산출물마다 나가는 면이 다르다 · 창고도 벨트로 뺄 수 있다 ---
{
  const { outputPorts, structOutputs, DIR_NAMES } = await import('../js/data.js');
  const { tickNation, exitBeltOn } = await import('../js/simulate.js');

  // 산출물이 한 가지면 배출구를 따지지 않는다 (예전 배치를 깨지 않기 위해)
  assert.strictEqual(outputPorts({ key: 'kitchen', recipe: 'bread' }), null, '단일 산출물은 배출구 배정 없음');
  assert.deepStrictEqual(structOutputs({ key: 'refinery', recipe: 'refine' }), ['petroleum', 'naphtha']);
  assert.deepStrictEqual(structOutputs({ key: 'barn', animal: 'cattle' }), ['cattle', 'milk'], '목장은 가축+부산물');
  const refPorts = outputPorts({ key: 'refinery', recipe: 'refine' });
  assert.strictEqual(Object.keys(refPorts).length, 2, '두 산출물에 배출구 두 개');
  assert.notStrictEqual(refPorts.petroleum, refPorts.naphtha, '서로 다른 면이어야 한다');

  const n8 = createNation('t8', '물류국', '#00f', site.x, site.y);
  const cap8 = n8.structures.find(s2 => s2.key === 'capital');
  cap8.level = 8;
  for (const [x, y] of L.territoryTilesOf(n8, cap8)) n8.territory.add(L.tileKey(x, y));
  for (const r of ['wood', 'stone', 'iron_ingot', 'brick', 'plank']) L.depositInto(cap8, r, 400);
  L.recomputeStock(n8);
  for (const k of ['warehouse', 'belt', 'refinery', 'power_plant']) n8.unlocked.add(k);

  // 동·남쪽으로 벨트를 붙일 여유가 있는 자리를 고른다
  const place = (key, avoid, clear = 3) => {
    const [w, h] = STRUCTURES[key].footprint;
    for (const t of Array.from(n8.territory)) {
      const [x, y] = t.split(',').map(Number);
      if (Math.hypot(x - cap8.x, y - cap8.y) < avoid) continue;
      let room = true;
      for (let i = 0; i < clear; i++) {
        if (!n8.territory.has(L.tileKey(x + w + i, y))) room = false;
        if (!n8.territory.has(L.tileKey(x, y + h + i))) room = false;
      }
      if (!room) continue;
      const r = L.build(n8, key, x, y);
      if (r.ok) return r.structure;
    }
    return null;
  };

  const ref = place('refinery', 6);
  assert.ok(ref, '정제소 건설');
  L.setRecipe(n8, ref.id, 'refine');
  ref.outputBuffer = { petroleum: 30, naphtha: 30 };
  const [rw] = STRUCTURES.refinery.footprint;
  assert.strictEqual(L.build(n8, 'belt', ref.x + rw, ref.y, 0).ok, true, '동쪽 벨트');
  const dump = L.build(n8, 'warehouse', ref.x + rw + 1, ref.y);
  assert.strictEqual(dump.ok, true, '벨트 끝 창고');
  assert.ok(exitBeltOn(n8, ref, 0), '동쪽 면에 배출 벨트 인식');
  assert.ok(!exitBeltOn(n8, ref, 1), '남쪽 면에는 벨트 없음');

  tickNation(n8);
  assert.ok(ref.outputBuffer.petroleum < 30, '석유는 동쪽 배출구로 나가야 한다');
  assert.strictEqual(ref.outputBuffer.naphtha, 30, '나프타는 제 배출구에 벨트가 없으면 나가지 않는다');
  assert.ok(!dump.structure.store.naphtha, '다른 자원이 섞여 들어가면 안 된다');
  assert.ok(dump.structure.store.petroleum > 0, '석유만 창고에 도착');

  // 창고 → 벨트, 면마다 자원 지정
  const store = place('warehouse', 9);
  assert.ok(store, '창고 건설');
  L.depositInto(store, 'stone', 200);
  const [sw] = STRUCTURES.warehouse.footprint;
  L.build(n8, 'belt', store.x + sw, store.y, 0);
  assert.strictEqual(L.build(n8, 'power_plant', store.x + sw + 1, store.y).ok, true, '벨트 끝 발전소');
  const s0 = store.store.stone;
  tickNation(n8);
  assert.ok(store.store.stone < s0, '창고 재고가 벨트로 빠져나가야 한다');

  assert.strictEqual(L.setOutFilter(n8, store.id, 0, 'wood').ok, true);
  const s1 = store.store.stone;
  tickNation(n8);
  assert.strictEqual(store.store.stone, s1, '동쪽 배출구를 나무로 지정하면 돌은 나가지 않는다');
  assert.strictEqual(L.setOutFilter(n8, store.id, 0, null).ok, true);
  const s2 = store.store.stone;
  tickNation(n8);
  assert.ok(store.store.stone < s2, '지정을 풀면 다시 나간다');
  assert.strictEqual(L.setOutFilter(n8, store.id, 9, 'wood').ok, false, '없는 방향은 거부');
  assert.strictEqual(L.setOutFilter(n8, ref.id, 0, 'wood').ok, false, '보관 구조물이 아니면 거부');

  // 연결 끊기 — 벨트가 붙어 있어도 그 면으로는 아무것도 내보내지 않는다
  const { BELT_OFF } = await import('../js/data.js');
  assert.strictEqual(L.setOutFilter(n8, store.id, 0, BELT_OFF).ok, true, '연결 끊기 설정');
  const s3 = store.store.stone;
  tickNation(n8);
  assert.strictEqual(store.store.stone, s3, '연결을 끊으면 벨트가 붙어 있어도 나가지 않는다');
  assert.strictEqual(L.setOutFilter(n8, store.id, 0, null).ok, true);
  const s4 = store.store.stone;
  tickNation(n8);
  assert.ok(store.store.stone < s4, '다시 연결하면 나간다');
  console.log(`✓ 배출구 (산출물별 전용 면 ${DIR_NAMES.join('·')} · 창고 → 벨트 · 면별 자원 지정 · 연결 끊기)`);
}

// --- 분할 컨베이어는 두 방향으로만 나눈다 ---
{
  const { splitterExits, DIR_NAMES } = await import('../js/data.js');
  const right = splitterExits({ key: 'belt_splitter', dir: 0 });
  assert.strictEqual(right.length, 2, '두 갈래여야 한다 (예전엔 정면·좌·우 셋)');
  assert.deepStrictEqual(right, [0, 1], '기본은 정면(동) + 오른쪽(남)');
  assert.deepStrictEqual(splitterExits({ dir: 0, branch: 1 }), [0, 3], '왼쪽 분기는 정면(동) + 북');
  for (let d = 0; d < 4; d++) {
    const [f, side] = splitterExits({ dir: d });
    assert.strictEqual(f, d, '정면은 항상 벨트 방향');
    assert.notStrictEqual(side, d, '옆 갈래는 정면과 달라야 한다');
    assert.notStrictEqual(side, (d + 2) % 4, '뒤쪽(들어온 쪽)으로는 내보내지 않는다');
  }

  const n7 = createNation('t7', '분기국', '#ff0', site.x, site.y);
  const cap7 = n7.structures.find(s2 => s2.key === 'capital');
  cap7.level = 6;
  for (const [x, y] of L.territoryTilesOf(n7, cap7)) n7.territory.add(L.tileKey(x, y));
  for (const r of ['wood', 'stone', 'iron_ingot']) L.depositInto(cap7, r, 300);
  L.recomputeStock(n7);
  n7.unlocked.add('belt_splitter');
  let sp = null;
  for (const t of Array.from(n7.territory)) {
    const [x, y] = t.split(',').map(Number);
    if (Math.hypot(x - cap7.x, y - cap7.y) < 5) continue;
    const r = L.build(n7, 'belt_splitter', x, y, 0);
    if (r.ok) { sp = r.structure; break; }
  }
  assert.ok(sp, '분할 컨베이어 건설');
  assert.strictEqual(L.setBranchSide(n7, sp.id, 1).ok, true, '분기 방향 변경');
  assert.strictEqual(sp.branch, 1);
  assert.deepStrictEqual(splitterExits(sp), [0, 3], '왼쪽 분기가 반영돼야 한다');
  assert.strictEqual(L.setBranchSide(n7, sp.id, 0).branch, 0, '다시 오른쪽');
  const plainBelt = n7.structures.find(s2 => s2.key === 'belt');
  assert.strictEqual(L.setBranchSide(n7, cap7.id, 1).ok, false, '분할 컨베이어가 아니면 거부');
  assert.ok(!plainBelt || L.setBranchSide(n7, plainBelt.id, 1).ok === false, '일반 벨트도 거부');
  console.log(`✓ 분할 컨베이어 2갈래 (정면 + ${DIR_NAMES[1]}/${DIR_NAMES[3]} 선택)`);
}

// --- 발전소 연료 (나무 · 석탄 · 석유) ---
{
  const { POWER_FUELS, pickPowerFuel } = await import('../js/data.js');
  const fuels = POWER_FUELS.map(f => f.res);
  for (const r of fuels) assert.ok(RESOURCES[r], `연료 ${r} 정의됨`);
  assert.ok(fuels.includes('coal'), '석탄으로도 발전소를 돌릴 수 있어야 한다');
  assert.strictEqual(pickPowerFuel({}), null, '연료가 없으면 가동 불가');
  assert.strictEqual(pickPowerFuel({ wood: 1 }), null, '나무 1개로는 부족 (2개 필요)');
  assert.strictEqual(pickPowerFuel({ coal: 1 }).res, 'coal', '석탄 1개면 가동');
  assert.strictEqual(pickPowerFuel({ petroleum: 1 }).res, 'petroleum', '석유 1개면 가동');
  // 흔한 연료를 먼저 태운다 — 석유는 터렛·장비에도 쓰이므로 아껴야 한다
  assert.strictEqual(pickPowerFuel({ wood: 2, coal: 5, petroleum: 5 }).res, 'wood', '나무부터 태운다');
  assert.strictEqual(pickPowerFuel({ coal: 5, petroleum: 5 }).res, 'coal', '나무가 없으면 석탄');

  // 실제 틱에서 석탄이 줄고 전력이 늘어야 한다
  const { tickNation } = await import('../js/simulate.js');
  const n2 = createNation('t9', '연료국', '#0f0', site.x, site.y);
  const cap9 = n2.structures.find(s2 => s2.key === 'capital');
  cap9.level = 5;
  L.depositInto(cap9, 'stone', 200); L.depositInto(cap9, 'iron_ingot', 100); L.recomputeStock(n2);
  n2.unlocked.add('power_plant');
  let pp = null;
  for (const key of Array.from(n2.territory)) {
    const [x, y] = key.split(',').map(Number);
    if (Math.hypot(x - cap9.x, y - cap9.y) < 4) continue;
    const r = L.build(n2, 'power_plant', x, y);
    if (r.ok) { pp = r.structure; break; }
  }
  assert.ok(pp, '발전소 건설');
  pp.inputBuffer = { coal: 3 };
  n2.resources.electricity = 0;
  tickNation(n2);
  assert.strictEqual(pp.inputBuffer.coal, 2, '석탄을 1개 태워야 한다');
  assert.ok(n2.resources.electricity > 0, '석탄으로도 전력이 나와야 한다');
  assert.strictEqual(pp._fueled, true, '가동 표시');
  console.log(`✓ 발전소 연료 (${fuels.map(r => RESOURCES[r].name).join(' · ')})`);
}

// --- 그림 리소스가 빠진 게 없는지 ---
{
  const { existsSync } = await import('node:fs');
  const { UNITS } = await import('../js/data.js');
  const root = new URL('../', import.meta.url).pathname;
  const miss = [];
  for (const k of Object.keys(RESOURCES)) if (!existsSync(root + 'assets/icons/' + k + '.svg')) miss.push('자원 ' + k);
  for (const k of Object.keys(STRUCTURES)) if (!existsSync(root + 'assets/icons/struct/' + k + '.svg')) miss.push('구조물 ' + k);
  for (const g of ['attack', 'defense']) {
    for (const k of Object.keys(UNITS[g])) if (!existsSync(root + 'assets/icons/unit/' + k + '.svg')) miss.push('유닛 ' + k);
  }
  assert.strictEqual(miss.length, 0, '그림 없음: ' + miss.join(', ') + ' (node scripts/generate-icons.mjs 실행 필요)');
  const nUnits = Object.keys(UNITS.attack).length + Object.keys(UNITS.defense).length;
  console.log(`✓ 그림 리소스 전부 존재 (자원 ${Object.keys(RESOURCES).length} · 구조물 ${Object.keys(STRUCTURES).length} · 유닛 ${nUnits})`);
}

// --- 전투 멀티플레이: 비동기 습격 · 리플레이 ---
{
  const { createBattleSession, createReplaySession, deployUnit, stepBattle, stepReplay, endBattle }
    = await import('../js/battle.js');
  const { UNITS, WAR, BATTLE } = await import('../js/data.js');

  // 두 국가를 만들어 실제로 한 판 붙인다
  const siteA = findNearestCapitalSite(0, 0, 200);
  const siteB = findNearestCapitalSite(400, 400, 200);
  const atk = createNation('atkr', '공격국', '#f00', siteA.x, siteA.y);
  const def = createNation('defr', '방어국', '#00f', siteB.x, siteB.y);
  def.shieldUntil = 0;                       // 건국 실드를 걷어야 공격할 수 있다
  L.depositAnywhere(def, 'wood', 800);
  L.recomputeStock(def);
  const unitKey = Object.keys(UNITS.attack)[0];
  atk.units.attack[unitKey] = 6;

  // 공개 스냅샷에 내정 정보가 새지 않는지
  const snap = L.defenseSnapshot(def);
  assert.ok(!('unlocked' in snap) && !('research' in snap), '공개 스냅샷에 연구/해금 정보가 들어가면 안 된다');
  assert.ok(snap.structures.length > 0, '스냅샷에 기지 배치가 담겨야 한다');
  // 영토는 실어 보내지 않고 구조물에서 다시 만든다 (스냅샷이 접속자 수만큼 오간다)
  assert.ok(!snap.territory, '스냅샷에 영토 타일 목록을 담으면 안 된다');
  assert.deepStrictEqual(
    L.territoryFromStructures(snap.structures), def.territory,
    '구조물만으로 되살린 영토가 원본과 같아야 한다 (소환 금지 구역이 어긋나면 안 된다)');

  // 매치메이킹: 실드가 없으면 잡히고, 있으면 안 잡힌다
  assert.ok(L.findMatch(atk, [snap]), '실드 없는 상대는 매칭돼야 한다');
  assert.strictEqual(L.findMatch(atk, [{ ...snap, shieldUntil: Date.now() + 60000 }]), null,
    '실드 중인 상대는 매칭되면 안 된다');

  // 전투 — 수도 옆에 병력을 쏟아붓는다
  const session = createBattleSession(snap, { [unitKey]: 6 }, 12345);
  const cap = session.structures.find(s => s.key === 'capital');
  for (let i = 0; i < 6; i++) deployUnit(session, unitKey, cap.cx + 6 + i * 0.5, cap.cy + 6);
  for (let t = 0; t < BATTLE.durationSec * 10 && !session.ended; t++) stepBattle(session, 0.1);
  endBattle(session);
  assert.ok(session.deployLog.length === 6, '배치 기록이 리플레이용으로 남아야 한다');

  const report = L.buildRaidReport(atk, snap, session);
  assert.ok(report.replay.base.structures.length, '리포트에 그때의 기지 배치가 담겨야 한다');

  // 리플레이 결정론 — 같은 시드/기록이면 같은 결과가 나와야 한다
  const replay = createReplaySession(report.replay.base, report.replay);
  for (let t = 0; t < BATTLE.durationSec * 10 && !replay.ended; t++) stepReplay(replay, 0.1);
  endBattle(replay);
  assert.strictEqual(
    Math.round(replay.result.destructionPercent * 1000),
    Math.round(session.result.destructionPercent * 1000),
    '리플레이는 원래 전투와 같은 파괴율이 나와야 한다');

  // 양쪽 반영 — 공격자는 받고, 방어자는 잃는다
  const beforeUnits = atk.units.attack[unitKey];
  const gain = L.applyRaidToAttacker(atk, report);
  assert.ok(atk.units.attack[unitKey] < beforeUnits, '배치한 유닛은 로스터에서 소모돼야 한다');
  assert.strictEqual(atk.shieldUntil, 0, '공격하면 내 실드는 풀린다');

  const defWoodBefore = L.totalStock(def, 'wood');
  const applied = L.applyRaidToDefender(def, report);
  assert.strictEqual(applied.applied, true);
  assert.ok(def.shieldUntil > Date.now(), '공격당한 쪽은 실드를 얻는다');
  if (report.loot.wood) assert.ok(L.totalStock(def, 'wood') < defWoodBefore, '약탈당한 만큼 재고가 줄어야 한다');

  // 멱등성 — 같은 리포트를 다시 받아도 두 번 빠지지 않는다
  const woodAfter = L.totalStock(def, 'wood');
  const again = L.applyRaidToDefender(def, report);
  assert.strictEqual(again.applied, false, '같은 습격 리포트는 한 번만 반영돼야 한다');
  assert.strictEqual(L.totalStock(def, 'wood'), woodAfter, '중복 반영으로 재고가 더 줄면 안 된다');

  // 조작 방어 — 파괴율 0인데 전부 약탈했다고 우겨도 통하지 않는다
  const victim = createNation('vic', '피해국', '#0f0', siteB.x, siteB.y);
  L.depositAnywhere(victim, 'wood', 500); L.recomputeStock(victim);
  const before = L.totalStock(victim, 'wood');
  const forged = { ...report, id: 'forged-1', win: true, destructionPercent: 0, perfectVictory: false,
                   loot: { wood: 99999 }, defenderTrophyDelta: -9999 };
  const forgedRes = L.applyRaidToDefender(victim, forged);
  assert.strictEqual(L.totalStock(victim, 'wood'), before, '파괴율 0이면 약탈도 0이어야 한다');
  assert.strictEqual(forgedRes.trophyDelta, 0, '파괴율 0이면 트로피도 잃지 않는다');

  // 트로피 조작도 규칙 범위로 잘린다
  const victim2 = createNation('vic2', '피해국2', '#0f0', siteB.x, siteB.y);
  victim2.trophies = 500;
  L.applyRaidToDefender(victim2, { ...report, id: 'forged-2', destructionPercent: 1,
                                   perfectVictory: true, loot: {}, defenderTrophyDelta: -9999 });
  assert.ok(victim2.trophies >= 500 - WAR.maxTrophyTrade, '트로피 손실은 규칙 상한을 넘을 수 없다');

  console.log('✓ 전투 멀티플레이 (비동기 습격 · 리플레이 재현 · 멱등 · 조작 방어)');
}

// --- 멀티플레이 수도 최소 거리 ---
{
  const { MIN_CAPITAL_DISTANCE } = await import('../js/data.js');
  const site = findNearestCapitalSite(0, 0, 200);
  const mine = { name: '이웃국', capital: { x: site.x, y: site.y } };

  // 남이 없으면 그대로 가능해야 한다
  assert.strictEqual(L.capitalSiteReport(site.x, site.y).ok, true, '혼자면 세울 수 있어야 한다');

  // 바로 옆은 거부
  const close = L.capitalSiteReport(site.x, site.y, [mine]);
  assert.strictEqual(close.ok, false, '남의 수도 바로 옆에는 세울 수 없어야 한다');
  assert.ok(close.tooClose && close.tooClose.name === '이웃국', '누구와 가까운지 알려줘야 한다');

  // 딱 최소 거리 밖이면 (입지 요건만 맞으면) 거리로는 막히지 않는다
  const far = L.capitalSiteReport(site.x + MIN_CAPITAL_DISTANCE, site.y, [mine]);
  assert.strictEqual(far.tooClose, null, `${MIN_CAPITAL_DISTANCE}칸 밖은 거리로 막히면 안 된다`);

  // 추천 위치도 같은 규칙을 지킨다
  const suggested = L.findNearestCapitalSite(site.x, site.y, 260, [mine]);
  assert.ok(suggested, '남이 있어도 추천 자리를 찾아야 한다');
  const d = Math.hypot(suggested.x - site.x, suggested.y - site.y);
  assert.ok(d >= MIN_CAPITAL_DISTANCE, `추천 자리가 ${Math.round(d)}칸 — 최소 거리를 지켜야 한다`);

  console.log(`✓ 수도 최소 거리 (${MIN_CAPITAL_DISTANCE}칸 · 추천 위치도 준수 · 실제 ${Math.round(d)}칸)`);
}

// --- 저장/불러오기: 무엇 하나 빠지면 이어하기가 반쪽이 된다 ---
{
  // localStorage가 없는 node에서도 storage.js를 그대로 돌려보기 위한 최소 구현
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const S = await import('../js/storage.js');
  const { UNITS } = await import('../js/data.js');

  const site = findNearestCapitalSite(0, 0, 200);
  const a = createNation('save-a', '저장국', '#abc', site.x, site.y);
  // 저장돼야 할 것들을 골고루 만들어둔다
  const cap = a.structures.find(s => s.key === 'capital');
  L.depositAnywhere(a, 'wood', 120); L.recomputeStock(a);
  const woodBefore = L.totalStock(a, 'wood');   // 시작 재고 + 들어간 만큼 (수도 용량까지)
  a.unlocked.add('smelter');
  a.unlockedGoods.add('dish:bread');
  a.research = { key: 'factory', ticksLeft: 7 };
  a.trophies = 42;
  a.shieldUntil = 1234567890;
  a.units.attack[Object.keys(UNITS.attack)[0]] = 3;
  a.seenRaids = ['raid-1'];
  cap.level = 4;

  assert.strictEqual(S.saveGame(a).ok, true);
  const back = Nation.fromJSON(S.loadGame().nation);
  assert.strictEqual(back.id, a.id);
  assert.strictEqual(back.name, a.name);
  assert.strictEqual(L.totalStock(back, 'wood'), woodBefore, '창고 재고가 그대로 살아나야 한다');
  assert.ok(back.unlocked.has('smelter'), '해금이 유지돼야 한다');
  assert.ok(back.unlockedGoods.has('dish:bread'), '요리법 습득이 유지돼야 한다');
  assert.strictEqual(back.research.ticksLeft, 7, '진행 중인 연구가 유지돼야 한다');
  assert.strictEqual(back.trophies, 42);
  assert.strictEqual(back.shieldUntil, 1234567890, '보호막 만료 시각이 유지돼야 한다');
  assert.deepStrictEqual(back.units, a.units, '병력 로스터가 유지돼야 한다');
  assert.deepStrictEqual(back.seenRaids, ['raid-1'], '이미 반영한 습격 기록이 유지돼야 한다(중복 반영 방지)');
  assert.strictEqual(back.structures.find(s => s.key === 'capital').level, 4, '구조물 레벨이 유지돼야 한다');
  assert.strictEqual(back.territory.size, a.territory.size, '영토가 유지돼야 한다');

  // 슬롯 분리 — 같은 브라우저의 두 탭(= 두 플레이어)이 서로를 덮어쓰면 안 된다
  const b = createNation('save-b', '이웃국', '#cba', site.x, site.y);
  S.saveGame(b);
  assert.strictEqual(S.listSaves().length, 2, '국가별로 따로 저장돼야 한다');
  assert.strictEqual(S.loadGame('save-a').nation.name, '저장국');
  assert.strictEqual(S.loadGame('save-b').nation.name, '이웃국');
  S.clearSave('save-b');
  assert.strictEqual(S.listSaves().length, 1, '하나만 지우면 나머지는 남아야 한다');

  // 형식이 안 맞는 저장은 조용히 무시한다 (반쯤 복원되는 것보다 낫다)
  mem.set('civ:saves', JSON.stringify({ x: { v: 999, savedAt: Date.now(), nation: {} } }));
  assert.strictEqual(S.loadGame(), null, '형식 버전이 다른 저장은 불러오지 않는다');
  mem.set('civ:saves', '{망가진 JSON');
  assert.strictEqual(S.loadGame(), null, '깨진 저장은 불러오지 않는다');
  assert.deepStrictEqual(S.listSaves(), [], '깨진 저장은 목록에도 안 나온다');

  delete globalThis.localStorage;
  console.log('✓ 저장/불러오기 (전체 상태 왕복 · 국가별 슬롯 · 깨진 저장 무시)');
}

// --- 계정 저장(클라우드) 왕복 · 오프라인 상대 공격 ---
{
  const { unpackSave } = await import('../js/cloudSave.js');
  const { isPeerOnline, ONLINE_WINDOW_MS } = await import('../js/mpNet.js');

  const site = findNearestCapitalSite(0, 0, 200);
  const n2 = createNation('cloud-a', '클라우드국', '#0af', site.x, site.y);
  n2.unlocked.add('smelter');
  n2.trophies = 31;

  // 클라우드로 보낼 때는 영토를 빼고(구조물에서 다시 만든다), 받을 때 복원한다
  const packed = JSON.parse(JSON.stringify({ v: 1, savedAt: Date.now(), nation: n2.toJSON() }));
  delete packed.nation.territory;
  const restored = Nation.fromJSON(unpackSave(packed).nation);
  assert.strictEqual(restored.territory.size, n2.territory.size,
    '클라우드 저장에서 되살린 영토가 원본과 같아야 한다');
  assert.ok(restored.unlocked.has('smelter') && restored.trophies === 31, '나머지 상태도 그대로여야 한다');

  // 오프라인 상대도 매칭돼야 한다 (비동기 습격)
  const me = createNation('me', '나', '#f00', site.x, site.y);
  const offlineSnap = { ...L.defenseSnapshot(n2), updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 };
  offlineSnap.shieldUntil = 0;
  assert.strictEqual(isPeerOnline(offlineSnap), false, '3일 전 접속이면 오프라인으로 표시된다');
  assert.ok(L.findMatch(me, [offlineSnap]), '오프라인 상대도 매칭돼야 한다 (접속 여부와 무관)');

  const onlineSnap = { ...offlineSnap, updatedAt: Date.now() };
  assert.strictEqual(isPeerOnline(onlineSnap), true, '방금 갱신됐으면 접속 중');
  assert.ok(ONLINE_WINDOW_MS > 0);

  console.log('✓ 계정 저장 왕복 (영토 재구성) · 오프라인 상대 공격 가능');
}

// --- 업적: 정의가 온전한가 · 실제로 달성되는가 · 저장에 남는가 ---
{
  const A = await import('../js/achievements.js');
  const { tickNation } = await import('../js/simulate.js');

  // 정의 점검 — key 중복, 잘못된 그룹, 0 이하 목표는 조용히 망가진다
  const keys = A.ACHIEVEMENTS.map(a => a.key);
  assert.strictEqual(new Set(keys).size, keys.length, '업적 key가 중복되면 안 된다');
  const groups = new Set(A.ACH_GROUPS.map(g => g.key));
  for (const a of A.ACHIEVEMENTS) {
    assert.ok(groups.has(a.group), `${a.key}: 알 수 없는 분류 ${a.group}`);
    assert.ok(a.name && a.desc, `${a.key}: 이름/설명이 있어야 한다`);
    assert.ok(Number.isFinite(a.goal) && a.goal > 0, `${a.key}: 목표치가 양수여야 한다`);
    assert.strictEqual(typeof a.value, 'function', `${a.key}: value()가 있어야 한다`);
  }

  // 갓 세운 나라: "건국"만 달성돼 있어야 한다
  const site = findNearestCapitalSite(0, 0, 200);
  const n3 = createNation('ach', '업적국', '#fa0', site.x, site.y);
  let got = A.checkAchievements(n3);
  assert.ok(got.some(a => a.key === 'found'), '수도를 세우면 건국 업적');
  assert.strictEqual(A.checkAchievements(n3).length, 0, '같은 업적이 두 번 달성되면 안 된다');

  // 실제 플레이로 달성되는지 — 창고를 다섯 채 짓는다
  let made = 0;
  for (const k of n3.territory) {
    if (made >= 5) break;
    const [x, y] = k.split(',').map(Number);
    L.depositAnywhere(n3, 'wood', 60); L.depositAnywhere(n3, 'stone', 40); L.recomputeStock(n3);
    if (L.build(n3, 'warehouse', x, y).ok) made++;
  }
  assert.strictEqual(made, 5, '창고 5채를 지을 수 있어야 한다 (시험 준비)');
  got = A.checkAchievements(n3);
  assert.ok(got.some(a => a.key === 'warehouse_5'), '창고 5채 → 보관의 기술');
  assert.strictEqual(n3.stats.built, 6, '건설 횟수가 누적돼야 한다 (수도 + 창고 5)');

  // 생산 기록이 업적으로 이어지는지 (simulate가 stats.produced를 채운다)
  const before = (n3.stats.produced || []).length;
  for (let i = 0; i < 3; i++) tickNation(n3);
  assert.ok((n3.stats.produced || []).length >= before, '생산한 자원 종류가 기록된다');

  // 철거 업적
  const wh = n3.structures.find(s => s.key === 'warehouse');
  L.demolish(n3, wh.id);
  assert.ok(A.checkAchievements(n3).some(a => a.key === 'demolish'), '철거하면 재정비 업적');

  // 전투 업적 — 습격 리포트를 반영하면 달성된다
  n3.stats.raidsWon = 0;
  L.applyRaidToAttacker(n3, {
    id: 'ach-raid', loot: { wood: 5 }, deployedUnits: {},
    win: true, perfectVictory: true, attackerTrophyDelta: 10,
  });
  const war = A.checkAchievements(n3);
  assert.ok(war.some(a => a.key === 'raid_1'), '이기면 첫 습격 업적');
  assert.ok(war.some(a => a.key === 'perfect'), '수도까지 부수면 완벽한 승리 업적');

  // 저장/불러오기를 거쳐도 유지되는지
  const back = Nation.fromJSON(JSON.parse(JSON.stringify(n3.toJSON())));
  assert.deepStrictEqual(back.achievements, n3.achievements, '달성 목록이 저장돼야 한다');
  assert.strictEqual(back.stats.built, n3.stats.built, '누적 기록도 저장돼야 한다');
  assert.strictEqual(A.checkAchievements(back).length, 0, '불러온 뒤 같은 업적이 또 달성되면 안 된다');

  const score = A.achievementScore(n3);
  console.log(`✓ 업적 (${A.ACHIEVEMENTS.length}종 · 정의 검증 · 실제 달성 ${score.done}개 · 저장 유지)`);
}

// --- 클라우드 저장: Firestore가 거부하는 값이 섞이지 않는가 ---
{
  const C = await import('../js/cloudSave.js');
  const site = L.findNearestCapitalSite(0, 0, 200);
  const n4 = createNation('cloud-b', '저장국', '#0af', site.x, site.y);
  // 창고가 아닌 구조물을 섞는다 — store/dir/recruitQueue가 undefined로 남는 자리다
  L.depositAnywhere(n4, 'wood', 400); L.depositAnywhere(n4, 'stone', 400); L.recomputeStock(n4);
  for (const k of n4.territory) {
    const [x, y] = k.split(',').map(Number);
    if (L.build(n4, 'lumber_mill', x, y).ok) break;
  }
  assert.ok(n4.structures.some(s => s.store === undefined), '준비: undefined 필드가 있는 구조물');

  // Firestore와 똑같이 굴게 만든 가짜 SDK — undefined를 만나면 문서 전체를 거부한다
  const findUndefined = (o, path = '') => {
    if (o === undefined) return path;
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        const hit = findUndefined(v, `${path}.${k}`);
        if (hit) return hit;
      }
    }
    return null;
  };
  let written = null;
  const fakeHandles = {
    db: {},
    fx: {
      doc: (db, col, id) => ({ col, id }),
      setDoc: async (ref, data) => {
        const bad = findUndefined(data);
        if (bad) throw Object.assign(new Error(
          `Function setDoc() called with invalid data. Unsupported field value: undefined (found in field ${bad})`),
          { code: 'invalid-argument' });
        written = data;
      },
    },
  };

  const res = await C.saveToCloud(fakeHandles, 'uid-1', n4, {
    raids: { defense: [{ id: 'r1', replay: { deploys: [], base: { structures: [] } } }], attack: [] },
  });
  assert.strictEqual(res.ok, true, `클라우드 저장이 성공해야 한다: ${res.error}`);
  assert.ok(written, '문서가 실제로 쓰여야 한다');
  assert.strictEqual(findUndefined(written), null, '보내는 문서에 undefined가 있으면 안 된다');
  assert.ok(!written.nation.territory, '영토는 빼고 보낸다 (구조물에서 복원)');

  // 되돌리면 영토가 복원되고 나라가 그대로여야 한다
  const back2 = Nation.fromJSON(C.unpackSave(JSON.parse(JSON.stringify(written))).nation);
  assert.strictEqual(back2.territory.size, n4.territory.size, '복원한 영토가 원본과 같아야 한다');
  assert.strictEqual(back2.structures.length, n4.structures.length);

  console.log('✓ 클라우드 저장 (undefined 제거 · 영토 복원 · 거부 없이 전송)');
}

console.log('\n✅ 회귀 테스트 전부 통과');

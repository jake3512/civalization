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

console.log('\n✅ 회귀 테스트 전부 통과');

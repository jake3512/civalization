// ============================================================
// scripts/check-progression.mjs — "게임 진행이 막히지 않는지" 자동 검사
//
// 시작 상태(기본 해금 구조물 + 기초 자원)에서 출발해, 수도 레벨을 올릴 때마다
// 그 레벨에서 열리는 연구를 전부 수행하고, 그 시점까지 만들 수 있는 자원만으로
// 다음 수도 레벨 비용과 각 구조물의 건설비·연구비를 감당할 수 있는지 확인한다.
// 하나라도 불가능하면 그 지점을 출력하고 실패로 끝난다.
//
//   node scripts/check-progression.mjs
//
// 밸런스를 고친 뒤에는 이 스크립트를 꼭 다시 돌려 데드락이 생기지 않았는지 확인할 것.
// (실제로 연구소가 금 주괴를 요구해 제련소 연구가 영원히 불가능했던 적이 있다)
// ============================================================
import { STRUCTURES, TECH_TREE, BASE_UNLOCKED, TERRAIN_NODES, getUpgradeCost, VIRTUAL_RESOURCES } from '../js/data.js';

// 어떤 구조물 집합으로 만들 수 있는 자원 전체를 구한다 (고정점 반복)
function producible(unlocked) {
  const have = new Set(['gold']); // 골드는 수도가 자동 생산
  for (const k of unlocked) {
    const d = STRUCTURES[k];
    if (!d) continue;
    if (d.category === 'extraction') {
      // 채굴 구조물은 설치 가능한 지형의 산출물을 전부 얻을 수 있다
      for (const nodeKey of d.requiresNode || []) have.add(TERRAIN_NODES[nodeKey].yields);
    }
    if (k === 'farm') have.add('food');
    if (k === 'barn') have.add('livestock');
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of unlocked) {
      const d = STRUCTURES[k];
      if (!d || !d.recipes) continue;
      for (const [outKey, r] of Object.entries(d.recipes)) {
        const ins = Object.keys(r.in);
        if (!ins.every(i => have.has(i))) continue;
        const outs = typeof r.out === 'number' ? [outKey] : Object.keys(r.out);
        for (const o of outs) if (!have.has(o)) { have.add(o); changed = true; }
      }
    }
  }
  return have;
}

const unlocked = new Set(BASE_UNLOCKED);
let capLevel = 1;
let ok = true;

// 시작 시점: 처음부터 지을 수 있는 구조물의 건설비를 감당할 수 있는가
let have = producible(unlocked);
for (const k of BASE_UNLOCKED) {
  const blocked = Object.keys(STRUCTURES[k].baseCost).filter(r => !have.has(r));
  if (blocked.length) { console.log(`✗ 시작 구조물 [${k}] 건설 불가 — ${blocked.join(',')} 없음`); ok = false; }
}

while (capLevel < STRUCTURES.capital.maxLevel) {
  have = producible(unlocked);
  // 이 수도 레벨에서 열리는 연구를 전부 수행
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [key, tech] of Object.entries(TECH_TREE)) {
      if (unlocked.has(key)) continue;
      if ((tech.capitalLevel || 1) > capLevel) continue;
      if (!tech.requires.every(r => unlocked.has(r))) continue;
      const blocked = Object.keys(tech.cost).filter(r => !have.has(r));
      if (blocked.length) { console.log(`✗ 연구 [${key}] 비용 불가 — ${blocked.join(',')} 없음 (수도 Lv${capLevel})`); ok = false; continue; }
      const blockedBuild = Object.keys(STRUCTURES[key].baseCost).filter(r => !have.has(r));
      if (blockedBuild.length) { console.log(`✗ 구조물 [${key}] 건설비 불가 — ${blockedBuild.join(',')} 없음 (수도 Lv${capLevel})`); ok = false; }
      unlocked.add(key); progressed = true;
      have = producible(unlocked);
    }
  }
  // 다음 수도 레벨 비용을 지금 만들 수 있는가
  const cost = getUpgradeCost('capital', capLevel);
  const blocked = Object.keys(cost).filter(r => !have.has(r) && !VIRTUAL_RESOURCES.has(r));
  if (blocked.length) {
    console.log(`✗ 수도 Lv${capLevel}→${capLevel+1} 비용 불가 — ${blocked.join(', ')} 를 아직 만들 수 없음`);
    console.log(`   (이 시점 해금: ${[...unlocked].join(', ')})`);
    ok = false; break;
  }
  console.log(`✓ 수도 Lv${capLevel}→${capLevel+1} 가능  | 해금됨: ${[...unlocked].filter(k=>!BASE_UNLOCKED.includes(k)).join(', ') || '(기본만)'}`);
  capLevel++;
}
const pass = ok && capLevel === STRUCTURES.capital.maxLevel;
console.log(pass ? `\n✅ 진행 막힘 없음 — 수도 ${STRUCTURES.capital.maxLevel}레벨까지 도달 가능` : '\n❌ 진행이 막히는 지점이 있음');
process.exit(pass ? 0 : 1);

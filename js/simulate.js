// ============================================================
// simulate.js — 매 틱마다 실행되는 시뮬레이션 (클라이언트/서버 공용)
//
// 순서: ① 전력 공급 범위 계산 → ② 채굴/생산(전력 필요 시 범위 내인지 검사,
// 산출물은 구조물 자신의 산출 인벤토리에 쌓이고 가득 차면 가동 정지) →
// ③ 산출/창고 재고를 인접 벨트로 배출 → ④ 국고 표시 집계 → ⑤ 연구 진행
//
// 중요: 자원은 저절로 국고로 들어가지 않는다. 벨트나 수동 이송으로 창고(수도 포함)
// 까지 옮겨야 국고에 잡히고 건설·연구·모집 비용으로 쓸 수 있다.
// ============================================================
import { STRUCTURES, POWER_REQUIRED_CATEGORIES, DIR_VECT, beltThroughput, LOGISTICS, getOutputCapacity } from './data.js';
import { getTile } from './world.js';
import { footprintTiles, tileKey, structureAt, getTerritoryRadius,
         depositInto, withdrawFrom, recomputeStock } from './logic.js';

// ---------------- 전력 ----------------
function computePoweredCircles(nation) {
  const circles = [];

  // 수도는 자신의 영토 범위(레벨에 비례해 넓어짐) 안에는 항상 전력을 공급한다.
  const capital = nation.structures.find(s => s.key === 'capital');
  if (capital) {
    const def = STRUCTURES.capital;
    const [w, h] = def.footprint;
    circles.push({
      cx: capital.x + w / 2, cy: capital.y + h / 2,
      r: getTerritoryRadius('capital', capital.level),
    });
  }

  for (const s of nation.structures) {
    if (s.key !== 'power_plant') continue;
    const def = STRUCTURES.power_plant;
    // 발전소가 이번 틱에 실제로 가동됐는지는 연료 소모 성공 여부로 판단(아래에서 세팅)
    if (s._fueled) {
      const [w, h] = def.footprint;
      circles.push({ cx: s.x + w / 2, cy: s.y + h / 2, r: def.powerRadius + (s.level - 1) });
    }
  }
  return circles;
}
function isPowered(circles, s, def) {
  const [w, h] = def.footprint;
  const cx = s.x + w / 2, cy = s.y + h / 2;
  return circles.some(c => Math.hypot(cx - c.cx, cy - c.cy) <= c.r);
}

// ---------------- 벨트 물류 ----------------
function findAdjacentBelt(nation, s, def, wantFacingAway) {
  // 구조물 외곽에 붙어있는 벨트 중, 조건(구조물에서 나가는 방향인지)에 맞는 것을 찾는다
  const tiles = footprintTiles(s.x, s.y, def.footprint);
  const inside = new Set(tiles.map(([x, y]) => tileKey(x, y)));
  for (const [x, y] of tiles) {
    for (const [dx, dy] of DIR_VECT) {
      const nx = x + dx, ny = y + dy;
      if (inside.has(tileKey(nx, ny))) continue;
      const belt = nation.structures.find(b => b.key === 'belt' && b.x === nx && b.y === ny);
      if (!belt) continue;
      const [bdx, bdy] = DIR_VECT[belt.dir];
      const targetTile = tileKey(nx + bdx, ny + bdy);
      const pointsBackIn = inside.has(targetTile);
      if (wantFacingAway && !pointsBackIn) return belt;   // 구조물에서 나가는 벨트(산출 포트)
      if (!wantFacingAway && pointsBackIn) return belt;   // 구조물로 들어오는 벨트(투입 포트)
    }
  }
  return null;
}

/**
 * 벨트 체인을 따라 자원을 보낸다. 실제로 목적지에 들어간 양을 반환한다.
 * (들어가지 못한 양은 호출자가 원래 있던 곳에 그대로 남겨둔다 — 예전처럼
 *  국고로 순간이동시키지 않는다. 국고는 창고 재고의 합계일 뿐이기 때문)
 */
function pushIntoBeltChain(nation, startBelt, res, amt) {
  let cur = startBelt;
  const visited = new Set();
  while (cur) {
    const key = tileKey(cur.x, cur.y);
    if (visited.has(key)) break; // 루프 방지
    visited.add(key);
    const [dx, dy] = DIR_VECT[cur.dir];
    const nx = cur.x + dx, ny = cur.y + dy;
    const moved = Math.min(amt, beltThroughput(cur.level));

    const targetStruct = structureAt(nation, nx, ny);
    if (targetStruct && targetStruct.key !== 'belt') {
      // 창고로 들어가는 경우 — 종류/용량 제한을 그대로 적용한다
      if (STRUCTURES[targetStruct.key]?.storageCapacity) {
        return depositInto(targetStruct, res, moved);
      }
      targetStruct.inputBuffer = targetStruct.inputBuffer || {};
      const room = LOGISTICS.inputCapacity - (targetStruct.inputBuffer[res] || 0);
      const accepted = Math.max(0, Math.min(moved, room));
      targetStruct.inputBuffer[res] = (targetStruct.inputBuffer[res] || 0) + accepted;
      return accepted;
    }
    const nextBelt = nation.structures.find(b => b.key === 'belt' && b.x === nx && b.y === ny);
    if (nextBelt) { cur = nextBelt; continue; }
    break; // 벨트가 허공에서 끝남 → 아무것도 옮기지 못한다
  }
  return 0;
}

/**
 * 생산물을 구조물의 산출 인벤토리에 넣는다 (용량 상한 적용).
 * 넣지 못한 양이 있으면 그만큼 가동이 막힌 것으로 본다.
 * 실제로 적재한 양을 반환한다.
 */
function storeOutput(s, res, amt) {
  if (amt <= 0) return 0;
  s.outputBuffer = s.outputBuffer || {};
  const cap = getOutputCapacity(s.key, s.level);
  const used = Object.values(s.outputBuffer).reduce((a, b) => a + b, 0);
  const add = Math.max(0, Math.min(amt, cap - used));
  if (add > 0) s.outputBuffer[res] = (s.outputBuffer[res] || 0) + add;
  return add;
}

/** 산출 인벤토리에 여유 공간이 남아 있는지 */
function hasOutputRoom(s) {
  s.outputBuffer = s.outputBuffer || {};
  const used = Object.values(s.outputBuffer).reduce((a, b) => a + b, 0);
  return used < getOutputCapacity(s.key, s.level);
}

/** 구조물의 산출 인벤토리를 인접한 나가는 벨트로 흘려보낸다 */
function drainOutputToBelt(nation, s, def) {
  s.outputBuffer = s.outputBuffer || {};
  const entries = Object.entries(s.outputBuffer).filter(([, v]) => v > 0);
  if (!entries.length) return;
  const exitBelt = findAdjacentBelt(nation, s, def, true);
  if (!exitBelt) return;
  for (const [res, have] of entries) {
    const moved = pushIntoBeltChain(nation, exitBelt, res, have);
    if (moved > 0) {
      s.outputBuffer[res] -= moved;
      if (s.outputBuffer[res] <= 0) delete s.outputBuffer[res];
    }
  }
}

/** 창고도 인접한 나가는 벨트로 재고를 내보낼 수 있다 (창고 → 공장 공급) */
function drainStorageToBelt(nation, s, def) {
  const entries = Object.entries(s.store || {}).filter(([, v]) => v > 0);
  if (!entries.length) return;
  const exitBelt = findAdjacentBelt(nation, s, def, true);
  if (!exitBelt) return;
  const rate = LOGISTICS.warehouseBeltRate * s.level;
  for (const [res, have] of entries) {
    const moved = pushIntoBeltChain(nation, exitBelt, res, Math.min(rate, have));
    if (moved > 0) withdrawFrom(s, res, moved);
  }
}

// ---------------- 전초기지: 병력 모집 대기열 처리 ----------------
// 골드는 모집 신청 시 이미 지불되었다 (logic.js recruitUnit). 여기서는 벨트로
// 투입된 장비 아이템(inputBuffer)이 요구량을 채웠는지만 확인해 로스터에 편입한다.
function processRecruitQueue(nation, s) {
  s.recruitQueue = s.recruitQueue || [];
  s.inputBuffer = s.inputBuffer || {};
  nation.units = nation.units || { attack: {}, defense: {} };

  for (let i = s.recruitQueue.length - 1; i >= 0; i--) {
    const job = s.recruitQueue[i];
    const ready = Object.entries(job.need).every(([res, amt]) => (s.inputBuffer[res] || 0) >= amt);
    if (!ready) continue;
    for (const [res, amt] of Object.entries(job.need)) s.inputBuffer[res] -= amt;
    const bucket = job.isDefense ? nation.units.defense : nation.units.attack;
    bucket[job.unitKey] = (bucket[job.unitKey] || 0) + 1;
    s.recruitQueue.splice(i, 1);
  }
}

// ---------------- 메인 틱 ----------------
export function tickNation(nation) {
  // 0) 초기화
  for (const s of nation.structures) { s.idle = false; s._fueled = false; s.idleReason = null; }

  // 1) 발전소 연료 소모 — 연료는 벨트나 수동 이송으로 발전소에 직접 넣어줘야 한다
  //    (국고는 창고 재고의 합계일 뿐이라 원격으로 끌어다 쓸 수 없다)
  for (const s of nation.structures) {
    if (s.key !== 'power_plant') continue;
    const def = STRUCTURES.power_plant;
    s.inputBuffer = s.inputBuffer || {};
    const fuel = (s.inputBuffer.wood || 0) >= 2 ? 'wood'
      : ((s.inputBuffer.petroleum || 0) >= 1 ? 'petroleum' : null);
    if (fuel) {
      s.inputBuffer[fuel] -= fuel === 'wood' ? 2 : 1;
      nation.resources.electricity = (nation.resources.electricity || 0) + def.baseProduction * s.level;
      s._fueled = true;
    } else {
      s.idleReason = '연료 없음';
    }
  }
  const poweredCircles = computePoweredCircles(nation);

  // 2) 채굴 / 생산
  for (const s of nation.structures) {
    const def = STRUCTURES[s.key];
    if (POWER_REQUIRED_CATEGORIES.has(def.category) && !isPowered(poweredCircles, s, def)) {
      s.idle = true; // 전력 부족 → 이번 틱 가동 안 함 (수동 운용으로는 돌릴 수 있다)
      s.idleReason = '전력 없음';
      continue;
    }

    if (def.category === 'extraction') {
      // 산출 인벤토리가 가득 차면 캐낼 곳이 없어 가동을 멈춘다
      if (!hasOutputRoom(s)) { s.idle = true; s.idleReason = '산출 가득 참'; continue; }
      const t = getTile(s.x, s.y);
      if (t.node) storeOutput(s, t.node.yields, def.baseProduction * s.level);
    } else if (def.category === 'production') {
      if (!hasOutputRoom(s)) { s.idle = true; s.idleReason = '산출 가득 참'; continue; }

      if (def.recipes && s.recipe) {
        const r = def.recipes[s.recipe];
        const need = {};
        for (const [res, amt] of Object.entries(r.in)) need[res] = amt * s.level;

        // 재료는 반드시 투입 버퍼(벨트 또는 수동 이송)에 들어와 있어야 한다
        const buf = s.inputBuffer || {};
        const ok = Object.entries(need).every(([res, amt]) => (buf[res] || 0) >= amt);
        if (ok) {
          for (const [res, amt] of Object.entries(need)) buf[res] -= amt;
          const outs = typeof r.out === 'number' ? { [s.recipe]: r.out } : r.out;
          for (const [res, amt] of Object.entries(outs)) storeOutput(s, res, amt * s.level);
        } else {
          s.idle = true;
          s.idleReason = '재료 부족';
        }
      } else if (s.key === 'farm') {
        storeOutput(s, 'food', def.baseProduction * s.level);
      } else if (s.key === 'barn') {
        storeOutput(s, 'livestock', def.baseProduction * s.level);
      } else {
        s.idle = true;
        s.idleReason = '레시피 미선택';
      }
    } else if (def.category === 'turret') {
      // 터렛은 사거리 내에 있어도(전력 공급 범위) 매 틱 kW만큼 전력을 계속 소모해야 작동한다.
      const draw = def.powerDraw * s.level;
      if ((nation.resources.electricity || 0) >= draw) {
        nation.resources.electricity -= draw;
      } else {
        s.idle = true; // 전력 부족 → 이번 틱은 격파 능력 없음(getDefensePower에서 제외됨)
      }
    } else if (def.category === 'core' && s.key === 'capital') {
      nation.resources.gold = (nation.resources.gold || 0) + (def.goldIncome || 0) * s.level;
    } else if (def.category === 'military_base' && s.key === 'outpost') {
      processRecruitQueue(nation, s);
    }
  }

  // 3) 물류 — 산출 인벤토리와 창고 재고를 인접한 나가는 벨트로 흘려보낸다
  for (const s of nation.structures) {
    const def = STRUCTURES[s.key];
    if (!def || s.key === 'belt') continue;
    if (def.storageCapacity) drainStorageToBelt(nation, s, def);
    else drainOutputToBelt(nation, s, def);
  }

  // 4) 국고 표시 갱신 — 창고·수도에 실제로 든 재고의 합계
  recomputeStock(nation);

  // 5) 연구 진행
  if (nation.research && nation.research.key) {
    nation.research.ticksLeft -= 1;
    if (nation.research.ticksLeft <= 0) {
      nation.unlocked.add(nation.research.key);
      nation.research = null;
    }
  }
}

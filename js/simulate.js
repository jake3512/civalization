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
import { STRUCTURES, POWER_REQUIRED_CATEGORIES, DIR_VECT, beltThroughput, LOGISTICS, getOutputCapacity, isBeltKey,
         CROPS, ANIMALS, pickPowerFuel, splitterExits, BELT_OFF, facesForOutput } from './data.js';
import { getTile } from './world.js';
import { footprintTiles, tileKey, structureAt, getTerritoryRadius,
         depositInto, withdrawFrom, recomputeStock, finishExpedition } from './logic.js';

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
/** 벨트류인가 (일반 벨트 · 분할 · 교차) */
const isBelt = (s) => !!s && isBeltKey(s.key);

/**
 * 구조물에 붙어있는 벨트를 찾는다.
 * @param wantFacingAway true면 나가는 벨트(산출), false면 들어오는 벨트(투입)
 * @param side           0=동 1=남 2=서 3=북. 지정하면 그 면에 붙은 벨트만 본다
 *                       (배출구 — data.js outputPorts 참고). null이면 아무 면이나.
 */
function findAdjacentBelt(nation, s, def, wantFacingAway, side = null) {
  // 구조물 외곽에 붙어있는 벨트 중, 조건(구조물에서 나가는 방향인지)에 맞는 것을 찾는다
  const tiles = footprintTiles(s.x, s.y, def.footprint);
  const inside = new Set(tiles.map(([x, y]) => tileKey(x, y)));
  for (const [x, y] of tiles) {
    for (let d = 0; d < DIR_VECT.length; d++) {
      if (side != null && d !== side) continue;
      const [dx, dy] = DIR_VECT[d];
      const nx = x + dx, ny = y + dy;
      if (inside.has(tileKey(nx, ny))) continue;
      const belt = nation.structures.find(b => isBelt(b) && b.x === nx && b.y === ny);
      if (!belt) continue;
      // 교차로는 들어온 방향 그대로 지나가므로, 구조물 쪽에서 보면 항상 "나가는" 포트다
      const [bdx, bdy] = DIR_VECT[belt.dir || 0];
      const targetTile = tileKey(nx + bdx, ny + bdy);
      const pointsBackIn = STRUCTURES[belt.key].beltKind === 'cross' ? false : inside.has(targetTile);
      if (wantFacingAway && !pointsBackIn) return belt;   // 구조물에서 나가는 벨트(산출 포트)
      if (!wantFacingAway && pointsBackIn) return belt;   // 구조물로 들어오는 벨트(투입 포트)
    }
  }
  return null;
}

/** UI용 — 이 면(0=동 1=남 2=서 3=북)에 "밖으로 나가는" 벨트가 붙어 있는가 */
export function exitBeltOn(nation, s, side) {
  const def = STRUCTURES[s?.key];
  return def ? findAdjacentBelt(nation, s, def, true, side) : null;
}

/**
 * 벨트 체인을 따라 자원을 보낸다. 실제로 목적지에 들어간 양을 반환한다.
 * (들어가지 못한 양은 호출자가 원래 있던 곳에 그대로 남겨둔다 — 예전처럼
 *  국고로 순간이동시키지 않는다. 국고는 창고 재고의 합계일 뿐이기 때문)
 *
 * 이 벨트 칸에서 자원이 나갈 방향들을 정한다.
 *  · 일반 벨트: 설정된 방향 하나
 *  · 분할 컨베이어: 정면과 옆(좌 또는 우) **두 방향**을 번갈아 (막힌 쪽은 건너뛴다)
 *  · 교차로: 들어온 방향 그대로 직진 (두 라인이 섞이지 않는다)
 */
function beltExits(s, fromDir) {
  const kind = STRUCTURES[s.key].beltKind;
  if (kind === 'cross') {
    // 들어온 방향을 모르면(구조물에서 바로 들어온 경우) 설정 방향으로 내보낸다
    return [fromDir == null ? (s.dir || 0) : fromDir];
  }
  if (kind === 'splitter') {
    const order = splitterExits(s);   // [정면, 옆] — 옆이 어느 쪽인지는 s.branch
    // 매번 같은 순서로 보내면 한쪽만 채워지므로, 보낸 횟수로 시작점을 돌린다
    const turn = (s._splitTurn || 0) % order.length;
    return [...order.slice(turn), ...order.slice(0, turn)];
  }
  return [s.dir || 0];
}

/**
 * 벨트 체인을 따라 자원을 보낸다. 실제로 목적지에 들어간 양을 반환한다.
 * (들어가지 못한 양은 호출자가 원래 있던 곳에 그대로 남겨둔다 — 예전처럼
 *  국고로 순간이동시키지 않는다. 국고는 창고 재고의 합계일 뿐이기 때문)
 */
function pushIntoBeltChain(nation, startBelt, res, amt, fromDir = null, visited = new Set(), depth = 0) {
  const cur = startBelt;
  if (!cur || depth > 200) return 0;
  const key = tileKey(cur.x, cur.y);
  if (visited.has(key)) return 0;   // 루프 방지
  visited.add(key);

  const moved = Math.min(amt, beltThroughput(cur.level));
  // 지나간 자원을 벨트에 표시해 둔다 (화면에서 무엇이 흐르는지 보이도록)
  cur._carry = res; cur._carryTtl = 2;

  for (const dir of beltExits(cur, fromDir)) {
    const [dx, dy] = DIR_VECT[dir];
    const nx = cur.x + dx, ny = cur.y + dy;
    const target = structureAt(nation, nx, ny);

    if (target && !isBelt(target)) {
      // 창고로 들어가는 경우 — 종류/용량 제한을 그대로 적용한다
      if (STRUCTURES[target.key]?.storageCapacity) {
        const got = depositInto(target, res, moved);
        if (got > 0) { cur._splitTurn = (cur._splitTurn || 0) + 1; return got; }
        continue;   // 이 갈래가 막혔으면 다음 갈래로
      }
      target.inputBuffer = target.inputBuffer || {};
      const room = LOGISTICS.inputCapacity - (target.inputBuffer[res] || 0);
      const accepted = Math.max(0, Math.min(moved, room));
      if (accepted > 0) {
        target.inputBuffer[res] = (target.inputBuffer[res] || 0) + accepted;
        cur._splitTurn = (cur._splitTurn || 0) + 1;
        return accepted;
      }
      continue;
    }

    if (isBelt(target)) {
      const got = pushIntoBeltChain(nation, target, res, moved, dir, visited, depth + 1);
      if (got > 0) { cur._splitTurn = (cur._splitTurn || 0) + 1; return got; }
      visited.delete(tileKey(target.x, target.y)); // 다른 갈래로도 시도할 수 있게 되돌린다
      continue;
    }
    // 벨트가 허공에서 끝남 → 이 갈래로는 못 보낸다
  }
  return 0;
}

/**
 * 생산물을 구조물의 산출 인벤토리에 넣는다 (용량 상한 적용).
 * 넣지 못한 양이 있으면 그만큼 가동이 막힌 것으로 본다.
 * 실제로 적재한 양을 반환한다.
 */
function storeOutput(nation, s, res, amt) {
  if (amt <= 0) return 0;
  // 업적용 기록 — "한 번이라도 만들어 본 자원"은 여기 한 곳만 지나간다
  if (nation) {
    nation.stats = nation.stats || {};
    const seen = nation.stats.produced = nation.stats.produced || [];
    if (!seen.includes(res)) seen.push(res);
    if (s.key === 'kitchen') nation.stats.cooked = (nation.stats.cooked || 0) + 1;
  }
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

  // 자원마다 나갈 수 있는 면이 정해져 있다 (자동 배정 + 플레이어 설정).
  // 그 면에 벨트가 없으면 그 자원은 나가지 못한다 — 라인이 섞이지 않게.
  for (const [res, have] of entries) {
    for (const dir of facesForOutput(s, res)) {
      const belt = findAdjacentBelt(nation, s, def, true, dir);
      if (!belt) continue;
      const moved = pushIntoBeltChain(nation, belt, res, have);
      if (moved > 0) {
        s.outputBuffer[res] -= moved;
        if (s.outputBuffer[res] <= 0) delete s.outputBuffer[res];
        break;   // 한 자원은 한 면으로만 내보낸다 (예전과 같은 처리량)
      }
    }
  }
}

/**
 * 창고·수도도 인접한 나가는 벨트로 재고를 내보낸다 (창고 → 공장 공급).
 * 면마다 자원을 지정해 두면(struct.outFilter) 그 면으로는 그 자원만 나간다.
 * 지정하지 않은 면은 아무거나 내보낸다. 매 틱 내보낼 수 있는 총량은 면 개수와
 * 상관없이 창고 하나당 warehouseBeltRate × 레벨로 고정한다.
 */
function drainStorageToBelt(nation, s, def) {
  if (!Object.values(s.store || {}).some(v => v > 0)) return;
  let budget = LOGISTICS.warehouseBeltRate * s.level;
  const filters = s.outFilter || {};

  for (let dir = 0; dir < DIR_VECT.length && budget > 0; dir++) {
    const only = filters[dir];
    if (only === BELT_OFF) continue;   // 이 면은 벨트 연결을 끊어 둔 상태
    const belt = findAdjacentBelt(nation, s, def, true, dir);
    if (!belt) continue;
    const entries = Object.entries(s.store || {})
      .filter(([res, v]) => v > 0 && (!only || res === only));
    for (const [res, have] of entries) {
      if (budget <= 0) break;
      const moved = pushIntoBeltChain(nation, belt, res, Math.min(budget, have));
      if (moved > 0) { withdrawFrom(s, res, moved); budget -= moved; }
    }
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
  // 0) 초기화. 벨트가 "지금 무엇을 나르는 중인지"는 이 틱 동안만 유효한 표시라
  //    (벨트는 자원을 담아두지 않고 즉시 통과시킨다) 몇 틱 뒤 저절로 사라진다.
  for (const s of nation.structures) {
    s.idle = false; s._fueled = false; s.idleReason = null;
    if (s._carryTtl > 0 && --s._carryTtl === 0) s._carry = null;
  }

  // 1) 발전소 연료 소모 — 연료는 벨트나 수동 이송으로 발전소에 직접 넣어줘야 한다
  //    (국고는 창고 재고의 합계일 뿐이라 원격으로 끌어다 쓸 수 없다)
  for (const s of nation.structures) {
    if (s.key !== 'power_plant') continue;
    const def = STRUCTURES.power_plant;
    s.inputBuffer = s.inputBuffer || {};
    const fuel = pickPowerFuel(s.inputBuffer);   // 나무 · 석탄 · 석유 (data.js POWER_FUELS)
    if (fuel) {
      s.inputBuffer[fuel.res] -= fuel.amount;
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
      if (t.node) storeOutput(nation, s, t.node.yields, def.baseProduction * s.level);
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
          for (const [res, amt] of Object.entries(outs)) storeOutput(nation, s, res, amt * s.level);
        } else {
          s.idle = true;
          s.idleReason = '재료 부족';
        }
      } else if (s.key === 'farm') {
        const crop = CROPS[s.crop || 'rice'];
        if (crop) {
          storeOutput(nation, s, crop.yields, crop.baseYield * s.level);
          // 인력은 오직 농지에서만 나온다 (여행의 유일한 연료).
          // 작물과 달리 창고를 거치지 않는 수치 자원이라 바로 국고에 더한다.
          nation.resources.labor = (nation.resources.labor || 0) + (def.laborIncome || 0) * s.level;
        } else { s.idle = true; s.idleReason = '작물 미선택'; }
      } else if (s.key === 'barn') {
        const animal = ANIMALS[s.animal || 'cattle'];
        if (animal) {
          storeOutput(nation, s, animal.yields, animal.baseYield * s.level);
          // 우유·달걀 같은 부산물은 가축과 함께 나온다
          for (const [res, amt] of Object.entries(animal.products || {})) storeOutput(nation, s, res, amt * s.level);
        } else { s.idle = true; s.idleReason = '가축 미선택'; }
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

  // 5) 여행(원정) 진행 — 끝나면 보상 자원과 새 작물/가축/요리법을 얻는다
  if (nation.expedition && nation.expedition.key) {
    nation.expedition.ticksLeft -= 1;
    if (nation.expedition.ticksLeft <= 0) {
      nation.lastExpedition = finishExpedition(nation);
    }
  }

  // 6) 연구 진행
  if (nation.research && nation.research.key) {
    nation.research.ticksLeft -= 1;
    if (nation.research.ticksLeft <= 0) {
      nation.unlocked.add(nation.research.key);
      nation.research = null;
    }
  }
}

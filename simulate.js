// ============================================================
// simulate.js — 매 틱마다 실행되는 시뮬레이션 (클라이언트/서버 공용)
//
// 순서: ① 전력 공급 범위 계산 → ② 채굴/생산(전력 필요 시 범위 내인지 검사,
// 산출물은 벨트가 연결돼 있으면 벨트를 타고 이동, 아니면 창고로 직행) →
// ③ 벨트 물류 해석 → ④ 연구 진행 → ⑤ 습격자 스폰/이동/터렛 교전
// ============================================================
import { STRUCTURES, RESOURCES, POWER_REQUIRED_CATEGORIES, DIR_VECT, beltThroughput, RAIDER } from './data.js';
import { getTile } from './world.js';
import { footprintTiles, tileKey, structureAt } from './logic.js';

// ---------------- 전력 ----------------
function computePoweredCircles(nation) {
  const circles = [];
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

function pushIntoBeltChain(nation, startBelt, res, amt) {
  let cur = startBelt;
  let remaining = amt;
  const visited = new Set();
  while (remaining > 0 && cur) {
    const key = tileKey(cur.x, cur.y);
    if (visited.has(key)) break; // 루프 방지
    visited.add(key);
    const [dx, dy] = DIR_VECT[cur.dir];
    const nx = cur.x + dx, ny = cur.y + dy;
    const throughput = beltThroughput(cur.level);
    const moved = Math.min(remaining, throughput);

    const targetStruct = structureAt(nation, nx, ny);
    if (targetStruct && targetStruct.key !== 'belt') {
      targetStruct.inputBuffer = targetStruct.inputBuffer || {};
      targetStruct.inputBuffer[res] = (targetStruct.inputBuffer[res] || 0) + moved;
      remaining -= moved;
      break;
    }
    const nextBelt = nation.structures.find(b => b.key === 'belt' && b.x === nx && b.y === ny);
    if (nextBelt) { cur = nextBelt; continue; }
    break; // 벨트가 허공에서 끝남 → 남은 양은 유실 (플레이어가 경로를 이어줘야 함)
  }
  if (remaining > 0) {
    // 목적지를 못 찾은 나머지는 창고로 반환 (자원 유실 방지, 초보자 배려)
    nation.resources[res] = (nation.resources[res] || 0) + remaining;
  }
}

function emitOutput(nation, s, def, res, amt) {
  if (amt <= 0) return;
  const exitBelt = findAdjacentBelt(nation, s, def, true);
  if (exitBelt) pushIntoBeltChain(nation, exitBelt, res, amt);
  else nation.resources[res] = (nation.resources[res] || 0) + amt;
}

// ---------------- 메인 틱 ----------------
export function tickNation(nation) {
  // 0) 초기화
  for (const s of nation.structures) { s.idle = false; s._fueled = false; }

  // 1) 발전소 연료 소모 (나무 2 또는 석유 1)
  for (const s of nation.structures) {
    if (s.key !== 'power_plant') continue;
    const def = STRUCTURES.power_plant;
    const fuel = (nation.resources.wood >= 2) ? 'wood' : ((nation.resources.petroleum || 0) >= 1 ? 'petroleum' : null);
    if (fuel) {
      nation.resources[fuel] -= fuel === 'wood' ? 2 : 1;
      nation.resources.electricity = (nation.resources.electricity || 0) + def.baseProduction * s.level;
      s._fueled = true;
    }
  }
  const poweredCircles = computePoweredCircles(nation);

  // 2) 채굴 / 생산
  for (const s of nation.structures) {
    const def = STRUCTURES[s.key];
    if (POWER_REQUIRED_CATEGORIES.has(def.category) && !isPowered(poweredCircles, s, def)) {
      s.idle = true; // 전력 부족 → 이번 틱 가동 안 함
      continue;
    }

    if (def.category === 'extraction') {
      const t = getTile(s.x, s.y);
      if (t.node) emitOutput(nation, s, def, t.node.yields, def.baseProduction * s.level);
    } else if (def.category === 'production') {
      if (def.recipes && s.recipe) {
        const r = def.recipes[s.recipe];
        const need = {};
        for (const [res, amt] of Object.entries(r.in)) need[res] = amt * s.level;

        if (r.requiresBelt) {
          // 벨트로 투입된 양만 사용 (창고 자원 사용 불가)
          const buf = s.inputBuffer || {};
          const ok = Object.entries(need).every(([res, amt]) => (buf[res] || 0) >= amt);
          if (ok) {
            for (const [res, amt] of Object.entries(need)) buf[res] -= amt;
            const outRes = s.recipe;
            emitOutput(nation, s, def, outRes, r.out * s.level);
          } else {
            s.idle = true;
          }
        } else {
          // 벨트 입력분을 우선 소모하고 부족분은 창고에서 충당
          const buf = s.inputBuffer || {};
          const totalAvail = {};
          for (const res of Object.keys(need)) totalAvail[res] = (buf[res] || 0) + (nation.resources[res] || 0);
          const ok = Object.entries(need).every(([res, amt]) => totalAvail[res] >= amt);
          if (ok) {
            for (const [res, amt] of Object.entries(need)) {
              const fromBuf = Math.min(buf[res] || 0, amt);
              buf[res] = (buf[res] || 0) - fromBuf;
              nation.resources[res] = (nation.resources[res] || 0) - (amt - fromBuf);
            }
            if (typeof r.out === 'number') emitOutput(nation, s, def, s.recipe, r.out * s.level);
            else for (const [res, amt] of Object.entries(r.out)) emitOutput(nation, s, def, res, amt * s.level);
          } else {
            s.idle = true;
          }
        }
      } else if (s.key === 'farm') {
        emitOutput(nation, s, def, 'food', def.baseProduction * s.level);
      } else if (s.key === 'barn') {
        emitOutput(nation, s, def, 'livestock', def.baseProduction * s.level);
      } else {
        s.idle = true;
      }
    } else if (def.category === 'military' && s.key === 'outpost') {
      nation.resources.military = (nation.resources.military || 0) + def.baseProduction * s.level;
    }
  }

  // 3) 연구 진행
  if (nation.research && nation.research.key) {
    nation.research.ticksLeft -= 1;
    if (nation.research.ticksLeft <= 0) {
      nation.unlocked.add(nation.research.key);
      nation.research = null;
    }
  }

  // 4) 습격(레이더) — 스폰, 이동, 터렛 교전, 수도 도달 피해
  tickRaiders(nation);
}

function tickRaiders(nation) {
  nation.raiders = nation.raiders || [];
  nation.capitalHp = nation.capitalHp ?? RAIDER.capitalMaxHp;
  nation.capitalHp = Math.min(RAIDER.capitalMaxHp, nation.capitalHp + RAIDER.capitalRegen);

  if (nation.raiders.length < RAIDER.maxActive && Math.random() < RAIDER.spawnChance) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 10;
    nation.raiders.push({
      id: 'r' + Math.random().toString(36).slice(2, 8),
      x: nation.capital.x + Math.cos(angle) * dist,
      y: nation.capital.y + Math.sin(angle) * dist,
      hp: RAIDER.baseHp,
    });
  }

  // 이동
  for (const r of nation.raiders) {
    const dx = nation.capital.x - r.x, dy = nation.capital.y - r.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.5) {
      r.x += (dx / dist) * RAIDER.moveSpeed;
      r.y += (dy / dist) * RAIDER.moveSpeed;
    }
  }

  // 터렛 교전 (사거리 내 가장 가까운 습격자 공격)
  for (const s of nation.structures) {
    if (s.key !== 'turret') continue;
    const def = STRUCTURES.turret;
    const range = def.range + (s.level - 1);
    let target = null, best = Infinity;
    for (const r of nation.raiders) {
      const d = Math.hypot(r.x - s.x, r.y - s.y);
      if (d <= range && d < best) { best = d; target = r; }
    }
    if (target) target.hp -= def.attack * s.level;
  }

  // 수도 도달 판정 + 사망 처리
  const survivors = [];
  for (const r of nation.raiders) {
    if (r.hp <= 0) continue; // 터렛에 격파됨
    const distToCapital = Math.hypot(r.x - nation.capital.x, r.y - nation.capital.y);
    if (distToCapital <= 0.6) {
      nation.capitalHp = Math.max(0, nation.capitalHp - RAIDER.capitalDamage);
      continue; // 피해를 입히고 소멸
    }
    survivors.push(r);
  }
  nation.raiders = survivors;
}

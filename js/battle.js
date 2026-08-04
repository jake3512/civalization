// ============================================================
// battle.js — 실시간 습격 전투 시뮬레이션 (공격자 클라이언트 로컬 전용)
//
// 이 프로토타입에는 실시간 소켓 서버가 없으므로(Cloud Functions는
// 요청-응답 callable), 공격자가 방어자의 Firestore 스냅샷(구조물·영토·
// 병력 로스터·자원)을 그대로 가져와 브라우저에서 전투 전체를 시뮬레이션한다
// (클래시 오브 클랜이 오프라인 상대의 스냅샷을 상대로 싸우는 것과 같은 방식).
// 서버(functions/index.js의 submitRaidResult)는 이 전투를 재생하지 않고,
// 최종 결과(파괴율·약탈량)만 받아 방어자의 "현재" 자원 한도 내로 클램프해서
// 반영한다 — 그래서 이 파일은 functions/shared/에 복사하지 않는다.
//
// 방어자의 실제 구조물은 전투로 영구 파괴되지 않는다(다음 전투에서는 항상
// 원래 체력으로 다시 시작). 오직 자원만 영구적으로 약탈된다.
// ============================================================
import { STRUCTURES, UNITS, BATTLE, getStructureMaxHp } from './data.js';
import { tileKey, getTerritoryRadius } from './logic.js';

let nextEntityId = 1;

function footprintCenter(s) {
  const def = STRUCTURES[s.key];
  const [w, h] = def.footprint;
  return { x: s.x + (w - 1) / 2, y: s.y + (h - 1) / 2 };
}

function targetPos(t) {
  return { x: t.cx ?? t.x, y: t.cy ?? t.y };
}

function pickNearest(list, distFn) {
  let best = null, bestD = Infinity;
  for (const item of list) {
    const d = distFn(item);
    if (d < bestD) { bestD = d; best = item; }
  }
  return best;
}

function moveToward(u, target, speed, dt) {
  const dx = target.x - u.x, dy = target.y - u.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.0001 && speed > 0) {
    const step = Math.min(d, speed * dt);
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
  }
  return d;
}

/**
 * 방어자 스냅샷(js/game.js의 Nation#toJSON 결과)과 공격자가 고른 "공격 덱"
 * (unitKey -> 수량)으로 전투 세션을 만든다.
 */
export function createBattleSession(defenderSnapshot, attackerDeck) {
  nextEntityId = 1;
  const territorySet = new Set(defenderSnapshot.territory || []);

  const structures = (defenderSnapshot.structures || []).map(s => {
    const maxHp = getStructureMaxHp(s.key, s.level) || 1;
    const center = footprintCenter(s);
    return {
      uid: `st${nextEntityId++}`, type: 'structure', key: s.key, x: s.x, y: s.y, level: s.level,
      cx: center.x, cy: center.y, maxHp, hp: maxHp, alive: true, powered: true, cooldown: 0,
    };
  });

  // 방어 유닛은 로스터 수량만 저장돼 있어 좌표가 없다 — 터렛/방벽(없으면 수도)
  // 주변에 "상주 배치"된 것으로 간주하고 흩뿌려 배치한다.
  const anchorPool = structures.filter(s => s.key === 'wall' || STRUCTURES[s.key].category === 'turret');
  const capitalStruct = structures.find(s => s.key === 'capital');
  const defenders = [];
  const roster = (defenderSnapshot.units && defenderSnapshot.units.defense) || {};
  let anchorIdx = 0;
  for (const [unitKey, count] of Object.entries(roster)) {
    const unitDef = UNITS.defense[unitKey];
    if (!unitDef) continue;
    for (let i = 0; i < count; i++) {
      const anchor = anchorPool.length ? anchorPool[anchorIdx % anchorPool.length] : capitalStruct;
      anchorIdx++;
      const jitter = () => (Math.random() - 0.5) * 2.4;
      defenders.push({
        uid: `d${nextEntityId++}`, type: 'unit', side: 'defense', key: unitKey,
        x: (anchor ? anchor.cx : 0) + jitter(), y: (anchor ? anchor.cy : 0) + jitter(),
        hp: unitDef.hp, maxHp: unitDef.hp, alive: true, cooldown: 0, targetUid: null,
      });
    }
  }

  return {
    defenderId: defenderSnapshot.id,
    defenderName: defenderSnapshot.name,
    defenderResources: { ...(defenderSnapshot.resources || {}) },
    territorySet,
    structures,
    defenders,
    attackers: [],             // 실시간으로 소환되는 공격 유닛
    deck: { ...attackerDeck }, // 남은 배치 가능 수량 (unitKey -> count)
    deployedCounts: {},        // 실제로 배치한 수량 누계 (종료 후 공격자 로스터에서 차감)
    timeLeft: BATTLE.durationSec,
    elapsed: 0,
    ended: false,
    perfectVictory: false,
    log: [],
    result: null,
  };
}

/** 소환 가능 영역(Drop Zone): 방어자 영토 밖이면 어디든 가능. */
export function isDropAllowed(session, x, y) {
  return !session.territorySet.has(tileKey(Math.floor(x), Math.floor(y)));
}

export function deployUnit(session, unitKey, x, y) {
  if (session.ended) return { ok: false, error: '전투가 이미 종료되었습니다' };
  if ((session.deck[unitKey] || 0) <= 0) return { ok: false, error: '더 이상 배치할 유닛이 없습니다' };
  if (!isDropAllowed(session, x, y)) return { ok: false, error: '적 영토 안에는 소환할 수 없습니다' };
  const unitDef = UNITS.attack[unitKey];
  if (!unitDef) return { ok: false, error: '알 수 없는 유닛입니다' };

  session.deck[unitKey] -= 1;
  session.deployedCounts[unitKey] = (session.deployedCounts[unitKey] || 0) + 1;
  const entity = {
    uid: `a${nextEntityId++}`, type: 'unit', side: 'attack', key: unitKey,
    x, y, hp: unitDef.hp, maxHp: unitDef.hp, alive: true, cooldown: 0, targetUid: null,
  };
  session.attackers.push(entity);
  return { ok: true, entity };
}

function resolveTarget(session, uid) {
  if (!uid) return null;
  return session.structures.find(e => e.uid === uid) ||
    session.defenders.find(e => e.uid === uid) ||
    session.attackers.find(e => e.uid === uid) || null;
}

function applyDamage(session, target, amount) {
  if (!target || !target.alive || amount <= 0) return;
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp <= 0) {
    target.alive = false;
    const name = target.type === 'structure'
      ? (STRUCTURES[target.key]?.name || target.key)
      : (UNITS[target.side]?.[target.key]?.name || target.key);
    session.log.unshift(`${name} 파괴됨`);
    if (session.log.length > 24) session.log.length = 24;
  }
}

// ---------------- 공격 유닛 AI ----------------
function pickAttackerTarget(session, u, unitDef) {
  const structs = session.structures.filter(s => s.alive);
  const distTo = (e) => Math.hypot((e.cx ?? e.x) - u.x, (e.cy ?? e.y) - u.y);

  if (unitDef.targetPriority === 'flying_core') {
    const plants = structs.filter(s => s.key === 'power_plant');
    const pool = plants.length ? plants : structs.filter(s => s.key === 'capital');
    const t = pickNearest(pool.length ? pool : structs, distTo);
    if (t) return t;
  }
  if (unitDef.targetPriority === 'wall_suicide') {
    const walls = structs.filter(s => s.key === 'wall');
    if (walls.length) return pickNearest(walls, distTo);
  }
  if (unitDef.targetPriority === 'military') {
    const mil = structs.filter(s => s.key === 'wall' || STRUCTURES[s.key].category === 'turret');
    if (mil.length) return pickNearest(mil, distTo);
  }

  // 기본: 감지 범위 내 수비 유닛이 있으면 우선 대응(탱크 역할이 어그로를 끔),
  // 없으면 가장 가까운 구조물을 노린다.
  const detectRange = 3;
  const nearbyDefenders = session.defenders.filter(d => d.alive && distTo(d) <= detectRange);
  if (nearbyDefenders.length) {
    const tanks = nearbyDefenders.filter(d => UNITS.defense[d.key]?.role === 'tank');
    return pickNearest(tanks.length ? tanks : nearbyDefenders, distTo);
  }
  return pickNearest(structs, distTo);
}

function stepAttacker(session, u, dt) {
  const unitDef = UNITS.attack[u.key];
  let target = resolveTarget(session, u.targetUid);
  if (!target || !target.alive) {
    target = pickAttackerTarget(session, u, unitDef);
    u.targetUid = target ? target.uid : null;
  }
  if (!target) return; // 기지가 전멸해 더 때릴 게 없음

  const tp = targetPos(target);
  const d = Math.hypot(tp.x - u.x, tp.y - u.y);
  if (d > unitDef.range) {
    moveToward(u, tp, unitDef.speed, dt);
    return;
  }
  u.cooldown -= dt;
  if (u.cooldown > 0) return;
  u.cooldown = unitDef.atkInterval;

  if (unitDef.targetPriority === 'wall_suicide' && target.key === 'wall') {
    applyDamage(session, target, unitDef.power * (unitDef.suicideMul || 1));
    u.alive = false; u.hp = 0; // 방벽에 자폭
    return;
  }
  applyDamage(session, target, unitDef.power);
}

// ---------------- 수비 유닛 AI ----------------
function stepDefender(session, d, dt) {
  const unitDef = UNITS.defense[d.key];
  if (unitDef.role === 'repair') return stepRepairer(session, d, unitDef, dt);

  let target = resolveTarget(session, d.targetUid);
  if (!target || !target.alive) {
    target = pickNearest(session.attackers.filter(a => a.alive), (a) => Math.hypot(a.x - d.x, a.y - d.y));
    d.targetUid = target ? target.uid : null;
  }
  if (!target) return;

  const tp = targetPos(target);
  const dist = Math.hypot(tp.x - d.x, tp.y - d.y);
  if (dist > unitDef.range) {
    moveToward(d, tp, unitDef.speed, dt);
    return;
  }
  d.cooldown -= dt;
  if (d.cooldown > 0) return;
  d.cooldown = unitDef.atkInterval || 1;
  applyDamage(session, target, unitDef.power);
}

function stepRepairer(session, d, unitDef, dt) {
  let target = resolveTarget(session, d.targetUid);
  if (!target || !target.alive || target.hp >= target.maxHp) {
    target = pickNearest(
      session.structures.filter(s => s.alive && s.hp < s.maxHp && (s.key === 'wall' || STRUCTURES[s.key].category === 'turret')),
      (s) => Math.hypot(s.cx - d.x, s.cy - d.y),
    );
    d.targetUid = target ? target.uid : null;
  }
  if (!target) return;
  const tp = targetPos(target);
  const dist = Math.hypot(tp.x - d.x, tp.y - d.y);
  if (dist > unitDef.range) { moveToward(d, tp, unitDef.speed, dt); return; }
  target.hp = Math.min(target.maxHp, target.hp + unitDef.healRate * dt);
}

// ---------------- 전력망 (수도 영토 반경 + 살아있는 발전소) ----------------
function computePoweredCircles(session) {
  const circles = [];
  const capital = session.structures.find(s => s.key === 'capital' && s.alive);
  if (capital) {
    circles.push({ cx: capital.cx, cy: capital.cy, r: getTerritoryRadius('capital', capital.level) });
  }
  for (const s of session.structures) {
    if (s.key !== 'power_plant' || !s.alive) continue;
    const def = STRUCTURES.power_plant;
    circles.push({ cx: s.cx, cy: s.cy, r: def.powerRadius + (s.level - 1) });
  }
  return circles;
}
function isPowered(circles, s) {
  return circles.some(c => Math.hypot(s.cx - c.cx, s.cy - c.cy) <= c.r);
}

function stepTurret(session, s, poweredCircles, dt) {
  s.powered = isPowered(poweredCircles, s);
  if (!s.powered) return;
  const def = STRUCTURES[s.key];
  const range = def.range + (s.level - 1);
  const target = pickNearest(
    session.attackers.filter(a => a.alive && Math.hypot(a.x - s.cx, a.y - s.cy) <= range),
    (a) => Math.hypot(a.x - s.cx, a.y - s.cy),
  );
  if (!target) return;
  s.cooldown -= dt;
  if (s.cooldown > 0) return;
  s.cooldown = 1;
  applyDamage(session, target, def.attack * s.level);
}

// ---------------- 파괴율 / 종료 ----------------
export function getDestructionPercent(session) {
  const total = session.structures.reduce((sum, s) => sum + s.maxHp, 0) || 1;
  const destroyed = session.structures.reduce((sum, s) => sum + (s.alive ? 0 : s.maxHp), 0);
  return destroyed / total;
}

function noMoreActions(session) {
  const deckEmpty = Object.values(session.deck).every(c => c <= 0);
  const noneAlive = session.attackers.every(u => !u.alive);
  return deckEmpty && noneAlive && session.attackers.length > 0;
}

export function endBattle(session) {
  if (session.ended) return session;
  session.ended = true;
  session.timeLeft = 0;
  const destructionPercent = getDestructionPercent(session);
  const win = session.perfectVictory || destructionPercent >= BATTLE.winDestructionPct;
  const lootMul = session.perfectVictory ? BATTLE.perfectVictoryLootMul : 1;
  const lootFraction = Math.min(1, destructionPercent * BATTLE.lootRatePerHp * lootMul);
  const loot = {};
  for (const [res, amt] of Object.entries(session.defenderResources || {})) {
    const take = Math.floor(amt * lootFraction);
    if (take > 0) loot[res] = take;
  }
  session.result = {
    win, destructionPercent, perfectVictory: session.perfectVictory, loot,
    deployedUnits: { ...session.deployedCounts },
  };
  return session;
}

/** 전투를 dt(초)만큼 진행시킨다. requestAnimationFrame 루프에서 매 프레임 호출. */
export function stepBattle(session, dt) {
  if (session.ended) return session;
  session.elapsed += dt;
  session.timeLeft = Math.max(0, BATTLE.durationSec - session.elapsed);

  const poweredCircles = computePoweredCircles(session);

  for (const u of session.attackers) if (u.alive) stepAttacker(session, u, dt);
  for (const d of session.defenders) if (d.alive) stepDefender(session, d, dt);
  for (const s of session.structures) if (s.alive && STRUCTURES[s.key].category === 'turret') stepTurret(session, s, poweredCircles, dt);

  const capital = session.structures.find(s => s.key === 'capital');
  if (capital && !capital.alive) session.perfectVictory = true;

  if (session.perfectVictory || session.timeLeft <= 0 || noMoreActions(session)) {
    endBattle(session);
  }
  return session;
}

/** 유저가 직접 전투를 조기 종료(퇴각)할 때. */
export function retreat(session) {
  return endBattle(session);
}

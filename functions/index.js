// ============================================================
// functions/index.js — 서버 권위(server-authoritative) 로직
//
// 클라이언트는 여기 정의된 callable 함수를 "요청"하기만 하고,
// 실제 자원 차감/구조물 배치/전투 판정은 전부 여기(서버)에서
// functions/shared/{data,world,logic,simulate,game}.js
// (js/ 폴더의 동일한 파일을 그대로 복사한 것)를 이용해 재계산합니다.
//
// ⚠️ shared/ 폴더는 루트 js/ 폴더와 내용이 동일해야 합니다.
//    게임 규칙(data.js/logic.js/simulate.js)을 수정했다면 반드시
//    이 폴더에도 다시 복사해주세요. (빌드 도구 없는 프로토타입이라
//    수동 동기화 — 실서비스로 키울 때는 공용 npm 패키지로 분리 권장)
// ============================================================
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';

import { Nation, createNation } from './shared/game.js';
import {
  canAttack, applyRaidResult, sellFromStorage, nearestCapital,
  manualMoveToStorage, manualMoveToStructure, manualMoveBetweenStorages, manualOperate,
} from './shared/logic.js';
import { regionKeyOf } from './shared/regionUtil.js';
import { LOGISTICS, MIN_CAPITAL_DISTANCE } from './shared/data.js';

setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 });

initializeApp();
const db = getFirestore();
// Nation#toJSON에는 값이 비어 있는 필드가 섞인다 (창고가 아닌 구조물의 store,
// 벨트가 아닌 구조물의 dir 등). Admin SDK도 undefined를 만나면 쓰기를 통째로
// 거부하므로, 무시하도록 설정해 둔다 — 이걸 빠뜨리면 모든 저장이 실패한다.
db.settings({ ignoreUndefinedProperties: true });

// ---------------- 헬퍼 ----------------
function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다');
  return uid;
}

async function loadNation(uid) {
  const doc = await db.collection('nations').doc(uid).get();
  if (!doc.exists) return null;
  return Nation.fromJSON(doc.data());
}

async function saveNation(uid, nation) {
  const data = nation.toJSON();
  data.region = regionKeyOf(nation.capital.x, nation.capital.y);
  data.updatedAt = Date.now();
  await db.collection('nations').doc(uid).set(data);
}

// ---------------- 국가 생성 ----------------
export const submitInitNation = onCall(async (request) => {
  const uid = requireAuth(request);
  const existing = await db.collection('nations').doc(uid).get();
  if (existing.exists) return { ok: true, existed: true };

  const { name, color, x, y } = request.data || {};
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new HttpsError('invalid-argument', '좌표가 필요합니다');
  }
  const safeName = (name || '이름없는 국가').toString().slice(0, 16);

  // 다른 플레이어의 수도와 최소 거리를 서버에서도 확인한다 (영토가 겹치면
  // 서로의 자원 노드를 빼앗고 건설 자리가 막힌다)
  const all = await db.collection('nations').get();
  const others = [];
  all.forEach(d => { if (d.id !== uid && d.data()?.capital) others.push(d.data()); });
  const near = nearestCapital(Math.round(x), Math.round(y), others);
  if (near && near.dist < MIN_CAPITAL_DISTANCE) {
    return { error: `${near.name || '다른 국가'}의 수도와 너무 가깝습니다 `
      + `(${Math.round(near.dist)}칸 / 최소 ${MIN_CAPITAL_DISTANCE}칸)` };
  }

  let nation;
  try {
    // 수도 입지 요건(주변 영토에 숲·채석장)을 서버에서도 다시 검증한다
    nation = createNation(uid, safeName, color || '#d98e34', Math.round(x), Math.round(y));
  } catch (e) {
    return { error: e.message || '이 위치에는 수도를 세울 수 없습니다' };
  }
  await saveNation(uid, nation);
  return { ok: true, existed: false };
});

// ---------------- 건설 / 업그레이드 / 레시피 / 연구 ----------------
export const submitBuild = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structKey, x, y, dir } = request.data || {};
  const err = nation.build(structKey, x, y, dir || 0);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

export const submitUpgrade = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structId } = request.data || {};
  const err = nation.upgrade(structId);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

export const submitSetRecipe = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structId, recipeKey } = request.data || {};
  const err = nation.setRecipe(structId, recipeKey);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

export const submitStartResearch = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structKey } = request.data || {};
  const err = nation.startResearch(structKey);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

export const submitRecruitUnit = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structId, unitKey, isDefense } = request.data || {};
  const err = nation.recruitUnit(structId, unitKey, !!isDefense);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

export const submitDemolish = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structId } = request.data || {};
  const err = nation.demolish(structId);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

export const submitRotate = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structId, dir } = request.data || {};
  const err = nation.rotateStructure(structId, dir);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

// ---------------- 농사 · 목축 · 여행 · 판매 ----------------
export const submitSetCrop = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structId, cropKey } = request.data || {};
  const err = nation.setCrop(structId, cropKey);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

export const submitSetAnimal = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structId, animalKey } = request.data || {};
  const err = nation.setAnimal(structId, animalKey);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

export const submitStartExpedition = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { key } = request.data || {};
  const err = nation.startExpedition(key);
  if (err) return { error: err };
  await saveNation(uid, nation);
  return { ok: true };
});

export const submitSell = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { res, amount } = request.data || {};
  const out = sellFromStorage(nation, res, Number(amount) || 0);
  if (!out.ok) return { error: out.error };
  await saveNation(uid, nation);
  return { ok: true, sold: out.sold, earned: out.earned };
});

// ---------------- 수동 조작 (컨베이어·전력이 없을 때 손으로 옮기고 손으로 돌린다) ----------------
export const submitManualMove = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { mode, structId, toId, res, amount } = request.data || {};
  const amt = Math.min(Number(amount) || LOGISTICS.manualTransfer, LOGISTICS.manualTransfer);
  let out;
  if (mode === 'out') out = manualMoveToStorage(nation, structId, res, amt);
  else if (mode === 'in') out = manualMoveToStructure(nation, structId, res, amt);
  else if (mode === 'between') out = manualMoveBetweenStorages(nation, structId, toId, res, amt);
  else return { error: '알 수 없는 이송 방식' };
  if (!out.ok) return { error: out.error };
  await saveNation(uid, nation);
  return { ok: true, moved: out.moved };
});

// 수동 운용은 버튼을 누르고 있는 동안 0.6초마다 1사이클씩 도는데, 그때마다 서버를
// 호출하면 너무 잦다. 클라이언트가 버튼을 뗄 때 "몇 사이클 돌렸는지"만 보내고
// 서버는 그 횟수만큼 다시 계산한다 (경과 시간으로 상한을 둬서 조작을 막는다).
export const submitManualOperate = onCall(async (request) => {
  const uid = requireAuth(request);
  const nation = await loadNation(uid);
  if (!nation) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');
  const { structId, cycles, heldMs } = request.data || {};
  const allowed = Math.floor((Number(heldMs) || 0) / LOGISTICS.manualOperateMs) + 1;
  const n = Math.max(0, Math.min(Number(cycles) || 0, allowed, 200));
  const produced = {};
  for (let i = 0; i < n; i++) {
    const out = manualOperate(nation, structId);
    if (!out.ok) break; // 인벤토리가 차거나 재료가 떨어지면 거기서 멈춘다
    for (const [r, a] of Object.entries(out.produced || {})) produced[r] = (produced[r] || 0) + a;
  }
  await saveNation(uid, nation);
  return { ok: true, produced };
});

// ---------------- 전투 (실시간 습격은 공격자 클라이언트가 로컬로 시뮬레이션하고,
// 여기서는 그 결과(파괴율·약탈량)만 검증 후 반영한다 — js/battle.js 참고) ----------------
export const submitRaidResult = onCall(async (request) => {
  const uid = requireAuth(request);
  const { defenderId, raidResult } = request.data || {};
  if (!defenderId || !raidResult) throw new HttpsError('invalid-argument', '공격 대상과 전투 결과가 필요합니다');

  const attacker = await loadNation(uid);
  const defender = await loadNation(defenderId);
  if (!attacker || !defender) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');

  const blockReason = canAttack(attacker, defender);
  if (blockReason) return { error: blockReason };

  const result = applyRaidResult(attacker, defender, raidResult);

  await saveNation(uid, attacker);
  await saveNation(defenderId, defender);
  await db.collection('battles').add({
    attackerId: uid, attackerName: attacker.name,
    defenderId, defenderName: defender.name,
    destructionPercent: result.destructionPercent,
    win: result.win, trophyDelta: result.attackerTrophyDelta,
    timestamp: Date.now(),
  });

  return { win: result.win, destructionPercent: result.destructionPercent, trophyDelta: result.attackerTrophyDelta };
});

// ---------------- 주기적 생산 틱 (서버 권위) ----------------
// 모든 국가의 채굴/생산/벨트물류/전력/연구진행/습격을 서버에서 계산한다.
// 클라이언트는 이 결과를 onSnapshot으로 구독하기만 한다.
export const productionTick = onSchedule('every 1 minutes', async () => {
  const snap = await db.collection('nations').get();
  const batchPromises = [];
  for (const doc of snap.docs) {
    const nation = Nation.fromJSON(doc.data());
    nation.tick();
    batchPromises.push(saveNation(doc.id, nation));
  }
  await Promise.all(batchPromises);
});

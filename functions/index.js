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
import { canAttack, applyAttackResult } from './shared/logic.js';
import { regionKeyOf } from './shared/regionUtil.js';

setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 });

initializeApp();
const db = getFirestore();

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
  const nation = createNation(uid, safeName, color || '#d98e34', Math.round(x), Math.round(y));
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

// ---------------- 전투 (실드 검사 + 트로피/보호막 갱신 포함) ----------------
export const submitAttack = onCall(async (request) => {
  const uid = requireAuth(request);
  const { defenderId } = request.data || {};
  if (!defenderId) throw new HttpsError('invalid-argument', '공격 대상이 필요합니다');

  const attacker = await loadNation(uid);
  const defender = await loadNation(defenderId);
  if (!attacker || !defender) throw new HttpsError('not-found', '국가를 찾을 수 없습니다');

  const blockReason = canAttack(attacker, defender);
  if (blockReason) return { error: blockReason };

  const result = applyAttackResult(attacker, defender);

  await saveNation(uid, attacker);
  await saveNation(defenderId, defender);
  await db.collection('battles').add({
    attackerId: uid, attackerName: attacker.name,
    defenderId, defenderName: defender.name,
    attackPower: result.attackPower, defenderPower: result.defenderPower,
    win: result.win, trophyDelta: result.attackerTrophyDelta,
    timestamp: Date.now(),
  });

  return { win: result.win, trophyDelta: result.attackerTrophyDelta };
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

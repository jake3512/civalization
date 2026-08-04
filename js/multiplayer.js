// ============================================================
// multiplayer.js — Firestore/Cloud Functions 연동
//
// 서버 권위(server-authoritative) 구조:
//   - 클라이언트는 자원/전투 결과를 직접 계산해 쓰지 않는다.
//   - 건설/업그레이드/레시피/연구/전투는 전부 Cloud Functions(callable)를
//     호출해서 "요청"만 보내고, 서버가 검증·계산한 뒤 Firestore를 갱신한다.
//   - 클라이언트는 onSnapshot으로 내 국가 문서를 구독해 서버가 계산한
//     결과를 그대로 반영한다 (game.serverAuthoritative = true).
//   - 자원 생산 틱 자체도 Cloud Functions의 예약 함수(productionTick)가
//     서버에서 주기적으로 실행한다 (functions/index.js 참고).
//
// Firestore 컬렉션:
//   nations/{uid}   공개 국가 상태 (region 필드로 지역 버킷 태깅)
//   battles/{id}    전투 로그
// ============================================================
import { FIREBASE_CONFIG, FIREBASE_ENABLED } from './firebase-config.js';

let app, db, auth, functionsInstance, uid = null;
let fx = {};        // firestore 함수 모음
let authFx = {};    // auth 함수 모음
let fnFx = {};       // functions 함수 모음

// 지역(region) 버킷 크기 — geohash 대신 쓰는 간단한 격자 버킷.
// 실서비스로 키울 경우 ngeohash 같은 라이브러리로 교체 가능 (README 참고).
const REGION_SIZE = 100;
export function regionKey(x, y) { return `${Math.floor(x / REGION_SIZE)}_${Math.floor(y / REGION_SIZE)}`; }
function neighborRegions(x, y) {
  const cx = Math.floor(x / REGION_SIZE), cy = Math.floor(y / REGION_SIZE);
  const keys = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) keys.push(`${cx + dx}_${cy + dy}`);
  return keys; // 최대 9개 (Firestore 'in' 쿼리는 최대 10개까지 지원)
}

export async function initFirebase() {
  if (!FIREBASE_ENABLED) {
    console.warn('[multiplayer] Firebase 설정이 비어있어 로컬 모드로 실행됩니다. js/firebase-config.js 를 채워주세요.');
    return false;
  }
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const firestore = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const functionsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');

    app = initializeApp(FIREBASE_CONFIG);
    db = firestore.getFirestore(app);
    auth = authMod.getAuth(app);
    functionsInstance = functionsMod.getFunctions(app);
    fx = firestore; authFx = authMod; fnFx = functionsMod;

    await authFx.signInAnonymously(auth);
    await new Promise((resolve, reject) => {
      const unsub = authFx.onAuthStateChanged(auth, (user) => {
        if (user) { uid = user.uid; unsub(); resolve(); }
      }, reject);
    });
    return true;
  } catch (e) {
    console.warn('[multiplayer] Firebase 연결 실패, 로컬 모드로 전환합니다.', e);
    return false;
  }
}

export function getUid() { return uid; }
export function isMultiplayer() { return FIREBASE_ENABLED && !!uid; }

// ---------------- Cloud Functions 호출 (건설/업그레이드/연구/전투) ----------------
async function callFn(name, data) {
  if (!isMultiplayer()) return { error: '멀티플레이어(Firebase)가 연결되지 않았습니다.' };
  try {
    const fn = fnFx.httpsCallable(functionsInstance, name);
    const result = await fn(data);
    return result.data;
  } catch (e) {
    return { error: e.message || '서버 요청에 실패했습니다.' };
  }
}

export const callInitNation = (name, color, x, y) => callFn('submitInitNation', { name, color, x, y });
export const callBuild = (structKey, x, y, dir) => callFn('submitBuild', { structKey, x, y, dir });
export const callUpgrade = (structId) => callFn('submitUpgrade', { structId });
export const callSetRecipe = (structId, recipeKey) => callFn('submitSetRecipe', { structId, recipeKey });
export const callStartResearch = (structKey) => callFn('submitStartResearch', { structKey });
export const callRecruitUnit = (structId, unitKey, isDefense) => callFn('submitRecruitUnit', { structId, unitKey, isDefense });
export const callAttack = (defenderId) => callFn('submitAttack', { defenderId });

// ---------------- Firestore 구독 ----------------

// 내 국가 문서 실시간 구독 — 서버가 계산한 결과가 여기로 흘러들어온다.
export function watchMyNation(onChange) {
  if (!isMultiplayer()) return () => {};
  const ref = fx.doc(db, 'nations', uid);
  return fx.onSnapshot(ref, (snap) => onChange(snap.exists() ? snap.data() : null));
}

// 주변 지역(region) 버킷에 속한 다른 국가만 구독 (전체 컬렉션 구독 대신 쿼리 축소)
export function watchNations(capital, onChange) {
  if (!isMultiplayer()) return () => {};
  const regions = neighborRegions(capital.x, capital.y);
  const q = fx.query(fx.collection(db, 'nations'), fx.where('region', 'in', regions));
  return fx.onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => { if (d.id !== uid) list.push(d.data()); });
    onChange(list);
  });
}

// 나와 관련된 전투 로그 구독
export function watchBattles(onChange) {
  if (!isMultiplayer()) return () => {};
  const colRef = fx.collection(db, 'battles');
  return fx.onSnapshot(colRef, (snap) => {
    const list = [];
    snap.forEach((d) => {
      const b = d.data();
      if (b.attackerId === uid || b.defenderId === uid) list.push(b);
    });
    list.sort((a, b) => b.timestamp - a.timestamp);
    onChange(list.slice(0, 30));
  });
}

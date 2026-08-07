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
// 리디렉트 방식으로 로그인하고 돌아왔을 때의 결과 (initFirebase가 채운다)
let lastRedirect = null;
export function takeRedirectResult() { const r = lastRedirect; lastRedirect = null; return r; }
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

// 여러 곳(로그인 화면·상대 목록 미리 받기·전투 연결)에서 부르므로 한 번만
// 실제로 초기화하고 그 결과를 공유한다. initializeApp을 두 번 부르면 터진다.
let initPromise = null;
export function initFirebase() {
  if (!initPromise) initPromise = _initFirebase();
  return initPromise;
}

async function _initFirebase() {
  if (!FIREBASE_ENABLED) {
    console.warn('[multiplayer] Firebase 설정이 비어있어 로컬 모드로 실행됩니다. js/firebase-config.js 를 채워주세요.');
    return { ok: false, reason: 'config', message: 'js/firebase-config.js가 비어 있습니다' };
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

    // 구글 로그인을 리디렉트로 했다면 돌아온 지금 그 결과를 받아야 한다.
    // (팝업이 막히는 모바일에서 이 경로를 탄다)
    try {
      const redirect = await authFx.getRedirectResult(auth);
      if (redirect && redirect.user) lastRedirect = { ok: true, user: redirect.user };
    } catch (e) {
      lastRedirect = authError(e);
      console.warn('[multiplayer] 리디렉트 로그인 실패:', e);
    }

    // 이미 로그인돼 있으면(브라우저에 세션이 남아 있으면) 그 계정을 그대로 쓴다.
    // 여기서 무조건 익명 로그인을 부르면, 이메일로 로그인해 둔 세션을 새 익명
    // 계정으로 갈아엎어 버려서 "이어서 하기"가 매번 깨진다.
    const existing = await new Promise((resolve, reject) => {
      const unsub = authFx.onAuthStateChanged(auth, (user) => { unsub(); resolve(user); }, reject);
    });
    if (existing) {
      uid = existing.uid;
    } else {
      const anon = await authFx.signInAnonymously(auth);
      uid = anon.user.uid;
    }
    return { ok: true, uid, user: currentUser() };
  } catch (e) {
    // 왜 안 됐는지가 중요하다. 예전에는 전부 "로컬 모드"로 뭉뚱그려서, 콘솔을
    // 열어보기 전에는 무엇을 고쳐야 하는지 알 수 없었다.
    const code = (e && (e.code || '')) + '';
    const msg = (e && e.message) || '';
    let reason = 'unknown', message = msg || '알 수 없는 오류';
    if (/Failed to fetch|dynamically imported module|NetworkError|importing/i.test(msg)) {
      reason = 'sdk';
      message = 'Firebase SDK를 내려받지 못했습니다 (네트워크 차단 또는 오프라인)';
    } else if (code.includes('auth/operation-not-allowed') || /operation-not-allowed/i.test(msg)) {
      reason = 'auth-disabled';
      message = 'Firebase 콘솔에서 익명 로그인(Anonymous)을 켜야 합니다';
    } else if (code.includes('auth/configuration-not-found') || /configuration-not-found/i.test(msg)) {
      // 프로젝트에서 Authentication을 한 번도 켠 적이 없을 때 나온다
      reason = 'auth-missing';
      message = 'Firebase 콘솔 → Authentication을 "시작하기"로 켜고 익명 로그인을 활성화하세요';
    } else if (code.includes('auth/')) {
      reason = 'auth';
      message = `로그인 실패 (${code})`;
    }
    console.warn('[multiplayer] Firebase 연결 실패:', reason, e);
    return { ok: false, reason, message };
  }
}

export function getUid() { return uid; }
export function isMultiplayer() { return FIREBASE_ENABLED && !!uid; }

// ============================================================
// 로그인 (계정)
//
// 기본은 익명 로그인이다 — 아무것도 묻지 않고 바로 플레이할 수 있어야 하니까.
// 다만 익명 계정은 **그 브라우저에만** 남아서, 폰에서 하던 판을 PC에서 이어받을
// 수 없다. 그래서 이메일/비밀번호 계정을 붙일 수 있게 한다.
//
// 핵심은 "연결(link)"이다. 익명으로 하던 판에 계정을 붙이면 **uid가 그대로
// 유지되므로**, 세워둔 나라도 나에게 온 습격도 그대로 따라온다. 새 계정을
// 만들어 갈아타면 uid가 바뀌어 남남이 된다.
// ============================================================

/** 지금 로그인한 사용자 정보 (없으면 null) */
export function currentUser() {
  const u = auth && auth.currentUser;
  if (!u) return null;
  return { uid: u.uid, email: u.email || null, anonymous: !!u.isAnonymous };
}

/** 로그인 상태가 바뀔 때마다 호출된다 (탭을 새로 열었을 때 복원 포함) */
export function onUserChanged(cb) {
  if (!auth || !authFx.onAuthStateChanged) return () => {};
  return authFx.onAuthStateChanged(auth, (u) => {
    uid = u ? u.uid : null;
    cb(currentUser());
  });
}

/** Firebase 오류 코드를 사람이 읽을 수 있는 문장으로 */
function authError(e) {
  const code = ((e && e.code) || '').replace('auth/', '');
  const table = {
    'invalid-email': '이메일 형식이 올바르지 않습니다',
    'missing-password': '비밀번호를 입력해주세요',
    'weak-password': '비밀번호는 6자 이상이어야 합니다',
    'email-already-in-use': '이미 가입된 이메일입니다 — 로그인해주세요',
    'invalid-credential': '이메일 또는 비밀번호가 맞지 않습니다',
    'wrong-password': '비밀번호가 맞지 않습니다',
    'user-not-found': '가입되지 않은 이메일입니다',
    'too-many-requests': '시도가 너무 잦습니다 — 잠시 뒤 다시 해주세요',
    'network-request-failed': '네트워크에 연결하지 못했습니다',
    'operation-not-allowed': 'Firebase 콘솔에서 이메일/비밀번호 로그인을 켜야 합니다',
    'configuration-not-found': 'Firebase 콘솔에서 Authentication을 먼저 켜야 합니다',
    'credential-already-in-use': '그 계정은 이미 다른 나라에 연결돼 있습니다 — 로그인해서 이어가세요',
    'provider-already-linked': '이미 계정이 연결돼 있습니다',
    'popup-blocked': '팝업이 차단됐습니다 — 다시 눌러주세요 (창 대신 페이지 이동으로 진행합니다)',
    'popup-closed-by-user': '로그인 창이 닫혔습니다',
    'account-exists-with-different-credential': '같은 이메일로 이미 다른 방식(이메일/비밀번호)의 계정이 있습니다',
    // 배포 주소가 Firebase에 등록돼 있지 않으면 구글 로그인이 아예 시작되지 않는다
    'unauthorized-domain': `이 주소(${typeof location !== 'undefined' ? location.hostname : ''})가 Firebase에 등록돼 있지 않습니다`
      + ' — 콘솔 → Authentication → Settings → 승인된 도메인에 추가하세요',
  };
  return { ok: false, code, error: table[code] || (e && e.message) || '로그인에 실패했습니다' };
}

/** 이메일/비밀번호로 로그인 */
export async function signIn(email, password) {
  if (!auth) return { ok: false, error: '온라인에 연결되지 않았습니다' };
  try {
    const cred = await authFx.signInWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;
    return { ok: true, user: currentUser() };
  } catch (e) { return authError(e); }
}

/**
 * 계정 만들기.
 * 지금 익명으로 플레이 중이면 **그 계정에 이메일을 붙인다**(link) — uid가
 * 유지되므로 하던 나라를 그대로 들고 간다. 익명 상태가 아니면 새로 가입한다.
 */
export async function signUp(email, password) {
  if (!auth) return { ok: false, error: '온라인에 연결되지 않았습니다' };
  try {
    const u = auth.currentUser;
    if (u && u.isAnonymous && authFx.EmailAuthProvider && authFx.linkWithCredential) {
      const cred = authFx.EmailAuthProvider.credential(email, password);
      const res = await authFx.linkWithCredential(u, cred);
      uid = res.user.uid;
      return { ok: true, linked: true, user: currentUser() };
    }
    const res = await authFx.createUserWithEmailAndPassword(auth, email, password);
    uid = res.user.uid;
    return { ok: true, linked: false, user: currentUser() };
  } catch (e) { return authError(e); }
}

/**
 * 구글 계정으로 로그인.
 *
 * 익명으로 플레이 중이면 **그 계정에 구글을 연결(link)** 한다 — uid가 유지되므로
 * 하던 나라를 그대로 들고 간다. 이미 그 구글 계정으로 만든 나라가 있으면
 * (credential-already-in-use) 연결 대신 그 계정으로 갈아탄다.
 *
 * 팝업이 기본이지만 모바일 브라우저에서는 자주 막힌다. 막히면 리디렉트로
 * 넘어가고, 돌아왔을 때 initFirebase가 getRedirectResult로 결과를 받는다.
 */
export async function signInWithGoogle({ preferRedirect = false } = {}) {
  if (!auth || !authFx.GoogleAuthProvider) return { ok: false, error: '온라인에 연결되지 않았습니다' };
  const provider = new authFx.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const u = auth.currentUser;
  const linking = !!(u && u.isAnonymous);

  const goRedirect = async () => {
    // 리디렉트로 나갔다가 돌아오는 동안 게임이 새로 뜨므로, 진행 중이던 저장은
    // 이미 localStorage에 있다 (돌아오면 이어하기 카드로 뜬다).
    if (linking) await authFx.linkWithRedirect(u, provider);
    else await authFx.signInWithRedirect(auth, provider);
    return { ok: true, redirecting: true };
  };

  if (preferRedirect) {
    try { return await goRedirect(); } catch (e) { return authError(e); }
  }

  try {
    const res = linking
      ? await authFx.linkWithPopup(u, provider)
      : await authFx.signInWithPopup(auth, provider);
    uid = res.user.uid;
    return { ok: true, linked: linking, user: currentUser() };
  } catch (e) {
    const code = ((e && e.code) || '');
    // 팝업 자체가 불가능한 환경 → 리디렉트로 다시 시도
    if (/popup-blocked|operation-not-supported-in-this-environment|web-storage-unsupported/.test(code)) {
      try { return await goRedirect(); } catch (e2) { return authError(e2); }
    }
    // 사용자가 창을 닫은 것은 오류가 아니다
    if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(code)) {
      return { ok: false, cancelled: true, error: '로그인 창이 닫혔습니다' };
    }
    // 팝업/리디렉트 창을 여는 데 실패하면 SDK가 internal-error로 뭉뚱그린다.
    // 실제 원인은 대개 "이 주소가 승인된 도메인이 아니다"이거나 네트워크 차단이다.
    if (code.includes('internal-error')) {
      const host = typeof location !== 'undefined' ? location.hostname : '';
      return {
        ok: false, code: 'internal-error',
        error: `구글 로그인 창을 열지 못했습니다. 이 주소(${host})가 Firebase 콘솔 →`
          + ' Authentication → Settings → 승인된 도메인에 등록돼 있는지 확인해주세요',
      };
    }
    // 그 구글 계정에 이미 다른 나라가 붙어 있다 → 연결 말고 그 계정으로 로그인
    if (code.includes('credential-already-in-use') || code.includes('email-already-in-use')) {
      const cred = authFx.GoogleAuthProvider.credentialFromError
        ? authFx.GoogleAuthProvider.credentialFromError(e) : null;
      if (cred && authFx.signInWithCredential) {
        try {
          const res = await authFx.signInWithCredential(auth, cred);
          uid = res.user.uid;
          return { ok: true, switched: true, user: currentUser() };
        } catch (e2) { return authError(e2); }
      }
    }
    return authError(e);
  }
}

/** 로그아웃하고 다시 익명 상태로 돌아간다 (게스트 플레이는 계속 가능) */
export async function signOutUser() {
  if (!auth) return { ok: false, error: '온라인에 연결되지 않았습니다' };
  try {
    await authFx.signOut(auth);
    const anon = await authFx.signInAnonymously(auth);
    uid = anon.user.uid;
    return { ok: true, user: currentUser() };
  } catch (e) { return authError(e); }
}

/**
 * Firestore 핸들을 그대로 넘겨준다 (mpNet.js의 firestore 백엔드용).
 * SDK를 두 번 import하지 않도록 여기서 만든 것을 공유한다.
 */
export function getFirestoreHandles() {
  return uid && db ? { fx, db } : null;
}

// ---------------- Cloud Functions 호출 (건설/업그레이드/연구/전투) ----------------
/**
 * Cloud Functions 호출.
 *
 * 실패했을 때 SDK가 주는 message는 사람이 읽으라고 만든 문자열이 아니다 —
 * 함수가 배포돼 있지 않거나 닿지 않으면 message가 그냥 **"internal"**이다.
 * 예전에는 그걸 그대로 화면에 띄워서, 건물을 지을 때마다 "internal"이라는
 * 정체불명의 오류만 보였다. 이제 사유를 풀어 쓰고, "서버가 없는 것 같다"는
 * 판단(serverMissing)을 함께 돌려준다 — 호출한 쪽에서 로컬 판정으로
 * 내려갈 수 있도록.
 */
async function callFn(name, data) {
  if (!isMultiplayer()) {
    return { error: '멀티플레이어(Firebase)가 연결되지 않았습니다.', serverMissing: true };
  }
  try {
    const fn = fnFx.httpsCallable(functionsInstance, name);
    const result = await fn(data);
    return result.data;
  } catch (e) {
    const code = ((e && e.code) || '').replace('functions/', '');
    const raw = (e && e.message) || '';
    // 함수가 없거나(미배포) 네트워크가 막힌 경우
    const missing = ['internal', 'not-found', 'unavailable', 'deadline-exceeded']
      .includes(code || raw);
    const error = missing
      ? `Cloud Functions에 닿지 못했습니다 (${code || raw}) — 배포되지 않았을 수 있습니다`
      : (raw || '서버 요청에 실패했습니다.');
    console.warn(`[multiplayer] ${name} 실패:`, code || raw, e);
    return { error, serverMissing: missing };
  }
}

export const callInitNation = (name, color, x, y) => callFn('submitInitNation', { name, color, x, y });
export const callBuild = (structKey, x, y, dir) => callFn('submitBuild', { structKey, x, y, dir });
export const callUpgrade = (structId) => callFn('submitUpgrade', { structId });
export const callSetRecipe = (structId, recipeKey) => callFn('submitSetRecipe', { structId, recipeKey });
export const callStartResearch = (structKey) => callFn('submitStartResearch', { structKey });
export const callRecruitUnit = (structId, unitKey, isDefense) => callFn('submitRecruitUnit', { structId, unitKey, isDefense });
export const callRaidResult = (defenderId, raidResult) => callFn('submitRaidResult', { defenderId, raidResult });
export const callRotate = (structId, dir) => callFn('submitRotate', { structId, dir });
export const callDemolish = (structId) => callFn('submitDemolish', { structId });
export const callSetCrop = (structId, cropKey) => callFn('submitSetCrop', { structId, cropKey });
export const callSetAnimal = (structId, animalKey) => callFn('submitSetAnimal', { structId, animalKey });
export const callStartExpedition = (key) => callFn('submitStartExpedition', { key });
export const callSell = (res, amount) => callFn('submitSell', { res, amount });
export const callManualMove = (mode, structId, res, amount, toId) => callFn('submitManualMove', { mode, structId, res, amount, toId });
export const callManualOperate = (structId, cycles, heldMs) => callFn('submitManualOperate', { structId, cycles, heldMs });

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

// ============================================================
// multiplayer.js — Firestore를 이용한 국가 상태 동기화 및 전쟁
//
// 구조 (Firestore 컬렉션):
//   nations/{uid}         공개 국가 정보 (이름, 색, 수도, 영토, 구조물, 자원 요약)
//   battles/{battleId}    전투 요청/결과 로그
//
// ⚠️ 프로토타입 수준 설계입니다. 클라이언트가 자기 자신의 자원/전투력을
//    그대로 신뢰하여 기록하므로, 실서비스로 확장할 경우 Cloud Functions로
//    이동시켜 서버 권위(server-authoritative) 검증을 추가해야 합니다.
//    (README의 "다음 단계" 참고)
// ============================================================
import { FIREBASE_CONFIG, FIREBASE_ENABLED } from './firebase-config.js';

let app, db, auth, uid = null;
let fx = {}; // firestore 함수 모음 (동적 import 결과 보관)

export async function initFirebase() {
  if (!FIREBASE_ENABLED) {
    console.warn('[multiplayer] Firebase 설정이 비어있어 로컬 모드로 실행됩니다. js/firebase-config.js 를 채워주세요.');
    return false;
  }
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const firestore = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const authMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');

  app = initializeApp(FIREBASE_CONFIG);
  db = firestore.getFirestore(app);
  auth = authMod.getAuth(app);
  fx = { ...firestore, ...authMod };

  await fx.signInAnonymously(auth);
  await new Promise((resolve) => {
    const unsub = fx.onAuthStateChanged(auth, (user) => {
      if (user) { uid = user.uid; unsub(); resolve(); }
    });
  });
  return true;
}

export function getUid() { return uid; }
export function isMultiplayer() { return FIREBASE_ENABLED && !!uid; }

// 내 국가 상태를 Firestore에 업로드 (주기적으로 호출)
export async function pushNation(nation) {
  if (!isMultiplayer()) return;
  const ref = fx.doc(db, 'nations', uid);
  await fx.setDoc(ref, { ...nation.toJSON(), updatedAt: Date.now() });
}

// 다른 모든 국가의 실시간 변경 구독
export function watchNations(onChange) {
  if (!isMultiplayer()) return () => {};
  const colRef = fx.collection(db, 'nations');
  return fx.onSnapshot(colRef, (snap) => {
    const list = [];
    snap.forEach((d) => { if (d.id !== uid) list.push(d.data()); });
    onChange(list);
  });
}

// 공격 요청 전송 — battles 컬렉션에 기록하고, 간단한 전투력 비교로 즉시 결과 산출
export async function sendAttack({ attacker, defenderId, defenderPower, attackPower }) {
  if (!isMultiplayer()) return { error: '멀티플레이어(Firebase)가 연결되지 않았습니다.' };
  const win = attackPower >= defenderPower;
  const battle = {
    attackerId: uid,
    attackerName: attacker.name,
    defenderId,
    attackPower,
    defenderPower,
    result: win ? 'attacker' : 'defender',
    timestamp: Date.now(),
  };
  const ref = fx.doc(fx.collection(db, 'battles'));
  await fx.setDoc(ref, battle);
  return { battle };
}

// 나와 관련된 전투 로그 구독 (공격자 or 수비자)
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

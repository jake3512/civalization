// ============================================================
// mpNet.js — 전투용 멀티플레이 전송 계층
//
// 왜 필요한가:
//   전투 규칙(battle.js)과 습격 반영(logic.js)은 이미 있었지만, 실제로
//   **상대를 만날 방법**이 없었다. 상대 목록은 Cloud Functions가 배포된
//   경우에만 채워졌고(FUNCTIONS_DEPLOYED=false), 그래서 전쟁 패널은 늘
//   "아직 발견된 다른 국가가 없습니다"였다. 이 파일이 그 구멍을 메운다.
//
// 세 가지 백엔드를 같은 인터페이스로 감싼다:
//
//   local      같은 브라우저의 다른 탭이 곧 다른 플레이어.
//              localStorage + BroadcastChannel만 쓰므로 서버가 필요 없다.
//              오프라인에서도 대전이 되고, 자동 테스트도 이 모드로 돌린다.
//   firestore  Cloud Functions 없이 Firestore만으로 도는 모드. 클라이언트가
//              자기 국가 스냅샷을 직접 올리고, 습격 리포트를 상대 앞으로 남긴다.
//   functions  Cloud Functions가 배포된 서버 권위 모드 (기존 경로).
//
// 비동기 습격 모델(클래시 오브 클랜과 같다):
//   상대가 접속해 있지 않아도 공격할 수 있다. 공격자는 상대의 **스냅샷**을
//   내려받아 자기 브라우저에서 전투를 돌리고, 결과를 "습격 리포트"로 남긴다.
//   방어자는 다음에 접속했을 때 그 리포트를 받아 자기 상태에 반영하고,
//   리플레이로 어떻게 뚫렸는지 다시 볼 수 있다.
//
// 신뢰 경계:
//   local/firestore 모드에는 심판이 없다. 방어자 클라이언트가 스스로
//   logic.applyRaidToDefender로 리포트를 검증한다 — 파괴율에서 승패를 다시
//   계산하고, 트로피 변동을 규칙 범위로 자르고, 약탈은 지금 가진 재고와
//   파괴율이 허용하는 몫까지만 빠진다. 그래도 조작을 완전히 막을 수는 없으므로,
//   랭킹이 걸린 운영 환경에서는 functions 모드(서버 권위)를 쓴다.
// ============================================================
import { FIREBASE_ENABLED, FUNCTIONS_DEPLOYED } from './firebase-config.js';

export const NET_MODE = {
  LOCAL: 'local',
  FIRESTORE: 'firestore',
  FUNCTIONS: 'functions',
};

/**
 * 어떤 백엔드를 쓸지 결정한다 (배포 상태에 따라 자동).
 *
 * 주소에 ?mp=local / ?mp=firestore 를 붙이면 강제로 고를 수 있다.
 * 온라인이 켜져 있으면 **같은 브라우저의 두 탭은 익명 로그인 uid가 같아서**
 * 서로를 같은 국가로 본다 — 한 기기에서 둘이 붙어보려면 ?mp=local 이 필요하다.
 */
export function pickMode(search = (typeof location !== 'undefined' ? location.search : '')) {
  const forced = new URLSearchParams(search || '').get('mp');
  if (forced === NET_MODE.LOCAL) return NET_MODE.LOCAL;
  if (forced === NET_MODE.FIRESTORE && FIREBASE_ENABLED) return NET_MODE.FIRESTORE;
  if (FUNCTIONS_DEPLOYED && FIREBASE_ENABLED) return NET_MODE.FUNCTIONS;
  if (FIREBASE_ENABLED) return NET_MODE.FIRESTORE;
  return NET_MODE.LOCAL;
}

export const MODE_LABEL = {
  [NET_MODE.LOCAL]: '로컬 대전 (같은 기기의 다른 탭)',
  [NET_MODE.FIRESTORE]: '온라인 대전 (Firestore 직결)',
  [NET_MODE.FUNCTIONS]: '온라인 대전 (서버 권위)',
};

// 상대는 **접속해 있지 않아도 공격할 수 있다** (클래시 오브 클랜과 같은 비동기 습격).
// 그래서 목록에서 지우는 기준은 "지금 접속 중인가"가 아니라 "이 기지가 아직
// 살아 있는가"다. 아주 오래 방치된 국가만 정리한다.
const PEER_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30일
// 이 시간 안에 소식이 있었으면 "접속 중"으로 표시한다 (공개 주기 15초의 4배)
export const ONLINE_WINDOW_MS = 60 * 1000;
export function isPeerOnline(peer, now = Date.now()) {
  return now - (peer?.updatedAt || 0) < ONLINE_WINDOW_MS;
}
// 내 스냅샷을 다시 올리는 주기
export const PUBLISH_INTERVAL_MS = 15 * 1000;

// ============================================================
// local 백엔드 — localStorage + BroadcastChannel
// 같은 기기에서 탭을 두 개 열면 서로 상대가 된다.
// ============================================================
const LS_PEERS = 'civ:mp:peers';
const LS_RAIDS = 'civ:mp:raids';
const CHANNEL = 'civ:mp';

function lsRead(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function lsWrite(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch { /* 용량 초과는 무시 */ }
}

class LocalNet {
  constructor(myId) {
    this.myId = myId;
    this.mode = NET_MODE.LOCAL;
    this.onPeers = null;
    this.onRaid = null;
    // BroadcastChannel이 없는 환경(구형 브라우저)에서는 storage 이벤트로 대체된다
    this.ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
    if (this.ch) this.ch.onmessage = (e) => this._onMessage(e.data);
    this._storageHandler = (e) => {
      if (e.key === LS_PEERS) this._emitPeers();
      if (e.key === LS_RAIDS) this._emitRaids();
    };
    if (typeof window !== 'undefined') window.addEventListener('storage', this._storageHandler);
  }

  _onMessage(msg) {
    if (!msg || msg.from === this.myId) return;
    if (msg.type === 'peers') this._emitPeers();
    if (msg.type === 'raid') this._emitRaids();
  }

  _broadcast(type) {
    if (this.ch) this.ch.postMessage({ type, from: this.myId });
  }

  _emitPeers() {
    if (!this.onPeers) return;
    const now = Date.now();
    const all = lsRead(LS_PEERS);
    const list = Object.values(all)
      .filter(p => p && p.id !== this.myId && now - (p.updatedAt || 0) < PEER_TTL_MS);
    this.onPeers(list);
  }

  _emitRaids() {
    if (!this.onRaid) return;
    const all = lsRead(LS_RAIDS);
    for (const report of Object.values(all)) {
      if (report && report.defenderId === this.myId) this.onRaid(report);
    }
  }

  async publish(snapshot) {
    const all = lsRead(LS_PEERS);
    all[snapshot.id] = { ...snapshot, updatedAt: Date.now() };
    // 오래된 기록은 정리한다 (localStorage 용량은 보통 5MB뿐이다)
    const now = Date.now();
    for (const [id, p] of Object.entries(all)) {
      if (now - (p.updatedAt || 0) > PEER_TTL_MS) delete all[id];
    }
    lsWrite(LS_PEERS, all);
    this._broadcast('peers');
    this._emitPeers();
  }

  async sendRaid(report) {
    const all = lsRead(LS_RAIDS);
    all[report.id] = report;
    // 최근 60건만 남긴다
    const ids = Object.keys(all).sort((a, b) => (all[a].timestamp || 0) - (all[b].timestamp || 0));
    for (const id of ids.slice(0, Math.max(0, ids.length - 60))) delete all[id];
    lsWrite(LS_RAIDS, all);
    this._broadcast('raid');
    return { ok: true };
  }

  watchPeers(cb) { this.onPeers = cb; this._emitPeers(); }
  watchRaids(cb) { this.onRaid = cb; this._emitRaids(); }

  close() {
    if (this.ch) this.ch.close();
    if (typeof window !== 'undefined') window.removeEventListener('storage', this._storageHandler);
  }
}

// ============================================================
// firestore 백엔드 — Cloud Functions 없이 Firestore만으로
//   nations/{uid}  국가 공개 스냅샷 (본인만 쓰기 가능하도록 보안 규칙 필요)
//   raids/{id}     습격 리포트 (defenderId로 조회)
// ============================================================
class FirestoreNet {
  constructor(myId, fx, db) {
    this.myId = myId;
    this.mode = NET_MODE.FIRESTORE;
    this.fx = fx;
    this.db = db;
    this.unsubs = [];
  }

  async publish(snapshot) {
    const ref = this.fx.doc(this.db, 'nations', this.myId);
    await this.fx.setDoc(ref, { ...snapshot, updatedAt: Date.now() }, { merge: true });
  }

  async sendRaid(report) {
    const ref = this.fx.doc(this.db, 'raids', report.id);
    await this.fx.setDoc(ref, report);
    return { ok: true };
  }

  watchPeers(cb) {
    const q = this.fx.query(this.fx.collection(this.db, 'nations'));
    this.unsubs.push(this.fx.onSnapshot(q, (snap) => {
      const now = Date.now();
      const list = [];
      snap.forEach(d => {
        const p = d.data();
        if (p.id !== this.myId && now - (p.updatedAt || 0) < PEER_TTL_MS) list.push(p);
      });
      cb(list);
    }));
  }

  watchRaids(cb) {
    const q = this.fx.query(
      this.fx.collection(this.db, 'raids'),
      this.fx.where('defenderId', '==', this.myId),
    );
    this.unsubs.push(this.fx.onSnapshot(q, (snap) => {
      snap.forEach(d => cb(d.data()));
    }));
  }

  close() { for (const u of this.unsubs) u(); this.unsubs = []; }
}

/**
 * 백엔드를 만든다. firestore 모드는 multiplayer.js가 이미 초기화해 둔
 * Firestore 핸들을 넘겨받는다 (SDK를 두 번 불러오지 않도록).
 */
export function createNet(mode, myId, firestoreHandles = null) {
  if (mode === NET_MODE.FIRESTORE && firestoreHandles?.fx && firestoreHandles?.db) {
    return new FirestoreNet(myId, firestoreHandles.fx, firestoreHandles.db);
  }
  return new LocalNet(myId);
}

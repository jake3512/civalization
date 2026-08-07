// ============================================================
// cloudSave.js — 계정에 붙는 저장 (Firestore)
//
// storage.js는 이 브라우저 안(localStorage)에만 저장한다. 그래서 폰에서 하던
// 판을 PC에서 이어받을 수 없다. 로그인한 계정에는 서버에도 한 벌 올려두고,
// 어디서 접속하든 그 계정의 마지막 상태를 내려받아 이어서 하게 한다.
//
//   saves/{uid}   내 저장 (본인만 읽고 쓴다 — firestore.rules 참고)
//
// 크기 줄이기:
//   영토(타일 수천 개)는 담지 않는다. 수도·중심지의 위치와 레벨에서 다시
//   만들어지는 값이라(logic.territoryFromStructures) 실어 보낼 이유가 없다.
//   전투 기록은 리플레이(그때의 기지 배치)까지 들어 있어 무거우므로 최근
//   3건만 올린다. Firestore 문서 한도는 1MB다.
// ============================================================
import { territoryFromStructures } from './logic.js';

const MAX_CLOUD_REPORTS = 3;

/**
 * Firestore는 값이 `undefined`인 필드를 만나면 **문서 전체를 거부한다**
 * ("Unsupported field value: undefined"). localStorage는 JSON.stringify가
 * 조용히 빼주기 때문에 로컬 저장만 되고 클라우드 저장은 실패했다.
 *
 * 구조물에는 상황에 따라 비어 있는 칸이 있다 — 창고가 아닌 구조물의 `store`,
 * 벨트가 아닌 구조물의 `dir`, 전초기지가 아닌 구조물의 `recruitQueue` 등.
 * 여기서 JSON 왕복으로 그런 필드를 전부 털어낸다.
 */
function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 클라우드로 보낼 페이로드를 만든다 (영토 제거 · 전투 기록 축약 · undefined 제거) */
function packSave(nation, extra = {}) {
  const data = nation.toJSON();
  delete data.territory;          // 구조물에서 다시 만든다
  const raids = extra.raids || {};
  return stripUndefined({
    v: 1,
    savedAt: Date.now(),
    nation: data,
    raids: {
      defense: (raids.defense || []).slice(0, MAX_CLOUD_REPORTS),
      attack: (raids.attack || []).slice(0, MAX_CLOUD_REPORTS),
    },
  });
}

// Firestore 문서 한도는 1MiB다. 여유를 두고 이 크기를 넘으면 전투 기록부터 버린다
// (리플레이에 그때의 기지 배치가 통째로 들어 있어 가장 무겁다).
const MAX_DOC_BYTES = 900 * 1024;

/** 내려받은 저장을 게임이 쓰는 형태로 되돌린다 (영토 복원) */
export function unpackSave(data) {
  if (!data || !data.nation) return null;
  const n = data.nation;
  if (!n.territory || !n.territory.length) {
    n.territory = Array.from(territoryFromStructures(n.structures || []));
  }
  return data;
}

/**
 * 클라우드에 저장한다. 실패해도 게임은 계속돼야 하므로 예외를 삼키고
 * 결과만 알려준다 (로컬 저장이 이미 되어 있다).
 */
export async function saveToCloud(handles, uid, nation, extra = {}) {
  if (!handles?.fx || !handles?.db || !uid || !nation) return { ok: false, error: '연결 없음' };
  let payload = packSave(nation, extra);

  // 너무 크면 전투 기록(리플레이)을 버리고 나라만이라도 저장한다
  if (JSON.stringify(payload).length > MAX_DOC_BYTES) {
    payload = { ...payload, raids: { defense: [], attack: [] } };
  }
  const bytes = JSON.stringify(payload).length;
  if (bytes > MAX_DOC_BYTES) {
    return { ok: false, error: `저장이 너무 큽니다 (${Math.round(bytes / 1024)}KB) — 이 기기에만 저장됩니다` };
  }

  try {
    const ref = handles.fx.doc(handles.db, 'saves', uid);
    await handles.fx.setDoc(ref, payload);
    return { ok: true };
  } catch (e) {
    const msg = e?.message || '';
    const code = e?.code || '';
    // 무엇이 문제인지 이름을 붙여준다 — 예전에는 SDK 메시지를 그대로 흘려서
    // "클라우드 저장 실패: Function setDoc() called with invalid data..."만 떴다
    let error = msg || '클라우드 저장 실패';
    if (/permission|insufficient/i.test(msg) || code === 'permission-denied') {
      error = '서버가 저장을 거부했습니다 — firestore.rules를 다시 배포해주세요';
    } else if (/undefined|invalid data/i.test(msg)) {
      error = '저장 데이터에 빈 값이 섞였습니다 (버그) — 이 기기에는 정상 저장됩니다';
    } else if (/exceeds the maximum allowed size|too large/i.test(msg)) {
      error = '저장이 서버 한도를 넘었습니다 — 이 기기에만 저장됩니다';
    } else if (/unauthenticated|not authenticated/i.test(msg) || code === 'unauthenticated') {
      error = '로그인이 풀렸습니다 — 다시 로그인해주세요';
    } else if (/offline|unavailable|network/i.test(msg) || code === 'unavailable') {
      error = '네트워크에 닿지 못했습니다 — 연결되면 다시 시도합니다';
    }
    console.warn('[cloudSave] 저장 실패:', code, msg);
    return { ok: false, error, code };
  }
}

/** 클라우드에서 내 저장을 가져온다 (없으면 null) */
export async function loadFromCloud(handles, uid) {
  if (!handles?.fx || !handles?.db || !uid) return null;
  try {
    const snap = await handles.fx.getDoc(handles.fx.doc(handles.db, 'saves', uid));
    if (!snap.exists()) return null;
    return unpackSave(snap.data());
  } catch (e) {
    console.warn('[cloudSave] 불러오기 실패:', e);
    return null;
  }
}

/** 계정에서 저장을 지운다 */
export async function clearCloud(handles, uid) {
  if (!handles?.fx || !handles?.db || !uid) return;
  try {
    await handles.fx.deleteDoc(handles.fx.doc(handles.db, 'saves', uid));
  } catch (e) { console.warn('[cloudSave] 삭제 실패:', e); }
}

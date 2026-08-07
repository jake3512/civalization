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

/** 클라우드로 보낼 페이로드를 만든다 (영토 제거 · 전투 기록 축약) */
function packSave(nation, extra = {}) {
  const data = nation.toJSON();
  delete data.territory;          // 구조물에서 다시 만든다
  const raids = extra.raids || {};
  return {
    v: 1,
    savedAt: Date.now(),
    nation: data,
    raids: {
      defense: (raids.defense || []).slice(0, MAX_CLOUD_REPORTS),
      attack: (raids.attack || []).slice(0, MAX_CLOUD_REPORTS),
    },
  };
}

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
  try {
    const ref = handles.fx.doc(handles.db, 'saves', uid);
    await handles.fx.setDoc(ref, packSave(nation, extra));
    return { ok: true };
  } catch (e) {
    const denied = /permission|insufficient/i.test(e?.message || '');
    return {
      ok: false,
      error: denied
        ? '서버가 저장을 거부했습니다 — firestore.rules를 다시 배포해주세요'
        : (e?.message || '클라우드 저장 실패'),
    };
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

// ============================================================
// storage.js — 게임 상태 저장/불러오기 (localStorage)
//
// 지금까지는 새로고침하면 나라가 통째로 사라졌다. 최종 테크까지 5시간짜리
// 게임에서 그건 사실상 못 쓰는 상태라, 브라우저에 상태를 저장한다.
//
// 무엇을 저장하는가:
//   Nation#toJSON() 하나면 충분하다 — 구조물(레벨·보관함·레시피·작물·방향),
//   영토, 국고, 해금, 연구, 여행, 트로피/실드, 병력, 습격 기록까지 전부
//   그 안에 들어 있다. 지도는 시드로 즉석 생성하므로 저장할 필요가 없다.
//
// 언제 저장하는가 (main.js):
//   · 몇 틱마다 한 번 (계속 쓰면 큰 문서를 자주 직렬화하게 된다)
//   · 탭을 닫거나 숨길 때 (pagehide / visibilitychange)
//   · 전투·철거처럼 되돌릴 수 없는 일이 끝난 직후
//
// 자리를 비운 동안의 생산은 **누적되지 않는다**. 저장된 그 시점 그대로
// 이어진다 (플레이 타임 목표를 시계가 아니라 실제 플레이로 재기 때문).
// ============================================================

// 저장은 국가 id별로 나눠 담는다. 같은 브라우저의 다른 탭이 곧 다른 플레이어인
// (전투 멀티플레이 local 모드) 구조라, 슬롯이 하나뿐이면 두 탭이 서로의 저장을
// 덮어쓴다. 최근 것 몇 개만 남기고 오래된 것은 버린다.
const SAVE_KEY = 'civ:saves';
const MAX_SAVES = 3;
// 저장 형식이 바뀌어 예전 저장이 그대로 살아나면 안 될 때 올린다.
// 숫자가 다르면 불러오지 않고 새 게임으로 시작한다 (조용히 깨지는 것보다 낫다).
const SAVE_VERSION = 1;

/** 저장 가능한 환경인가 (사생활 보호 모드 등에서 localStorage가 막히기도 한다) */
export function storageAvailable() {
  try {
    localStorage.setItem('civ:probe', '1');
    localStorage.removeItem('civ:probe');
    return true;
  } catch { return false; }
}

/** 저장 묶음 전체를 읽는다 ({ [국가id]: payload }) */
function readAll() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return {}; }
  if (!raw) return {};
  try {
    const all = JSON.parse(raw);
    return (all && typeof all === 'object') ? all : {};
  } catch { return {}; }
}

function writeAll(all) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(all));
}

/** 저장이 쓸 만한 형태인지 (형식 버전이 다르거나 깨졌으면 버린다) */
function isValid(data) {
  return !!data && data.v === SAVE_VERSION
    && !!data.nation && !!data.nation.capital && Array.isArray(data.nation.structures);
}

/**
 * 저장. 성공하면 { ok: true }, 실패하면 { ok: false, error }.
 * 용량 초과(QuotaExceededError)는 흔한 실패라 따로 알려준다.
 */
export function saveGame(nation, extra = {}) {
  if (!nation) return { ok: false, error: '저장할 국가가 없습니다' };
  const payload = { v: SAVE_VERSION, savedAt: Date.now(), nation: nation.toJSON(), ...extra };
  const all = readAll();
  all[nation.id] = payload;

  // 최근 것 MAX_SAVES개만 남긴다
  const ids = Object.keys(all).sort((a, b) => (all[b]?.savedAt || 0) - (all[a]?.savedAt || 0));
  for (const id of ids.slice(MAX_SAVES)) delete all[id];

  try {
    writeAll(all);
    return { ok: true };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    if (quota) {
      // 자리를 만들어 한 번 더 시도한다 — 내 저장만 남기고 나머지를 버린다
      try { writeAll({ [nation.id]: payload }); return { ok: true, pruned: true }; } catch { /* 아래로 */ }
    }
    return { ok: false, error: quota ? '브라우저 저장 공간이 가득 찼습니다' : (e.message || '저장 실패') };
  }
}

/**
 * 불러오기. id를 주면 그 국가를, 안 주면 가장 최근 저장을 준다.
 * 저장이 없거나, 형식이 다르거나, 깨졌으면 null이다
 * (반쯤 복원된 상태로 시작하는 것보다 새로 시작하는 편이 안전하다).
 */
export function loadGame(id = null) {
  const all = readAll();
  if (id) return isValid(all[id]) ? all[id] : null;
  const list = Object.values(all).filter(isValid).sort((a, b) => b.savedAt - a.savedAt);
  return list[0] || null;
}

/** 저장 목록 요약 — "이어하기" 카드에 뿌릴 정보만 뽑는다 (최근 것 먼저) */
export function listSaves() {
  return Object.values(readAll()).filter(isValid)
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(data => {
      const n = data.nation;
      const capital = (n.structures || []).find(s => s.key === 'capital');
      return {
        id: n.id,
        name: n.name,
        color: n.color,
        capitalLevel: capital ? capital.level : 1,
        structures: (n.structures || []).length,
        unlocked: (n.unlocked || []).length,
        trophies: n.trophies || 0,
        savedAt: data.savedAt,
      };
    });
}

/** 가장 최근 저장 하나의 요약 */
export function saveSummary() { return listSaves()[0] || null; }

export function hasSave() { return listSaves().length > 0; }

/** id를 주면 그 저장만, 안 주면 전부 지운다 */
export function clearSave(id = null) {
  try {
    if (!id) { localStorage.removeItem(SAVE_KEY); return; }
    const all = readAll();
    delete all[id];
    writeAll(all);
  } catch { /* 무시 */ }
}

/** "3분 전" 같은 사람이 읽는 시각 */
export function timeAgo(ts, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return '방금 전';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.round(hr / 24)}일 전`;
}

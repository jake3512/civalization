// ============================================================
// main.js — UI 배선. 키보드 없는 터치 기기를 기본으로 가정하고 만들었다:
//   - 지도 이동: 한 손가락 드래그 (마우스 드래그도 동일하게 동작)
//   - 확대/축소: 두 손가락 핀치, 또는 우측 하단 [+][-] 버튼 (휠도 지원)
//   - 탭(드래그가 아닌 짧은 터치): 건설/선택
//   - 벨트 회전 · 전력범위 표시: 화면 우측 하단 버튼 (R/P 키보드도 병행 지원)
// ============================================================
import { STRUCTURES, RESOURCES, STATUS_ICONS, TECH_TREE, DIR_ARROW, DIR_VECT, WAR, UNITS, TERRAIN_NODES, CAPITAL_REQUIRED_NODES, structureIcon,
         LOGISTICS, getStorageCapacity, getOutputCapacity, getUpgradeCost, getStructureMaxHp, beltThroughput,
         CROPS, ANIMALS, EXPEDITIONS, getSellPrice, unitIcon, VIRTUAL_RESOURCES } from './data.js';
import { Game, Nation } from './game.js';
import { Renderer } from './render.js';
import { BattleRenderer } from './battleRender.js';
import { createBattleSession, createReplaySession, deployUnit, stepBattle, stepReplay,
         retreat as retreatBattle, getDestructionPercent } from './battle.js';
import { getTile } from './world.js';
import { findMatch, isShielded, getDefensePower, capitalSiteReport, validatePlacement, findCapitalSites, findNearestCapitalSite,
         storedTotal, totalStock, manualMoveToStorage, manualMoveToStructure, manualOperate, getTerritoryRadius, getCapitalLevel,
         hasGood, sellFromStorage, buriedNodes, canDemolish,
         defenseSnapshot, buildRaidReport, applyRaidToAttacker, applyRaidToDefender, canAttack } from './logic.js';
import { isBeltKey, isRotatable, BUILD_GROUPS, buildGroupOf } from './data.js';
import { FUNCTIONS_DEPLOYED } from './firebase-config.js';
import { createNet, pickMode, NET_MODE, MODE_LABEL, PUBLISH_INTERVAL_MS } from './mpNet.js';
import { saveGame, loadGame, listSaves, clearSave, storageAvailable, timeAgo } from './storage.js';
import {
  initFirebase, isMultiplayer, watchNations, watchBattles, watchMyNation, getFirestoreHandles, getUid, regionKey,
  callInitNation, callBuild, callUpgrade, callSetRecipe, callStartResearch, callRecruitUnit, callRaidResult,
  callSetCrop, callSetAnimal, callStartExpedition, callSell, callManualMove, callManualOperate, callDemolish, callRotate,
} from './multiplayer.js';

const game = new Game();

// 오프라인(로컬)에서는 logic.js를 그대로 부르고, 서버 권위 모드에서는 같은 판정을
// Cloud Functions에 맡긴다. 두 경로가 같은 코드(functions/shared)를 쓰기 때문에
// 결과는 동일하고, 여기서는 "어디서 계산할지"만 고른다.
const onServer = () => game.serverAuthoritative;
/** 로컬에서 먼저 판정해 UI를 즉시 갱신하고, 서버 모드면 서버 결과로 덮어쓴다. */
async function dispatch(localFn, serverFn) {
  if (onServer()) return await serverFn();
  return localFn();
}
const canvas = document.getElementById('field');
const renderer = new Renderer(canvas, game);

const battleCanvas = document.getElementById('battle-field');
const battleRenderer = new BattleRenderer(battleCanvas);

// 다른 플레이어가 정한 문자열(국가 이름·색)은 그대로 innerHTML에 넣으면 안 된다.
// 멀티플레이가 붙은 뒤로 화면에 남의 입력이 섞이므로 여기서 한 번 걸러 쓴다.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeColor = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? c : '#888888');
/** 자원 이름만 뽑아 쓰는 헬퍼 (아이콘 태그를 못 쓰는 자리 — flashMessage 등) */
const resNames = (obj) => Object.entries(obj || {})
  .map(([r, a]) => `${RESOURCES[r]?.name || r} ${a}`).join(', ');

// 자원/상태 아이콘을 <img> 태그로 뽑아주는 헬퍼 (이모지 대신 assets/icons/*.svg 사용)
const resIcon = (key) => `<img class="ic" src="${RESOURCES[key]?.icon || ''}" alt="${RESOURCES[key]?.name || key}">`;
const statusIcon = (key) => `<img class="ic" src="${STATUS_ICONS[key]}" alt="${key}">`;
const unitArtIcon = (key, cls = 'uic') => `<img class="${cls}" src="${unitIcon(key)}" alt="">`;

// 한 번이라도 손에 넣어 본 자원 — 상단 표시줄을 고정 순서로 유지하기 위해 기억한다
const seenResources = new Set();
let selectedStruct = null;   // 현재 건설 모드로 선택된 구조물 key
let beltDir = 0;              // 벨트 건설 시 방향 (회전 버튼 / R키)
let pendingNation = null;     // { name, color } — 수도 위치를 아직 못 고른 상태
let selectedCapital = null;   // { x, y } — 탭으로 고른 수도 후보 위치

// ---------- 1단계: 국가 이름/색 ----------
const startScreen = document.getElementById('start-screen');
document.getElementById('start-btn').addEventListener('click', () => {
  const name = document.getElementById('nation-name').value.trim() || '이름없는 국가';
  const color = document.getElementById('nation-color').value;
  pendingNation = { name, color };

  startScreen.classList.add('hidden');
  document.getElementById('placement-bar').classList.remove('hidden');
  updatePlacementBar(); // 입지 요건 안내를 처음부터 보여준다
  renderer.centerOn(0, 0);
  requestAnimationFrame(loop); // 국가 생성 전이라도 지도는 바로 보여준다
});

// ---------- 2단계: 지도를 탭해서 수도 위치 선택 ----------
function updatePlacementBar() {
  const bar = document.getElementById('placement-text');
  const confirmBtn = document.getElementById('placement-confirm');
  if (!selectedCapital) {
    bar.innerHTML = `지도를 움직여 수도를 세울 칸을 탭하세요 — 주변 영토에 ${CAPITAL_REQUIRED_NODES.map(k => TERRAIN_NODES[k].name).join('·')}이 있어야 합니다`;
    confirmBtn.disabled = true;
    return;
  }
  const site = capitalSiteReport(selectedCapital.x, selectedCapital.y);
  if (site.ok) {
    bar.innerHTML = `<b style="color:var(--teal)">건설 가능</b> (${selectedCapital.x}, ${selectedCapital.y}) — ${CAPITAL_REQUIRED_NODES.map(k => `${resIcon(TERRAIN_NODES[k].yields)}${TERRAIN_NODES[k].name}`).join(' ')} 확보`;
    confirmBtn.disabled = false;
  } else {
    const names = site.missing.map(k => TERRAIN_NODES[k].name).join(', ');
    bar.innerHTML = `<b style="color:var(--danger)">${names} 없음</b> — 다른 곳을 탭해 ${names}이(가) 영토에 들어오는 자리를 찾아보세요`;
    confirmBtn.disabled = true;
  }
}

// 조건을 만족하는 칸이 전체의 7% 정도라 직접 찾기 번거로우므로,
// 현재 화면 중앙에서 가장 가까운 유효 자리로 카메라를 옮겨주고 바로 선택해준다.
document.getElementById('placement-suggest').addEventListener('click', () => {
  const cx = Math.round(renderer.originX + canvas.width / renderer.tile / 2);
  const cy = Math.round(renderer.originY + canvas.height / renderer.tile / 2);
  const site = findNearestCapitalSite(cx, cy);
  if (!site) { flashMessage('주변에서 조건을 만족하는 자리를 찾지 못했습니다', true); return; }
  renderer.centerOn(site.x + 1, site.y + 1);
  selectedCapital = { x: site.x, y: site.y };
  const report = capitalSiteReport(site.x, site.y);
  renderer.placementMarker = { x: site.x, y: site.y, ok: report.ok, radius: report.radius };
  updatePlacementBar();
});

document.getElementById('placement-confirm').addEventListener('click', () => {
  if (!selectedCapital || !pendingNation) return;
  const { x, y } = selectedCapital;
  const { name, color } = pendingNation;

  // 버튼이 비활성화돼 있어 정상 흐름에선 실패하지 않지만, 만에 하나 요건을
  // 만족하지 않으면 수도 없는 국가가 만들어지므로 여기서도 막는다.
  if (!capitalSiteReport(x, y).ok) { updatePlacementBar(); return; }

  game.startNation(name, color, x, y);
  renderer.placementMarker = null;
  document.getElementById('placement-bar').classList.add('hidden');
  enterGame();

  pendingNation = null;
  selectedCapital = null;
});

/**
 * 국가가 준비된 뒤 게임 화면으로 들어가는 공통 경로.
 * 새로 세운 국가와 저장에서 불러온 국가가 같은 길을 타야 화면 상태가 어긋나지 않는다.
 */
function enterGame() {
  const n = game.myNation;
  document.getElementById('touch-toolbar').classList.remove('hidden');

  buildBuildMenu();
  renderTravelPanel();
  game.onTick = () => { renderTravelPanel(); autoSave(); };
  game.startLoop();
  initMultiplayer(n.name, n.color, n.capital.x, n.capital.y);
  autoSave(true);
}

// ---------- 저장 / 이어하기 ----------
// 최종 테크까지 5시간짜리 게임이라, 새로고침 한 번에 나라가 사라지면 안 된다.
let lastSaveAt = 0;
const SAVE_EVERY_MS = 10_000;

/** 일정 시간마다 저장한다 (force=true면 즉시) */
function autoSave(force = false) {
  if (!game.myNation) return;
  const now = Date.now();
  if (!force && now - lastSaveAt < SAVE_EVERY_MS) return;
  lastSaveAt = now;
  // 전투 기록도 함께 남긴다 — 새로고침했다고 "누가 나를 털었는지"가 사라지면 안 된다.
  // 리플레이 기록(기지 배치)까지 들어 있어 크기가 있으므로 최근 것 몇 개만 남긴다.
  const res = saveGame(game.myNation, {
    raids: { defense: defenseReports.slice(0, 5), attack: attackReports.slice(0, 5) },
  });
  if (!res.ok && !autoSave._warned) {
    autoSave._warned = true;   // 매 틱 경고를 띄우면 게임을 못 한다 — 한 번만 알린다
    flashMessage(`자동 저장 실패: ${res.error}`, true);
  }
}

// 탭을 닫거나 다른 앱으로 넘어갈 때는 마지막 상태를 반드시 남긴다
// (모바일에서는 pagehide만 오고 unload는 오지 않는 경우가 있다)
window.addEventListener('pagehide', () => autoSave(true));
window.addEventListener('visibilitychange', () => { if (document.hidden) autoSave(true); });

/** 시작 화면에 "이어하기" 카드를 그린다 */
function renderResumeBox() {
  const box = document.getElementById('resume-box');
  if (!box) return;
  if (!storageAvailable()) {
    box.classList.remove('hidden');
    box.innerHTML = `<div class="resume-warn">이 브라우저는 저장을 쓸 수 없습니다(사생활 보호 모드 등).
      새로고침하면 진행이 사라집니다.</div>`;
    return;
  }
  const saves = listSaves();
  if (!saves.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = saves.map(s => `
    <div class="resume-card">
      <div class="resume-head">
        <span class="dot" style="background:${safeColor(s.color)}"></span>
        <span class="nm">${esc(s.name)}</span>
        <span class="when">${timeAgo(s.savedAt)} 저장</span>
      </div>
      <div class="resume-meta">수도 Lv.${s.capitalLevel} · 구조물 ${s.structures}동 · 해금 ${s.unlocked}종
        · ${statusIcon('trophy')}${s.trophies}</div>
      <div class="resume-actions">
        <button class="resume-btn" data-resume="${esc(s.id)}">이어하기</button>
        <button class="discard-btn" data-discard="${esc(s.id)}">지우기</button>
      </div>
    </div>`).join('')
    + `<div class="resume-hint">저장된 그 시점 그대로 이어집니다 — 자리를 비운 동안 생산은 진행되지 않습니다.
        아래에서 새 국가를 세우면 별도로 저장됩니다.</div>`;

  box.querySelectorAll('[data-resume]').forEach(b =>
    b.addEventListener('click', () => resumeSavedGame(b.dataset.resume)));
  box.querySelectorAll('[data-discard]').forEach(b =>
    b.addEventListener('click', () => {
      clearSave(b.dataset.discard);
      renderResumeBox();
      flashMessage('저장된 국가를 지웠습니다', false);
    }));
}

function resumeSavedGame(id = null) {
  const data = loadGame(id);
  if (!data) { flashMessage('저장을 불러오지 못했습니다', true); renderResumeBox(); return; }
  game.myNation = Nation.fromJSON(data.nation);
  defenseReports = (data.raids && data.raids.defense) || [];
  attackReports = (data.raids && data.raids.attack) || [];

  startScreen.classList.add('hidden');
  const cap = game.myNation.capital;
  renderer.centerOn(cap.x + 1, cap.y + 1);
  requestAnimationFrame(loop);
  enterGame();
  flashMessage(`${game.myNation.name} 이어하기 — ${timeAgo(data.savedAt)} 저장된 상태입니다`, false);
}

renderResumeBox();

async function initMultiplayer(name, color, cx, cy) {
  const statusEl = document.getElementById('mp-status');
  const mode = pickMode();

  // Cloud Functions가 배포돼 있으면 예전처럼 서버 권위 모드로 간다.
  // 아니면 mpNet의 local/firestore 백엔드로 전투 멀티플레이만 켠다.
  if (mode !== NET_MODE.FUNCTIONS) return startCombatNet(mode, statusEl);

  const conn = await initFirebase();
  if (!conn.ok) {
    statusEl.innerHTML = `<span class="dot off"></span> 로컬 모드 (${esc(conn.message)})`;
    return startCombatNet(NET_MODE.LOCAL, statusEl, conn.message);
  }

  const res = await callInitNation(name, color, cx, cy);
  if (res.error && !res.existed) { flashMessage('서버 연결 실패: ' + res.error, true); return; }

  game.serverAuthoritative = true;
  statusEl.innerHTML = '<span class="dot on"></span> 온라인 (서버 권위 모드)';

  watchMyNation((data) => {
    if (!data) return;
    game.myNation = Nation.fromJSON(data);
    buildBuildMenu();
  });
  watchNations({ x: cx, y: cy }, (list) => {
    game.otherNations.clear();
    for (const data of list) game.otherNations.set(data.id, data);
    renderWarPanel(list);
  });
  watchBattles(renderBattleLog);
}

// ============================================================
// 전투 멀티플레이 (mpNet)
//
// Cloud Functions 없이도 다른 플레이어와 싸울 수 있게 하는 경로다.
//   1) 내 기지 스냅샷을 주기적으로 올린다 (defenseSnapshot)
//   2) 다른 플레이어 스냅샷 목록을 받아 매치메이킹에 쓴다
//   3) 공격은 내 브라우저에서 스냅샷 상대로 시뮬레이션하고(battle.js),
//      결과를 습격 리포트로 상대 앞에 남긴다
//   4) 나를 공격한 리포트가 오면 방어 측 반영(applyRaidToDefender)을 하고
//      알림 + 리플레이를 띄운다
// ============================================================
let net = null;                 // 전송 계층 (mpNet)
let netMode = null;
let peers = [];                 // 다른 플레이어 국가 스냅샷
let defenseReports = [];        // 나를 공격한 리포트 (최근 것 먼저)
let attackReports = [];         // 내가 보낸 습격 (최근 것 먼저)
let publishTimer = null;
let netTrouble = null;          // 온라인이 안 될 때 사람이 읽을 수 있는 사유
let netStatusEl = null;

async function startCombatNet(mode, statusEl, trouble = null) {
  netStatusEl = statusEl || netStatusEl;
  netTrouble = trouble;
  let handles = null;

  if (mode === NET_MODE.FIRESTORE) {
    const conn = await initFirebase();
    handles = conn.ok ? getFirestoreHandles() : null;
    if (handles) {
      // 습격 리포트는 국가 id로 주고받으므로 로그인 uid를 그대로 쓴다.
      // (저장에서 이어할 때도 같은 uid로 돌아오므로 나에게 온 습격이 계속 도착한다)
      game.myNation.id = getUid();
    } else {
      // 온라인이 안 되면 같은 기기 대전으로 내려가되, **왜** 안 되는지는 남긴다
      netTrouble = conn.message || '온라인 연결에 실패했습니다';
      mode = NET_MODE.LOCAL;
    }
  }
  netMode = mode;
  if (net) net.close();
  net = createNet(mode, game.myNation.id, handles);

  net.watchPeers((list) => {
    peers = list;
    game.otherNations.clear();
    for (const p of list) game.otherNations.set(p.id, p);
    renderWarPanel(list);
    updateNetStatus();
  });
  net.watchRaids(handleIncomingRaid);

  await publishMyNation();
  if (publishTimer) clearInterval(publishTimer);
  publishTimer = setInterval(publishMyNation, PUBLISH_INTERVAL_MS);
  updateNetStatus();
  renderWarPanel(peers);
  renderBattleLog();
}

/** 온라인으로 다시 붙어본다 (전쟁 패널의 재연결 버튼) */
async function retryOnline() {
  const mode = pickMode();
  if (mode === NET_MODE.LOCAL) {
    flashMessage('js/firebase-config.js에 Firebase 설정이 없어 온라인으로 붙을 수 없습니다', true);
    return;
  }
  flashMessage('온라인으로 다시 연결하는 중...', false);
  await startCombatNet(mode, netStatusEl);
  flashMessage(netTrouble ? `온라인 연결 실패: ${netTrouble}` : '온라인으로 연결됐습니다', !!netTrouble);
}

function updateNetStatus() {
  if (!netStatusEl || !netMode) return;
  const online = netMode !== NET_MODE.LOCAL;
  netStatusEl.innerHTML = `<span class="dot ${online ? 'on' : 'off'}"></span> ${MODE_LABEL[netMode]} · 상대 ${peers.length}`;
}

/**
 * 내 기지를 다른 플레이어가 공격할 수 있도록 공개한다.
 * 온라인 모드에서 쓰기가 막히면(보안 규칙 미배포 등) 그 사유를 화면에 남긴다 —
 * 조용히 실패하면 "상대가 아무도 없네"로만 보여서 원인을 찾을 수 없다.
 */
async function publishMyNation() {
  if (!net || !game.myNation) return;
  const snap = defenseSnapshot(game.myNation);
  // 지역 버킷 — 서버 권위 모드의 주변 국가 쿼리와 같은 형식을 맞춰둔다
  snap.region = regionKey(game.myNation.capital.x, game.myNation.capital.y);
  try {
    await net.publish(snap);
    if (netTrouble && netMode !== NET_MODE.LOCAL) { netTrouble = null; renderWarPanel(peers); }
  } catch (e) {
    const denied = /permission|insufficient/i.test(e?.message || '') || e?.code === 'permission-denied';
    const next = denied
      ? '서버가 쓰기를 거부했습니다 — firestore.rules를 배포해야 합니다 (firebase deploy --only firestore:rules)'
      : `기지 공개 실패: ${e?.message || '알 수 없는 오류'}`;
    if (next !== netTrouble) { netTrouble = next; renderWarPanel(peers); }
  }
}

/**
 * 나를 공격한 습격 리포트가 도착했을 때. 같은 리포트를 여러 번 받아도
 * applyRaidToDefender가 한 번만 반영한다(멱등).
 */
function handleIncomingRaid(report) {
  if (!game.myNation || !report || report.defenderId !== game.myNation.id) return;
  if (defenseReports.some(r => r.id === report.id)) return;

  const res = applyRaidToDefender(game.myNation, report);
  defenseReports.unshift(report);
  defenseReports.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  if (defenseReports.length > 30) defenseReports.length = 30;

  if (res.applied) {
    // flashMessage는 textContent라 아이콘 태그를 못 쓴다 (남의 국가 이름이 섞이는 자리라 그대로 둔다)
    flashMessage(
      `${report.attackerName || '누군가'}의 습격! 파괴율 ${Math.round(res.destructionPercent * 100)}%`
      + ` · 약탈당함 ${resNames(res.lost) || '없음'}`,
      true);
    renderResourcePanel();
    publishMyNation();          // 줄어든 재고를 바로 반영해 다시 공개한다
  }
  renderBattleLog();
}

// ---------- 건설 메뉴 ----------
/**
 * 건설 카탈로그. 구조물이 35종까지 늘면서 한 줄로 늘어놓으면 찾기 어려워져서,
 * **같은 종류끼리 세트로 묶고 세트를 먼저 고르게** 한다 (터렛만 14종이다).
 * 세트를 열면 그 안의 구조물이 나오고, 거기서 하나를 골라 짓는다.
 */
let openBuildGroup = null;   // 지금 펼쳐 둔 세트 key

function buildBuildMenu() {
  const menu = document.getElementById('build-menu');
  menu.innerHTML = '';

  for (const group of BUILD_GROUPS) {
    const keys = Object.keys(STRUCTURES).filter(k => buildGroupOf(k) === group.key);
    if (!keys.length) continue;
    const unlockedKeys = keys.filter(k => game.myNation.unlocked.has(k));
    const open = openBuildGroup === group.key;

    const head = document.createElement('button');
    head.className = `build-group${open ? ' open' : ''}${unlockedKeys.length ? '' : ' locked'}`;
    head.dataset.group = group.key;
    head.innerHTML =
      `<img class="gic" src="${structureIcon(unlockedKeys[0] || keys[0])}" alt="">
       <span class="gnm">${group.name}<span class="gdesc">${group.desc}</span></span>
       <span class="gcnt">${unlockedKeys.length}/${keys.length}</span>
       <span class="gcaret">${open ? '▾' : '▸'}</span>`;
    head.addEventListener('click', () => {
      openBuildGroup = open ? null : group.key;
      buildBuildMenu();
    });
    menu.appendChild(head);
    if (!open) continue;

    const list = document.createElement('div');
    list.className = 'build-sublist';
    for (const key of keys) {
      const def = STRUCTURES[key];
      const btn = document.createElement('button');
      btn.className = 'build-item';
      btn.dataset.struct = key;
      btn.disabled = !game.myNation.unlocked.has(key);
      btn.innerHTML = `<img class="sic" src="${structureIcon(key)}" alt=""><span class="nm">${def.name}</span><span class="vol">부피 ${def.volume}</span>`;
      btn.title = def.desc;
      btn.addEventListener('click', () => {
        const wasSelected = selectedStruct === key;
        clearSelectedStruct();          // 미리보기/힌트까지 같이 지운다
        if (wasSelected) return;        // 같은 버튼을 다시 누르면 선택 해제
        selectedStruct = key;
        btn.classList.add('active');
        const rotateBtn = document.getElementById('rotate-btn');
        if (rotateBtn) rotateBtn.disabled = !isRotatable(key);
        renderCostPreview(def);
        // 고를 때 곧바로 화면 한가운데에 고스트를 띄워, 어디를 눌러야 할지 알려준다
        buildTarget = renderer.screenToWorld(canvas.width / 2, canvas.height / 2);
      });
      // 메뉴를 다시 그려도 지금 고른 구조물의 강조 표시가 풀리지 않게 한다
      // (연속 설치 중에 건설할 때마다 선택이 사라져 보이던 문제)
      if (selectedStruct === key) btn.classList.add('active');
      list.appendChild(btn);
    }
    menu.appendChild(list);
  }
}

/**
 * 고른 구조물의 필요 자원을 "보유/필요"로 보여준다.
 * 모자란 자원은 빨갛게 떠서, 짓기 전에 무엇이 부족한지 바로 알 수 있다.
 */
function renderCostPreview(def) {
  const el = document.getElementById('cost-preview');
  if (!def) { el.innerHTML = '구조물을 선택하세요'; return; }
  const stockOf = (r) => Math.floor(game.myNation
    ? (VIRTUAL_RESOURCES.has(r) ? (game.myNation.resources[r] || 0) : totalStock(game.myNation, r))
    : 0);
  const parts = Object.entries(def.baseCost).map(([r, need]) => {
    const have = stockOf(r);
    return `<span class="cost-item${have >= need ? '' : ' short'}">${resIcon(r)}<b>${have}</b>/${need}</span>`;
  });
  let html = `<div class="cost-title">${def.name} · 필요 자원</div>`;
  html += parts.length ? `<div class="cost-items">${parts.join('')}</div>` : `<div class="cost-items">건설 비용 없음</div>`;
  if (isRotatable(selectedStruct)) html += `<div class="cost-note">방향 ${DIR_ARROW[beltDir]} — ⟳ 버튼이나 R 키로 회전</div>`;
  el.innerHTML = html;
}

// ---------- 터치 툴바 버튼 (회전 / 전력범위 / 줌) ----------
document.getElementById('rotate-btn').addEventListener('click', () => {
  if (!isRotatable(selectedStruct)) return;
  beltDir = (beltDir + 1) % 4;
  renderCostPreview(STRUCTURES[selectedStruct]);
});
document.getElementById('build-confirm').addEventListener('click', confirmBuild);
document.getElementById('build-cancel').addEventListener('click', clearSelectedStruct);
document.getElementById('power-btn').addEventListener('click', (e) => {
  renderer.showPower = !renderer.showPower;
  e.currentTarget.classList.toggle('active', renderer.showPower);
});
document.getElementById('zoom-in-btn').addEventListener('click', () => {
  renderer.zoomAt(canvas.width / 2, canvas.height / 2, 4);
});
document.getElementById('zoom-out-btn').addEventListener('click', () => {
  renderer.zoomAt(canvas.width / 2, canvas.height / 2, -4);
});

// ---------- 키보드 (물리 키보드가 연결된 경우 병행 지원) ----------
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && isRotatable(selectedStruct)) {
    beltDir = (beltDir + 1) % 4;
    renderCostPreview(STRUCTURES[selectedStruct]);
  }
  if (e.key.toLowerCase() === 'p') {
    renderer.showPower = !renderer.showPower;
    document.getElementById('power-btn').classList.toggle('active', renderer.showPower);
  }
  // 키보드가 있으면 Enter로 설치, Esc로 취소 (터치에서는 화면 버튼을 쓴다)
  if (selectedStruct) {
    if (e.key === 'Enter') { e.preventDefault(); confirmBuild(); }
    if (e.key === 'Escape') { e.preventDefault(); clearSelectedStruct(); }
  }
});

// ---------- 캔버스 조작: 마우스 + 터치(팬/탭/핀치줌) 공용 ----------
let dragging = false, lastX = 0, lastY = 0, dragged = false;
let pinching = false, pinchStartDist = 0;

// ---------- 건설 배치 (고스트를 옮긴 뒤 "설치" 버튼으로 확정) ----------
// 구조물을 고른 상태에서 지도를 드래그하면 지나가는 칸마다 이어서 설치된다
// (벨트·방벽처럼 여러 개를 줄줄이 놓을 때 편하도록). 손을 떼면 그 구조물은
// 자동으로 선택 해제되어, 실수로 계속 지어지는 일이 없다.
let placing = false;          // 고스트를 끌어 옮기는 중
let buildTarget = null;       // 설치 버튼이 지을 칸 { x, y }
let suppressNextTap = false;

/** 건설 모드 해제 (카탈로그 강조·회전 버튼·미리보기까지 함께 정리) */
function clearSelectedStruct() {
  selectedStruct = null;
  buildTarget = null;
  document.querySelectorAll('.build-item.active').forEach(b => b.classList.remove('active'));
  const rotateBtn = document.getElementById('rotate-btn');
  if (rotateBtn) rotateBtn.disabled = true;
  renderer.buildPreview = null;
  const hint = document.getElementById('preview-hint');
  if (hint) { hint.textContent = ''; hint.className = 'preview-hint'; }
}

/**
 * 건설 위치(고스트)를 화면 좌표가 가리키는 칸으로 옮긴다.
 * 손가락이 닿는 순간 지어지면 오조작이 잦아서, 여기서는 자리만 잡고
 * 실제 건설은 "설치" 버튼(confirmBuild)에서만 일어난다.
 */
function moveBuildTargetTo(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  buildTarget = renderer.screenToWorld(clientX - rect.left, clientY - rect.top);
}

/** "설치" 버튼 — 지금 고스트가 있는 칸에 실제로 짓는다 */
async function confirmBuild() {
  const structKey = selectedStruct;
  if (!structKey || !buildTarget || !game.myNation) return;
  const { x, y } = buildTarget;
  const repeat = document.getElementById('build-repeat')?.checked;

  if (isMultiplayer()) {
    const res = await callBuild(structKey, x, y, beltDir);
    if (res.error) { flashMessage(res.error, true); return; }
    flashMessage(`${STRUCTURES[structKey].name} 건설 요청 완료`, false);
  } else {
    const err = game.myNation.build(structKey, x, y, beltDir);
    if (err) { flashMessage(err, true); return; }
    flashMessage(`${STRUCTURES[structKey].name} 건설 완료`, false);
    buildBuildMenu();
  }
  // 기본은 한 번 설치하면 선택 해제. "연속"을 켜두면 벨트처럼 여러 개를
  // 이어 지을 때 매번 카탈로그로 돌아가지 않아도 된다.
  if (repeat) {
    if (isBeltKey(structKey)) {
      // 벨트는 흐르는 방향으로 한 칸 밀어줘야 자연스럽게 이어 깔린다
      const [dx, dy] = DIR_VECT[beltDir] || [1, 0];
      buildTarget = { x: x + dx, y: y + dy };
    }
  } else {
    clearSelectedStruct();
  }
}

function pointerDown(x, y) {
  dragged = false; lastX = x; lastY = y;
  // 건설 모드에서 드래그는 "설치"가 아니라 "고스트 옮기기"다
  if (selectedStruct && game.myNation) {
    placing = true;
    moveBuildTargetTo(x, y);
    return;
  }
  dragging = true;
}
function pointerMove(x, y) {
  const rect = canvas.getBoundingClientRect();
  renderer.hover = renderer.screenToWorld(x - rect.left, y - rect.top);
  if (placing) { moveBuildTargetTo(x, y); lastX = x; lastY = y; return; }
  if (dragging) {
    const dx = x - lastX, dy = y - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
    renderer.pan(dx, dy);
    lastX = x; lastY = y;
  }
}
function pointerUp() {
  if (placing) {
    placing = false;
    suppressNextTap = true;  // 뒤이어 오는 click이 타일 정보를 열지 않도록
  }
  dragging = false;
}
async function handleTap(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const { x, y } = renderer.screenToWorld(clientX - rect.left, clientY - rect.top);

  // 수도 위치 선택 단계
  if (pendingNation && !game.myNation) {
    selectedCapital = { x, y };
    const site = capitalSiteReport(x, y);
    renderer.placementMarker = { x, y, ok: site.ok, radius: site.radius };
    updatePlacementBar();
    return;
  }
  if (!game.myNation) return;
  // 건설 모드에서는 탭이 "고스트 옮기기"라 타일 정보를 열지 않는다
  if (selectedStruct) return;

  // 카메라가 기울어져 있어서 건물은 자기 타일보다 위로 솟아 보인다.
  // 눈에 보이는 그림을 눌렀을 때 그 건물이 잡히도록 화면 영역으로 먼저 찾고,
  // 빈 곳이면 그 타일에 실제로 놓인 구조물을 찾는다.
  const clicked = renderer.pickStructure(game.myNation, clientX - rect.left, clientY - rect.top)
    || game.myNation.structures.find(s => {
      const [w, h] = STRUCTURES[s.key].footprint;
      return x >= s.x && x < s.x + w && y >= s.y && y < s.y + h;
    });
  showStructPanel(clicked || null, x, y);
}

// 마우스
canvas.addEventListener('mousedown', (e) => pointerDown(e.clientX, e.clientY));
window.addEventListener('mouseup', pointerUp);
canvas.addEventListener('mousemove', (e) => pointerMove(e.clientX, e.clientY));
canvas.addEventListener('click', (e) => {
  if (suppressNextTap) { suppressNextTap = false; return; }
  if (!dragged) handleTap(e.clientX, e.clientY);
});

// 터치 (한 손가락 = 팬/탭, 두 손가락 = 핀치줌)
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 2) {
    pinching = true; dragging = false;
    const [t1, t2] = e.touches;
    pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  } else if (e.touches.length === 1) {
    pinching = false;
    pointerDown(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (pinching && e.touches.length === 2) {
    const [t1, t2] = e.touches;
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const rect = canvas.getBoundingClientRect();
    const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
    const midY = (t1.clientY + t2.clientY) / 2 - rect.top;
    renderer.zoomAt(midX, midY, (dist - pinchStartDist) * 0.15);
    pinchStartDist = dist;
  } else if (e.touches.length === 1) {
    pointerMove(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (pinching) { pinching = false; dragged = true; pointerUp(); return; }
  const wasPlacing = placing;
  pointerUp(); // 고스트를 옮기는 중이었다면 여기서 끝난다 (설치는 설치 버튼에서만)
  if (!wasPlacing && !dragged && e.changedTouches.length === 1) {
    handleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  }
  suppressNextTap = false;
});

function flashMessage(text, isError) {
  const el = document.getElementById('flash');
  el.textContent = text;
  el.className = isError ? 'flash err' : 'flash ok';
  el.style.opacity = 1;
  clearTimeout(flashMessage._t);
  flashMessage._t = setTimeout(() => { el.style.opacity = 0; }, 2200);
}

// ---------- 구조물 인벤토리 / 수동 조작 UI ----------
// 자원은 저절로 국고로 가지 않는다. 벨트가 없으면 여기 버튼으로 직접 옮겨야 한다.
function renderInventoryHtml(struct, def) {
  const isStorage = def.storageCapacity > 0;
  const bar = (used, cap) => {
    const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    const cls = pct >= 100 ? 'full' : (pct >= 75 ? 'warn' : '');
    return `<div class="invbar"><div class="invbar-fill ${cls}" style="width:${pct}%"></div></div>`;
  };
  const rows = (obj) => Object.entries(obj || {}).filter(([, v]) => v > 0)
    .map(([r, v]) => `${resIcon(r)}${Math.floor(v)}`).join(' ') || '<span class="dim">비어 있음</span>';

  let html = '';

  if (isStorage) {
    const cap = getStorageCapacity(struct.key, struct.level);
    const used = storedTotal(struct);
    const kinds = Object.keys(struct.store || {}).filter(k => struct.store[k] > 0);
    html += `<div class="inv-block"><div class="inv-title">보관 ${Math.floor(used)} / ${cap}${
      def.singleResource ? ` · <span class="dim">${kinds.length ? RESOURCES[kinds[0]]?.name + ' 전용' : '비어 있음 (첫 자원이 종류를 정함)'}</span>` : ''
    }</div>${bar(used, cap)}<div class="inv-items">${rows(struct.store)}</div></div>`;
  }

  const outCap = getOutputCapacity(struct.key, struct.level);
  if (outCap > 0) {
    const outUsed = Object.values(struct.outputBuffer || {}).reduce((a, b) => a + b, 0);
    html += `<div class="inv-block"><div class="inv-title">산출 인벤토리 ${Math.floor(outUsed)} / ${outCap}</div>
      ${bar(outUsed, outCap)}<div class="inv-items">${rows(struct.outputBuffer)}</div>`;
    const outKeys = Object.keys(struct.outputBuffer || {}).filter(k => struct.outputBuffer[k] > 0);
    if (outKeys.length) {
      html += `<div class="inv-actions">` + outKeys.map(r =>
        `<button class="inv-btn" data-move-out="${r}">${resIcon(r)} 창고로 ${LOGISTICS.manualTransfer}</button>`).join('') + `</div>`;
    }
    html += `</div>`;
  }

  // 투입 버퍼 — 레시피 재료나 발전소 연료를 손으로 채워 넣는 곳
  const wantsInput = (def.recipes && Object.keys(def.recipes).length) || struct.key === 'power_plant' || struct.key === 'outpost';
  if (wantsInput) {
    html += `<div class="inv-block"><div class="inv-title">투입 버퍼</div>
      <div class="inv-items">${rows(struct.inputBuffer)}</div>`;
    // 지금 필요한 재료를 창고에서 바로 끌어오는 버튼
    let needKeys = [];
    if (struct.key === 'power_plant') needKeys = ['wood', 'petroleum'];
    else if (def.recipes && struct.recipe) needKeys = Object.keys(def.recipes[struct.recipe].in);
    else if (struct.key === 'outpost') {
      const need = new Set();
      for (const job of struct.recruitQueue || []) Object.keys(job.need).forEach(k => need.add(k));
      needKeys = [...need];
    }
    const avail = needKeys.filter(r => (game.myNation.resources[r] || 0) > 0);
    if (avail.length) {
      html += `<div class="inv-actions">` + avail.map(r =>
        `<button class="inv-btn" data-move-in="${r}">${resIcon(r)} 창고에서 ${LOGISTICS.manualTransfer}</button>`).join('') + `</div>`;
    } else if (needKeys.length) {
      html += `<div class="pd dim">필요한 재료(${needKeys.map(r => RESOURCES[r]?.name || r).join(', ')})가 창고에 없습니다</div>`;
    }
    html += `</div>`;
  }

  // 수동 운용 — 전력이 없어도 누르고 있는 동안 직접 돌린다
  if (def.category === 'extraction' || def.category === 'production') {
    html += `<button id="manual-op-btn" class="manual-op-btn">✋ 수동 운용 (누르고 있는 동안 가동)</button>
      <div id="manual-op-status" class="pd dim">전력이 없어도 손으로 돌릴 수 있습니다 (생산량 ${Math.round(LOGISTICS.manualOperateRate * 100)}%)</div>`;
  }
  return html;
}

/** 수동 조작 버튼들의 이벤트 배선 (패널을 다시 그릴 때마다 호출) */
function wireInventoryActions(panel, struct, x, y) {
  const refresh = () => showStructPanel(game.myNation.structures.find(s => s.id === struct.id) || null, x, y);

  panel.querySelectorAll('[data-move-out]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = btn.dataset.moveOut;
      const res = await dispatch(
        () => manualMoveToStorage(game.myNation, struct.id, r),
        () => callManualMove('out', struct.id, r, LOGISTICS.manualTransfer));
      if (res.error || res.ok === false) flashMessage(res.error, true);
      else flashMessage(`${RESOURCES[r]?.name} ${res.moved} 창고로 이송`, false);
      refresh();
    });
  });
  panel.querySelectorAll('[data-move-in]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = btn.dataset.moveIn;
      const res = await dispatch(
        () => manualMoveToStructure(game.myNation, struct.id, r),
        () => callManualMove('in', struct.id, r, LOGISTICS.manualTransfer));
      if (res.error || res.ok === false) flashMessage(res.error, true);
      else flashMessage(`${RESOURCES[r]?.name} ${res.moved} 투입`, false);
      refresh();
    });
  });

  // 수동 운용: 누르고 있는 동안 일정 간격으로 1사이클씩 돌린다
  const opBtn = panel.querySelector('#manual-op-btn');
  if (opBtn) {
    const statusEl = panel.querySelector('#manual-op-status');
    let timer = null;
    let cycles = 0, heldFrom = 0; // 서버 모드에서 버튼을 뗄 때 한 번에 보고할 사이클 수
    const runOnce = () => {
      // 손맛이 중요한 버튼이라 항상 로컬에서 먼저 돌려 즉시 반응을 보여준다.
      // 서버 모드에서는 뗄 때 사이클 수를 보내 서버가 같은 계산으로 확정한다.
      const res = manualOperate(game.myNation, struct.id);
      if (!res.ok) {
        if (statusEl) { statusEl.textContent = res.error; statusEl.className = 'pd err'; }
        stop();
        return;
      }
      cycles++;
      const made = Object.entries(res.produced || {}).map(([r, a]) => `${RESOURCES[r]?.name || r} +${a}`).join(', ');
      if (statusEl) { statusEl.textContent = `가동 중… ${made}`; statusEl.className = 'pd ok'; }
      renderResourcePanel();
    };
    const start = (e) => {
      e.preventDefault();
      if (timer) return;
      opBtn.classList.add('active');
      cycles = 0; heldFrom = Date.now();
      runOnce();
      timer = setInterval(runOnce, LOGISTICS.manualOperateMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer); timer = null;
      opBtn.classList.remove('active');
      if (onServer() && cycles > 0) callManualOperate(struct.id, cycles, Date.now() - heldFrom);
      cycles = 0;
      refresh(); // 인벤토리 표시 갱신
    };
    opBtn.addEventListener('mousedown', start);
    opBtn.addEventListener('touchstart', start, { passive: false });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => opBtn.addEventListener(ev, stop));
    // 패널이 사라지거나 창을 벗어나도 타이머가 남지 않도록
    window.addEventListener('blur', stop);
  }
}

/** 농지의 작물 / 축사의 가축 고르기 — 해금되지 않은 항목은 잠긴 채로 보여준다 */
function renderChoiceHtml(struct, table, kind, title, lockHint) {
  const current = struct[kind] || (kind === 'crop' ? 'rice' : 'cattle');
  let html = `<div class="pd">${title}:</div><div class="recipe-list">`;
  for (const [key, def] of Object.entries(table)) {
    const unlocked = hasGood(game.myNation, `${kind}:${key}`);
    const active = current === key ? 'active' : '';
    html += `<button class="recipe-btn choice-btn ${active}" data-kind="${kind}" data-choice="${key}"
      ${unlocked ? '' : `disabled title="${lockHint}"`}>
      ${unlocked ? '' : '🔒 '}${resIcon(def.yields)} ${def.name}
    </button>`;
  }
  html += `</div>`;
  const cur = table[current];
  if (cur) {
    const extra = Object.keys(cur.products || {}).length
      ? ' · 부산물 ' + Object.entries(cur.products).map(([r, a]) => `${resIcon(r)}${a * struct.level}`).join(' ')
      : '';
    html += `<div class="pd dim">현재: ${cur.name} — 매 틱 ${resIcon(cur.yields)}${cur.baseYield * struct.level}${extra}</div>`;
  }
  return html;
}

/** 창고/수도에 든 자원을 팔아 골드로 바꾸는 UI (요리일수록 단가가 높다) */
/**
 * 제작(레시피) 목록 — 이름만 있던 작은 버튼 대신 큰 카드로 보여준다.
 * 무엇을 넣어 무엇이 나오는지, 지금 재료가 있는지, 팔면 얼마인지가
 * 카드 하나에 다 들어와서 팝업을 닫지 않고도 고를 수 있다.
 */
function renderRecipeHtml(struct, def) {
  const isKitchen = struct.key === 'kitchen';
  const buf = struct.inputBuffer || {};
  let html = `<div class="pd">${isKitchen ? '요리법' : '제작 레시피'} 선택:</div><div class="craft-list">`;
  for (const [key, r] of Object.entries(def.recipes)) {
    const active = struct.recipe === key ? ' active' : '';
    const label = RESOURCES[key]?.name || key;
    // 조리소 요리법은 여행으로 배워와야 쓸 수 있다 (logic.setRecipe와 같은 규칙)
    const learned = !isKitchen || hasGood(game.myNation, `dish:${key}`);
    const ing = Object.entries(r.in || {}).map(([res, need]) => {
      const have = buf[res] || 0;
      return `<span class="craft-ing${have >= need ? ' ok' : ' short'}">${resIcon(res)}${have}/${need}</span>`;
    }).join('');
    html += `<button class="craft-card${active}${learned ? '' : ' locked'}" data-recipe="${key}"
      ${learned ? '' : 'disabled title="여행으로 배워오세요"'}>
      <img class="craft-art" src="${RESOURCES[key]?.icon || ''}" alt="">
      <span class="craft-info">
        <span class="craft-name">${learned ? '' : '🔒 '}${label}<span class="craft-out">×${r.out || 1}</span></span>
        <span class="craft-ings">${ing || '<span class="craft-ing ok">재료 없음</span>'}</span>
      </span>
      <span class="craft-price">${resIcon('gold')}${getSellPrice(key)}</span>
    </button>`;
  }
  return html + `</div>`;
}

function renderSellHtml(struct) {
  const entries = Object.entries(struct.store || {}).filter(([, v]) => v > 0);
  if (!entries.length) return '';
  let html = `<div class="inv-block"><div class="inv-title">판매 (국고 골드로 교환)</div><div class="inv-actions">`;
  for (const [res, amt] of entries) {
    const price = getSellPrice(res);
    if (price <= 0) continue;
    const qty = Math.min(10, Math.floor(amt));
    html += `<button class="inv-btn sell-btn" data-sell="${res}" data-qty="${qty}">
      ${resIcon(res)} ${qty}개 팔기 · ${resIcon('gold')}${price * qty}</button>`;
  }
  html += `</div><div class="pd dim">단가는 조리 공정이 깊고 재료가 귀할수록 높습니다.</div></div>`;
  return html;
}

// ---------- 구조물 상세 패널 ----------
/** 구조물 팝업 닫기 */
function closeStructModal() {
  document.getElementById('struct-modal').classList.add('hidden');
}
document.getElementById('struct-modal-close').addEventListener('click', closeStructModal);
document.querySelector('.struct-modal-backdrop').addEventListener('click', closeStructModal);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStructModal(); });

/**
 * 철거 블록 — 되돌릴 수 없는 조작이라 "무엇을 잃는지"를 먼저 보여주고,
 * 한 번 더 눌러야 실제로 철거되게 한다 (오탭 방지).
 */
function renderDemolishHtml(struct, def) {
  if (struct.key === 'capital') {
    return `<div class="dem-block"><div class="pd dim">수도는 철거할 수 없습니다</div></div>`;
  }
  const check = canDemolish(game.myNation, struct.id);
  // 철거하면 사라지는 자원 (보관함 + 투입/산출 인벤토리)
  const lost = {};
  for (const bag of [struct.store, struct.inputBuffer, struct.outputBuffer]) {
    for (const [res, amt] of Object.entries(bag || {})) if (amt > 0) lost[res] = (lost[res] || 0) + amt;
  }
  const lostTxt = Object.entries(lost).map(([r, a]) => `${resIcon(r)}${a}`).join(' ');
  const queued = (struct.recruitQueue || []).length;

  let html = `<div class="dem-block"><div class="dem-head">철거</div>`;
  html += `<div class="pd dim">건설비는 돌려받지 못하고, 안에 있는 자원은 모두 사라집니다.</div>`;
  if (lostTxt) html += `<div class="dem-lost">사라짐: ${lostTxt}</div>`;
  if (queued) html += `<div class="dem-lost">모집 대기 ${queued}건도 함께 사라집니다</div>`;
  if (!check.ok) html += `<div class="pd err">${check.error}</div>`;
  html += `<button id="demolish-btn" class="demolish-btn" ${check.ok ? '' : 'disabled'}>철거</button></div>`;
  return html;
}

/**
 * 레벨업 정보 — 다음 레벨에서 실제로 무엇이 얼마나 좋아지는지와 비용을 보여준다.
 * (숫자를 직접 비교해 보여주므로 "올릴 가치가 있는지" 판단할 수 있다)
 */
function renderUpgradeHtml(struct, def) {
  const cur = struct.level, next = cur + 1;
  const maxed = cur >= def.maxLevel;

  let html = `<div class="up-block"><div class="up-head">레벨 ${cur} / ${def.maxLevel}</div>
    <div class="lvl-dots">${Array.from({ length: def.maxLevel }, (_, i) =>
      `<span class="lvl-dot${i < cur ? ' on' : ''}"></span>`).join('')}</div>`;

  if (maxed) {
    html += `<div class="pd dim">최대 레벨에 도달했습니다</div><button id="upgrade-btn" disabled>최대 레벨</button></div>`;
    return html;
  }

  // 레벨에 따라 실제로 달라지는 능력치만 골라 현재→다음 값을 나란히 보여준다
  const gains = [];
  const add = (label, a, b, unit = '') => gains.push({ label, a: `${a}${unit}`, b: `${b}${unit}` });
  if (def.baseProduction) add('생산량', def.baseProduction * cur, def.baseProduction * next, '/틱');
  if (def.goldIncome) add('골드 수입', def.goldIncome * cur, def.goldIncome * next, '/틱');
  if (def.territoryRadius) add('영토 반경', getTerritoryRadius(struct.key, cur), getTerritoryRadius(struct.key, next), '칸');
  if (def.powerRadius) add('전력 범위', def.powerRadius + (cur - 1), def.powerRadius + (next - 1), '칸');
  if (def.storageCapacity) add('보관 용량', getStorageCapacity(struct.key, cur), getStorageCapacity(struct.key, next));
  if (getOutputCapacity(struct.key, cur)) add('산출 용량', getOutputCapacity(struct.key, cur), getOutputCapacity(struct.key, next));
  if (def.category === 'turret') {
    add('공격력', (def.attack || 0) * cur, (def.attack || 0) * next);
    add('사거리', def.range + (cur - 1), def.range + (next - 1), '칸');
    add('전력 소모', (def.powerDraw || 0) * cur, (def.powerDraw || 0) * next, 'kW');
  }
  if (def.defense) add('방어력', def.defense * cur, def.defense * next);
  if (def.baseHp) add('내구도', getStructureMaxHp(struct.key, cur), getStructureMaxHp(struct.key, next));
  if (isBeltKey(struct.key)) add('처리량', beltThroughput(cur), beltThroughput(next), '/틱');

  if (gains.length) {
    html += `<div class="up-gains">` + gains.map(g =>
      `<div class="up-row"><span class="up-label">${g.label}</span>
        <span class="up-a">${g.a}</span><span class="up-arrow">▶</span><span class="up-b">${g.b}</span></div>`).join('') + `</div>`;
  }

  const cost = getUpgradeCost(struct.key, cur);
  const costTxt = Object.entries(cost || {}).map(([r, a]) => {
    const have = Math.floor(game.myNation.resources[r] || 0);
    const enough = have >= a;
    return `<span class="up-cost${enough ? '' : ' short'}">${resIcon(r)}${a}<i>(${have})</i></span>`;
  }).join('');
  const affordable = Object.entries(cost || {}).every(([r, a]) => (game.myNation.resources[r] || 0) >= a);

  html += `<div class="up-costline">비용 ${costTxt || '없음'}</div>
    <button id="upgrade-btn" ${affordable ? '' : 'disabled'}>레벨 ${cur} ▶ ${next} 업그레이드</button></div>`;
  return html;
}

/**
 * 구조물을 선택하면 세부정보/레벨업 정보를 팝업 창으로 띄운다.
 * (빈 타일을 탭했을 때는 팝업 대신 우측 패널의 지형 정보만 갱신한다)
 */
function showStructPanel(struct, x, y) {
  const modal = document.getElementById('struct-modal');
  const panel = document.getElementById('struct-panel');
  if (!struct) {
    closeStructModal();
    const t = getTile(x, y);
    panel.innerHTML = `<div class="ph">타일 (${x}, ${y})</div><div class="pd">지형: ${t.node ? t.node.name : (t.terrain === 'water' ? '강/호수' : '평지')}</div>`;
    return;
  }
  const def = STRUCTURES[struct.key];

  document.getElementById('struct-modal-art').src = structureIcon(struct.key);
  document.getElementById('struct-modal-name').textContent = `${def.name} · Lv.${struct.level}`;
  document.getElementById('struct-modal-sub').innerHTML = struct.idle
    ? `<span class="badge-idle">정지됨${struct.idleReason ? ' · ' + struct.idleReason : ''}</span>`
    : `<span class="badge-run">가동 중</span>`;

  let html = `<div class="pd">${def.desc}</div>`;
  html += renderInventoryHtml(struct, def);

  if (struct.key === 'lab') html += renderLabHtml();
  if (struct.key === 'outpost') html += renderOutpostHtml(struct);
  if (struct.key === 'farm') html += renderChoiceHtml(struct, CROPS, 'crop', '재배할 작물', '여행으로 종자를 구해오세요');
  if (struct.key === 'barn') html += renderChoiceHtml(struct, ANIMALS, 'animal', '기를 가축', '여행으로 데려오세요');
  if (STRUCTURES[struct.key].storageCapacity) html += renderSellHtml(struct);

  if (isRotatable(struct.key)) {
    html += `<div class="pd">흐르는 방향: <b class="rot-now">${DIR_ARROW[struct.dir || 0]}</b></div>
      <div class="rot-row">
        ${[0, 1, 2, 3].map(d => `<button class="rot-btn${(struct.dir || 0) === d ? ' active' : ''}" data-rot="${d}">${DIR_ARROW[d]}</button>`).join('')}
      </div>`;
  }
  if (def.recipes) html += renderRecipeHtml(struct, def);

  html += renderUpgradeHtml(struct, def);
  html += renderDemolishHtml(struct, def);

  const body = document.getElementById('struct-modal-body');
  body.innerHTML = html;
  body.scrollTop = 0;
  modal.classList.remove('hidden');
  wireInventoryActions(body, struct, x, y);

  // 작물/가축/연구/모병 버튼도 모양을 맞추려고 .recipe-btn 클래스를 공유하므로,
  // 레시피 핸들러는 반드시 data-recipe가 있는 버튼에만 걸어야 한다.
  body.querySelectorAll('[data-recipe]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (isMultiplayer()) {
        const res = await callSetRecipe(struct.id, btn.dataset.recipe);
        if (res.error) flashMessage(res.error, true); else flashMessage('레시피 설정 완료', false);
      } else {
        const err = game.myNation.setRecipe(struct.id, btn.dataset.recipe);
        if (err) flashMessage(err, true); else showStructPanel(struct, x, y);
      }
    });
  });
  body.querySelectorAll('[data-rot]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dir = Number(btn.dataset.rot);
      const res = await dispatch(
        () => ({ error: game.myNation.rotateStructure(struct.id, dir) }),
        () => callRotate(struct.id, dir));
      if (res.error) flashMessage(res.error, true);
      else showStructPanel(game.myNation.structures.find(s2 => s2.id === struct.id) || null, x, y);
    });
  });

  // 철거는 되돌릴 수 없어서 두 번 눌러야 실행된다 (첫 탭은 확인 요청)
  const db2 = document.getElementById('demolish-btn');
  if (db2) {
    let armed = false;
    db2.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        db2.textContent = '정말 철거합니다 (한 번 더)';
        db2.classList.add('armed');
        setTimeout(() => { if (db2.isConnected) { armed = false; db2.textContent = '철거'; db2.classList.remove('armed'); } }, 4000);
        return;
      }
      const name = STRUCTURES[struct.key].name;
      const res = await dispatch(
        () => ({ error: game.myNation.demolish(struct.id) }),
        () => callDemolish(struct.id));
      if (res.error) flashMessage(res.error, true);
      else { flashMessage(`${name} 철거 완료`, false); closeStructModal(); }
    });
  }

  const ub = document.getElementById('upgrade-btn');
  if (ub) ub.addEventListener('click', async () => {
    if (isMultiplayer()) {
      const res = await callUpgrade(struct.id);
      if (res.error) flashMessage(res.error, true); else flashMessage('레벨업 요청 완료', false);
    } else {
      const err = game.myNation.upgrade(struct.id);
      if (err) flashMessage(err, true); else { flashMessage('레벨업 완료', false); showStructPanel(struct, x, y); }
    }
  });
  body.querySelectorAll('.choice-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.kind, val = btn.dataset.choice;
      const label = (kind === 'crop' ? CROPS : ANIMALS)[val]?.name || val;
      const res = await dispatch(
        () => ({ error: kind === 'crop' ? game.myNation.setCrop(struct.id, val) : game.myNation.setAnimal(struct.id, val) }),
        () => kind === 'crop' ? callSetCrop(struct.id, val) : callSetAnimal(struct.id, val));
      if (res.error) flashMessage(res.error, true);
      else { flashMessage(`${label} 선택 완료`, false); showStructPanel(struct, x, y); }
    });
  });
  body.querySelectorAll('.sell-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = btn.dataset.sell, qty = Number(btn.dataset.qty);
      const res = await dispatch(
        () => sellFromStorage(game.myNation, r, qty),
        () => callSell(r, qty));
      if (res.error || res.ok === false) flashMessage(res.error, true);
      else flashMessage(`${res.sold}개 판매 — 골드 +${res.earned}`, false);
      showStructPanel(game.myNation.structures.find(s2 => s2.id === struct.id) || null, x, y);
    });
  });
  body.querySelectorAll('.research-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.tech;
      if (isMultiplayer()) {
        const res = await callStartResearch(key);
        if (res.error) flashMessage(res.error, true); else flashMessage('연구 시작', false);
      } else {
        const err = game.myNation.startResearch(key);
        if (err) flashMessage(err, true); else { flashMessage('연구 시작', false); showStructPanel(struct, x, y); }
      }
    });
  });
  body.querySelectorAll('.recruit-card').forEach(btn => {
    btn.addEventListener('click', async () => {
      const unitKey = btn.dataset.unit;
      const isDefense = btn.dataset.defense === '1';
      if (isMultiplayer()) {
        const res = await callRecruitUnit(struct.id, unitKey, isDefense);
        if (res.error) flashMessage(res.error, true); else flashMessage('모집 신청 완료 — 벨트로 장비를 투입하세요', false);
      } else {
        const err = game.myNation.recruitUnit(struct.id, unitKey, isDefense);
        if (err) flashMessage(err, true); else { flashMessage('모집 신청 완료 — 벨트로 장비를 투입하세요', false); showStructPanel(struct, x, y); }
      }
    });
  });
}

function renderOutpostHtml(struct) {
  const nation = game.myNation;
  let html = `<div class="pd">국고 골드: ${resIcon('gold')} ${Math.floor(nation.resources.gold || 0)}</div>`;

  const queue = struct.recruitQueue || [];
  if (queue.length) {
    html += `<div class="pd">모집 대기열 (${queue.length}) — 벨트로 장비 투입 대기 중:</div>`;
    html += queue.map(j => {
      const unit = j.isDefense ? UNITS.defense[j.unitKey] : UNITS.attack[j.unitKey];
      const have = struct.inputBuffer || {};
      const needTxt = Object.entries(j.need).map(([r, a]) => `${resIcon(r)}${have[r] || 0}/${a}`).join(' ');
      return `<div class="pd">· ${unit?.name || j.unitKey}: ${needTxt}</div>`;
    }).join('');
  }

  const roster = nation.units || { attack: {}, defense: {} };
  const rosterTxt = [
    ...Object.entries(roster.attack || {}).map(([k, c]) => `${unitArtIcon(k)}${UNITS.attack[k]?.name || k} ×${c}`),
    ...Object.entries(roster.defense || {}).map(([k, c]) => `${unitArtIcon(k)}${UNITS.defense[k]?.name || k} ×${c}`),
  ].join(', ');
  html += `<div class="pd">보유 병력: ${rosterTxt || '없음'}</div>`;

  const gold = Math.floor(nation.resources.gold || 0);
  html += renderRecruitList('공격 유닛 모집', UNITS.attack, 0, gold);
  html += renderRecruitList('수비 유닛 모집', UNITS.defense, 1, gold);
  return html;
}

/**
 * 모병 목록 — 한 줄짜리 작은 버튼 대신, 유닛 그림과 성능 수치를 함께 담은
 * 큰 카드로 보여준다. 골드가 모자라면 비용을 빨갛게 강조하고 카드를 잠근다.
 */
function renderRecruitList(title, table, isDefense, gold) {
  let html = `<div class="pd">${title}:</div><div class="recruit-list">`;
  for (const [key, unit] of Object.entries(table)) {
    const afford = gold >= unit.gold;
    const equip = Object.entries(unit.equip)
      .map(([r, a]) => `<span class="ru-eq">${resIcon(r)}${a}</span>`).join('');
    const stats = [
      ['공격', unit.power], ['체력', unit.hp],
      ['속도', unit.speed === 0 ? '고정' : unit.speed], ['사거리', unit.range],
    ].map(([k, v]) => `<span class="ru-stat"><b>${k}</b>${v}</span>`).join('');
    html += `<button class="recruit-card${afford ? '' : ' short'}" data-unit="${key}" data-defense="${isDefense}"
      ${afford ? '' : 'title="국고 골드가 모자랍니다"'}>
      <img class="ru-art" src="${unitIcon(key)}" alt="">
      <span class="ru-info">
        <span class="ru-name">${unit.name}
          <span class="ru-cost${afford ? '' : ' err'}">${resIcon('gold')}${unit.gold}</span>
        </span>
        <span class="ru-stats">${stats}</span>
        <span class="ru-equips"><b>장비</b>${equip}</span>
      </span>
    </button>`;
  }
  return html + `</div>`;
}

function renderLabHtml() {
  const nation = game.myNation;
  if (nation.research && nation.research.key) {
    const def = STRUCTURES[nation.research.key];
    return `<div class="pd">연구 중: ${def.name} (남은 ${nation.research.ticksLeft}틱)</div>`;
  }
  // 연구는 수도 레벨로 단계가 나뉘므로, 수도 레벨별로 묶어서 보여준다.
  const capLevel = getCapitalLevel(nation);
  const byLevel = new Map();
  for (const [key, tech] of Object.entries(TECH_TREE)) {
    if (nation.unlocked.has(key)) continue;
    const lv = tech.capitalLevel || 1;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push([key, tech]);
  }
  if (!byLevel.size) return `<div class="pd">모든 기술을 연구했습니다.</div>`;

  let html = `<div class="pd">연구 가능한 기술 <span class="dim">(수도 Lv.${capLevel})</span></div>`;
  for (const lv of [...byLevel.keys()].sort((a, b) => a - b)) {
    const levelLocked = capLevel < lv;
    html += `<div class="tech-tier${levelLocked ? ' locked' : ''}">
      <div class="tech-tier-head">${levelLocked ? '🔒 ' : ''}수도 Lv.${lv} 단계</div><div class="recipe-list">`;
    for (const [key, tech] of byLevel.get(lv)) {
      const missing = tech.requires.filter(k => !nation.unlocked.has(k));
      const locked = levelLocked || missing.length > 0;
      const title = levelLocked
        ? `수도 레벨 ${lv} 필요 (현재 ${capLevel})`
        : (missing.length ? '선행 연구 필요: ' + missing.map(m => STRUCTURES[m].name).join(', ') : '');
      const costTxt = Object.entries(tech.cost).map(([r, a]) => `${resIcon(r)}${a}`).join(' ');
      html += `<button class="recipe-btn research-btn" data-tech="${key}" ${locked ? `disabled title="${title}"` : ''}>
        ${STRUCTURES[key].name} (${costTxt}, ${tech.time}틱)
      </button>`;
    }
    html += `</div></div>`;
  }
  return html;
}

// ---------------- 전쟁: 매치메이킹 (COC식 "상대 찾기") ----------------
let knownNations = [];  // 최근 watchNations로 받은 주변 국가 목록 (원본 데이터, 매치메이킹 소스)
let currentMatch = null; // 현재 화면에 표시 중인 매치 후보

let attackDeck = null;   // 이번 출격에 데려갈 병력 (unitKey -> 수). null이면 전군

function renderWarPanel(nations) {
  knownNations = nations;
  const el = document.getElementById('war-list');
  if (!el || !game.myNation) return;
  if (currentMatch && !nations.some(n => n.id === currentMatch.id)) currentMatch = null;

  const now = Date.now();
  const shieldLeft = Math.max(0, (game.myNation.shieldUntil || 0) - now);
  const shieldTxt = shieldLeft > 0
    ? `<div class="pd shield-on">내 보호막 ${Math.ceil(shieldLeft / 60000)}분 남음 — 공격하면 즉시 풀립니다</div>`
    : `<div class="pd">내 보호막 없음 — 다른 플레이어가 나를 공격할 수 있습니다</div>`;

  // 온라인이 아닐 때는 왜 아닌지와 어떻게 하면 되는지를 같이 보여준다
  const offline = netMode === NET_MODE.LOCAL;
  const netBox = offline
    ? `<div class="net-box">
         <div class="net-line">${netTrouble ? `온라인 연결 실패 — ${esc(netTrouble)}` : '같은 기기(다른 탭)끼리만 대전 중입니다'}</div>
         <button id="retry-online-btn" class="retry-btn">온라인으로 연결</button>
       </div>`
    : (netTrouble ? `<div class="net-box err"><div class="net-line">${esc(netTrouble)}</div>
         <button id="retry-online-btn" class="retry-btn">다시 시도</button></div>` : '');

  el.innerHTML = `
    <div class="pd">접속한 상대 ${nations.length}명 · 내 트로피 ${statusIcon('trophy')} ${game.myNation.trophies || 0}</div>
    ${shieldTxt}
    ${netBox}
    <button id="find-match-btn" class="find-match-btn">⚔️ 상대 찾기</button>
    <div id="match-card"></div>
  `;
  const retryBtn = document.getElementById('retry-online-btn');
  if (retryBtn) retryBtn.addEventListener('click', retryOnline);
  document.getElementById('find-match-btn').addEventListener('click', () => {
    currentMatch = findMatch(game.myNation, knownNations, Date.now());
    attackDeck = null;
    if (!currentMatch && knownNations.length) {
      flashMessage('지금은 공격할 수 있는 상대가 없습니다 (전부 보호막 상태)', true);
    }
    renderMatchCard();
  });
  renderMatchCard();
}

/** 출격 편성 — 데려갈 유닛 수를 정한다. 기본값은 보유 전군. */
function currentDeck() {
  const roster = (game.myNation.units && game.myNation.units.attack) || {};
  if (!attackDeck) return Object.fromEntries(Object.entries(roster).filter(([, c]) => c > 0));
  const deck = {};
  for (const [key, count] of Object.entries(attackDeck)) {
    const capped = Math.min(count, roster[key] || 0);
    if (capped > 0) deck[key] = capped;
  }
  return deck;
}

function renderMatchCard() {
  const el = document.getElementById('match-card');
  if (!el) return;
  if (!currentMatch) {
    el.innerHTML = knownNations.length
      ? '<div class="pd">상대 찾기 버튼을 눌러 트로피가 비슷한 상대를 찾아보세요.</div>'
      : `<div class="pd">아직 접속한 상대가 없습니다.</div>
         <div class="pd dim">${netMode === NET_MODE.LOCAL
            ? '이 게임을 <b>새 탭에서 하나 더 열어</b> 국가를 세우면 그 국가가 상대로 잡힙니다.'
            : '상대가 접속하면 자동으로 목록에 올라옵니다.'}</div>`;
    return;
  }
  const n = currentMatch;
  const roster = (game.myNation.units && game.myNation.units.attack) || {};
  const deck = currentDeck();
  const total = Object.values(deck).reduce((a, b) => a + b, 0);
  const blocked = canAttack(game.myNation, n, Date.now());

  el.innerHTML = `
    <div class="match-card">
      <div class="match-head">
        <span class="dot" style="background:${safeColor(n.color)}"></span>
        <span class="nm">${esc(n.name)}</span>
        <span class="trophy">${statusIcon('trophy')} ${Number(n.trophies) || 0}</span>
      </div>
      <div class="pd">기지 ${(n.structures || []).length}동 · 예상 방어력 ${n.defensePower ?? getDefensePower(n)}
        · 약탈량은 실제 파괴율에 비례합니다</div>
      <div class="deck-edit">
        <div class="deck-edit-head">출격 편성 <span class="dim">${total}기</span></div>
        ${Object.entries(roster).filter(([, c]) => c > 0).map(([key, have]) => `
          <div class="deck-edit-row">
            ${unitArtIcon(key, 'deck-edit-art')}
            <span class="nm">${UNITS.attack[key]?.name || key}</span>
            <button class="deck-minus" data-unit="${key}">−</button>
            <span class="cnt">${deck[key] || 0}/${have}</span>
            <button class="deck-plus" data-unit="${key}">＋</button>
          </div>`).join('') || '<div class="pd err">공격 유닛이 없습니다 — 전초기지에서 모집하세요</div>'}
      </div>
      <div class="match-actions">
        <button id="attack-match-btn" class="atk-btn" ${total > 0 && !blocked ? '' : `disabled title="${blocked || '데려갈 유닛을 1기 이상 골라주세요'}"`}>공격</button>
        <button id="skip-match-btn" class="skip-btn">다른 상대</button>
      </div>
      ${blocked ? `<div class="pd err">${blocked}</div>` : ''}
    </div>`;

  const bump = (key, delta) => {
    const base = currentDeck();
    const have = roster[key] || 0;
    attackDeck = { ...base, [key]: Math.max(0, Math.min(have, (base[key] || 0) + delta)) };
    renderMatchCard();
  };
  el.querySelectorAll('.deck-plus').forEach(b => b.addEventListener('click', () => bump(b.dataset.unit, +1)));
  el.querySelectorAll('.deck-minus').forEach(b => b.addEventListener('click', () => bump(b.dataset.unit, -1)));

  document.getElementById('attack-match-btn').addEventListener('click', () => {
    if (!Object.keys(currentDeck()).length) return;
    openBattleScreen(currentMatch, currentDeck());
  });
  document.getElementById('skip-match-btn').addEventListener('click', () => {
    currentMatch = findMatch(game.myNation, knownNations, Date.now());
    attackDeck = null;
    renderMatchCard();
  });
}

/**
 * 전투 기록. 서버 권위 모드에서는 서버가 준 battles 목록을(list 인자),
 * mpNet 모드에서는 내가 보낸 습격 + 나를 공격한 리포트를 함께 보여준다.
 * 방어 기록에는 **리플레이**(어떻게 뚫렸는지 다시 보기)와 **복수** 버튼이 붙는다.
 */
function renderBattleLog(list = null) {
  const el = document.getElementById('battle-log');
  if (!el || !game.myNation) return;

  if (list) {   // 서버 권위 모드
    el.innerHTML = list.map(b => {
      const mine = b.attackerId === game.myNation.id;
      const outcome = b.win ? (mine ? '승리' : '패배') : (mine ? '패배' : '승리');
      const trophyTxt = mine && typeof b.trophyDelta === 'number' ? ` (${statusIcon('trophy')}${b.trophyDelta >= 0 ? '+' : ''}${b.trophyDelta})` : '';
      return `<div class="log-row">${mine ? '내가 공격' : '상대가 공격'} → <b>${outcome}</b>${trophyTxt}</div>`;
    }).join('') || '<div class="pd">전투 기록 없음</div>';
    return;
  }

  const rows = [
    ...attackReports.map(r => ({ r, mine: true })),
    ...defenseReports.map(r => ({ r, mine: false })),
  ].sort((a, b) => (b.r.timestamp || 0) - (a.r.timestamp || 0)).slice(0, 30);

  if (!rows.length) { el.innerHTML = '<div class="pd">전투 기록 없음</div>'; return; }

  el.innerHTML = rows.map(({ r, mine }, i) => {
    const outcome = r.win ? (mine ? '승리' : '패배') : (mine ? '패배' : '방어 성공');
    const delta = mine ? r.attackerTrophyDelta : r.defenderTrophyDelta;
    const pct = Math.round((r.destructionPercent || 0) * 100);
    const who = mine ? `→ ${esc(r.defenderName)}` : `← ${esc(r.attackerName)}`;
    const lootTxt = Object.entries(r.loot || {}).slice(0, 4)
      .map(([res, a]) => `${resIcon(res)}${a}`).join(' ');
    return `<div class="log-row ${mine ? 'atk' : 'def'}">
      <div class="log-line">
        <b>${mine ? '공격' : '방어'}</b> ${who} · ${outcome} ${pct}%
        <span class="trophy">${statusIcon('trophy')}${(delta || 0) >= 0 ? '+' : ''}${delta || 0}</span>
      </div>
      ${lootTxt ? `<div class="log-loot">${mine ? '약탈' : '피해'} ${lootTxt}</div>` : ''}
      <div class="log-actions">
        ${r.replay?.deploys?.length ? `<button class="log-btn" data-replay="${i}">리플레이</button>` : ''}
        ${!mine ? `<button class="log-btn revenge" data-revenge="${i}">복수</button>` : ''}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-replay]').forEach(btn => btn.addEventListener('click', () => {
    openReplayScreen(rows[Number(btn.dataset.replay)].r, rows[Number(btn.dataset.replay)].mine);
  }));
  el.querySelectorAll('[data-revenge]').forEach(btn => btn.addEventListener('click', () => {
    const report = rows[Number(btn.dataset.revenge)].r;
    const target = peers.find(p => p.id === report.attackerId);
    if (!target) { flashMessage('상대가 접속을 끊어 지금은 복수할 수 없습니다', true); return; }
    currentMatch = target;
    attackDeck = null;
    renderWarPanel(peers);
    flashMessage(`${target.name}에게 복수 준비 — 출격 편성을 확인하세요`, false);
  }));
}

// ---------------- 실시간 습격 전투 화면 ----------------
// 실시간 소켓 서버가 없으므로, 방어자의 스냅샷(구조물·영토·병력 로스터·자원)을
// 그대로 가져와 공격자 브라우저에서 전투 전체를 시뮬레이션한다 (battle.js).
// 상대가 접속해 있지 않아도 공격할 수 있고(비동기 습격), 결과는 습격 리포트로
// 상대 앞에 남아 다음 접속 때 반영된다.
let battleSession = null;
let battleDeployKey = null;      // 배치 모드로 선택된 유닛 key
let battleRafId = null;
let battleLastTs = null;
let battleDragging = false, battleLastX = 0, battleLastY = 0, battleDragged = false;
let battlePinching = false, battlePinchStartDist = 0;
let battleIsReplay = false;      // 리플레이 재생 중이면 결과를 제출하지 않는다
let battleTargetSnapshot = null; // 이번 전투에서 싸운 상대 스냅샷

function openBattleScreen(defenderSnapshot, deck = null) {
  closeStructModal(); // 팝업이 전투 화면 위에 남지 않도록
  const useDeck = deck || { ...((game.myNation.units && game.myNation.units.attack) || {}) };
  battleSession = createBattleSession(defenderSnapshot, useDeck);
  battleIsReplay = false;
  battleTargetSnapshot = defenderSnapshot;
  showBattleScreen(`습격 중: ${defenderSnapshot.name}`);
}

/**
 * 리플레이 재생. 방어 기록에서는 "내 기지가 어떻게 뚫렸는지",
 * 공격 기록에서는 "내가 어떻게 밀었는지"를 그대로 다시 본다.
 * 결과는 이미 반영된 것이라 다시 제출하지 않는다.
 */
function openReplayScreen(report, mine) {
  closeStructModal();
  // 무대는 리포트에 함께 담긴 그때의 기지 배치다 (그 뒤에 기지를 고쳐도 그때 그대로 재생된다).
  // 옛 기록이라 배치가 없으면 지금 알고 있는 기지로 대신한다.
  const base = report.replay?.base
    || (mine ? peers.find(p => p.id === report.defenderId) : null)
    || defenseSnapshot(game.myNation);
  battleSession = createReplaySession(base, report.replay);
  battleIsReplay = true;
  battleTargetSnapshot = base;
  showBattleScreen(`리플레이: ${mine ? report.defenderName : report.attackerName}의 습격`);
}

function showBattleScreen(title) {
  battleDeployKey = null;
  battleLastTs = null;

  document.getElementById('app').classList.add('hidden');
  document.getElementById('battle-screen').classList.remove('hidden');
  document.getElementById('battle-defender-name').textContent = title.replace(/^[^:]*: /, '');
  document.querySelector('.battle-title').firstChild.textContent = title.includes('리플레이') ? '리플레이: ' : '습격 중: ';
  document.getElementById('battle-result').classList.add('hidden');
  document.getElementById('battle-hint').classList.toggle('hidden', battleIsReplay);
  document.getElementById('battle-deck-tray').classList.toggle('hidden', battleIsReplay);

  battleRenderer.resize();
  const capital = battleSession.structures.find(s => s.key === 'capital');
  battleRenderer.centerOn(capital ? capital.cx : 0, capital ? capital.cy : 0);

  if (!battleIsReplay) renderDeckTray();
  if (battleRafId) cancelAnimationFrame(battleRafId);
  battleRafId = requestAnimationFrame(battleLoop);
}

function battleLoop(ts) {
  if (!battleSession) return;
  if (battleLastTs == null) battleLastTs = ts;
  const dt = Math.min(0.1, Math.max(0, (ts - battleLastTs) / 1000)); // 탭 비활성 등으로 인한 큰 시간 점프 방지
  battleLastTs = ts;

  if (!battleSession.ended) {
    if (battleIsReplay) stepReplay(battleSession, dt);
    else stepBattle(battleSession, dt);
  }

  battleRenderer.resize();
  battleRenderer.draw(battleSession);
  updateBattleHud();

  if (battleSession.ended) {
    finishBattle();
    return;
  }
  battleRafId = requestAnimationFrame(battleLoop);
}

function updateBattleHud() {
  const t = Math.ceil(battleSession.timeLeft);
  const m = Math.floor(t / 60), s = t % 60;
  const timerEl = document.getElementById('battle-timer');
  timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  timerEl.classList.toggle('low', t <= 20);
  document.getElementById('battle-destruction').textContent = `파괴율 ${Math.round(getDestructionPercent(battleSession) * 100)}%`;
  // 덱 트레이(하단 유닛 버튼)는 여기서 매 프레임 다시 그리지 않는다 — 배치 성공/실패 시에만
  // renderDeckTray()를 호출한다. 매 프레임 innerHTML을 새로 그리면 버튼 DOM이 계속
  // 교체되어 탭 입력이 유실될 수 있다.
}

function renderDeckTray() {
  const tray = document.getElementById('battle-deck-tray');
  const entries = Object.entries(battleSession.deck);
  tray.innerHTML = entries.length ? entries.map(([key, count]) => {
    const unit = UNITS.attack[key];
    if (!unit) return '';
    const active = battleDeployKey === key;
    return `<button class="deck-unit-btn${active ? ' active' : ''}" data-unit="${key}" ${count <= 0 ? 'disabled' : ''}>
      ${unitArtIcon(key, 'deck-unit-art')}
      <span class="nm">${unit.name}</span><span class="cnt">${count}기 남음</span>
    </button>`;
  }).join('') : '<div class="pd">배치할 공격 유닛이 없습니다</div>';
  tray.querySelectorAll('.deck-unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      battleDeployKey = battleDeployKey === btn.dataset.unit ? null : btn.dataset.unit;
      renderDeckTray();
    });
  });
}

function battlePointerDown(x, y) { battleDragging = true; battleDragged = false; battleLastX = x; battleLastY = y; }
function battlePointerMove(x, y) {
  const rect = battleCanvas.getBoundingClientRect();
  battleRenderer.hover = battleRenderer.screenToWorld(x - rect.left, y - rect.top);
  if (battleDragging) {
    const dx = x - battleLastX, dy = y - battleLastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) battleDragged = true;
    battleRenderer.pan(dx, dy);
    battleLastX = x; battleLastY = y;
  }
}
function battlePointerUp() { battleDragging = false; }

function battleHandleTap(clientX, clientY) {
  if (!battleSession || battleSession.ended) return;
  if (!battleDeployKey) { flashMessage('먼저 하단에서 소환할 유닛을 고르세요', true); return; }
  const rect = battleCanvas.getBoundingClientRect();
  const { x, y } = battleRenderer.screenToWorld(clientX - rect.left, clientY - rect.top);
  const res = deployUnit(battleSession, battleDeployKey, x, y);
  if (!res.ok) { flashMessage(res.error, true); return; }
  renderDeckTray();
}

battleCanvas.addEventListener('mousedown', (e) => battlePointerDown(e.clientX, e.clientY));
window.addEventListener('mouseup', battlePointerUp);
battleCanvas.addEventListener('mousemove', (e) => battlePointerMove(e.clientX, e.clientY));
battleCanvas.addEventListener('click', (e) => { if (!battleDragged) battleHandleTap(e.clientX, e.clientY); });

battleCanvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 2) {
    battlePinching = true; battleDragging = false;
    const [t1, t2] = e.touches;
    battlePinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  } else if (e.touches.length === 1) {
    battlePinching = false;
    battlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });
battleCanvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (battlePinching && e.touches.length === 2) {
    const [t1, t2] = e.touches;
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const rect = battleCanvas.getBoundingClientRect();
    const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
    const midY = (t1.clientY + t2.clientY) / 2 - rect.top;
    battleRenderer.zoomAt(midX, midY, (dist - battlePinchStartDist) * 0.15);
    battlePinchStartDist = dist;
  } else if (e.touches.length === 1) {
    battlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });
battleCanvas.addEventListener('touchend', (e) => {
  if (battlePinching) { battlePinching = false; battleDragged = true; return; }
  if (!battleDragged && e.changedTouches.length === 1) {
    battleHandleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  }
  battleDragging = false;
});

document.getElementById('battle-zoom-in-btn').addEventListener('click', () => {
  battleRenderer.zoomAt(battleCanvas.width / 2, battleCanvas.height / 2, 4);
});
document.getElementById('battle-zoom-out-btn').addEventListener('click', () => {
  battleRenderer.zoomAt(battleCanvas.width / 2, battleCanvas.height / 2, -4);
});
document.getElementById('battle-retreat-btn').addEventListener('click', () => {
  if (!battleSession || battleSession.ended) return;
  retreatBattle(battleSession);
});

async function finishBattle() {
  const result = battleSession.result;
  const defenderId = battleSession.defenderId;
  document.getElementById('battle-hint').classList.add('hidden');

  const title = document.getElementById('battle-result-title');
  const body = document.getElementById('battle-result-body');
  const closeBtn = document.getElementById('battle-result-close');
  const lootTxt = Object.entries(result.loot).map(([r, a]) => `${resIcon(r)}${a}`).join(' ') || '없음';
  const pct = Math.round(result.destructionPercent * 100);

  closeBtn.onclick = () => {
    document.getElementById('battle-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('battle-deck-tray').classList.remove('hidden');
    battleSession = null;
    if (!battleIsReplay) { currentMatch = null; attackDeck = null; }
    battleIsReplay = false;
    renderWarPanel(peers);
    renderBattleLog(null);
  };
  document.getElementById('battle-result').classList.remove('hidden');

  // 리플레이는 이미 끝난 전투를 다시 본 것이라 아무것도 반영하지 않는다
  if (battleIsReplay) {
    title.textContent = '리플레이 종료';
    title.className = 'battle-result-title';
    body.innerHTML = `파괴율 <b>${pct}%</b><br><span class="dim">지난 전투를 다시 본 것이라 결과는 반영되지 않습니다</span>`;
    return;
  }

  title.textContent = result.win ? (result.perfectVictory ? '완벽한 승리!' : '승리') : '패배';
  title.className = `battle-result-title ${result.win ? 'win' : 'lose'}`;
  body.innerHTML = `파괴율 <b>${pct}%</b><br>약탈(예상) ${lootTxt}<br>결과를 반영하는 중...`;

  // 서버 권위 모드: 예전처럼 Cloud Function이 양쪽을 다 반영한다
  if (game.serverAuthoritative) {
    const res = await callRaidResult(defenderId, result);
    if (res.error) {
      body.innerHTML = `파괴율 <b>${pct}%</b><br>약탈(예상) ${lootTxt}<br>
        <span style="color:var(--danger)">서버 반영 실패: ${res.error}</span>`;
    } else {
      const trophyTxt = typeof res.trophyDelta === 'number' ? `${statusIcon('trophy')}${res.trophyDelta >= 0 ? '+' : ''}${res.trophyDelta}` : '';
      body.innerHTML = `파괴율 <b>${Math.round((res.destructionPercent ?? result.destructionPercent) * 100)}%</b><br>
        약탈 ${lootTxt}<br>트로피 ${trophyTxt}`;
    }
    return;
  }

  // mpNet 모드(local/firestore): 내 몫을 먼저 반영하고, 상대 앞으로 리포트를 남긴다.
  // 상대가 접속해 있지 않아도 다음에 접속할 때 자기 몫을 반영한다.
  const report = buildRaidReport(game.myNation, battleTargetSnapshot || { id: defenderId }, battleSession);
  const { gained } = applyRaidToAttacker(game.myNation, report);
  attackReports.unshift(report);
  if (attackReports.length > 30) attackReports.length = 30;

  let sendErr = null;
  if (net) {
    try { await net.sendRaid(report); } catch (e) { sendErr = e.message || '전송 실패'; }
  }
  publishMyNation();
  renderResourcePanel();

  const gainTxt = Object.entries(gained).map(([r, a]) => `${resIcon(r)}${a}`).join(' ') || '없음';
  body.innerHTML = `파괴율 <b>${pct}%</b><br>
    획득 ${gainTxt}<br>
    트로피 ${statusIcon('trophy')}${report.attackerTrophyDelta >= 0 ? '+' : ''}${report.attackerTrophyDelta}
    ${sendErr ? `<br><span style="color:var(--danger)">상대에게 결과 전달 실패: ${sendErr}</span>`
              : '<br><span class="dim">상대에게 습격 기록을 남겼습니다</span>'}`;
}

// ---------- 여행(원정) 패널 ----------
// 인력을 들여 원정을 보내면 일정 시간 뒤 자원과 새 작물/가축/요리법을 얻는다.
function renderTravelPanel() {
  const el = document.getElementById('travel-panel');
  if (!el || !game.myNation) return;
  const n = game.myNation;
  const labor = Math.floor(n.resources.labor || 0);

  if (n.expedition && n.expedition.key) {
    const exp = EXPEDITIONS[n.expedition.key];
    const total = exp?.ticks || 1;
    const done = Math.max(0, total - n.expedition.ticksLeft);
    const pct = Math.round((done / total) * 100);
    el.innerHTML = `<div class="pd">${resIcon('labor')} 인력 ${labor}</div>
      <div class="pd"><b>${exp?.name || n.expedition.key}</b> 진행 중 — 남은 ${n.expedition.ticksLeft}틱</div>
      <div class="invbar"><div class="invbar-fill" style="width:${pct}%"></div></div>`;
    return;
  }

  const farms = game.myNation.structures.filter(s2 => s2.key === 'farm');
  const laborRate = farms.reduce((a, f) => a + (STRUCTURES.farm.laborIncome || 0) * f.level, 0);
  let html = `<div class="pd">${resIcon('labor')} 인력 ${labor} <span class="dim">(농지 ${farms.length}개 · +${laborRate}/틱)</span></div>`;
  if (!farms.length) html += `<div class="pd err">인력은 농지에서만 나옵니다 — 물가에 농지를 지으세요</div>`;
  const capLevel = getCapitalLevel(n);
  for (const [key, exp] of Object.entries(EXPEDITIONS)) {
    const lvOk = capLevel >= (exp.capitalLevel || 1);
    const laborOk = labor >= exp.labor;
    const disabled = !lvOk || !laborOk;
    const why = !lvOk ? `수도 레벨 ${exp.capitalLevel} 필요` : (!laborOk ? `인력 ${exp.labor} 필요` : '');
    html += `<div class="travel-item${disabled ? ' locked' : ''}">
      <div class="travel-name">${lvOk ? '' : '🔒 '}${exp.name}</div>
      <div class="travel-desc">${exp.desc}</div>
      <div class="travel-meta">${resIcon('labor')}${exp.labor} · ${exp.ticks}틱 · 보상 ${
        Object.entries(exp.rewards).map(([r, a]) => `${resIcon(r)}${a}`).join(' ')}</div>
      <button class="travel-btn" data-exp="${key}" ${disabled ? `disabled title="${why}"` : ''}>출발</button>
    </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.travel-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.exp;
      const res = await dispatch(
        () => ({ error: game.myNation.startExpedition(key) }),
        () => callStartExpedition(key));
      if (res.error) flashMessage(res.error, true);
      else flashMessage(`${EXPEDITIONS[key].name} 출발!`, false);
      renderTravelPanel();
    });
  });
}

// 여행이 끝나면 한 번만 알림을 띄운다
let lastExpeditionSeen = null;
function checkExpeditionDone() {
  const done = game.myNation && game.myNation.lastExpedition;
  if (!done || done === lastExpeditionSeen) return;
  lastExpeditionSeen = done;
  const gained = Object.entries(done.gained || {}).map(([r, a]) => `${RESOURCES[r]?.name || r} +${a}`).join(', ');
  const unlocked = (done.unlocks || []).map(u => {
    const [kind, name] = u.split(':');
    if (kind === 'crop') return CROPS[name]?.name;
    if (kind === 'animal') return ANIMALS[name]?.name;
    return RESOURCES[name]?.name || name;
  }).filter(Boolean).join(', ');
  flashMessage(`여행 완료: ${done.name}${gained ? ' — ' + gained : ''}${unlocked ? ' | 새로 획득: ' + unlocked : ''}`, false);
}

// ---------- 자원 패널 ----------
/**
 * 상단 자원 표시줄.
 * 자원 종류가 80가지가 넘어가면서 "지금 가진 것"만 띄우면 순서가 계속 바뀌어
 * 눈으로 좇기 어려웠다. 이제 **한 번이라도 손에 넣어 본 자원(해금된 자원)**을
 * 정해진 순서(RESOURCES 정의 순 = 기초 → 가공 → 식품 → 군수)로 고정 배치하고,
 * 지금 0이면 흐리게 표시한다.
 */
function renderResourcePanel() {
  const el = document.getElementById('resource-bar');
  if (!game.myNation) { el.innerHTML = ''; return; }
  const res = game.myNation.resources;
  for (const k of Object.keys(RESOURCES)) if (res[k] > 0) seenResources.add(k);
  const keys = Object.keys(RESOURCES).filter(k => seenResources.has(k));
  let html = keys.map(k =>
    `<span class="res${res[k] > 0 ? '' : ' empty'}" title="${RESOURCES[k].name}">${resIcon(k)}${Math.floor(res[k] || 0)}</span>`).join('');
  html += `<span class="res" title="트로피">${statusIcon('trophy')} ${game.myNation.trophies || 0}</span>`;
  const shieldMs = (game.myNation.shieldUntil || 0) - Date.now();
  if (shieldMs > 0) {
    const h = Math.floor(shieldMs / 3600000), m = Math.floor((shieldMs % 3600000) / 60000);
    html += `<span class="res teal" title="보호막 남은 시간">${statusIcon('shield')} ${h}시간 ${m}분</span>`;
  }
  el.innerHTML = html;
}

// ---------- 건국 단계: 화면에 보이는 수도 후보 칸 갱신 ----------
// 매 프레임 다시 계산하면 낭비라, 보이는 타일 범위가 실제로 바뀌었을 때만 다시 찾는다.
let lastCapitalViewKey = null;
function updateCapitalSites() {
  if (!pendingNation || game.myNation) {
    renderer.capitalSites = null;
    lastCapitalViewKey = null;
    return;
  }
  const x0 = Math.floor(renderer.originX), y0 = Math.floor(renderer.originY);
  const x1 = x0 + Math.ceil(canvas.width / renderer.tile);
  const y1 = y0 + Math.ceil(canvas.height / renderer.tile);
  const key = `${x0},${y0},${x1},${y1}`;
  if (key === lastCapitalViewKey) return;
  lastCapitalViewKey = key;
  renderer.capitalSites = findCapitalSites(x0, y0, x1, y1);
}

// ---------- 건설 미리보기(고스트) ----------
// 커서/마지막 터치 지점에 배치 결과를 매 프레임 다시 계산해 보여준다.
// (자원이 틱마다 변해 "자원 부족" 여부가 바뀌므로 매 프레임 재검증한다)
/**
 * 고스트와 "설치" 바를 현재 건설 목표 칸(buildTarget) 기준으로 갱신한다.
 * 고스트는 손을 떼도 그 자리에 남아 있어야 설치 버튼을 누를 수 있으므로,
 * 마우스 hover가 아니라 buildTarget을 따라간다.
 */
function updateBuildPreview() {
  const bar = document.getElementById('build-bar');
  const hintEl = document.getElementById('preview-hint');
  if (!game.myNation || !selectedStruct || !buildTarget) {
    renderer.buildPreview = null;
    if (bar) bar.classList.add('hidden');
    if (hintEl) { hintEl.textContent = ''; hintEl.className = 'preview-hint'; }
    return;
  }
  const { x, y } = buildTarget;
  const def = STRUCTURES[selectedStruct];
  const check = validatePlacement(game.myNation, selectedStruct, x, y);
  renderer.buildPreview = {
    key: selectedStruct, x, y, dir: beltDir,
    ok: check.ok, error: check.error,
    territoryRadius: def.territoryRadius || 0,
    powerRadius: def.powerRadius || 0,
  };

  // 자원 노드를 깔고 앉으면 그 노드는 영영 못 쓴다 (철거 수단이 없다).
  // 막지는 않되 반드시 알려준다 — 광산 자리를 창고로 덮는 실수가 흔하다.
  const buried = def.requiresNode ? [] : buriedNodes(x, y, def.footprint);
  const buriedNames = buried.map(k => TERRAIN_NODES[k]?.name || k).join(', ');

  // 필드 위 설치 바 — 무엇을 어디에 짓는지와 지금 지을 수 있는지를 보여준다
  if (bar) {
    bar.classList.remove('hidden');
    document.getElementById('build-bar-art').src = structureIcon(selectedStruct);
    document.getElementById('build-bar-name').textContent =
      `${def.name}${isRotatable(selectedStruct) ? ` ${DIR_ARROW[beltDir]}` : ''} (${x}, ${y})`;
    const st = document.getElementById('build-bar-status');
    if (!check.ok) { st.textContent = check.error; st.className = 'build-bar-status err'; }
    else if (buried.length) { st.textContent = `⚠ ${buriedNames}을(를) 덮습니다 (되돌릴 수 없음)`; st.className = 'build-bar-status warn'; }
    else { st.textContent = '설치할 수 있습니다'; st.className = 'build-bar-status ok'; }
    document.getElementById('build-confirm').disabled = !check.ok;
  }

  // 좌측 패널 비용 줄에도 같은 사유를 남긴다
  if (hintEl) {
    hintEl.textContent = !check.ok ? `(${x}, ${y}) ${check.error}`
      : (buried.length ? `(${x}, ${y}) ⚠ ${buriedNames} 위 — 그 자원을 못 쓰게 됩니다`
                       : `(${x}, ${y}) 건설 가능`);
    hintEl.className = `preview-hint ${!check.ok ? 'err' : (buried.length ? 'warn' : 'ok')}`;
  }
}

// ---------- 메인 루프 ----------
function loop() {
  renderer.resize();
  updateCapitalSites();
  updateBuildPreview();
  renderer.draw();
  renderResourcePanel();
  checkExpeditionDone();
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => renderer.resize());

// 브라우저 콘솔에서 상태를 들여다보기 위한 디버그 훅 (빌드 도구 없는 프로토타입이라
// 자동화 테스트도 이 훅으로 게임 상태를 확인한다)
window.__game = game;
window.__showStruct = showStructPanel;
window.__renderer = renderer;
// 전투 멀티플레이 훅 — 두 탭이 실제로 싸우는지 자동 테스트에서 확인한다
window.__mp = {
  get net() { return net; },
  get mode() { return netMode; },
  get peers() { return peers; },
  get session() { return battleSession; },
  get defenseReports() { return defenseReports; },
  get attackReports() { return attackReports; },
  publish: publishMyNation,
  refreshWar: () => renderWarPanel(peers),
  deploy: (key, x, y) => deployUnit(battleSession, key, x, y),
  endNow: () => retreatBattle(battleSession),
};

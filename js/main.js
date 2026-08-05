// ============================================================
// main.js — UI 배선. 키보드 없는 터치 기기를 기본으로 가정하고 만들었다:
//   - 지도 이동: 한 손가락 드래그 (마우스 드래그도 동일하게 동작)
//   - 확대/축소: 두 손가락 핀치, 또는 우측 하단 [+][-] 버튼 (휠도 지원)
//   - 탭(드래그가 아닌 짧은 터치): 건설/선택
//   - 벨트 회전 · 전력범위 표시: 화면 우측 하단 버튼 (R/P 키보드도 병행 지원)
// ============================================================
import { STRUCTURES, RESOURCES, STATUS_ICONS, TECH_TREE, DIR_ARROW, WAR, UNITS, TERRAIN_NODES, CAPITAL_REQUIRED_NODES, structureIcon,
         LOGISTICS, getStorageCapacity, getOutputCapacity, getUpgradeCost, getStructureMaxHp, beltThroughput } from './data.js';
import { Game, Nation } from './game.js';
import { Renderer } from './render.js';
import { BattleRenderer } from './battleRender.js';
import { createBattleSession, deployUnit, stepBattle, retreat as retreatBattle, getDestructionPercent } from './battle.js';
import { getTile } from './world.js';
import { findMatch, isShielded, getDefensePower, capitalSiteReport, validatePlacement, findCapitalSites, findNearestCapitalSite,
         storedTotal, manualMoveToStorage, manualMoveToStructure, manualOperate, getTerritoryRadius, getCapitalLevel } from './logic.js';
import { FUNCTIONS_DEPLOYED } from './firebase-config.js';
import {
  initFirebase, isMultiplayer, watchNations, watchBattles, watchMyNation,
  callInitNation, callBuild, callUpgrade, callSetRecipe, callStartResearch, callRecruitUnit, callRaidResult,
} from './multiplayer.js';

const game = new Game();
const canvas = document.getElementById('field');
const renderer = new Renderer(canvas, game);

const battleCanvas = document.getElementById('battle-field');
const battleRenderer = new BattleRenderer(battleCanvas);

// 자원/상태 아이콘을 <img> 태그로 뽑아주는 헬퍼 (이모지 대신 assets/icons/*.svg 사용)
const resIcon = (key) => `<img class="ic" src="${RESOURCES[key]?.icon || ''}" alt="${RESOURCES[key]?.name || key}">`;
const statusIcon = (key) => `<img class="ic" src="${STATUS_ICONS[key]}" alt="${key}">`;

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
  document.getElementById('touch-toolbar').classList.remove('hidden');

  buildBuildMenu();
  game.startLoop();
  initMultiplayer(name, color, x, y);

  pendingNation = null;
  selectedCapital = null;
});

async function initMultiplayer(name, color, cx, cy) {
  const statusEl = document.getElementById('mp-status');

  if (!FUNCTIONS_DEPLOYED) {
    statusEl.innerHTML = '<span class="dot off"></span> 로컬 모드 (Cloud Functions 미배포)';
    return; // Functions 배포 전에는 Firebase 연결 자체를 시도하지 않는다 (안전한 폴백)
  }

  const ok = await initFirebase();
  if (!ok) { statusEl.innerHTML = '<span class="dot off"></span> 로컬 모드 (firebase-config.js 미설정)'; return; }

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

// ---------- 건설 메뉴 ----------
function buildBuildMenu() {
  const menu = document.getElementById('build-menu');
  menu.innerHTML = '';
  for (const [key, def] of Object.entries(STRUCTURES)) {
    const btn = document.createElement('button');
    btn.className = 'build-item';
    btn.disabled = !game.myNation.unlocked.has(key);
    btn.innerHTML = `<img class="sic" src="${structureIcon(key)}" alt=""><span class="nm">${def.name}</span><span class="vol">부피 ${def.volume}</span>`;
    btn.title = def.desc;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.build-item.active').forEach(b => b.classList.remove('active'));
      const rotateBtn = document.getElementById('rotate-btn');
      if (selectedStruct === key) {
        selectedStruct = null;
        rotateBtn.disabled = true;
        return;
      }
      selectedStruct = key;
      btn.classList.add('active');
      rotateBtn.disabled = (key !== 'belt');
      renderCostPreview(def);
    });
    menu.appendChild(btn);
  }
}

function renderCostPreview(def) {
  const el = document.getElementById('cost-preview');
  const parts = Object.entries(def.baseCost).map(([r, a]) => `${resIcon(r)} ${RESOURCES[r]?.name || r} ${a}`);
  let html = parts.length ? `건설 비용: ${parts.join(' · ')}` : '건설 비용 없음';
  if (def === STRUCTURES.belt) html += `  ·  방향 ${DIR_ARROW[beltDir]} (우측 하단 ⟳ 버튼으로 회전)`;
  el.innerHTML = html;
}

// ---------- 터치 툴바 버튼 (회전 / 전력범위 / 줌) ----------
document.getElementById('rotate-btn').addEventListener('click', () => {
  if (selectedStruct !== 'belt') return;
  beltDir = (beltDir + 1) % 4;
  renderCostPreview(STRUCTURES.belt);
});
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
  if (e.key.toLowerCase() === 'r' && selectedStruct === 'belt') {
    beltDir = (beltDir + 1) % 4;
    renderCostPreview(STRUCTURES.belt);
  }
  if (e.key.toLowerCase() === 'p') {
    renderer.showPower = !renderer.showPower;
    document.getElementById('power-btn').classList.toggle('active', renderer.showPower);
  }
});

// ---------- 캔버스 조작: 마우스 + 터치(팬/탭/핀치줌) 공용 ----------
let dragging = false, lastX = 0, lastY = 0, dragged = false;
let pinching = false, pinchStartDist = 0;

function pointerDown(x, y) { dragging = true; dragged = false; lastX = x; lastY = y; }
function pointerMove(x, y) {
  const rect = canvas.getBoundingClientRect();
  renderer.hover = renderer.screenToWorld(x - rect.left, y - rect.top);
  if (dragging) {
    const dx = x - lastX, dy = y - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
    renderer.pan(dx, dy);
    lastX = x; lastY = y;
  }
}
function pointerUp() { dragging = false; }
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

  if (selectedStruct) {
    if (isMultiplayer()) {
      const res = await callBuild(selectedStruct, x, y, beltDir);
      if (res.error) flashMessage(res.error, true);
      else flashMessage(`${STRUCTURES[selectedStruct].name} 건설 요청 완료`, false);
    } else {
      const err = game.myNation.build(selectedStruct, x, y, beltDir);
      if (err) flashMessage(err, true);
      else { flashMessage(`${STRUCTURES[selectedStruct].name} 건설 완료`, false); buildBuildMenu(); }
    }
    return;
  }

  const clicked = game.myNation.structures.find(s => {
    const def = STRUCTURES[s.key];
    const [w, h] = def.footprint;
    return x >= s.x && x < s.x + w && y >= s.y && y < s.y + h;
  });
  showStructPanel(clicked || null, x, y);
}

// 마우스
canvas.addEventListener('mousedown', (e) => pointerDown(e.clientX, e.clientY));
window.addEventListener('mouseup', pointerUp);
canvas.addEventListener('mousemove', (e) => pointerMove(e.clientX, e.clientY));
canvas.addEventListener('click', (e) => { if (!dragged) handleTap(e.clientX, e.clientY); });

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
  if (pinching) { pinching = false; dragged = true; return; }
  if (!dragged && e.changedTouches.length === 1) {
    handleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  }
  dragging = false;
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
    btn.addEventListener('click', () => {
      const res = manualMoveToStorage(game.myNation, struct.id, btn.dataset.moveOut);
      if (!res.ok) flashMessage(res.error, true);
      else flashMessage(`${RESOURCES[btn.dataset.moveOut]?.name} ${res.moved} 창고로 이송`, false);
      refresh();
    });
  });
  panel.querySelectorAll('[data-move-in]').forEach(btn => {
    btn.addEventListener('click', () => {
      const res = manualMoveToStructure(game.myNation, struct.id, btn.dataset.moveIn);
      if (!res.ok) flashMessage(res.error, true);
      else flashMessage(`${RESOURCES[btn.dataset.moveIn]?.name} ${res.moved} 투입`, false);
      refresh();
    });
  });

  // 수동 운용: 누르고 있는 동안 일정 간격으로 1사이클씩 돌린다
  const opBtn = panel.querySelector('#manual-op-btn');
  if (opBtn) {
    const statusEl = panel.querySelector('#manual-op-status');
    let timer = null;
    const runOnce = () => {
      const res = manualOperate(game.myNation, struct.id);
      if (!res.ok) {
        if (statusEl) { statusEl.textContent = res.error; statusEl.className = 'pd err'; }
        stop();
        return;
      }
      const made = Object.entries(res.produced || {}).map(([r, a]) => `${RESOURCES[r]?.name || r} +${a}`).join(', ');
      if (statusEl) { statusEl.textContent = `가동 중… ${made}`; statusEl.className = 'pd ok'; }
      renderResourcePanel();
    };
    const start = (e) => {
      e.preventDefault();
      if (timer) return;
      opBtn.classList.add('active');
      runOnce();
      timer = setInterval(runOnce, LOGISTICS.manualOperateMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer); timer = null;
      opBtn.classList.remove('active');
      refresh(); // 인벤토리 표시 갱신
    };
    opBtn.addEventListener('mousedown', start);
    opBtn.addEventListener('touchstart', start, { passive: false });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => opBtn.addEventListener(ev, stop));
    // 패널이 사라지거나 창을 벗어나도 타이머가 남지 않도록
    window.addEventListener('blur', stop);
  }
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
  if (struct.key === 'belt') add('처리량', beltThroughput(cur), beltThroughput(next), '/틱');

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

  if (def.recipes) {
    html += `<div class="pd">레시피 선택:</div><div class="recipe-list">`;
    for (const key of Object.keys(def.recipes)) {
      const active = struct.recipe === key ? 'active' : '';
      const label = RESOURCES[key]?.name || key;
      html += `<button class="recipe-btn ${active}" data-recipe="${key}">${label}</button>`;
    }
    html += `</div>`;
  }

  html += renderUpgradeHtml(struct, def);

  const body = document.getElementById('struct-modal-body');
  body.innerHTML = html;
  body.scrollTop = 0;
  modal.classList.remove('hidden');
  wireInventoryActions(body, struct, x, y);

  body.querySelectorAll('.recipe-btn').forEach(btn => {
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
  body.querySelectorAll('.recruit-btn').forEach(btn => {
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
  const fmtEquip = (equip) => Object.entries(equip).map(([r, a]) => `${resIcon(r)}${a}`).join(' ');

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
    ...Object.entries(roster.attack || {}).map(([k, c]) => `${UNITS.attack[k]?.name || k} ×${c}`),
    ...Object.entries(roster.defense || {}).map(([k, c]) => `${UNITS.defense[k]?.name || k} ×${c}`),
  ].join(', ');
  html += `<div class="pd">보유 병력: ${rosterTxt || '없음'}</div>`;

  html += `<div class="pd">공격 유닛 모집:</div><div class="recipe-list">`;
  for (const [key, unit] of Object.entries(UNITS.attack)) {
    html += `<button class="recipe-btn recruit-btn" data-unit="${key}" data-defense="0">${unit.name} · ${resIcon('gold')}${unit.gold} · ${fmtEquip(unit.equip)}</button>`;
  }
  html += `</div><div class="pd">수비 유닛 모집:</div><div class="recipe-list">`;
  for (const [key, unit] of Object.entries(UNITS.defense)) {
    html += `<button class="recipe-btn recruit-btn" data-unit="${key}" data-defense="1">${unit.name} · ${resIcon('gold')}${unit.gold} · ${fmtEquip(unit.equip)}</button>`;
  }
  html += `</div>`;
  return html;
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

function renderWarPanel(nations) {
  knownNations = nations;
  const el = document.getElementById('war-list');
  if (currentMatch && !nations.some(n => n.id === currentMatch.id)) currentMatch = null;
  el.innerHTML = `
    <div class="pd">주변 국가 ${nations.length}개 발견됨</div>
    <button id="find-match-btn" class="find-match-btn">⚔️ 상대 찾기</button>
    <div id="match-card"></div>
  `;
  document.getElementById('find-match-btn').addEventListener('click', () => {
    if (!game.myNation) return;
    const now = Date.now();
    if (isShielded(game.myNation, now)) {
      flashMessage('내 보호막이 켜져 있는 동안은 공격하면 보호막이 사라집니다. 그래도 공격할까요?', false);
    }
    currentMatch = findMatch(game.myNation, knownNations, now);
    renderMatchCard();
  });
  renderMatchCard();
}

function renderMatchCard() {
  const el = document.getElementById('match-card');
  if (!el) return;
  if (!currentMatch) {
    el.innerHTML = knownNations.length
      ? '<div class="pd">상대 찾기 버튼을 눌러 트로피가 비슷한 국가를 찾아보세요.</div>'
      : '<div class="pd">아직 발견된 다른 국가가 없습니다.</div>';
    return;
  }
  const n = currentMatch;
  const myAttackUnits = Object.entries((game.myNation.units && game.myNation.units.attack) || {}).filter(([, c]) => c > 0);
  const hasArmy = myAttackUnits.length > 0;
  el.innerHTML = `
    <div class="match-card">
      <div class="match-head">
        <span class="dot" style="background:${n.color}"></span>
        <span class="nm">${n.name}</span>
        <span class="trophy">${statusIcon('trophy')} ${n.trophies || 0}</span>
      </div>
      <div class="pd">예상 방어력 ${getDefensePower(n)} · 약탈량은 실제 파괴율에 비례합니다</div>
      <div class="match-actions">
        <button id="attack-match-btn" class="atk-btn" ${hasArmy ? '' : 'disabled title="전초기지에서 공격 유닛을 먼저 모집하세요"'}>공격</button>
        <button id="skip-match-btn" class="skip-btn">다른 상대</button>
      </div>
    </div>`;
  document.getElementById('attack-match-btn').addEventListener('click', () => {
    if (!hasArmy) return;
    openBattleScreen(currentMatch);
  });
  document.getElementById('skip-match-btn').addEventListener('click', () => {
    currentMatch = findMatch(game.myNation, knownNations, Date.now());
    renderMatchCard();
  });
}

function renderBattleLog(list) {
  const el = document.getElementById('battle-log');
  el.innerHTML = list.map(b => {
    const mine = b.attackerId === game.myNation.id;
    const outcome = b.win ? (mine ? '승리' : '패배') : (mine ? '패배' : '승리');
    const trophyTxt = mine && typeof b.trophyDelta === 'number' ? ` (${statusIcon('trophy')}${b.trophyDelta >= 0 ? '+' : ''}${b.trophyDelta})` : '';
    return `<div class="log-row">${mine ? '내가 공격' : '상대가 공격'} → <b>${outcome}</b>${trophyTxt}</div>`;
  }).join('') || '<div class="pd">전투 기록 없음</div>';
}

// ---------------- 실시간 습격 전투 화면 ----------------
// 실시간 소켓 서버가 없는 프로토타입이라, 방어자의 스냅샷(구조물·영토·병력
// 로스터·자원)을 그대로 가져와 공격자 브라우저에서 전투 전체를 시뮬레이션한다
// (battle.js). 서버에는 최종 결과(파괴율·약탈량)만 제출해 검증 후 반영된다.
let battleSession = null;
let battleDeployKey = null;      // 배치 모드로 선택된 유닛 key
let battleRafId = null;
let battleLastTs = null;
let battleDragging = false, battleLastX = 0, battleLastY = 0, battleDragged = false;
let battlePinching = false, battlePinchStartDist = 0;

function openBattleScreen(defenderSnapshot) {
  closeStructModal(); // 팝업이 전투 화면 위에 남지 않도록
  const deck = { ...((game.myNation.units && game.myNation.units.attack) || {}) };
  battleSession = createBattleSession(defenderSnapshot, deck);
  battleDeployKey = null;
  battleLastTs = null;

  document.getElementById('app').classList.add('hidden');
  document.getElementById('battle-screen').classList.remove('hidden');
  document.getElementById('battle-defender-name').textContent = defenderSnapshot.name;
  document.getElementById('battle-result').classList.add('hidden');
  document.getElementById('battle-hint').classList.remove('hidden');

  battleRenderer.resize();
  const capital = battleSession.structures.find(s => s.key === 'capital');
  battleRenderer.centerOn(capital ? capital.cx : 0, capital ? capital.cy : 0);

  renderDeckTray();
  if (battleRafId) cancelAnimationFrame(battleRafId);
  battleRafId = requestAnimationFrame(battleLoop);
}

function battleLoop(ts) {
  if (!battleSession) return;
  if (battleLastTs == null) battleLastTs = ts;
  const dt = Math.min(0.1, Math.max(0, (ts - battleLastTs) / 1000)); // 탭 비활성 등으로 인한 큰 시간 점프 방지
  battleLastTs = ts;

  if (!battleSession.ended) stepBattle(battleSession, dt);

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
  title.textContent = result.win ? (result.perfectVictory ? '완벽한 승리!' : '승리') : '패배';
  title.className = `battle-result-title ${result.win ? 'win' : 'lose'}`;
  const lootTxt = Object.entries(result.loot).map(([r, a]) => `${resIcon(r)}${a}`).join(' ') || '없음';
  body.innerHTML = `
    파괴율 <b>${Math.round(result.destructionPercent * 100)}%</b><br>
    약탈(예상) ${lootTxt}<br>
    서버에 결과를 제출하는 중...`;
  document.getElementById('battle-result').classList.remove('hidden');

  const res = await callRaidResult(defenderId, result);
  if (res.error) {
    body.innerHTML = `
      파괴율 <b>${Math.round(result.destructionPercent * 100)}%</b><br>
      약탈(예상) ${lootTxt}<br>
      <span style="color:var(--danger)">서버 반영 실패: ${res.error}</span>`;
  } else {
    const trophyTxt = typeof res.trophyDelta === 'number' ? `${statusIcon('trophy')}${res.trophyDelta >= 0 ? '+' : ''}${res.trophyDelta}` : '';
    body.innerHTML = `
      파괴율 <b>${Math.round((res.destructionPercent ?? result.destructionPercent) * 100)}%</b><br>
      약탈 ${lootTxt}<br>
      트로피 ${trophyTxt}`;
  }

  document.getElementById('battle-result-close').onclick = () => {
    document.getElementById('battle-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    battleSession = null;
    currentMatch = null;
    renderMatchCard();
  };
}

// ---------- 자원 패널 ----------
function renderResourcePanel() {
  const el = document.getElementById('resource-bar');
  if (!game.myNation) { el.innerHTML = ''; return; }
  const res = game.myNation.resources;
  const keys = Object.keys(RESOURCES).filter(k => res[k]);
  let html = keys.map(k => `<span class="res">${resIcon(k)}${Math.floor(res[k])}</span>`).join('');
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
function updateBuildPreview() {
  if (!game.myNation || !selectedStruct || !renderer.hover) {
    renderer.buildPreview = null;
    const hintEl = document.getElementById('preview-hint');
    if (hintEl) { hintEl.textContent = ''; hintEl.className = 'preview-hint'; }
    return;
  }
  const { x, y } = renderer.hover;
  const def = STRUCTURES[selectedStruct];
  const check = validatePlacement(game.myNation, selectedStruct, x, y);
  renderer.buildPreview = {
    key: selectedStruct, x, y, dir: beltDir,
    ok: check.ok, error: check.error,
    territoryRadius: def.territoryRadius || 0,
    powerRadius: def.powerRadius || 0,
  };
  // 좌측 패널 비용 줄에 현재 위치 기준 사유를 함께 보여준다
  const hint = document.getElementById('preview-hint');
  if (hint) {
    hint.textContent = check.ok ? `(${x}, ${y}) 건설 가능` : `(${x}, ${y}) ${check.error}`;
    hint.className = `preview-hint ${check.ok ? 'ok' : 'err'}`;
  }
}

// ---------- 메인 루프 ----------
function loop() {
  renderer.resize();
  updateCapitalSites();
  updateBuildPreview();
  renderer.draw();
  renderResourcePanel();
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => renderer.resize());

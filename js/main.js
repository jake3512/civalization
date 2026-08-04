// ============================================================
// main.js — UI 배선. 키보드 없는 터치 기기를 기본으로 가정하고 만들었다:
//   - 지도 이동: 한 손가락 드래그 (마우스 드래그도 동일하게 동작)
//   - 확대/축소: 두 손가락 핀치, 또는 우측 하단 [+][-] 버튼 (휠도 지원)
//   - 탭(드래그가 아닌 짧은 터치): 건설/선택
//   - 벨트 회전 · 전력범위 표시: 화면 우측 하단 버튼 (R/P 키보드도 병행 지원)
// ============================================================
import { STRUCTURES, RESOURCES, TECH_TREE, DIR_ARROW, RAIDER, WAR, UNITS } from './data.js';
import { Game, Nation } from './game.js';
import { Renderer } from './render.js';
import { getTile } from './world.js';
import { findMatch, isShielded, getDefensePower } from './logic.js';
import { FUNCTIONS_DEPLOYED } from './firebase-config.js';
import {
  initFirebase, isMultiplayer, watchNations, watchBattles, watchMyNation,
  callInitNation, callBuild, callUpgrade, callSetRecipe, callStartResearch, callRecruitUnit, callAttack,
} from './multiplayer.js';

const game = new Game();
const canvas = document.getElementById('field');
const renderer = new Renderer(canvas, game);

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
  renderer.centerOn(0, 0);
  requestAnimationFrame(loop); // 국가 생성 전이라도 지도는 바로 보여준다
});

// ---------- 2단계: 지도를 탭해서 수도 위치 선택 ----------
function updatePlacementBar() {
  const bar = document.getElementById('placement-text');
  const confirmBtn = document.getElementById('placement-confirm');
  if (!selectedCapital) {
    bar.textContent = '지도를 움직여 수도를 세울 칸을 탭하세요';
    confirmBtn.disabled = true;
  } else {
    bar.textContent = `선택한 위치 (${selectedCapital.x}, ${selectedCapital.y}) — 다른 곳을 탭하면 위치를 바꿀 수 있어요`;
    confirmBtn.disabled = false;
  }
}

document.getElementById('placement-confirm').addEventListener('click', () => {
  if (!selectedCapital || !pendingNation) return;
  const { x, y } = selectedCapital;
  const { name, color } = pendingNation;

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
    statusEl.textContent = '⚪ 로컬 모드 (Cloud Functions 미배포)';
    return; // Functions 배포 전에는 Firebase 연결 자체를 시도하지 않는다 (안전한 폴백)
  }

  const ok = await initFirebase();
  if (!ok) { statusEl.textContent = '⚪ 로컬 모드 (firebase-config.js 미설정)'; return; }

  const res = await callInitNation(name, color, cx, cy);
  if (res.error && !res.existed) { flashMessage('서버 연결 실패: ' + res.error, true); return; }

  game.serverAuthoritative = true;
  statusEl.textContent = '🟢 온라인 (서버 권위 모드)';

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
    btn.innerHTML = `<span class="idx">${def.code || def.id}</span><span class="nm">${def.name}</span><span class="vol">부피 ${def.volume}</span>`;
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
  const parts = Object.entries(def.baseCost).map(([r, a]) => `${RESOURCES[r]?.icon || ''} ${RESOURCES[r]?.name || r} ${a}`);
  let text = parts.length ? `건설 비용: ${parts.join(' · ')}` : '건설 비용 없음';
  if (def === STRUCTURES.belt) text += `  ·  방향 ${DIR_ARROW[beltDir]} (우측 하단 ⟳ 버튼으로 회전)`;
  el.textContent = text;
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
    renderer.placementMarker = { x, y };
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

// ---------- 구조물 상세 패널 ----------
function showStructPanel(struct, x, y) {
  const panel = document.getElementById('struct-panel');
  if (!struct) {
    const t = getTile(x, y);
    panel.innerHTML = `<div class="ph">타일 (${x}, ${y})</div><div class="pd">지형: ${t.node ? t.node.name : (t.terrain === 'water' ? '강/호수' : '평지')}</div>`;
    return;
  }
  const def = STRUCTURES[struct.key];
  let html = `<div class="ph">${def.name} · Lv.${struct.level}${struct.idle ? ' <span style="color:#c1443c">(정지됨)</span>' : ''}</div><div class="pd">${def.desc}</div>`;

  if (struct.key === 'lab') html += renderLabHtml();
  if (struct.key === 'outpost') html += renderOutpostHtml(struct);

  if (def.recipes) {
    html += `<div class="pd">레시피 선택${def.recipes[struct.recipe]?.requiresBelt ? ' (벨트 투입 전용)' : ''}:</div><div class="recipe-list">`;
    for (const key of Object.keys(def.recipes)) {
      const active = struct.recipe === key ? 'active' : '';
      const label = RESOURCES[key]?.name || key;
      html += `<button class="recipe-btn ${active}" data-recipe="${key}">${label}</button>`;
    }
    html += `</div>`;
  }

  const canUpgrade = def.maxLevel > struct.level;
  html += `<button id="upgrade-btn" ${canUpgrade ? '' : 'disabled'}>레벨업 (${struct.level}→${struct.level + 1})</button>`;

  panel.innerHTML = html;

  panel.querySelectorAll('.recipe-btn').forEach(btn => {
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
  panel.querySelectorAll('.research-btn').forEach(btn => {
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
  panel.querySelectorAll('.recruit-btn').forEach(btn => {
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
  const fmtEquip = (equip) => Object.entries(equip).map(([r, a]) => `${RESOURCES[r]?.icon || ''}${a}`).join(' ');

  let html = `<div class="pd">국고 골드: 💰 ${Math.floor(nation.resources.gold || 0)}</div>`;

  const queue = struct.recruitQueue || [];
  if (queue.length) {
    html += `<div class="pd">모집 대기열 (${queue.length}) — 벨트로 장비 투입 대기 중:</div>`;
    html += queue.map(j => {
      const unit = j.isDefense ? UNITS.defense[j.unitKey] : UNITS.attack[j.unitKey];
      const have = struct.inputBuffer || {};
      const needTxt = Object.entries(j.need).map(([r, a]) => `${RESOURCES[r]?.icon || ''}${have[r] || 0}/${a}`).join(' ');
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
    html += `<button class="recipe-btn recruit-btn" data-unit="${key}" data-defense="0">${unit.name} · 💰${unit.gold} · ${fmtEquip(unit.equip)}</button>`;
  }
  html += `</div><div class="pd">수비 유닛 모집:</div><div class="recipe-list">`;
  for (const [key, unit] of Object.entries(UNITS.defense)) {
    html += `<button class="recipe-btn recruit-btn" data-unit="${key}" data-defense="1">${unit.name} · 💰${unit.gold} · ${fmtEquip(unit.equip)}</button>`;
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
  let html = `<div class="pd">해금 가능한 기술:</div><div class="recipe-list">`;
  for (const [key, tech] of Object.entries(TECH_TREE)) {
    if (nation.unlocked.has(key)) continue;
    const missing = tech.requires.filter(k => !nation.unlocked.has(k));
    const locked = missing.length > 0;
    const costTxt = Object.entries(tech.cost).map(([r, a]) => `${RESOURCES[r]?.icon || ''}${a}`).join(' ');
    html += `<button class="recipe-btn research-btn" data-tech="${key}" ${locked ? 'disabled title="선행 연구 필요: ' + missing.join(',') + '"' : ''}>
      ${STRUCTURES[key].name} (${costTxt}, ${tech.time}틱)
    </button>`;
  }
  html += `</div>`;
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
  const estLoot = Object.entries(n.resources || {})
    .filter(([, v]) => v > 0)
    .slice(0, 4)
    .map(([r, v]) => `${RESOURCES[r]?.icon || ''}${Math.floor(v * 0.1)}`)
    .join(' ');
  el.innerHTML = `
    <div class="match-card">
      <div class="match-head">
        <span class="dot" style="background:${n.color}"></span>
        <span class="nm">${n.name}</span>
        <span class="trophy">🏆 ${n.trophies || 0}</span>
      </div>
      <div class="pd">예상 방어력 ${getDefensePower(n)} · 약탈 예상 ${estLoot || '없음'}</div>
      <div class="match-actions">
        <button id="attack-match-btn" class="atk-btn">공격</button>
        <button id="skip-match-btn" class="skip-btn">다른 상대</button>
      </div>
    </div>`;
  document.getElementById('attack-match-btn').addEventListener('click', async () => {
    const res = await callAttack(currentMatch.id);
    if (res.error) { flashMessage(res.error, true); return; }
    flashMessage(res.win ? `승리! 트로피 +${res.trophyDelta}` : `패배... 트로피 ${res.trophyDelta}`, !res.win);
    currentMatch = null;
    renderMatchCard();
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
    const trophyTxt = mine && typeof b.trophyDelta === 'number' ? ` (🏆${b.trophyDelta >= 0 ? '+' : ''}${b.trophyDelta})` : '';
    return `<div class="log-row">${mine ? '내가 공격' : '상대가 공격'} → <b>${outcome}</b>${trophyTxt}</div>`;
  }).join('') || '<div class="pd">전투 기록 없음</div>';
}

// ---------- 자원 패널 ----------
function renderResourcePanel() {
  const el = document.getElementById('resource-bar');
  if (!game.myNation) { el.innerHTML = ''; return; }
  const res = game.myNation.resources;
  const keys = Object.keys(RESOURCES).filter(k => res[k]);
  const hp = game.myNation.capitalHp ?? RAIDER.capitalMaxHp;
  const raiders = (game.myNation.raiders || []).length;
  let html = keys.map(k => `<span class="res"><span class="ic">${RESOURCES[k].icon}</span>${Math.floor(res[k])}</span>`).join('');
  html += `<span class="res" title="트로피">🏆 ${game.myNation.trophies || 0}</span>`;
  const shieldMs = (game.myNation.shieldUntil || 0) - Date.now();
  if (shieldMs > 0) {
    const h = Math.floor(shieldMs / 3600000), m = Math.floor((shieldMs % 3600000) / 60000);
    html += `<span class="res" style="color:#4a9d8f" title="보호막 남은 시간">🛡️ ${h}시간 ${m}분</span>`;
  }
  html += `<span class="res" title="수도 체력">🏛️ ${Math.round(hp)}/${RAIDER.capitalMaxHp}</span>`;
  if (raiders > 0) html += `<span class="res" style="color:#c1443c">🚨 습격자 ${raiders}</span>`;
  el.innerHTML = html;
}

// ---------- 메인 루프 ----------
function loop() {
  renderer.resize();
  renderer.draw();
  renderResourcePanel();
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => renderer.resize());

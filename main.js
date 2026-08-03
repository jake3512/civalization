// ============================================================
// main.js — UI 배선 (건설 메뉴, 캔버스 조작, 자원 패널, 연구소, 전쟁 패널)
// ============================================================
import { STRUCTURES, RESOURCES, TECH_TREE, DIR_ARROW, RAIDER } from './data.js';
import { Game, Nation } from './game.js';
import { Renderer } from './render.js';
import { getTile } from './world.js';
import {
  initFirebase, isMultiplayer, watchNations, watchBattles, watchMyNation,
  callInitNation, callBuild, callUpgrade, callSetRecipe, callStartResearch, callAttack,
} from './multiplayer.js';

const game = new Game();
const canvas = document.getElementById('field');
const renderer = new Renderer(canvas, game);

let selectedStruct = null;   // 현재 건설 모드로 선택된 구조물 key
let beltDir = 0;              // 벨트 건설 시 방향 (R키로 회전)

// ---------- 시작 화면 ----------
const startScreen = document.getElementById('start-screen');
document.getElementById('start-btn').addEventListener('click', () => {
  const name = document.getElementById('nation-name').value.trim() || '이름없는 국가';
  const color = document.getElementById('nation-color').value;
  const cx = Math.floor((Math.random() - 0.5) * 400);
  const cy = Math.floor((Math.random() - 0.5) * 400);

  // 네트워크 상태와 무관하게 즉시 플레이 가능하도록 로컬 국가를 먼저 만든다.
  // (Firebase가 연결되면 아래 initMultiplayer()가 서버 권위 모드로 전환한다)
  game.startNation(name, color, cx, cy);
  renderer.centerOn(cx, cy);
  startScreen.classList.add('hidden');
  buildBuildMenu();
  game.startLoop();
  requestAnimationFrame(loop);

  initMultiplayer(name, color, cx, cy);
});

async function initMultiplayer(name, color, cx, cy) {
  const statusEl = document.getElementById('mp-status');
  const ok = await initFirebase();
  if (!ok) { statusEl.textContent = '⚪ 로컬 모드 (firebase-config.js 미설정)'; return; }

  const res = await callInitNation(name, color, cx, cy);
  if (res.error && !res.existed) { flashMessage('서버 연결 실패: ' + res.error, true); return; }

  // 이 시점부터 클라이언트 로컬 tick()은 멈추고, 서버(Cloud Functions)가
  // 계산한 결과를 Firestore 구독으로만 받아서 반영한다.
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
    btn.innerHTML = `<span class="idx">${def.id}</span><span class="nm">${def.name}</span><span class="vol">부피 ${def.volume}</span>`;
    btn.title = def.desc;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.build-item.active').forEach(b => b.classList.remove('active'));
      if (selectedStruct === key) { selectedStruct = null; return; }
      selectedStruct = key;
      btn.classList.add('active');
      renderCostPreview(def);
    });
    menu.appendChild(btn);
  }
}

function renderCostPreview(def) {
  const el = document.getElementById('cost-preview');
  const parts = Object.entries(def.baseCost).map(([r, a]) => `${RESOURCES[r]?.icon || ''} ${RESOURCES[r]?.name || r} ${a}`);
  let text = parts.length ? `건설 비용: ${parts.join(' · ')}` : '건설 비용 없음';
  if (def === STRUCTURES.belt) text += `  ·  방향 ${DIR_ARROW[beltDir]} (R키로 회전)`;
  el.textContent = text;
}

// ---------- 키보드 (벨트 회전 / 전력 오버레이 토글) ----------
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && selectedStruct === 'belt') {
    beltDir = (beltDir + 1) % 4;
    renderCostPreview(STRUCTURES.belt);
  }
  if (e.key.toLowerCase() === 'p') {
    renderer.showPower = !renderer.showPower;
  }
});

// ---------- 캔버스 인터랙션 ----------
let dragging = false, lastX = 0, lastY = 0, dragged = false;
canvas.addEventListener('mousedown', (e) => { dragging = true; dragged = false; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => dragging = false);
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  renderer.hover = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
    renderer.pan(dx, dy);
    lastX = e.clientX; lastY = e.clientY;
  }
});
canvas.addEventListener('click', async (e) => {
  if (dragged) return;
  const rect = canvas.getBoundingClientRect();
  const { x, y } = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

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

// ---------- 전쟁 패널 ----------
function renderWarPanel(nations) {
  const el = document.getElementById('war-list');
  if (!nations.length) { el.innerHTML = '<div class="pd">아직 발견된 다른 국가가 없습니다.</div>'; return; }
  el.innerHTML = nations.map(n => `
    <div class="war-row">
      <span class="dot" style="background:${n.color}"></span>
      <span class="nm">${n.name}</span>
      <span class="pw">전투력 ${militaryPowerOf(n)}</span>
      <button data-id="${n.id}" class="atk-btn">공격</button>
    </div>`).join('');
  el.querySelectorAll('.atk-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await callAttack(btn.dataset.id);
      if (res.error) flashMessage(res.error, true);
      else flashMessage(res.win ? '승리했습니다! 자원을 약탈했습니다.' : '패배했습니다...', !res.win);
    });
  });
}
function militaryPowerOf(nationData) {
  return (nationData.structures || []).reduce((sum, s) => {
    const def = STRUCTURES[s.key];
    if (def && def.category === 'military') return sum + (def.attack || def.defense || 1) * s.level;
    return sum;
  }, 0);
}
function renderBattleLog(list) {
  const el = document.getElementById('battle-log');
  el.innerHTML = list.map(b => {
    const mine = b.attackerId === game.myNation.id;
    const outcome = b.win ? (mine ? '승리' : '패배') : (mine ? '패배' : '승리');
    return `<div class="log-row">${mine ? '내가 공격' : '상대가 공격'} → <b>${outcome}</b></div>`;
  }).join('') || '<div class="pd">전투 기록 없음</div>';
}

// ---------- 자원 패널 ----------
function renderResourcePanel() {
  const el = document.getElementById('resource-bar');
  const res = game.myNation.resources;
  const keys = Object.keys(RESOURCES).filter(k => res[k]);
  const hp = game.myNation.capitalHp ?? RAIDER.capitalMaxHp;
  const raiders = (game.myNation.raiders || []).length;
  let html = keys.map(k => `<span class="res"><span class="ic">${RESOURCES[k].icon}</span>${Math.floor(res[k])}</span>`).join('');
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

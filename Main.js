// ============================================================
// main.js — UI 배선 (건설 메뉴, 캔버스 조작, 자원 패널, 전쟁 패널)
// ============================================================
import { STRUCTURES, RESOURCES } from './data.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { getTile } from './world.js';
import { initFirebase, isMultiplayer, pushNation, watchNations, sendAttack, watchBattles } from './multiplayer.js';

const game = new Game();
const canvas = document.getElementById('field');
const renderer = new Renderer(canvas, game);

let selectedStruct = null; // 현재 건설 모드로 선택된 구조물 key
let selectedFactoryStruct = null; // 레시피 설정용으로 클릭한 구조물 id

// ---------- 시작 화면 ----------
const startScreen = document.getElementById('start-screen');
document.getElementById('start-btn').addEventListener('click', () => {
  const name = document.getElementById('nation-name').value.trim() || '이름없는 국가';
  const color = document.getElementById('nation-color').value;
  // 시작 지점: 원점 근처 무작위 (실제로는 물/자원 분포를 봐가며 유저가 고르게 확장 가능)
  const cx = Math.floor((Math.random() - 0.5) * 400);
  const cy = Math.floor((Math.random() - 0.5) * 400);
  game.startNation(name, color, cx, cy);
  renderer.centerOn(cx, cy);
  startScreen.classList.add('hidden');
  buildBuildMenu();
  game.startLoop();
  requestAnimationFrame(loop);
  initMultiplayer();
});

async function initMultiplayer() {
  const ok = await initFirebase();
  document.getElementById('mp-status').textContent = ok ? '🟢 온라인 (Firebase 연결됨)' : '⚪ 로컬 모드 (firebase-config.js 미설정)';
  if (!ok) return;
  await pushNation(game.myNation);
  setInterval(() => pushNation(game.myNation), 4000);
  watchNations((list) => {
    game.otherNations.clear();
    for (const data of list) game.otherNations.set(data.id, { ...data, isOwned: () => false });
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
  el.textContent = parts.length ? `건설 비용: ${parts.join(' · ')}` : '건설 비용 없음';
}

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
canvas.addEventListener('click', (e) => {
  if (dragged) return; // 드래그 후 클릭은 무시 (패닝과 구분)
  const rect = canvas.getBoundingClientRect();
  const { x, y } = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

  if (selectedStruct) {
    const err = game.myNation.build(selectedStruct, x, y);
    if (err) flashMessage(err, true);
    else { flashMessage(`${STRUCTURES[selectedStruct].name} 건설 완료`, false); buildBuildMenu(); }
    return;
  }

  // 건설 모드가 아니면: 클릭한 칸의 구조물 정보를 패널에 표시 (업그레이드/레시피용)
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
  let html = `<div class="ph">${def.name} · Lv.${struct.level}</div><div class="pd">${def.desc}</div>`;

  if (def.recipes) {
    html += `<div class="pd">레시피 선택:</div><div class="recipe-list">`;
    for (const key of Object.keys(def.recipes)) {
      const active = struct.recipe === key ? 'active' : '';
      const label = RESOURCES[key]?.name || key;
      html += `<button class="recipe-btn ${active}" data-recipe="${key}">${label}</button>`;
    }
    html += `</div>`;
  }

  const upgradeCost = def.maxLevel > struct.level;
  html += `<button id="upgrade-btn" ${upgradeCost ? '' : 'disabled'}>레벨업 (${struct.level}→${struct.level + 1})</button>`;

  panel.innerHTML = html;
  panel.querySelectorAll('.recipe-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const err = game.myNation.setRecipe(struct.id, btn.dataset.recipe);
      if (err) flashMessage(err, true); else showStructPanel(struct, x, y);
    });
  });
  const ub = document.getElementById('upgrade-btn');
  if (ub) ub.addEventListener('click', () => {
    const err = game.myNation.upgrade(struct.id);
    if (err) flashMessage(err, true); else { flashMessage('레벨업 완료', false); showStructPanel(struct, x, y); }
  });
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
      const defender = nations.find(n => n.id === btn.dataset.id);
      const res = await sendAttack({
        attacker: game.myNation,
        defenderId: defender.id,
        defenderPower: militaryPowerOf(defender),
        attackPower: game.myNation.militaryPower(),
      });
      if (res.error) flashMessage(res.error, true);
      else flashMessage(res.battle.result === 'attacker' ? '승리했습니다!' : '패배했습니다...', res.battle.result !== 'attacker');
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
    const outcome = (b.result === 'attacker') === mine ? '승리' : '패배';
    return `<div class="log-row">${mine ? '내가 공격' : '상대가 공격'} → <b>${outcome}</b></div>`;
  }).join('') || '<div class="pd">전투 기록 없음</div>';
}

// ---------- 자원 패널 ----------
function renderResourcePanel() {
  const el = document.getElementById('resource-bar');
  const res = game.myNation.resources;
  const keys = Object.keys(RESOURCES).filter(k => res[k]);
  el.innerHTML = keys.map(k => `<span class="res"><span class="ic">${RESOURCES[k].icon}</span>${Math.floor(res[k])}</span>`).join('');
}

// ---------- 메인 루프 ----------
function loop() {
  renderer.resize();
  renderer.draw();
  renderResourcePanel();
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => renderer.resize());

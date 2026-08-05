// ============================================================
// scripts/generate-icons.mjs — assets/icons/*.svg 아이콘 세트를 생성한다.
//
// 이모지는 플랫폼(OS/브라우저)마다 모양·색·크기가 달라 게임 UI에서 가독성이
// 들쭉날쭉했다. 대신 자원마다 "배지(badge) + 글리프" 형태의 벡터 아이콘을
// 코드로 생성해 assets/icons/ 에 커밋해 둔다 (해상도 독립적, 다크 테마에서도
// 항상 동일하게 보임). 규칙을 바꾸고 싶으면 이 스크립트만 고치고 다시
// `node scripts/generate-icons.mjs` 를 실행하면 된다.
// ============================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
mkdirSync(OUT_DIR, { recursive: true });

const SIZE = 64;
const CX = SIZE / 2, CY = SIZE / 2;

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function glyphColor(bgHex) {
  return luminance(bgHex) > 0.55 ? '#1b1b1b' : '#f2ede0';
}
function shade(hex, amt) {
  // amt<0 = 어둡게, amt>0 = 밝게
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const adj = (c) => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  r = adj(r); g = adj(g); b = adj(b);
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

function badge(bg, glyphSvg) {
  const border = shade(bg, -0.28);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="2" y="2" width="${SIZE - 4}" height="${SIZE - 4}" rx="14" fill="${bg}" stroke="${border}" stroke-width="2.5"/>
  ${glyphSvg}
</svg>`;
}

// ---------------- 글리프(자원 종류별 상징 도형) ----------------
const glyphs = {
  tree(c) {
    return `<path d="M32 14 L44 32 L38 32 L48 46 L16 46 L26 32 L20 32 Z" fill="${c}"/>
    <rect x="29" y="46" width="6" height="8" rx="1.5" fill="${c}"/>`;
  },
  rock(c, accent) {
    return `<path d="M14 40 L20 24 L32 18 L46 24 L50 40 L42 48 L22 48 Z" fill="${c}"/>
    ${accent ? `<path d="M24 30 L34 26 L40 34 L30 40 Z" fill="${accent}" opacity="0.55"/>` : ''}`;
  },
  nugget(c, accent) {
    return `<path d="M18 38 Q14 26 26 22 Q38 16 46 26 Q52 34 44 42 Q34 50 22 46 Q16 44 18 38 Z" fill="${c}"/>
    ${accent ? `<circle cx="28" cy="30" r="3" fill="${accent}"/><circle cx="38" cy="36" r="2.4" fill="${accent}"/>` : ''}`;
  },
  crystal(c, accent) {
    return `<path d="M32 12 L44 26 L38 52 L26 52 L20 26 Z" fill="${c}"/>
    <path d="M32 12 L38 52 L26 52 Z" fill="${accent || '#000'}" opacity="0.18"/>`;
  },
  droplet(c) {
    return `<path d="M32 12 C40 24 48 33 48 42 A16 16 0 0 1 16 42 C16 33 24 24 32 12 Z" fill="${c}"/>`;
  },
  bar(c, lines) {
    let inner = '';
    if (lines === 'grain') {
      inner = [18, 26, 34, 42].map(y => `<line x1="14" y1="${y}" x2="50" y2="${y}" stroke="${shade(c, -0.25)}" stroke-width="1.6"/>`).join('');
    } else if (lines === 'brick') {
      inner = `<line x1="14" y1="26" x2="50" y2="26" stroke="${shade(c, -0.3)}" stroke-width="2"/>
      <line x1="14" y1="38" x2="50" y2="38" stroke="${shade(c, -0.3)}" stroke-width="2"/>
      <line x1="32" y1="14" x2="32" y2="26" stroke="${shade(c, -0.3)}" stroke-width="2"/>
      <line x1="22" y1="26" x2="22" y2="38" stroke="${shade(c, -0.3)}" stroke-width="2"/>
      <line x1="42" y1="26" x2="42" y2="38" stroke="${shade(c, -0.3)}" stroke-width="2"/>
      <line x1="32" y1="38" x2="32" y2="50" stroke="${shade(c, -0.3)}" stroke-width="2"/>`;
    } else if (lines === 'rib') {
      inner = [20, 26, 32, 38, 44].map(x => `<line x1="${x}" y1="16" x2="${x - 6}" y2="48" stroke="${shade(c, -0.3)}" stroke-width="2"/>`).join('');
    } else {
      inner = `<rect x="16" y="20" width="32" height="6" rx="2" fill="${shade(c, 0.25)}" opacity="0.8"/>`;
    }
    return `<rect x="12" y="14" width="40" height="36" rx="6" fill="${c}"/>${inner}`;
  },
  bolt(c) {
    return `<path d="M34 10 L18 36 L28 36 L24 54 L46 28 L34 28 Z" fill="${c}"/>`;
  },
  coin(c) {
    return `<circle cx="32" cy="32" r="18" fill="${c}"/>
    <circle cx="32" cy="32" r="12.5" fill="none" stroke="${shade(c, -0.3)}" stroke-width="2"/>
    <path d="M32 24 L34.5 30 L41 30.5 L36 34.8 L37.6 41 L32 37.4 L26.4 41 L28 34.8 L23 30.5 L29.5 30 Z" fill="${shade(c, -0.3)}"/>`;
  },
  wheat(c) {
    return `<path d="M32 50 C24 42 24 26 32 14 C40 26 40 42 32 50 Z" fill="${c}"/>
    ${[20, 26, 32, 38, 44].map(y => `<circle cx="26" cy="${y}" r="2.4" fill="${shade(c, -0.2)}"/><circle cx="38" cy="${y}" r="2.4" fill="${shade(c, -0.2)}"/>`).join('')}`;
  },
  animal(c) {
    return `<ellipse cx="32" cy="36" rx="18" ry="12" fill="${c}"/>
    <circle cx="18" cy="26" r="9" fill="${c}"/>
    <circle cx="14" cy="20" r="3" fill="${shade(c, -0.25)}"/>
    <circle cx="22" cy="20" r="3" fill="${shade(c, -0.25)}"/>
    <circle cx="24" cy="42" r="3" fill="${shade(c, -0.2)}"/>
    <circle cx="34" cy="45" r="3" fill="${shade(c, -0.2)}"/>
    <circle cx="44" cy="42" r="3" fill="${shade(c, -0.2)}"/>`;
  },
  drumstick(c) {
    return `<circle cx="24" cy="24" r="13" fill="${c}"/>
    <path d="M32 32 L48 48" stroke="${shade(c, 0.35)}" stroke-width="7" stroke-linecap="round"/>
    <circle cx="49" cy="49" r="4.5" fill="${shade(c, 0.4)}"/>`;
  },
  coil(c) {
    return `<path d="M12 44 Q12 20 32 20 Q52 20 52 38" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="12" cy="44" r="5" fill="${c}"/>
    <circle cx="52" cy="38" r="5" fill="${c}"/>`;
  },
  chip(c) {
    return `<rect x="18" y="18" width="28" height="28" rx="3" fill="${c}"/>
    <rect x="24" y="24" width="16" height="16" rx="2" fill="${shade(c, -0.3)}"/>
    ${[14, 24, 34, 44].flatMap(p => [
      `<line x1="${p}" y1="18" x2="${p}" y2="12" stroke="${c}" stroke-width="3"/>`,
      `<line x1="${p}" y1="46" x2="${p}" y2="52" stroke="${c}" stroke-width="3"/>`,
    ]).join('')}`;
  },
  spear(c) {
    return `<line x1="16" y1="48" x2="42" y2="16" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M38 20 L50 10 L46 22 L54 18 L40 30 Z" fill="${c}"/>`;
  },
  shieldGear(c) {
    return `<path d="M32 12 L48 18 V30 C48 42 42 50 32 54 C22 50 16 42 16 30 V18 Z" fill="${c}"/>
    <path d="M32 20 L41 24 V31 C41 39 37 44 32 47 C27 44 23 39 23 31 V24 Z" fill="${shade(c, -0.25)}"/>`;
  },
  pistol(c) {
    return `<path d="M14 30 H40 V22 H46 V34 H40 V38 H26 V48 H18 V38 H14 Z" fill="${c}"/>`;
  },
  vestShape(c) {
    return `<path d="M20 16 L32 22 L44 16 L48 24 L44 26 L44 50 L34 50 L34 34 L30 34 L30 50 L20 50 L20 26 L16 24 Z" fill="${c}"/>`;
  },
  trophyShape(c) {
    return `<path d="M22 14 H42 V26 C42 34 37 39 32 39 C27 39 22 34 22 26 Z" fill="${c}"/>
    <path d="M22 16 H14 V22 C14 28 18 31 22 30" fill="none" stroke="${c}" stroke-width="3.4"/>
    <path d="M42 16 H50 V22 C50 28 46 31 42 30" fill="none" stroke="${c}" stroke-width="3.4"/>
    <rect x="28" y="39" width="8" height="8" fill="${c}"/>
    <rect x="20" y="47" width="24" height="6" rx="2" fill="${c}"/>`;
  },
};

// key -> { bg, glyph: [fnName, ...extraArgs] }
const SPEC = {
  wood:          { bg: '#4a7c3f', glyph: ['tree'] },
  stone:         { bg: '#8a8577', glyph: ['rock'] },
  coal:          { bg: '#3a3a3a', glyph: ['rock', '#6b6b6b'] },
  iron_ore:      { bg: '#a86b4c', glyph: ['rock', '#7a4a33'] },
  gold_ore:      { bg: '#c9a227', glyph: ['nugget', '#fff2b0'] },
  copper_ore:    { bg: '#b5651d', glyph: ['rock', '#7a4212'] },
  crude_oil:     { bg: '#2a2a2a', glyph: ['droplet'] },
  mana_stone:    { bg: '#7d5fd8', glyph: ['crystal', '#c9b8ff'] },

  iron_ingot:    { bg: '#9a9a9a', glyph: ['bar'] },
  gold_ingot:    { bg: '#d4af37', glyph: ['bar'] },
  copper_ingot:  { bg: '#c9762f', glyph: ['bar'] },

  petroleum:     { bg: '#3a3a3a', glyph: ['droplet'] },
  naphtha:       { bg: '#5fa9ad', glyph: ['droplet'] },

  food:          { bg: '#c9a83e', glyph: ['wheat'] },
  livestock:     { bg: '#b98457', glyph: ['animal'] },
  meat:          { bg: '#b43c3c', glyph: ['drumstick'] },

  electricity:   { bg: '#e0b830', glyph: ['bolt'] },
  gold:          { bg: '#d9a92c', glyph: ['coin'] },

  plank:         { bg: '#a97a44', glyph: ['bar', 'grain'] },
  brick:         { bg: '#8c4a34', glyph: ['bar', 'brick'] },

  copper_wire:   { bg: '#c9762f', glyph: ['coil'] },
  plastic:       { bg: '#6fa2b8', glyph: ['droplet'] },

  circuit_board: { bg: '#3f9d6c', glyph: ['chip'] },
  rebar:         { bg: '#787c81', glyph: ['bar', 'rib'] },

  wood_spear:    { bg: '#8f6a41', glyph: ['spear'] },
  wood_shield:   { bg: '#8f6a41', glyph: ['shieldGear'] },
  iron_spear:    { bg: '#9a9a9a', glyph: ['spear'] },
  iron_shield:   { bg: '#9a9a9a', glyph: ['shieldGear'] },
  gun:           { bg: '#4a4a4a', glyph: ['pistol'] },
  vest:          { bg: '#b58a2e', glyph: ['vestShape'] },

  // ---- 자원표에 없는 상태 아이콘(HUD) ----
  trophy:        { bg: '#d9a92c', glyph: ['trophyShape'] },
  shield_status: { bg: '#3d7f74', glyph: ['shieldGear'] },
  water:         { bg: '#2f6f7d', glyph: ['droplet'] },
};

for (const [key, { bg, glyph: [fn, ...args] }] of Object.entries(SPEC)) {
  const c = glyphColor(bg);
  const svg = badge(bg, glyphs[fn](c, ...args));
  writeFileSync(path.join(OUT_DIR, `${key}.svg`), svg, 'utf-8');
}

// ============================================================
// ============================================================
// 구조물 그림 (assets/icons/struct/*.svg)
//
// 단색 픽토그램이 아니라 "그린 그림"에 가깝게 만든다 — 구조물마다 고유
// 색을 쓰고, 왼쪽 위에서 빛이 온다고 보고 밝은 면/어두운 면을 나눠 칠하고,
// 굵은 어두운 외곽선을 둘러 아케이드 게임풍으로 또렷하게 보이게 한다.
// (필드 캔버스와 건설 카탈로그가 같은 그림을 공유한다)
// ============================================================
const STRUCT_DIR = path.join(OUT_DIR, 'struct');
mkdirSync(STRUCT_DIR, { recursive: true });

const INK = '#161018';          // 공통 외곽선 (거의 검정 — 대비를 크게)
const OUT_W = 3;                // 외곽선 두께

// 채도 높은 아케이드 팔레트
const P = {
  stoneL: '#b9c3cc', stone: '#8d99a6', stoneD: '#5d6773',
  woodL: '#d59a54', wood: '#a86a2e', woodD: '#6f4319',
  roofL: '#ff7a59', roof: '#e0452f', roofD: '#9c2418',
  metalL: '#e2ebf2', metal: '#9fb0c0', metalD: '#5f7080',
  goldL: '#ffe066', gold: '#f5b921', goldD: '#a8730a',
  greenL: '#7ede6a', green: '#3fae3f', greenD: '#1f6b28',
  blueL: '#6fd4ff', blue: '#2e9bd6', blueD: '#175f8c',
  purpleL: '#c9a6ff', purple: '#8b5cf6', purpleD: '#542ea8',
  redL: '#ff8f6b', red: '#e04b3a', redD: '#8f2318',
  dark: '#2f2a33', darkL: '#4a444f',
  glass: '#ffe9a8',
};

/** 외곽선이 들어간 도형 */
const sh = (d, fill, sw = OUT_W) => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
const rc = (x, y, w, h, fill, r = 2, sw = OUT_W) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`;
/** 외곽선 없는 내부 디테일 (음영·창문 등) */
const fd = (d, fill, op = 1) => `<path d="${d}" fill="${fill}" opacity="${op}"/>`;
const fr = (x, y, w, h, fill, r = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
/** 바닥 그림자 — 구조물이 땅에 놓인 느낌 */
const ground = `<ellipse cx="32" cy="55" rx="24" ry="5" fill="#000" opacity="0.28"/>`;

const art = {
  capital: `${ground}
    ${sh('M8 54 V26 h9 v-7 h9 v7 h12 v-7 h9 v7 h9 v28 Z', P.stoneL)}
    ${fd('M32 26 H56 V54 H32 Z', P.stoneD, 0.45)}
    ${fr(14, 34, 8, 9, P.glass)}${fr(42, 34, 8, 9, P.glass)}
    ${sh('M26 40 h12 v14 h-12 Z', P.woodD)}
    ${sh('M30 8 L48 13 L30 18 Z', P.roof)}
    <line x1="30" y1="6" x2="30" y2="26" stroke="${INK}" stroke-width="3"/>`,

  hub: `${ground}
    ${sh('M32 10 L54 22 V44 L32 56 L10 44 V22 Z', P.blueL)}
    ${fd('M32 10 L54 22 V44 L32 56 Z', P.blueD, 0.4)}
    ${sh('M32 22 L44 28 V40 L32 46 L20 40 V28 Z', P.gold)}
    ${fd('M32 22 L44 28 V40 L32 46 Z', P.goldD, 0.35)}`,

  mine: `${ground}
    ${sh('M6 54 V38 q26 -22 52 0 v16 Z', P.stone)}
    ${fd('M32 27 q14 2 26 11 v16 H32 Z', P.stoneD, 0.45)}
    ${sh('M20 54 V44 q12 -12 24 0 v10 Z', P.dark)}
    ${sh('M14 30 Q32 14 50 30', 'none')}
    <path d="M14 30 Q32 14 50 30" fill="none" stroke="${P.metalL}" stroke-width="4" stroke-linecap="round"/>
    ${rc(29, 24, 6, 26, P.woodL, 2)}`,

  lumber_mill: `${ground}
    ${sh('M8 54 V32 h30 v22 Z', P.woodL)}
    ${fd('M24 32 H38 V54 H24 Z', P.woodD, 0.4)}
    ${sh('M4 32 L23 18 L42 32 Z', P.roof)}
    ${fd('M23 18 L42 32 H23 Z', P.roofD, 0.4)}
    ${sh('M48 24 m-11 0 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0', P.metalL)}
    ${fd('M48 15 l3 6 h-6 Z M57 24 l-6 3 v-6 Z M48 33 l-3 -6 h6 Z M39 24 l6 -3 v6 Z', INK, 0.75)}
    <circle cx="48" cy="24" r="3.2" fill="${INK}"/>`,

  factory: `${ground}
    ${sh('M6 54 V30 l13 8 V30 l13 8 V22 h26 v32 Z', P.stone)}
    ${fd('M32 22 H58 V54 H32 Z', P.stoneD, 0.4)}
    ${rc(44, 10, 8, 13, P.metalD, 1)}
    ${fr(10, 42, 7, 8, P.glass)}${fr(23, 42, 7, 8, P.glass)}
    ${fr(38, 32, 7, 7, P.glass)}${fr(48, 32, 7, 7, P.glass)}
    <circle cx="48" cy="6" r="5" fill="#cfd8e3" opacity="0.85"/>
    <circle cx="55" cy="9" r="3.5" fill="#cfd8e3" opacity="0.6"/>`,

  smelter: `${ground}
    ${sh('M10 54 V26 q22 -14 44 0 v28 Z', P.stone)}
    ${fd('M32 19 q12 1 22 7 v28 H32 Z', P.stoneD, 0.45)}
    ${sh('M22 54 V40 q10 -8 20 0 v14 Z', P.redD)}
    ${fd('M26 54 V42 q6 -5 12 0 v12 Z', P.goldL, 0.95)}
    ${rc(26, 6, 12, 12, P.metalD, 2)}
    <circle cx="32" cy="4" r="4" fill="#cfd8e3" opacity="0.7"/>`,

  oil_well: `${ground}
    ${sh('M12 54 L32 12 L52 54 Z', P.metalD)}
    ${fd('M32 12 L52 54 H32 Z', INK, 0.28)}
    <path d="M20 40 H44 M24 30 H40" stroke="${INK}" stroke-width="3"/>
    ${rc(8, 48, 48, 8, P.dark, 2)}
    ${sh('M28 6 h8 v8 h-8 Z', P.gold)}`,

  refinery: `${ground}
    ${rc(8, 20, 16, 34, P.metalL, 3)}
    ${fd('M16 20 H24 V54 H16 Z', P.metalD, 0.5)}
    ${rc(34, 28, 16, 26, P.metalL, 3)}
    ${fd('M42 28 H50 V54 H42 Z', P.metalD, 0.5)}
    <path d="M24 34 H34" stroke="${INK}" stroke-width="5"/>
    <path d="M24 34 H34" stroke="${P.gold}" stroke-width="2.5"/>
    ${rc(11, 10, 10, 10, P.roof, 2)}
    ${fr(12, 44, 8, 6, P.glass)}${fr(38, 44, 8, 6, P.glass)}`,

  extractor: `${ground}
    ${sh('M18 8 h28 v20 l-14 26 l-14 -26 Z', P.purpleL)}
    ${fd('M32 8 h14 v20 l-14 26 Z', P.purpleD, 0.45)}
    <path d="M18 20 H46 M22 30 H42" stroke="${INK}" stroke-width="3"/>
    <circle cx="32" cy="14" r="4" fill="${P.glass}" stroke="${INK}" stroke-width="2"/>`,

  farm: `${ground}
    ${rc(6, 30, 52, 26, P.woodL, 3)}
    ${fd('M6 38 H58 M6 46 H58', 'none')}
    <path d="M8 38 H56 M8 46 H56" stroke="${P.woodD}" stroke-width="3.5"/>
    ${sh('M32 30 q-9 -6 -9 -15 q9 2 9 15 Z', P.green)}
    ${sh('M32 30 q9 -6 9 -15 q-9 2 -9 15 Z', P.greenL)}
    ${rc(30, 14, 4, 16, P.greenD, 2, 2)}`,

  barn: `${ground}
    ${sh('M10 54 V28 L32 12 L54 28 v26 Z', P.redL)}
    ${fd('M32 12 L54 28 V54 H32 Z', P.redD, 0.4)}
    ${sh('M24 36 h16 v18 h-16 Z', P.woodL)}
    <path d="M24 36 L40 54 M40 36 L24 54" stroke="${P.woodD}" stroke-width="3"/>
    ${fr(28, 20, 8, 7, P.glass)}`,

  slaughterhouse: `${ground}
    ${rc(8, 26, 48, 28, P.stoneL, 3)}
    ${fd('M32 26 H56 V54 H32 Z', P.stoneD, 0.4)}
    ${sh('M14 12 h26 a6 6 0 0 1 6 6 v8 h-32 Z', P.metalL)}
    ${rc(24, 26, 6, 12, P.metalD, 1)}
    ${fr(12, 34, 9, 8, P.glass)}${fr(40, 34, 9, 8, P.glass)}`,

  power_plant: `${ground}
    ${sh('M6 54 V34 q10 -8 20 0 v20 Z', P.stoneL)}
    ${sh('M34 54 V26 q11 -8 22 0 v28 Z', P.stone)}
    ${fd('M45 20 q6 1 11 6 v28 H45 Z', P.stoneD, 0.45)}
    ${sh('M30 4 L16 30 h10 l-4 22 L46 24 H34 l4 -20 Z', P.goldL)}
    ${fd('M30 4 L38 4 l-4 20 h12 L22 52 Z', P.goldD, 0.3)}`,

  wall: `${ground}
    ${rc(4, 20, 56, 32, P.stoneL, 2)}
    ${fd('M4 36 H60 V52 H4 Z', P.stoneD, 0.35)}
    <path d="M4 28 H60 M4 36 H60 M4 44 H60" stroke="${INK}" stroke-width="2.5"/>
    <path d="M20 20 V28 M40 20 V28 M12 28 V36 M32 28 V36 M52 28 V36 M20 36 V44 M40 36 V44 M12 44 V52 M32 44 V52 M52 44 V52" stroke="${INK}" stroke-width="2.5"/>`,

  outpost: `${ground}
    ${sh('M32 10 L56 54 H8 Z', P.greenL)}
    ${fd('M32 10 L56 54 H32 Z', P.greenD, 0.45)}
    ${sh('M32 30 L44 54 H20 Z', P.dark)}
    ${sh('M32 4 L44 8 L32 12 Z', P.roof)}
    <line x1="32" y1="3" x2="32" y2="12" stroke="${INK}" stroke-width="2.5"/>`,

  lab: `${ground}
    ${sh('M25 8 h14 v16 l13 24 a5 5 0 0 1 -4 8 H16 a5 5 0 0 1 -4 -8 l13 -24 Z', P.metalL)}
    ${fd('M32 8 h7 v16 l13 24 a5 5 0 0 1 -4 8 H32 Z', P.metalD, 0.35)}
    ${sh('M18 40 h28 l6 8 a5 5 0 0 1 -4 8 H16 a5 5 0 0 1 -4 -8 Z', P.purple)}
    <circle cx="26" cy="48" r="3" fill="${P.purpleL}"/>
    <circle cx="38" cy="50" r="2.4" fill="${P.purpleL}"/>
    ${rc(23, 4, 18, 6, P.gold, 2)}`,

  belt: `${rc(4, 24, 56, 18, P.darkL, 4)}
    ${fd('M4 34 H60 V42 H4 Z', INK, 0.3)}
    <circle cx="14" cy="33" r="5.5" fill="${P.metalL}" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="50" cy="33" r="5.5" fill="${P.metalL}" stroke="${INK}" stroke-width="2.5"/>
    ${sh('M24 26 L38 33 L24 40 Z', P.goldL, 2.5)}`,

  warehouse: `${ground}
    ${sh('M8 22 L32 8 L56 22 v32 H8 Z', P.woodL)}
    ${fd('M32 8 L56 22 V54 H32 Z', P.woodD, 0.42)}
    ${sh('M20 32 h24 v22 H20 Z', P.gold)}
    ${fd('M32 32 H44 V54 H32 Z', P.goldD, 0.35)}
    <path d="M20 40 H44 M32 32 V54" stroke="${INK}" stroke-width="2.5"/>
    ${fr(26, 14, 12, 6, P.glass, 1)}`,
};

/** 터렛 6종 — 공통 받침 + 포신만 달리해서 티어가 눈에 보이게 */
function turret(barrel, bodyColor) {
  return `${ground}
    ${sh('M12 44 h40 v10 H12 Z', P.stoneD)}
    ${sh('M18 34 h28 v10 H18 Z', P.metalD)}
    <circle cx="32" cy="32" r="11" fill="${bodyColor}" stroke="${INK}" stroke-width="${OUT_W}"/>
    ${fd('M32 21 a11 11 0 0 1 0 22 Z', INK, 0.25)}
    ${barrel}`;
}

const TURRETS = {
  turret_01: turret(`${rc(29, 8, 6, 20, P.metalL, 1)}`, P.metal),
  turret_02: turret(`${sh('M32 30 q-9 -14 0 -24 q9 10 0 24 Z', P.redL, 2.5)}`, P.red),
  turret_03: turret(`${sh('M32 4 L39 20 H25 Z', P.blueL, 2.5)}${rc(29, 18, 6, 12, P.blue, 1)}`, P.blue),
  turret_04: turret(`<path d="M22 24 q10 -18 20 0" fill="none" stroke="${INK}" stroke-width="6"/>
    <path d="M22 24 q10 -18 20 0" fill="none" stroke="${P.blueL}" stroke-width="3"/>
    <circle cx="32" cy="12" r="5" fill="${P.glass}" stroke="${INK}" stroke-width="2.5"/>`, P.metalD),
  turret_05: turret(`${rc(26, 6, 12, 24, P.stoneL, 2)}${fd('M32 6 H38 V30 H32 Z', INK, 0.25)}`, P.stone),
  turret_06: turret(`${sh('M32 2 L40 20 H24 Z', P.purpleL, 2.5)}${rc(29, 18, 6, 12, P.purple, 1)}
    <path d="M18 14 L25 19 M46 14 L39 19" stroke="${P.purpleL}" stroke-width="3.5" stroke-linecap="round"/>`, P.purple),
};

const STRUCT_SPEC = { ...art, ...TURRETS };

for (const [key, body] of Object.entries(STRUCT_SPEC)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">\n  ${body}\n</svg>`;
  writeFileSync(path.join(STRUCT_DIR, `${key}.svg`), svg, 'utf-8');
}

console.log(`Generated ${Object.keys(SPEC).length} resource icons in ${OUT_DIR}`);
console.log(`Generated ${Object.keys(STRUCT_SPEC).length} structure illustrations in ${STRUCT_DIR}`);

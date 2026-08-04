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

console.log(`Generated ${Object.keys(SPEC).length} icons in ${OUT_DIR}`);

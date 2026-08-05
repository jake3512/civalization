// ============================================================
// scripts/generate-icons.mjs — assets/icons 아이콘/그림 세트를 생성한다.
//
// 이모지는 플랫폼마다 모양·색이 달라 가독성이 들쭉날쭉해서, 자원과 구조물
// 모두 코드로 그린 SVG 그림을 쓴다. 픽토그램(단색 실루엣)이 아니라 왼쪽
// 위에서 빛이 온다고 보고 밝은 면/어두운 면을 나눠 칠하고 굵은 검은 외곽선을
// 두른 "일러스트"라서, 아케이드풍 화면에서 또렷하게 보인다.
//
// 규칙을 바꾸려면 이 스크립트만 고치고 `node scripts/generate-icons.mjs` 실행.
// ============================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
mkdirSync(OUT_DIR, { recursive: true });

const SIZE = 64;
const INK = '#161018';   // 공통 외곽선 (거의 검정 — 대비를 크게)
const OUT_W = 3;         // 외곽선 두께

// 채도 높은 아케이드 팔레트 (자원·구조물 공용)
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
  dark: '#2f2a33', darkL: '#4a444f', darkD: '#171319',
  copperL: '#ff9f5a', copper: '#d2691e', copperD: '#8a3f0c',
  coalL: '#5a5a66', coal: '#33333d', coalD: '#1a1a22',
  oilL: '#4a4a58', oil: '#26262f', oilD: '#101014',
  cyanL: '#9df4ee', cyan: '#3fd6c8', cyanD: '#1d8c84',
  glass: '#ffe9a8',
  meatL: '#ff9d8a', meat: '#e0604c', meatD: '#8f2f22',
  wheatL: '#ffe17a', wheat: '#e8b93c', wheatD: '#9c7411',
  plasticL: '#a8e4f5', plastic: '#5cb8d6', plasticD: '#2b7794',
};

/** 외곽선이 들어간 도형 */
const sh = (d, fill, sw = OUT_W) => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
const rc = (x, y, w, h, fill, r = 2, sw = OUT_W) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`;
const ci = (cx, cy, r, fill, sw = OUT_W) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`;
/** 외곽선 없는 내부 디테일 (음영·하이라이트) */
const fd = (d, fill, op = 1) => `<path d="${d}" fill="${fill}" opacity="${op}"/>`;
const fr = (x, y, w, h, fill, r = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
/** 바닥 그림자 */
const ground = `<ellipse cx="32" cy="55" rx="24" ry="5" fill="#000" opacity="0.28"/>`;
const groundSm = `<ellipse cx="32" cy="54" rx="18" ry="4" fill="#000" opacity="0.25"/>`;

// ============================================================
// 자원 그림 (assets/icons/*.svg)
// 배지 없이 사물 자체를 그린다 — 굵은 외곽선 덕에 지도 위에서도 잘 보인다.
// ============================================================

/** 광석 덩어리 (원석류 공용) */
const oreRock = (light, base, dark, gem) => `${groundSm}
  ${sh('M10 44 L16 24 L30 14 L48 20 L54 40 L44 52 L20 52 Z', base)}
  ${fd('M30 14 L48 20 L54 40 L44 52 L32 52 Z', dark, 0.5)}
  ${fd('M18 26 L29 18 L36 26 L26 36 Z', light, 0.9)}
  ${gem ? `<circle cx="26" cy="30" r="4" fill="${gem}"/><circle cx="40" cy="38" r="3" fill="${gem}"/>` : ''}`;

/** 주괴 (사다리꼴 금속 덩어리) */
const ingot = (light, base, dark) => `${groundSm}
  ${sh('M8 46 L16 26 H48 L56 46 Z', base)}
  ${fd('M32 26 H48 L56 46 H32 Z', dark, 0.45)}
  ${fd('M18 30 H30 L27 38 H14 Z', light, 0.85)}
  <path d="M16 26 H48" stroke="${INK}" stroke-width="2.5"/>`;

/** 액체 방울 */
const drop = (light, base, dark) => `${groundSm}
  ${sh('M32 8 C42 24 50 33 50 41 A18 18 0 0 1 14 41 C14 33 22 24 32 8 Z', base)}
  ${fd('M32 8 C42 24 50 33 50 41 A18 18 0 0 1 32 59 Z', dark, 0.4)}
  ${fd('M24 36 a7 9 0 0 1 6 -12 a9 9 0 0 0 -6 12 Z', light, 0.95)}`;

/** 고기 조각 — 만화풍 햄 덩어리에 뼈가 삐죽 나온 모양 (가축 종류별로 색만 바꿔 쓴다) */
const meatCut = (light, base, dark) => `${groundSm}
  <path d="M12 52 L52 12" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
  <path d="M12 52 L52 12" stroke="#f4ead6" stroke-width="7" stroke-linecap="round"/>
  ${sh('M20 14 q16 -4 24 8 q10 16 -2 28 q-14 12 -26 0 q-12 -14 4 -36 Z', base)}
  ${fd('M32 11 q10 1 12 11 q10 16 -2 28 q-5 5 -12 5 Z', dark, 0.45)}
  ${fd('M24 28 a9 8 0 0 1 10 -6 a11 9 0 0 0 -11 12 Z', light, 0.9)}
  <path d="M26 42 q6 5 13 1" fill="none" stroke="${dark}" stroke-width="2.5" opacity="0.5" stroke-linecap="round"/>`;

const resArt = {
  wood: `${groundSm}
    ${sh('M32 6 L46 28 H38 L50 46 H14 L26 28 H18 Z', P.green)}
    ${fd('M32 6 L46 28 H38 L50 46 H32 Z', P.greenD, 0.45)}
    ${rc(28, 44, 8, 12, P.woodD, 2)}`,
  stone: oreRock(P.stoneL, P.stone, P.stoneD),
  coal: oreRock(P.coalL, P.coal, P.coalD),
  iron_ore: oreRock('#d8b9a8', '#a86b4c', '#6d3f28', '#8d99a6'),
  gold_ore: oreRock('#ffe9a0', '#c9a227', '#7d5f0d', P.goldL),
  copper_ore: oreRock(P.copperL, P.copper, P.copperD, '#ffb27a'),
  crude_oil: drop(P.oilL, P.oil, P.oilD),
  mana_stone: `${groundSm}
    ${sh('M32 6 L48 24 L40 56 H24 L16 24 Z', P.purple)}
    ${fd('M32 6 L48 24 L40 56 H32 Z', P.purpleD, 0.5)}
    ${fd('M24 22 L32 12 L36 24 L28 34 Z', P.purpleL, 0.95)}`,

  iron_ingot: ingot(P.metalL, P.metal, P.metalD),
  gold_ingot: ingot(P.goldL, P.gold, P.goldD),
  copper_ingot: ingot(P.copperL, P.copper, P.copperD),

  petroleum: `${groundSm}
    ${rc(14, 16, 36, 40, '#3a3a46', 4)}
    ${fd('M32 16 H50 V56 H32 Z', '#1c1c24', 0.5)}
    ${fr(18, 24, 28, 10, P.goldL, 2)}
    <path d="M14 40 H50" stroke="${INK}" stroke-width="2.5"/>`,
  naphtha: drop(P.cyanL, P.cyan, P.cyanD),

  electricity: `${groundSm}
    ${sh('M36 4 L14 34 h13 l-5 26 L50 28 H35 l5 -24 Z', P.goldL)}
    ${fd('M36 4 L40 4 l-5 24 h15 L22 60 Z', P.goldD, 0.35)}`,
  gold: `${groundSm}
    ${ci(32, 32, 20, P.gold)}
    ${fd('M32 12 a20 20 0 0 1 0 40 Z', P.goldD, 0.4)}
    ${ci(32, 32, 13, P.goldL, 2.5)}
    ${fd('M32 22 l3 7 l8 .5 l-6 5 l2 8 l-7 -4.4 l-7 4.4 l2 -8 l-6 -5 l8 -.5 Z', P.goldD, 0.9)}`,

  plank: `${groundSm}
    ${rc(6, 20, 52, 12, P.woodL, 2)}
    ${fd('M6 27 H58 V32 H6 Z', P.woodD, 0.4)}
    ${rc(6, 34, 52, 12, P.wood, 2)}
    ${fd('M6 41 H58 V46 H6 Z', P.woodD, 0.45)}
    <path d="M20 20 V32 M40 20 V32 M28 34 V46 M48 34 V46" stroke="${P.woodD}" stroke-width="2" opacity="0.7"/>`,
  brick: `${groundSm}
    ${rc(6, 18, 52, 30, '#c0603f', 2)}
    ${fd('M6 33 H58 V48 H6 Z', '#8a3a22', 0.45)}
    <path d="M6 28 H58 M6 38 H58" stroke="${INK}" stroke-width="2.5"/>
    <path d="M22 18 V28 M42 18 V28 M14 28 V38 M34 28 V38 M52 28 V38 M22 38 V48 M42 38 V48" stroke="${INK}" stroke-width="2.5"/>`,

  copper_wire: `${groundSm}
    <path d="M10 46 Q10 18 32 18 Q54 18 54 40" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M10 46 Q10 18 32 18 Q54 18 54 40" fill="none" stroke="${P.copper}" stroke-width="5" stroke-linecap="round"/>
    <path d="M12 42 Q13 24 30 22" fill="none" stroke="${P.copperL}" stroke-width="2" stroke-linecap="round"/>
    ${ci(10, 48, 5, P.copperL, 2.5)}${ci(54, 42, 5, P.copperL, 2.5)}`,
  plastic: `${groundSm}
    ${rc(18, 18, 28, 36, P.plastic, 5)}
    ${fd('M32 18 H46 V54 H32 Z', P.plasticD, 0.45)}
    ${fd('M22 24 h6 v22 h-6 Z', P.plasticL, 0.9)}
    ${rc(26, 8, 12, 10, P.plasticD, 2)}`,

  circuit_board: `${groundSm}
    ${rc(10, 14, 44, 38, '#2f9e5e', 3)}
    ${fd('M32 14 H54 V52 H32 Z', '#1c6b3e', 0.45)}
    ${rc(24, 26, 16, 15, '#20303a', 2, 2.5)}
    <path d="M17 20 H24 M17 26 H24 M17 33 H24 M40 20 H47 M40 33 H47 M32 41 V48" stroke="${P.goldL}" stroke-width="2.5"/>
    <circle cx="17" cy="45" r="3" fill="${P.goldL}"/><circle cx="47" cy="45" r="3" fill="${P.goldL}"/>`,
  rebar: `${groundSm}
    ${[16, 30, 44].map(x => `<path d="M${x} 10 L${x - 6} 54" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
      <path d="M${x} 10 L${x - 6} 54" stroke="${P.stone}" stroke-width="5.5" stroke-linecap="round"/>`).join('')}
    <path d="M8 24 H54 M6 40 H52" stroke="${INK}" stroke-width="4"/>
    <path d="M8 24 H54 M6 40 H52" stroke="${P.stoneL}" stroke-width="2"/>`,

  wood_spear: `${groundSm}
    <path d="M14 52 L44 16" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M14 52 L44 16" stroke="${P.wood}" stroke-width="5" stroke-linecap="round"/>
    ${sh('M40 20 L54 6 L52 22 L38 26 Z', P.stoneL, 2.5)}`,
  iron_spear: `${groundSm}
    <path d="M14 52 L42 18" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M14 52 L42 18" stroke="${P.woodD}" stroke-width="5" stroke-linecap="round"/>
    ${sh('M36 24 L56 4 L52 26 L34 32 Z', P.metalL, 2.5)}
    ${fd('M46 14 L52 26 L38 30 Z', P.metalD, 0.5)}`,
  wood_shield: `${groundSm}
    ${sh('M32 6 L52 14 V30 C52 44 44 52 32 58 C20 52 12 44 12 30 V14 Z', P.woodL)}
    ${fd('M32 6 L52 14 V30 C52 44 44 52 32 58 Z', P.woodD, 0.45)}
    ${fd('M32 16 L44 21 V30 C44 39 39 45 32 49 Z', P.wood, 0.6)}
    <path d="M32 6 V58" stroke="${INK}" stroke-width="2.5"/>`,
  iron_shield: `${groundSm}
    ${sh('M32 6 L52 14 V30 C52 44 44 52 32 58 C20 52 12 44 12 30 V14 Z', P.metalL)}
    ${fd('M32 6 L52 14 V30 C52 44 44 52 32 58 Z', P.metalD, 0.45)}
    ${ci(32, 30, 8, P.gold, 2.5)}`,
  gun: `${groundSm}
    ${sh('M8 26 H40 V18 H50 V34 H40 V38 H24 V52 H12 V38 H8 Z', P.darkL)}
    ${fd('M24 38 H40 V26 H24 Z', P.darkD, 0.5)}
    ${fr(12, 29, 10, 4, P.metalL, 1)}`,
  vest: `${groundSm}
    ${sh('M18 12 L32 20 L46 12 L52 22 L46 25 V54 H36 V36 H28 V54 H18 V25 L12 22 Z', P.wheat)}
    ${fd('M32 20 L46 12 L52 22 L46 25 V54 H36 V36 H32 Z', P.wheatD, 0.45)}
    ${fr(20, 30, 6, 12, P.darkD, 1)}${fr(38, 30, 6, 12, P.darkD, 1)}`,

  // HUD 상태 아이콘
  trophy: `${groundSm}
    ${sh('M20 8 H44 V24 C44 34 38 40 32 40 C26 40 20 34 20 24 Z', P.gold)}
    ${fd('M32 8 H44 V24 C44 34 38 40 32 40 Z', P.goldD, 0.4)}
    <path d="M20 12 H10 V20 C10 27 15 31 20 30" fill="none" stroke="${INK}" stroke-width="4"/>
    <path d="M44 12 H54 V20 C54 27 49 31 44 30" fill="none" stroke="${INK}" stroke-width="4"/>
    ${rc(27, 40, 10, 8, P.goldD, 1)}
    ${rc(18, 48, 28, 8, P.gold, 2)}`,
  shield_status: `${groundSm}
    ${sh('M32 6 L52 14 V30 C52 44 44 52 32 58 C20 52 12 44 12 30 V14 Z', P.cyan)}
    ${fd('M32 6 L52 14 V30 C52 44 44 52 32 58 Z', P.cyanD, 0.45)}
    ${fd('M22 30 l7 8 l14 -16 l3 4 l-17 19 l-10 -11 Z', '#ffffff', 0.95)}`,
  water: drop(P.blueL, P.blue, P.blueD),

  // ---- 인력 ----
  labor: `${groundSm}
    ${ci(32, 16, 9, '#f0c9a0')}
    ${sh('M14 54 q0 -18 18 -18 q18 0 18 18 Z', P.blue)}
    ${fd('M32 36 q18 0 18 18 H32 Z', P.blueD, 0.45)}`,

  // ---- 작물 ----
  rice: `${groundSm}
    ${sh('M32 54 C24 44 24 24 32 10 C40 24 40 44 32 54 Z', '#e8dfc0')}
    ${fd('M32 10 C40 24 40 44 32 54 Z', '#b8ac86', 0.45)}
    ${[20,28,36,44].map(y=>`<path d="M32 ${y} l-8 -5 M32 ${y} l8 -5" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`).join('')}`,
  wheat: `${groundSm}
    <path d="M32 54 V22" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M32 54 V22" stroke="${P.wheatD}" stroke-width="2.2" stroke-linecap="round"/>
    ${sh('M32 44 C22 40 20 30 22 22 C31 25 33 35 32 44 Z', P.wheat, 2.5)}
    ${sh('M32 44 C42 40 44 30 42 22 C33 25 31 35 32 44 Z', P.wheatL, 2.5)}
    ${sh('M32 26 C26 22 25 14 26 8 C32 12 33 20 32 26 Z', P.wheat, 2.5)}
    ${sh('M32 26 C38 22 39 14 38 8 C32 12 31 20 32 26 Z', P.wheatL, 2.5)}`,
  corn: `${groundSm}
    ${sh('M32 6 q13 10 13 26 q0 18 -13 22 q-13 -4 -13 -22 q0 -16 13 -26 Z', P.goldL)}
    ${fd('M32 6 q13 10 13 26 q0 18 -13 22 Z', P.goldD, 0.4)}
    ${[18,26,34,42].map(y=>`<path d="M22 ${y} H42" stroke="${P.goldD}" stroke-width="2"/>`).join('')}
    ${sh('M20 30 q-12 6 -8 22 q12 -4 12 -18 Z', P.green, 2.5)}`,
  apple: `${groundSm}
    ${sh('M32 18 q16 -4 16 16 q0 18 -16 20 q-16 -2 -16 -20 q0 -20 16 -16 Z', P.red)}
    ${fd('M32 18 q16 -4 16 16 q0 18 -16 20 Z', P.redD, 0.42)}
    ${fd('M22 28 a6 7 0 0 1 6 -6 a8 8 0 0 0 -6 10 Z', P.redL, 0.95)}
    <path d="M32 18 V8" stroke="${P.woodD}" stroke-width="4" stroke-linecap="round"/>
    ${sh('M32 12 q12 -8 14 2 q-10 6 -14 -2 Z', P.green, 2.5)}`,
  grape: `${groundSm}
    <path d="M32 12 V20" stroke="${P.woodD}" stroke-width="4" stroke-linecap="round"/>
    ${sh('M32 10 q11 -7 13 2 q-9 6 -13 -2 Z', P.green, 2.5)}
    ${[[24,26],[40,26],[32,32],[22,38],[42,38],[32,44],[26,50],[38,50]].map(([cx,cy])=>ci(cx,cy,7,P.purple,2.5)).join('')}
    ${[[24,26],[32,32],[22,38]].map(([cx,cy])=>`<circle cx="${cx-2}" cy="${cy-2}" r="2.5" fill="${P.purpleL}"/>`).join('')}`,

  // ---- 가축 ----
  // 가축은 몸 전체보다 얼굴이 작은 크기에서 훨씬 잘 구분돼서 정면 얼굴로 그린다.
  cattle: `${groundSm}
    ${sh('M12 16 q-8 -6 -3 -11 q7 -2 9 6 Z', '#e8e2d6', 2.5)}
    ${sh('M52 16 q8 -6 3 -11 q-7 -2 -9 6 Z', '#e8e2d6', 2.5)}
    ${sh('M32 8 q20 0 20 18 q0 22 -20 26 q-20 -4 -20 -26 q0 -18 20 -18 Z', '#f2ece2')}
    ${fd('M32 8 q20 0 20 18 q0 22 -20 26 Z', '#c4b8a8', 0.4)}
    ${fd('M17 16 a9 8 0 0 1 12 3 a11 9 0 0 1 -15 5 Z', '#5a4632', 0.9)}
    ${sh('M32 32 q13 0 13 9 q0 9 -13 9 q-13 0 -13 -9 q0 -9 13 -9 Z', '#f0b8bc')}
    <circle cx="27" cy="40" r="2.4" fill="${INK}"/><circle cx="37" cy="40" r="2.4" fill="${INK}"/>
    <circle cx="23" cy="24" r="3" fill="${INK}"/><circle cx="41" cy="24" r="3" fill="${INK}"/>`,
  pig: `${groundSm}
    ${sh('M13 18 q-4 -12 6 -11 q6 1 7 9 Z', '#f5a8b8', 2.5)}
    ${sh('M51 18 q4 -12 -6 -11 q-6 1 -7 9 Z', '#f5a8b8', 2.5)}
    ${sh('M32 10 q21 0 21 19 q0 21 -21 25 q-21 -4 -21 -25 q0 -19 21 -19 Z', '#f5a8b8')}
    ${fd('M32 10 q21 0 21 19 q0 21 -21 25 Z', '#c96f84', 0.38)}
    ${sh('M32 32 q12 0 12 9 q0 9 -12 9 q-12 0 -12 -9 q0 -9 12 -9 Z', '#e07f96')}
    <circle cx="28" cy="41" r="2.6" fill="${INK}"/><circle cx="36" cy="41" r="2.6" fill="${INK}"/>
    <circle cx="24" cy="25" r="3" fill="${INK}"/><circle cx="40" cy="25" r="3" fill="${INK}"/>`,
  chicken: `${groundSm}
    ${sh('M24 14 q1 -8 8 -6 q7 -2 8 6 q4 -3 6 3 q-9 4 -22 1 Z', P.red, 2.5)}
    ${sh('M32 12 q19 0 19 18 q0 20 -19 24 q-19 -4 -19 -24 q0 -18 19 -18 Z', '#f7f2e2')}
    ${fd('M32 12 q19 0 19 18 q0 20 -19 24 Z', '#cbc0a2', 0.38)}
    ${sh('M32 34 l-8 6 h16 Z', P.goldL, 2.5)}
    ${sh('M26 42 q6 8 12 0 q-6 4 -12 0 Z', P.red, 2)}
    <circle cx="24" cy="26" r="3.2" fill="${INK}"/><circle cx="40" cy="26" r="3.2" fill="${INK}"/>`,
  duck: `${groundSm}
    ${sh('M32 10 q19 0 19 18 q0 18 -19 22 q-19 -4 -19 -22 q0 -18 19 -18 Z', '#eaf0f6')}
    ${fd('M32 10 q19 0 19 18 q0 18 -19 22 Z', '#a8b6c4', 0.38)}
    ${sh('M32 32 q15 0 15 9 q0 9 -15 9 q-15 0 -15 -9 q0 -9 15 -9 Z', P.goldL)}
    ${fd('M32 32 q15 0 15 9 q0 9 -15 9 Z', P.goldD, 0.32)}
    <path d="M20 41 H44" stroke="${INK}" stroke-width="2.2"/>
    <circle cx="24" cy="24" r="3.2" fill="${INK}"/><circle cx="40" cy="24" r="3.2" fill="${INK}"/>`,

  // ---- 축산물 ----
  milk: `${groundSm}
    ${sh('M20 20 h24 v30 a6 6 0 0 1 -6 6 H26 a6 6 0 0 1 -6 -6 Z', '#f7f5ef')}
    ${fd('M32 20 h12 v30 a6 6 0 0 1 -6 6 H32 Z', '#c9c6bc', 0.45)}
    ${sh('M24 8 h16 l4 12 H20 Z', '#e6e2d6')}
    ${fr(25, 32, 14, 10, P.blue, 2)}`,
  egg: `${groundSm}
    ${sh('M32 8 C44 20 48 32 48 40 A16 18 0 0 1 16 40 C16 32 20 20 32 8 Z', '#f7ecd2')}
    ${fd('M32 8 C44 20 48 32 48 40 A16 18 0 0 1 32 58 Z', '#cfc0a0', 0.42)}
    ${fd('M25 32 a8 10 0 0 1 5 -14 a11 13 0 0 0 -5 14 Z', '#fffaf0', 0.95)}`,
  beef: meatCut(P.meatL, P.meat, P.meatD),
  pork: meatCut('#ffc0c8', '#f08898', '#b04f60'),
  chicken_meat: meatCut('#f5e0b0', '#e0bc78', '#a07f3c'),
  duck_meat: meatCut('#e0b489', '#c08a5a', '#7d5228'),

  // ---- 조리 1차 가공품 ----
  flour: `${groundSm}
    ${sh('M16 22 h32 l4 30 a4 4 0 0 1 -4 4 H16 a4 4 0 0 1 -4 -4 Z', '#efe8d8')}
    ${fd('M32 22 h16 l4 30 a4 4 0 0 1 -4 4 H32 Z', '#c4bca8', 0.45)}
    ${sh('M18 14 q14 -8 28 0 l2 8 H16 Z', '#dfd6c2')}
    ${fd('M24 34 h16 v10 h-16 Z', '#c4bca8', 0.5)}`,
  butter: `${groundSm}
    ${sh('M8 34 L18 22 H52 L44 46 H12 Z', P.goldL)}
    ${fd('M44 22 L52 22 L44 46 H32 Z', P.goldD, 0.4)}
    ${fd('M20 26 h16 l-3 8 H17 Z', '#fff3c0', 0.8)}`,
  cheese: `${groundSm}
    ${sh('M8 44 L20 22 H54 L48 48 H12 Z', P.gold)}
    ${fd('M40 22 H54 L48 48 H34 Z', P.goldD, 0.4)}
    <circle cx="24" cy="36" r="4" fill="${P.goldD}"/><circle cx="36" cy="42" r="3" fill="${P.goldD}"/>
    <circle cx="40" cy="30" r="2.6" fill="${P.goldD}"/>`,
  dough: `${groundSm}
    ${sh('M10 42 q4 -18 22 -18 q18 0 22 18 q-4 12 -22 12 q-18 0 -22 -12 Z', '#ecdcbe')}
    ${fd('M32 24 q18 0 22 18 q-4 12 -22 12 Z', '#c2ab88', 0.42)}
    ${fd('M18 34 a8 5 0 0 1 10 -3 a10 6 0 0 0 -10 6 Z', '#fdf3dd', 0.9)}`,
  boiled_rice: `${groundSm}
    ${sh('M10 38 q22 -22 44 0 q-6 14 -22 14 q-16 0 -22 -14 Z', '#faf7ee')}
    ${fd('M32 27 q14 2 22 11 q-6 14 -22 14 Z', '#cfc9ba', 0.4)}
    ${sh('M6 38 h52 a4 4 0 0 1 -4 8 H10 a4 4 0 0 1 -4 -8 Z', P.blue)}`,

  // ---- 완성 요리 ----
  bread: `${groundSm}
    ${sh('M8 42 q2 -22 24 -22 q22 0 24 22 q-4 12 -24 12 q-20 0 -24 -12 Z', '#d99b4e')}
    ${fd('M32 20 q22 0 24 22 q-4 12 -24 12 Z', '#9c6222', 0.42)}
    <path d="M20 30 l6 -8 M30 28 l6 -8 M40 30 l6 -8" stroke="#7d4d18" stroke-width="3" stroke-linecap="round"/>`,
  popcorn: `${groundSm}
    ${sh('M18 28 h28 l-4 28 H22 Z', '#f2f0e8')}
    ${[22,30,38].map(x=>`<rect x="${x}" y="30" width="6" height="26" fill="${P.red}" opacity="0.8"/>`).join('')}
    ${[[22,22],[32,18],[42,22],[27,26],[38,26]].map(([cx,cy])=>ci(cx,cy,7,'#fdf6d8',2.5)).join('')}`,
  grape_juice: `${groundSm}
    ${sh('M20 10 h24 l-3 20 a9 9 0 0 1 -18 0 Z', '#efe9dd')}
    ${fd('M23 18 h18 l-2 10 a8 8 0 0 1 -14 0 Z', P.purple, 0.95)}
    <path d="M32 40 V50" stroke="${INK}" stroke-width="4"/>
    ${rc(20, 50, 24, 6, '#efe9dd', 2)}`,
  steak: `${groundSm}
    ${sh('M12 36 q6 -18 24 -16 q20 2 16 20 q-4 16 -22 14 q-20 -2 -18 -18 Z', '#a8422f')}
    ${fd('M36 20 q20 2 16 20 q-4 16 -22 14 Z', '#6d2416', 0.45)}
    <path d="M20 30 l16 4 M18 40 l18 4" stroke="#5d1d10" stroke-width="3" stroke-linecap="round"/>
    ${fd('M40 24 a10 8 0 0 1 6 12 a12 10 0 0 0 -6 -14 Z', '#f2e8d0', 0.9)}`,
  grilled_pork: `${groundSm}
    ${[24,36,48].map(y=>`<path d="M10 ${y} h44" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>
      <path d="M10 ${y} h44" stroke="#e08b76" stroke-width="7" stroke-linecap="round"/>
      <path d="M14 ${y} h12" stroke="#f7e4d0" stroke-width="4" stroke-linecap="round"/>`).join('')}`,
  fried_chicken: `${groundSm}
    ${sh('M14 34 a16 16 0 1 1 24 -8 a15 15 0 0 1 -8 22 Z', '#dba33f')}
    ${fd('M30 20 a15 15 0 0 1 0 28 l-8 0 Z', '#a06f18', 0.45)}
    <circle cx="22" cy="26" r="2.4" fill="#8a5c12"/><circle cx="28" cy="34" r="2" fill="#8a5c12"/>
    <path d="M30 44 L46 56" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
    <path d="M30 44 L46 56" stroke="#efe2cd" stroke-width="6" stroke-linecap="round"/>`,
  roast_duck: `${groundSm}
    ${sh('M10 42 q6 -22 26 -20 q22 2 18 20 q-4 12 -22 12 q-20 0 -22 -12 Z', '#b06a35')}
    ${fd('M36 22 q22 2 18 20 q-4 12 -22 12 Z', '#7a4218', 0.45)}
    ${sh('M46 20 q10 -6 12 2 q-8 6 -12 -2 Z', P.red, 2.5)}
    <circle cx="24" cy="34" r="2.4" fill="#5d3010"/><circle cx="34" cy="40" r="2" fill="#5d3010"/>`,
  omelet: `${groundSm}
    ${sh('M8 44 q6 -22 24 -22 q18 0 24 22 q-8 8 -24 8 q-16 0 -24 -8 Z', P.goldL)}
    ${fd('M32 22 q18 0 24 22 q-8 8 -24 8 Z', P.goldD, 0.4)}
    ${fd('M18 34 a8 6 0 0 1 10 -4 a10 7 0 0 0 -10 8 Z', '#fff6cf', 0.9)}
    <path d="M22 44 q10 -6 20 0" stroke="${P.red}" stroke-width="3" fill="none"/>`,
  sandwich: `${groundSm}
    ${sh('M8 20 L32 10 L56 20 L32 30 Z', '#e0b878')}
    ${sh('M8 30 h48 v6 H8 Z', P.green)}
    ${sh('M8 36 h48 v6 H8 Z', P.gold)}
    ${sh('M8 42 q24 12 48 0 v6 q-24 12 -48 0 Z', '#e0b878')}`,
  bibimbap: `${groundSm}
    ${sh('M8 32 q24 -10 48 0 q-4 20 -24 20 q-20 0 -24 -20 Z', '#e8e2d2')}
    ${fd('M32 27 q14 1 24 5 q-4 20 -24 20 Z', '#bdb6a4', 0.35)}
    ${ci(22, 36, 5, P.green, 2.5)}${ci(42, 36, 5, P.red, 2.5)}
    ${ci(32, 44, 5, P.goldL, 2.5)}${ci(32, 32, 4, '#a8422f', 2.5)}
    ${sh('M4 30 h56 a4 4 0 0 1 -4 8 H8 a4 4 0 0 1 -4 -8 Z', '#3a6fa8')}`,
  fruit_pie: `${groundSm}
    ${sh('M6 34 q26 -16 52 0 q-4 18 -26 18 q-22 0 -26 -18 Z', '#e0a44c')}
    ${fd('M32 27 q16 1 26 7 q-4 18 -26 18 Z', '#a86f1c', 0.42)}
    <path d="M14 34 L50 40 M20 44 L46 30" stroke="#c98a2c" stroke-width="4"/>
    ${ci(24, 32, 4, P.red, 2)}${ci(40, 36, 4, P.purple, 2)}`,
  cake: `${groundSm}
    ${sh('M10 34 h44 v18 a4 4 0 0 1 -4 4 H14 a4 4 0 0 1 -4 -4 Z', '#f7d0dc')}
    ${fd('M32 34 h22 v18 a4 4 0 0 1 -4 4 H32 Z', '#c98499', 0.45)}
    ${sh('M10 26 q22 -10 44 0 v8 H10 Z', '#fdf0f4')}
    ${[[20,20],[32,16],[44,20]].map(([cx,cy])=>ci(cx,cy,4,P.red,2)).join('')}
    <path d="M32 16 V6" stroke="${INK}" stroke-width="3"/>
    ${sh('M32 4 q4 3 0 6 q-4 -3 0 -6 Z', P.goldL, 2)}`,
};

for (const [key, body] of Object.entries(resArt)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">\n  ${body}\n</svg>`;
  writeFileSync(path.join(OUT_DIR, `${key}.svg`), svg, 'utf-8');
}
const SPEC = resArt; // 아래 로그에서 개수 표시용

// ============================================================
// (필드 캔버스와 건설 카탈로그가 같은 그림을 공유한다)
// ============================================================
const STRUCT_DIR = path.join(OUT_DIR, 'struct');
mkdirSync(STRUCT_DIR, { recursive: true });

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

  // 조리소 — 벽돌 화덕과 김이 오르는 냄비. 붉은 화구가 있어 공장류와 헷갈리지 않는다.
  kitchen: `${ground}
    ${rc(6, 24, 52, 30, P.roofL, 3)}
    ${fd('M32 24 H58 V54 H32 Z', P.roofD, 0.4)}
    <path d="M6 34 H58 M6 44 H58 M19 24 V34 M45 24 V34 M32 34 V44 M19 44 V54 M45 44 V54" stroke="${INK}" stroke-width="2.2"/>
    ${sh('M18 40 h28 a4 4 0 0 1 -4 12 H22 a4 4 0 0 1 -4 -12 Z', P.metalL)}
    ${fd('M32 40 h14 a4 4 0 0 1 -4 12 H32 Z', P.metalD, 0.4)}
    ${rc(14, 36, 36, 5, P.metal, 2)}
    <path d="M26 32 q-4 -5 0 -10 q4 -5 0 -10 M38 32 q-4 -5 0 -10 q4 -5 0 -10" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M26 32 q-4 -5 0 -10 q4 -5 0 -10 M38 32 q-4 -5 0 -10 q4 -5 0 -10" fill="none" stroke="#f2f7ff" stroke-width="2" stroke-linecap="round"/>`,

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

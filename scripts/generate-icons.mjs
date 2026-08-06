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
// 입체(3D) 프리미티브
//
// 게임 카메라는 정면에서 살짝 내려다볼 뿐 좌우로 돌아가 있지 않다(요각 0).
// 그래서 물체를 "정면 + 위에서 보이는 윗면"으로 그린다. 윗면은 뒤로 갈수록
// 좁아지는 사다리꼴이라, 한 장의 그림만으로도 위에서 내려다본 면으로 읽힌다.
// 빛은 항상 왼쪽 위에서 온다 — 윗면이 가장 밝고, 정면은 중간, 바닥 쪽은 어둡다.
// ============================================================
const BACK = 0.78;   // 윗면 뒤쪽 모서리 폭 비율 (작을수록 원근이 강하다)

/** 윗면 — (x,y)가 앞쪽 모서리, 뒤로(위로) d만큼 들어간 사다리꼴 */
const topFace = (x, y, w, d, fill, sw = OUT_W) => {
  const i = (w * (1 - BACK)) / 2;
  return sh(`M${x} ${y} H${x + w} L${x + w - i} ${y - d} H${x + i} Z`, fill, sw);
};
/** 정면 벽 — 아래쪽을 어둡게 깔아 두께감을 준다 */
const frontFace = (x, y, w, h, fill, r = 1) =>
  `${rc(x, y, w, h, fill, r)}${fd(`M${x} ${y + h * 0.62} h${w} v${h * 0.38} h${-w} Z`, INK, 0.16)}`;
/** 상자 — 정면 + 윗면 한 벌 */
const box3 = (x, y, w, h, d, faceCol, topCol, r = 1) =>
  `${topFace(x, y, w, d, topCol)}${frontFace(x, y, w, h, faceCol, r)}`;
/** 원기둥 — 옆면 + 위 타원 (탱크·굴뚝·포탑 받침) */
const cyl3 = (cx, yTop, rx, h, ry, light, base, dark) => `
  ${sh(`M${cx - rx} ${yTop} v${h} a${rx} ${ry} 0 0 0 ${2 * rx} 0 v${-h} a${rx} ${ry} 0 0 0 ${-2 * rx} 0 Z`, base)}
  ${fd(`M${cx + rx * 0.34} ${yTop} v${h} a${rx * 0.66} ${ry} 0 0 0 ${rx * 0.66} ${-ry * 0.1} v${-h} Z`, dark, 0.42)}
  ${fd(`M${cx - rx * 0.85} ${yTop + ry} v${h} a${rx * 0.3} ${ry} 0 0 0 ${rx * 0.3} ${ry * 0.4} v${-h - ry * 0.4} Z`, light, 0.55)}
  <ellipse cx="${cx}" cy="${yTop}" rx="${rx}" ry="${ry}" fill="${light}" stroke="${INK}" stroke-width="${OUT_W}"/>`;
/** 위가 좁은 원뿔대 — 냉각탑·굴뚝 */
const taper3 = (cx, yTop, rTop, yBot, rBot, ry, light, base, dark) => `
  ${sh(`M${cx - rBot} ${yBot} L${cx - rTop} ${yTop} a${rTop} ${ry} 0 0 0 ${2 * rTop} 0 L${cx + rBot} ${yBot} a${rBot} ${ry * 1.1} 0 0 1 ${-2 * rBot} 0 Z`, base)}
  ${fd(`M${cx + rTop * 0.3} ${yTop} L${cx + rBot * 0.35} ${yBot + ry * 0.8} L${cx + rBot} ${yBot} L${cx + rTop} ${yTop} Z`, dark, 0.4)}
  <ellipse cx="${cx}" cy="${yTop}" rx="${rTop}" ry="${ry}" fill="${light}" stroke="${INK}" stroke-width="${OUT_W}"/>`;
/** 지붕 — 처마선(y)에서 뒤로 d만큼 올라가는 경사면 + 용마루 하이라이트 */
const roof3 = (x, y, w, d, light, dark) => {
  const i = (w * (1 - BACK)) / 2;
  return `${topFace(x, y, w, d, light)}
    ${fd(`M${x + w * 0.55} ${y} H${x + w} L${x + w - i} ${y - d} H${x + w * 0.55 + i * 0.5} Z`, dark, 0.35)}
    <path d="M${x + i} ${y - d} H${x + w - i}" stroke="${INK}" stroke-width="2.2"/>`;
};
/** 바닥에 닿는 타원 — 서 있는 물체가 떠 보이지 않게 한다 */
const foot = (cx, cy, rx, fill) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * 0.34}" fill="${fill}" stroke="${INK}" stroke-width="${OUT_W}"/>`;

// ============================================================
// 자원 그림 (assets/icons/*.svg)
// 배지 없이 사물 자체를 그린다 — 굵은 외곽선 덕에 지도 위에서도 잘 보인다.
// ============================================================

/**
 * 광석 덩어리 (원석류 공용) — 지도에 세워 놓이는 자원 노드라서
 * 위에서 빛을 받는 윗면(밝은 다면체)과 땅에 닿는 앞면을 나눠 깎았다.
 */
const oreRock = (light, base, dark, gem) => `${groundSm}
  ${sh('M8 46 L14 34 L26 28 L44 30 L56 40 L52 50 L18 52 Z', base)}
  ${fd('M40 29 L56 40 L52 50 L34 52 Z', dark, 0.5)}
  ${sh('M14 34 L24 20 L40 16 L48 26 L44 30 L26 28 Z', light, 2.5)}
  ${fd('M24 20 L40 16 L48 26 L38 25 Z', base, 0.55)}
  <path d="M26 28 L44 30" stroke="${INK}" stroke-width="2.2"/>
  ${gem ? `<circle cx="24" cy="40" r="4" fill="${gem}" stroke="${INK}" stroke-width="2"/>
           <circle cx="42" cy="43" r="3" fill="${gem}" stroke="${INK}" stroke-width="1.8"/>` : ''}`;

/** 주괴 — 위에서 내려다보이는 윗면이 있는 사다리꼴 금속 덩어리 */
const ingot = (light, base, dark) => `${groundSm}
  ${sh('M8 48 L16 32 H48 L56 48 Z', base)}
  ${fd('M34 32 H48 L56 48 H34 Z', dark, 0.4)}
  ${sh('M16 32 L22 22 H44 L48 32 Z', light, 2.5)}
  ${fd('M36 22 H44 L48 32 H36 Z', base, 0.4)}
  <path d="M16 32 H48" stroke="${INK}" stroke-width="2.4"/>`;

/** 액체 방울 — 바닥 웅덩이 위에 얹어 "고여 있는" 것으로 보이게 한다 */
const drop = (light, base, dark) => `${groundSm}
  <ellipse cx="32" cy="47" rx="23" ry="8.5" fill="${dark}" stroke="${INK}" stroke-width="${OUT_W}"/>
  <ellipse cx="32" cy="45.5" rx="16" ry="5" fill="${base}"/>
  <ellipse cx="24" cy="45" rx="6" ry="2" fill="${light}" opacity="0.5"/>
  ${sh('M32 4 C40 17 46 25 46 32 A14 13 0 0 1 18 32 C18 25 24 17 32 4 Z', base)}
  ${fd('M32 4 C40 17 46 25 46 32 A14 13 0 0 1 32 45 Z', dark, 0.42)}
  ${fd('M24 29 a6 8 0 0 1 5 -11 a8 8 0 0 0 -5 11 Z', light, 0.95)}`;

/** 고기 조각 — 만화풍 햄 덩어리에 뼈가 삐죽 나온 모양 (가축 종류별로 색만 바꿔 쓴다) */
const meatCut = (light, base, dark) => `${groundSm}
  <path d="M12 52 L52 12" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
  <path d="M12 52 L52 12" stroke="#f4ead6" stroke-width="7" stroke-linecap="round"/>
  ${sh('M20 14 q16 -4 24 8 q10 16 -2 28 q-14 12 -26 0 q-12 -14 4 -36 Z', base)}
  ${fd('M32 11 q10 1 12 11 q10 16 -2 28 q-5 5 -12 5 Z', dark, 0.45)}
  ${fd('M24 28 a9 8 0 0 1 10 -6 a11 9 0 0 0 -11 12 Z', light, 0.9)}
  <path d="M26 42 q6 5 13 1" fill="none" stroke="${dark}" stroke-width="2.5" opacity="0.5" stroke-linecap="round"/>`;

const resArt = {
  // 나무는 지도 위에 세워 놓이는 노드라 줄기·수관·바닥 접지를 또렷하게 나눴다
  wood: `${groundSm}
    ${foot(32, 51, 9, P.woodD)}
    ${rc(28, 34, 8, 16, P.wood, 2)}
    ${fd('M32 34 h4 v16 h-4 Z', P.woodD, 0.5)}
    ${sh('M32 4 L47 30 H17 Z', P.green)}
    ${fd('M32 4 L47 30 H32 Z', P.greenD, 0.42)}
    ${sh('M32 16 L50 40 H14 Z', P.green)}
    ${fd('M32 16 L50 40 H32 Z', P.greenD, 0.42)}
    ${fd('M32 10 L24 22 L32 20 Z', P.greenL, 0.85)}`,
  stone: oreRock(P.stoneL, P.stone, P.stoneD),
  coal: oreRock(P.coalL, P.coal, P.coalD),
  iron_ore: oreRock('#d8b9a8', '#a86b4c', '#6d3f28', '#8d99a6'),
  gold_ore: oreRock('#ffe9a0', '#c9a227', '#7d5f0d', P.goldL),
  copper_ore: oreRock(P.copperL, P.copper, P.copperD, '#ffb27a'),
  crude_oil: drop(P.oilL, P.oil, P.oilD),
  // 마석은 땅에서 솟은 결정 군집 — 작은 결정을 곁들여 덩어리로 보이게 한다
  mana_stone: `${groundSm}
    ${sh('M18 52 L14 34 L20 26 L26 32 L24 52 Z', P.purple, 2.5)}
    ${fd('M20 26 L26 32 L24 52 H20 Z', P.purpleD, 0.45)}
    ${sh('M46 52 L50 36 L44 30 L38 36 L40 52 Z', P.purple, 2.5)}
    ${fd('M44 30 L50 36 L46 52 H42 Z', P.purpleD, 0.45)}
    ${sh('M32 6 L44 24 L38 54 H26 L20 24 Z', P.purpleL)}
    ${fd('M32 6 L44 24 L38 54 H32 Z', P.purple, 0.55)}
    ${fd('M32 6 L44 24 L34 22 Z', P.purpleD, 0.35)}
    ${fd('M24 24 L32 12 L34 24 L28 34 Z', '#efe0ff', 0.75)}`,

  iron_ingot: ingot(P.metalL, P.metal, P.metalD),
  gold_ingot: ingot(P.goldL, P.gold, P.goldD),
  copper_ingot: ingot(P.copperL, P.copper, P.copperD),

  // 석유 드럼통 — 위 뚜껑이 보이는 원기둥
  petroleum: `${groundSm}
    ${cyl3(32, 18, 18, 34, 7, '#585868', '#3a3a46', '#1c1c24')}
    <path d="M14 28 a18 7 0 0 0 36 0 M14 42 a18 7 0 0 0 36 0" fill="none" stroke="${INK}" stroke-width="2.4"/>
    <path d="M14 33 a18 7 0 0 0 36 0" fill="none" stroke="${P.goldL}" stroke-width="5"/>
    <ellipse cx="32" cy="18" rx="7" ry="2.8" fill="${P.goldL}" stroke="${INK}" stroke-width="2"/>`,
  naphtha: drop(P.cyanL, P.cyan, P.cyanD),

  electricity: `${groundSm}
    ${sh('M36 4 L14 34 h13 l-5 26 L50 28 H35 l5 -24 Z', P.goldL)}
    ${fd('M36 4 L40 4 l-5 24 h15 L22 60 Z', P.goldD, 0.35)}`,
  gold: `${groundSm}
    ${ci(32, 32, 20, P.gold)}
    ${fd('M32 12 a20 20 0 0 1 0 40 Z', P.goldD, 0.4)}
    ${ci(32, 32, 13, P.goldL, 2.5)}
    ${fd('M32 22 l3 7 l8 .5 l-6 5 l2 8 l-7 -4.4 l-7 4.4 l2 -8 l-6 -5 l8 -.5 Z', P.goldD, 0.9)}`,

  // 널빤지·벽돌은 쌓아둔 덩어리라 윗면이 보이게 그린다
  plank: `${groundSm}
    ${topFace(6, 22, 52, 9, '#e8b877')}
    ${rc(6, 22, 52, 11, P.woodL, 2)}
    ${fd('M6 29 H58 V33 H6 Z', P.woodD, 0.4)}
    ${rc(6, 35, 52, 11, P.wood, 2)}
    ${fd('M6 42 H58 V46 H6 Z', P.woodD, 0.45)}
    <path d="M20 22 V33 M40 22 V33 M28 35 V46 M48 35 V46" stroke="${P.woodD}" stroke-width="2" opacity="0.7"/>`,
  brick: `${groundSm}
    ${topFace(8, 24, 48, 9, '#e07a54')}
    ${rc(8, 24, 48, 26, '#c0603f', 2)}
    ${fd('M8 38 H56 V50 H8 Z', '#8a3a22', 0.42)}
    <path d="M8 32 H56 M8 41 H56" stroke="${INK}" stroke-width="2.5"/>
    <path d="M22 24 V32 M40 24 V32 M15 32 V41 M33 32 V41 M49 32 V41 M22 41 V50 M40 41 V50" stroke="${INK}" stroke-width="2.5"/>`,

  copper_wire: `${groundSm}
    <path d="M10 46 Q10 18 32 18 Q54 18 54 40" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M10 46 Q10 18 32 18 Q54 18 54 40" fill="none" stroke="${P.copper}" stroke-width="5" stroke-linecap="round"/>
    <path d="M12 42 Q13 24 30 22" fill="none" stroke="${P.copperL}" stroke-width="2" stroke-linecap="round"/>
    ${ci(10, 48, 5, P.copperL, 2.5)}${ci(54, 42, 5, P.copperL, 2.5)}`,
  // 플라스틱 통 — 원기둥으로 세워 윗뚜껑이 보이게
  plastic: `${groundSm}
    ${cyl3(32, 24, 15, 28, 6, P.plasticL, P.plastic, P.plasticD)}
    ${cyl3(32, 12, 6, 12, 2.6, P.plasticL, P.plasticD, '#1c5570')}
    ${fd('M22 30 h5 v18 h-5 Z', '#ffffff', 0.35)}`,

  circuit_board: `${groundSm}
    ${rc(10, 14, 44, 38, '#2f9e5e', 3)}
    ${fd('M32 14 H54 V52 H32 Z', '#1c6b3e', 0.45)}
    ${rc(24, 26, 16, 15, '#20303a', 2, 2.5)}
    <path d="M17 20 H24 M17 26 H24 M17 33 H24 M40 20 H47 M40 33 H47 M32 41 V48" stroke="${P.goldL}" stroke-width="2.5"/>
    <circle cx="17" cy="45" r="3" fill="${P.goldL}"/><circle cx="47" cy="45" r="3" fill="${P.goldL}"/>`,
  // 철근 다발 — 끝 단면(타원)을 보여줘 봉으로 읽히게 한다
  rebar: `${groundSm}
    ${[16, 30, 44].map(x => `<path d="M${x} 14 L${x - 6} 54" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
      <path d="M${x} 14 L${x - 6} 54" stroke="${P.stone}" stroke-width="5.5" stroke-linecap="round"/>`).join('')}
    ${[16, 30, 44].map(x => `<ellipse cx="${x}" cy="13" rx="4.4" ry="2.4" fill="${P.stoneL}" stroke="${INK}" stroke-width="2.2"/>`).join('')}
    <path d="M8 28 H54 M6 42 H52" stroke="${INK}" stroke-width="4"/>
    <path d="M8 28 H54 M6 42 H52" stroke="${P.stoneL}" stroke-width="2"/>`,

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

  // ---- 필드에서 구조물 위에 띄우는 경고 배지 ----
  // 말풍선 꼬리가 아래를 가리켜서 "이 건물의 문제"라는 게 바로 읽힌다.
  // 바탕은 항상 같고 안쪽 기호만 달라서 멀리서도 종류가 구분된다.
  ...(() => {
    const bubble = (bg, inner) => `
      ${sh('M12 4 h40 a8 8 0 0 1 8 8 v22 a8 8 0 0 1 -8 8 H38 l-6 10 l-6 -10 H12 a8 8 0 0 1 -8 -8 V12 a8 8 0 0 1 8 -8 Z', bg)}
      ${fd('M12 30 h40 a8 8 0 0 1 -8 8 H38 l-6 10 l-6 -10 H12 a8 8 0 0 1 -8 -8 Z', INK, 0.14)}
      ${inner}`;
    return {
      // 전력 없음 — 번개에 빗금
      warn_power: bubble('#ffd24a', `
        ${sh('M35 8 L20 26 h9 l-3 16 L45 22 H34 l3 -14 Z', '#3a2c05', 2)}
        <path d="M12 38 L52 6" stroke="#c1443c" stroke-width="6" stroke-linecap="round"/>
        <path d="M12 38 L52 6" stroke="#ffe9a8" stroke-width="2.4" stroke-linecap="round"/>`),
      // 산출 인벤토리 가득 참 — 넘치는 상자
      warn_full: bubble('#ff8a3d', `
        ${sh('M16 20 h32 v18 H16 Z', '#3a1f05', 2)}
        ${fd('M18 24 h28 v12 h-28 Z', '#ffd7a8', 0.9)}
        <path d="M22 14 V6 M32 12 V4 M42 14 V6" stroke="#3a1f05" stroke-width="4" stroke-linecap="round"/>`),
      // 재료 부족 — 빈 접시 / 빠진 조각
      warn_input: bubble('#6fd4ff', `
        ${sh('M14 30 h36 v6 H14 Z', '#062b3d', 2)}
        <path d="M20 28 V16 h9 v12 M36 28 V16" stroke="#062b3d" stroke-width="4.5" stroke-linecap="round" fill="none"/>
        <path d="M36 12 h10" stroke="#062b3d" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="3 5"/>`),
      // 설정 안 됨 / 기타 — 느낌표
      warn_idle: bubble('#ff4d3d', `
        ${sh('M28 8 h8 v18 h-8 Z', '#2c0603', 2)}
        ${ci(32, 33, 4.5, '#2c0603', 2)}`),
    };
  })(),

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
    ${foot(32, 53, 15, P.blueD)}
    ${ci(32, 14, 9, '#f0c9a0')}
    ${fd('M32 5 a9 9 0 0 1 0 18 Z', '#c99a70', 0.5)}
    ${sh('M14 52 q0 -18 18 -18 q18 0 18 18 Z', P.blue)}
    ${fd('M32 34 q18 0 18 18 H32 Z', P.blueD, 0.45)}
    ${fd('M20 46 q2 -10 9 -11 q-6 4 -6 11 Z', P.blueL, 0.75)}`,

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
  // 성채 — 가운데 본채와 좌우 탑, 모두 윗면(지붕)이 보이는 상자로 세운다
  capital: `${ground}
    ${box3(6, 30, 15, 24, 7, P.stoneL, '#dbe3ea', 1)}
    ${box3(43, 30, 15, 24, 7, P.stoneL, '#dbe3ea', 1)}
    ${box3(18, 20, 28, 34, 9, P.stone, '#cfd8e0', 1)}
    ${fd('M18 20 h28 v34 h-28 Z', INK, 0.0)}
    <path d="M18 24 H46" stroke="${INK}" stroke-width="2.2"/>
    ${fr(24, 32, 7, 11, P.glass, 1)}${fr(34, 32, 7, 11, P.glass, 1)}
    ${sh('M27 44 h10 v10 h-10 Z', P.woodD)}
    <path d="M32 8 V22" stroke="${INK}" stroke-width="3"/>
    ${sh('M32 8 L46 12 L32 16 Z', P.roof, 2.5)}`,

  // 중심지 — 계단식 받침 위에 뜬 육각 표식 (영토 확장 장치라 기계처럼 보이게)
  hub: `${ground}
    ${cyl3(32, 42, 20, 9, 6, P.stoneL, P.stone, P.stoneD)}
    ${cyl3(32, 34, 13, 7, 4.5, P.metalL, P.metal, P.metalD)}
    ${sh('M32 8 L47 17 V33 L32 42 L17 33 V17 Z', P.goldL)}
    ${fd('M32 8 L47 17 V33 L32 42 Z', P.goldD, 0.42)}
    ${fd('M32 14 L41 20 V30 L32 36 L23 30 V20 Z', P.gold, 0.9)}`,

  // 광산 — 바위 언덕에 뚫린 갱구. 굴 입구를 검게 파서 안으로 들어가 보이게 한다
  mine: `${ground}
    ${sh('M2 52 q8 -30 30 -30 q22 0 30 30 Z', P.stone)}
    ${fd('M32 22 q22 0 30 30 H32 Z', P.stoneD, 0.42)}
    ${fd('M12 46 q5 -18 19 -21 q-11 7 -13 21 Z', P.stoneL, 0.75)}
    ${sh('M19 52 v-9 a13 13 0 0 1 26 0 v9 Z', '#0d0b10')}
    ${fd('M32 30 a13 13 0 0 1 13 13 v9 H32 Z', '#000', 0.45)}
    <path d="M19 43 a13 13 0 0 1 26 0" fill="none" stroke="${P.woodL}" stroke-width="5"/>
    <path d="M19 43 a13 13 0 0 1 26 0" fill="none" stroke="${INK}" stroke-width="1.6"/>
    ${rc(16, 42, 5, 12, P.woodL, 1)}${rc(43, 42, 5, 12, P.woodL, 1)}
    <path d="M14 56 H50" stroke="${P.darkL}" stroke-width="4"/>
    <path d="M20 54 V58 M28 54 V58 M36 54 V58 M44 54 V58" stroke="${INK}" stroke-width="2"/>`,

  // 벌목소 — 통나무 오두막 + 톱날 + 쌓아둔 통나무 (원기둥 단면이 보이게)
  lumber_mill: `${ground}
    ${roof3(8, 30, 40, 12, P.roofL, P.roofD)}
    ${frontFace(10, 30, 36, 24, P.woodL, 1)}
    <path d="M10 38 H46 M10 46 H46" stroke="${P.woodD}" stroke-width="2.6"/>
    ${sh('M18 40 h12 v14 h-12 Z', P.woodD)}
    ${cyl3(52, 42, 8, 10, 3.5, '#e0b57a', P.wood, P.woodD)}
    <circle cx="52" cy="42" r="3" fill="${P.woodD}"/>
    ${ci(40, 24, 9, P.metalL, 2.5)}
    <circle cx="40" cy="24" r="3.5" fill="${P.darkL}"/>`,

  // 공장 — 긴 본채 + 톱니 지붕 + 굴뚝 두 개
  factory: `${ground}
    ${cyl3(16, 12, 4.5, 20, 2.2, P.stoneL, P.stone, P.stoneD)}
    ${cyl3(26, 18, 4.5, 14, 2.2, P.stoneL, P.stone, P.stoneD)}
    ${topFace(6, 34, 52, 8, '#9aa8b6')}
    ${frontFace(6, 34, 52, 20, P.metal, 1)}
    ${fr(11, 39, 8, 8, P.glass, 1)}${fr(23, 39, 8, 8, P.glass, 1)}${fr(35, 39, 8, 8, P.glass, 1)}
    ${sh('M46 42 h9 v12 h-9 Z', P.darkL)}
    <path d="M6 50 H58" stroke="${INK}" stroke-width="2.2"/>`,

  // 제련소 — 용광로 몸통 + 굴뚝 + 시뻘건 출탕구
  smelter: `${ground}
    ${cyl3(44, 14, 5, 22, 2.4, P.stoneL, P.stone, P.stoneD)}
    ${topFace(8, 28, 34, 8, '#c9d2da')}
    ${frontFace(8, 28, 34, 26, P.stone, 1)}
    ${sh('M15 40 h20 v14 h-20 Z', P.darkD)}
    ${fd('M17 44 h16 v10 h-16 Z', P.roof, 0.95)}
    ${fd('M20 48 h10 v6 h-10 Z', P.goldL, 0.95)}
    <path d="M8 34 H42" stroke="${INK}" stroke-width="2.2"/>`,

  // 유전 — 속이 비친 격자 철탑(유정탑). 채워진 뿔이 아니라 뼈대로 그려야 철탑으로 읽힌다
  oil_well: `${ground}
    ${foot(32, 50, 21, P.stoneD)}
    <g stroke="${INK}" stroke-width="5" stroke-linecap="round" fill="none">
      <path d="M15 50 L27 9 M49 50 L37 9 M22 50 L29 9 M42 50 L35 9"/>
    </g>
    <g stroke="${P.roofL}" stroke-width="2.6" stroke-linecap="round" fill="none">
      <path d="M15 50 L27 9 M49 50 L37 9"/>
    </g>
    <g stroke="${P.roof}" stroke-width="2.2" stroke-linecap="round" fill="none">
      <path d="M22 50 L29 9 M42 50 L35 9"/>
    </g>
    <g stroke="${INK}" stroke-width="3.6" stroke-linecap="round" fill="none">
      <path d="M18 40 L46 40 M21 30 L43 30 M24 20 L40 20
               M18 40 L43 30 M46 40 L21 30 M21 30 L40 20 M43 30 L24 20"/>
    </g>
    <g stroke="${P.roofL}" stroke-width="1.8" stroke-linecap="round" fill="none">
      <path d="M18 40 L46 40 M21 30 L43 30 M24 20 L40 20"/>
    </g>
    ${sh('M26 6 h12 v6 h-12 Z', P.metalL, 2.5)}
    ${cyl3(32, 46, 8, 7, 3.4, P.oilL, P.oil, P.oilD)}`,

  // 정제소 — 탱크 두 개 + 증류탑, 배관으로 이어 붙였다
  refinery: `${ground}
    ${cyl3(16, 26, 11, 24, 5, P.metalL, P.metal, P.metalD)}
    ${cyl3(46, 34, 9, 16, 4, P.metalL, '#8ba0b2', P.metalD)}
    ${cyl3(31, 14, 5.5, 36, 2.6, P.cyanL, P.cyan, P.cyanD)}
    <path d="M27 24 H36 M27 34 H41" stroke="${INK}" stroke-width="3"/>
    ${fr(11, 34, 10, 5, P.cyanL, 1)}
    ${fr(41, 40, 9, 4, P.goldL, 1)}`,

  // 추출기 — 아래로 좁아지는 흡입 깔때기
  extractor: `${ground}
    ${foot(32, 52, 12, P.purpleD)}
    ${topFace(16, 26, 32, 8, '#d9c4ff')}
    ${frontFace(16, 26, 32, 12, P.purple, 1)}
    ${sh('M18 38 h28 l-11 14 h-6 Z', P.purpleL)}
    ${fd('M32 38 h14 l-11 14 h-3 Z', P.purpleD, 0.42)}
    ${ci(32, 20, 5, P.glass, 2.5)}
    <path d="M16 32 H48" stroke="${INK}" stroke-width="2.2"/>`,

  // 농지 — 뒤로 갈수록 좁아지는 이랑(원근)에 새싹을 심었다
  farm: `${ground}
    ${sh('M4 54 H60 L50 26 H14 Z', P.woodL)}
    ${fd('M32 26 h18 l10 28 H32 Z', P.woodD, 0.25)}
    <path d="M15 34 H49 M12 42 H52 M8 50 H56" stroke="${P.woodD}" stroke-width="3"/>
    ${sh('M22 44 q-6 -6 -5 -12 q7 2 5 12 Z', P.green, 2.2)}
    ${sh('M32 42 q-7 -7 -6 -15 q8 3 6 15 Z', P.greenL, 2.2)}
    ${sh('M42 44 q6 -6 5 -12 q-7 2 -5 12 Z', P.green, 2.2)}`,

  // 축사 — 붉은 헛간, 지붕면이 위에서 보이게 눕혔다
  barn: `${ground}
    ${sh('M8 30 L32 14 L56 30 Z', P.redL)}
    ${fd('M32 14 L56 30 H32 Z', P.redD, 0.35)}
    ${topFace(10, 30, 44, 5, '#ff8f70')}
    ${frontFace(10, 30, 44, 24, P.red, 1)}
    ${sh('M24 38 h16 v16 h-16 Z', P.woodL)}
    <path d="M24 38 L40 54 M40 38 L24 54 M32 38 V54" stroke="${P.woodD}" stroke-width="2.6"/>
    ${fr(28, 22, 8, 6, P.glass, 1)}`,

  // 도축장 — 위생 타일 건물 + 붉은 차양
  slaughterhouse: `${ground}
    ${sh('M10 26 h30 a8 8 0 0 1 8 8 v2 H10 Z', P.roofL)}
    ${fd('M32 26 h8 a8 8 0 0 1 8 8 v2 H32 Z', P.roofD, 0.35)}
    ${topFace(8, 36, 48, 6, '#dfe6ec')}
    ${frontFace(8, 36, 48, 18, P.stoneL, 1)}
    ${fr(13, 41, 10, 8, P.glass, 1)}${fr(41, 41, 10, 8, P.glass, 1)}
    ${sh('M27 41 h10 v13 h-10 Z', P.metalD)}
    <path d="M8 42 H56" stroke="${INK}" stroke-width="2"/>`,

  // 발전소 — 냉각탑 두 개 + 번개
  power_plant: `${ground}
    ${taper3(17, 22, 9, 52, 13, 4, '#dfe6ec', P.stoneL, P.stoneD)}
    ${taper3(45, 30, 7, 52, 10, 3.4, '#dfe6ec', P.stone, P.stoneD)}
    ${sh('M34 6 L22 30 h9 l-4 20 L44 26 H34 l4 -20 Z', P.goldL)}
    ${fd('M34 6 L38 6 l-4 20 h10 L27 50 Z', P.goldD, 0.32)}`,

  // 성벽 — 뒤쪽 여장(총안)이 위로 솟고, 그 앞에 통로 윗면이 보이는 돌벽
  wall: `${ground}
    ${sh('M8 14 h8 v10 h-8 Z', '#c2ccd5', 2.5)}${sh('M28 14 h8 v10 h-8 Z', '#c2ccd5', 2.5)}${sh('M48 14 h8 v10 h-8 Z', '#c2ccd5', 2.5)}
    ${sh('M6 24 h52 v6 h-52 Z', '#c2ccd5')}
    ${topFace(4, 34, 56, 10, '#e3eaf0')}
    ${frontFace(4, 34, 56, 20, P.stoneL, 1)}
    <path d="M4 42 H60 M4 48 H60" stroke="${INK}" stroke-width="2.2"/>
    <path d="M18 34 V42 M32 34 V42 M46 34 V42 M11 42 V48 M25 42 V48 M39 42 V48 M53 42 V48 M18 48 V54 M32 48 V54 M46 48 V54" stroke="${INK}" stroke-width="2.2"/>`,

  // 전초기지 — 나무 다리 위에 올린 망루. 다리가 굵어야 "높이 서 있다"가 읽힌다
  outpost: `${ground}
    ${foot(32, 52, 17, '#3f6b45')}
    ${sh('M17 54 L24 30 h6 L25 54 Z', P.woodL, 2.5)}
    ${sh('M47 54 L40 30 h-6 L39 54 Z', P.wood, 2.5)}
    <path d="M21 44 L43 44 M23 37 L41 37" stroke="${INK}" stroke-width="4"/>
    <path d="M21 44 L43 44 M23 37 L41 37" stroke="${P.woodD}" stroke-width="2"/>
    ${roof3(14, 24, 36, 11, P.roofL, P.roofD)}
    ${frontFace(18, 24, 28, 12, P.greenL, 1)}
    ${fr(23, 28, 7, 6, P.glass, 1)}${fr(34, 28, 7, 6, P.glass, 1)}
    <path d="M32 2 V13" stroke="${INK}" stroke-width="2.8"/>
    ${sh('M32 2 L43 5.5 L32 9 Z', P.roof, 2)}`,

  // 연구소 — 돔 지붕 위로 솟은 플라스크
  lab: `${ground}
    ${topFace(10, 34, 44, 7, '#dbe3ea')}
    ${frontFace(10, 34, 44, 20, P.metalL, 1)}
    ${fr(15, 40, 9, 8, P.glass, 1)}${fr(40, 40, 9, 8, P.glass, 1)}
    ${sh('M27 42 h10 v12 h-10 Z', P.metalD)}
    ${sh('M28 6 h8 v10 l9 15 a4 4 0 0 1 -3 6 H22 a4 4 0 0 1 -3 -6 l9 -15 Z', '#f2f7ff')}
    ${fd('M32 6 h4 v10 l9 15 a4 4 0 0 1 -3 6 H32 Z', P.metalD, 0.28)}
    ${sh('M23 24 h18 l4 7 a4 4 0 0 1 -3 6 H22 a4 4 0 0 1 -3 -6 Z', P.purple)}
    <circle cx="27" cy="31" r="2.6" fill="${P.purpleL}"/><circle cx="36" cy="33" r="2" fill="${P.purpleL}"/>
    ${rc(26, 3, 12, 5, P.gold, 2)}`,

  // 컨베이어 벨트 — 바닥에 눕는 물건이라 낮게, 진행 방향만 또렷하게
  belt: `${topFace(4, 40, 56, 12, '#5c6b78')}
    ${frontFace(4, 40, 56, 10, P.darkL, 2)}
    <path d="M6 34 H58" stroke="${INK}" stroke-width="2.2"/>
    ${ci(13, 34, 5, P.metalL, 2.5)}${ci(51, 34, 5, P.metalL, 2.5)}
    ${sh('M24 28 L38 34 L24 40 Z', P.goldL, 2.5)}`,

  // 창고 — 넓은 박공 지붕 + 큰 셔터문
  warehouse: `${ground}
    ${sh('M6 28 L32 12 L58 28 Z', P.woodL)}
    ${fd('M32 12 L58 28 H32 Z', P.woodD, 0.38)}
    ${topFace(8, 28, 48, 5, '#e0aa6a')}
    ${frontFace(8, 28, 48, 26, P.wood, 1)}
    ${sh('M20 34 h24 v20 H20 Z', P.gold)}
    ${fd('M32 34 h12 v20 H32 Z', P.goldD, 0.3)}
    <path d="M20 40 H44 M20 46 H44 M32 34 V54" stroke="${INK}" stroke-width="2.2"/>
    ${fr(28, 20, 8, 5, P.glass, 1)}`,

  // 조리소 — 벽돌 화덕 건물 + 굴뚝에서 오르는 김
  kitchen: `${ground}
    ${cyl3(48, 16, 5, 18, 2.4, '#ff9d80', P.roof, P.roofD)}
    ${topFace(6, 30, 44, 6, '#ff9670')}
    ${frontFace(6, 30, 44, 24, P.roofL, 1)}
    <path d="M6 38 H50 M6 46 H50 M17 30 V38 M39 30 V38 M28 38 V46 M17 46 V54 M39 46 V54" stroke="${INK}" stroke-width="2"/>
    ${sh('M16 40 h24 a4 4 0 0 1 -4 12 H20 a4 4 0 0 1 -4 -12 Z', P.metalL)}
    ${fd('M28 40 h12 a4 4 0 0 1 -4 12 H28 Z', P.metalD, 0.4)}
    ${rc(13, 36, 30, 5, P.metal, 2)}
    <path d="M24 30 q-4 -5 0 -10 q4 -5 0 -10 M36 30 q-4 -5 0 -10 q4 -5 0 -10" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M24 30 q-4 -5 0 -10 q4 -5 0 -10 M36 30 q-4 -5 0 -10 q4 -5 0 -10" fill="none" stroke="#f2f7ff" stroke-width="2" stroke-linecap="round"/>`,
};

/**
 * 터렛 6종 — 원기둥 받침 + 돔형 포탑 위에 포신만 달리해 티어가 눈에 보이게.
 * 받침을 원기둥으로 세워서 다른 구조물과 같은 시점으로 읽힌다.
 */
function turret(barrel, bodyColor) {
  return `${ground}
    ${cyl3(32, 42, 19, 10, 6, P.stoneL, P.stone, P.stoneD)}
    ${cyl3(32, 34, 12, 6, 4, P.metalL, P.metal, P.metalD)}
    ${sh(`M21 34 a11 11 0 0 1 22 0 Z`, bodyColor)}
    ${fd('M32 23 a11 11 0 0 1 11 11 H32 Z', INK, 0.28)}
    <ellipse cx="32" cy="34" rx="11" ry="3.4" fill="${bodyColor}" stroke="${INK}" stroke-width="${OUT_W}"/>
    ${fd('M25 30 a8 7 0 0 1 7 -5 a10 8 0 0 0 -9 8 Z', '#ffffff', 0.28)}
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

// ============================================================
// 유닛 그림 (assets/icons/unit/*.svg)
//
// 전투 화면에서 20px 안팎으로 줄어들기 때문에, 얼굴 디테일보다 **실루엣과
// 장비**로 구분되게 그린다 (창/방패 / 총 / 로터 / 궤도 …).
// 구조물과 같은 규칙 — 정면에서 살짝 내려다본 시점, 빛은 왼쪽 위, 굵은 외곽선.
// ============================================================
const UNIT_DIR = path.join(OUT_DIR, 'unit');
mkdirSync(UNIT_DIR, { recursive: true });

const SKIN = '#f0c9a0', SKIN_D = '#c99a70';

/**
 * 사람 유닛 공통 몸체. 장비(뒤/앞에 겹칠 그림)만 갈아 끼우면 다른 병종이 된다.
 *  back  — 몸 뒤에 그릴 것 (등에 멘 창, 망토 등)
 *  front — 몸 앞에 그릴 것 (방패, 총 등)
 *  helm  — 머리 위 투구
 */
const trooper = ({ armor, armorD, back = '', front = '', helm = '', accent = '' }) => `${groundSm}
  ${back}
  ${sh('M25 42 h5 v12 h-5 Z', armorD, 2.5)}${sh('M34 42 h5 v12 h-5 Z', armorD, 2.5)}
  ${sh('M23 26 h18 v18 a4 4 0 0 1 -4 4 H27 a4 4 0 0 1 -4 -4 Z', armor)}
  ${fd('M32 26 h9 v18 a4 4 0 0 1 -4 4 h-5 Z', armorD, 0.45)}
  ${ci(32, 17, 8, SKIN)}
  ${fd('M32 9 a8 8 0 0 1 0 16 Z', SKIN_D, 0.45)}
  ${helm}
  ${accent}
  ${front}`;

/** 등에 멘 무기 자루 */
const shaft = (color) => `<path d="M44 8 L22 52" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
  <path d="M44 8 L22 52" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`;
/** 손에 든 둥근 방패 */
const roundShield = (light, base, dark) => `${ci(20, 38, 11, base)}
  ${fd('M20 27 a11 11 0 0 1 0 22 Z', dark, 0.45)}
  ${ci(20, 38, 4, light, 2)}`;
/** 궤도 차량 공통 — 사람 대신 차체를 그린다 */
const vehicle = (body, bodyD, turret) => `${ground}
  ${sh('M8 40 h48 a6 6 0 0 1 0 14 H8 a6 6 0 0 1 0 -14 Z', P.darkL)}
  ${[14, 24, 34, 44, 52].map(x => `<circle cx="${x}" cy="47" r="4" fill="${P.dark}" stroke="${INK}" stroke-width="2"/>`).join('')}
  ${topFace(12, 40, 40, 6, bodyD)}
  ${sh('M12 26 h40 v14 h-40 Z', body)}
  ${fd('M32 26 h20 v14 h-20 Z', bodyD, 0.4)}
  ${turret}`;

const unitArt = {
  // ---- 공격 유닛 ----
  recruit_01: trooper({                       // 기초 돌격병 — 나무창 + 나무방패
    armor: '#8fa36b', armorD: '#5d6f42',
    back: shaft(P.wood) + sh('M40 4 L50 14 L44 18 L36 10 Z', P.stoneL, 2.5),
    front: roundShield(P.woodL, P.wood, P.woodD),
    helm: sh('M23 15 a9 9 0 0 1 18 0 Z', P.woodD, 2.5),
  }),
  recruit_02: `${ground}                       <!-- 정찰 기병 — 말 실루엣으로 속도를 알린다 -->
    ${sh('M10 44 q2 -14 16 -15 h14 q10 1 12 10 v9 h-6 v-6 h-6 v6 h-6 v-6 h-8 v6 h-6 v-6 q-4 2 -4 8 Z', '#b07a45')}
    ${fd('M40 29 q10 1 12 10 v9 h-6 v-6 h-6 v6 h-6 Z', '#7d5228', 0.42)}
    ${sh('M46 30 L56 14 q6 -2 6 4 l-4 12 Z', '#b07a45', 2.5)}
    ${sh('M56 14 l4 -6 l2 8 Z', '#7d5228', 2)}
    ${sh('M8 34 q-6 6 -2 14 q4 -4 6 -10 Z', '#7d5228', 2.5)}
    ${ci(38, 20, 6, SKIN, 2.5)}
    ${sh('M32 24 h12 v9 h-12 Z', '#8fa36b', 2.5)}
    <path d="M50 6 L28 34" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
    <path d="M50 6 L28 34" stroke="${P.wood}" stroke-width="3" stroke-linecap="round"/>`,
  recruit_03: trooper({                       // 중갑 공성병 — 철갑 + 큰 철방패
    armor: P.metal, armorD: P.metalD,
    back: shaft(P.woodD) + sh('M42 2 L52 14 L45 19 L36 9 Z', P.metalL, 2.5),
    front: `${sh('M12 24 h18 v20 q0 8 -9 12 q-9 -4 -9 -12 Z', P.metalL)}
      ${fd('M21 24 h9 v20 q0 8 -9 12 Z', P.metalD, 0.45)}
      ${ci(21, 36, 4, P.gold, 2)}`,
    helm: `${sh('M22 16 a10 10 0 0 1 20 0 v4 h-20 Z', P.metalL)}
      ${fr(25, 15, 14, 4, INK)}`,
  }),
  recruit_04: trooper({                       // 마도 폭파 특공대 — 빛나는 마석 폭탄
    armor: '#6b4a8f', armorD: '#3d2657',
    front: `${ci(20, 40, 10, P.dark)}
      ${fd('M20 30 a10 10 0 0 1 0 20 Z', P.darkD, 0.5)}
      ${sh('M20 30 L24 24 l4 4', 'none', 2.5)}
      <path d="M20 30 q2 -8 8 -9" fill="none" stroke="${INK}" stroke-width="3"/>
      ${ci(29, 20, 4, P.purpleL, 2)}
      ${ci(20, 40, 4, P.purpleL, 2)}`,
    helm: sh('M23 15 a9 9 0 0 1 18 0 Z', '#3d2657', 2.5),
    accent: `${ci(44, 22, 6, P.purple, 2.5)}${ci(44, 22, 2.5, P.purpleL)}`,
  }),
  recruit_05: trooper({                       // 화염방사병 — 등에 연료통, 앞에 불꽃
    armor: '#a8622f', armorD: '#6b3512',
    back: `${rc(40, 22, 12, 22, P.oil, 3)}${fd('M46 22 h6 v22 h-6 Z', P.oilD, 0.5)}`,
    front: `<path d="M40 34 H22 q-6 0 -6 6" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
      <path d="M40 34 H22 q-6 0 -6 6" fill="none" stroke="${P.metalL}" stroke-width="3" stroke-linecap="round"/>
      ${sh('M16 42 q-8 6 -4 14 q6 -2 8 -8 q4 6 0 10 q10 -4 8 -14 q-6 2 -12 -2 Z', P.roofL, 2.5)}
      ${fd('M14 50 q4 4 2 8 q4 -2 4 -6 Z', P.goldL, 0.9)}`,
    helm: `${sh('M22 16 a10 10 0 0 1 20 0 v3 h-20 Z', P.roofD)}${fr(25, 14, 14, 5, P.glass)}`,
  }),
  recruit_06: trooper({                       // 현대 소총병 — 방탄조끼 + 소총
    armor: '#4a5f4a', armorD: '#26361f',
    front: `${sh('M20 27 h16 v14 h-16 Z', P.wheat)}${fd('M32 27 h4 v14 h-4 Z', P.wheatD, 0.5)}
      <path d="M12 40 H46" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
      <path d="M12 40 H46" stroke="${P.darkL}" stroke-width="3.5" stroke-linecap="round"/>
      ${rc(26, 40, 6, 9, P.darkD, 1)}
      ${fr(16, 36, 10, 3, P.metalL, 1)}`,
    helm: `${sh('M21 16 a11 10 0 0 1 22 0 v3 h-22 Z', '#3c4a35')}`,
  }),
  recruit_07: `${groundSm}                     <!-- 공중 침투 드론 — 하늘을 나는 유일한 유닛 -->
    <ellipse cx="32" cy="56" rx="9" ry="3" fill="#000" opacity="0.25"/>
    ${[[12, 18], [52, 18]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="13" ry="3.4" fill="${P.plasticL}" opacity="0.55"/>
      <ellipse cx="${x}" cy="${y}" rx="13" ry="3.4" fill="none" stroke="${INK}" stroke-width="2"/>`).join('')}
    <path d="M16 20 L26 28 M48 20 L38 28" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <path d="M16 20 L26 28 M48 20 L38 28" stroke="${P.metalL}" stroke-width="2.4" stroke-linecap="round"/>
    ${sh('M22 26 h20 a6 6 0 0 1 6 6 v6 a10 10 0 0 1 -16 8 a10 10 0 0 1 -16 -8 v-6 a6 6 0 0 1 6 -6 Z', P.darkL)}
    ${fd('M32 26 h10 a6 6 0 0 1 6 6 v6 a10 10 0 0 1 -16 8 Z', P.darkD, 0.45)}
    ${ci(32, 38, 6, P.cyanL, 2.5)}${ci(32, 38, 2.5, '#ffffff')}
    <path d="M22 48 H42" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  recruit_08: vehicle(P.stone, P.stoneD, `     <!-- 공성 투석/전차 — 긴 포신 -->
    ${sh('M24 16 h16 v10 h-16 Z', P.stoneL)}
    <path d="M34 21 H60" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M34 21 H60" stroke="${P.metal}" stroke-width="5" stroke-linecap="round"/>
    ${fr(56, 17, 5, 8, P.metalL, 1)}`),
  recruit_09: vehicle('#5c4a7a', '#33254a', `  <!-- 마도 중갑 전차 — 마석 포탑 -->
    ${sh('M22 14 h20 v12 h-20 Z', '#7a63a0')}
    ${fd('M32 14 h10 v12 h-10 Z', '#33254a', 0.45)}
    <path d="M36 20 H60" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
    <path d="M36 20 H60" stroke="${P.purple}" stroke-width="5.5" stroke-linecap="round"/>
    ${ci(58, 20, 5, P.purpleL, 2.5)}
    ${ci(26, 10, 4, P.purpleL, 2)}`),
  recruit_10: `${ground}                       <!-- 마도 돌격 거인 — 화면에서 가장 큰 실루엣 -->
    ${sh('M18 46 h9 v12 h-9 Z', '#4a3a5f', 2.5)}${sh('M37 46 h9 v12 h-9 Z', '#4a3a5f', 2.5)}
    ${sh('M14 24 h36 v22 a6 6 0 0 1 -6 6 H20 a6 6 0 0 1 -6 -6 Z', '#6b5590')}
    ${fd('M32 24 h18 v22 a6 6 0 0 1 -6 6 H32 Z', '#3d2c57', 0.45)}
    ${sh('M6 26 h10 v18 h-10 Z', '#6b5590', 2.5)}${sh('M48 26 h10 v18 h-10 Z', '#6b5590', 2.5)}
    ${ci(32, 15, 10, SKIN)}
    ${fd('M32 5 a10 10 0 0 1 0 20 Z', SKIN_D, 0.45)}
    ${sh('M21 14 a11 11 0 0 1 22 0 v3 h-22 Z', P.metalD)}
    <circle cx="27" cy="17" r="2.4" fill="${P.redL}"/><circle cx="37" cy="17" r="2.4" fill="${P.redL}"/>
    ${ci(32, 34, 7, P.purpleL, 2.5)}${ci(32, 34, 3, '#ffffff')}`,

  // ---- 수비 유닛 ----
  def_01: trooper({                           // 방어 진형병 — 몸을 가리는 큰 방패
    armor: '#5a6d8a', armorD: '#2f3d54',
    front: `${sh('M10 20 h24 v22 q0 10 -12 16 q-12 -6 -12 -16 Z', P.woodL)}
      ${fd('M22 20 h12 v22 q0 10 -12 16 Z', P.woodD, 0.45)}
      <path d="M22 20 V58" stroke="${INK}" stroke-width="2.5"/>
      ${ci(22, 36, 4, P.stoneL, 2)}`,
    helm: sh('M22 16 a10 10 0 0 1 20 0 Z', '#2f3d54', 2.5),
  }),
  def_02: trooper({                           // 수리 공병 — 렌치와 작업모
    armor: '#c98a2f', armorD: '#8a5810',
    front: `<path d="M18 48 L34 30" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
      <path d="M18 48 L34 30" stroke="${P.metalL}" stroke-width="4.5" stroke-linecap="round"/>
      ${sh('M32 26 a7 7 0 1 1 8 8 l-5 -3 Z', P.metal, 2.5)}`,
    helm: `${sh('M21 16 a11 10 0 0 1 22 0 v2 h-22 Z', P.goldL)}${fr(24, 8, 16, 4, P.goldD, 1)}`,
  }),
  def_03: trooper({                           // 저격 수비병 — 아주 긴 총열
    armor: '#3f5a3f', armorD: '#1f3320',
    front: `<path d="M6 42 H52" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
      <path d="M6 42 H52" stroke="${P.darkL}" stroke-width="3.5" stroke-linecap="round"/>
      ${rc(22, 42, 6, 8, P.darkD, 1)}
      ${rc(26, 34, 14, 5, P.blueD, 2)}
      ${ci(40, 36, 3, P.blueL, 2)}`,
    helm: `${sh('M21 16 a11 10 0 0 1 22 0 v3 h-22 Z', '#2b3d2b')}${fr(24, 14, 16, 4, P.greenL)}`,
  }),
  def_04: trooper({                           // 마도 결계병 — 몸을 감싼 반투명 결계
    armor: '#3f6f8a', armorD: '#1d3b4d',
    front: `${ci(32, 34, 8, P.cyan, 2.5)}${ci(32, 34, 3.5, '#eafffd')}`,
    helm: sh('M23 15 a9 9 0 0 1 18 0 Z', '#1d3b4d', 2.5),
    accent: `<path d="M6 36 a26 26 0 0 1 52 0 a26 26 0 0 1 -52 0 Z" fill="${P.cyanL}" opacity="0.16"/>
      <path d="M6 36 a26 26 0 0 1 52 0 a26 26 0 0 1 -52 0 Z" fill="none" stroke="${P.cyanL}" stroke-width="2.5" opacity="0.85"/>`,
  }),
};

for (const [key, body] of Object.entries(unitArt)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">\n  ${body}\n</svg>`;
  writeFileSync(path.join(UNIT_DIR, `${key}.svg`), svg, 'utf-8');
}

console.log(`Generated ${Object.keys(SPEC).length} resource icons in ${OUT_DIR}`);
console.log(`Generated ${Object.keys(STRUCT_SPEC).length} structure illustrations in ${STRUCT_DIR}`);
console.log(`Generated ${Object.keys(unitArt).length} unit illustrations in ${UNIT_DIR}`);

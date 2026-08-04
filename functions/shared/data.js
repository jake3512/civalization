// ============================================================
// data.js — 자원, 지형, 구조물, 유닛, 레벨업 규칙 정의 (게임의 "규칙서")
// ============================================================

// ---- 원자재 / 가공자원 / 부품 / 화폐 정의 ----
export const RESOURCES = {
  wood:        { name: '목재',     icon: '🌲', color: '#4a7c3f' },
  stone:       { name: '석재',     icon: '⛰️', color: '#8a8577' },
  coal:        { name: '석탄',     icon: '⚫', color: '#2b2b2b' },
  iron_ore:    { name: '철광석',   icon: '🔶', color: '#a86b4c' },
  gold_ore:    { name: '금광석',   icon: '🟡', color: '#d4af37' },
  copper_ore:  { name: '구리광석', icon: '🟠', color: '#b5651d' },
  crude_oil:   { name: '원유',     icon: '🛢️', color: '#1a1a1a' },
  mana_stone:  { name: '마석',     icon: '🔮', color: '#7d5fd8' },

  iron_ingot:   { name: '철 주괴',   icon: '▬', color: '#c0c0c0' },
  gold_ingot:   { name: '금 주괴',   icon: '▬', color: '#ffd700' },
  copper_ingot: { name: '구리 주괴', icon: '▬', color: '#e08a3c' },

  petroleum: { name: '석유',   icon: '⛽', color: '#3a3a3a' },
  naphtha:   { name: '나프타', icon: '💧', color: '#8fd6d6' },

  food:      { name: '식량',   icon: '🌾', color: '#e0c14c' },
  livestock: { name: '가축',   icon: '🐄', color: '#c99a6b' },
  meat:      { name: '고기',   icon: '🥩', color: '#c14c4c' },

  electricity: { name: '전력',   icon: '⚡', color: '#f5d94e' },
  gold:        { name: '국고 골드', icon: '💰', color: '#f2c94c' }, // 병력 모집·터렛 건설용 화폐

  // ---- 1단계: 기초 가공품 ----
  plank: { name: '판자', icon: '🪵', color: '#b58a52' },
  brick: { name: '벽돌', icon: '🧱', color: '#9c5b40' },

  // ---- 2단계: 기초 소재 ----
  copper_wire: { name: '구리선',  icon: '🧵', color: '#d98a3c' },
  plastic:     { name: '플라스틱', icon: '🧴', color: '#7fb3c9' },

  // ---- 3단계: 고급 부품 ----
  circuit_board: { name: '회로기판', icon: '💾', color: '#5ec98f' },
  rebar:         { name: '철근',     icon: '🔩', color: '#8b8f94' },

  // ---- 4단계: 군사 장비 ----
  wood_spear:  { name: '나무창',   icon: '🥢', color: '#a9784f' },
  wood_shield: { name: '나무방패', icon: '🛡️', color: '#a9784f' },
  iron_spear:  { name: '강화 창',   icon: '🔱', color: '#c0c0c0' },
  iron_shield: { name: '철방패',   icon: '🛡️', color: '#c0c0c0' },
  gun:         { name: '총기',     icon: '🔫', color: '#5a5a5a' },
  vest:        { name: '방탄조끼', icon: '🦺', color: '#c9a13a' },
};

// ---- 지형 위 자원 노드 (필드에 균일 분포로 생성됨) ----
// key 는 world.js 의 지형 생성기에서 사용
// (밀도를 낮게 잡아 필드 전체에서 자원이 희소하게 분포하도록 함)
export const TERRAIN_NODES = {
  forest:     { name: '나무 숲',     yields: 'wood',       icon: '🌲', density: 0.008 },
  quarry:     { name: '채석장',      yields: 'stone',      icon: '⛰️', density: 0.006 },
  coal_mine:  { name: '석탄광산',    yields: 'coal',       icon: '⚫', density: 0.005 },
  iron_mine:  { name: '철광석광산',  yields: 'iron_ore',   icon: '🔶', density: 0.005 },
  gold_mine:  { name: '금광산',      yields: 'gold_ore',   icon: '🟡', density: 0.0025 },
  copper_mine:{ name: '구리광산',    yields: 'copper_ore', icon: '🟠', density: 0.005 },
  oil_vent:   { name: '원유 분출구', yields: 'crude_oil',  icon: '🛢️', density: 0.003 },
  mana_mine:  { name: '마석광산',    yields: 'mana_stone', icon: '🔮', density: 0.0015 },
};
export const WATER = { name: '강/호수', icon: '💧', density: 0.06 };

// ---- 구조물 정의 ----
// footprint: [가로, 세로] 격자 칸 수 (부피값에서 파생)
// upgradeGroup: 레벨업 시 어떤 LEVEL_COSTS 표를 쓸지 (없으면 baseCost*upgradeCostMul 기본식 사용)
export const STRUCTURES = {
  capital: {
    id: 1, name: '수도', volume: 9, footprint: [3, 3],
    desc: '국가의 시작 지점. 국가당 1개, 게임 시작 시 자동 배치됩니다. 레벨에 비례해 국고 골드를 생산하고, 레벨이 오를수록 주변 영토도 넓어집니다.',
    baseCost: {}, maxLevel: 5, upgradeCostMul: 1.8,
    category: 'core', goldIncome: 5, territoryRadius: 4,
  },
  hub: {
    id: 2, name: '중심지', volume: 4, footprint: [2, 2],
    desc: '영토를 확장하는 수단. 주변 타일을 국가 영토로 편입시킵니다.',
    baseCost: { wood: 40, stone: 40 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'core', territoryRadius: 4,
  },
  mine: {
    id: 3, name: '광산', volume: 1, footprint: [1, 1],
    desc: '광물 자원 노드(채석장/석탄·철·금·구리광산) 위에 설치하면 해당 광석을 생산합니다.',
    baseCost: { wood: 15, stone: 10 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'extraction', upgradeGroup: 'extraction',
    requiresNode: ['quarry', 'coal_mine', 'iron_mine', 'gold_mine', 'copper_mine'],
    baseProduction: 2,
  },
  lumber_mill: {
    id: 18, name: '벌목소', volume: 1, footprint: [1, 1],
    desc: '나무 숲 위에 설치하면 목재를 생산합니다.',
    baseCost: { stone: 15 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'extraction', upgradeGroup: 'extraction',
    requiresNode: ['forest'], baseProduction: 3,
  },
  factory: {
    id: 4, name: '공장', volume: 6, footprint: [2, 3],
    desc: '컨베이어 벨트로 투입된 자원으로 선택한 아이템을 제작합니다. (창고 자원은 직접 사용 불가 — 반드시 벨트로 투입해야 함)',
    baseCost: { wood: 60, iron_ingot: 20, stone: 30 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'production', upgradeGroup: 'production',
    recipes: {
      // ---- 1단계: 기초 자원 가공 ----
      plank: { in: { wood: 1 }, out: 1, time: 2, requiresBelt: true },
      brick: { in: { stone: 1 }, out: 1, time: 2, requiresBelt: true },
      // ---- 2단계: 기초 소재 ----
      copper_wire: { in: { copper_ingot: 1 }, out: 2, time: 3, requiresBelt: true },
      plastic:     { in: { naphtha: 1 }, out: 1, time: 3, requiresBelt: true },
      // ---- 3단계: 고급 부품 ----
      circuit_board: { in: { copper_wire: 1, plastic: 1 }, out: 1, time: 5, requiresBelt: true },
      rebar:         { in: { iron_ingot: 1, stone: 1 }, out: 1, time: 3, requiresBelt: true },
      // ---- 4단계: 군사 장비 ----
      wood_spear:  { in: { wood: 1 }, out: 1, time: 2, requiresBelt: true },
      wood_shield: { in: { wood: 1 }, out: 1, time: 2, requiresBelt: true },
      iron_spear:  { in: { iron_ingot: 1, wood: 1 }, out: 1, time: 3, requiresBelt: true },
      iron_shield: { in: { iron_ingot: 1, wood: 1 }, out: 1, time: 3, requiresBelt: true },
      gun:  { in: { iron_ingot: 1, plastic: 1, circuit_board: 1 }, out: 1, time: 6, requiresBelt: true },
      vest: { in: { plastic: 1, rebar: 1 }, out: 1, time: 4, requiresBelt: true },
    },
  },
  smelter: {
    id: 5, name: '제련소', volume: 4, footprint: [2, 2],
    desc: '광석을 제련하여 주괴로 만듭니다.',
    baseCost: { wood: 30, stone: 40 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'production', upgradeGroup: 'production',
    recipes: {
      iron_ingot:   { in: { iron_ore: 1 }, out: 1, time: 3 },
      gold_ingot:   { in: { gold_ore: 1 }, out: 1, time: 4 },
      copper_ingot: { in: { copper_ore: 1 }, out: 1, time: 3 },
    },
  },
  oil_well: {
    id: 6, name: '유전', volume: 1, footprint: [1, 1],
    desc: '분출구 위에 설치하면 원유를 생산합니다.',
    baseCost: { stone: 20, iron_ingot: 10 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'extraction', upgradeGroup: 'extraction',
    requiresNode: ['oil_vent'], baseProduction: 2,
  },
  refinery: {
    id: 7, name: '정제소', volume: 4, footprint: [2, 2],
    desc: '원유를 석유와 나프타로 정제합니다.',
    baseCost: { stone: 40, iron_ingot: 25 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'production', upgradeGroup: 'production',
    recipes: {
      refine: { in: { crude_oil: 1 }, out: { petroleum: 1, naphtha: 1 }, time: 4 },
    },
  },
  extractor: {
    id: 8, name: '추출기', volume: 1, footprint: [1, 1],
    desc: '마석광산에 설치하여 마석을 생산합니다.',
    baseCost: { stone: 30, copper_ingot: 15 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'extraction', upgradeGroup: 'extraction',
    requiresNode: ['mana_mine'], baseProduction: 1,
  },
  farm: {
    id: 9, name: '농지', volume: 9, footprint: [3, 3],
    desc: '씨앗에 따라 다른 식량을 생산. 물(강/호수) 옆에만 설치 가능합니다.',
    baseCost: { wood: 30 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'production', requiresAdjacent: 'water', baseProduction: 4,
  },
  barn: {
    id: 10, name: '축사', volume: 4, footprint: [2, 2],
    desc: '가축을 투입하여 가축을 생산합니다.',
    baseCost: { wood: 40, food: 20 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'production', baseProduction: 2,
  },
  slaughterhouse: {
    id: 11, name: '도축장', volume: 2, footprint: [1, 2],
    desc: '가축을 고기로 가공합니다.',
    baseCost: { wood: 25, iron_ingot: 10 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'production',
    recipes: { meat: { in: { livestock: 2 }, out: 3, time: 3 } },
  },
  power_plant: {
    id: 12, name: '발전소', volume: 4, footprint: [2, 2],
    desc: '나무나 석유로 전력을 생산해 일정 범위에 공급합니다.',
    baseCost: { stone: 50, iron_ingot: 20 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'utility', upgradeGroup: 'power',
    powerRadius: 6, baseProduction: 10,
  },
  wall: {
    id: 13, name: '방벽', volume: 1, footprint: [1, 1],
    desc: '주변 국가의 침입을 막는 방어 구조물.',
    baseCost: { stone: 20 }, maxLevel: 5, upgradeCostMul: 1.4,
    category: 'defense', upgradeGroup: 'defense', defense: 10,
  },

  // ---- 터렛 6종 (TR-01 ~ TR-06) ----
  turret_01: {
    id: 14, code: 'TR-01', name: 'TR-01 기관총 터렛', volume: 1, footprint: [1, 1],
    desc: '기초 수비 시설. 지속적인 전력 공급이 필요합니다.',
    baseCost: { gold: 100, iron_ingot: 5 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'turret', upgradeGroup: 'defense', attack: 8, range: 3, powerDraw: 10,
  },
  turret_02: {
    id: 14, code: 'TR-02', name: 'TR-02 화염 투사 터렛', volume: 1, footprint: [1, 1],
    desc: '근거리 범위 공격을 담당하는 터렛.',
    baseCost: { gold: 200, petroleum: 10 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'turret', upgradeGroup: 'defense', attack: 14, range: 2, powerDraw: 15,
  },
  turret_03: {
    id: 14, code: 'TR-03', name: 'TR-03 대공 미사일 포탑', volume: 1, footprint: [1, 1],
    desc: '적 공중 유닛을 격추하는 포탑.',
    baseCost: { gold: 300, circuit_board: 2 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'turret', upgradeGroup: 'defense', attack: 20, range: 5, powerDraw: 25,
  },
  turret_04: {
    id: 14, code: 'TR-04', name: 'TR-04 전자기 감속 포탑', volume: 1, footprint: [1, 1],
    desc: '적의 이동을 방해하는 포탑.',
    baseCost: { gold: 350, copper_wire: 10 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'turret', upgradeGroup: 'defense', attack: 6, range: 4, powerDraw: 40,
  },
  turret_05: {
    id: 14, code: 'TR-05', name: 'TR-05 대포 공성 터렛', volume: 1, footprint: [1, 1],
    desc: '중형 공성 화력을 갖춘 터렛.',
    baseCost: { gold: 450, rebar: 5 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'turret', upgradeGroup: 'defense', attack: 28, range: 6, powerDraw: 30,
  },
  turret_06: {
    id: 14, code: 'TR-06', name: 'TR-06 마도 빔 레이저', volume: 1, footprint: [1, 1],
    desc: '최고의 화력을 가진 최상위 터렛.',
    baseCost: { gold: 800, mana_stone: 5 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'turret', upgradeGroup: 'defense', attack: 50, range: 7, powerDraw: 80,
  },

  outpost: {
    id: 15, name: '전초기지', volume: 4, footprint: [2, 2],
    desc: '국고 골드로 병력을 모집한 뒤, 컨베이어 벨트로 장비를 투입해 무장시켜야 실제 병력이 됩니다.',
    baseCost: { wood: 50, iron_ingot: 30 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'military_base', upgradeGroup: 'military_base',
  },
  lab: {
    id: 16, name: '연구소', volume: 4, footprint: [2, 2],
    desc: '새로운 구조물을 해금할 수 있게 합니다.',
    baseCost: { wood: 40, gold_ingot: 10 }, maxLevel: 5, upgradeCostMul: 1.8,
    category: 'utility', upgradeGroup: 'lab',
  },
  belt: {
    id: 17, name: '컨베이어 벨트', volume: 1, footprint: [1, 1],
    desc: '자원을 다른 구조물로 이동시킵니다.',
    baseCost: { iron_ingot: 2 }, maxLevel: 3, upgradeCostMul: 1.3,
    category: 'utility',
  },
};

// ---- 병력: 공격 유닛 10종 + 수비 유닛 4종 ----
// gold: 전초기지에서 모집할 때 드는 국고 골드. equip: 벨트로 투입해야 하는 무장 아이템.
// power: 전투력 환산치 (문서에 수치가 없어 모집 비용에 비례해 임의로 산정한 값 — 밸런스 조정 지점)
export const UNITS = {
  attack: {
    recruit_01: { name: '기초 돌격병',     gold: 50,   equip: { wood_spear: 1, wood_shield: 1 },              power: 2 },
    recruit_02: { name: '정찰 기병',       gold: 100,  equip: { wood_spear: 1, plank: 2 },                     power: 3 },
    recruit_03: { name: '중갑 공성병',     gold: 150,  equip: { iron_spear: 1, iron_shield: 1, rebar: 1 },     power: 5 },
    recruit_04: { name: '마도 폭파 특공대', gold: 200,  equip: { mana_stone: 1, brick: 2 },                     power: 6 },
    recruit_05: { name: '화염방사병',      gold: 250,  equip: { gun: 1, petroleum: 2 },                        power: 8 },
    recruit_06: { name: '현대 소총병',     gold: 300,  equip: { gun: 1, vest: 1, circuit_board: 1 },           power: 10 },
    recruit_07: { name: '공중 침투 드론',  gold: 450,  equip: { circuit_board: 2, plastic: 2, copper_wire: 2 }, power: 14 },
    recruit_08: { name: '공성 투석/전차',  gold: 600,  equip: { rebar: 2, circuit_board: 2, coal: 2 },          power: 18 },
    recruit_09: { name: '마도 중갑 전차',  gold: 850,  equip: { rebar: 3, circuit_board: 3, mana_stone: 2 },    power: 24 },
    recruit_10: { name: '마도 돌격 거인',  gold: 1000, equip: { gun: 1, vest: 1, mana_stone: 3 },               power: 30 },
  },
  defense: {
    def_01: { name: '방어 진형병', gold: 50,  equip: { wood_shield: 2, brick: 1 },                power: 2 },
    def_02: { name: '수리 공병',   gold: 200, equip: { rebar: 1, circuit_board: 1, plank: 2 },     power: 4 },
    def_03: { name: '저격 수비병', gold: 350, equip: { gun: 1, circuit_board: 1, wood_spear: 1 },  power: 7 },
    def_04: { name: '마도 결계병', gold: 800, equip: { mana_stone: 2, circuit_board: 2, iron_shield: 1 }, power: 16 },
  },
};

// ---- 기본으로 해금된 구조물 (연구소 없이도 지을 수 있는 최소 세트) ----
export const BASE_UNLOCKED = ['capital', 'hub', 'mine', 'lumber_mill', 'belt', 'wall', 'lab'];

// ---- 전력이 필요한 카테고리 ----
// 발전소 공급 범위 밖이면 아래 카테고리의 구조물은 가동을 멈춘다 (idle).
// 터렛은 범위 안에 있어도 전력(kW)이 실제로 남아있어야 작동한다 (아래 simulate.js에서 소모 처리).
export const POWER_REQUIRED_CATEGORIES = new Set(['extraction', 'production', 'turret']);

// ---- 컨베이어 벨트 ----
// 방향: 0=동(E) 1=남(S) 2=서(W) 3=북(N)
export const DIR_VECT = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const DIR_ARROW = ['→', '↓', '←', '↑'];
export function beltThroughput(level) { return 10 * level; }

// ---- 연구소 기술 트리 ----
// requires: 선행 연구(구조물 key) 배열. cost: 연구 자원 소모. time: 필요 틱 수.
export const TECH_TREE = {
  smelter:        { cost: { wood: 30, stone: 20 },          time: 3, requires: [] },
  oil_well:       { cost: { stone: 30, iron_ingot: 10 },    time: 3, requires: ['smelter'] },
  farm:           { cost: { wood: 30 },                      time: 2, requires: [] },
  barn:           { cost: { wood: 30, food: 10 },            time: 3, requires: ['farm'] },
  slaughterhouse: { cost: { wood: 20, iron_ingot: 10 },     time: 3, requires: ['barn'] },
  power_plant:    { cost: { stone: 40, iron_ingot: 20 },    time: 4, requires: ['smelter'] },
  factory:        { cost: { wood: 50, iron_ingot: 20 },     time: 5, requires: ['smelter', 'power_plant'] },
  refinery:       { cost: { stone: 40, iron_ingot: 20 },    time: 4, requires: ['oil_well'] },
  extractor:      { cost: { stone: 30, copper_ingot: 15 },  time: 4, requires: ['smelter'] },
  turret_01:      { cost: { iron_ingot: 15 },                time: 3, requires: ['smelter', 'power_plant'] },
  turret_02:      { cost: { iron_ingot: 20, petroleum: 5 },  time: 4, requires: ['turret_01'] },
  turret_03:      { cost: { circuit_board: 3 },              time: 5, requires: ['turret_02', 'factory'] },
  turret_04:      { cost: { copper_wire: 8 },                time: 4, requires: ['turret_03'] },
  turret_05:      { cost: { rebar: 6 },                      time: 5, requires: ['turret_04'] },
  turret_06:      { cost: { mana_stone: 4 },                 time: 6, requires: ['turret_05', 'extractor'] },
  outpost:        { cost: { wood: 40, iron_ingot: 20 },     time: 4, requires: ['turret_01'] },
};

// ---- 습격(레이더) 밸런스 상수 ----
export const RAIDER = {
  spawnChance: 0.12,     // 틱마다 새 습격자가 등장할 확률
  maxActive: 3,          // 국가당 동시 활성 습격자 수 상한
  baseHp: 30,
  hpPerTick: 1,          // 게임 경과에 따른 체력 소폭 증가(간이 스케일링)
  moveSpeed: 1,          // 틱당 이동 타일 수
  capitalDamage: 8,      // 수도 도달 시 피해량
  capitalMaxHp: 100,
  capitalRegen: 2,       // 틱당 자연 회복량
};

// ---- 클래시오브클랜식 대전 운영 상수 (트로피 · 실드 · 매치메이킹) ----
export const WAR = {
  starterShieldMs: 2 * 60 * 60 * 1000,      // 건국 직후 보호막 (2시간)
  postAttackShieldMs: 4 * 60 * 60 * 1000,   // 공격당한 뒤 부여되는 보호막 (4시간)
  matchTrophyRange: 150,                     // 매치메이킹 시 허용하는 트로피 격차
  baseTrophyTrade: 24,                       // 기본 트로피 교환량
  minTrophyTrade: 6,
  maxTrophyTrade: 40,
  lossTrophyPenalty: 8,                      // 공격 실패 시 공격자가 잃는 고정 트로피
};

// ---- 구조물 그룹별 레벨업(Lv.1→2 ~ Lv.4→5) 요구 자원 ----
// 배열 인덱스 0 = 1→2강화, 1 = 2→3강화, 2 = 3→4강화, 3 = 4→5강화
export const LEVEL_COSTS = {
  extraction: [
    { brick: 10, iron_ingot: 5 },
    { brick: 20, iron_ingot: 10 },
    { brick: 35, iron_ingot: 20 },
    { brick: 55, iron_ingot: 35 },
  ],
  production: [
    { rebar: 5, circuit_board: 3 },
    { rebar: 10, circuit_board: 6 },
    { rebar: 18, circuit_board: 10 },
    { rebar: 30, circuit_board: 16 },
  ],
  power: [
    { coal: 15 },
    { coal: 30 },
    { petroleum: 20 },
    { mana_stone: 10 },
  ],
  defense: [
    { brick: 15 },
    { brick: 30 },
    { rebar: 15 },
    { plastic: 12 },
  ],
  military_base: [
    { iron_spear: 3, circuit_board: 2 },
    { iron_spear: 6, circuit_board: 5 },
    { gun: 4, circuit_board: 8 },
    { gun: 8, circuit_board: 14 },
  ],
  lab: [
    { circuit_board: 5, mana_stone: 2 },
    { circuit_board: 10, mana_stone: 4 },
    { circuit_board: 18, mana_stone: 8 },
    { circuit_board: 30, mana_stone: 14 },
  ],
};

// 레벨에 따른 업그레이드 비용 계산
export function getUpgradeCost(structKey, currentLevel) {
  const def = STRUCTURES[structKey];
  if (!def) return null;
  if (currentLevel >= def.maxLevel) return null;

  if (def.upgradeGroup && LEVEL_COSTS[def.upgradeGroup]) {
    return { ...LEVEL_COSTS[def.upgradeGroup][currentLevel - 1] };
  }
  // 폴백: 그룹이 지정되지 않은 구조물(수도/중심지/벨트/농지/축사/도축장)은 기존 방식 사용
  const mul = Math.pow(def.upgradeCostMul, currentLevel);
  const cost = {};
  for (const [res, amt] of Object.entries(def.baseCost)) {
    cost[res] = Math.ceil(amt * mul);
  }
  return cost;
}

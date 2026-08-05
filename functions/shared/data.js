// ============================================================
// data.js — 자원, 지형, 구조물, 유닛, 레벨업 규칙 정의 (게임의 "규칙서")
// ============================================================

// ---- 아이콘 에셋 ----
// 이모지는 OS/브라우저마다 모양·크기가 달라 가독성이 들쭉날쭉해서, 대신
// assets/icons/*.svg 에 직접 제작해 둔 배지형 벡터 아이콘을 사용한다
// (scripts/generate-icons.mjs 로 생성 — 규칙을 바꾸려면 그 스크립트를 고칠 것).
const ICON_DIR = 'assets/icons';
const iconPath = (key) => `${ICON_DIR}/${key}.svg`;

// 구조물 아이콘은 assets/icons/struct/<구조물 key>.svg 로 1:1 대응된다
// (STRUCTURES 항목마다 경로를 적지 않고 key로 바로 유도한다).
export const structureIcon = (structKey) => `${ICON_DIR}/struct/${structKey}.svg`;

// ---- 원자재 / 가공자원 / 부품 / 화폐 정의 ----
export const RESOURCES = {
  wood:        { name: '목재',     icon: iconPath('wood'), color: '#4a7c3f' },
  stone:       { name: '석재',     icon: iconPath('stone'), color: '#8a8577' },
  coal:        { name: '석탄',     icon: iconPath('coal'), color: '#2b2b2b' },
  iron_ore:    { name: '철광석',   icon: iconPath('iron_ore'), color: '#a86b4c' },
  gold_ore:    { name: '금광석',   icon: iconPath('gold_ore'), color: '#d4af37' },
  copper_ore:  { name: '구리광석', icon: iconPath('copper_ore'), color: '#b5651d' },
  crude_oil:   { name: '원유',     icon: iconPath('crude_oil'), color: '#1a1a1a' },
  mana_stone:  { name: '마석',     icon: iconPath('mana_stone'), color: '#7d5fd8' },

  iron_ingot:   { name: '철 주괴',   icon: iconPath('iron_ingot'), color: '#c0c0c0' },
  gold_ingot:   { name: '금 주괴',   icon: iconPath('gold_ingot'), color: '#ffd700' },
  copper_ingot: { name: '구리 주괴', icon: iconPath('copper_ingot'), color: '#e08a3c' },

  petroleum: { name: '석유',   icon: iconPath('petroleum'), color: '#3a3a3a' },
  naphtha:   { name: '나프타', icon: iconPath('naphtha'), color: '#8fd6d6' },

  // ---- 작물 (농지에서 재배 — 벼로 시작하고 나머지는 여행으로 구해온다) ----
  rice:  { name: '쌀',     icon: iconPath('rice'), color: '#efe6c8' },
  wheat: { name: '밀',     icon: iconPath('wheat'), color: '#e8b93c' },
  corn:  { name: '옥수수', icon: iconPath('corn'), color: '#f5cf3a' },
  apple: { name: '사과',   icon: iconPath('apple'), color: '#e0402f' },
  grape: { name: '포도',   icon: iconPath('grape'), color: '#8b5cf6' },

  // ---- 가축 (축사에서 사육 — 소로 시작) ----
  cattle:  { name: '소',   icon: iconPath('cattle'), color: '#c9b3a0' },
  pig:     { name: '돼지', icon: iconPath('pig'), color: '#f0a3b0' },
  chicken: { name: '닭',   icon: iconPath('chicken'), color: '#e8d9b0' },
  duck:    { name: '오리', icon: iconPath('duck'), color: '#d8e0e8' },

  // ---- 축산물 ----
  milk: { name: '우유',   icon: iconPath('milk'), color: '#f3f0e8' },
  egg:  { name: '달걀',   icon: iconPath('egg'), color: '#f0e2c0' },
  beef:         { name: '소고기',   icon: iconPath('beef'), color: '#c14c4c' },
  pork:         { name: '돼지고기', icon: iconPath('pork'), color: '#e88a92' },
  chicken_meat: { name: '닭고기',   icon: iconPath('chicken_meat'), color: '#e8c890' },
  duck_meat:    { name: '오리고기', icon: iconPath('duck_meat'), color: '#c08a5a' },

  // ---- 조리 1차 가공품 ----
  flour:       { name: '밀가루', icon: iconPath('flour'), color: '#efe8d8' },
  butter:      { name: '버터',   icon: iconPath('butter'), color: '#f5d76a' },
  cheese:      { name: '치즈',   icon: iconPath('cheese'), color: '#f2b93c' },
  dough:       { name: '반죽',   icon: iconPath('dough'), color: '#e8d5b0' },
  boiled_rice: { name: '밥',     icon: iconPath('boiled_rice'), color: '#f5f0e2' },

  // ---- 완성 요리 (조리소에서 제작 — 판매가가 높다) ----
  bread:         { name: '빵',         icon: iconPath('bread'), color: '#c98a45' },
  popcorn:       { name: '팝콘',       icon: iconPath('popcorn'), color: '#f5e9c0' },
  grape_juice:   { name: '포도주스',   icon: iconPath('grape_juice'), color: '#7d4fc8' },
  steak:         { name: '스테이크',   icon: iconPath('steak'), color: '#a8422f' },
  grilled_pork:  { name: '삼겹살구이', icon: iconPath('grilled_pork'), color: '#d9705f' },
  fried_chicken: { name: '후라이드치킨', icon: iconPath('fried_chicken'), color: '#d9a13c' },
  roast_duck:    { name: '오리구이',   icon: iconPath('roast_duck'), color: '#b06a35' },
  omelet:        { name: '오믈렛',     icon: iconPath('omelet'), color: '#f2c94c' },
  sandwich:      { name: '샌드위치',   icon: iconPath('sandwich'), color: '#e0b878' },
  bibimbap:      { name: '비빔밥',     icon: iconPath('bibimbap'), color: '#d95f45' },
  fruit_pie:     { name: '과일파이',   icon: iconPath('fruit_pie'), color: '#e08a4c' },
  cake:          { name: '케이크',     icon: iconPath('cake'), color: '#f5a8c0' },

  electricity: { name: '전력',   icon: iconPath('electricity'), color: '#f5d94e' },
  gold:        { name: '국고 골드', icon: iconPath('gold'), color: '#f2c94c' }, // 병력 모집·터렛 건설용 화폐
  labor:       { name: '인력',     icon: iconPath('labor'), color: '#6fd4ff' },   // 여행(원정)에 쓰는 인력

  // ---- 1단계: 기초 가공품 ----
  plank: { name: '판자', icon: iconPath('plank'), color: '#b58a52' },
  brick: { name: '벽돌', icon: iconPath('brick'), color: '#9c5b40' },

  // ---- 2단계: 기초 소재 ----
  copper_wire: { name: '구리선',  icon: iconPath('copper_wire'), color: '#d98a3c' },
  plastic:     { name: '플라스틱', icon: iconPath('plastic'), color: '#7fb3c9' },

  // ---- 3단계: 고급 부품 ----
  circuit_board: { name: '회로기판', icon: iconPath('circuit_board'), color: '#5ec98f' },
  rebar:         { name: '철근',     icon: iconPath('rebar'), color: '#8b8f94' },

  // ---- 4단계: 군사 장비 ----
  wood_spear:  { name: '나무창',   icon: iconPath('wood_spear'), color: '#a9784f' },
  wood_shield: { name: '나무방패', icon: iconPath('wood_shield'), color: '#a9784f' },
  iron_spear:  { name: '강화 창',   icon: iconPath('iron_spear'), color: '#c0c0c0' },
  iron_shield: { name: '철방패',   icon: iconPath('iron_shield'), color: '#c0c0c0' },
  gun:         { name: '총기',     icon: iconPath('gun'), color: '#5a5a5a' },
  vest:        { name: '방탄조끼', icon: iconPath('vest'), color: '#c9a13a' },
};

// ---- HUD 상태 아이콘 (RESOURCES에는 없는 트로피/보호막) ----
export const STATUS_ICONS = {
  trophy: iconPath('trophy'),
  shield: iconPath('shield_status'),
};

// ---- 지형 위 자원 노드 (필드에 균일 분포로 생성됨) ----
// key 는 world.js 의 지형 생성기에서 사용
// (밀도를 낮게 잡아 필드 전체에서 자원이 희소하게 분포하도록 함)
export const TERRAIN_NODES = {
  forest:     { name: '나무 숲',     yields: 'wood',       icon: iconPath('wood'), density: 0.008 },
  quarry:     { name: '채석장',      yields: 'stone',      icon: iconPath('stone'), density: 0.006 },
  coal_mine:  { name: '석탄광산',    yields: 'coal',       icon: iconPath('coal'), density: 0.005 },
  iron_mine:  { name: '철광석광산',  yields: 'iron_ore',   icon: iconPath('iron_ore'), density: 0.005 },
  gold_mine:  { name: '금광산',      yields: 'gold_ore',   icon: iconPath('gold_ore'), density: 0.0025 },
  copper_mine:{ name: '구리광산',    yields: 'copper_ore', icon: iconPath('copper_ore'), density: 0.005 },
  oil_vent:   { name: '원유 분출구', yields: 'crude_oil',  icon: iconPath('crude_oil'), density: 0.003 },
  mana_mine:  { name: '마석광산',    yields: 'mana_stone', icon: iconPath('mana_stone'), density: 0.0015 },
};
export const WATER = { name: '강/호수', icon: iconPath('water'), density: 0.06 };

// ---- 수도 건설 요건 ----
// 수도는 아무 데나 세울 수 없고, 수도가 만들어낼 초기 영토(반경) 안에
// 아래 자원 노드가 최소 1개씩 들어와야 한다 — 건국 직후 목재/석재 생산을
// 시작할 수 있는 자리에서만 나라를 세우도록 강제하는 규칙.
export const CAPITAL_REQUIRED_NODES = ['forest', 'quarry'];

// ---- 구조물 정의 ----
// footprint: [가로, 세로] 격자 칸 수 (부피값에서 파생)
// 레벨업 비용은 구조물마다 baseCost * upgradeCostMul^레벨 로 개별 산정된다
// (getUpgradeCost 참고) — 같은 카테고리라도 baseCost·upgradeCostMul이 다르면
// 레벨업 비용도 서로 다르게 갈린다 (예: 공장은 제련소보다, TR-06은 TR-01보다 비쌈).
export const STRUCTURES = {
  capital: {
    id: 1, name: '수도', volume: 9, footprint: [3, 3],
    desc: '국가의 시작 지점. 국가당 1개, 게임 시작 시 자동 배치됩니다. 레벨에 비례해 국고 골드를 생산하고, 레벨이 오를수록 주변 영토도 넓어집니다.',
    baseCost: {}, maxLevel: 10, upgradeCostMul: 1.8,
    category: 'core', baseHp: 600, goldIncome: 5, laborIncome: 3, territoryRadius: 7,
    // 수도는 여러 종류를 함께 보관하는 중앙 창고 역할도 한다
    // (건국 직후 창고를 짓기 전까지 자원을 둘 곳이 필요하므로).
    storageCapacity: 300,
    // 수도는 국가의 성장 단계 그 자체라 레벨업 비용을 개별 표로 지정한다.
    // 각 단계의 비용은 "그 레벨에서 이미 만들 수 있는 자원"으로만 구성해,
    // 아직 해금되지 않은 자원을 요구해 진행이 막히는 일이 없도록 했다
    // (levelCosts[0] = 1→2, [8] = 9→10).
    levelCosts: [
      { wood: 250, stone: 250 },                                             // 1→2  기초 자원
      { wood: 500, stone: 450, iron_ingot: 80 },                             // 2→3  제련소 해금 이후
      { stone: 800, iron_ingot: 200, copper_ingot: 120, coal: 150 },         // 3→4  발전소·유전 단계
      { iron_ingot: 350, brick: 300, plank: 300, petroleum: 120 },           // 4→5  공장·정제소 단계
      { brick: 500, rebar: 180, circuit_board: 90, mana_stone: 60 },         // 5→6  추출기 단계
      { rebar: 320, circuit_board: 200, gold_ingot: 180, plastic: 150 },     // 6→7
      { circuit_board: 380, rebar: 450, mana_stone: 220, gun: 60 },          // 7→8
      { circuit_board: 600, mana_stone: 380, vest: 90, gun: 120 },           // 8→9
      { circuit_board: 900, mana_stone: 600, gun: 200, vest: 200, gold_ingot: 600 }, // 9→10
    ],
  },
  hub: {
    id: 2, name: '중심지', volume: 4, footprint: [2, 2],
    desc: '영토를 확장하는 수단. 주변 타일을 국가 영토로 편입시킵니다.',
    baseCost: { wood: 40, stone: 40 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'core', baseHp: 200, territoryRadius: 4,
  },
  mine: {
    id: 3, name: '광산', volume: 1, footprint: [1, 1],
    desc: '광물 자원 노드(채석장/석탄·철·금·구리광산) 위에 설치하면 해당 광석을 생산합니다.',
    baseCost: { wood: 15, stone: 10 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'extraction', baseHp: 50,
    requiresNode: ['quarry', 'coal_mine', 'iron_mine', 'gold_mine', 'copper_mine'],
    baseProduction: 2,
  },
  lumber_mill: {
    id: 18, name: '벌목소', volume: 1, footprint: [1, 1],
    desc: '나무 숲 위에 설치하면 목재를 생산합니다.',
    baseCost: { stone: 15 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'extraction', baseHp: 50,
    requiresNode: ['forest'], baseProduction: 3,
  },
  factory: {
    id: 4, name: '공장', volume: 6, footprint: [2, 3],
    desc: '컨베이어 벨트로 투입된 자원으로 선택한 아이템을 제작합니다. (창고 자원은 직접 사용 불가 — 반드시 벨트로 투입해야 함)',
    baseCost: { wood: 60, iron_ingot: 20, stone: 30 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'production', baseHp: 220,
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
    category: 'production', baseHp: 160,
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
    category: 'extraction', baseHp: 60,
    requiresNode: ['oil_vent'], baseProduction: 2,
  },
  refinery: {
    id: 7, name: '정제소', volume: 4, footprint: [2, 2],
    desc: '원유를 석유와 나프타로 정제합니다.',
    baseCost: { stone: 40, iron_ingot: 25 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'production', baseHp: 180,
    recipes: {
      refine: { in: { crude_oil: 1 }, out: { petroleum: 1, naphtha: 1 }, time: 4 },
    },
  },
  extractor: {
    id: 8, name: '추출기', volume: 1, footprint: [1, 1],
    desc: '마석광산에 설치하여 마석을 생산합니다.',
    baseCost: { stone: 30, copper_ingot: 15 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'extraction', baseHp: 70,
    requiresNode: ['mana_mine'], baseProduction: 1,
  },
  farm: {
    id: 9, name: '농지', volume: 9, footprint: [3, 3],
    desc: '씨앗에 따라 다른 식량을 생산. 물(강/호수) 옆에만 설치 가능합니다.',
    baseCost: { wood: 30 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'production', baseHp: 150, requiresAdjacent: 'water', baseProduction: 4,
  },
  barn: {
    id: 10, name: '축사', volume: 4, footprint: [2, 2],
    desc: '가축을 투입하여 가축을 생산합니다.',
    baseCost: { wood: 40, rice: 20 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'production', baseHp: 130, baseProduction: 2,
  },
  slaughterhouse: {
    id: 11, name: '도축장', volume: 2, footprint: [1, 2],
    desc: '가축을 고기로 가공합니다.',
    baseCost: { wood: 25, iron_ingot: 10 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'production', baseHp: 100,
    // 가축 종류마다 나오는 고기가 다르다 (축사에서 기른 가축을 벨트/수동으로 투입)
    recipes: {
      beef:         { in: { cattle: 1 },  out: 3, time: 3 },
      pork:         { in: { pig: 1 },     out: 3, time: 3 },
      chicken_meat: { in: { chicken: 1 }, out: 2, time: 2 },
      duck_meat:    { in: { duck: 1 },    out: 2, time: 2 },
    },
  },
  kitchen: {
    id: 20, name: '조리소', volume: 6, footprint: [2, 3],
    desc: '재료를 조합해 요리를 만듭니다. 조리 공정이 깊고 재료가 귀할수록 완성품의 판매 가격이 크게 올라갑니다. 재료는 벨트나 수동 이송으로 넣어주세요.',
    baseCost: { wood: 70, stone: 50, brick: 20 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'production', baseHp: 180,
    recipes: {
      // --- 1차 조리 (재료 1종) ---
      boiled_rice:   { in: { rice: 2 },                        out: 2, time: 2 },
      flour:         { in: { wheat: 2 },                       out: 2, time: 2 },
      butter:        { in: { milk: 2 },                        out: 1, time: 3 },
      cheese:        { in: { milk: 3 },                        out: 1, time: 4 },
      popcorn:       { in: { corn: 2 },                        out: 3, time: 2 },
      grape_juice:   { in: { grape: 3 },                       out: 2, time: 3 },
      // --- 2차 조리 (1차 가공품이 재료로 들어간다) ---
      dough:         { in: { flour: 2, egg: 1 },               out: 2, time: 3 },
      steak:         { in: { beef: 2, butter: 1 },             out: 2, time: 4 },
      grilled_pork:  { in: { pork: 2, corn: 1 },               out: 2, time: 4 },
      fried_chicken: { in: { chicken_meat: 2, flour: 1 },      out: 2, time: 4 },
      roast_duck:    { in: { duck_meat: 2, apple: 1 },         out: 2, time: 5 },
      omelet:        { in: { egg: 3, cheese: 1 },              out: 2, time: 4 },
      // --- 3차 조리 (2차 가공품이 재료로 들어간다 — 판매가가 크게 뛴다) ---
      bread:         { in: { dough: 2, butter: 1 },            out: 2, time: 4 },
      bibimbap:      { in: { boiled_rice: 2, beef: 1, egg: 1 }, out: 2, time: 5 },
      fruit_pie:     { in: { dough: 2, apple: 2, grape: 1 },   out: 1, time: 6 },
      // --- 4차 조리 (최고급) ---
      sandwich:      { in: { bread: 1, cheese: 1, pork: 1 },   out: 2, time: 5 },
      cake:          { in: { dough: 2, butter: 2, grape: 2, cheese: 1 }, out: 1, time: 8 },
    },
  },
  power_plant: {
    id: 12, name: '발전소', volume: 4, footprint: [2, 2],
    desc: '나무나 석유로 전력을 생산해 일정 범위에 공급합니다.',
    baseCost: { stone: 50, iron_ingot: 20 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'utility', baseHp: 190,
    powerRadius: 6, baseProduction: 10,
  },
  wall: {
    id: 13, name: '방벽', volume: 1, footprint: [1, 1],
    desc: '주변 국가의 침입을 막는 방어 구조물.',
    baseCost: { stone: 20 }, maxLevel: 5, upgradeCostMul: 1.4,
    category: 'defense', baseHp: 120, defense: 10,
  },

  // ---- 터렛 6종 (TR-01 ~ TR-06) ----
  turret_01: {
    id: 14, code: 'TR-01', name: 'TR-01 기관총 터렛', volume: 1, footprint: [1, 1],
    desc: '기초 수비 시설. 지속적인 전력 공급이 필요합니다.',
    baseCost: { gold: 100, iron_ingot: 5 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'turret', baseHp: 100, attack: 8, range: 3, powerDraw: 10,
  },
  turret_02: {
    id: 14, code: 'TR-02', name: 'TR-02 화염 투사 터렛', volume: 1, footprint: [1, 1],
    desc: '근거리 범위 공격을 담당하는 터렛.',
    baseCost: { gold: 200, petroleum: 10 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'turret', baseHp: 120, attack: 14, range: 2, powerDraw: 15,
  },
  turret_03: {
    id: 14, code: 'TR-03', name: 'TR-03 대공 미사일 포탑', volume: 1, footprint: [1, 1],
    desc: '적 공중 유닛을 격추하는 포탑.',
    baseCost: { gold: 300, circuit_board: 2 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'turret', baseHp: 140, attack: 20, range: 5, powerDraw: 25,
  },
  turret_04: {
    id: 14, code: 'TR-04', name: 'TR-04 전자기 감속 포탑', volume: 1, footprint: [1, 1],
    desc: '적의 이동을 방해하는 포탑.',
    baseCost: { gold: 350, copper_wire: 10 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'turret', baseHp: 150, attack: 6, range: 4, powerDraw: 40,
  },
  turret_05: {
    id: 14, code: 'TR-05', name: 'TR-05 대포 공성 터렛', volume: 1, footprint: [1, 1],
    desc: '중형 공성 화력을 갖춘 터렛.',
    baseCost: { gold: 450, rebar: 5 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'turret', baseHp: 170, attack: 28, range: 6, powerDraw: 30,
  },
  turret_06: {
    id: 14, code: 'TR-06', name: 'TR-06 마도 빔 레이저', volume: 1, footprint: [1, 1],
    desc: '최고의 화력을 가진 최상위 터렛.',
    baseCost: { gold: 800, mana_stone: 5 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'turret', baseHp: 200, attack: 50, range: 7, powerDraw: 80,
  },

  outpost: {
    id: 15, name: '전초기지', volume: 4, footprint: [2, 2],
    desc: '국고 골드로 병력을 모집한 뒤, 컨베이어 벨트로 장비를 투입해 무장시켜야 실제 병력이 됩니다.',
    baseCost: { wood: 50, iron_ingot: 30 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'military_base', baseHp: 170,
  },
  lab: {
    id: 16, name: '연구소', volume: 4, footprint: [2, 2],
    desc: '새로운 구조물을 해금할 수 있게 합니다.',
    baseCost: { wood: 60, stone: 40 }, maxLevel: 5, upgradeCostMul: 1.8,
    category: 'utility', baseHp: 150,
  },
  belt: {
    id: 17, name: '컨베이어 벨트', volume: 1, footprint: [1, 1],
    desc: '자원을 다른 구조물로 이동시킵니다.',
    baseCost: { wood: 2, stone: 2 }, maxLevel: 3, upgradeCostMul: 1.3,
    category: 'utility', baseHp: 25,
  },
  warehouse: {
    id: 19, name: '창고', volume: 4, footprint: [2, 2],
    desc: '자원을 보관합니다. 창고 하나에는 한 종류의 자원만 넣을 수 있습니다. 컨베이어 벨트나 수동 이송으로 넣고 뺄 수 있으며, 상단 국고 표시는 창고·수도에 실제로 보관된 자원의 합계입니다.',
    baseCost: { wood: 30, stone: 20 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'storage', baseHp: 140,
    storageCapacity: 500,   // 레벨당 이만큼씩 늘어난다 (getStorageCapacity 참고)
    singleResource: true,   // 한 창고에는 한 종류만
  },
};

// ============================================================
// 농사 · 축산 · 여행
// ============================================================

// ---- 작물 (농지에서 고른다) ----
// 벼만 처음부터 재배할 수 있고, 나머지는 여행을 통해 종자를 구해와야 열린다.
export const CROPS = {
  rice:  { name: '벼',       yields: 'rice',  baseYield: 4, start: true },
  wheat: { name: '밀',       yields: 'wheat', baseYield: 3 },
  corn:  { name: '옥수수',   yields: 'corn',  baseYield: 3 },
  apple: { name: '사과나무', yields: 'apple', baseYield: 2 },
  grape: { name: '포도나무', yields: 'grape', baseYield: 2 },
};

// ---- 가축 (축사에서 고른다) ----
// 소로 시작하고 나머지는 여행으로 데려온다. products는 매 틱 함께 나오는 부산물.
export const ANIMALS = {
  cattle:  { name: '소',   yields: 'cattle',  baseYield: 1, products: { milk: 2 }, start: true },
  pig:     { name: '돼지', yields: 'pig',     baseYield: 2, products: {} },
  chicken: { name: '닭',   yields: 'chicken', baseYield: 2, products: { egg: 3 } },
  duck:    { name: '오리', yields: 'duck',    baseYield: 2, products: { egg: 2 } },
};

// ---- 여행 ----
// 인력(labor)과 시간을 들여 원정을 보내, 자원과 함께 새 작물/가축/요리법을
// 얻어온다. unlocks는 'crop:*' / 'animal:*' / 'dish:*' 형태의 해금 키.
export const EXPEDITIONS = {
  river_village: {
    name: '강가 마을 교역', desc: '가까운 농촌과 물물교환을 합니다. 밀 종자를 얻어옵니다.',
    labor: 30, ticks: 10, capitalLevel: 2,
    rewards: { rice: 60, wheat: 40 }, unlocks: ['crop:wheat'],
  },
  southern_plain: {
    name: '남부 평야 원정', desc: '옥수수를 재배하는 평야로 향합니다.',
    labor: 50, ticks: 14, capitalLevel: 3,
    rewards: { corn: 60, wheat: 40 }, unlocks: ['crop:corn'],
  },
  hill_farm: {
    name: '구릉지 목장 방문', desc: '돼지를 사육하는 목장에서 종축을 들여옵니다.',
    labor: 70, ticks: 16, capitalLevel: 3,
    rewards: { pig: 10, rice: 60 }, unlocks: ['animal:pig'],
  },
  orchard_road: {
    name: '과수원 길 탐사', desc: '사과와 포도 묘목을 구해옵니다.',
    labor: 90, ticks: 20, capitalLevel: 4,
    rewards: { apple: 50, grape: 40 }, unlocks: ['crop:apple', 'crop:grape'],
  },
  poultry_coast: {
    name: '해안 가금 마을', desc: '닭과 오리를 들여오고 조리법을 배워옵니다.',
    labor: 110, ticks: 22, capitalLevel: 4,
    rewards: { chicken: 12, duck: 10, egg: 40 },
    unlocks: ['animal:chicken', 'animal:duck', 'dish:omelet', 'dish:fried_chicken'],
  },
  capital_market: {
    name: '대도시 요리 유학', desc: '이름난 조리사에게 고급 요리법을 배웁니다.',
    labor: 160, ticks: 28, capitalLevel: 5,
    rewards: { milk: 60, apple: 40 },
    unlocks: ['dish:bread', 'dish:fruit_pie', 'dish:sandwich', 'dish:cake', 'dish:bibimbap', 'dish:roast_duck'],
  },
};

// 처음부터 알고 있는 요리법 (나머지는 여행으로 배운다)
export const START_DISHES = [
  'boiled_rice', 'flour', 'butter', 'cheese', 'popcorn', 'grape_juice',
  'dough', 'steak', 'grilled_pork',
];

// ============================================================
// 판매 가격 — 재료의 희소성과 조리 공정 깊이에서 자동으로 계산된다.
// (직접 값을 적지 않고 레시피를 따라 재귀 계산하므로, 공정이 깊거나
//  귀한 재료를 쓰는 요리일수록 반드시 더 비싸진다)
// ============================================================
const BASE_VALUE = {
  wood: 1, stone: 1, coal: 3, iron_ore: 3, copper_ore: 3, gold_ore: 8, crude_oil: 5, mana_stone: 15,
  rice: 3, wheat: 4, corn: 4, apple: 7, grape: 8,
  cattle: 12, pig: 10, chicken: 6, duck: 8,
  milk: 5, egg: 5,
};
const VALUE_MARKUP = 1.7;  // 공정을 한 번 거칠 때마다 붙는 가공 마진
const VALUE_STEP_BONUS = 3; // 공정 1회당 고정 가산 (공정 수 자체에 대한 보상)

let _valueCache = null;
function computeValues() {
  const value = { ...BASE_VALUE };
  // 레시피를 따라 고정점에 도달할 때까지 반복 계산한다
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const def of Object.values(STRUCTURES)) {
      if (!def.recipes) continue;
      for (const [outKey, r] of Object.entries(def.recipes)) {
        const outs = typeof r.out === 'number' ? { [outKey]: r.out } : r.out;
        const ins = Object.entries(r.in);
        if (!ins.every(([k]) => value[k] != null)) continue;
        const inputCost = ins.reduce((sum, [k, q]) => sum + value[k] * q, 0);
        const outQty = Object.values(outs).reduce((a, b) => a + b, 0);
        const each = Math.ceil((inputCost * VALUE_MARKUP) / outQty) + VALUE_STEP_BONUS;
        for (const k of Object.keys(outs)) {
          if (value[k] == null || value[k] < each) { value[k] = each; changed = true; }
        }
      }
    }
    if (!changed) break;
  }
  return value;
}

/** 자원 1개의 판매 가격(국고 골드). 원료는 싸고, 조리 단계가 깊을수록 비싸다. */
export function getSellPrice(res) {
  if (!_valueCache) _valueCache = computeValues();
  return _valueCache[res] || 0;
}

// ---- 병력: 공격 유닛 10종 + 수비 유닛 4종 ----
// gold: 전초기지에서 모집할 때 드는 국고 골드. equip: 벨트로 투입해야 하는 무장 아이템.
// power: 전투력 환산치이자 실시간 전투에서의 타격 1회당 피해량.
// hp/speed(타일/초)/range(타일)/atkInterval(초)는 문서에 수치가 없어 모집 비용·power에
// 비례해 임의로 산정했습니다(밸런스 조정 지점) — 실시간 습격 전투(battle.js)에서 사용됩니다.
// targetPriority: 'any'(가장 가까운 아무 구조물) · 'military'(터렛/방벽 최우선, 그 외 무시)
//   · 'wall_suicide'(가장 가까운 방벽으로 돌진해 충돌 시 큰 피해를 주고 자폭)
//   · 'flying_core'(장애물을 무시하고 발전소 → 없으면 수도를 직행 타격, flying:true)
export const UNITS = {
  attack: {
    recruit_01: { name: '기초 돌격병',     gold: 50,   equip: { wood_spear: 1, wood_shield: 1 },              power: 2,  hp: 20,  speed: 1.4, range: 0.6, atkInterval: 1.0, targetPriority: 'any' },
    recruit_02: { name: '정찰 기병',       gold: 100,  equip: { wood_spear: 1, plank: 2 },                     power: 3,  hp: 22,  speed: 2.2, range: 0.6, atkInterval: 1.0, targetPriority: 'any' },
    recruit_03: { name: '중갑 공성병',     gold: 150,  equip: { iron_spear: 1, iron_shield: 1, rebar: 1 },     power: 5,  hp: 60,  speed: 0.9, range: 0.7, atkInterval: 1.0, targetPriority: 'military' },
    recruit_04: { name: '마도 폭파 특공대', gold: 200,  equip: { mana_stone: 1, brick: 2 },                     power: 6,  hp: 16,  speed: 1.8, range: 0.5, atkInterval: 1.0, targetPriority: 'wall_suicide', suicideMul: 6 },
    recruit_05: { name: '화염방사병',      gold: 250,  equip: { gun: 1, petroleum: 2 },                        power: 8,  hp: 35,  speed: 1.2, range: 1.2, atkInterval: 1.0, targetPriority: 'any' },
    recruit_06: { name: '현대 소총병',     gold: 300,  equip: { gun: 1, vest: 1, circuit_board: 1 },           power: 10, hp: 30,  speed: 1.3, range: 2.5, atkInterval: 1.0, targetPriority: 'any' },
    recruit_07: { name: '공중 침투 드론',  gold: 450,  equip: { circuit_board: 2, plastic: 2, copper_wire: 2 }, power: 14, hp: 26,  speed: 1.6, range: 1.0, atkInterval: 1.0, targetPriority: 'flying_core', flying: true },
    recruit_08: { name: '공성 투석/전차',  gold: 600,  equip: { rebar: 2, circuit_board: 2, coal: 2 },          power: 18, hp: 90,  speed: 0.8, range: 2.0, atkInterval: 1.0, targetPriority: 'military' },
    recruit_09: { name: '마도 중갑 전차',  gold: 850,  equip: { rebar: 3, circuit_board: 3, mana_stone: 2 },    power: 24, hp: 110, speed: 0.9, range: 1.5, atkInterval: 1.0, targetPriority: 'any' },
    recruit_10: { name: '마도 돌격 거인',  gold: 1000, equip: { gun: 1, vest: 1, mana_stone: 3 },               power: 30, hp: 160, speed: 0.7, range: 0.8, atkInterval: 1.0, targetPriority: 'any' },
  },
  // role: 'tank'(가장 가까운 적에게 이동해 어그로를 끔) · 'sniper'(제자리에서 사거리 내 적 저격)
  //   · 'repair'(가장 가까운 손상된 터렛/방벽으로 이동해 지속 회복) · 'guard'(느리게 이동하는 강한 근접 수비병)
  defense: {
    def_01: { name: '방어 진형병', gold: 50,  equip: { wood_shield: 2, brick: 1 },                power: 2,  hp: 70, speed: 1.0, range: 0.6, atkInterval: 1.0, role: 'tank' },
    def_02: { name: '수리 공병',   gold: 200, equip: { rebar: 1, circuit_board: 1, plank: 2 },     power: 4,  hp: 30, speed: 1.0, range: 0.6, healRate: 8, role: 'repair' },
    def_03: { name: '저격 수비병', gold: 350, equip: { gun: 1, circuit_board: 1, wood_spear: 1 },  power: 7,  hp: 25, speed: 0,   range: 3.0, atkInterval: 1.0, role: 'sniper' },
    def_04: { name: '마도 결계병', gold: 800, equip: { mana_stone: 2, circuit_board: 2, iron_shield: 1 }, power: 16, hp: 90, speed: 0.6, range: 1.0, atkInterval: 1.0, role: 'guard' },
  },
};

// ---- 기본으로 해금된 구조물 (연구소 없이도 지을 수 있는 최소 세트) ----
// 창고는 유일한 자원 보관처라 처음부터 지을 수 있어야 한다.
export const BASE_UNLOCKED = ['capital', 'hub', 'mine', 'lumber_mill', 'belt', 'wall', 'lab', 'warehouse'];

// ---- 물류/보관 상수 ----
// 구조물은 생산물을 자기 산출 인벤토리에 쌓고, 가득 차면 가동을 멈춘다.
// 쌓인 자원은 컨베이어 벨트나 "수동 이송"으로 창고(수도 포함)까지 옮겨야
// 비로소 국고(상단 표시)에 잡히고 건설·연구·모집에 쓸 수 있다.
export const LOGISTICS = {
  outputCapacity: 50,        // 채굴·가공 구조물의 산출 인벤토리 상한 (레벨당 증가)
  outputCapacityPerLevel: 25,
  inputCapacity: 120,        // 투입 버퍼 상한 (벨트가 이 이상은 밀어넣지 못함)
  manualTransfer: 10,        // 수동 이송 버튼 1회 이송량
  manualOperateRate: 0.5,    // 수동 운용(버튼 누르고 있는 동안) 생산 배율
  manualOperateMs: 600,      // 수동 운용 1사이클 간격 (ms)
  warehouseBeltRate: 10,     // 창고가 벨트로 매 틱 내보내는 양 (레벨 비례)
};

// 창고에 실물로 보관되지 않는 자원 (국고 골드 · 전력은 수치로만 관리한다)
export const VIRTUAL_RESOURCES = new Set(['gold', 'electricity', 'labor']);

/** 보관 구조물(창고·수도)의 레벨별 보관 상한 */
export function getStorageCapacity(structKey, level) {
  const def = STRUCTURES[structKey];
  if (!def || !def.storageCapacity) return 0;
  return def.storageCapacity * level;
}

/** 채굴·가공 구조물의 레벨별 산출 인벤토리 상한 */
export function getOutputCapacity(structKey, level) {
  const def = STRUCTURES[structKey];
  if (!def) return 0;
  if (def.category !== 'extraction' && def.category !== 'production') return 0;
  return LOGISTICS.outputCapacity + LOGISTICS.outputCapacityPerLevel * (level - 1);
}

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
// capitalLevel: 이 연구를 열려면 필요한 수도 레벨 — 수도를 키워야 다음 단계
//   기술이 연구소에 나타난다(수도 성장 = 국가의 시대 진행).
export const TECH_TREE = {
  // 2단계 — 제련·농업
  smelter:        { cost: { wood: 60, stone: 40 },           time: 3, requires: [],                          capitalLevel: 2 },
  farm:           { cost: { wood: 60, stone: 30 },           time: 2, requires: [],                          capitalLevel: 2 },
  // 3단계 — 에너지·축산
  oil_well:       { cost: { stone: 60, iron_ingot: 20 },     time: 3, requires: ['smelter'],                 capitalLevel: 3 },
  power_plant:    { cost: { stone: 80, iron_ingot: 40 },     time: 4, requires: ['smelter'],                 capitalLevel: 3 },
  barn:           { cost: { wood: 60, rice: 20 },            time: 3, requires: ['farm'],                    capitalLevel: 3 },
  // 4단계 — 가공 산업
  factory:        { cost: { wood: 100, iron_ingot: 50 },     time: 5, requires: ['smelter', 'power_plant'],  capitalLevel: 4 },
  refinery:       { cost: { stone: 80, iron_ingot: 45 },     time: 4, requires: ['oil_well'],                capitalLevel: 4 },
  kitchen:        { cost: { wood: 80, brick: 25 },            time: 4, requires: ['farm'],                    capitalLevel: 4 },
  // 5단계 — 마석·식품 가공
  extractor:      { cost: { stone: 70, copper_ingot: 35 },   time: 4, requires: ['smelter'],                 capitalLevel: 5 },
  slaughterhouse: { cost: { wood: 50, iron_ingot: 25 },      time: 3, requires: ['barn'],                    capitalLevel: 5 },
  // 6단계 — 기초 군사
  turret_01:      { cost: { iron_ingot: 40, brick: 30 },     time: 3, requires: ['smelter', 'power_plant'],  capitalLevel: 6 },
  outpost:        { cost: { wood: 90, iron_ingot: 50 },      time: 4, requires: ['turret_01'],               capitalLevel: 6 },
  // 7단계 이상 — 고급 방어 시설
  turret_02:      { cost: { iron_ingot: 60, petroleum: 20 }, time: 4, requires: ['turret_01'],               capitalLevel: 7 },
  turret_03:      { cost: { circuit_board: 12 },             time: 5, requires: ['turret_02', 'factory'],    capitalLevel: 7 },
  turret_04:      { cost: { copper_wire: 30 },               time: 4, requires: ['turret_03'],               capitalLevel: 8 },
  turret_05:      { cost: { rebar: 25 },                     time: 5, requires: ['turret_04'],               capitalLevel: 8 },
  turret_06:      { cost: { mana_stone: 20 },                time: 6, requires: ['turret_05', 'extractor'],  capitalLevel: 9 },
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

// ---- 실시간 습격 전투(전초기지·집결지 → 소환→AI 전투) 운영 상수 ----
// 전투는 공격자 클라이언트가 방어자의 스냅샷을 가져와 로컬로 시뮬레이션한다
// (battle.js). 결과(파괴율·약탈량)만 서버에 제출해 검증 후 반영된다.
// 방어자의 실제 구조물은 전투로 영구 파괴되지 않는다(클래시 오브 클랜 방식) —
// 다음 전투에서는 항상 원래 체력으로 다시 시작하고, 오직 자원만 영구적으로
// 약탈된다.
export const BATTLE = {
  durationSec: 150,          // 전투 제한 시간
  winDestructionPct: 0.5,    // 이 이상 파괴해야 "승리" 판정 (트로피 획득)
  lootRatePerHp: 0.9,        // 구조물 파괴 시, 그 구조물이 차지하는 최대체력 비율만큼 약탈 강도
  perfectVictoryLootMul: 3,  // 수도까지 파괴한 "완벽한 승리" 시 약탈량 배율
  hpLevelBonus: 0.25,        // 구조물 레벨 1당 최대체력 증가율 (getStructureMaxHp 참고)
};

// 레벨에 따른 구조물 최대 체력 (실시간 습격 전투에서만 쓰이며, 저장되지 않는 값)
export function getStructureMaxHp(structKey, level) {
  const def = STRUCTURES[structKey];
  if (!def || !def.baseHp) return 0;
  return Math.round(def.baseHp * (1 + BATTLE.hpLevelBonus * (level - 1)));
}

// 레벨에 따른 업그레이드 비용 계산 (baseCost * upgradeCostMul^레벨, 구조물마다 개별 산정)
export function getUpgradeCost(structKey, currentLevel) {
  const def = STRUCTURES[structKey];
  if (!def) return null;
  if (currentLevel >= def.maxLevel) return null;

  // 수도처럼 단계별 비용표가 지정된 구조물은 그 표를 그대로 쓴다
  if (def.levelCosts) return { ...(def.levelCosts[currentLevel - 1] || {}) };

  const mul = Math.pow(def.upgradeCostMul, currentLevel);
  const cost = {};
  for (const [res, amt] of Object.entries(def.baseCost)) {
    cost[res] = Math.ceil(amt * mul);
  }
  return cost;
}

// ============================================================
// data.js — 자원, 지형, 구조물 정의 (게임의 "규칙서")
// ============================================================

// ---- 원자재 / 가공자원 정의 ----
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
  military:    { name: '군사력', icon: '⚔️', color: '#b5433c' },

  steel: { name: '강철 부품', icon: '⚙️', color: '#9fb0b8' }, // 공장 산출물 (벨트 투입 전용)
};

// ---- 지형 위 자원 노드 (필드에 균일 분포로 생성됨) ----
// key 는 world.js 의 지형 생성기에서 사용
export const TERRAIN_NODES = {
  forest:     { name: '나무 숲',     yields: 'wood',       icon: '🌲', density: 0.05 },
  quarry:     { name: '채석장',      yields: 'stone',      icon: '⛰️', density: 0.04 },
  coal_mine:  { name: '석탄광산',    yields: 'coal',       icon: '⚫', density: 0.03 },
  iron_mine:  { name: '철광석광산',  yields: 'iron_ore',   icon: '🔶', density: 0.03 },
  gold_mine:  { name: '금광산',      yields: 'gold_ore',   icon: '🟡', density: 0.015 },
  copper_mine:{ name: '구리광산',    yields: 'copper_ore', icon: '🟠', density: 0.03 },
  oil_vent:   { name: '원유 분출구', yields: 'crude_oil',  icon: '🛢️', density: 0.02 },
  mana_mine:  { name: '마석광산',    yields: 'mana_stone', icon: '🔮', density: 0.01 },
};
export const WATER = { name: '강/호수', icon: '💧', density: 0.06 };

// ---- 구조물 정의 ----
// footprint: [가로, 세로] 격자 칸 수 (부피값에서 파생)
// baseCost: 최초 건설 비용 (레벨 1)
// upgradeCostMul: 레벨업 시 이전 비용에 곱해지는 배율
export const STRUCTURES = {
  capital: {
    id: 1, name: '수도', volume: 9, footprint: [3, 3],
    desc: '국가의 시작 지점. 국가당 1개, 게임 시작 시 자동 배치됩니다.',
    baseCost: {}, maxLevel: 5, upgradeCostMul: 1.8,
    category: 'core',
  },
  hub: {
    id: 2, name: '중심지', volume: 4, footprint: [2, 2],
    desc: '영토를 확장하는 수단. 주변 타일을 국가 영토로 편입시킵니다.',
    baseCost: { wood: 40, stone: 40 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'core', territoryRadius: 4,
  },
  mine: {
    id: 3, name: '광산', volume: 1, footprint: [1, 1],
    desc: '자원 노드(채석장/광산 등) 위에 설치하면 해당 광석을 생산합니다.',
    baseCost: { wood: 15, stone: 10 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'extraction', requiresNode: ['quarry', 'coal_mine', 'iron_mine', 'gold_mine', 'copper_mine'],
    baseProduction: 2,
  },
  factory: {
    id: 4, name: '공장', volume: 6, footprint: [2, 3],
    desc: '컨베이어 벨트로 투입된 자원으로 선택한 아이템을 제작합니다. (창고 자원은 직접 사용 불가 — 반드시 벨트로 투입해야 함)',
    baseCost: { wood: 60, iron_ingot: 20, stone: 30 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'production',
    recipes: {
      steel: { in: { iron_ingot: 3, coal: 2 }, out: 1, time: 6, requiresBelt: true },
    },
  },
  smelter: {
    id: 5, name: '제련소', volume: 4, footprint: [2, 2],
    desc: '광석을 제련하여 주괴로 만듭니다.',
    baseCost: { wood: 30, stone: 40 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'production',
    recipes: {
      iron_ingot:   { in: { iron_ore: 2, coal: 1 }, out: 1, time: 4 },
      gold_ingot:   { in: { gold_ore: 2, coal: 1 }, out: 1, time: 5 },
      copper_ingot: { in: { copper_ore: 2, coal: 1 }, out: 1, time: 4 },
    },
  },
  oil_well: {
    id: 6, name: '유전', volume: 1, footprint: [1, 1],
    desc: '분출구 위에 설치하면 원유를 생산합니다.',
    baseCost: { stone: 20, iron_ingot: 10 }, maxLevel: 5, upgradeCostMul: 1.5,
    category: 'extraction', requiresNode: ['oil_vent'], baseProduction: 2,
  },
  refinery: {
    id: 7, name: '정제소', volume: 4, footprint: [2, 2],
    desc: '원유를 석유와 나프타로 정제합니다.',
    baseCost: { stone: 40, iron_ingot: 25 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'production',
    recipes: {
      refine: { in: { crude_oil: 3 }, out: { petroleum: 2, naphtha: 1 }, time: 5 },
    },
  },
  extractor: {
    id: 8, name: '추출기', volume: 1, footprint: [1, 1],
    desc: '마석광산에 설치하여 마석을 생산합니다.',
    baseCost: { stone: 30, copper_ingot: 15 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'extraction', requiresNode: ['mana_mine'], baseProduction: 1,
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
    category: 'utility', powerRadius: 6, baseProduction: 10,
  },
  wall: {
    id: 13, name: '방벽', volume: 1, footprint: [1, 1],
    desc: '주변 국가의 침입을 막는 방어 구조물.',
    baseCost: { stone: 20 }, maxLevel: 5, upgradeCostMul: 1.4,
    category: 'military', defense: 10,
  },
  turret: {
    id: 14, name: '터렛', volume: 1, footprint: [1, 1],
    desc: '주위의 적대적 물체를 파괴합니다.',
    baseCost: { iron_ingot: 20, copper_ingot: 10 }, maxLevel: 5, upgradeCostMul: 1.6,
    category: 'military', attack: 8, range: 3,
  },
  outpost: {
    id: 15, name: '전초기지', volume: 4, footprint: [2, 2],
    desc: '군사력을 생산합니다.',
    baseCost: { wood: 50, iron_ingot: 30 }, maxLevel: 5, upgradeCostMul: 1.7,
    category: 'military', baseProduction: 1,
  },
  lab: {
    id: 16, name: '연구소', volume: 4, footprint: [2, 2],
    desc: '새로운 구조물을 해금할 수 있게 합니다.',
    baseCost: { wood: 40, gold_ingot: 10 }, maxLevel: 5, upgradeCostMul: 1.8,
    category: 'utility',
  },
  belt: {
    id: 17, name: '컨베이어 벨트', volume: 1, footprint: [1, 1],
    desc: '자원을 다른 구조물로 이동시킵니다.',
    baseCost: { iron_ingot: 2 }, maxLevel: 3, upgradeCostMul: 1.3,
    category: 'utility',
  },
};

// ---- 기본으로 해금된 구조물 (연구소 없이도 지을 수 있는 최소 세트) ----
export const BASE_UNLOCKED = ['capital', 'hub', 'mine', 'belt', 'wall', 'lab'];

// ---- 전력이 필요한 카테고리 ----
// 발전소 공급 범위 밖이면 아래 카테고리의 구조물은 가동을 멈춘다 (idle).
// core/utility(발전소 자신, 중심지, 수도, 연구소, 벨트)는 전력 없이도 동작.
export const POWER_REQUIRED_CATEGORIES = new Set(['extraction', 'production', 'military']);

// ---- 컨베이어 벨트 ----
// 방향: 0=동(E) 1=남(S) 2=서(W) 3=북(N)
export const DIR_VECT = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const DIR_ARROW = ['→', '↓', '←', '↑'];
export function beltThroughput(level) { return 10 * level; }

// ---- 연구소 기술 트리 ----
// requires: 선행 연구(구조물 key) 배열. cost: 연구 자원 소모. time: 필요 틱 수.
export const TECH_TREE = {
  smelter:        { cost: { wood: 30, stone: 20 },          time: 3, requires: [] },
  oil_well:       { cost: { stone: 30, iron_ingot: 10 },     time: 3, requires: ['smelter'] },
  farm:           { cost: { wood: 30 },                      time: 2, requires: [] },
  barn:           { cost: { wood: 30, food: 10 },             time: 3, requires: ['farm'] },
  slaughterhouse: { cost: { wood: 20, iron_ingot: 10 },      time: 3, requires: ['barn'] },
  power_plant:    { cost: { stone: 40, iron_ingot: 20 },     time: 4, requires: ['smelter'] },
  factory:        { cost: { wood: 50, iron_ingot: 20 },      time: 5, requires: ['smelter', 'power_plant'] },
  refinery:       { cost: { stone: 40, iron_ingot: 20 },     time: 4, requires: ['oil_well'] },
  extractor:      { cost: { stone: 30, copper_ingot: 15 },   time: 4, requires: ['smelter'] },
  turret:         { cost: { iron_ingot: 20 },                time: 3, requires: ['smelter', 'power_plant'] },
  outpost:        { cost: { wood: 40, iron_ingot: 20 },      time: 4, requires: ['turret'] },
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

// 레벨에 따른 업그레이드 비용 계산
export function getUpgradeCost(structKey, currentLevel) {
  const def = STRUCTURES[structKey];
  if (!def) return null;
  if (currentLevel >= def.maxLevel) return null;
  const mul = Math.pow(def.upgradeCostMul, currentLevel);
  const cost = {};
  for (const [res, amt] of Object.entries(def.baseCost)) {
    cost[res] = Math.ceil(amt * mul);
  }
  return cost;
}

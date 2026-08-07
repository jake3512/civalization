// ============================================================
// achievements.js — 업적
//
// 게임이 요구하는 일들(수도를 올리고, 기술을 열고, 요리를 배우고, 여행을 가고,
// 병력을 길러 싸우는 것)마다 눈에 보이는 목표를 붙인다. 다섯 시간짜리 게임에서
// "지금 뭘 하고 있었지"를 잡아주는 이정표 역할이다.
//
// 규칙:
//   · 업적은 **보상을 주지 않는다.** 골드나 자원을 주면 5시간에 맞춰둔 진행
//     속도가 흐트러진다. 순수하게 "무엇을 해냈는가"의 기록이다.
//   · 한 번 달성하면 취소되지 않는다 (구조물을 철거해도 유지).
//   · 판정은 nation 상태와 누적 기록(nation.stats, logic.bumpStat)만 본다.
//     그래서 저장/불러오기를 거쳐도 그대로 이어진다.
//
// 각 항목: { key, group, name, desc, goal, value(nation) }
//   value()가 goal 이상이면 달성. 진행도 막대는 value/goal로 그린다.
// ============================================================
import { STRUCTURES, TECH_TREE, EXPEDITIONS, RESOURCES } from './data.js';
import { getCapitalLevel } from './logic.js';

const stat = (n, key) => (n.stats && n.stats[key]) || 0;
const countStructs = (n, fn) => n.structures.filter(fn).length;
const dishCount = (n) => Array.from(n.unlockedGoods || []).filter(k => k.startsWith('dish:')).length;
/** 조리소가 만들 수 있는 요리 전체 수 */
const ALL_DISHES = Object.keys(STRUCTURES.kitchen.recipes).length;

export const ACH_GROUPS = [
  { key: 'build',  name: '건설' },
  { key: 'econ',   name: '생산·경제' },
  { key: 'tech',   name: '연구' },
  { key: 'food',   name: '요리·여행' },
  { key: 'war',    name: '전쟁' },
];

export const ACHIEVEMENTS = [
  // ---- 건설 ----
  { key: 'found',       group: 'build', name: '건국',           desc: '수도를 세운다',                    goal: 1,
    value: (n) => n.structures.some(s => s.key === 'capital') ? 1 : 0 },
  { key: 'build_10',    group: 'build', name: '기틀',           desc: '구조물 10동을 짓는다',             goal: 10,  value: (n) => stat(n, 'built') },
  { key: 'build_50',    group: 'build', name: '도시',           desc: '구조물 50동을 짓는다',             goal: 50,  value: (n) => stat(n, 'built') },
  { key: 'build_150',   group: 'build', name: '대공업지대',     desc: '구조물 150동을 짓는다',            goal: 150, value: (n) => stat(n, 'built') },
  { key: 'cap_3',       group: 'build', name: '자리를 잡다',    desc: '수도를 3레벨로 올린다',            goal: 3,   value: getCapitalLevel },
  { key: 'cap_6',       group: 'build', name: '번영',           desc: '수도를 6레벨로 올린다',            goal: 6,   value: getCapitalLevel },
  { key: 'cap_10',      group: 'build', name: '제국',           desc: '수도를 10레벨(최대)로 올린다',     goal: 10,  value: getCapitalLevel },
  { key: 'hub_3',       group: 'build', name: '영토 확장',      desc: '중심지 3개로 땅을 넓힌다',         goal: 3,
    value: (n) => countStructs(n, s => s.key === 'hub') },
  { key: 'demolish',    group: 'build', name: '재정비',         desc: '구조물을 철거해 자리를 바꾼다',    goal: 1,   value: (n) => stat(n, 'demolished') },

  // ---- 생산·경제 ----
  { key: 'warehouse_5', group: 'econ',  name: '보관의 기술',    desc: '창고 5동을 짓는다',                goal: 5,
    value: (n) => countStructs(n, s => s.key === 'warehouse') },
  { key: 'belt_20',     group: 'econ',  name: '흐르는 공장',    desc: '컨베이어를 20칸 깐다',             goal: 20,
    value: (n) => countStructs(n, s => STRUCTURES[s.key]?.beltKind || s.key === 'belt') },
  { key: 'splitter',    group: 'econ',  name: '갈래길',         desc: '분할 컨베이어를 설치한다',         goal: 1,
    value: (n) => countStructs(n, s => s.key === 'belt_splitter') },
  { key: 'power',       group: 'econ',  name: '전력망',         desc: '발전소를 세운다',                  goal: 1,
    value: (n) => countStructs(n, s => s.key === 'power_plant') },
  { key: 'res_20',      group: 'econ',  name: '자원 수집가',    desc: '자원 20종을 생산해 본다',          goal: 20,
    value: (n) => (n.stats?.produced || []).length },
  { key: 'res_50',      group: 'econ',  name: '만물상',         desc: '자원 50종을 생산해 본다',          goal: 50,
    value: (n) => (n.stats?.produced || []).length },
  { key: 'res_all',     group: 'econ',  name: '없는 게 없다',   desc: `자원 ${Math.floor(Object.keys(RESOURCES).length * 0.8)}종을 생산해 본다`,
    goal: Math.floor(Object.keys(RESOURCES).length * 0.8), value: (n) => (n.stats?.produced || []).length },
  { key: 'gold_5k',     group: 'econ',  name: '장사꾼',         desc: '판매로 골드 5,000을 번다',         goal: 5000, value: (n) => stat(n, 'goldEarned') },
  { key: 'manual',      group: 'econ',  name: '맨손으로',       desc: '수동 운용으로 자원을 뽑아본다',    goal: 1,   value: (n) => stat(n, 'manualOps') },

  // ---- 연구 ----
  { key: 'tech_1',      group: 'tech',  name: '첫 연구',        desc: '연구를 1개 마친다',                goal: 1,
    value: (n) => techDone(n) },
  { key: 'tech_10',     group: 'tech',  name: '기술 개발',      desc: '연구를 10개 마친다',               goal: 10,  value: (n) => techDone(n) },
  { key: 'tech_all',    group: 'tech',  name: '최종 테크',      desc: `연구 ${Object.keys(TECH_TREE).length}개를 전부 마친다`,
    goal: Object.keys(TECH_TREE).length, value: (n) => techDone(n) },
  { key: 'smelter',     group: 'tech',  name: '제련의 시작',    desc: '제련소를 해금한다',                goal: 1,
    value: (n) => n.unlocked.has('smelter') ? 1 : 0 },
  { key: 'refinery',    group: 'tech',  name: '정유',           desc: '정제소를 해금한다',                goal: 1,
    value: (n) => n.unlocked.has('refinery') ? 1 : 0 },

  // ---- 요리·여행 ----
  { key: 'trip_1',      group: 'food',  name: '첫 여행',        desc: '여행을 한 번 다녀온다',            goal: 1,   value: (n) => stat(n, 'expeditions') },
  { key: 'trip_10',     group: 'food',  name: '방랑자',         desc: `여행을 ${Object.keys(EXPEDITIONS).length}번 다녀온다`,
    goal: Object.keys(EXPEDITIONS).length, value: (n) => stat(n, 'expeditions') },
  { key: 'dish_5',      group: 'food',  name: '요리 견습',      desc: '요리법 5종을 배운다',              goal: 5,   value: dishCount },
  { key: 'dish_20',     group: 'food',  name: '주방장',         desc: '요리법 20종을 배운다',             goal: 20,  value: dishCount },
  { key: 'dish_all',    group: 'food',  name: '왕실 주방장',    desc: `요리법 ${ALL_DISHES}종을 전부 배운다`,
    goal: ALL_DISHES, value: dishCount },
  { key: 'cook_100',    group: 'food',  name: '불 앞에서',      desc: '조리소를 100번 돌린다',            goal: 100, value: (n) => stat(n, 'cooked') },
  { key: 'farm',        group: 'food',  name: '농사꾼',         desc: '농지를 세워 인력을 기른다',        goal: 1,
    value: (n) => countStructs(n, s => s.key === 'farm') },

  // ---- 전쟁 ----
  { key: 'recruit_1',   group: 'war',   name: '첫 모병',        desc: '병력을 모집한다',                  goal: 1,   value: (n) => stat(n, 'recruited') },
  { key: 'recruit_50',  group: 'war',   name: '상비군',         desc: '병력을 50기 모집한다',             goal: 50,  value: (n) => stat(n, 'recruited') },
  { key: 'turret_5',    group: 'war',   name: '방어선',         desc: '방어 시설 5동을 세운다',           goal: 5,
    value: (n) => countStructs(n, s => STRUCTURES[s.key]?.category === 'turret' || s.key === 'wall') },
  { key: 'raid_1',      group: 'war',   name: '첫 습격',        desc: '다른 국가를 공격해 이긴다',        goal: 1,   value: (n) => stat(n, 'raidsWon') },
  { key: 'raid_10',     group: 'war',   name: '정복자',         desc: '습격에서 10번 이긴다',             goal: 10,  value: (n) => stat(n, 'raidsWon') },
  { key: 'perfect',     group: 'war',   name: '완벽한 승리',    desc: '적 수도까지 부순다',               goal: 1,   value: (n) => stat(n, 'perfectWins') },
  { key: 'defend',      group: 'war',   name: '굳건한 방어',    desc: '습격을 막아낸다',                  goal: 1,   value: (n) => stat(n, 'defensesWon') },
  { key: 'trophy_200',  group: 'war',   name: '이름을 알리다',  desc: '트로피 200을 모은다',              goal: 200, value: (n) => n.trophies || 0 },
  { key: 'loot_1k',     group: 'war',   name: '약탈자',         desc: '약탈로 자원 1,000을 가져온다',     goal: 1000, value: (n) => stat(n, 'looted') },
];

/** 완료한 연구 수 — 시작부터 열려 있던 구조물은 빼고 센다 */
function techDone(nation) {
  return Object.keys(TECH_TREE).filter(k => nation.unlocked.has(k)).length;
}

export const ACH_BY_KEY = Object.fromEntries(ACHIEVEMENTS.map(a => [a.key, a]));

/** 지금 상태에서 각 업적의 진행도 (달성 여부 포함) */
export function achievementProgress(nation, a) {
  const done = (nation.achievements || []).includes(a.key);
  const value = Math.max(0, Math.min(a.goal, Math.floor(a.value(nation) || 0)));
  return { done, value, goal: a.goal, ratio: a.goal ? value / a.goal : 0 };
}

/**
 * 새로 달성한 업적을 찾아 nation.achievements에 넣고, 그 목록을 돌려준다.
 * 매 틱 부르는 함수라 가볍게 유지한다 (판정 40개 남짓, 전부 단순 계산).
 */
export function checkAchievements(nation) {
  if (!nation) return [];
  nation.achievements = nation.achievements || [];
  const earned = [];
  for (const a of ACHIEVEMENTS) {
    if (nation.achievements.includes(a.key)) continue;
    let v = 0;
    try { v = a.value(nation) || 0; } catch { v = 0; }
    if (v >= a.goal) {
      nation.achievements.push(a.key);
      earned.push(a);
    }
  }
  return earned;
}

/** 달성 수 / 전체 수 */
export function achievementScore(nation) {
  const done = (nation?.achievements || []).length;
  return { done, total: ACHIEVEMENTS.length };
}

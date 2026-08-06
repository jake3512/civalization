// ============================================================
// game.js — Nation(국가) 상태 컨테이너.
// 실제 판정/시뮬레이션 로직은 logic.js · simulate.js에 있으며,
// 이 파일은 그 함수들을 호출하고 상태를 보관/직렬화하는 역할만 한다.
// (오프라인 모드에서는 이 파일이 곧 "서버"이고, 온라인 모드에서는
//  Cloud Functions의 functions/shared/{logic,simulate}.js가 동일한
//  코드로 같은 역할을 서버에서 수행한다.)
// ============================================================
import { STRUCTURES, BASE_UNLOCKED, WAR } from './data.js';
import * as logic from './logic.js';
import { tickNation } from './simulate.js';

const TICK_MS = 2000; // 자원 생산 주기

/** 새 국가를 생성하고 수도를 자동 배치한다. (클라이언트 오프라인 모드 / Cloud Functions 양쪽에서 재사용) */
export function createNation(id, name, color, capitalX, capitalY) {
  const n = new Nation({ id, name, color, capitalX, capitalY });
  // 수도는 비용이 없지만 입지 요건(주변 영토에 숲·채석장)이 있으므로 실패할 수 있다.
  // 조용히 넘기면 수도 없는 국가가 만들어지므로 반드시 에러로 알린다.
  const res = logic.build(n, 'capital', capitalX, capitalY);
  if (!res.ok) throw new Error(res.error);
  // 시작 자원은 수도의 보관함에 들어간다 (국고 표시는 창고·수도 재고의 합계라서,
  // 어딘가에 실물로 담겨 있지 않으면 존재하지 않는 것과 같다)
  logic.depositInto(res.structure, 'wood', 100);
  logic.depositInto(res.structure, 'stone', 100);
  logic.recomputeStock(n);
  n.shieldUntil = Date.now() + WAR.starterShieldMs; // 건국 직후 보호막 (COC 신규 유저 보호막과 동일한 취지)
  return n;
}

export class Nation {
  constructor({ id, name, color, capitalX, capitalY }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.capital = { x: capitalX, y: capitalY };
    this.structures = [];
    this.territory = new Set();
    this.resources = {}; // 실물 자원은 창고·수도 재고에서 집계된다 (logic.recomputeStock)
    this.nextStructId = 1;
    this.unlocked = new Set(BASE_UNLOCKED);
    this.research = null;
    this.expedition = null;            // 진행 중인 여행 { key, ticksLeft }
    this.unlockedGoods = new Set();    // 여행으로 얻은 작물/가축/요리법 ('crop:wheat' 등)
    this.lastExpedition = null;        // 방금 끝난 여행 결과 (UI 알림용)
    this.trophies = 0;
    this.shieldUntil = 0; // 타임스탬프(ms). 이 값이 현재 시각보다 크면 보호막 활성.
    this.units = { attack: {}, defense: {} }; // 무장 완료된 병력 로스터 (unitKey -> 보유 수)
  }

  isOwned(x, y) { return this.territory.has(logic.tileKey(x, y)); }

  build(structKey, x, y, dir = 0) {
    const res = logic.build(this, structKey, x, y, dir);
    return res.ok ? null : res.error;
  }
  upgrade(structId) {
    const res = logic.upgrade(this, structId);
    return res.ok ? null : res.error;
  }
  setRecipe(structId, recipeKey) {
    const res = logic.setRecipe(this, structId, recipeKey);
    return res.ok ? null : res.error;
  }
  startResearch(structKey) {
    const res = logic.startResearch(this, structKey);
    return res.ok ? null : res.error;
  }
  recruitUnit(structId, unitKey, isDefense) {
    const res = logic.recruitUnit(this, structId, unitKey, isDefense);
    return res.ok ? null : res.error;
  }
  setCrop(structId, cropKey) {
    const res = logic.setCrop(this, structId, cropKey);
    return res.ok ? null : res.error;
  }
  setAnimal(structId, animalKey) {
    const res = logic.setAnimal(this, structId, animalKey);
    return res.ok ? null : res.error;
  }
  startExpedition(key) {
    const res = logic.startExpedition(this, key);
    return res.ok ? null : res.error;
  }
  getDefensePower() { return logic.getDefensePower(this); }
  isShielded(now) { return logic.isShielded(this, now); }

  tick() { tickNation(this); }

  toJSON() {
    return {
      id: this.id, name: this.name, color: this.color, capital: this.capital,
      structures: this.structures, territory: Array.from(this.territory),
      resources: this.resources, unlocked: Array.from(this.unlocked),
      research: this.research,
      expedition: this.expedition, unlockedGoods: Array.from(this.unlockedGoods),
      lastExpedition: this.lastExpedition,
      trophies: this.trophies, shieldUntil: this.shieldUntil, units: this.units,
    };
  }

  static fromJSON(data) {
    const n = new Nation({ id: data.id, name: data.name, color: data.color, capitalX: data.capital.x, capitalY: data.capital.y });
    n.structures = data.structures || [];
    n.territory = new Set(data.territory || []);
    n.resources = data.resources || {};
    n.unlocked = new Set(data.unlocked || BASE_UNLOCKED);
    n.research = data.research || null;
    n.expedition = data.expedition || null;
    n.unlockedGoods = new Set(data.unlockedGoods || []);
    n.lastExpedition = data.lastExpedition || null;
    n.trophies = data.trophies || 0;
    n.shieldUntil = data.shieldUntil || 0;
    n.units = data.units || { attack: {}, defense: {} };
    n.nextStructId = (n.structures.reduce((m, s) => Math.max(m, s.id), 0)) + 1;
    return n;
  }
}

export class Game {
  constructor() {
    this.myNation = null;
    this.otherNations = new Map();
    this.onTick = null;
    this._timer = null;
    this.serverAuthoritative = false;
  }

  startNation(name, color, capitalX, capitalY) {
    const id = 'local-' + Math.random().toString(36).slice(2, 9);
    this.myNation = createNation(id, name, color, capitalX, capitalY);
    return this.myNation;
  }

  startLoop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (this.myNation && !this.serverAuthoritative) this.myNation.tick();
      if (this.onTick) this.onTick();
    }, TICK_MS);
  }

  stopLoop() {
    if (this._timer) clearInterval(this._timer);
  }
}

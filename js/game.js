// ============================================================
// game.js — Nation(국가) 상태 컨테이너.
// 실제 판정/시뮬레이션 로직은 logic.js · simulate.js에 있으며,
// 이 파일은 그 함수들을 호출하고 상태를 보관/직렬화하는 역할만 한다.
// (오프라인 모드에서는 이 파일이 곧 "서버"이고, 온라인 모드에서는
//  Cloud Functions의 functions/shared/{logic,simulate}.js가 동일한
//  코드로 같은 역할을 서버에서 수행한다.)
// ============================================================
import { STRUCTURES, BASE_UNLOCKED, RAIDER } from './data.js';
import * as logic from './logic.js';
import { tickNation } from './simulate.js';

const TICK_MS = 2000; // 자원 생산 주기

/** 새 국가를 생성하고 수도를 자동 배치한다. (클라이언트 오프라인 모드 / Cloud Functions 양쪽에서 재사용) */
export function createNation(id, name, color, capitalX, capitalY) {
  const n = new Nation({ id, name, color, capitalX, capitalY });
  n.territory.add(logic.tileKey(capitalX, capitalY));
  logic.build(n, 'capital', capitalX, capitalY); // 비용 없음 → 항상 성공
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
    this.resources = { wood: 100, stone: 100 };
    this.nextStructId = 1;
    this.unlocked = new Set(BASE_UNLOCKED);
    this.research = null;
    this.raiders = [];
    this.capitalHp = RAIDER.capitalMaxHp;
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
  militaryPower() { return logic.militaryPower(this); }

  tick() { tickNation(this); }

  toJSON() {
    return {
      id: this.id, name: this.name, color: this.color, capital: this.capital,
      structures: this.structures, territory: Array.from(this.territory),
      resources: this.resources, unlocked: Array.from(this.unlocked),
      research: this.research, raiders: this.raiders, capitalHp: this.capitalHp,
    };
  }

  static fromJSON(data) {
    const n = new Nation({ id: data.id, name: data.name, color: data.color, capitalX: data.capital.x, capitalY: data.capital.y });
    n.structures = data.structures || [];
    n.territory = new Set(data.territory || []);
    n.resources = data.resources || {};
    n.unlocked = new Set(data.unlocked || BASE_UNLOCKED);
    n.research = data.research || null;
    n.raiders = data.raiders || [];
    n.capitalHp = data.capitalHp ?? RAIDER.capitalMaxHp;
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

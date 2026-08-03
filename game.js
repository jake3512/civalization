// ============================================================
// game.js — 게임 상태(국가/건설/자원/영토)와 틱 로직
// ============================================================
import { STRUCTURES, RESOURCES, getUpgradeCost } from './data.js';
import { getTile, isAdjacentToWater } from './world.js';

const TICK_MS = 2000; // 자원 생산 주기

export class Nation {
  constructor({ id, name, color, capitalX, capitalY }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.capital = { x: capitalX, y: capitalY };
    this.structures = [];      // { key, x, y, level, id, progress? }
    this.territory = new Set();// "x,y" 문자열 집합
    this.resources = { wood: 100, stone: 100 }; // 시작 자원
    this.nextStructId = 1;
    this.unlocked = new Set(['capital', 'hub', 'mine', 'belt', 'wall']); // 연구소로 해금되는 기본셋
  }

  tileKey(x, y) { return `${x},${y}`; }

  isOwned(x, y) { return this.territory.has(this.tileKey(x, y)); }

  addTerritory(cx, cy, radius) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (Math.hypot(x - cx, y - cy) <= radius) {
          this.territory.add(this.tileKey(x, y));
        }
      }
    }
  }

  canAfford(cost) {
    return Object.entries(cost).every(([res, amt]) => (this.resources[res] || 0) >= amt);
  }

  pay(cost) {
    for (const [res, amt] of Object.entries(cost)) {
      this.resources[res] = (this.resources[res] || 0) - amt;
    }
  }

  footprintTiles(x, y, footprint) {
    const [w, h] = footprint;
    const tiles = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) tiles.push([x + dx, y + dy]);
    }
    return tiles;
  }

  isAreaFree(x, y, footprint) {
    return this.footprintTiles(x, y, footprint).every(([tx, ty]) => {
      if (!this.isOwned(tx, ty)) return false;
      return !this.structures.some(s => {
        const sd = STRUCTURES[s.key];
        return this.footprintTiles(s.x, s.y, sd.footprint)
          .some(([sx, sy]) => sx === tx && sy === ty);
      });
    });
  }

  /**
   * 구조물 건설 시도. reason이 있으면 실패 사유 문자열 반환, 성공 시 null.
   */
  build(structKey, x, y) {
    const def = STRUCTURES[structKey];
    if (!def) return '알 수 없는 구조물';
    if (!this.unlocked.has(structKey)) return '연구소에서 아직 해금되지 않았습니다';
    if (!this.isAreaFree(x, y, def.footprint)) return '이 위치에는 건설할 수 없습니다 (영토 밖이거나 이미 점유됨)';

    if (def.requiresNode) {
      const t = getTile(x, y);
      if (!def.requiresNode.includes(t.terrain)) {
        return `이 구조물은 [${def.requiresNode.join(', ')}] 지형 위에만 설치할 수 있습니다`;
      }
    }
    if (def.requiresAdjacent === 'water') {
      const [w, h] = def.footprint;
      if (!isAdjacentToWater(x, y, w, h)) return '농지는 물(강/호수) 옆에만 설치할 수 있습니다';
    }
    if (!this.canAfford(def.baseCost)) return '자원이 부족합니다';

    this.pay(def.baseCost);
    const struct = { id: this.nextStructId++, key: structKey, x, y, level: 1, recipe: null };
    this.structures.push(struct);

    // 중심지는 건설 즉시 주변 영토를 편입
    if (structKey === 'hub') this.addTerritory(x, y, def.territoryRadius);
    if (structKey === 'capital') this.addTerritory(x, y, 3);

    return null;
  }

  upgrade(structId) {
    const s = this.structures.find(s => s.id === structId);
    if (!s) return '구조물을 찾을 수 없습니다';
    const cost = getUpgradeCost(s.key, s.level);
    if (!cost) return '더 이상 레벨을 올릴 수 없습니다 (최대 레벨)';
    if (!this.canAfford(cost)) return '자원이 부족합니다';
    this.pay(cost);
    s.level += 1;
    if (s.key === 'hub') {
      const def = STRUCTURES.hub;
      this.addTerritory(s.x, s.y, def.territoryRadius + s.level - 1);
    }
    return null;
  }

  setRecipe(structId, recipeKey) {
    const s = this.structures.find(s => s.id === structId);
    if (!s) return '구조물을 찾을 수 없습니다';
    const def = STRUCTURES[s.key];
    if (!def.recipes || !def.recipes[recipeKey]) return '올바르지 않은 레시피';
    s.recipe = recipeKey;
    return null;
  }

  // 국가의 총 군사력 (전쟁 판정에 사용)
  militaryPower() {
    return this.structures.reduce((sum, s) => {
      const def = STRUCTURES[s.key];
      if (def.category === 'military') return sum + (def.attack || def.defense || def.baseProduction || 1) * s.level;
      return sum;
    }, 0);
  }

  // 한 틱(생산 주기) 진행 — 광산/유전/추출기/농지/축사 등 자원 생산, 제련소/정제소/도축장 가공
  tick() {
    for (const s of this.structures) {
      const def = STRUCTURES[s.key];
      switch (def.category) {
        case 'extraction': {
          const t = getTile(s.x, s.y);
          if (t.node) {
            const amt = def.baseProduction * s.level;
            this.resources[t.node.yields] = (this.resources[t.node.yields] || 0) + amt;
          }
          break;
        }
        case 'production': {
          if (def.recipes && s.recipe) {
            const r = def.recipes[s.recipe];
            const inputsOk = Object.entries(r.in).every(([res, amt]) => (this.resources[res] || 0) >= amt * s.level);
            if (inputsOk) {
              for (const [res, amt] of Object.entries(r.in)) this.resources[res] -= amt * s.level;
              if (typeof r.out === 'number') {
                // 단일 출력 (제련소 등 key가 곧 자원명)
                const outRes = s.recipe;
                this.resources[outRes] = (this.resources[outRes] || 0) + r.out * s.level;
              } else {
                for (const [res, amt] of Object.entries(r.out)) {
                  this.resources[res] = (this.resources[res] || 0) + amt * s.level;
                }
              }
            }
          } else if (def.baseProduction && s.key === 'farm') {
            this.resources.food = (this.resources.food || 0) + def.baseProduction * s.level;
          } else if (def.baseProduction && s.key === 'barn') {
            this.resources.livestock = (this.resources.livestock || 0) + def.baseProduction * s.level;
          }
          break;
        }
        case 'utility': {
          if (s.key === 'power_plant') {
            const fuel = (this.resources.wood >= 2) ? 'wood' : (this.resources.petroleum >= 1 ? 'petroleum' : null);
            if (fuel) {
              this.resources[fuel] -= fuel === 'wood' ? 2 : 1;
              this.resources.electricity = (this.resources.electricity || 0) + def.baseProduction * s.level;
            }
          }
          break;
        }
        case 'military': {
          if (s.key === 'outpost') {
            this.resources.military = (this.resources.military || 0) + def.baseProduction * s.level;
          }
          break;
        }
      }
    }
  }

  toJSON() {
    return {
      id: this.id, name: this.name, color: this.color, capital: this.capital,
      structures: this.structures, territory: Array.from(this.territory),
      resources: this.resources, unlocked: Array.from(this.unlocked),
    };
  }

  static fromJSON(data) {
    const n = new Nation({ id: data.id, name: data.name, color: data.color, capitalX: data.capital.x, capitalY: data.capital.y });
    n.structures = data.structures || [];
    n.territory = new Set(data.territory || []);
    n.resources = data.resources || {};
    n.unlocked = new Set(data.unlocked || ['capital', 'hub', 'mine', 'belt', 'wall']);
    n.nextStructId = (n.structures.reduce((m, s) => Math.max(m, s.id), 0)) + 1;
    return n;
  }
}

export class Game {
  constructor() {
    this.myNation = null;
    this.otherNations = new Map(); // id -> Nation (읽기 전용 사본)
    this.onTick = null;
    this._timer = null;
  }

  startNation(name, color, capitalX, capitalY) {
    const id = 'local-' + Math.random().toString(36).slice(2, 9);
    this.myNation = new Nation({ id, name, color, capitalX, capitalY });
    // 수도 자동 배치
    this.myNation.addTerritory(capitalX, capitalY, 3);
    this.myNation.structures.push({ id: 0, key: 'capital', x: capitalX, y: capitalY, level: 1, recipe: null });
    return this.myNation;
  }

  startLoop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (this.myNation) this.myNation.tick();
      if (this.onTick) this.onTick();
    }, TICK_MS);
  }

  stopLoop() {
    if (this._timer) clearInterval(this._timer);
  }
}

// ============================================================
// battleRender.js — 실시간 습격 전투 화면 캔버스 렌더링
// (js/render.js와 같은 팬/줌 관례를 따르되, 전투 세션(battle.js) 상태를 그린다)
// ============================================================
import { getTileRange } from './world.js';
import { STRUCTURES, UNITS } from './data.js';
import { tileKey } from './logic.js';

const TERRAIN_COLORS = { plain: '#1a201c', water: '#15303a' };

export class BattleRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tile = 20;
    this.originX = 0;
    this.originY = 0;
    this.hover = null;

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, -Math.sign(e.deltaY) * 2);
    }, { passive: false });
  }

  zoomAt(screenX, screenY, deltaTile) {
    const old = this.tile;
    this.tile = Math.min(40, Math.max(8, this.tile + deltaTile));
    const wx = this.originX + screenX / old, wy = this.originY + screenY / old;
    this.originX = wx - screenX / this.tile;
    this.originY = wy - screenY / this.tile;
  }

  resize() {
    const parent = this.canvas.parentElement;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
  }

  screenToWorld(px, py) {
    return { x: this.originX + px / this.tile, y: this.originY + py / this.tile };
  }

  pan(dx, dy) {
    this.originX -= dx / this.tile;
    this.originY -= dy / this.tile;
  }

  centerOn(x, y) {
    this.originX = x - this.canvas.width / this.tile / 2;
    this.originY = y - this.canvas.height / this.tile / 2;
  }

  draw(session) {
    const { ctx, canvas, tile } = this;
    ctx.fillStyle = '#0c0f0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!session) return;

    const x0 = Math.floor(this.originX), y0 = Math.floor(this.originY);
    const x1 = x0 + Math.ceil(canvas.width / tile) + 1;
    const y1 = y0 + Math.ceil(canvas.height / tile) + 1;
    const tiles = getTileRange(x0, y0, x1, y1);

    for (const t of tiles) {
      const sx = (t.x - this.originX) * tile;
      const sy = (t.y - this.originY) * tile;
      ctx.fillStyle = TERRAIN_COLORS[t.terrain] || TERRAIN_COLORS.plain;
      ctx.fillRect(sx, sy, tile, tile);

      const inTerritory = session.territorySet.has(tileKey(t.x, t.y));
      ctx.fillStyle = inTerritory ? 'rgba(193,68,60,0.10)' : 'rgba(74,157,143,0.06)';
      ctx.fillRect(sx, sy, tile, tile);

      if (tile >= 14) {
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.strokeRect(sx, sy, tile, tile);
      }
    }

    this._drawStructures(session);
    this._drawUnits(session.defenders, '#c1443c');
    this._drawUnits(session.attackers, '#4a9d8f');

    if (this.hover) {
      const sx = (this.hover.x - this.originX) * tile;
      const sy = (this.hover.y - this.originY) * tile;
      const allowed = !session.territorySet.has(tileKey(Math.floor(this.hover.x), Math.floor(this.hover.y)));
      ctx.strokeStyle = allowed ? '#4a9d8f' : '#c1443c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, tile * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawStructures(session) {
    const { ctx, tile } = this;
    for (const s of session.structures) {
      const def = STRUCTURES[s.key];
      const [w, h] = def.footprint;
      const sx = (s.x - this.originX) * tile;
      const sy = (s.y - this.originY) * tile;
      const isTurret = def.category === 'turret';

      if (!s.alive) {
        ctx.fillStyle = 'rgba(60,60,60,0.5)';
        ctx.fillRect(sx + 1, sy + 1, w * tile - 2, h * tile - 2);
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
        ctx.strokeRect(sx + 1, sy + 1, w * tile - 2, h * tile - 2);
        if (tile >= 16) {
          ctx.strokeStyle = '#a33'; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx + 3, sy + 3); ctx.lineTo(sx + w * tile - 3, sy + h * tile - 3);
          ctx.moveTo(sx + w * tile - 3, sy + 3); ctx.lineTo(sx + 3, sy + h * tile - 3);
          ctx.stroke();
        }
        continue;
      }

      const unpowered = isTurret && !s.powered;
      ctx.fillStyle = unpowered ? '#5a4030' : '#8a3530';
      ctx.fillRect(sx + 1, sy + 1, w * tile - 2, h * tile - 2);
      ctx.strokeStyle = unpowered ? '#c1443c' : '#2a1210';
      ctx.lineWidth = unpowered ? 2 : 1;
      ctx.strokeRect(sx + 1, sy + 1, w * tile - 2, h * tile - 2);

      if (tile >= 16) {
        ctx.fillStyle = '#f0e8de';
        ctx.font = `bold ${Math.max(9, tile * 0.3)}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${def.name[0]}${s.level}`, sx + (w * tile) / 2, sy + (h * tile) / 2 + 2);
      }
      this._drawHpBar(sx + 2, sy - 5, w * tile - 4, s.hp, s.maxHp);
    }
  }

  _drawUnits(list, color) {
    const { ctx, tile } = this;
    for (const u of list) {
      if (!u.alive) continue;
      const sx = (u.x - this.originX) * tile;
      const sy = (u.y - this.originY) * tile;
      const r = Math.max(3, tile * 0.24);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
      ctx.stroke();
      this._drawHpBar(sx - r, sy - r - 6, r * 2, u.hp, u.maxHp);
    }
  }

  _drawHpBar(x, y, w, hp, maxHp) {
    const { ctx } = this;
    const ratio = Math.max(0, hp / maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = ratio > 0.4 ? '#4a9d5f' : '#c1443c';
    ctx.fillRect(x, y, w * ratio, 3);
  }
}

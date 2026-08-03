// ============================================================
// render.js — 캔버스에 격자 필드, 지형, 영토, 구조물을 그린다
// ============================================================
import { getTileRange } from './world.js';
import { STRUCTURES, TERRAIN_NODES } from './data.js';

const TERRAIN_COLORS = {
  plain: '#232a24',
  water: '#1c3b45',
};

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.tile = 22;          // 타일 픽셀 크기 (줌)
    this.originX = 0;        // 카메라 좌상단 월드 좌표
    this.originY = 0;
    this.hover = null;

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const old = this.tile;
      this.tile = Math.min(48, Math.max(8, this.tile - Math.sign(e.deltaY) * 2));
      // 마우스 위치 기준 줌
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const wx = this.originX + mx / old, wy = this.originY + my / old;
      this.originX = wx - mx / this.tile;
      this.originY = wy - my / this.tile;
    }, { passive: false });
  }

  resize() {
    const parent = this.canvas.parentElement;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
  }

  screenToWorld(px, py) {
    return { x: Math.floor(this.originX + px / this.tile), y: Math.floor(this.originY + py / this.tile) };
  }

  pan(dx, dy) {
    this.originX -= dx / this.tile;
    this.originY -= dy / this.tile;
  }

  centerOn(x, y) {
    this.originX = x - this.canvas.width / this.tile / 2;
    this.originY = y - this.canvas.height / this.tile / 2;
  }

  draw() {
    const { ctx, canvas, tile } = this;
    ctx.fillStyle = '#101512';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const x0 = Math.floor(this.originX), y0 = Math.floor(this.originY);
    const x1 = x0 + Math.ceil(canvas.width / tile) + 1;
    const y1 = y0 + Math.ceil(canvas.height / tile) + 1;
    const tiles = getTileRange(x0, y0, x1, y1);

    const nation = this.game.myNation;

    for (const t of tiles) {
      const sx = (t.x - this.originX) * tile;
      const sy = (t.y - this.originY) * tile;
      const owned = nation && nation.isOwned(t.x, t.y);

      ctx.fillStyle = TERRAIN_COLORS[t.terrain] || TERRAIN_COLORS.plain;
      ctx.fillRect(sx, sy, tile, tile);

      if (owned) {
        ctx.fillStyle = 'rgba(217,142,52,0.14)';
        ctx.fillRect(sx, sy, tile, tile);
      }

      if (t.node) {
        ctx.font = `${tile * 0.62}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(t.node.icon, sx + tile / 2, sy + tile / 2);
      }

      if (tile >= 14) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.strokeRect(sx, sy, tile, tile);
      }
    }

    // 구조물 그리기
    if (nation) this._drawStructures(nation, '#d98e34');
    for (const other of this.game.otherNations.values()) this._drawStructures(other, '#c1443c');

    // 호버 하이라이트
    if (this.hover) {
      const sx = (this.hover.x - this.originX) * tile;
      const sy = (this.hover.y - this.originY) * tile;
      ctx.strokeStyle = '#f5d94e';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tile, tile);
    }
  }

  _drawStructures(nation, color) {
    const { ctx, tile } = this;
    for (const s of nation.structures) {
      const def = STRUCTURES[s.key];
      const [w, h] = def.footprint;
      const sx = (s.x - this.originX) * tile;
      const sy = (s.y - this.originY) * tile;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(sx + 1, sy + 1, w * tile - 2, h * tile - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#0d0d0d';
      ctx.strokeRect(sx + 1, sy + 1, w * tile - 2, h * tile - 2);
      if (tile >= 16) {
        ctx.fillStyle = '#12100c';
        ctx.font = `bold ${Math.max(9, tile * 0.32)}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${def.name[0]}${s.level}`, sx + (w * tile) / 2, sy + (h * tile) / 2);
      }
    }
  }
}

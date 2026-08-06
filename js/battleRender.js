// ============================================================
// battleRender.js — 실시간 습격 전투 화면 캔버스 렌더링
// (js/render.js와 같은 팬/줌 관례를 따르되, 전투 세션(battle.js) 상태를 그린다)
// ============================================================
import { getTileRange } from './world.js';
import { STRUCTURES, UNITS, structureIcon } from './data.js';
import { tileKey } from './logic.js';
import { TILT, getIconImage, structArtMetrics } from './render.js';

const TERRAIN_COLORS = { plain: '#1a201c', water: '#15303a' };

// 전투 화면도 필드와 같은 기울어진 카메라·크기 규칙을 쓴다 (화면이 바뀌어도 감각이 유지되도록)

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

  get tileY() { return this.tile * TILT; }
  proj(wx, wy) {
    return { sx: (wx - this.originX) * this.tile, sy: (wy - this.originY) * this.tileY };
  }

  zoomAt(screenX, screenY, deltaTile) {
    const oldX = this.tile, oldY = this.tileY;
    this.tile = Math.min(40, Math.max(8, this.tile + deltaTile));
    const wx = this.originX + screenX / oldX, wy = this.originY + screenY / oldY;
    this.originX = wx - screenX / this.tile;
    this.originY = wy - screenY / this.tileY;
  }

  resize() {
    const parent = this.canvas.parentElement;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
  }

  screenToWorld(px, py) {
    return { x: this.originX + px / this.tile, y: this.originY + py / this.tileY };
  }

  pan(dx, dy) {
    this.originX -= dx / this.tile;
    this.originY -= dy / this.tileY;
  }

  centerOn(x, y) {
    this.originX = x - this.canvas.width / this.tile / 2;
    this.originY = y - this.canvas.height / this.tileY / 2;
  }

  draw(session) {
    const { ctx, canvas, tile, tileY } = this;
    ctx.fillStyle = '#0c0f0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!session) return;

    const x0 = Math.floor(this.originX) - 1, y0 = Math.floor(this.originY) - 3;
    const x1 = x0 + Math.ceil(canvas.width / tile) + 2;
    const y1 = y0 + Math.ceil(canvas.height / tileY) + 6;
    const tiles = getTileRange(x0, y0, x1, y1);

    for (const t of tiles) {
      const { sx, sy } = this.proj(t.x, t.y);
      ctx.fillStyle = TERRAIN_COLORS[t.terrain] || TERRAIN_COLORS.plain;
      ctx.fillRect(sx, sy, tile + 0.5, tileY + 0.5);

      const inTerritory = session.territorySet.has(tileKey(t.x, t.y));
      ctx.fillStyle = inTerritory ? 'rgba(193,68,60,0.10)' : 'rgba(74,157,143,0.06)';
      ctx.fillRect(sx, sy, tile + 0.5, tileY + 0.5);

      if (tile >= 14) {
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.strokeRect(sx, sy, tile, tileY);
      }
    }

    // 구조물과 유닛을 깊이 순으로 섞어 그려야 앞의 것이 뒤의 것을 가린다
    const standing = [];
    for (const s of session.structures) standing.push({ depth: s.y + STRUCTURES[s.key].footprint[1], draw: () => this._drawStructure(s) });
    for (const u of session.defenders) if (u.alive) standing.push({ depth: u.y, draw: () => this._drawUnit(u, '#c1443c') });
    for (const u of session.attackers) if (u.alive) standing.push({ depth: u.y, draw: () => this._drawUnit(u, '#4a9d8f') });
    standing.sort((a, b) => a.depth - b.depth);
    for (const item of standing) item.draw();

    if (this.hover) {
      const { sx, sy } = this.proj(this.hover.x, this.hover.y);
      const allowed = !session.territorySet.has(tileKey(Math.floor(this.hover.x), Math.floor(this.hover.y)));
      ctx.strokeStyle = allowed ? '#4a9d8f' : '#c1443c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy, tile * 0.4, tileY * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 구조물 하나 — 필드와 같은 방식으로 받침 위에 그림을 세운다 */
  _drawStructure(s) {
    const { ctx, tile, tileY } = this;
    const def = STRUCTURES[s.key];
    const [w, h] = def.footprint;
    const { sx, sy } = this.proj(s.x, s.y);
    const bw = w * tile, bh = h * tileY;
    const { art, lift, footY } = structArtMetrics(tile, w, h, s.key);

    if (!s.alive) {
      // 파괴된 건물은 세우지 않고 잔해로 납작하게 남긴다
      ctx.fillStyle = 'rgba(60,60,60,0.5)';
      ctx.fillRect(sx + 1, sy + 1, bw - 2, bh - 2);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
      ctx.strokeRect(sx + 1, sy + 1, bw - 2, bh - 2);
      if (tile >= 16) {
        ctx.strokeStyle = '#a33'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx + 3, sy + 2); ctx.lineTo(sx + bw - 3, sy + bh - 2);
        ctx.moveTo(sx + bw - 3, sy + 2); ctx.lineTo(sx + 3, sy + bh - 2);
        ctx.stroke();
      }
      return;
    }

    const unpowered = def.category === 'turret' && !s.powered;
    ctx.fillStyle = unpowered ? '#3a2a1e' : '#5a2320';
    ctx.fillRect(sx, sy + bh - lift, bw, lift);              // 받침 앞면
    ctx.fillStyle = unpowered ? '#5a4030' : '#8a3530';
    ctx.fillRect(sx, sy - lift, bw, bh);                     // 받침 윗면

    const img = getIconImage(structureIcon(s.key));
    if (img.complete && img.naturalWidth > 0) {
      ctx.globalAlpha = unpowered ? 0.6 : 1;
      ctx.drawImage(img, sx + bw / 2 - art / 2, sy + footY - art, art, art);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = unpowered ? '#c1443c' : '#2a1210';
    ctx.lineWidth = unpowered ? 2 : 1;
    ctx.strokeRect(sx, sy - lift, bw, bh + lift);
    ctx.lineWidth = 1;

    this._drawHpBar(sx + 2, sy - lift - 6, bw - 4, s.hp, s.maxHp);
  }

  /** 유닛 하나 — 바닥 그림자 + 그 위에 뜬 몸통으로 서 있는 느낌을 준다 */
  _drawUnit(u, color) {
    const { ctx, tile, tileY } = this;
    const { sx, sy } = this.proj(u.x, u.y);
    const r = Math.max(3, tile * 0.24);
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.ellipse(sx, sy, r * 0.95, r * 0.95 * TILT, 0, 0, Math.PI * 2);
    ctx.fill();
    const bodyY = sy - r * 0.9;                 // 그림자 위로 띄운 몸통
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(sx, bodyY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
    this._drawHpBar(sx - r, bodyY - r - 6, r * 2, u.hp, u.maxHp);
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

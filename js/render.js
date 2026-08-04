// ============================================================
// render.js — 캔버스에 격자 필드, 지형, 영토, 구조물을 그린다
// ============================================================
import { getTileRange } from './world.js';
import { STRUCTURES, TERRAIN_NODES, DIR_ARROW } from './data.js';

const TERRAIN_COLORS = {
  plain: '#232a24',
  water: '#1c3b45',
};

// ---- 아이콘 이미지 캐시 ----
// data.js의 아이콘은 이제 이모지 문자가 아니라 assets/icons/*.svg 경로다.
// 캔버스에는 fillText 대신 미리 로드해 둔 Image를 drawImage로 그린다
// (로드 전 프레임엔 그냥 건너뛰고, 로드가 끝나면 다음 프레임부터 자동으로 그려짐).
const iconImageCache = new Map();
function getIconImage(src) {
  let img = iconImageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    iconImageCache.set(src, img);
  }
  return img;
}

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.tile = 22;          // 타일 픽셀 크기 (줌)
    this.originX = 0;        // 카메라 좌상단 월드 좌표
    this.originY = 0;
    this.hover = null;
    this.showPower = false;      // 전력 공급 범위 오버레이 토글
    this.placementMarker = null; // 수도 위치 선택 중 표시할 마커 { x, y }

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, -Math.sign(e.deltaY) * 2);
    }, { passive: false });
  }

  /** screenX/Y 지점을 고정한 채 tile 크기를 deltaTile만큼 바꾼다 (휠/핀치/버튼 공용) */
  zoomAt(screenX, screenY, deltaTile) {
    const old = this.tile;
    this.tile = Math.min(48, Math.max(6, this.tile + deltaTile));
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
        const img = getIconImage(t.node.icon);
        if (img.complete && img.naturalWidth > 0) {
          const pad = tile * 0.1;
          ctx.drawImage(img, sx + pad, sy + pad, tile - pad * 2, tile - pad * 2);
        }
      }

      if (tile >= 14) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.strokeRect(sx, sy, tile, tile);
      }
    }

    // 전력 공급 범위 오버레이 (P 키로 토글)
    if (this.showPower && nation) this._drawPowerOverlay(nation);

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

    // 수도 위치 선택 마커 (건국 전 단계)
    if (this.placementMarker) {
      const cx = (this.placementMarker.x + 1.5 - this.originX) * tile;
      const cy = (this.placementMarker.y + 1.5 - this.originY) * tile;
      ctx.strokeStyle = '#d98e34';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, tile * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - tile * 0.4, cy);
      ctx.lineTo(cx + tile * 0.4, cy);
      ctx.moveTo(cx, cy - tile * 0.4);
      ctx.lineTo(cx, cy + tile * 0.4);
      ctx.stroke();
    }
  }

  _drawStructures(nation, color) {
    const { ctx, tile } = this;
    for (const s of nation.structures) {
      const def = STRUCTURES[s.key];
      const [w, h] = def.footprint;
      const sx = (s.x - this.originX) * tile;
      const sy = (s.y - this.originY) * tile;

      if (s.key === 'belt') {
        // 벨트는 얇게, 방향 화살표로 표시
        ctx.fillStyle = '#3a4650';
        ctx.fillRect(sx + 2, sy + 2, tile - 4, tile - 4);
        ctx.fillStyle = '#e8e4da';
        ctx.font = `${tile * 0.6}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(DIR_ARROW[s.dir ?? 0], sx + tile / 2, sy + tile / 2);
        continue;
      }

      ctx.fillStyle = color;
      ctx.globalAlpha = s.idle ? 0.35 : 0.85; // 유휴(가동 정지) 상태는 흐리게 표시
      ctx.fillRect(sx + 1, sy + 1, w * tile - 2, h * tile - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.idle ? '#c1443c' : '#0d0d0d';
      ctx.lineWidth = s.idle ? 2 : 1;
      ctx.strokeRect(sx + 1, sy + 1, w * tile - 2, h * tile - 2);
      ctx.lineWidth = 1;
      if (tile >= 16) {
        ctx.fillStyle = '#12100c';
        ctx.font = `bold ${Math.max(9, tile * 0.32)}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${def.name[0]}${s.level}`, sx + (w * tile) / 2, sy + (h * tile) / 2);
      }
    }
  }

  _drawPowerOverlay(nation) {
    const { ctx, tile } = this;
    for (const s of nation.structures) {
      if (s.key !== 'power_plant' || !s._fueled) continue;
      const def = STRUCTURES.power_plant;
      const [w, h] = def.footprint;
      const cx = (s.x + w / 2 - this.originX) * tile;
      const cy = (s.y + h / 2 - this.originY) * tile;
      const r = (def.powerRadius + (s.level - 1)) * tile;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(245,217,78,0.06)';
      ctx.strokeStyle = 'rgba(245,217,78,0.35)';
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }

}

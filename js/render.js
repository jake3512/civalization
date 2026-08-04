// ============================================================
// render.js — 캔버스에 격자 필드, 지형, 영토, 구조물을 그린다
// ============================================================
import { getTileRange } from './world.js';
import { STRUCTURES, TERRAIN_NODES, DIR_ARROW, structureIcon } from './data.js';

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
    this.placementMarker = null; // 수도 위치 선택 중 표시할 마커 { x, y, ok, radius }
    this.buildPreview = null;    // 건설 미리보기(고스트) { key, x, y, dir, ok, error }
    this.capitalSites = null;    // 건국 단계에서 표시할 수도 후보 칸 [[x,y], ...]

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

    // 건설 미리보기(고스트) — 건설 모드일 때는 단순 호버 테두리 대신 이걸 그린다
    if (this.buildPreview) this._drawBuildPreview();
    else if (this.hover) {
      const sx = (this.hover.x - this.originX) * tile;
      const sy = (this.hover.y - this.originY) * tile;
      ctx.strokeStyle = '#f5d94e';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tile, tile);
    }

    // 건국 단계: 수도를 세울 수 있는 칸을 미리 표시해준다
    // (요건을 만족하는 칸이 드물어서 맨손으로 찾기 어렵기 때문)
    if (this.capitalSites && this.capitalSites.length) {
      ctx.fillStyle = 'rgba(74,157,143,0.22)';
      ctx.strokeStyle = 'rgba(74,157,143,0.6)';
      ctx.lineWidth = 1;
      for (const [tx, ty] of this.capitalSites) {
        const sx = (tx - this.originX) * tile, sy = (ty - this.originY) * tile;
        ctx.fillRect(sx + tile * 0.3, sy + tile * 0.3, tile * 0.4, tile * 0.4);
        ctx.strokeRect(sx + tile * 0.3, sy + tile * 0.3, tile * 0.4, tile * 0.4);
      }
    }

    // 수도 위치 선택 마커 (건국 전 단계) — 실제로 편입될 영토 범위와
    // 입지 요건 충족 여부(초록/빨강)를 함께 보여준다
    if (this.placementMarker) {
      const m = this.placementMarker;
      const cx = (m.x + 1 - this.originX) * tile;
      const cy = (m.y + 1 - this.originY) * tile;
      const ok = m.ok !== false;
      const stroke = ok ? '#4a9d8f' : '#c1443c';

      if (m.radius) {
        ctx.beginPath();
        ctx.fillStyle = ok ? 'rgba(74,157,143,0.10)' : 'rgba(193,68,60,0.10)';
        ctx.strokeStyle = ok ? 'rgba(74,157,143,0.55)' : 'rgba(193,68,60,0.55)';
        ctx.lineWidth = 2;
        ctx.arc(cx, cy, m.radius * tile, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }

      // 수도 3x3 발판 고스트
      const fx = (m.x - this.originX) * tile, fy = (m.y - this.originY) * tile;
      ctx.fillStyle = ok ? 'rgba(74,157,143,0.28)' : 'rgba(193,68,60,0.28)';
      ctx.fillRect(fx, fy, 3 * tile, 3 * tile);
      this._drawStructIcon('capital', fx, fy, 3, 3, 0.9);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.strokeRect(fx, fy, 3 * tile, 3 * tile);
      ctx.lineWidth = 1;
    }
  }

  /** 건설 모드에서 커서(또는 마지막 터치 지점) 위치에 배치 결과를 미리 보여준다 */
  _drawBuildPreview() {
    const { ctx, tile } = this;
    const p = this.buildPreview;
    const def = STRUCTURES[p.key];
    if (!def) return;
    const [w, h] = def.footprint;
    const sx = (p.x - this.originX) * tile;
    const sy = (p.y - this.originY) * tile;

    // 발판 고스트 (초록=건설 가능, 빨강=불가)
    ctx.fillStyle = p.ok ? 'rgba(74,157,143,0.30)' : 'rgba(193,68,60,0.30)';
    ctx.fillRect(sx, sy, w * tile, h * tile);
    this._drawStructIcon(p.key, sx, sy, w, h, 0.85);
    ctx.strokeStyle = p.ok ? '#4a9d8f' : '#c1443c';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(sx, sy, w * tile, h * tile);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    // 벨트는 흐를 방향을 화살표로 함께 보여준다
    if (p.key === 'belt') {
      ctx.fillStyle = '#f0e8de';
      ctx.font = `${tile * 0.6}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(DIR_ARROW[p.dir ?? 0], sx + tile / 2, sy + tile / 2);
    }

    // 영토를 넓히는 구조물(수도/중심지)은 편입될 범위를 원으로 미리 보여준다
    if (p.territoryRadius) {
      const ccx = sx + (w * tile) / 2, ccy = sy + (h * tile) / 2;
      ctx.beginPath();
      ctx.strokeStyle = p.ok ? 'rgba(74,157,143,0.5)' : 'rgba(193,68,60,0.5)';
      ctx.setLineDash([6, 5]);
      ctx.arc(ccx, ccy, p.territoryRadius * tile, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 전력 공급 범위를 갖는 구조물(발전소)도 공급 범위를 미리 보여준다
    if (p.powerRadius) {
      const ccx = sx + (w * tile) / 2, ccy = sy + (h * tile) / 2;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(245,217,78,0.07)';
      ctx.strokeStyle = 'rgba(245,217,78,0.45)';
      ctx.arc(ccx, ccy, p.powerRadius * tile, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
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
      this._drawStructIcon(s.key, sx, sy, w, h, s.idle ? 0.45 : 1);
      ctx.strokeStyle = s.idle ? '#c1443c' : '#0d0d0d';
      ctx.lineWidth = s.idle ? 2 : 1;
      ctx.strokeRect(sx + 1, sy + 1, w * tile - 2, h * tile - 2);
      ctx.lineWidth = 1;
      // 레벨은 아이콘을 가리지 않도록 우측 하단에 작은 배지로 표시
      if (tile >= 16) {
        const bw = Math.max(11, tile * 0.42), bh = Math.max(10, tile * 0.36);
        const bx = sx + w * tile - bw - 2, by = sy + h * tile - bh - 2;
        ctx.fillStyle = 'rgba(12,14,12,0.78)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#f0e8de';
        ctx.font = `bold ${Math.max(8, tile * 0.26)}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(s.level), bx + bw / 2, by + bh / 2 + 0.5);
      }
    }
  }

  /** 구조물 발판 중앙에 구조물 아이콘을 그린다 (로드 전이면 조용히 건너뜀) */
  _drawStructIcon(structKey, sx, sy, w, h, alpha = 1) {
    const { ctx, tile } = this;
    const img = getIconImage(structureIcon(structKey));
    if (!img.complete || img.naturalWidth === 0) return;
    const box = Math.min(w, h) * tile;
    const size = box * 0.72;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx + (w * tile - size) / 2, sy + (h * tile - size) / 2, size, size);
    ctx.globalAlpha = 1;
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

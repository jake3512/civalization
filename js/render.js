// ============================================================
// render.js — 캔버스에 격자 필드, 지형, 영토, 구조물을 그린다
//
// 카메라는 바닥을 비스듬히 내려다본다(TILT). 진짜 3D 엔진을 쓰는 대신,
//   · 바닥(땅·격자·영토)은 세로로 눌러 그려서 기울어진 평면처럼 보이게 하고
//   · 구조물은 발판 위에 낮은 입체 받침(앞면 + 윗면)을 세운 뒤
//   · 그림(일러스트)은 눌리지 않은 정사각형으로 "세워서" 그린다
// 는 방식이다. 그림이 정면도라서 세워두면 그대로 건물 입면이 되고,
// 뒤쪽(y가 작은) 것부터 그리면 앞 건물이 뒤 건물을 자연스럽게 가린다.
// ============================================================
import { getTileRange } from './world.js';
import { STRUCTURES, TERRAIN_NODES, DIR_ARROW, structureIcon } from './data.js';

// 아케이드풍으로 채도·명암 대비를 높인 지형 색
const TERRAIN_COLORS = {
  plain: '#2c4a30',
  water: '#12557a',
};

/** 바닥 평면의 세로 압축 비율 — 1이면 정투영(위에서 수직), 작을수록 더 눕는다 */
export const TILT = 0.58;
/** 구조물 받침(플린스)의 높이 — 타일 크기 대비 */
const PLINTH = 0.22;

/**
 * 구조물별로 그림을 얼마나 높이 세울지 (타일 단위).
 * 순전히 보기용 값이라 규칙서(data.js)가 아니라 여기에 둔다.
 */
const STRUCT_HEIGHT = {
  capital: 1.7, hub: 1.15, lab: 1.35,
  factory: 1.3, smelter: 1.25, refinery: 1.3, power_plant: 1.4,
  warehouse: 1.15, barn: 1.15, kitchen: 1.15, slaughterhouse: 1.1,
  mine: 0.95, lumber_mill: 1.0, farm: 0.8, oil_well: 1.1, extractor: 1.0,
  wall: 0.7, outpost: 1.3,
};
const structHeight = (key) => STRUCT_HEIGHT[key] ?? (key.startsWith('turret') ? 1.1 : 1.0);

// ---- 아이콘 이미지 캐시 ----
// data.js의 아이콘은 이제 이모지 문자가 아니라 assets/icons/*.svg 경로다.
// 캔버스에는 fillText 대신 미리 로드해 둔 Image를 drawImage로 그린다
// (로드 전 프레임엔 그냥 건너뛰고, 로드가 끝나면 다음 프레임부터 자동으로 그려짐).
const iconImageCache = new Map();
export function getIconImage(src) {
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

  /** 세로 방향 타일 크기 — 카메라가 기울어져 있어서 가로보다 짧다 */
  get tileY() { return this.tile * TILT; }

  /** 월드 좌표 → 화면 좌표 (바닥 평면 위의 점) */
  proj(wx, wy) {
    return { sx: (wx - this.originX) * this.tile, sy: (wy - this.originY) * this.tileY };
  }

  /** screenX/Y 지점을 고정한 채 tile 크기를 deltaTile만큼 바꾼다 (휠/핀치/버튼 공용) */
  zoomAt(screenX, screenY, deltaTile) {
    const oldX = this.tile, oldY = this.tileY;
    this.tile = Math.min(48, Math.max(6, this.tile + deltaTile));
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
    return { x: Math.floor(this.originX + px / this.tile), y: Math.floor(this.originY + py / this.tileY) };
  }

  pan(dx, dy) {
    this.originX -= dx / this.tile;
    this.originY -= dy / this.tileY;
  }

  centerOn(x, y) {
    this.originX = x - this.canvas.width / this.tile / 2;
    this.originY = y - this.canvas.height / this.tileY / 2;
  }

  /**
   * 화면 좌표에서 구조물을 집어낸다. 구조물은 바닥보다 위로 솟아 있어서
   * "보이는 건물"과 "그 건물이 서 있는 타일"이 다르다 — 눈에 보이는 대로
   * 골라지도록 앞쪽(y가 큰) 것부터 실제 그려진 영역으로 검사한다.
   */
  pickStructure(nation, px, py) {
    if (!nation) return null;
    const list = [...nation.structures].sort((a, b) => this._depth(b) - this._depth(a));
    for (const s of list) {
      const b = this.structBounds(s);
      if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) return s;
    }
    return null;
  }

  /** 그리기 순서용 깊이 — 발판의 앞쪽 모서리가 클수록 카메라에 가깝다 */
  _depth(s) {
    const [, h] = STRUCTURES[s.key].footprint;
    return s.y + h;
  }

  /** 구조물이 화면에서 실제로 차지하는 사각형 (받침 + 세워 그린 그림) */
  structBounds(s) {
    const def = STRUCTURES[s.key];
    const [w, h] = def.footprint;
    const { sx, sy } = this.proj(s.x, s.y);
    const bw = w * this.tile, bh = h * this.tileY;
    if (s.key === 'belt') return { left: sx, right: sx + bw, top: sy, bottom: sy + bh, sx, sy, bw, bh };
    const lift = PLINTH * this.tile;
    const art = Math.min(w, h) * this.tile * 1.1;
    const artH = art * structHeight(s.key);
    const footY = sy + bh * 0.72 - lift;            // 그림이 서 있는 바닥선
    return {
      left: Math.min(sx, sx + bw / 2 - art / 2),
      right: Math.max(sx + bw, sx + bw / 2 + art / 2),
      top: Math.min(sy - lift, footY - artH),
      bottom: sy + bh,
      sx, sy, bw, bh, lift, art, artH, footY,
    };
  }

  draw() {
    const { ctx, canvas, tile, tileY } = this;
    // 지평선 쪽이 밝은 하늘색으로 빠지게 해서 바닥이 누워 있는 느낌을 준다
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#16242c');
    sky.addColorStop(0.35, '#101512');
    sky.addColorStop(1, '#0b0f0c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 세워 그린 나무·건물이 화면 밖에서 걸쳐 들어오므로 위아래로 여유를 둔다
    const x0 = Math.floor(this.originX) - 1, y0 = Math.floor(this.originY) - 3;
    const x1 = x0 + Math.ceil(canvas.width / tile) + 2;
    const y1 = y0 + Math.ceil(canvas.height / tileY) + 6;
    const tiles = getTileRange(x0, y0, x1, y1);

    const nation = this.game.myNation;

    // ---- 1) 바닥 평면: 지형·영토·격자 (눌린 사각형) ----
    for (const t of tiles) {
      const { sx, sy } = this.proj(t.x, t.y);
      ctx.fillStyle = TERRAIN_COLORS[t.terrain] || TERRAIN_COLORS.plain;
      ctx.fillRect(sx, sy, tile + 0.5, tileY + 0.5);

      if (nation && nation.isOwned(t.x, t.y)) {
        ctx.fillStyle = 'rgba(255,168,46,0.26)'; // 내 영토 — 채도 높은 주황 틴트
        ctx.fillRect(sx, sy, tile + 0.5, tileY + 0.5);
      }

      if (tile >= 14) {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; // 어두운 격자선으로 타일 경계를 또렷하게
        ctx.strokeRect(sx, sy, tile, tileY);
      }
    }

    // 전력 공급 범위 오버레이 (바닥에 눕혀 그린다)
    if (this.showPower && nation) this._drawPowerOverlay(nation);

    // ---- 2) 세워서 그리는 것들: 자원 노드 + 구조물 ----
    // 뒤(y가 작은 쪽)부터 그려야 앞의 것이 뒤의 것을 가린다.
    const standing = [];
    for (const t of tiles) if (t.node) standing.push({ depth: t.y + 1, kind: 'node', t });
    if (nation) for (const s of nation.structures) standing.push({ depth: this._depth(s), kind: 'struct', s, color: '#d98e34' });
    for (const other of this.game.otherNations.values()) {
      for (const s of other.structures) standing.push({ depth: this._depth(s), kind: 'struct', s, color: '#c1443c' });
    }
    standing.sort((a, b) => a.depth - b.depth);
    for (const item of standing) {
      if (item.kind === 'node') this._drawNode(item.t);
      else this._drawStructure(item.s, item.color);
    }

    // 건설 미리보기(고스트) — 건설 모드일 때는 단순 호버 테두리 대신 이걸 그린다
    if (this.buildPreview) this._drawBuildPreview();
    else if (this.hover) {
      const { sx, sy } = this.proj(this.hover.x, this.hover.y);
      ctx.strokeStyle = '#f5d94e';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tile, tileY);
    }

    // 건국 단계: 수도를 세울 수 있는 칸을 미리 표시해준다
    // (요건을 만족하는 칸이 드물어서 맨손으로 찾기 어렵기 때문)
    if (this.capitalSites && this.capitalSites.length) {
      ctx.fillStyle = 'rgba(74,157,143,0.22)';
      ctx.strokeStyle = 'rgba(74,157,143,0.6)';
      ctx.lineWidth = 1;
      for (const [tx, ty] of this.capitalSites) {
        const { sx, sy } = this.proj(tx, ty);
        ctx.fillRect(sx + tile * 0.3, sy + tileY * 0.3, tile * 0.4, tileY * 0.4);
        ctx.strokeRect(sx + tile * 0.3, sy + tileY * 0.3, tile * 0.4, tileY * 0.4);
      }
    }

    // 수도 위치 선택 마커 (건국 전 단계) — 실제로 편입될 영토 범위와
    // 입지 요건 충족 여부(초록/빨강)를 함께 보여준다
    if (this.placementMarker) {
      const m = this.placementMarker;
      const c = this.proj(m.x + 1, m.y + 1);
      const ok = m.ok !== false;

      if (m.radius) {
        ctx.beginPath();
        ctx.fillStyle = ok ? 'rgba(74,157,143,0.10)' : 'rgba(193,68,60,0.10)';
        ctx.strokeStyle = ok ? 'rgba(74,157,143,0.55)' : 'rgba(193,68,60,0.55)';
        ctx.lineWidth = 2;
        ctx.ellipse(c.sx, c.sy, m.radius * tile, m.radius * tileY, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }

      // 수도 3x3 발판 고스트
      const f = this.proj(m.x, m.y);
      ctx.fillStyle = ok ? 'rgba(74,157,143,0.28)' : 'rgba(193,68,60,0.28)';
      ctx.fillRect(f.sx, f.sy, 3 * tile, 3 * tileY);
      this._drawStandingArt(structureIcon('capital'), f.sx + 1.5 * tile, f.sy + 3 * tileY * 0.72,
        3 * tile * 0.95, structHeight('capital'), 0.9);
      ctx.strokeStyle = ok ? '#4a9d8f' : '#c1443c';
      ctx.lineWidth = 3;
      ctx.strokeRect(f.sx, f.sy, 3 * tile, 3 * tileY);
      ctx.lineWidth = 1;
    }
  }

  /** 자원 노드(나무·바위 등)를 바닥에 세워 그린다 — 서 있으면 기울기가 확 살아난다 */
  _drawNode(t) {
    const { ctx, tile, tileY } = this;
    const img = getIconImage(t.node.icon);
    if (!img.complete || img.naturalWidth === 0) return;
    const { sx, sy } = this.proj(t.x, t.y);
    const size = tile * 0.92;
    const footY = sy + tileY * 0.85;
    // 바닥 그림자를 눕혀 깔아 "떠 있는" 느낌을 없앤다
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.ellipse(sx + tile / 2, footY - size * 0.06, size * 0.34, size * 0.34 * TILT, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(img, sx + (tile - size) / 2, footY - size, size, size);
  }

  /** 건설 모드에서 커서(또는 마지막 터치 지점) 위치에 배치 결과를 미리 보여준다 */
  _drawBuildPreview() {
    const { ctx, tile, tileY } = this;
    const p = this.buildPreview;
    const def = STRUCTURES[p.key];
    if (!def) return;
    const [w, h] = def.footprint;
    const { sx, sy } = this.proj(p.x, p.y);
    const bw = w * tile, bh = h * tileY;

    // 발판 고스트 (초록=건설 가능, 빨강=불가) — 실제 건물과 같은 자세로 세워 보여준다
    ctx.fillStyle = p.ok ? 'rgba(74,157,143,0.30)' : 'rgba(193,68,60,0.30)';
    ctx.fillRect(sx, sy, bw, bh);
    if (p.key !== 'belt') {
      this._drawStandingArt(structureIcon(p.key), sx + bw / 2, sy + bh * 0.72,
        Math.min(w, h) * tile * 1.1, structHeight(p.key), 0.8);
    }
    ctx.strokeStyle = p.ok ? '#4a9d8f' : '#c1443c';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(sx, sy, bw, bh);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    // 벨트는 흐를 방향을 화살표로 함께 보여준다
    if (p.key === 'belt') {
      ctx.fillStyle = '#f0e8de';
      ctx.font = `${tile * 0.55}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(DIR_ARROW[p.dir ?? 0], sx + tile / 2, sy + tileY / 2);
    }

    // 영토를 넓히는 구조물(수도/중심지)은 편입될 범위를 바닥에 눕혀 미리 보여준다
    const ccx = sx + bw / 2, ccy = sy + bh / 2;
    if (p.territoryRadius) {
      ctx.beginPath();
      ctx.strokeStyle = p.ok ? 'rgba(74,157,143,0.5)' : 'rgba(193,68,60,0.5)';
      ctx.setLineDash([6, 5]);
      ctx.ellipse(ccx, ccy, p.territoryRadius * tile, p.territoryRadius * tileY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 전력 공급 범위를 갖는 구조물(발전소)도 공급 범위를 미리 보여준다
    if (p.powerRadius) {
      ctx.beginPath();
      ctx.fillStyle = 'rgba(245,217,78,0.07)';
      ctx.strokeStyle = 'rgba(245,217,78,0.45)';
      ctx.ellipse(ccx, ccy, p.powerRadius * tile, p.powerRadius * tileY, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }

  /** 구조물 하나를 그린다 — 소속 색 받침(입체) 위에 그림을 세운다 */
  _drawStructure(s, color) {
    const { ctx, tile, tileY } = this;
    const b = this.structBounds(s);

    if (s.key === 'belt') {
      // 벨트는 바닥에 깔린 물건이라 세우지 않고 눕혀 그린다
      ctx.fillStyle = '#4b5a67';
      ctx.fillRect(b.sx + 2, b.sy + 1, tile - 4, tileY - 2);
      ctx.strokeStyle = '#120e14'; ctx.lineWidth = 2;
      ctx.strokeRect(b.sx + 2, b.sy + 1, tile - 4, tileY - 2);
      ctx.lineWidth = 1;
      ctx.fillStyle = '#ffd84d';
      ctx.font = `bold ${tile * 0.55}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(DIR_ARROW[s.dir ?? 0], b.sx + tile / 2, b.sy + tileY / 2);
      return;
    }

    const { sx, sy, bw, bh, lift } = b;
    ctx.globalAlpha = s.idle ? 0.55 : 1;

    // 받침 앞면(그늘) — 바닥에서 lift만큼 솟은 벽
    ctx.fillStyle = shade(color, -0.45);
    ctx.fillRect(sx, sy + bh - lift, bw, lift);
    // 받침 윗면(빛) — 발판을 lift만큼 올린 것
    ctx.fillStyle = color;
    ctx.fillRect(sx, sy - lift, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fillRect(sx, sy - lift, bw, Math.max(1.5, bh * 0.2));
    ctx.globalAlpha = 1;

    // 받침 위에 드리우는 그림자 — 건물이 "떠 있지 않고 서 있다"는 인상을 만든다
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.ellipse(sx + bw / 2, b.footY - b.art * 0.04, b.art * 0.36, b.art * 0.36 * TILT, 0, 0, Math.PI * 2);
    ctx.fill();

    // 그림을 받침 위에 세운다 (일러스트가 정면도라 그대로 건물 입면이 된다)
    this._drawStandingArt(structureIcon(s.key), sx + bw / 2, b.footY, b.art,
      structHeight(s.key), s.idle ? 0.55 : 1);

    // 굵은 검은 외곽선 + 정지 상태면 빨간 테두리 (아케이드풍 대비)
    ctx.strokeStyle = '#120e14';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy - lift, bw, bh + lift);
    if (s.idle) {
      ctx.strokeStyle = '#ff4d3d';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1.5, sy - lift + 1.5, bw - 3, bh + lift - 3);
    }
    ctx.lineWidth = 1;

    // 레벨 배지는 받침 앞면 우측에 (건물 그림을 가리지 않는다)
    if (tile >= 16) {
      const badgeW = Math.max(11, tile * 0.42), badgeH = Math.max(9, tile * 0.3);
      const bx = sx + bw - badgeW - 1, by = sy + bh - badgeH - 1;
      ctx.fillStyle = 'rgba(12,14,12,0.82)';
      ctx.fillRect(bx, by, badgeW, badgeH);
      ctx.fillStyle = '#f0e8de';
      ctx.font = `bold ${Math.max(8, tile * 0.24)}px 'IBM Plex Mono', monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(s.level), bx + badgeW / 2, by + badgeH / 2 + 0.5);
    }
  }

  /**
   * 그림을 바닥선(footY)에 세워서 그린다. 가로 폭은 width, 높이는 그 폭에
   * heightMul을 곱한 값 — 눌린 바닥과 달리 세로를 줄이지 않아서 "서 있는" 것처럼 보인다.
   */
  _drawStandingArt(src, centerX, footY, width, heightMul, alpha = 1) {
    const { ctx } = this;
    const img = getIconImage(src);
    if (!img.complete || img.naturalWidth === 0) return;
    const h = width * heightMul;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, centerX - width / 2, footY - h, width, h);
    ctx.globalAlpha = 1;
  }

  _drawPowerOverlay(nation) {
    const { ctx, tile, tileY } = this;
    for (const s of nation.structures) {
      if (s.key !== 'power_plant' || !s._fueled) continue;
      const def = STRUCTURES.power_plant;
      const [w, h] = def.footprint;
      const c = this.proj(s.x + w / 2, s.y + h / 2);
      const r = def.powerRadius + (s.level - 1);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(245,217,78,0.06)';
      ctx.strokeStyle = 'rgba(245,217,78,0.35)';
      ctx.ellipse(c.sx, c.sy, r * tile, r * tileY, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }

}

/** 색을 밝게(+)/어둡게(-) — 받침 앞면과 윗면을 구분하는 데 쓴다 */
function shade(hex, amt) {
  const m = /^#?([\da-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v =>
    Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt))));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

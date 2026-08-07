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
import { STRUCTURES, TERRAIN_NODES, DIR_ARROW, RESOURCES, structureIcon, alertIcon, isBeltKey } from './data.js';

// 아케이드풍으로 채도·명암 대비를 높인 지형 색
const TERRAIN_COLORS = {
  plain: '#2c4a30',
  water: '#12557a',
};

/** 바닥 평면의 세로 압축 비율 — 1이면 정투영(위에서 수직), 작을수록 더 눕는다 */
export const TILT = 0.58;
/**
 * 구조물 받침(플린스)의 높이 — 타일 크기 대비.
 * 낮게 둬야 건물이 땅에 붙어 보인다 (높으면 공중에 뜬 것처럼 보인다).
 */
const PLINTH = 0.09;
/**
 * 건물이 자기 발판 위로 솟을 수 있는 최대 높이 (타일 가로 크기 대비).
 * 한 줄 높이(tile * TILT)보다 살짝 크게 잡아, 뒤쪽 타일이 통째로 가려지지 않게 한다.
 */
const MAX_RISE = 0.6;

/**
 * 구조물 그림을 발판 대비 얼마나 크게 세울지.
 * 그림 자체가 이미 "정면 + 윗면"으로 높이를 담고 있으므로 세로만 늘이면
 * 찌그러진다 — 가로세로 비율은 그대로 두고 전체 크기만 조절한다.
 * 순전히 보기용 값이라 규칙서(data.js)가 아니라 여기에 둔다.
 */
const STRUCT_SCALE = {
  capital: 1.15, hub: 1.0, lab: 1.15,
  factory: 1.1, smelter: 1.1, refinery: 1.1, power_plant: 1.15,
  warehouse: 1.05, barn: 1.05, kitchen: 1.05, slaughterhouse: 1.0,
  mine: 1.0, lumber_mill: 1.05, farm: 0.95, oil_well: 1.15, extractor: 1.0,
  wall: 0.95, outpost: 1.2,
};
export const structScale = (key) => STRUCT_SCALE[key] ?? 1.0;

/**
 * 구조물 그림을 어디에 얼마나 크게 세울지 (필드·전투 화면 공용).
 * 그림은 (1) 발판 가로 폭을 넘지 않고 (2) 발판 위로 MAX_RISE 이상 솟지 않는다.
 * 두 상한 덕분에 옆 타일로 삐져나가지도, 뒤 타일을 통째로 덮지도 않는다.
 * footY / plinth는 발판 좌상단(sy)을 기준으로 한 상대 좌표다.
 */
export function structArtMetrics(tile, w, h, key) {
  const bh = h * tile * TILT;
  const lift = PLINTH * tile;
  const art = Math.min(w * tile * structScale(key), bh + tile * MAX_RISE);
  return { art, lift, footY: bh - lift * 0.4 };
}

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

/**
 * 그림 안에서 실제로 잉크가 시작되는 높이(0~1). 예를 들어 농지 그림은 위쪽
 * 40%가 비어 있어서, 이걸 모르면 머리 위 표시가 허공에 뜬다.
 * 오프스크린 캔버스로 한 번만 훑어 캐시한다 (아트가 바뀌어도 자동으로 맞는다).
 */
const inkTopCache = new Map();
function getInkTop(img, src) {
  if (inkTopCache.has(src)) return inkTopCache.get(src);
  let t = 0;
  try {
    const N = 32;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    let row = 0;
    scan: for (; row < N; row++) {
      for (let x = 0; x < N; x++) if (d[(row * N + x) * 4 + 3] > 12) break scan;
    }
    t = row / N;
  } catch { t = 0; } // 캔버스를 못 읽으면 그냥 그림 상단을 쓴다
  inkTopCache.set(src, t);
  return t;
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

  /**
   * 캔버스를 부모 크기에 맞춘다.
   *
   * 고해상도 화면(휴대폰은 보통 2~3배)에서는 CSS 픽셀 그대로 그리면 흐릿하다.
   * 그래서 실제 픽셀 수만큼 백버퍼를 잡고 컨텍스트를 그 배율로 확대해 둔다.
   * 바깥에서 쓰는 좌표는 전부 **CSS 픽셀**(vw/vh)이라 나머지 계산은 그대로다.
   * (크기가 바뀔 때만 캔버스를 다시 잡는다 — width를 대입하면 화면이 지워진다)
   */
  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth, h = parent.clientHeight;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (this._w !== w || this._h !== h || this._dpr !== dpr) {
      this._w = w; this._h = h; this._dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 화면 크기 (CSS 픽셀). 캔버스 백버퍼는 이보다 크다 */
  get vw() { return this._w || this.canvas.width; }
  get vh() { return this._h || this.canvas.height; }

  screenToWorld(px, py) {
    return { x: Math.floor(this.originX + px / this.tile), y: Math.floor(this.originY + py / this.tileY) };
  }

  pan(dx, dy) {
    this.originX -= dx / this.tile;
    this.originY -= dy / this.tileY;
  }

  centerOn(x, y) {
    this.originX = x - this.vw / this.tile / 2;
    this.originY = y - this.vh / this.tileY / 2;
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
    if (isBeltKey(s.key)) return { left: sx, right: sx + bw, top: sy, bottom: sy + bh, sx, sy, bw, bh };
    const m = structArtMetrics(this.tile, w, h, s.key);
    const lift = m.lift, art = m.art;
    const footY = sy + m.footY;                     // 그림이 서 있는 바닥선 = 발판 앞쪽 모서리
    return {
      left: sx + (bw - art) / 2,
      right: sx + (bw + art) / 2,
      top: Math.min(sy - lift, footY - art),
      bottom: sy + bh,
      sx, sy, bw, bh, lift, art, footY,
    };
  }

  draw() {
    const { ctx, canvas, tile, tileY } = this;
    // 지평선 쪽이 밝은 하늘색으로 빠지게 해서 바닥이 누워 있는 느낌을 준다
    const sky = ctx.createLinearGradient(0, 0, 0, this.vh);
    sky.addColorStop(0, '#16242c');
    sky.addColorStop(0.35, '#101512');
    sky.addColorStop(1, '#0b0f0c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.vw, this.vh);

    // 세워 그린 나무·건물이 화면 밖에서 걸쳐 들어오므로 위아래로 여유를 둔다
    const x0 = Math.floor(this.originX) - 1, y0 = Math.floor(this.originY) - 3;
    const x1 = x0 + Math.ceil(this.vw / tile) + 2;
    const y1 = y0 + Math.ceil(this.vh / tileY) + 6;
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

    // ---- 3) 머리 위 표시 (보관 중인 아이템 · 경고) ----
    // 건물보다 항상 위에 떠야 하므로 구조물을 다 그린 뒤 한 번에 얹는다.
    if (nation) for (const s of nation.structures) this._drawOverlay(s);

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
        3 * tile * 1.15 * structScale('capital'), 0.9);
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
    if (!isBeltKey(p.key)) {
      this._drawStandingArt(structureIcon(p.key), sx + bw / 2, sy + bh * 0.72,
        Math.min(w, h) * tile * 1.15 * structScale(p.key), 0.8);
    }
    ctx.strokeStyle = p.ok ? '#4a9d8f' : '#c1443c';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(sx, sy, bw, bh);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    // 벨트는 흐를 방향을 화살표로 함께 보여준다
    if (isBeltKey(p.key)) {
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
    const { ctx, tile, tileY, canvas } = this;
    const b = this.structBounds(s);
    if (b.right < 0 || b.left > this.vw || b.bottom < 0 || b.top > this.vh) return;

    if (isBeltKey(s.key)) {
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
      // 방금 이 벨트를 지나간 자원을 얹어 무엇이 흐르는지 보여준다
      if (s._carry && tile >= 12) {
        const img = getIconImage(RESOURCES[s._carry]?.icon || '');
        if (img.complete && img.naturalWidth > 0) {
          const size = tile * 0.62;
          ctx.drawImage(img, b.sx + (tile - size) / 2, b.sy + tileY / 2 - size * 0.8, size, size);
        }
      }
      return;
    }

    const { sx, sy, bw, bh, lift } = b;
    // 받침은 발판보다 살짝 안쪽으로 들여 깔아, 영토 틴트와 붙어 보이지 않게 한다
    const px = sx + bw * 0.06, pw = bw * 0.88;
    const py = sy + bh * 0.06, ph = bh * 0.88;
    ctx.globalAlpha = s.idle ? 0.55 : 1;

    // 받침 앞면(그늘) — 바닥에서 lift만큼 솟은 벽
    ctx.fillStyle = shade(color, -0.5);
    ctx.fillRect(px, py + ph - lift, pw, lift);
    // 받침 윗면(빛) — 발판을 lift만큼 올린 것
    ctx.fillStyle = color;
    ctx.fillRect(px, py - lift, pw, ph);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(px, py - lift, pw, Math.max(1.5, ph * 0.2));
    ctx.globalAlpha = 1;

    // 받침 위에 드리우는 그림자 — 건물이 "떠 있지 않고 서 있다"는 인상을 만든다
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.ellipse(sx + bw / 2, b.footY - b.art * 0.03, b.art * 0.32, b.art * 0.32 * TILT, 0, 0, Math.PI * 2);
    ctx.fill();

    // 그림을 받침 위에 세운다 (일러스트가 정면 + 윗면이라 그대로 건물이 된다)
    this._drawStandingArt(structureIcon(s.key), sx + bw / 2, b.footY, b.art, s.idle ? 0.6 : 1);

    // 굵은 검은 외곽선 + 정지 상태면 빨간 테두리 (아케이드풍 대비)
    ctx.strokeStyle = '#120e14';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py - lift, pw, ph + lift);
    if (s.idle) {
      ctx.strokeStyle = '#ff4d3d';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1.5, py - lift + 1.5, pw - 3, ph + lift - 3);
    }
    ctx.lineWidth = 1;

    // 레벨 배지는 받침 앞면 우측에 (건물 그림을 가리지 않는다)
    if (tile >= 16) {
      const badgeW = Math.max(11, tile * 0.42), badgeH = Math.max(9, tile * 0.3);
      const bx = px + pw - badgeW - 1, by = py + ph - badgeH - 1;
      ctx.fillStyle = 'rgba(12,14,12,0.82)';
      ctx.fillRect(bx, by, badgeW, badgeH);
      ctx.fillStyle = '#f0e8de';
      ctx.font = `bold ${Math.max(8, tile * 0.24)}px 'IBM Plex Mono', monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(s.level), bx + badgeW / 2, by + badgeH / 2 + 0.5);
    }
  }

  /**
   * 구조물 머리 위에 띄우는 표시.
   *  · 창고/수도처럼 자원을 보관하는 곳은 무엇이 얼마나 들었는지
   *  · 멈춰 있는 구조물은 왜 멈췄는지(전력 없음·산출 가득 참 …)
   * 둘 다 있으면 경고를 위에 올려서 먼저 눈에 띄게 한다.
   */
  _drawOverlay(s) {
    const { ctx, tile, canvas } = this;
    if (tile < 11 || isBeltKey(s.key)) return;      // 너무 축소된 상태에서는 생략
    const def = STRUCTURES[s.key];
    const b = this.structBounds(s);
    // 화면 밖 구조물은 건너뛴다 (나라가 커져도 프레임마다 헛일하지 않도록)
    if (b.right < 0 || b.left > this.vw || b.bottom < -40 || b.top > this.vh) return;
    const cx = b.sx + b.bw / 2;
    // 그림 상자의 위쪽이 아니라 "실제로 그려진 부분"의 꼭대기에 붙인다
    const src = structureIcon(s.key);
    const img0 = getIconImage(src);
    const inkTop = (img0.complete && img0.naturalWidth > 0) ? getInkTop(img0, src) : 0;
    let y = b.footY - b.art * (1 - inkTop) + tile * 0.12;

    // 보관 중인 자원 — 가장 많이 든 것 하나만 (창고는 한 종류라 그게 전부다)
    if (def.storageCapacity) {
      const entries = Object.entries(s.store || {}).filter(([, n]) => n > 0);
      if (entries.length) {
        entries.sort((a2, b2) => b2[1] - a2[1]);
        const [res, amount] = entries[0];
        const extra = entries.length > 1 ? entries.length - 1 : 0;
        y = this._drawChip(cx, y, RESOURCES[res]?.icon, fmtCount(amount) + (extra ? ` +${extra}` : ''));
      }
    }

    // 멈춤 사유 — 아이콘만 띄우고 자세한 설명은 구조물 팝업에서 본다
    if (s.idle && s.idleReason) {
      const size = Math.max(13, tile * 0.78);
      const img = getIconImage(alertIcon(s.idleReason));
      if (img.complete && img.naturalWidth > 0) {
        // 살짝 위아래로 흔들려서 정지 상태가 눈에 걸린다
        const bob = Math.sin(Date.now() / 320 + s.id) * size * 0.06;
        ctx.drawImage(img, cx - size / 2, y - size + bob, size, size);
      }
    }
  }

  /** 아이콘 + 숫자를 담은 작은 칩. 다음 표시가 놓일 y를 돌려준다 */
  _drawChip(cx, bottomY, iconSrc, label) {
    const { ctx, tile } = this;
    const h = Math.max(11, tile * 0.44);
    const icon = h * 0.82;
    ctx.font = `bold ${Math.max(8, h * 0.62)}px 'IBM Plex Mono', monospace`;
    const textW = ctx.measureText(label).width;
    const w = icon + textW + h * 0.5;
    const x = cx - w / 2, y = bottomY - h;

    ctx.fillStyle = 'rgba(10,12,10,0.82)';
    ctx.strokeStyle = '#120e14'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h * 0.3);
    ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1;

    const img = getIconImage(iconSrc || '');
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x + h * 0.14, y + (h - icon) / 2, icon, icon);
    }
    ctx.fillStyle = '#f0e8de';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + h * 0.14 + icon + h * 0.12, y + h / 2 + 0.5);
    return y - 2;
  }

  /**
   * 그림을 바닥선(footY)에 세워서 그린다. 바닥은 눌러 그리지만 그림은 원래
   * 비율(정사각형) 그대로 세우기 때문에 "서 있는 물체"로 읽힌다.
   */
  _drawStandingArt(src, centerX, footY, size, alpha = 1) {
    const { ctx } = this;
    const img = getIconImage(src);
    if (!img.complete || img.naturalWidth === 0) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, centerX - size / 2, footY - size, size, size);
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

/** 1000 이상은 1.2k처럼 줄여 칩이 길어지지 않게 한다 */
function fmtCount(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
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

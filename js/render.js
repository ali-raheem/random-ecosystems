// Canvas renderer: the landscape (water, woodland, grass that browns where it's been
// grazed, fire and ash, a seasonal tint), the animals, hunting and birth effects, and a
// population chart along the bottom. It reads the world; it never changes it.
//
// The map is drawn in world coordinates through a canvas transform. On a tall, narrow
// screen the map is turned a quarter turn so it fills the space.

import { W, H, COLS, ROWS, CELL, GRASS_MAX, YEAR, SPECIES, season } from './sim.js';

const TERRAIN_RES = 8; // terrain pixels per cell
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

// Colours. Grazers are pale, tinted by lineage; hunters are reds and oranges.
export const grazerColor = (hue, l = 82) => `hsl(${hue}, 45%, ${l}%)`;
export const hunterHue = (hue) => (350 + (hue % 60)) % 360;
export const hunterColor = (hue, l = 58) => `hsl(${hunterHue(hue)}, 85%, ${l}%)`;

// Seasonal tint over the land: fresh, golden, russet, frosted.
const TINTS = [
  [120, 220, 120, 0.05],
  [240, 210, 110, 0.07],
  [210, 120, 50, 0.12],
  [200, 225, 255, 0.24],
];

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.top = 120;
    this.bottom = 70;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.showHunts = true;
    this.effects = [];
    this.time = 0;
    this.grassCanvas = document.createElement('canvas');
    this.grassCanvas.width = COLS;
    this.grassCanvas.height = ROWS;
    this.grassCtx = this.grassCanvas.getContext('2d');
    this.grassImage = this.grassCtx.createImageData(COLS, ROWS);
    this.grassTimer = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
    this.layout();
  }

  setInsets(top, bottom) {
    this.top = top;
    this.bottom = bottom;
    this.layout();
  }

  // The map is fitted into the space between the header and the chart, turned a
  // quarter turn when that fits it better.
  layout() {
    const pad = Math.max(10, Math.min(24, this.w * 0.02));
    const chartH = this.h > 520 ? 64 : 44;
    const availW = this.w - 2 * pad;
    const availH = Math.max(80, this.h - this.top - this.bottom - chartH - 12);
    const flat = Math.min(availW / W, availH / H);
    const turned = Math.min(availW / H, availH / W);
    const rotated = turned > flat * 1.15;
    const scale = rotated ? turned : flat;
    const mw = (rotated ? H : W) * scale;
    const mh = (rotated ? W : H) * scale;
    this.map = { x: (this.w - mw) / 2, y: this.top + (availH - mh) / 2, w: mw, h: mh, scale, rotated };
    this.chart = { x: pad, y: this.h - this.bottom - chartH, w: this.w - 2 * pad, h: chartH };
  }

  reset(world) {
    this.world = world;
    this.effects = [];
    this.terrain = paintTerrain(world.terrain, world.seed);
    this.grassTimer = 0;
  }

  update(dt, realDt, effects) {
    this.time += realDt;
    if (effects && !this.reducedMotion) {
      for (const k of effects.kills) this.effects.push({ kind: 'kill', x: k.x, y: k.y, hue: k.hue, t: 0, life: 1.4 });
      for (const b of effects.births) this.effects.push({ kind: 'birth', x: b.x, y: b.y, sp: b.sp, t: 0, life: 0.9 });
      for (const d of effects.deaths) this.effects.push({ kind: 'death', x: d.x, y: d.y, sp: d.sp, t: 0, life: 2.2 });
      if (this.effects.length > 400) this.effects.splice(0, this.effects.length - 400);
    }
    for (const e of this.effects) e.t += realDt;
    this.effects = this.effects.filter((e) => e.t < e.life);
    this.grassTimer -= realDt;
  }

  // alpha: how far between the last step and the next (for smooth motion).
  draw(alpha) {
    const { ctx, w, h, world } = this;
    ctx.fillStyle = '#05080a';
    ctx.fillRect(0, 0, w, h);
    if (!world) return;
    const m = this.map;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, m.x, m.y, m.w, m.h, 8);
    ctx.clip();
    // From here on, draw in world metres.
    ctx.translate(m.x, m.y);
    if (m.rotated) {
      ctx.translate(m.w, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.scale(m.scale, m.scale);
    this.px = 1 / m.scale; // one screen pixel, in metres
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrain, 0, 0, W, H);
    this.drawGrass();
    this.drawSeason();
    this.drawFire();
    this.drawEffects(false);
    this.drawAnimals(alpha);
    this.drawEffects(true);
    ctx.restore();
    ctx.strokeStyle = 'rgba(150, 220, 160, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRect(ctx, m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1, 8);
    ctx.stroke();
    this.drawChart();
  }

  // Grazed ground: a brownish veil where grass is short, refreshed a few times a second.
  drawGrass() {
    const { world } = this;
    if (this.grassTimer <= 0) {
      this.grassTimer = 0.25;
      const d = this.grassImage.data;
      const { grass, ash, terrain } = world;
      for (let i = 0; i < COLS * ROWS; i++) {
        const o = i * 4;
        if (terrain.water[i]) {
          d[o + 3] = 0;
          continue;
        }
        const cap = Math.max(0.001, terrain.fert[i] * GRASS_MAX);
        const short = 1 - clamp01(grass[i] / cap);
        if (ash[i] > 0) {
          d[o] = 40;
          d[o + 1] = 36;
          d[o + 2] = 32;
          d[o + 3] = Math.round(220 * clamp01(ash[i] / 30));
        } else {
          d[o] = 150;
          d[o + 1] = 118;
          d[o + 2] = 72;
          d[o + 3] = Math.round(190 * clamp01((short - 0.2) / 0.8) ** 1.2);
        }
      }
      this.grassCtx.putImageData(this.grassImage, 0, 0);
    }
    this.ctx.drawImage(this.grassCanvas, 0, 0, W, H);
  }

  drawSeason() {
    const { ctx, world } = this;
    const s = season(world.day);
    const t = s.t * 4 - s.index;
    // Blend into the next season over the last quarter of each one.
    const k = clamp01((t - 0.75) / 0.25);
    const c = mix(TINTS[s.index], TINTS[(s.index + 1) % 4], k);
    ctx.fillStyle = `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${c[3]})`;
    ctx.fillRect(0, 0, W, H);
    if (world.drought > 0) {
      ctx.fillStyle = 'rgba(255, 190, 90, 0.08)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawFire() {
    const { ctx, world } = this;
    if (!world.burning) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < COLS * ROWS; i++) {
      const b = world.burn[i];
      if (b <= 0) continue;
      const x = ((i % COLS) + 0.5) * CELL;
      const y = (Math.floor(i / COLS) + 0.5) * CELL;
      const flicker = this.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(this.time * 17 + i * 1.7);
      const r = CELL * (0.9 + 0.5 * b) * flicker;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255, 220, 120, ${0.8 * b})`);
      g.addColorStop(0.5, `rgba(255, 110, 30, ${0.45 * b})`);
      g.addColorStop(1, 'rgba(255, 60, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  drawAnimals(alpha) {
    const { ctx, world, px } = this;
    const pos = (a) => [lerp(a.px, a.x, alpha), lerp(a.py, a.y, alpha)];
    // Body length in metres, but never smaller than a few screen pixels.
    const unit = Math.max(4.5, 3.2 * px);

    if (this.showHunts) {
      const byId = new Map();
      for (const g of world.grazers) byId.set(g.id, g);
      ctx.lineWidth = px;
      for (const a of world.hunters) {
        if (a.state !== 'chase' && a.state !== 'stalk') continue;
        const prey = byId.get(a.target);
        if (!prey) continue;
        const [x0, y0] = pos(a);
        const [x1, y1] = pos(prey);
        ctx.strokeStyle = a.state === 'chase' ? 'rgba(255, 90, 70, 0.6)' : 'rgba(255, 150, 120, 0.25)';
        ctx.setLineDash(a.state === 'chase' ? [] : [3 * px, 3 * px]);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    for (const a of world.grazers) {
      const [x, y] = pos(a);
      const young = a.age < SPECIES.grazer.mature ? 0.65 : 1;
      const len = unit * (0.75 + 0.35 * a.genes.size) * young;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a.heading);
      ctx.globalAlpha = a.hidden ? 0.6 : 1;
      ctx.fillStyle = a.state === 'flee' ? '#ffffff' : grazerColor(a.genes.hue);
      ctx.beginPath();
      ctx.ellipse(0, 0, len, len * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = grazerColor(a.genes.hue, 58);
      ctx.beginPath();
      ctx.arc(len * 0.85, 0, len * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const a of world.hunters) {
      const [x, y] = pos(a);
      const young = a.age < SPECIES.hunter.mature ? 0.7 : 1;
      const len = unit * (1.1 + 0.4 * a.genes.size) * young;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a.heading);
      if (a.state === 'chase' && !this.reducedMotion) {
        ctx.shadowColor = hunterColor(a.genes.hue, 60);
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = hunterColor(a.genes.hue, a.state === 'rest' ? 44 : 58);
      ctx.strokeStyle = 'rgba(20, 5, 5, 0.85)';
      ctx.lineWidth = 1.2 * px;
      ctx.beginPath();
      ctx.moveTo(len * 1.2, 0);
      ctx.lineTo(-len * 0.8, len * 0.62);
      ctx.lineTo(-len * 0.45, 0);
      ctx.lineTo(-len * 0.8, -len * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawEffects(top) {
    const { ctx, px } = this;
    const k = px; // effects are sized in screen pixels
    for (const e of this.effects) {
      const p = e.t / e.life;
      if (e.kind === 'kill' && top) {
        ctx.strokeStyle = `hsla(${hunterHue(e.hue)}, 90%, 60%, ${0.9 * (1 - p)})`;
        ctx.lineWidth = (2 * (1 - p) + 0.6) * px;
        ctx.beginPath();
        ctx.arc(e.x, e.y, (5 + 14 * p) * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 70, 60, ${0.5 * (1 - p)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 3 * k * (1 - p * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'birth' && top) {
        ctx.strokeStyle = e.sp === 'hunter' ? `rgba(255, 140, 110, ${0.8 * (1 - p)})` : `rgba(255, 255, 230, ${0.55 * (1 - p)})`;
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.arc(e.x, e.y, (2 + 7 * p) * k, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === 'death' && !top) {
        ctx.fillStyle = e.sp === 'hunter' ? `rgba(90, 40, 40, ${0.7 * (1 - p)})` : `rgba(70, 70, 70, ${0.55 * (1 - p)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 2.4 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Population history: grass cover (area), grazers and hunters (lines, each on its own
  // scale), with year boundaries.
  drawChart() {
    const { ctx, world } = this;
    const c = this.chart;
    const hist = world.history;
    if (c.w < 120 || hist.length < 2) return;
    ctx.save();
    ctx.fillStyle = 'rgba(6, 14, 12, 0.72)';
    ctx.strokeStyle = 'rgba(150, 220, 160, 0.18)';
    ctx.beginPath();
    roundRect(ctx, c.x, c.y, c.w, c.h, 6);
    ctx.fill();
    ctx.stroke();
    const pad = 6;
    const x0 = c.x + pad;
    const y0 = c.y + 16;
    const cw = c.w - pad * 2;
    const ch = c.h - 20;
    // The window grows with the world, up to six years.
    const span = Math.max(30, Math.min(hist.length, YEAR * 6));
    const first = hist.length - Math.min(hist.length, span);
    const px = (i) => x0 + ((i - first) / (span - 1)) * cw;
    const view = hist.slice(first);
    const gMax = Math.max(60, ...view.map((s) => s.grazers));
    const hMax = Math.max(8, ...view.map((s) => s.hunters));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = first; i < hist.length; i++) {
      if (hist[i].day > 0 && hist[i].day % YEAR === 0) {
        ctx.beginPath();
        ctx.moveTo(px(i), y0);
        ctx.lineTo(px(i), y0 + ch);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(90, 170, 90, 0.22)';
    ctx.beginPath();
    ctx.moveTo(px(first), y0 + ch);
    for (let i = first; i < hist.length; i++) ctx.lineTo(px(i), y0 + ch - hist[i].grass * ch);
    ctx.lineTo(px(hist.length - 1), y0 + ch);
    ctx.fill();
    const line = (key, max, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = first; i < hist.length; i++) {
        const y = y0 + ch - (hist[i][key] / max) * ch;
        if (i === first) ctx.moveTo(px(i), y);
        else ctx.lineTo(px(i), y);
      }
      ctx.stroke();
    };
    line('grazers', gMax, 'rgba(245, 235, 210, 0.95)');
    line('hunters', hMax, 'rgba(255, 100, 80, 0.95)');
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    const last = hist[hist.length - 1];
    let tx = x0;
    const label = (text, color) => {
      ctx.fillStyle = color;
      ctx.fillText(text, tx, c.y + 4);
      tx += ctx.measureText(text).width + 12;
    };
    label(`grazers ${last.grazers}`, 'rgba(245, 235, 210, 0.9)');
    label(`hunters ${last.hunters}`, 'rgba(255, 120, 100, 0.95)');
    label(`grass ${Math.round(last.grass * 100)}%`, 'rgba(130, 200, 130, 0.9)');
    if (c.w > 340) {
      const days = view.length;
      ctx.fillStyle = 'rgba(200, 210, 200, 0.45)';
      ctx.textAlign = 'right';
      ctx.fillText(days >= YEAR * 1.5 ? `last ${Math.round(days / YEAR)} years` : `last ${days} days`, x0 + cw, c.y + 4);
    }
    ctx.restore();
  }
}

// --- terrain painting --------------------------------------------------------------

function sampler(field) {
  return (x, y) => {
    const fx = Math.max(0, Math.min(COLS - 1.001, x - 0.5));
    const fy = Math.max(0, Math.min(ROWS - 1.001, y - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const i = y0 * COLS + x0;
    const a = field[i];
    const b = field[i + 1];
    const c = field[i + COLS];
    const d = field[i + COLS + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// Paints the static landscape once per world at TERRAIN_RES pixels per cell. Shores and
// wood edges come from the continuous height and wetness fields, so they're smooth.
function paintTerrain(t, seed) {
  const cw = COLS * TERRAIN_RES;
  const ch = ROWS * TERRAIN_RES;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const heightF = sampler(t.height);
  const wetF = sampler(t.wet);
  const fertF = sampler(t.fert);
  let r = seed >>> 0 || 1;
  const noise = () => {
    r ^= r << 13;
    r ^= r >>> 17;
    r ^= r << 5;
    return (r >>> 0) / 4294967296;
  };
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const x = (px + 0.5) / TERRAIN_RES;
      const y = (py + 0.5) / TERRAIN_RES;
      const hgt = heightF(x, y);
      const n = noise() * 0.06 - 0.03;
      let rgb;
      if (hgt < 0) {
        const deep = clamp01(-hgt * 6);
        rgb = mix([56, 106, 120], [26, 58, 82], deep);
      } else {
        const f = fertF(x, y);
        const shore = clamp01(1 - hgt * 25);
        let land = mix([124, 120, 72], [62, 122, 58], clamp01(f));
        land = mix(land, [140, 128, 96], clamp01(hgt - 0.6) * 0.8);
        land = mix(land, [176, 166, 124], shore * 0.75);
        const wood = wetF(x, y) - t.woodLine;
        if (wood > 0) land = mix(land, [30, 72, 40], clamp01(0.4 + wood * 12) * 0.8);
        rgb = land;
      }
      const o = (py * cw + px) * 4;
      d[o] = rgb[0] * (1 + n);
      d[o + 1] = rgb[1] * (1 + n);
      d[o + 2] = rgb[2] * (1 + n);
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Tree crowns over the woodland, for texture.
  for (let i = 0; i < COLS * ROWS; i++) {
    if (!t.cover[i]) continue;
    const cx = (i % COLS) * TERRAIN_RES;
    const cy = Math.floor(i / COLS) * TERRAIN_RES;
    for (let k = 0; k < 5; k++) {
      const x = cx + noise() * TERRAIN_RES;
      const y = cy + noise() * TERRAIN_RES;
      if (wetF(x / TERRAIN_RES, y / TERRAIN_RES) < t.woodLine || heightF(x / TERRAIN_RES, y / TERRAIN_RES) < 0.02) continue;
      const g = 50 + noise() * 34;
      ctx.fillStyle = `rgba(${16 + noise() * 18}, ${g}, ${24 + noise() * 16}, 0.9)`;
      ctx.beginPath();
      ctx.arc(x, y, 1.6 + noise() * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

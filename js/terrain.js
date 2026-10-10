// Terrain: a seeded landscape on a grid of cells. Elevation and moisture come from
// layered value noise; low ground floods into lakes, damp ground grows woodland
// (cover that hides grazers from hunters), and fertility sets how much grass a cell
// can carry. DOM-free.

export const CELL = 15; // metres per cell
export const COLS = 80;
export const ROWS = 50;
export const W = COLS * CELL;
export const H = ROWS * CELL;

// Smooth value noise: random values on a coarse lattice, blended with smoothstep.
function valueNoise(rng, cols, rows, scale) {
  const gw = Math.ceil(cols / scale) + 2;
  const gh = Math.ceil(rows / scale) + 2;
  const grid = Float32Array.from({ length: gw * gh }, () => rng.next());
  const out = new Float32Array(cols * rows);
  const s = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const gx = x / scale;
      const gy = y / scale;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = s(gx - x0);
      const ty = s(gy - y0);
      const a = grid[y0 * gw + x0];
      const b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0];
      const d = grid[(y0 + 1) * gw + x0 + 1];
      out[y * cols + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

function fbm(rng, octaves, base) {
  const out = new Float32Array(COLS * ROWS);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(rng, COLS, ROWS, base / 2 ** o);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// Value at quantile q (0..1) of an array.
function quantile(arr, q) {
  const sorted = Float32Array.from(arr).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function makeTerrain(rng) {
  const elev = fbm(rng, 4, 22);
  const moist = fbm(rng, 3, 16);
  const wetness = rng.range(0.05, 0.16); // fraction of the map under water
  const woodland = rng.range(0.08, 0.2); // fraction of the land that is wooded
  const seaLevel = quantile(elev, wetness);
  const n = COLS * ROWS;
  const water = new Uint8Array(n);
  const cover = new Uint8Array(n);
  const fert = new Float32Array(n);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    water[i] = elev[i] < seaLevel ? 1 : 0;
    height[i] = (elev[i] - seaLevel) / (1 - seaLevel);
  }
  // Moisture is boosted next to water, so lakes get green margins.
  const wet = Float32Array.from(moist);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      let near = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < COLS && yy < ROWS && water[yy * COLS + xx]) near = Math.max(near, 1 - Math.hypot(dx, dy) / 4.3);
        }
      }
      wet[y * COLS + x] = Math.min(1, moist[y * COLS + x] + near * 0.35);
    }
  }
  const landWet = [];
  for (let i = 0; i < n; i++) if (!water[i]) landWet.push(wet[i]);
  const woodLine = quantile(landWet, 1 - woodland);
  for (let i = 0; i < n; i++) {
    if (water[i]) continue;
    cover[i] = wet[i] >= woodLine ? 1 : 0;
    // Damp lowland is lush; dry high ground is thin. Woodland floors carry less grass.
    const f = 0.25 + 0.75 * Math.min(1, wet[i] * 1.25) * (1 - 0.45 * Math.max(0, height[i] - 0.5));
    fert[i] = cover[i] ? f * 0.6 : f;
  }
  return { water, cover, fert, height, wet, woodLine, wetness, woodland };
}

export const cellIndex = (x, y) => {
  const cx = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
  const cy = Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)));
  return cy * COLS + cx;
};

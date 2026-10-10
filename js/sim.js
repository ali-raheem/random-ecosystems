// The ecosystem: grass that regrows with the seasons, grazers that eat it, and
// hunters that eat the grazers. Every animal carries genes (speed, sense, size and a
// lineage hue) that mutate when it breeds, so the populations cycle and the traits
// drift in an arms race. DOM-free and fully determined by the seed.

import { createRng } from './rng.js';
import { makeTerrain, cellIndex, CELL, COLS, ROWS, W, H } from './terrain.js';
import { worldName } from './names.js';

export { W, H, CELL, COLS, ROWS };
export const DT = 0.1; // days per simulation step
export const YEAR = 120; // days per year
const STEPS_PER_DAY = Math.round(1 / DT);
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const GRASS_MAX = 10; // grass units a fully fertile cell carries
const GROWTH = 0.09; // per day, towards capacity
const HISTORY_DAYS = 720;
const MAX_GRAZERS = 600;
const MAX_HUNTERS = 120;
const TERRITORY = 130; // metres a breeding hunter keeps clear of others
export const SPRINT = 3; // top speed when fleeing or chasing, × the speed gene
const pounce = (genes) => 18 + genes.speed * 0.35; // a stalking hunter sprints from this close

// Each species: gene ranges, starting genes, and its energy budget.
export const SPECIES = {
  grazer: {
    genes: { speed: [12, 60], sense: [30, 140], size: [0.6, 1.8] },
    start: { speed: 30, sense: 70, size: 1 },
    base: 0.8, // metabolism per day at size 1
    birth: 22, // energy (× size) needed to breed
    cap: 30, // energy (× size) it can store
    mature: 70, // days before it can breed (so not in the season it was born)
    interval: 28, // days between litters
    breeding: [0, 0.55], // the part of the year it breeds in (spring into summer)
    life: 300, // mean lifespan in days
    senseCost: 0.008, // vigilance takes time away from eating
    speedCost: 0.0006, // the upkeep of sprinting muscle
  },
  hunter: {
    genes: { speed: [20, 80], sense: [50, 200], size: [0.7, 2] },
    start: { speed: 45, sense: 100, size: 1.2 },
    base: 0.8,
    birth: 36,
    cap: 55,
    mature: 100,
    interval: 90, // one litter a year
    breeding: [0.05, 0.5],
    life: 420,
    senseCost: 0.004,
    speedCost: 0.00025,
  },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Metabolic cost per day: upkeep grows with size, the muscle for a high top speed
// costs even at rest, moving costs size × speed², and a keener sense costs a little
// too. These trade-offs are what stop every gene running to its maximum.
export function cost(sp, genes, moving) {
  const s = SPECIES[sp];
  return s.base * genes.size ** 0.75 + s.speedCost * genes.size * genes.speed ** 2 + 0.0003 * genes.size * moving * moving + s.senseCost * genes.sense;
}

function mutate(rng, sp, genes, rate = 1) {
  const out = { hue: (genes.hue + rng.gauss() * 14 * rate + 360) % 360 };
  for (const [g, [lo, hi]] of Object.entries(SPECIES[sp].genes)) {
    out[g] = clamp(genes[g] * Math.exp(rng.gauss() * 0.12 * rate), lo, hi);
  }
  return out;
}

export function createWorld(seed) {
  const rng = createRng(seed);
  const terrain = makeTerrain(rng);
  const n = COLS * ROWS;
  const grass = new Float32Array(n);
  for (let i = 0; i < n; i++) grass[i] = terrain.fert[i] * GRASS_MAX * rng.range(0.5, 1);
  const world = {
    seed, rng, terrain, grass,
    name: worldName(rng, terrain),
    burn: new Float32Array(n), // > 0 while a cell is on fire
    ash: new Float32Array(n), // > 0 while burnt ground regrows faster
    day: 0, steps: 0, nextId: 1,
    grazers: [], hunters: [],
    events: [], // drained by the app for the feed
    history: [], // one sample per day
    drought: 0, // days of drought left
    noHunters: 0, // days since the last hunter died
    peaks: { grazer: newPeak(), hunter: newPeak() },
    totals: { born: 0, eaten: 0, starved: 0, aged: 0, burned: 0, chases: 0, attempts: 0, giveups: 0 },
    records: { fastestGrazer: 0, fastestHunter: 0, peakGrazers: 0, peakHunters: 0 },
  };
  const herdHue = rng.range(0, 360);
  for (let i = 0; i < 200; i++) spawn(world, 'grazer', randomLand(world), { ...SPECIES.grazer.start, hue: herdHue }, 0.6);
  const packHue = rng.range(0, 360);
  for (let i = 0; i < 5; i++) spawn(world, 'hunter', randomLand(world), { ...SPECIES.hunter.start, hue: packHue }, 0.6);
  for (const a of world.grazers.concat(world.hunters)) a.age = rng.range(0, SPECIES[a.sp].life * 0.5);
  sample(world);
  return world;
}

function newPeak() {
  return { trend: 0, hi: 0, lo: Infinity, hiDay: 0, loDay: 0 };
}

function randomLand(world, edge = false) {
  const { rng, terrain } = world;
  for (let tries = 0; tries < 200; tries++) {
    const x = edge ? (rng.chance(0.5) ? rng.range(5, 40) : W - rng.range(5, 40)) : rng.range(5, W - 5);
    const y = rng.range(5, H - 5);
    if (!terrain.water[cellIndex(x, y)]) return { x, y };
  }
  return { x: W / 2, y: H / 2 };
}

function spawn(world, sp, pos, genes, mutation = 0, energy) {
  const { rng } = world;
  const g = mutation ? mutate(rng, sp, genes, mutation) : { ...genes };
  const a = {
    id: world.nextId++, sp, x: pos.x, y: pos.y, px: pos.x, py: pos.y,
    heading: rng.range(0, Math.PI * 2), speed: 0,
    genes: g, energy: energy ?? SPECIES[sp].birth * g.size * 0.5,
    age: 0, life: SPECIES[sp].life * rng.range(0.75, 1.25),
    nextBreed: 0, rest: 0, target: null, chase: 0, ignore: 0, state: 'wander', born: world.day,
  };
  (sp === 'grazer' ? world.grazers : world.hunters).push(a);
  return a;
}

// --- spatial hash ---------------------------------------------------------------

const BUCKET = 50;
const BCOLS = Math.ceil(W / BUCKET);
const BROWS = Math.ceil(H / BUCKET);

const bucketOf = (x, y) => clamp(Math.floor(y / BUCKET), 0, BROWS - 1) * BCOLS + clamp(Math.floor(x / BUCKET), 0, BCOLS - 1);

// Buckets of animals, plus each bucket's summed position (for herding).
function buildHash(list) {
  const buckets = Array.from({ length: BCOLS * BROWS }, () => []);
  buckets.centres = Array.from({ length: BCOLS * BROWS }, () => ({ x: 0, y: 0, n: 0 }));
  for (const a of list) {
    const b = bucketOf(a.x, a.y);
    buckets[b].push(a);
    const c = buckets.centres[b];
    if (a.hidden) continue; // herds in woodland leave no trail to follow
    c.x += a.x;
    c.y += a.y;
    c.n++;
  }
  return buckets;
}

function nearest(buckets, x, y, r, accept) {
  let best = null;
  let bestD = r * r;
  const x0 = clamp(Math.floor((x - r) / BUCKET), 0, BCOLS - 1);
  const x1 = clamp(Math.floor((x + r) / BUCKET), 0, BCOLS - 1);
  const y0 = clamp(Math.floor((y - r) / BUCKET), 0, BROWS - 1);
  const y1 = clamp(Math.floor((y + r) / BUCKET), 0, BROWS - 1);
  for (let by = y0; by <= y1; by++) {
    for (let bx = x0; bx <= x1; bx++) {
      for (const b of buckets[by * BCOLS + bx]) {
        const d = (b.x - x) ** 2 + (b.y - y) ** 2;
        if (d < bestD && (!accept || accept(b, d))) {
          bestD = d;
          best = b;
        }
      }
    }
  }
  return best;
}

function forNear(buckets, x, y, r, fn) {
  const x0 = clamp(Math.floor((x - r) / BUCKET), 0, BCOLS - 1);
  const x1 = clamp(Math.floor((x + r) / BUCKET), 0, BCOLS - 1);
  const y0 = clamp(Math.floor((y - r) / BUCKET), 0, BROWS - 1);
  const y1 = clamp(Math.floor((y + r) / BUCKET), 0, BROWS - 1);
  const r2 = r * r;
  for (let by = y0; by <= y1; by++) {
    for (let bx = x0; bx <= x1; bx++) {
      for (const b of buckets[by * BCOLS + bx]) {
        const d = (b.x - x) ** 2 + (b.y - y) ** 2;
        if (d < r2) fn(b, d);
      }
    }
  }
}

// --- seasons and weather ---------------------------------------------------------

export function season(day) {
  const t = (day % YEAR) / YEAR;
  return { index: Math.floor(t * 4), name: SEASONS[Math.floor(t * 4)], t, year: Math.floor(day / YEAR) + 1 };
}

// Growth multiplier: lush in late spring and summer, almost nothing in deep winter.
export function growthRate(world) {
  const t = (world.day % YEAR) / YEAR;
  const seasonal = clamp(0.55 + 0.55 * Math.sin(2 * Math.PI * (t - 0.02)), 0.12, 1);
  return seasonal * (world.drought > 0 ? 0.3 : 1);
}

function weather(world) {
  const { rng } = world;
  const s = season(world.day);
  if (world.drought > 0) {
    world.drought -= DT;
    if (world.drought <= 0) emit(world, 'rain', {});
  } else if (s.name === 'summer' && rng.chance(DT / 260)) {
    world.drought = rng.range(15, 30);
    emit(world, 'drought', { days: Math.round(world.drought) });
  }
  // Wildfires: summer and autumn, likelier in a drought.
  const fireOdds = (s.name === 'summer' || s.name === 'autumn' ? 1 : 0) * (world.drought > 0 ? 4 : 1) / 900;
  if (rng.chance(DT * fireOdds)) {
    for (let tries = 0; tries < 20; tries++) {
      const i = rng.int(0, COLS * ROWS - 1);
      if (!world.terrain.water[i] && world.grass[i] > GRASS_MAX * 0.4) {
        world.burn[i] = 1;
        emit(world, 'fire', { x: (i % COLS + 0.5) * CELL, y: (Math.floor(i / COLS) + 0.5) * CELL });
        break;
      }
    }
  }
}

function grow(world) {
  const { terrain, grass, burn, ash, rng } = world;
  const g = growthRate(world) * GROWTH * DT;
  const n = COLS * ROWS;
  let burning = 0;
  for (let i = 0; i < n; i++) {
    if (terrain.water[i]) continue;
    if (burn[i] > 0) {
      burning++;
      grass[i] *= 0.6;
      burn[i] -= DT * 0.8;
      if (burn[i] <= 0) {
        burn[i] = 0;
        ash[i] = 40;
      } else if (burn[i] < 0.8) {
        // Spread to dry, grassy neighbours; damp woodland and lakes stop it.
        const x = i % COLS;
        const y = Math.floor(i / COLS);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= COLS || yy >= ROWS) continue;
          const j = yy * COLS + xx;
          if (terrain.water[j] || burn[j] > 0 || ash[j] > 0) continue;
          const fuel = grass[j] / GRASS_MAX;
          const damp = terrain.cover[j] ? 0.35 : 1;
          if (rng.chance(DT * 0.9 * fuel * damp * (world.drought > 0 ? 1.6 : 1))) burn[j] = 1;
        }
      }
      continue;
    }
    let rate = g;
    if (ash[i] > 0) {
      ash[i] -= DT;
      rate *= 1.8; // ash is fertile
    }
    const cap = terrain.fert[i] * GRASS_MAX;
    grass[i] += (cap - grass[i]) * rate;
  }
  world.burning = burning;
}

// --- behaviour ------------------------------------------------------------------

function steer(a, dx, dy, dt, turn = 5) {
  const want = Math.atan2(dy, dx);
  let d = want - a.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  a.heading += clamp(d, -turn * dt, turn * dt);
}

function move(world, a, dt) {
  const nx = a.x + Math.cos(a.heading) * a.speed * dt;
  const ny = a.y + Math.sin(a.heading) * a.speed * dt;
  const out = nx < 2 || ny < 2 || nx > W - 2 || ny > H - 2;
  if (out || world.terrain.water[cellIndex(nx, ny)]) {
    // Blocked by the shore or the edge: turn away and try again next step.
    a.heading += (world.rng.chance(0.5) ? 1 : -1) * (Math.PI / 2 + world.rng.range(0, 0.6));
    return;
  }
  a.x = nx;
  a.y = ny;
}

function grazerStep(world, a, hunters, grazers, dt) {
  const { rng, grass, terrain, burn } = world;
  const g = a.genes;
  const here = cellIndex(a.x, a.y);
  const inCover = terrain.cover[here];
  a.fear = Math.max(0, (a.fear ?? 0) - dt / 6);
  // Danger first: a sprinting hunter is noticed at the edge of its senses, a stalking
  // or prowling one only much closer, especially with its head down grazing. And flames.
  const wary = (a.state === 'graze' ? 0.25 : 0.4) * g.sense;
  const threat = nearest(hunters, a.x, a.y, g.sense, (b, d) => b.state === 'chase' || d < wary * wary);
  // It takes a moment to react, longer with its head down.
  if (threat && a.state !== 'flee') {
    a.alarm = (a.alarm ?? 0) + dt;
    if (a.alarm < (a.state === 'graze' ? 0.15 : 0.06)) return;
  }
  a.alarm = 0;
  if (threat || burn[here] > 0) {
    const dx = threat ? a.x - threat.x : rng.range(-1, 1);
    const dy = threat ? a.y - threat.y : rng.range(-1, 1);
    steer(a, dx, dy, dt, 8);
    a.speed = g.speed * SPRINT;
    a.state = 'flee';
    a.fear = 1;
  } else if ((grass[here] > 1.5 || (inCover && a.fear > 0.3 && grass[here] > 0.6)) && a.energy < SPECIES.grazer.cap * g.size) {
    // Graze.
    const bite = Math.max(0, Math.min(grass[here] - 0.5, 3 * g.size * dt));
    grass[here] -= bite;
    a.energy += bite * 2.0;
    a.speed = 0;
    a.state = 'graze';
    a.heading += rng.gauss() * 0.4 * dt * 10;
  } else {
    // Look around for the best grass in reach, with a pull towards the herd.
    let bestScore = -Infinity;
    let bx = 0;
    let by = 0;
    for (let k = 0; k < 5; k++) {
      const ang = a.heading + (k - 2) * 0.7 + rng.gauss() * 0.3;
      const r = g.sense * 0.45;
      const px = a.x + Math.cos(ang) * r;
      const py = a.y + Math.sin(ang) * r;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const c = cellIndex(px, py);
      if (terrain.water[c] || burn[c] > 0) continue;
      // A frightened grazer heads for the trees, where hunters struggle to see it.
      const score = grass[c] + (terrain.cover[c] ? 0.8 + a.fear * 3 : 0) + rng.range(0, 0.5);
      if (score > bestScore) {
        bestScore = score;
        bx = px - a.x;
        by = py - a.y;
      }
    }
    // The herd: the centre of the grazers sharing this patch of ground.
    const herd = grazers.centres[bucketOf(a.x, a.y)];
    const n = herd.n - 1;
    if (n > 0) {
      const len = Math.hypot(bx, by) || 1;
      const hx = (herd.x - a.x) / n;
      const hy = (herd.y - a.y) / n;
      bx = bx / len + clamp(hx / 40, -1, 1) * 0.5;
      by = by / len + clamp(hy / 40, -1, 1) * 0.5;
    }
    if (bestScore > -Infinity || n) steer(a, bx, by, dt, 3);
    a.speed = g.speed * 0.4;
    a.state = 'forage';
  }
  a.hidden = inCover;
}

// Direction (unit vector) to the most promising patch of grazers within a few hundred
// metres: bigger herds count more, further ones less.
function herdScent(grazers, x, y) {
  const bx0 = clamp(Math.floor(x / BUCKET), 0, BCOLS - 1);
  const by0 = clamp(Math.floor(y / BUCKET), 0, BROWS - 1);
  let best = 0;
  let tx = 0;
  let ty = 0;
  for (let by = Math.max(0, by0 - 4); by <= Math.min(BROWS - 1, by0 + 4); by++) {
    for (let bx = Math.max(0, bx0 - 4); bx <= Math.min(BCOLS - 1, bx0 + 4); bx++) {
      const c = grazers.centres[by * BCOLS + bx];
      if (!c.n) continue;
      const cx = c.x / c.n;
      const cy = c.y / c.n;
      const d = Math.hypot(cx - x, cy - y);
      const score = c.n / (1 + d / 80);
      if (score > best && d > 5) {
        best = score;
        tx = (cx - x) / d;
        ty = (cy - y) / d;
      }
    }
  }
  return best ? { dx: tx, dy: ty } : null;
}

function hunterStep(world, a, grazers, hunters, dt) {
  const { rng } = world;
  const g = a.genes;
  if (a.rest > 0) {
    a.rest -= dt;
    a.speed = g.speed * 0.1;
    a.state = 'rest';
    a.heading += rng.gauss() * 0.2;
    return;
  }
  // Grazers in woodland are only seen at close range.
  const prey = nearest(grazers, a.x, a.y, g.sense, (b, d) => !b.dead && b.id !== a.ignore && (!b.hidden || d < (g.sense * 0.2) ** 2));
  if (prey && prey.id !== a.target) a.chase = 0;
  if (prey) {
    a.target = prey.id;
    steer(a, prey.x - a.x, prey.y - a.y, dt, 7);
    const dist2 = (prey.x - a.x) ** 2 + (prey.y - a.y) ** 2;
    if (a.state !== 'chase' && dist2 > pounce(g) ** 2 && !(prey.state === 'flee' && dist2 < (pounce(g) * 2) ** 2)) {
    // Stalk: creep closer, slowly enough not to be noticed early. If the grazer bolts
    // anyway, give chase.
      a.speed = g.speed * 0.6;
      a.state = 'stalk';
      return;
    }
    // A long chase is a losing one: give up on this grazer and get your breath back.
    if (a.state !== 'chase') world.totals.chases++;
    a.chase += dt;
    if (a.chase > 0.9) {
      world.totals.giveups++;
      a.ignore = prey.id;
      a.rest = 0.5;
      a.target = null;
      a.state = 'rest';
      return;
    }
    a.speed = g.speed * SPRINT;
    a.state = 'chase';
    const reach = 4 + 3 * (g.size + prey.genes.size);
    if ((prey.x - a.x) ** 2 + (prey.y - a.y) ** 2 < reach * reach) {
      // The catch: a faster or bigger hunter usually wins; a fast grazer often escapes.
      const p = clamp(0.5 + 1.1 * (g.speed - prey.genes.speed) / (g.speed + prey.genes.speed) + 0.15 * (g.size - prey.genes.size), 0.06, 0.92);
      world.totals.attempts++;
      if (rng.chance(p)) {
        prey.dead = 'eaten';
        a.energy = Math.min(SPECIES.hunter.cap * g.size, a.energy + 18 * prey.genes.size + 0.5 * prey.energy);
        a.rest = 3; // a big meal takes a while
        a.kills = (a.kills ?? 0) + 1;
        world.kills.push({ x: prey.x, y: prey.y, hue: a.genes.hue });
      } else {
        a.rest = 0.4; // winded
        a.ignore = prey.id;
        prey.heading = Math.atan2(prey.y - a.y, prey.x - a.x);
      }
      a.target = null;
      a.state = 'rest';
    }
    return;
  }
  // Prowl: follow the scent of the nearest big herd, keeping some distance from other
  // hunters (loose territories).
  let rx = Math.cos(a.heading);
  let ry = Math.sin(a.heading);
  const scent = herdScent(grazers, a.x, a.y);
  if (scent) {
    rx += scent.dx * 1.5;
    ry += scent.dy * 1.5;
  }
  forNear(hunters, a.x, a.y, 70, (b, d) => {
    if (b === a) return;
    const k = 1 / Math.max(10, Math.sqrt(d));
    rx += (a.x - b.x) * k * 0.05;
    ry += (a.y - b.y) * k * 0.05;
  });
  steer(a, rx, ry, dt, 2);
  a.heading += rng.gauss() * 0.5 * dt * 5;
  a.speed = g.speed * 0.7;
  a.state = 'prowl';
  a.target = null;
}

function live(world, list, dt, territory) {
  const { rng } = world;
  const babies = [];
  for (const a of list) {
    if (a.dead) continue;
    const sp = SPECIES[a.sp];
    a.age += dt;
    a.energy -= cost(a.sp, a.genes, a.speed) * dt;
    if (world.burn[cellIndex(a.x, a.y)] > 0) a.energy -= 6 * dt;
    if (a.energy <= 0) a.dead = world.burn[cellIndex(a.x, a.y)] > 0 ? 'burned' : 'starved';
    else if (a.age > a.life) a.dead = 'aged';
    else if (a.age > sp.mature && a.age > a.nextBreed && a.energy > sp.birth * a.genes.size && inSeason(world, sp) && hasTerritory(a, territory)) {
      a.nextBreed = a.age + sp.interval;
      const max = a.sp === 'grazer' ? MAX_GRAZERS : MAX_HUNTERS;
      if (list.length + babies.length < max) {
        const share = a.energy * 0.42;
        a.energy *= 0.5;
        babies.push({ a, share });
      }
    }
  }
  for (const { a, share } of babies) {
    const pos = { x: a.x + rng.range(-4, 4), y: a.y + rng.range(-4, 4) };
    if (world.terrain.water[cellIndex(pos.x, pos.y)]) continue;
    const child = spawn(world, a.sp, pos, a.genes, 1, share);
    world.births.push({ x: child.x, y: child.y, sp: a.sp });
    world.totals.born++;
  }
}

// Hunters only raise young with a patch of ground to themselves.
function hasTerritory(a, hash) {
  if (!hash) return true;
  return !nearest(hash, a.x, a.y, TERRITORY, (b) => b !== a);
}

function inSeason(world, sp) {
  const t = (world.day % YEAR) / YEAR;
  return t >= sp.breeding[0] && t < sp.breeding[1];
}

function reap(world, list) {
  const alive = [];
  for (const a of list) {
    if (!a.dead) {
      alive.push(a);
      continue;
    }
    world.totals[a.dead]++;
    if (a.dead !== 'eaten') world.deaths.push({ x: a.x, y: a.y, sp: a.sp, why: a.dead });
  }
  return alive;
}

// Migrants keep a world from collapsing for good: if a species dies out, a few
// arrive from beyond the map edge.
function migrate(world) {
  const { rng } = world;
  if (world.grazers.length < 6) {
    const genes = { ...SPECIES.grazer.start, hue: rng.range(0, 360) };
    for (let i = 0; i < 16; i++) spawn(world, 'grazer', randomLand(world, true), genes, 0.8);
    emit(world, 'migrants', { sp: 'grazer', n: 16 });
  }
  if (world.hunters.length === 0) {
    world.noHunters += DT;
    if (world.noHunters > 35 && world.grazers.length > 60) {
      // Whoever moves in is used to prey like the grazers here.
      const prey = means(world.grazers);
      const genes = { ...SPECIES.hunter.start, hue: rng.range(0, 360), speed: clamp(Math.max(SPECIES.hunter.start.speed, prey.speed * 1.4), 20, 80) };
      for (let i = 0; i < 6; i++) spawn(world, 'hunter', randomLand(world, true), genes, 0.8);
      world.noHunters = 0;
      emit(world, 'migrants', { sp: 'hunter', n: 6 });
    }
  } else {
    world.noHunters = 0;
  }
}

function emit(world, type, data) {
  world.events.push({ type, day: world.day, ...data });
}

// One simulation step of DT days.
export function step(world) {
  world.kills = world.kills ?? [];
  world.births = world.births ?? [];
  world.deaths = world.deaths ?? [];
  const before = season(world.day);
  weather(world);
  grow(world);
  // Where everyone was at the start of the step, so the renderer can interpolate.
  for (const a of world.grazers) {
    a.px = a.x;
    a.py = a.y;
  }
  for (const a of world.hunters) {
    a.px = a.x;
    a.py = a.y;
  }
  const hunterHash = buildHash(world.hunters);
  const grazerHash = buildHash(world.grazers);
  for (const a of world.grazers) {
    grazerStep(world, a, hunterHash, grazerHash, DT);
    move(world, a, DT);
  }
  for (const a of world.hunters) {
    hunterStep(world, a, grazerHash, hunterHash, DT);
    move(world, a, DT);
  }
  live(world, world.grazers, DT);
  live(world, world.hunters, DT, buildHash(world.hunters));
  const hadHunters = world.hunters.length;
  const hadGrazers = world.grazers.length;
  world.grazers = reap(world, world.grazers);
  world.hunters = reap(world, world.hunters);
  if (hadHunters && !world.hunters.length) emit(world, 'extinct', { sp: 'hunter' });
  if (hadGrazers >= 6 && world.grazers.length < 6) emit(world, 'extinct', { sp: 'grazer' });
  migrate(world);
  // Count whole steps, so float error never drifts the calendar.
  world.steps++;
  world.day = world.steps * DT;
  const after = season(world.day);
  if (after.index !== before.index) emit(world, 'season', { name: after.name, year: after.year });
  if (world.steps % STEPS_PER_DAY === 0) sample(world);
}

export function means(list) {
  if (!list.length) return null;
  const m = { speed: 0, sense: 0, size: 0 };
  for (const a of list) {
    m.speed += a.genes.speed;
    m.sense += a.genes.sense;
    m.size += a.genes.size;
  }
  for (const k in m) m[k] /= list.length;
  return m;
}

function sample(world) {
  let grass = 0;
  for (let i = 0; i < world.grass.length; i++) grass += world.grass[i];
  const g = means(world.grazers);
  const h = means(world.hunters);
  const s = {
    day: Math.round(world.day),
    grass: grass / (COLS * ROWS * GRASS_MAX),
    grazers: world.grazers.length,
    hunters: world.hunters.length,
    gSpeed: g?.speed ?? null,
    hSpeed: h?.speed ?? null,
  };
  world.history.push(s);
  if (world.history.length > HISTORY_DAYS) world.history.shift();
  trackPeak(world, 'grazer', s.grazers);
  trackPeak(world, 'hunter', s.hunters);
  const r = world.records;
  if (s.grazers > r.peakGrazers) r.peakGrazers = s.grazers;
  if (s.hunters > r.peakHunters) r.peakHunters = s.hunters;
}

// Turning points in a population: a boom is a high it then falls 25% from, a crash a
// low it then rises 25% from. Small wiggles are ignored.
function trackPeak(world, sp, n) {
  const p = world.peaks[sp];
  const floor = sp === 'grazer' ? 40 : 8;
  if (p.trend >= 0) {
    if (n >= p.hi) {
      p.hi = n;
      p.hiDay = world.day;
    } else if (n < p.hi * 0.75 && p.hi >= floor) {
      emit(world, 'boom', { sp, n: p.hi });
      p.trend = -1;
      p.lo = n;
      p.loDay = world.day;
    }
  } else if (n <= p.lo) {
    p.lo = n;
    p.loDay = world.day;
  } else if (n > p.lo * 1.25 + 3) {
    emit(world, 'crash', { sp, n: p.lo });
    p.trend = 1;
    p.hi = n;
    p.hiDay = world.day;
  }
}

// Visual effects the renderer drains each frame.
export function drainEffects(world) {
  const out = { kills: world.kills ?? [], births: world.births ?? [], deaths: world.deaths ?? [] };
  world.kills = [];
  world.births = [];
  world.deaths = [];
  return out;
}

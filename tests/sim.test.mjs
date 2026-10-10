import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step, season, cost, means, DT, YEAR, SPECIES, W, H, COLS, ROWS } from '../js/sim.js';
import { makeTerrain } from '../js/terrain.js';
import { createRng } from '../js/rng.js';

const run = (w, days) => {
  for (let i = 0; i < days / DT; i++) step(w);
};

test('a seed replays the same world exactly', () => {
  const a = createWorld(42);
  const b = createWorld(42);
  run(a, 60);
  run(b, 60);
  assert.equal(a.name, b.name);
  assert.equal(a.grazers.length, b.grazers.length);
  assert.equal(a.hunters.length, b.hunters.length);
  assert.deepEqual(a.grazers.slice(0, 5).map((g) => [g.x, g.y]), b.grazers.slice(0, 5).map((g) => [g.x, g.y]));
  assert.notEqual(createWorld(43).name + createWorld(43).grazers[0].x, a.name + a.grazers[0].x);
});

test('terrain has lakes, woodland and fertile land', () => {
  const t = makeTerrain(createRng(7));
  const n = COLS * ROWS;
  const water = t.water.reduce((s, v) => s + v, 0) / n;
  const cover = t.cover.reduce((s, v) => s + v, 0) / n;
  assert.ok(water > 0.03 && water < 0.2, `water ${water}`);
  assert.ok(cover > 0.04 && cover < 0.25, `cover ${cover}`);
  for (let i = 0; i < n; i++) {
    if (t.water[i]) assert.equal(t.fert[i], 0);
    else assert.ok(t.fert[i] > 0 && t.fert[i] <= 1);
  }
});

test('animals stay on land, inside the map, with genes in range', () => {
  const w = createWorld(5);
  run(w, 150);
  assert.ok(w.grazers.length > 0);
  for (const a of w.grazers.concat(w.hunters)) {
    assert.ok(a.x >= 0 && a.x <= W && a.y >= 0 && a.y <= H);
    for (const [g, [lo, hi]] of Object.entries(SPECIES[a.sp].genes)) {
      assert.ok(a.genes[g] >= lo && a.genes[g] <= hi, `${a.sp} ${g} ${a.genes[g]}`);
    }
  }
});

test('the year runs through four seasons, and a sample is kept each day', () => {
  assert.equal(season(0).name, 'spring');
  assert.equal(season(YEAR * 0.3).name, 'summer');
  assert.equal(season(YEAR * 0.6).name, 'autumn');
  assert.equal(season(YEAR * 0.9).name, 'winter');
  assert.equal(season(YEAR * 1.1).year, 2);
  const w = createWorld(9);
  run(w, 31);
  assert.equal(w.history.length, 32);
  assert.ok(w.events.some((e) => e.type === 'season' && e.name === 'summer'));
});

test('genes trade off against energy', () => {
  const base = { speed: 30, sense: 70, size: 1 };
  assert.ok(cost('grazer', { ...base, speed: 50 }, 0) > cost('grazer', base, 0));
  assert.ok(cost('grazer', { ...base, sense: 120 }, 0) > cost('grazer', base, 0));
  assert.ok(cost('grazer', { ...base, size: 1.5 }, 0) > cost('grazer', base, 0));
  assert.ok(cost('grazer', base, 60) > cost('grazer', base, 0));
});

test('means averages the genes', () => {
  assert.equal(means([]), null);
  const m = means([{ genes: { speed: 10, sense: 20, size: 1 } }, { genes: { speed: 30, sense: 40, size: 2 } }]);
  assert.deepEqual(m, { speed: 20, sense: 30, size: 1.5 });
});

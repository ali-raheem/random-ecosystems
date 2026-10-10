// App wiring: the simulation loop, HUD, narration, controls and offline support.

import { createWorld, step, drainEffects, season, means, DT, SPRINT } from './sim.js';
import { randomSeed } from './rng.js';
import { Renderer, grazerColor, hunterColor } from './render.js';
import { SoundEngine } from './audio.js';
import { VERSION, BUILT } from './version.js';

const DAYS_PER_SECOND = 1; // at 1×
const SPEEDS = [0.5, 1, 2, 4, 8];
const MAX_STEPS = 60; // per frame, so a slow device slows the sim instead of stalling
const HUNTS_KEY = 'eco.hunts';

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('view'), hud: $('hud'), worldCard: $('card-world'), popCard: $('card-pop'),
  dayNo: $('day-no'), clock: $('clock'), meta: $('meta'), seed: $('seed'), feed: $('feed'),
  pause: $('btn-pause'), speed: $('btn-speed'), next: $('btn-next'), controls: $('controls'),
  guide: $('guide'), settings: $('settings'),
  sound: $('set-sound'), hunts: $('set-hunts'), full: $('set-full'), hide: $('set-hide'), install: $('set-install'),
  version: $('version'),
};
const panels = {
  guide: { panel: el.guide, button: $('btn-guide'), onOpen: () => buildGuide() },
  settings: { panel: el.settings, button: $('btn-settings') },
};

const useIcon = (button, name) => button.querySelector('use').setAttribute('href', `#i-${name}`);

const renderer = new Renderer(el.canvas);
const sound = new SoundEngine();
let world = null;
let paused = false;
let speedIndex = 1;
let acc = 0; // sim days banked towards the next step
let hudTimer = 0;
let guideTimer = 0;
let runTime = 0;
let killSoundAt = 0;

try {
  renderer.showHunts = localStorage.getItem(HUNTS_KEY) !== 'off';
} catch { /* keep the default */ }

function seedFromHash(hash = location.hash) {
  const m = hash.match(/seed=([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) >>> 0 : null;
}

const hex = (seed) => seed.toString(16).padStart(8, '0');

function newRun(seed = randomSeed()) {
  world = createWorld(seed);
  world.startGenes = { grazer: means(world.grazers), hunter: means(world.hunters) };
  window.history.replaceState(null, '', `#seed=${hex(seed)}`);
  el.seed.textContent = `seed ${hex(seed)}`;
  el.feed.replaceChildren();
  acc = 0;
  runTime = 0;
  renderer.reset(world);
  el.worldCard.querySelector('.name').textContent = world.name;
  feed(`<b>${world.name}</b> <span class="w">· ${world.grazers.length} grazers and ${world.hunters.length} hunters arrive in spring</span>`, '#b6f08a');
  updateHud();
  if (!el.guide.hidden) buildGuide();
  placePanels();
}

// Panels open below the header; the map and chart stay above the feed and controls.
function placePanels() {
  const top = Math.ceil(el.meta.getBoundingClientRect().bottom) + 10;
  el.hud.style.setProperty('--hud-top', `${top}px`);
  const band = Math.min(el.controls.getBoundingClientRect().top, el.feed.getBoundingClientRect().top);
  renderer.setInsets(top, window.innerHeight - band + 8);
}

// --- HUD ---------------------------------------------------------------------------

function updateHud() {
  const s = season(world.day);
  el.worldCard.querySelector('.season').textContent = `Year ${s.year} · ${s.name}`;
  const weather = [world.drought > 0 ? 'drought' : '', world.burning ? 'wildfire' : ''].filter(Boolean).join(' · ');
  el.worldCard.querySelector('.weather').textContent = weather;
  el.worldCard.querySelector('.bar > i').style.width = `${(s.t * 100).toFixed(1)}%`;
  el.popCard.querySelector('.g').textContent = `${world.grazers.length} grazers`;
  el.popCard.querySelector('.h').textContent = `${world.hunters.length} hunter${world.hunters.length === 1 ? '' : 's'}`;
  const g = means(world.grazers);
  const h = means(world.hunters);
  el.popCard.querySelector('.traits').textContent = `speed ${g ? Math.round(g.speed * SPRINT) : '–'} vs ${h ? Math.round(h.speed * SPRINT) : '–'}`;
  const t = world.totals;
  el.popCard.querySelector('.hunts').textContent = t.chases ? `${Math.round((t.eaten / t.chases) * 100)}% of hunts succeed` : 'no hunts yet';
  el.dayNo.textContent = `Day ${Math.floor(world.day) + 1}`;
  const secs = Math.floor(runTime);
  el.clock.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function feed(html, color) {
  const li = document.createElement('li');
  li.style.setProperty('--c', color);
  li.innerHTML = html;
  el.feed.append(li);
  while (el.feed.children.length > 6) el.feed.firstElementChild.remove();
}

const GRAZER = '#f5ebd2';
const HUNTER = '#ff7a64';

// Where on the map, in words.
function whereabouts(x, y) {
  const ns = y < 250 ? 'north' : y > 500 ? 'south' : '';
  const ew = x < 400 ? 'west' : x > 800 ? 'east' : '';
  return ns || ew ? `in the ${ns}${ns && ew ? '-' : ''}${ew}` : 'in the heart of the land';
}

const pct = (now, then) => {
  const d = Math.round(((now - then) / then) * 100);
  return `${d >= 0 ? '+' : ''}${d}%`;
};

function narrate(e) {
  const s = season(e.day);
  const when = `Y${s.year} ${s.name}`;
  switch (e.type) {
    case 'season':
      if (e.name === 'spring') {
        // A new year: how far evolution has carried each species from its ancestors.
        const g = means(world.grazers);
        const h = means(world.hunters);
        const sg = world.startGenes.grazer;
        const sh = world.startGenes.hunter;
        const bits = [];
        if (g) bits.push(`grazers ${pct(g.speed, sg.speed)} speed, ${pct(g.sense, sg.sense)} senses`);
        if (h) bits.push(`hunters ${pct(h.speed, sh.speed)} speed, ${pct(h.sense, sh.sense)} senses`);
        feed(`<b>Year ${e.year}</b> begins <span class="w">· since the first arrivals: ${bits.join('; ')}</span>`, '#b6f08a');
      } else if (e.name === 'winter') {
        feed(`${when} · <b>winter</b> sets in <span class="w">· the grass stops growing</span>`, '#cfe3ff');
      }
      break;
    case 'boom':
      feed(`${when} · <b>${e.sp === 'grazer' ? 'Grazers' : 'Hunters'} peak</b> at ${e.n} <span class="w">· ${e.sp === 'grazer' ? 'the land can\'t feed them all' : 'too many mouths for the herds'}</span>`, e.sp === 'grazer' ? GRAZER : HUNTER);
      break;
    case 'crash':
      feed(`${when} · <b>${e.sp === 'grazer' ? 'Grazers' : 'Hunters'} bottom out</b> at ${e.n} <span class="w">· and begin to recover</span>`, e.sp === 'grazer' ? GRAZER : HUNTER);
      break;
    case 'extinct':
      feed(`${when} · <b>The last ${e.sp} has died</b>`, e.sp === 'grazer' ? GRAZER : HUNTER);
      break;
    case 'migrants':
      feed(`${when} · <b>${e.n} ${e.sp}s</b> wander in from beyond the hills`, e.sp === 'grazer' ? GRAZER : HUNTER);
      break;
    case 'drought':
      feed(`${when} · <b>Drought</b> <span class="w">· the grass withers for about ${e.days} days</span>`, '#ffd36b');
      break;
    case 'rain':
      feed(`${when} · <b>The rains return</b>`, '#8fd8ff');
      break;
    case 'fire':
      feed(`${when} · <b>Wildfire</b> ${whereabouts(e.x, e.y)} <span class="w">· burnt ground regrows lush</span>`, '#ffb36b');
      break;
    default:
  }
}

// --- field guide ---------------------------------------------------------------

function traitRow(label, key, unit, mult = 1) {
  const g = means(world.grazers);
  const h = means(world.hunters);
  const sg = world.startGenes.grazer;
  const sh = world.startGenes.hunter;
  const cell = (now, then) => {
    if (!now) return '<td class="r">–</td>';
    const d = (now[key] - then[key]) / then[key];
    const cls = Math.abs(d) < 0.03 ? '' : d > 0 ? 'up' : 'down';
    return `<td class="r">${(now[key] * mult).toFixed(key === 'size' ? 2 : 0)}${unit} <span class="${cls}">${pct(now[key], then[key])}</span></td>`;
  };
  return `<tr><td>${label}</td>${cell(g, sg)}${cell(h, sh)}</tr>`;
}

function buildGuide() {
  const t = world.totals;
  const r = world.records;
  const success = t.chases ? Math.round((t.eaten / t.chases) * 100) : 0;
  el.guide.innerHTML = `
    <h2>${world.name}</h2>
    <table>
      <tr><th>gene (mean)</th><th class="r g">grazers</th><th class="r h">hunters</th></tr>
      ${traitRow('top speed', 'speed', '', SPRINT)}
      ${traitRow('senses', 'sense', ' m')}
      ${traitRow('size', 'size', '')}
    </table>
    <p>Change since the first arrivals in brackets. Top speed is in metres per day.</p>
    <h3>So far</h3>
    <p><b>${t.born}</b> born · <b>${t.eaten}</b> eaten · <b>${t.starved}</b> starved · <b>${t.aged}</b> died of old age${t.burned ? ` · <b>${t.burned}</b> lost to fire` : ''}.
      Hunters have made <b>${t.chases}</b> runs at a grazer and <b>${success}%</b> ended in a kill.
      Peak herd ${r.peakGrazers}, peak pack ${r.peakHunters}.</p>
    <div class="legend"><span style="--cc:${grazerColor(60)}">grazer</span><span style="--cc:${hunterColor(10)}">hunter</span><span style="--cc:#2c6034">woodland</span><span style="--cc:#96784a">grazed ground</span></div>
    <h3>How it works</h3>
    <p><b>Grass</b> regrows towards what each patch of ground can carry: lush in spring and summer, barely at all in winter,
      and less in a drought. Damp ground is richer. <b>Woodland</b> grows less grass but hides grazers: hunters only spot them there at close range.</p>
    <p><b>Grazers</b> drift towards the best grass, keep loosely together as herds, and bolt when they notice a hunter, which they
      do late if their head is down. A grazer that has been chased heads for the trees for a while. They breed in spring and early summer.</p>
    <p><b>Hunters</b> follow the scent of the nearest herd, stalk to within pouncing range, then sprint. A long chase is a losing one,
      so they give up after a while. A faster, bigger hunter wins more often, and a kill feeds it for days. They only raise young
      with a territory to themselves.</p>
    <p><b>Genes</b>: every animal carries a top speed, a sensing range, a body size and a lineage colour, and passes them on with small mutations.
      Every gene has a cost: upkeep for a big body and sprinting muscle, the energy spent moving, and time lost to vigilance.
      Natural selection does the rest, so speed and senses drift in an arms race between the two species.</p>
    <p>Because hunters thrive when grazers are plentiful and then eat them down, the two populations rise and fall in
      <b>cycles</b>, with the hunters lagging behind (the chart along the bottom). Real lynx and hares do the same, over about ten years.
      If a species dies out, a few migrants arrive from beyond the map after a while.</p>
    <p>Each world comes from its seed, so a <code>#seed=</code> link replays the same world exactly.</p>`;
}

// --- loop --------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = SPEEDS[speedIndex];
  let effects = null;
  if (!paused) {
    runTime += realDt;
    acc += realDt * speed * DAYS_PER_SECOND;
    let steps = 0;
    while (acc >= DT && steps < MAX_STEPS) {
      step(world);
      acc -= DT;
      steps++;
    }
    if (steps === MAX_STEPS) acc = Math.min(acc, DT);
    for (const e of world.events) narrate(e);
    world.events.length = 0;
    effects = drainEffects(world);
    if (effects.kills.length && speed <= 4 && now - killSoundAt > 300) {
      killSoundAt = now;
      sound.kill();
    }
  }
  renderer.update(paused ? 0 : realDt * speed, realDt, effects);
  renderer.draw(paused ? 1 : Math.min(1, acc / DT));

  hudTimer -= realDt;
  if (hudTimer <= 0) {
    updateHud();
    sound.ambience(season(world.day).index, world.burning ?? 0, 0.25, speed);
    hudTimer = 0.25;
  }
  guideTimer -= realDt;
  if (guideTimer <= 0 && !el.guide.hidden) {
    buildGuide();
    guideTimer = 2;
  }
  requestAnimationFrame(frame);
}

// --- controls ----------------------------------------------------------------------

function setPaused(p) {
  paused = p;
  sound.setPaused(p);
  useIcon(el.pause, paused ? 'play' : 'pause');
  el.pause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  el.pause.setAttribute('aria-pressed', String(paused));
}
function changeSpeed(delta) {
  speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, speedIndex + delta));
  el.speed.textContent = `${SPEEDS[speedIndex]}×`;
}
function cycleSpeed() {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  changeSpeed(0);
}
function showPanel(name) {
  for (const [key, p] of Object.entries(panels)) {
    p.panel.hidden = key !== name;
    p.button.setAttribute('aria-pressed', String(key === name));
  }
  if (name) panels[name].onOpen?.();
}
const togglePanel = (name) => showPanel(panels[name].panel.hidden ? name : null);
const anyPanelOpen = () => Object.values(panels).some((p) => !p.panel.hidden);

function setSwitch(row, on) {
  row.setAttribute('aria-checked', String(on));
}
function toggleHunts() {
  renderer.showHunts = !renderer.showHunts;
  setSwitch(el.hunts, renderer.showHunts);
  try {
    localStorage.setItem(HUNTS_KEY, renderer.showHunts ? 'on' : 'off');
  } catch { /* won't persist */ }
}
function renderSound() {
  setSwitch(el.sound, sound.enabled);
  useIcon(el.sound, sound.enabled ? 'sound' : 'sound-off');
}
function toggleSound() {
  sound.setEnabled(!sound.enabled);
  renderSound();
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
function setHudHidden(hidden) {
  el.hud.classList.toggle('hidden', hidden);
}

el.pause.addEventListener('click', () => setPaused(!paused));
el.speed.addEventListener('click', cycleSpeed);
el.next.addEventListener('click', () => newRun());
for (const [name, p] of Object.entries(panels)) p.button.addEventListener('click', () => togglePanel(name));
el.sound.addEventListener('click', toggleSound);
el.hunts.addEventListener('click', toggleHunts);
el.full.addEventListener('click', toggleFullscreen);
el.hide.addEventListener('click', () => {
  showPanel(null);
  setHudHidden(true);
});
el.seed.addEventListener('click', async () => {
  const label = el.seed.textContent;
  try {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#seed=${hex(world.seed)}`);
    el.seed.textContent = 'link copied';
  } catch {
    el.seed.textContent = 'copy failed';
  }
  setTimeout(() => (el.seed.textContent = label), 1200);
});
document.addEventListener('fullscreenchange', () => setSwitch(el.full, !!document.fullscreenElement));
el.full.hidden = !document.documentElement.requestFullscreen;
renderSound();
setSwitch(el.hunts, renderer.showHunts);
setSwitch(el.full, false);
el.version.textContent = `v${VERSION} · built ${new Date(BUILT).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
el.version.title = BUILT;

// Install: Chromium hands us a deferred prompt; iOS Safari has no install API, so the
// row explains Share → Add to Home Screen instead. Hidden when already installed.
let installPrompt = null;
const runningInstalled = navigator.standalone === true ||
  matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() {
  const hint = el.install.querySelector('small');
  if (installPrompt) hint.textContent = 'adds it to your home screen or desktop; works offline';
  else if (isIOS) hint.textContent = 'in Safari, tap Share, then Add to Home Screen';
  el.install.hidden = runningInstalled || (!installPrompt && !isIOS);
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  el.install.hidden = true;
});
el.install.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') el.install.hidden = true;
  else renderInstall();
});
renderInstall();

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case ' ': setPaused(!paused); break;
    case 'n': case 'N': newRun(); break;
    case '+': case '=': changeSpeed(1); break;
    case '-': case '_': changeSpeed(-1); break;
    case 'g': case 'G': togglePanel('guide'); break;
    case 's': case 'S': togglePanel('settings'); break;
    case 'k': case 'K': toggleHunts(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'm': case 'M': toggleSound(); break;
    case 'h': case 'H': setHudHidden(!el.hud.classList.contains('hidden')); break;
    case 'Escape': if (!anyPanelOpen()) return; showPanel(null); break;
    default: return;
  }
  e.preventDefault();
  wakeHud();
});

// Auto-hide the controls after a few idle seconds so it works as a screensaver. A tap
// while they're hidden only brings them back; the click that follows it is swallowed.
let idleTimer = null;
let swallowClick = false;
function wakeHud() {
  el.hud.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!anyPanelOpen()) el.hud.classList.add('idle');
  }, 4000);
}
window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wakeHud(); });
window.addEventListener('pointerdown', () => {
  swallowClick = el.hud.classList.contains('idle') || el.hud.classList.contains('hidden');
  setHudHidden(false);
  wakeHud();
}, { capture: true });
window.addEventListener('click', (e) => {
  if (swallowClick) {
    e.preventDefault();
    e.stopPropagation();
  }
  swallowClick = false;
}, { capture: true });

for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, () => sound.unlock(), { capture: true });
}

window.addEventListener('resize', () => {
  renderer.resize();
  placePanels();
});
window.addEventListener('hashchange', () => {
  const seed = seedFromHash();
  if (seed !== null && seed !== world.seed) newRun(seed);
});

// Keep the screen awake while the tab is visible.
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* not allowed; fine */ }
}
document.addEventListener('visibilitychange', () => {
  sound.setPaused(document.visibilityState !== 'visible' || paused);
  if (document.visibilityState === 'visible') {
    last = performance.now();
    if (!wakeLock || wakeLock.released) requestWakeLock();
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register(`./sw.js?v=${VERSION}`).catch(() => {});
}

newRun(seedFromHash() ?? randomSeed());
wakeHud();
requestWakeLock();
requestAnimationFrame(frame);


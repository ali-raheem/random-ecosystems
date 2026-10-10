# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Random Ecosystems: a seeded predator–prey simulation (grass, grazers, hunters, with evolving genes) drawn on a canvas, shipped as an offline PWA. It's a sibling of `../Affinity`, `../RSB` and `../RMB` and shares their HUD, controls, panels, seed links, idle fade, service worker and version bump. There is no build step and there are no dependencies; plain ES modules load straight from `index.html`. `README.md` explains what's on screen and the model.

(The parent `../CLAUDE.md` describes the shoryuken.me workspace and its shared-origin rules; the one above that, `~/Workspace/CLAUDE.md`, is an unrelated Rust/Fallout project. Ignore that one here.)

## Commands

```bash
npm test                          # node --test tests/*.test.mjs (the sim tests take a few seconds)
node --test tests/sim.test.mjs    # single file
npm run serve                     # python3 -m http.server 8080
npm run bump                      # bump js/version.js + package.json (-- minor|major)
npm run icons                     # regenerate icons/ from scripts/make_icons.py (Pillow)
```

## Architecture

- `js/terrain.js` (no DOM): the 80×50 grid of 15 m cells (`W`×`H` = 1200×750 m). `makeTerrain(rng)` gives `water`, `cover` (woodland), `fert`, plus the continuous `height`/`wet`/`woodLine` fields the renderer uses for smooth shores.
- `js/sim.js` (no DOM): `createWorld(seed)`, `step(world)` advances `DT` (0.1 day). Grazer and hunter behaviour, energy, breeding, weather, fire, migrants. It pushes narration into `world.events` (the app drains them) and visual effects into `world.kills/births/deaths` (drained by `drainEffects`). It keeps a daily `world.history` sample for the chart, and `px/py` (the previous position) on each animal so the renderer can interpolate between steps. Tunables live in `SPECIES` and the constants at the top.
- `js/render.js`: canvas. It draws the map in world metres through a transform and turns it a quarter turn on tall screens (`layout()` decides). It paints the terrain once per world (`paintTerrain`) and redraws a grazed-grass overlay 4× a second from an 80×50 ImageData.
- `js/app.js`: the loop banks `realDt × speed` days and runs whole steps (capped by `MAX_STEPS` per frame). It narrates events, and also handles the HUD, field guide, controls, install, wake lock and SW registration.
- `js/audio.js`: wind, a seasonal pad, birdsong, kill thuds and fire crackle. Pref in `eco.sound`.
- `js/names.js`: world names.

### Randomness and tuning

`world.rng` (seeded) drives everything in `terrain.js` and `sim.js`, so `#seed=` replays a world exactly; never use `Math.random` there. Renderer and audio randomness is cosmetic.

The balance is fragile: small changes to costs, breeding or hunting flip the system between hunters dying out and grazers being wiped out. Tuned behaviour: a cycle of roughly eight years (hunters rise over 2–3 years, crash the herd, starve, and the herd recovers), with an extinction and migrants only occasionally. After changing anything in `SPECIES`, catch odds, territories or grass growth, run a few seeds for ten years headless, printing yearly min/max populations, before trusting it.

Performance: a step costs ~1 ms with ~500 animals; `MAX_GRAZERS`/`MAX_HUNTERS` cap it.

## Conventions and gotchas

- **Adding or renaming a file:** add it to `ASSETS` in `sw.js` (`tests/assets.test.mjs` fails otherwise), then `npm run bump`.
- **Colours:** grazers are pale (lineage tint at 45% saturation, 82% lightness), hunters red-orange (`hunterHue` keeps them within 350°–50°). Red is for hunting and kills.
- **Layout:** the feed has a fixed CSS height, and `placePanels()` reserves the band above the feed and controls; the chart sits just above that band.
- **Icons:** use the inline SVG sprite in `index.html`, not emoji.
- **Visual checks:** there's no screenshot test. Drive it with Playwright (`../JJUCompanion/node_modules` has it and a Chromium) against `npm run serve`, at 1440×900 and 390×844. Dispatch `+` keydowns to run at 8×.

## Shared origin

To be served at `/eco/` (not deployed yet). The manifest `id` is `/eco/` (never change it once released). localStorage keys use the `eco.` prefix. `sw.js` uses cache prefix `eco-`, handles only requests inside its scope, reads only its own cache (never `caches.match()`), precaches with `cache: 'reload'` and fetches with `cache: 'no-cache'`. See `../CLAUDE.md`.

## Deployment

Not deployed yet. To ship, follow "Adding a new app" in `../CLAUDE.md`, then after `npm test` and `npm run bump` copy only the served files:

```bash
rsync -a --delete --chmod=D755,F644 index.html manifest.webmanifest sw.js css js icons root@185.163.204.17:/var/www/shoryuken.me/eco/
```

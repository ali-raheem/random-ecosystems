// Procedural sound with Web Audio (no files, works offline): wind that rises in winter,
// a soft pad whose chord follows the seasons, birdsong in spring and summer, a low thud
// when a hunter makes a kill, and crackle while a fire burns.

const PREF_KEY = 'eco.sound';
const ROOT = 196; // G3
// Chord per season, in semitones above the root.
const CHORDS = [[0, 4, 7, 14], [0, 4, 9, 16], [0, 3, 7, 10], [0, 7, 15]];

function loadPref() {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function savePref(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch { /* storage unavailable; preference just won't persist */ }
}

export class SoundEngine {
  constructor() {
    this.enabled = loadPref();
    this.paused = false;
    this.ctx = null;
    this.season = -1;
    this.birdTimer = 0;
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running' && !this.paused) this.ctx.resume();
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(comp);

    const len = Math.floor(ctx.sampleRate * 2.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    this.verb.connect(wet).connect(this.master);

    const nlen = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    // Wind: looped noise through a slowly wandering band-pass.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.015;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.07;
    depth.gain.value = 180;
    lfo.connect(depth).connect(this.windFilter.frequency);
    lfo.start();

    // Pad: one sine per chord note, retuned as the seasons change.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.022;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.padGain.connect(lp);
    lp.connect(this.master);
    lp.connect(this.verb);
    this.voices = [0, 1, 2, 3].map(() => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = ROOT;
      g.gain.value = 0;
      o.connect(g).connect(this.padGain);
      o.start();
      return { o, g };
    });

    // Fire crackle: noise bursts through a high band-pass, gated by the fire's size.
    const crackle = ctx.createBufferSource();
    crackle.buffer = this.noiseBuf;
    crackle.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 2500;
    hp.Q.value = 1.5;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    crackle.connect(hp).connect(this.fireGain).connect(this.master);
    crackle.start();
  }

  setEnabled(on) {
    this.enabled = on;
    savePref(on);
    if (on) this.unlock();
    else this.ctx?.suspend();
  }

  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    if (p || !this.enabled) this.ctx.suspend();
    else this.ctx.resume();
  }

  ready() {
    return this.enabled && !this.paused && this.ctx && this.ctx.state === 'running';
  }

  // Called a few times a second with the world's state.
  ambience(seasonIndex, fire, realDt, speed) {
    if (!this.ready()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (seasonIndex !== this.season) {
      this.season = seasonIndex;
      const chord = CHORDS[seasonIndex];
      this.voices.forEach((v, i) => {
        const semis = chord[i];
        v.g.gain.setTargetAtTime(semis === undefined ? 0 : 1 / chord.length, now, 2);
        if (semis !== undefined) v.o.frequency.setTargetAtTime(ROOT * 2 ** (semis / 12), now, 1.5);
      });
      this.windGain.gain.setTargetAtTime(seasonIndex === 3 ? 0.05 : seasonIndex === 2 ? 0.028 : 0.014, now, 3);
    }
    this.fireGain.gain.setTargetAtTime(Math.min(0.05, fire * 0.0025) * (0.6 + Math.random() * 0.8), now, 0.05);
    // Birdsong in spring and summer, less often at high speed.
    if (seasonIndex <= 1 && speed <= 4) {
      this.birdTimer -= realDt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 1.5 + Math.random() * 5;
        this.bird(now);
      }
    }
  }

  bird(t) {
    const ctx = this.ctx;
    const base = 2200 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const at = t + i * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), at);
      o.frequency.exponentialRampToValueAtTime(base * (0.8 + Math.random() * 0.5), at + 0.07);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.012, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.verb);
      o.start(at);
      o.stop(at + 0.1);
    }
  }

  kill() {
    if (!this.ready()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }
}

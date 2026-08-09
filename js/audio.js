// 효과음과 배경음을 Web Audio API로 직접 합성한다.
// 오디오 파일을 하나도 쓰지 않아 저작권 문제가 없고, 필드마다 소리를 변주하기 쉽다.

let ctx = null;
let master = null;        // 전체 볼륨
let sfxBus = null;        // 효과음
let musicBus = null;      // 배경음
let currentMusic = null;  // { nodes: [], stop() }
let currentKey = "";      // 지금 재생 중인 곡 식별자 (같은 곡이면 다시 시작하지 않는다)
let sfxOn = true;
let musicOn = true;

// 브라우저는 사용자가 화면을 한 번 건드리기 전에는 소리를 못 내게 막는다.
export function initAudio({ sfx = true, music = true } = {}) {
  sfxOn = sfx;
  musicOn = music;
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = sfxOn ? 0.9 : 0;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = musicOn ? 0.35 : 0;
  musicBus.connect(master);
}

export function setSfxEnabled(on) {
  sfxOn = on;
  if (sfxBus) rampTo(sfxBus.gain, on ? 0.9 : 0, 0.15);
}

export function setMusicEnabled(on) {
  musicOn = on;
  if (musicBus) rampTo(musicBus.gain, on ? 0.35 : 0, 0.4);
}

export function isReady() { return Boolean(ctx); }

function rampTo(param, value, seconds) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

// ── 기본 재료 ────────────────────────────────────────────────
// 잡음(noise)은 바람·불·타격음의 재료가 된다.
function noiseBuffer(seconds = 2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;   // 살짝 저역이 도는 잡음
    data[i] = last * 3.5;
  }
  return buffer;
}

let sharedNoise = null;
function noiseSource(loop = false) {
  if (!sharedNoise) sharedNoise = noiseBuffer(2);
  const src = ctx.createBufferSource();
  src.buffer = sharedNoise;
  src.loop = loop;
  return src;
}

function envelope(gain, peak, attack, decay, start = ctx.currentTime) {
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
}

// 잡음 한 번 터뜨리기 (타격·바람·폭발의 기본)
function burst({ type = "bandpass", freq = 1200, q = 1, peak = 0.5, attack = 0.005, decay = 0.2, sweepTo = null }) {
  const src = noiseSource();
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  src.connect(filter).connect(gain).connect(sfxBus);
  const now = ctx.currentTime;
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, now + attack + decay);
  envelope(gain, peak, attack, decay, now);
  src.start(now);
  src.stop(now + attack + decay + 0.05);
}

// 음정이 있는 소리 (마법·회복·발사)
function tone({ wave = "sine", from = 440, to = null, peak = 0.25, attack = 0.005, decay = 0.25, delay = 0 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  const start = ctx.currentTime + delay;
  osc.frequency.setValueAtTime(from, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + attack + decay);
  osc.connect(gain).connect(sfxBus);
  envelope(gain, peak, attack, decay, start);
  osc.start(start);
  osc.stop(start + attack + decay + 0.05);
}

// ── 효과음 ───────────────────────────────────────────────────
const SFX = {
  slash:      () => { burst({ freq: 3200, q: 0.8, peak: 0.5, decay: 0.16, sweepTo: 700 }); },
  stab:       () => { burst({ freq: 2600, q: 2, peak: 0.4, decay: 0.09, sweepTo: 1400 }); },
  counter:    () => { burst({ type: "bandpass", freq: 1800, q: 6, peak: 0.5, decay: 0.35 });
                      tone({ wave: "square", from: 900, to: 300, peak: 0.12, decay: 0.2 }); },
  block:      () => { burst({ freq: 900, q: 8, peak: 0.45, decay: 0.4 });
                      tone({ wave: "triangle", from: 520, to: 380, peak: 0.15, decay: 0.35 }); },
  punch_rush: () => { for (let i = 0; i < 5; i += 1) {
                        tone({ wave: "sine", from: 190, to: 60, peak: 0.3, attack: 0.002, decay: 0.09, delay: i * 0.075 });
                      } },
  kick:       () => { tone({ wave: "sine", from: 150, to: 45, peak: 0.42, attack: 0.002, decay: 0.22 });
                      burst({ freq: 1400, peak: 0.2, decay: 0.09 }); },
  grab_throw: () => { burst({ type: "lowpass", freq: 700, peak: 0.35, decay: 0.35 });
                      tone({ wave: "sine", from: 220, to: 70, peak: 0.3, decay: 0.3, delay: 0.18 }); },
  shoot:      () => { tone({ wave: "square", from: 1500, to: 260, peak: 0.22, decay: 0.14 }); },
  throw:      () => { burst({ freq: 1600, q: 1.5, peak: 0.28, decay: 0.22, sweepTo: 500 }); },
  laser:      () => { tone({ wave: "sawtooth", from: 260, to: 2000, peak: 0.16, attack: 0.03, decay: 0.5 });
                      burst({ type: "highpass", freq: 2000, peak: 0.2, decay: 0.45 }); },
  beam_clash: () => { tone({ wave: "sawtooth", from: 300, to: 900, peak: 0.2, attack: 0.1, decay: 0.9 });
                      tone({ wave: "sawtooth", from: 310, to: 880, peak: 0.18, attack: 0.1, decay: 0.9 }); },
  flame:      () => { burst({ type: "lowpass", freq: 1100, peak: 0.5, attack: 0.04, decay: 0.7, sweepTo: 300 }); },
  water_burst:() => { burst({ type: "lowpass", freq: 400, q: 6, peak: 0.5, attack: 0.02, decay: 0.6, sweepTo: 1800 }); },
  bolt:       () => { for (let i = 0; i < 7; i += 1) {
                        const d = i * 0.018;
                        setTimeout(() => burst({ type: "highpass", freq: 2600 + Math.random() * 2500, peak: 0.3, decay: 0.05 }), d * 1000);
                      }
                      tone({ wave: "square", from: 90, to: 40, peak: 0.25, decay: 0.4, delay: 0.05 }); },
  gust:       () => { burst({ type: "bandpass", freq: 700, q: 0.6, peak: 0.4, attack: 0.12, decay: 0.6, sweepTo: 2200 }); },
  quake:      () => { tone({ wave: "sine", from: 70, to: 28, peak: 0.5, attack: 0.01, decay: 0.9 });
                      burst({ type: "lowpass", freq: 300, peak: 0.35, decay: 0.7 }); },
  explosion:  () => { tone({ wave: "sine", from: 110, to: 30, peak: 0.55, attack: 0.005, decay: 1.0 });
                      burst({ type: "lowpass", freq: 1600, peak: 0.55, decay: 0.8, sweepTo: 200 }); },
  cast:       () => { [523, 659, 784, 1047].forEach((f, i) =>
                        tone({ wave: "triangle", from: f, peak: 0.16, attack: 0.01, decay: 0.35, delay: i * 0.06 })); },
  summon:     () => { [262, 330, 392, 523].forEach((f, i) =>
                        tone({ wave: "sawtooth", from: f, peak: 0.12, attack: 0.02, decay: 0.6, delay: i * 0.08 })); },
  charge_up:  () => { tone({ wave: "triangle", from: 150, to: 900, peak: 0.2, attack: 0.5, decay: 0.4 }); },
  heal_aura:  () => { [659, 784, 988].forEach((f, i) =>
                        tone({ wave: "sine", from: f, peak: 0.18, attack: 0.03, decay: 0.7, delay: i * 0.1 })); },
  teleport:   () => { tone({ wave: "sine", from: 1200, to: 180, peak: 0.2, decay: 0.2 });
                      tone({ wave: "sine", from: 180, to: 1200, peak: 0.18, decay: 0.2, delay: 0.2 }); },
  dodge:      () => { burst({ type: "bandpass", freq: 1500, q: 1.2, peak: 0.22, attack: 0.02, decay: 0.2, sweepTo: 600 }); },
  bind:       () => { burst({ type: "bandpass", freq: 2200, q: 5, peak: 0.28, decay: 0.3 }); },
  stealth:    () => { tone({ wave: "sine", from: 700, to: 180, peak: 0.14, attack: 0.05, decay: 0.5 }); },
  taunt:      () => { tone({ wave: "square", from: 500, to: 700, peak: 0.14, decay: 0.12 });
                      tone({ wave: "square", from: 700, to: 500, peak: 0.14, decay: 0.12, delay: 0.14 }); },
  // 화면 조작음
  click:      () => { tone({ wave: "triangle", from: 900, to: 600, peak: 0.1, decay: 0.06 }); },
  win:        () => { [523, 659, 784, 1047].forEach((f, i) =>
                        tone({ wave: "triangle", from: f, peak: 0.2, attack: 0.01, decay: 0.5, delay: i * 0.12 })); },
  lose:       () => { [392, 330, 262].forEach((f, i) =>
                        tone({ wave: "sine", from: f, peak: 0.2, attack: 0.02, decay: 0.6, delay: i * 0.16 })); },
};

export function playSfx(name) {
  if (!ctx || !sfxOn) return;
  if (ctx.state === "suspended") ctx.resume();
  (SFX[name] || SFX.punch_rush)();
}

// ── 배경음 ───────────────────────────────────────────────────
// 필드마다 드론(지속음) + 잡음층 + 간간이 울리는 음으로 분위기를 만든다.
const FIELD_MUSIC = {
  1:  { name: "화산지대",     drone: [55, 82.5], wave: "sawtooth", noise: { type: "lowpass", freq: 320, level: 0.16 }, motif: [110, 131, 98], every: 3.2, moWave: "triangle" },
  2:  { name: "폭우",         drone: [98, 147],  wave: "sine",     noise: { type: "highpass", freq: 1400, level: 0.3 }, motif: [587, 494, 440], every: 2.4, moWave: "sine" },
  3:  { name: "뇌운",         drone: [65, 98],   wave: "sawtooth", noise: { type: "bandpass", freq: 600, level: 0.18 }, motif: [220, 262, 165], every: 2.0, moWave: "square" },
  4:  { name: "모래폭풍",     drone: [73, 110],  wave: "triangle", noise: { type: "bandpass", freq: 900, level: 0.34 }, motif: [294, 349, 262], every: 3.6, moWave: "triangle" },
  5:  { name: "얼어붙은 호수", drone: [131, 196], wave: "sine",     noise: { type: "highpass", freq: 3000, level: 0.12 }, motif: [1047, 1319, 880], every: 2.8, moWave: "sine" },
  6:  { name: "고요한 도서관", drone: [87, 131],  wave: "sine",     noise: { type: "lowpass", freq: 200, level: 0.05 }, motif: [349, 440, 523], every: 4.5, moWave: "triangle" },
  7:  { name: "거울의 방",     drone: [131, 165], wave: "triangle", noise: { type: "highpass", freq: 4000, level: 0.08 }, motif: [1047, 1245, 1568], every: 2.2, moWave: "sine" },
  8:  { name: "그믐밤",       drone: [41, 61.7], wave: "sine",     noise: { type: "lowpass", freq: 260, level: 0.09 }, motif: [131, 156, 117], every: 4.0, moWave: "sine" },
  9:  { name: "성역",         drone: [131, 196, 262], wave: "sine", noise: null, motif: [523, 659, 784], every: 3.4, moWave: "sine" },
  10: { name: "무중력 공간",   drone: [98, 147, 185], wave: "sine", noise: { type: "highpass", freq: 2200, level: 0.07 }, motif: [784, 988, 659], every: 3.0, moWave: "sine" },
  11: { name: "콜로세움",     drone: [82, 123],  wave: "sawtooth", noise: { type: "bandpass", freq: 500, level: 0.14 }, motif: [330, 392, 262], every: 2.6, moWave: "square" },
  12: { name: "안개 골짜기",   drone: [73, 110],  wave: "sine",     noise: { type: "lowpass", freq: 700, level: 0.16 }, motif: [220, 294, 247], every: 3.8, moWave: "sine" },
};

// 메인 화면 BGM. 거울에 반사되는 빛처럼, 밝은 음이 되돌아오는 느낌으로 만들었다.
const TITLE_MUSIC = {
  name: "무지개 반사",
  drone: [131, 196], wave: "triangle",
  noise: { type: "highpass", freq: 3500, level: 0.05 },
  motif: [523, 659, 784, 988, 784, 659], every: 0.42, moWave: "triangle",
};

export function fieldMusicList() {
  return Object.entries(FIELD_MUSIC).map(([id, m]) => ({ id: Number(id), name: m.name }));
}

function startMusic(spec, key) {
  if (!ctx) return;
  if (currentKey === key && currentMusic) return;   // 같은 곡이면 이어서 재생
  stopMusic();
  currentKey = key;
  if (ctx.state === "suspended") ctx.resume();

  const nodes = [];
  const bed = ctx.createGain();
  bed.gain.value = 0;
  bed.connect(musicBus);
  bed.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);   // 부드럽게 들어온다
  nodes.push(bed);

  // 지속음 화음
  for (const freq of spec.drone) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    osc.type = spec.wave;
    osc.frequency.value = freq;
    gain.gain.value = 0.22 / spec.drone.length;
    osc.connect(filter).connect(gain).connect(bed);
    osc.start();
    nodes.push(osc, gain, filter);
  }

  // 잡음층 (비·바람·모래 같은 환경음)
  if (spec.noise) {
    const src = noiseSource(true);
    const filter = ctx.createBiquadFilter();
    filter.type = spec.noise.type;
    filter.frequency.value = spec.noise.freq;
    const gain = ctx.createGain();
    gain.gain.value = spec.noise.level;
    src.connect(filter).connect(gain).connect(bed);
    src.start();
    nodes.push(src, gain, filter);
  }

  // 간간이 울리는 선율
  let step = 0;
  const timer = setInterval(() => {
    if (!musicOn || !ctx) return;
    const freq = spec.motif[step % spec.motif.length];
    step += 1;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = spec.moWave;
    osc.frequency.value = freq;
    osc.connect(gain).connect(bed);
    const now = ctx.currentTime;
    const decay = Math.min(1.6, spec.every * 0.9);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.start(now);
    osc.stop(now + decay + 0.05);
  }, spec.every * 1000);

  currentMusic = {
    stop() {
      clearInterval(timer);
      const now = ctx.currentTime;
      bed.gain.cancelScheduledValues(now);
      bed.gain.setValueAtTime(bed.gain.value, now);
      bed.gain.linearRampToValueAtTime(0, now + 0.6);
      setTimeout(() => nodes.forEach((n) => { try { n.stop?.(); n.disconnect?.(); } catch { /* 이미 정리됨 */ } }), 700);
    },
  };
}

export function playFieldMusic(fieldId) {
  const spec = FIELD_MUSIC[fieldId];
  if (spec) startMusic(spec, `field-${fieldId}`);
}

export function playTitleMusic() {
  startMusic(TITLE_MUSIC, "title");
}

export function stopMusic() {
  currentMusic?.stop();
  currentMusic = null;
  currentKey = "";
}

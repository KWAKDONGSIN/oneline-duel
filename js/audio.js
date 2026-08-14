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
function burst({ type = "bandpass", freq = 1200, q = 1, peak = 0.5, attack = 0.005, decay = 0.2, sweepTo = null, delay = 0 }) {
  const src = noiseSource();
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  src.connect(filter).connect(gain).connect(sfxBus);
  const start = ctx.currentTime + delay;
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, start + attack + decay);
  envelope(gain, peak, attack, decay, start);
  src.start(start);
  src.stop(start + attack + decay + 0.05);
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
  // 히든 기믹 — 무지개 반사.
  // 기를 모으는 상승음 → 일곱 빛깔이 하나씩 열리는 프리즘 아르페지오 → 되돌려 보내는 굉음.
  rainbow:    () => {
    tone({ wave: "triangle", from: 120, to: 1400, peak: 0.24, attack: 0.55, decay: 0.15 });
    burst({ type: "highpass", freq: 1800, peak: 0.16, attack: 0.5, decay: 0.2 });
    // 도-레-미-솔-라-도-미. 7음이 시차를 두고 겹쳐 무지개처럼 번진다.
    [523, 587, 659, 784, 880, 1047, 1319].forEach((f, i) => {
      tone({ wave: "sine", from: f, peak: 0.2, attack: 0.01, decay: 0.9, delay: 0.6 + i * 0.055 });
      tone({ wave: "triangle", from: f * 2, peak: 0.07, attack: 0.01, decay: 0.5, delay: 0.6 + i * 0.055 });
    });
    tone({ wave: "sawtooth", from: 1600, to: 240, peak: 0.22, attack: 0.02, decay: 0.7, delay: 1.05 });
    tone({ wave: "sine", from: 130, to: 34, peak: 0.5, attack: 0.006, decay: 1.2, delay: 1.15 });
    burst({ type: "lowpass", freq: 2200, peak: 0.45, decay: 0.9, sweepTo: 220, delay: 1.15 });
  },
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

// ── 배경음악 ─────────────────────────────────────────────────
// 드론(지속음)만 깔면 아무리 꾸며도 어둡게 들린다. 그래서 실제 게임 BGM처럼
// 베이스 + 화음 + 멜로디가 박자에 맞춰 도는 시퀀서 방식으로 만들었다.

const N = {   // 음이름 → 주파수
  C3: 131, D3: 147, E3: 165, F3: 175, G3: 196, A3: 220, B3: 247,
  C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494,
  C5: 523, D5: 587, E5: 659, F5: 698, G5: 784, A5: 880, B5: 988,
  C6: 1047, D6: 1175, E6: 1319, G6: 1568,
};
const _ = null;   // 쉼표

// 멜로디는 전부 메이저 펜타토닉 계열이라 밝고 경쾌하게 들린다.
const FIELD_MUSIC = {
  1: { name: "화산지대", bpm: 152, lead: "square", bassWave: "triangle",
       bass: [N.C3, N.C3, N.G3, N.C3, N.F3, N.F3, N.C3, N.G3],
       melody: [N.C5, N.E5, N.G5, N.E5, N.C5, N.D5, N.E5, _, N.F5, N.E5, N.D5, N.C5, N.G4, _, N.C5, _],
       noise: { type: "lowpass", freq: 300, level: 0.07 } },
  2: { name: "폭우", bpm: 138, lead: "triangle", bassWave: "sine",
       bass: [N.F3, N.F3, N.C4, N.F3, N.A3, N.A3, N.F3, N.C4],
       melody: [N.A4, N.C5, N.D5, N.F5, N.D5, N.C5, N.A4, _, N.G4, N.A4, N.C5, N.A4, N.F4, _, N.A4, _],
       noise: { type: "highpass", freq: 1600, level: 0.16 } },
  3: { name: "뇌운", bpm: 168, lead: "square", bassWave: "square",
       bass: [N.E3, N.E3, N.B3, N.E3, N.A3, N.A3, N.E3, N.B3],
       melody: [N.E5, N.G5, N.A5, N.G5, N.E5, N.D5, N.E5, _, N.A5, N.G5, N.E5, N.D5, N.E5, _, _, _],
       noise: { type: "bandpass", freq: 700, level: 0.08 } },
  4: { name: "모래폭풍", bpm: 144, lead: "triangle", bassWave: "triangle",
       bass: [N.D3, N.D3, N.A3, N.D3, N.G3, N.G3, N.D3, N.A3],
       melody: [N.D5, N.F5, N.G5, N.A5, N.G5, N.F5, N.D5, _, N.C5, N.D5, N.F5, N.D5, N.A4, _, N.D5, _],
       noise: { type: "bandpass", freq: 1000, level: 0.2 } },
  5: { name: "얼어붙은 호수", bpm: 132, lead: "sine", bassWave: "sine",
       bass: [N.G3, N.G3, N.D4, N.G3, N.C4, N.C4, N.G3, N.D4],
       melody: [N.G5, N.B5, N.D6, N.B5, N.G5, N.A5, N.B5, _, N.C6, N.B5, N.G5, N.E5, N.G5, _, _, _],
       noise: { type: "highpass", freq: 3200, level: 0.07 } },
  6: { name: "고요한 도서관", bpm: 116, lead: "triangle", bassWave: "sine",
       bass: [N.F3, N.F3, N.C4, N.F3, N.D4, N.D4, N.A3, N.C4],
       melody: [N.F4, N.A4, N.C5, N.A4, N.F4, N.G4, N.A4, _, N.C5, N.A4, N.G4, N.F4, N.C5, _, _, _],
       noise: null },
  7: { name: "거울의 방", bpm: 146, lead: "sine", bassWave: "triangle",
       bass: [N.C4, N.C4, N.G3, N.C4, N.E3, N.E3, N.G3, N.C4],
       melody: [N.C6, N.G5, N.E5, N.G5, N.C6, N.D6, N.C6, _, N.G5, N.C6, N.E6, N.C6, N.G5, _, N.C6, _],
       noise: { type: "highpass", freq: 4200, level: 0.05 } },
  8: { name: "그믐밤", bpm: 126, lead: "triangle", bassWave: "sine",
       bass: [N.A3, N.A3, N.E3, N.A3, N.D3, N.D3, N.A3, N.E3],
       melody: [N.A4, N.C5, N.E5, N.C5, N.A4, N.G4, N.A4, _, N.D5, N.E5, N.C5, N.A4, N.E5, _, _, _],
       noise: { type: "lowpass", freq: 400, level: 0.06 } },
  9: { name: "성역", bpm: 128, lead: "sine", bassWave: "sine",
       bass: [N.C4, N.C4, N.G3, N.C4, N.F3, N.F3, N.C4, N.G3],
       melody: [N.C5, N.E5, N.G5, N.C6, N.G5, N.E5, N.G5, _, N.F5, N.E5, N.D5, N.C5, N.G5, _, _, _],
       noise: null },
  10: { name: "무중력 공간", bpm: 140, lead: "sine", bassWave: "triangle",
        bass: [N.D4, N.D4, N.A3, N.D4, N.G3, N.G3, N.A3, N.D4],
        melody: [N.D5, N.A5, N.G5, N.A5, N.D6, N.A5, N.G5, _, N.E5, N.G5, N.A5, N.D6, N.A5, _, _, _],
        noise: { type: "highpass", freq: 2600, level: 0.05 } },
  11: { name: "콜로세움", bpm: 160, lead: "square", bassWave: "square",
        bass: [N.G3, N.G3, N.D4, N.G3, N.C4, N.C4, N.G3, N.D4],
        melody: [N.G5, N.A5, N.B5, N.D6, N.B5, N.A5, N.G5, _, N.D5, N.G5, N.B5, N.G5, N.D6, _, N.G5, _],
        noise: { type: "bandpass", freq: 520, level: 0.07 } },
  12: { name: "안개 골짜기", bpm: 134, lead: "triangle", bassWave: "sine",
        bass: [N.E3, N.E3, N.B3, N.E3, N.A3, N.A3, N.E3, N.B3],
        melody: [N.E5, N.G5, N.A5, N.B5, N.A5, N.G5, N.E5, _, N.D5, N.E5, N.G5, N.E5, N.B4, _, N.E5, _],
        noise: { type: "lowpass", freq: 900, level: 0.09 } },
};

// 보스 테마 7곡. 필드 음악과 달리 보스전 내내 그 보스의 곡이 흐른다.
// 색과 성격이 그대로 소리가 되도록 곡마다 캐릭터를 다르게 잡았다.
const BOSS_MUSIC = {
  1: { name: "🍎 홍옥 — 풋풋한 첫 승부", bpm: 138, lead: "square", bassWave: "triangle",
       // 통통 튀는 씩씩한 신입의 행진
       bass: [N.C3, N.G3, N.C3, N.G3, N.F3, N.C3, N.G3, N.G3],
       melody: [N.C5, _, N.E5, N.G5, N.E5, _, N.C5, _, N.D5, N.E5, N.D5, N.C5, N.E5, _, N.G4, _],
       noise: null },
  2: { name: "🐯 호걸 — 산군의 행차", bpm: 144, lead: "square", bassWave: "square",
       // 낮게 울리는 베이스가 호랑이 걸음, 멜로디는 포효처럼 치솟는다
       bass: [N.G3, N.G3, N.G3, N.D3, N.G3, N.G3, N.B3, N.D3],
       melody: [N.G4, N.B4, N.D5, N.G5, _, N.D5, N.B4, _, N.A4, N.B4, N.D5, N.E5, N.D5, _, N.G4, _],
       noise: { type: "lowpass", freq: 250, level: 0.06 } },
  3: { name: "🍌 미끌 — 능글 스윙", bpm: 128, lead: "triangle", bassWave: "sine",
       // 미끄러지듯 어긋나는 박자, 능청스러운 셋잇단 느낌
       bass: [N.F3, _, N.C4, N.F3, N.A3, _, N.C4, N.A3],
       melody: [N.A4, N.C5, _, N.A4, N.F5, _, N.D5, N.C5, _, N.D5, N.F5, N.D5, _, N.C5, N.A4, _],
       noise: null },
  4: { name: "🥦 브록 장군 — 채소 행진곡", bpm: 120, lead: "square", bassWave: "square",
       // 군가처럼 반듯한 네 박자 행진
       bass: [N.C3, N.C3, N.G3, N.G3, N.C3, N.C3, N.F3, N.G3],
       melody: [N.C5, N.C5, N.G4, N.C5, N.E5, N.E5, N.D5, _, N.E5, N.F5, N.E5, N.D5, N.C5, _, N.G4, _],
       noise: null },
  5: { name: "🌊 해일 — 밀려오는 푸른 벽", bpm: 100, lead: "sine", bassWave: "sine",
       // 느리게 밀려왔다 물러나는 파도의 호흡
       bass: [N.D3, N.A3, N.D4, N.A3, N.G3, N.D4, N.A3, N.G3],
       melody: [N.D5, N.E5, N.G5, N.A5, N.G5, N.E5, N.D5, _, N.E5, N.G5, N.E5, N.D5, N.B4, _, N.D5, _],
       noise: { type: "lowpass", freq: 500, level: 0.12 } },
  6: { name: "🌌 미리내 — 별의 강", bpm: 108, lead: "sine", bassWave: "sine",
       // 높은 음이 별처럼 드문드문 반짝인다
       bass: [N.A3, _, N.E3, _, N.D3, _, N.E3, _],
       melody: [N.A5, _, N.E5, _, N.C6, _, N.A5, N.E5, _, N.D6, _, N.A5, _, N.E6, _, _],
       noise: { type: "highpass", freq: 5000, level: 0.04 } },
  7: { name: "🍇 포도대왕 — 왕의 위엄", bpm: 148, lead: "sawtooth", bassWave: "square",
       // 최종 보스. 무겁게 몰아치는 저음 위로 왕관처럼 번쩍이는 선율
       bass: [N.E3, N.E3, N.B3, N.E3, N.G3, N.G3, N.B3, N.E3],
       melody: [N.E5, N.G5, N.B5, N.E5, N.G5, N.E5, N.B4, _, N.A5, N.G5, N.E5, N.G5, N.B5, _, N.E5, _],
       noise: { type: "lowpass", freq: 300, level: 0.05 } },
};

export function bossMusicList() {
  return Object.entries(BOSS_MUSIC).map(([id, m]) => ({ id: Number(id), name: m.name }));
}

export function playBossMusic(bossId) {
  const spec = BOSS_MUSIC[bossId];
  if (spec) startMusic(spec, `boss-${bossId}`);
}

// 메인 테마. 빛이 거울에 튕겨 되돌아오듯, 올라간 음이 그대로 되돌아오는 선율.
const TITLE_MUSIC = {
  name: "무지개 반사", bpm: 150, lead: "square", bassWave: "triangle",
  bass: [N.C3, N.C3, N.G3, N.C3, N.A3, N.A3, N.F3, N.G3],
  melody: [
    N.C5, N.E5, N.G5, N.C6, N.G5, N.E5, N.C5, _,
    N.A4, N.C5, N.E5, N.A5, N.E5, N.C5, N.A4, _,
  ],
  noise: null,
};

export function fieldMusicList() {
  return Object.entries(FIELD_MUSIC).map(([id, m]) => ({ id: Number(id), name: m.name }));
}

// 짧은 음 하나. 게임 BGM 특유의 통통 튀는 느낌을 위해 감쇠를 빠르게 잡았다.
function playNote(bus, freq, wave, when, duration, peak) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, when);
  osc.connect(gain).connect(bus);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

// 탭을 벗어나면 음악을 끄지만, 돌아왔을 때 무슨 곡이었는지는 기억해야 한다.
// stopMusic이 지우는 currentKey와 달리 이 값은 남는다.
let lastSpec = null;
let lastKey = "";

// 꺼져 있던 음악을 마지막에 듣던 곡으로 되살린다. 이미 나오고 있으면 아무것도 하지 않는다.
export function resumeMusic() {
  if (!ctx || currentMusic || !lastSpec) return;
  startMusic(lastSpec, lastKey);
}

function startMusic(spec, key) {
  if (!ctx) return;
  lastSpec = spec;
  lastKey = key;
  if (currentKey === key && currentMusic) return;   // 같은 곡이면 이어서 재생
  stopMusic();
  currentKey = key;
  if (ctx.state === "suspended") ctx.resume();

  const nodes = [];
  const bed = ctx.createGain();
  bed.gain.value = 0;
  bed.connect(musicBus);
  bed.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6);
  nodes.push(bed);

  // 환경음(비·바람·모래)은 아주 얕게만 깔아 분위기만 남긴다.
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

  const eighth = 30 / spec.bpm;      // 8분음표 길이(초)
  let step = 0;

  const tick = () => {
    if (!ctx || !musicOn) { step += 1; return; }
    const when = ctx.currentTime + 0.02;

    // 베이스는 4분음표마다
    if (step % 2 === 0) {
      const note = spec.bass[(step / 2) % spec.bass.length];
      if (note) playNote(bed, note, spec.bassWave, when, eighth * 1.7, 0.16);
    }
    // 멜로디는 8분음표마다
    const lead = spec.melody[step % spec.melody.length];
    if (lead) playNote(bed, lead, spec.lead, when, eighth * 1.15, 0.1);
    // 두 마디마다 화음을 얹어 밝기를 더한다
    if (step % 16 === 0) {
      const root = spec.bass[0];
      [root * 2, root * 2.5, root * 3].forEach((f) => playNote(bed, f, "triangle", when, eighth * 3, 0.045));
    }
    step += 1;
  };

  tick();
  const timer = setInterval(tick, eighth * 1000);

  currentMusic = {
    stop() {
      clearInterval(timer);
      const now = ctx.currentTime;
      bed.gain.cancelScheduledValues(now);
      bed.gain.setValueAtTime(bed.gain.value, now);
      bed.gain.linearRampToValueAtTime(0, now + 0.4);
      setTimeout(() => nodes.forEach((n) => { try { n.stop?.(); n.disconnect?.(); } catch { /* 이미 정리됨 */ } }), 500);
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

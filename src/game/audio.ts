/**
 * Tiny WebAudio synth — all sound effects are generated at runtime,
 * so the game needs zero audio assets.
 */

let actx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

const MUTE_KEY = "nv:muted";

export function initAudio(): void {
  try {
    if (!actx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.4;
      master.connect(actx.destination);
    }
    if (actx.state === "suspended") void actx.resume();
  } catch {
    /* audio unavailable — game stays silent */
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (master) master.gain.value = m ? 0 : 0.4;
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return !muted;
}

function tone(
  freq: number,
  freqEnd: number | null,
  type: OscillatorType,
  dur: number,
  vol: number
): void {
  if (!actx || !master) return;
  try {
    const t0 = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) {
      o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    }
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  } catch {
    /* ignore */
  }
}

function noiseBurst(
  dur: number,
  vol: number,
  filterType: BiquadFilterType,
  freq: number,
  q = 1
): void {
  if (!actx || !master) return;
  try {
    const t0 = actx.currentTime;
    const len = Math.max(1, Math.floor(actx.sampleRate * dur));
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  } catch {
    /* ignore */
  }
}

export const sfx = {
  shoot: () => tone(760, 190, "square", 0.05, 0.026),
  enemyShoot: () => tone(260, 90, "sawtooth", 0.09, 0.03),
  hit: () => tone(1500, 520, "square", 0.045, 0.03),
  enemyDie: (big: boolean) => {
    noiseBurst(0.2, big ? 0.09 : 0.05, "lowpass", big ? 480 : 1200);
    tone(190, 60, "sawtooth", 0.16, big ? 0.06 : 0.04);
  },
  playerHit: () => {
    tone(230, 55, "sawtooth", 0.22, 0.08);
    noiseBurst(0.14, 0.06, "highpass", 1400);
  },
  death: () => {
    tone(420, 40, "sawtooth", 0.65, 0.1);
    noiseBurst(0.45, 0.09, "lowpass", 380);
  },
  bomb: () => {
    tone(130, 28, "sine", 0.55, 0.12);
    noiseBurst(0.55, 0.12, "lowpass", 280);
  },
  boss: () => {
    tone(165, 165, "sawtooth", 0.4, 0.05);
    setTimeout(() => tone(115, 70, "sawtooth", 0.55, 0.06), 140);
  },
  ui: () => tone(880, 1340, "sine", 0.07, 0.04),
  dash: () => tone(440, 1320, "triangle", 0.12, 0.05),
  join: () => {
    tone(660, 990, "sine", 0.09, 0.05);
    setTimeout(() => tone(990, 1480, "sine", 0.1, 0.05), 90);
  },
  leave: () => tone(520, 260, "sine", 0.15, 0.05),
  pickup: () => {
    tone(700, 1400, "square", 0.06, 0.025);
    setTimeout(() => tone(1050, 2100, "sine", 0.09, 0.04), 60);
  },
  shieldBreak: () => {
    tone(1800, 300, "triangle", 0.2, 0.05);
    noiseBurst(0.12, 0.05, "highpass", 2500);
  },
  enrage: () => {
    tone(90, 50, "sawtooth", 0.7, 0.09);
    setTimeout(() => tone(140, 70, "square", 0.5, 0.05), 120);
  },
  emote: () => tone(1180, 1580, "sine", 0.07, 0.035),
  charge: () => tone(220, 880, "sawtooth", 0.35, 0.04),
  respawn: () => {
    tone(330, 880, "triangle", 0.25, 0.05);
    setTimeout(() => tone(880, 1320, "sine", 0.12, 0.04), 160);
  },
  combo: () => tone(1250, 1900, "sine", 0.06, 0.03),
};

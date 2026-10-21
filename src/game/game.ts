/**
 * NEON VOID — motor del shooter 2D (solo + cooperativo online).
 *
 * Roles:
 *  - "solo":  simulación local, el mundo ocupa la pantalla.
 *  - "host":  simulación autoritativa en un mundo fijo, genera snapshots.
 *  - "guest": renderiza snapshots del anfitrión (interpolados) y predice
 *             localmente el movimiento de su propia nave.
 *
 * Todos los efectos (explosiones, popups, sonidos...) pasan por `emit()`,
 * que los aplica localmente y, en el anfitrión, los replica a los invitados.
 */

import { sfx } from "./audio";
import {
  buildSprites,
  drawSprite,
  DOT_SPR,
  RING_SPR,
  PLAYER_PALETTES,
  PICKUP_DEFS,
  BOSS_DEFS,
  type DotColor,
} from "./sprites";

export interface MatchOpts {
  diff: number; // 0 normal · 1 difícil · 2 pesadilla
  rush: boolean; // jefes sin fin
}

export const DIFF_NAMES = ["NORMAL", "DIFÍCIL", "PESADILLA"];
export const DIFF_SCORE = [1, 1.5, 2];
const DIFF_HP = [1, 1.35, 1.75];
const DIFF_BSPEED = [1, 1.12, 1.25];
const DIFF_SPAWN = [1, 1.2, 1.4];
export const EMOTES = ["👍", "🆘", "🔥", "😂"];
import type { NetMsg } from "./net";

export type Role = "solo" | "host" | "guest";

export interface StartPlayer {
  id: string;
  name: string;
  c: number;
}

export interface HudPlayer {
  id: string;
  name: string;
  c: number;
  hp: number;
  alive: boolean;
  respawn: number;
  kills: number;
  local: boolean;
  revive: number;
}

export interface HudBoss {
  name: string;
  color: string;
  frac: number;
  enraged: boolean;
}

export interface HudState {
  score: number;
  hp: number;
  maxHp: number;
  combo: number;
  multiplier: number;
  comboTimer: number;
  elapsed: number;
  bombCd: number;
  bombReady: boolean;
  dashCd: number;
  dashReady: boolean;
  bossActive: boolean;
  bossHp: number;
  bossMax: number;
  best: number;
  role: Role;
  players: HudPlayer[];
  localAlive: boolean;
  respawnIn: number;
  reviveIn: number; // progreso 0..1 de reanimación del jugador local
  spreadT: number;
  rapidT: number;
  shield: boolean;
  bosses: HudBoss[];
  bossKills: number;
  opts: MatchOpts;
}

export interface RunInfo {
  score: number;
  time: number;
  players: number;
  names: string[];
  bossKills: number;
  diff: number;
  rush: boolean;
}

export interface GameCallbacks {
  onGameOver?: (info: RunInfo) => void;
}

type EnginePhase = "ambient" | "playing" | "dying" | "paused" | "over";
type EnemyKind = "grunt" | "shooter" | "tank" | "boss";
const KINDS: EnemyKind[] = ["grunt", "shooter", "tank", "boss"];

interface TrailPt {
  x: number;
  y: number;
  a: number;
  life: number;
}

interface Player {
  id: string;
  name: string;
  c: number;
  x: number;
  y: number;
  a: number;
  hp: number;
  alive: boolean;
  invuln: number;
  respawnT: number;
  fireCd: number;
  recoil: number;
  fireSide: number;
  dashCd: number;
  dashT: number;
  dashVx: number;
  dashVy: number;
  bombCd: number;
  kills: number;
  spawnSeq: number;
  aimA: number | null;
  lastDashSeq: number;
  lastBombSeq: number;
  trail: TrailPt[];
  tx: number;
  ty: number;
  ta: number;
  netInvuln: boolean;
  spreadT: number;
  rapidT: number;
  shield: number;
  revive: number;
  emote: string;
  emoteT: number;
  emoteCd: number;
}

interface Pickup {
  uid: number;
  type: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface Enemy {
  uid: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  r: number;
  angle: number;
  t: number;
  fireCd: number;
  contactCd: number;
  hitFlash: number;
  seed: number;
  dead: boolean;
  elite: boolean;
  scoreMul: number;
  spawnT: number;
  tx: number;
  ty: number;
  ta: number;
  hpFrac: number;
  btype: number; // tipo de jefe 0..3
  st: number; // estado de IA (Segador: 0 persigue · 1 apunta · 2 carga · 3 recupera)
  stT: number;
  enraged: boolean;
  cvx: number;
  cvy: number;
  aux: number; // temporizador auxiliar (invocar / anillos)
  spin: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  r: number;
  c: number; // color / índice del dueño
  owner: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
  color: DotColor;
  kind: "dot" | "ring";
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  vy: number;
  size: number;
}

interface Banner {
  text: string;
  sub: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

interface Star {
  fx: number;
  fy: number;
  s: number;
  tw: number;
  sp: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NetEvent = any[];

/* ---------------- constantes ---------------- */

const TAU = Math.PI * 2;
const PLAYER_SPEED = 285;
const PLAYER_R = 13;
const MAX_HP = 3;
const FIRE_INTERVAL = 0.14;
const BULLET_SPEED = 780;
const EBULLET_SPEED = 230;
const BOMB_CD = 16;
const DASH_CD = 6;
const COMBO_WINDOW = 1.6;
const RESPAWN_TIME = 10;
const REVIVE_R = 70;
const REVIVE_TIME = 1.6;
const PICKUP_LIFE = 11;
const BUFF_TIME = 10;
const MAX_PARTICLES = 700;
const JOY_R = 64;
export const WORLD_W = 1600;
export const WORLD_H = 1000;

const ENEMY_DEFS: Record<
  EnemyKind,
  { hp: number; r: number; speed: number; score: number; color: string }
> = {
  grunt: { hp: 2, r: 11, speed: 105, score: 10, color: "#e879f9" },
  shooter: { hp: 3, r: 12, speed: 85, score: 25, color: "#fb923c" },
  tank: { hp: 9, r: 19, speed: 58, score: 50, color: "#a78bfa" },
  boss: { hp: 70, r: 36, speed: 42, score: 500, color: "#f87171" },
};

const SPRITE_BASE: Record<EnemyKind, number> = {
  grunt: 64,
  shooter: 64,
  tank: 80,
  boss: 160,
};

const MULT_COLORS = ["#9be7ff", "#ffe066", "#ffa26e", "#ff6ec7", "#ff8787"];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r1 = (v: number) => Math.round(v);
const angLerp = (a: number, b: number, k: number) => {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * k;
};

function vibrate(p: number | number[]): void {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* ignore */
  }
}

function makePlayer(id: string, name: string, c: number, x: number, y: number): Player {
  return {
    id,
    name,
    c: clamp(c, 0, 3),
    x,
    y,
    a: -Math.PI / 2,
    hp: MAX_HP,
    alive: true,
    invuln: 1.5,
    respawnT: 0,
    fireCd: 0,
    recoil: 0,
    fireSide: 0,
    dashCd: 0,
    dashT: 0,
    dashVx: 0,
    dashVy: 0,
    bombCd: 0,
    kills: 0,
    spawnSeq: 0,
    aimA: null,
    lastDashSeq: 0,
    lastBombSeq: 0,
    trail: [],
    tx: x,
    ty: y,
    ta: -Math.PI / 2,
    netInvuln: false,
    spreadT: 0,
    rapidT: 0,
    shield: 0,
    revive: 0,
    emote: "",
    emoteT: 0,
    emoteCd: 0,
  };
}

function baseEnemy(
  uid: number,
  kind: EnemyKind,
  x: number,
  y: number,
  hp: number,
  r: number
): Enemy {
  return {
    uid,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    hp,
    maxHp: hp,
    r,
    angle: 0,
    t: Math.random() * 10,
    fireCd: rand(0.8, 1.6),
    contactCd: 0,
    hitFlash: 0,
    seed: Math.random() * 100,
    dead: false,
    elite: false,
    scoreMul: 1,
    spawnT: 0,
    tx: x,
    ty: y,
    ta: 0,
    hpFrac: 1,
    btype: 0,
    st: 0,
    stT: 0,
    enraged: false,
    cvx: 0,
    cvy: 0,
    aux: 0,
    spin: 0,
  };
}

/* ======================= motor ======================= */

export class ShooterGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: GameCallbacks;

  private dpr = 1;
  private w = 320;
  private h = 320;
  private raf = 0;
  private last = 0;
  private running = true;

  phase: EnginePhase = "ambient";
  role: Role = "solo";
  private localId = "local";
  private gameId = 0;

  // mundo / cámara
  private worldW = 320;
  private worldH = 320;
  private scale = 1;
  private camX = 0;
  private camY = 0;

  // jugadores
  private players: Player[] = [];
  private demo: Player = makePlayer("demo", "", 0, 160, 160);

  // entrada local
  private moveX = 0;
  private moveY = 0;
  private aimSX = 0;
  private aimSY = 0;
  private hasAim = false;
  private touchMode = false;
  private joy = { active: false, ox: 0, oy: 0, kx: 0, ky: 0, vx: 0, vy: 0, id: -1 };

  // entidades
  private bullets: Bullet[] = [];
  private ebullets: Bullet[] = [];
  private enemies: Enemy[] = [];
  private parts: Particle[] = [];
  private popups: Popup[] = [];
  private banners: Banner[] = [];
  private stars: Star[] = [];
  private uidSeq = 1;

  // estado de la partida
  private score = 0;
  private combo = 0;
  private mult = 1;
  private lastKill = -100;
  private comboTimerNet = 0;
  private elapsed = 0;
  private spawnAcc = 0;
  private burstTimer = 0;
  private nextBoss = 32;
  private bossActive = false;
  private waveMilestone = 1;
  private best = 0;
  private pickups: Pickup[] = [];
  private opts: MatchOpts = { diff: 0, rush: false };
  private bossCount = 0; // jefes invocados
  private bossKills = 0;

  // red
  private netEvents: NetEvent[] = [];
  private snapSeq = 0;
  private lastSnapSeq = -1;
  private gDashSeq = 0;
  private gBombSeq = 0;
  private lastSfx: Record<string, number> = {};

  // jugo visual
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private flashRed = 0;
  private flashWhite = 0;
  private hitStop = 0;
  private dyingT = 0;
  private ambientT = 0;

  private bgGrad: CanvasGradient | null = null;
  private vigGrad: CanvasGradient | null = null;

  constructor(canvas: HTMLCanvasElement, cb: GameCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cb = cb;
    buildSprites();
    this.makeStars();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
  }

  /* ---------- helpers ---------- */

  private get local(): Player | undefined {
    return this.players.find((p) => p.id === this.localId);
  }

  private get isMP(): boolean {
    return this.role !== "solo";
  }

  private playerName(id: string): string {
    return this.players.find((p) => p.id === id)?.name ?? "";
  }

  /* ---------- ciclo de vida ---------- */

  private resetRun(): void {
    this.score = 0;
    this.combo = 0;
    this.mult = 1;
    this.lastKill = -100;
    this.comboTimerNet = 0;
    this.elapsed = 0;
    this.spawnAcc = 0;
    this.burstTimer = 0;
    this.nextBoss = this.opts.rush ? 4 : 32;
    this.bossActive = false;
    this.waveMilestone = 1;
    this.pickups = [];
    this.bossCount = 0;
    this.bossKills = 0;
    this.dyingT = 0;
    this.bullets = [];
    this.ebullets = [];
    this.enemies = [];
    this.parts = [];
    this.popups = [];
    this.banners = [];
    this.netEvents = [];
    this.lastSnapSeq = -1;
    this.gDashSeq = 0;
    this.gBombSeq = 0;
    this.shake = 0;
    this.flashRed = 0;
    this.flashWhite = 0;
    this.hitStop = 0;
    this.camX = 0;
    this.camY = 0;
    this.best = this.cbBest();
  }

  private cbBest(): number {
    try {
      const raw = JSON.parse(localStorage.getItem("nv:scores:v1") || "[]");
      return Array.isArray(raw) && raw.length
        ? Math.max(...raw.map((e: { score: number }) => Number(e.score) || 0))
        : 0;
    } catch {
      return 0;
    }
  }

  startSolo(name: string): void {
    this.role = "solo";
    this.opts = { diff: 0, rush: false };
    this.localId = "local";
    this.worldW = this.w;
    this.worldH = this.h;
    this.resetRun();
    this.players = [makePlayer("local", name, 0, this.worldW / 2, this.worldH / 2)];
    this.phase = "playing";
    this.addBanner("¡YA!", "", "#67e8f9", 34, 0.9);
  }

  startHost(players: StartPlayer[], localId: string, gameId: number, opts?: MatchOpts): void {
    this.role = "host";
    this.opts = { diff: clamp(Math.floor(opts?.diff ?? 0), 0, 2), rush: !!opts?.rush };
    this.localId = localId;
    this.gameId = gameId;
    this.worldW = WORLD_W;
    this.worldH = WORLD_H;
    this.resetRun();
    this.uidSeq = 1;
    const n = players.length;
    this.players = players.map((p, i) => {
      const a = (i / Math.max(1, n)) * TAU - Math.PI / 2;
      const rr = n > 1 ? 70 : 0;
      return makePlayer(p.id, p.name, p.c, WORLD_W / 2 + Math.cos(a) * rr, WORLD_H / 2 + Math.sin(a) * rr);
    });
    this.snapCamera();
    this.phase = "playing";
    const tags = [DIFF_NAMES[this.opts.diff], this.opts.rush ? "JEFES SIN FIN" : `${n} PILOTO${n > 1 ? "S" : ""}`];
    this.emit([5, "¡YA!", "#67e8f9", 34, tags.join(" · ")]);
  }

  startGuest(players: StartPlayer[], localId: string, gameId: number, opts?: MatchOpts): void {
    this.role = "guest";
    this.opts = { diff: clamp(Math.floor(opts?.diff ?? 0), 0, 2), rush: !!opts?.rush };
    this.localId = localId;
    this.gameId = gameId;
    this.worldW = WORLD_W;
    this.worldH = WORLD_H;
    this.resetRun();
    const n = players.length;
    this.players = players.map((p, i) => {
      const a = (i / Math.max(1, n)) * TAU - Math.PI / 2;
      const rr = n > 1 ? 70 : 0;
      return makePlayer(p.id, p.name, p.c, WORLD_W / 2 + Math.cos(a) * rr, WORLD_H / 2 + Math.sin(a) * rr);
    });
    this.snapCamera();
    this.phase = "playing";
  }

  pause(): void {
    if (this.phase === "playing" && this.role === "solo") this.phase = "paused";
  }

  resume(): void {
    if (this.phase === "paused") this.phase = "playing";
  }

  quit(): void {
    this.phase = "ambient";
    this.role = "solo";
    this.players = [];
    this.enemies = [];
    this.bullets = [];
    this.ebullets = [];
    this.banners = [];
    this.popups = [];
    this.pickups = [];
    this.camX = 0;
    this.camY = 0;
    this.worldW = this.w;
    this.worldH = this.h;
  }

  /** El invitado recibe el fin de partida desde el anfitrión. */
  guestOver(score: number, time: number): void {
    if (this.role !== "guest" || this.phase === "over") return;
    this.score = score;
    this.elapsed = time;
    this.phase = "over";
    this.cb.onGameOver?.(this.runInfo());
  }

  runInfo(): RunInfo {
    return {
      score: this.score,
      time: this.elapsed,
      players: Math.max(1, this.players.length),
      names: this.players.map((p) => p.name),
      bossKills: this.bossKills,
      diff: this.opts.diff,
      rush: this.opts.rush,
    };
  }

  /* ---------- habilidades ---------- */

  triggerDash(): void {
    const p = this.local;
    if (this.phase !== "playing" || !p || !p.alive || p.dashCd > 0) return;
    let dx = this.moveX;
    let dy = this.moveY;
    if (this.joy.active) {
      dx = this.joy.vx;
      dy = this.joy.vy;
    }
    if (Math.hypot(dx, dy) < 0.1) {
      dx = Math.cos(p.a);
      dy = Math.sin(p.a);
    }
    const l = Math.hypot(dx, dy) || 1;
    p.dashVx = (dx / l) * 720;
    p.dashVy = (dy / l) * 720;
    p.dashT = 0.18;
    p.dashCd = DASH_CD;
    p.invuln = Math.max(p.invuln, 0.32);
    this.shake = Math.max(this.shake, 5);
    this.flashWhite = 0.1;
    vibrate(25);
    sfx.dash();
    this.burst(p.x, p.y, PLAYER_PALETTES[p.c].dot, 8, 60, 180, 0.9);
    if (this.role === "guest") this.gDashSeq++;
  }

  triggerBomb(): void {
    const p = this.local;
    if (this.phase !== "playing" || !p || !p.alive || p.bombCd > 0) return;
    if (this.role === "guest") {
      this.gBombSeq++;
      p.bombCd = BOMB_CD; // predicción para la UI, el anfitrión confirma
      return;
    }
    this.doBomb(p);
  }

  private doBomb(p: Player): void {
    if (!p.alive || p.bombCd > 0) return;
    p.bombCd = BOMB_CD;
    const radius = this.isMP ? 560 : Infinity;
    const r2 = radius * radius;
    this.emit([4, r1(p.x), r1(p.y), p.id]);
    this.ebullets = this.ebullets.filter((b) => {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      return dx * dx + dy * dy > r2;
    });
    for (const e of [...this.enemies]) {
      if (e.dead) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy > r2) continue;
      if (e.kind === "boss") {
        e.hp -= Math.ceil(e.maxHp * 0.35);
        e.hitFlash = 0.15;
        if (e.hp <= 0) this.killEnemy(e, p.id);
      } else {
        this.killEnemy(e, p.id);
      }
    }
    if (this.role === "solo") this.hitStop = 0.15;
  }

  /* ---------- API de entrada ---------- */

  setMoveInput(x: number, y: number): void {
    this.moveX = x;
    this.moveY = y;
  }

  setTouchMode(v: boolean): void {
    this.touchMode = v;
    if (!v) {
      this.joy.active = false;
      this.joy.vx = 0;
      this.joy.vy = 0;
    }
  }

  pointerDown(x: number, y: number, id: number): void {
    if (this.touchMode) {
      this.joy.active = true;
      this.joy.id = id;
      this.joy.ox = x;
      this.joy.oy = y;
      this.joy.kx = x;
      this.joy.ky = y;
      this.joy.vx = 0;
      this.joy.vy = 0;
    } else {
      this.aimSX = x;
      this.aimSY = y;
      this.hasAim = true;
    }
  }

  pointerMove(x: number, y: number, id: number): void {
    if (this.touchMode) {
      if (this.joy.active && this.joy.id === id) {
        let dx = x - this.joy.ox;
        let dy = y - this.joy.oy;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) {
          dx = (dx / d) * JOY_R;
          dy = (dy / d) * JOY_R;
        }
        this.joy.kx = this.joy.ox + dx;
        this.joy.ky = this.joy.oy + dy;
        this.joy.vx = dx / JOY_R;
        this.joy.vy = dy / JOY_R;
      }
    } else {
      this.aimSX = x;
      this.aimSY = y;
      this.hasAim = true;
    }
  }

  pointerUp(id: number): void {
    if (this.joy.active && this.joy.id === id) {
      this.joy.active = false;
      this.joy.vx = 0;
      this.joy.vy = 0;
    }
  }

  /* ---------- red: anfitrión ---------- */

  addPlayer(sp: StartPlayer): void {
    if (this.role !== "host" || this.players.some((p) => p.id === sp.id)) return;
    const anchor = this.players.find((p) => p.alive) ?? { x: WORLD_W / 2, y: WORLD_H / 2 };
    const p = makePlayer(sp.id, sp.name, sp.c, anchor.x + rand(-60, 60), anchor.y + rand(-60, 60));
    p.invuln = 2.5;
    this.players.push(p);
    this.emit([7, r1(p.x), r1(p.y), p.id]);
    this.emit([5, `${sp.name} SE UNE`, PLAYER_PALETTES[p.c].hex, 20, ""]);
  }

  removePlayer(id: string): void {
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    this.players = this.players.filter((x) => x.id !== id);
    if (this.phase === "playing" || this.phase === "dying") {
      this.emit([5, `${p.name} SE DESCONECTÓ`, "#94a3b8", 18, ""]);
    }
  }

  applyRemoteInput(id: string, m: NetMsg): void {
    if (this.role !== "host" || m.g !== this.gameId) return;
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    if (p.alive && m.ss === p.spawnSeq && Number.isFinite(m.x) && Number.isFinite(m.y)) {
      p.x = clamp(m.x, PLAYER_R, this.worldW - PLAYER_R);
      p.y = clamp(m.y, PLAYER_R, this.worldH - PLAYER_R);
    }
    if (Number.isFinite(m.a)) p.aimA = m.a / 100;
    if (m.dq > p.lastDashSeq) {
      p.lastDashSeq = m.dq;
      if (p.alive) {
        p.invuln = Math.max(p.invuln, 0.34);
        p.dashCd = DASH_CD;
      }
    }
    if (m.bq > p.lastBombSeq) {
      p.lastBombSeq = m.bq;
      this.doBomb(p);
    }
  }

  getSnapshot(): NetMsg {
    const ph = this.phase === "dying" ? 1 : this.phase === "over" ? 2 : 0;
    const ct =
      this.combo > 0 ? Math.max(0, COMBO_WINDOW - (this.elapsed - this.lastKill)) : 0;
    const ev = this.netEvents;
    this.netEvents = [];
    return {
      t: "s",
      q: ++this.snapSeq,
      g: this.gameId,
      ph,
      el: Math.round(this.elapsed * 10) / 10,
      sc: this.score,
      cb: this.combo,
      mu: this.mult,
      ct: Math.round(ct * 100),
      P: this.players.map((p) => [
        p.id,
        r1(p.x),
        r1(p.y),
        r1(p.a * 100),
        p.hp,
        p.alive ? 1 : 0,
        p.invuln > 0 ? 1 : 0,
        Math.ceil(p.respawnT * 10),
        Math.ceil(p.bombCd * 10),
        p.spawnSeq,
        p.kills,
        p.c,
        p.name,
        Math.ceil(p.spreadT * 10),
        Math.ceil(p.rapidT * 10),
        p.shield,
        Math.round(p.revive * 100),
      ]),
      E: this.enemies.map((e) => [
        e.uid,
        KINDS.indexOf(e.kind),
        r1(e.x),
        r1(e.y),
        r1(e.angle * 100),
        Math.round((e.hp / e.maxHp) * 100),
        e.elite ? 1 : 0,
        e.hitFlash > 0 ? 1 : 0,
        Math.round(Math.max(0, e.spawnT) * 100),
        Math.round(e.r),
        e.btype,
        (e.st === 1 ? 1 : 0) | (e.enraged ? 2 : 0) | (e.st === 2 ? 4 : 0),
      ]),
      B: this.bullets.map((b) => [r1(b.x), r1(b.y), r1(Math.atan2(b.vy, b.vx) * 100), b.c]),
      Q: this.ebullets.map((b) => [
        r1(b.x),
        r1(b.y),
        r1(Math.atan2(b.vy, b.vx) * 100),
        r1(Math.hypot(b.vx, b.vy)),
      ]),
      K: this.pickups.map((k) => [k.uid, k.type, r1(k.x), r1(k.y), Math.ceil(k.life * 10)]),
      bk: this.bossKills,
      V: ev,
    };
  }

  /* ---------- emotes ---------- */

  /** Emote del jugador local. Devuelve true si se envió (para que el invitado lo mande por red). */
  triggerEmote(idx: number): boolean {
    const p = this.local;
    if (!p || this.phase === "ambient" || !EMOTES[idx]) return false;
    if (p.emoteCd > 0) return false;
    p.emoteCd = 0.8;
    if (this.role === "guest") {
      this.showEmote(p.id, idx);
      return true;
    }
    this.emit([9, p.id, idx]);
    return true;
  }

  /** El anfitrión recibe un emote de un invitado y lo replica a los demás. */
  remoteEmote(id: string, idx: number): void {
    if (this.role !== "host" || !EMOTES[idx]) return;
    const p = this.players.find((q) => q.id === id);
    if (!p || p.emoteCd > 0) return;
    p.emoteCd = 0.8;
    this.emit([9, id, idx]);
  }

  private showEmote(id: string, idx: number): void {
    const p = this.players.find((q) => q.id === id);
    if (!p) return;
    p.emote = EMOTES[idx] ?? "";
    p.emoteT = 2.2;
    sfx.emote();
  }

  /* ---------- red: invitado ---------- */

  getGuestInput(): NetMsg | null {
    const p = this.local;
    if (this.role !== "guest" || !p) return null;
    return {
      t: "i",
      g: this.gameId,
      x: r1(p.x),
      y: r1(p.y),
      a: r1(p.a * 100),
      ss: p.spawnSeq,
      dq: this.gDashSeq,
      bq: this.gBombSeq,
    };
  }

  applySnapshot(s: NetMsg): void {
    if (this.role !== "guest" || s.g !== this.gameId) return;
    if (s.q <= this.lastSnapSeq) return;
    this.lastSnapSeq = s.q;

    if (this.phase !== "over") {
      this.phase = s.ph === 1 ? "dying" : "playing";
    }
    this.elapsed = s.el;
    this.score = s.sc;
    this.combo = s.cb;
    this.mult = s.mu;
    this.comboTimerNet = s.ct / 100;

    // jugadores
    const seen = new Set<string>();
    for (const row of s.P as NetEvent[]) {
      const [id, x, y, a, hp, alive, inv, resp, bomb, ss, kills, c, name, spr, rap, shd, rev] = row;
      seen.add(id);
      let p = this.players.find((q) => q.id === id);
      if (!p) {
        p = makePlayer(id, name, c, x, y);
        p.spawnSeq = ss;
        this.players.push(p);
      }
      p.name = name;
      p.c = c;
      p.hp = hp;
      p.netInvuln = !!inv;
      p.respawnT = resp / 10;
      p.kills = kills;
      p.spreadT = (spr || 0) / 10;
      p.rapidT = (rap || 0) / 10;
      p.shield = shd || 0;
      p.revive = (rev || 0) / 100;
      const wasAlive = p.alive;
      p.alive = !!alive;
      if (id === this.localId) {
        p.bombCd = bomb / 10;
        if (p.spawnSeq !== ss || (!p.alive && wasAlive)) {
          p.spawnSeq = ss;
          p.x = x;
          p.y = y;
          p.trail = [];
        }
        if (!p.alive) {
          p.x = x;
          p.y = y;
        }
      } else {
        p.tx = x;
        p.ty = y;
        p.ta = a / 100;
        if (p.spawnSeq !== ss || !p.alive) {
          p.spawnSeq = ss;
          p.x = x;
          p.y = y;
          p.trail = [];
        }
      }
    }
    this.players = this.players.filter((p) => seen.has(p.id));
    this.bossKills = s.bk || 0;

    // enemigos
    const map = new Map<number, Enemy>();
    for (const e of this.enemies) map.set(e.uid, e);
    const next: Enemy[] = [];
    for (const row of s.E as number[][]) {
      const [uid, k, x, y, a, hpf, elite, flash, spawnT, rr, bt, flags] = row;
      let e = map.get(uid);
      if (!e) {
        e = baseEnemy(uid, KINDS[k] ?? "grunt", x, y, 100, rr);
        e.angle = a / 100;
        e.elite = !!elite;
        e.btype = bt || 0;
      }
      e.tx = x;
      e.ty = y;
      e.ta = a / 100;
      e.hpFrac = hpf / 100;
      e.hp = hpf;
      e.maxHp = 100;
      e.r = rr;
      e.spawnT = spawnT / 100;
      e.btype = bt || 0;
      e.st = flags & 1 ? 1 : flags & 4 ? 2 : 0;
      e.enraged = !!(flags & 2);
      if (flash) e.hitFlash = 0.1;
      next.push(e);
    }
    this.enemies = next;
    this.bossActive = next.some((e) => e.kind === "boss");

    // proyectiles (se extrapolan cada frame)
    this.bullets = (s.B as number[][]).map(([x, y, a, c]) => ({
      x,
      y,
      vx: Math.cos(a / 100) * BULLET_SPEED,
      vy: Math.sin(a / 100) * BULLET_SPEED,
      life: 0.3,
      r: 4,
      c,
      owner: "",
    }));
    this.ebullets = (s.Q as number[][]).map(([x, y, a, sp]) => ({
      x,
      y,
      vx: Math.cos(a / 100) * (sp || EBULLET_SPEED),
      vy: Math.sin(a / 100) * (sp || EBULLET_SPEED),
      life: 0.5,
      r: 4.5,
      c: 0,
      owner: "",
    }));

    // power-ups
    this.pickups = ((s.K as number[][]) || []).map(([uid, type, x, y, life]) => ({
      uid,
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      life: life / 10,
    }));

    for (const ev of (s.V as NetEvent[]) || []) this.applyEvent(ev);
  }

  /* ---------- HUD ---------- */

  getHud(): HudState {
    const lp = this.local;
    const boss = this.enemies.find((e) => e.kind === "boss" && !e.dead);
    const comboTimer =
      this.role === "guest"
        ? this.comboTimerNet
        : this.combo > 0
          ? Math.max(0, COMBO_WINDOW - (this.elapsed - this.lastKill))
          : 0;
    return {
      score: this.score,
      hp: lp ? Math.max(0, lp.hp) : 0,
      maxHp: MAX_HP,
      combo: this.combo,
      multiplier: this.mult,
      comboTimer,
      elapsed: this.elapsed,
      bombCd: lp ? clamp(lp.bombCd / BOMB_CD, 0, 1) : 0,
      bombReady: !!lp && lp.bombCd <= 0,
      dashCd: lp ? clamp(lp.dashCd / DASH_CD, 0, 1) : 0,
      dashReady: !!lp && lp.dashCd <= 0,
      bossActive: !!boss,
      bossHp: boss ? (this.role === "guest" ? boss.hpFrac * 100 : boss.hp) : 0,
      bossMax: boss ? (this.role === "guest" ? 100 : boss.maxHp) : 1,
      best: Math.max(this.best, 0),
      role: this.role,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        c: p.c,
        hp: Math.max(0, p.hp),
        alive: p.alive,
        respawn: p.respawnT,
        kills: p.kills,
        local: p.id === this.localId,
        revive: p.revive,
      })),
      localAlive: !!lp?.alive,
      respawnIn: lp && !lp.alive ? lp.respawnT : 0,
      reviveIn: lp && !lp.alive ? lp.revive : 0,
      spreadT: lp?.spreadT ?? 0,
      rapidT: lp?.rapidT ?? 0,
      shield: !!lp && lp.shield > 0,
      bosses: this.enemies
        .filter((e) => e.kind === "boss" && !e.dead)
        .map((e) => ({
          name: BOSS_DEFS[e.btype]?.name ?? "JEFE",
          color: BOSS_DEFS[e.btype]?.color ?? "#f87171",
          frac: this.role === "guest" ? e.hpFrac : e.hp / e.maxHp,
          enraged: e.enraged,
        })),
      bossKills: this.bossKills,
      opts: { ...this.opts },
    };
  }

  /* ---------- setup ---------- */

  private resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || 320));
    const h = Math.max(320, Math.round(rect.height || 320));
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(9_000_000 / (w * h)));
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);

    if (this.role === "solo") {
      this.worldW = w;
      this.worldH = h;
    }

    const g1 = this.ctx.createLinearGradient(0, 0, 0, h);
    g1.addColorStop(0, "#0a1128");
    g1.addColorStop(0.55, "#060a1c");
    g1.addColorStop(1, "#03040c");
    this.bgGrad = g1;

    const vg = this.ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.35,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.75
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(2,4,12,.62)");
    this.vigGrad = vg;
  };

  private makeStars(): void {
    this.stars = [];
    for (let i = 0; i < 110; i++) {
      this.stars.push({
        fx: Math.random(),
        fy: Math.random(),
        s: rand(1, 2.2),
        tw: rand(0, TAU),
        sp: rand(0.5, 2),
      });
    }
  }

  /* ---------- cámara ---------- */

  private viewScale(): number {
    if (!this.isMP) return 1;
    return clamp(Math.min(this.w, this.h) / 680, 0.5, 1);
  }

  private camTarget(): { x: number; y: number } {
    const lp = this.local;
    let t: { x: number; y: number } = lp ?? { x: this.worldW / 2, y: this.worldH / 2 };
    if (lp && !lp.alive) {
      const mate = this.players.find((p) => p.alive);
      if (mate) t = mate;
    }
    const vw = this.w / this.scale;
    const vh = this.h / this.scale;
    const x = vw >= this.worldW ? (this.worldW - vw) / 2 : clamp(t.x - vw / 2, 0, this.worldW - vw);
    const y = vh >= this.worldH ? (this.worldH - vh) / 2 : clamp(t.y - vh / 2, 0, this.worldH - vh);
    return { x, y };
  }

  private snapCamera(): void {
    this.scale = this.viewScale();
    const t = this.camTarget();
    this.camX = t.x;
    this.camY = t.y;
  }

  private updateCamera(dt: number): void {
    this.scale = this.viewScale();
    if (!this.isMP) {
      this.camX = 0;
      this.camY = 0;
      return;
    }
    const t = this.camTarget();
    const k = 1 - Math.exp(-9 * dt);
    this.camX += (t.x - this.camX) * k;
    this.camY += (t.y - this.camY) * k;
  }

  private aimWorld(): { x: number; y: number } {
    return { x: this.aimSX / this.scale + this.camX, y: this.aimSY / this.scale + this.camY };
  }

  /* ---------- bucle principal ---------- */

  private loop = (now: number): void => {
    if (!this.running) return;
    const dt = clamp((now - this.last) / 1000, 0.001, 0.05);
    this.last = now;
    if (Math.abs(this.canvas.clientWidth - this.w) > 1 || Math.abs(this.canvas.clientHeight - this.h) > 1) {
      this.resize();
    }
    if (this.phase === "ambient") this.updateAmbient(dt);
    else if (this.role === "guest") this.updateGuest(dt);
    else this.update(dt);
    this.updateCamera(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private decayFx(dt: number): void {
    this.shake = Math.max(0, this.shake * Math.exp(-6 * dt));
    if (this.shake > 0.05) {
      this.shakeX = (Math.random() * 2 - 1) * this.shake;
      this.shakeY = (Math.random() * 2 - 1) * this.shake;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    this.flashRed = Math.max(0, this.flashRed - dt * 2.5);
    this.flashWhite = Math.max(0, this.flashWhite - dt * 3.5);
    for (let i = this.banners.length - 1; i >= 0; i--) {
      this.banners[i].life -= dt;
      if (this.banners[i].life <= 0) this.banners.splice(i, 1);
    }
  }

  /* ---------- simulación (solo / anfitrión) ---------- */

  private update(dtRaw: number): void {
    if (this.phase === "paused" || this.phase === "over") {
      this.decayFx(dtRaw);
      this.updateParticles(dtRaw);
      this.updatePopups(dtRaw);
      return;
    }

    if (this.phase === "dying") {
      this.dyingT += dtRaw;
      const sdt = dtRaw * 0.25;
      this.elapsed += sdt;
      this.updateEnemies(sdt, true);
      this.updateBullets(sdt, true);
      this.updateParticles(dtRaw);
      this.updatePopups(dtRaw);
      this.decayFx(dtRaw);
      if (this.dyingT >= 1.5) {
        this.phase = "over";
        this.cb.onGameOver?.(this.runInfo());
      }
      return;
    }

    let dt = dtRaw;
    if (this.hitStop > 0) {
      dt = dtRaw * 0.12;
      this.hitStop -= dtRaw;
    }

    this.elapsed += dt;
    const wv = Math.floor(this.elapsed / 30) + 1;
    if (wv > this.waveMilestone) {
      this.waveMilestone = wv;
      this.emit([5, `OLEADA ${wv}`, "#67e8f9", 26, "LOS ENEMIGOS SE ENDURECEN"]);
    }

    this.updateSpawns(dt);
    for (const p of this.players) this.updatePlayerSim(p, dt);
    this.updateEnemies(dt, false);
    this.updateBullets(dt, false);
    this.updatePickups(dt);
    this.updateParticles(dt);
    this.updatePopups(dt);
    this.decayFx(dtRaw);

    if (!this.players.some((p) => p.alive) && this.players.length > 0) {
      this.phase = "dying";
      this.dyingT = 0;
    }
  }

  private updateTrail(p: Player, dt: number): void {
    p.trail.unshift({ x: p.x, y: p.y, a: p.a, life: 0.22 });
    if (p.trail.length > 8) p.trail.pop();
    for (const t of p.trail) t.life -= dt;
    while (p.trail.length && p.trail[p.trail.length - 1].life <= 0) p.trail.pop();
  }

  /** Movimiento de la nave local (lo usan el anfitrión, el solo y el invitado). */
  private moveLocal(p: Player, dt: number): void {
    let mx = this.moveX;
    let my = this.moveY;
    if (this.joy.active) {
      mx = this.joy.vx;
      my = this.joy.vy;
    }
    const il = Math.hypot(mx, my);
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.dashVx * dt;
      p.y += p.dashVy * dt;
      p.dashVx *= 1 - 4 * dt;
      p.dashVy *= 1 - 4 * dt;
    } else if (il > 0) {
      const m = Math.min(1, il);
      p.x += (mx / il) * PLAYER_SPEED * m * dt;
      p.y += (my / il) * PLAYER_SPEED * m * dt;
    }
    p.x = clamp(p.x, PLAYER_R + 2, this.worldW - PLAYER_R - 2);
    p.y = clamp(p.y, PLAYER_R + 2, this.worldH - PLAYER_R - 2);

    if (!this.touchMode && this.hasAim) {
      const a = this.aimWorld();
      p.a = Math.atan2(a.y - p.y, a.x - p.x);
    } else {
      const ne = this.autoTarget(p.x, p.y);
      if (ne) p.a = Math.atan2(ne.y - p.y, ne.x - p.x);
      else if (il > 0) p.a = Math.atan2(my, mx);
    }
  }

  /** Auto-apuntado: el más cercano, pero priorizando jefes y élites. */
  private autoTarget(x: number, y: number): Enemy | null {
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > 760) continue;
      const score = d - (e.kind === "boss" ? 180 : e.elite ? 60 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best ?? this.nearestEnemy(x, y);
  }

  private updatePlayerSim(p: Player, dt: number): void {
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.bombCd = Math.max(0, p.bombCd - dt);
    p.spreadT = Math.max(0, p.spreadT - dt);
    p.rapidT = Math.max(0, p.rapidT - dt);
    p.emoteCd = Math.max(0, p.emoteCd - dt);
    p.emoteT -= dt;
    p.recoil = Math.max(0, p.recoil - dt * 7);
    p.invuln -= dt;

    if (!p.alive) {
      p.trail = [];
      if (!this.isMP) return;
      // reanimación: compañeros vivos junto a los restos
      let helpers = 0;
      let reviver: Player | null = null;
      for (const q of this.players) {
        if (!q.alive || q === p) continue;
        if (Math.hypot(q.x - p.x, q.y - p.y) < REVIVE_R) {
          helpers++;
          reviver = q;
        }
      }
      if (helpers > 0) p.revive += (dt / REVIVE_TIME) * (1 + 0.5 * (helpers - 1));
      else p.revive = Math.max(0, p.revive - dt * 0.4);
      if (p.revive >= 1 && reviver) {
        this.respawnPlayer(p, p.x, p.y, 2);
        this.emit([12, p.id, reviver.id]);
        return;
      }
      if (p.respawnT > 0) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          const mate = this.players.find((q) => q.alive && q !== p);
          if (mate) {
            this.respawnPlayer(
              p,
              clamp(mate.x + rand(-50, 50), 30, this.worldW - 30),
              clamp(mate.y + rand(-50, 50), 30, this.worldH - 30),
              MAX_HP
            );
          } else {
            p.respawnT = 0.5;
          }
        }
      }
      return;
    }

    if (p.id === this.localId) {
      this.moveLocal(p, dt);
    } else if (p.aimA !== null) {
      p.a = p.aimA;
    }
    this.updateTrail(p, dt);

    p.fireCd -= dt;
    if (p.fireCd <= 0) {
      this.fire(p);
      p.fireCd = p.rapidT > 0 ? FIRE_INTERVAL * 0.55 : FIRE_INTERVAL;
    }
  }

  private respawnPlayer(p: Player, x: number, y: number, hp: number): void {
    p.alive = true;
    p.hp = hp;
    p.invuln = 2.2;
    p.x = x;
    p.y = y;
    p.spawnSeq++;
    p.dashT = 0;
    p.revive = 0;
    p.respawnT = 0;
    this.emit([7, r1(p.x), r1(p.y), p.id]);
  }

  private fire(p: Player): void {
    const triple = p.spreadT > 0;
    const angles = triple ? [p.a - 0.17, p.a, p.a + 0.17] : [p.a];
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    const perpX = Math.cos(p.a + Math.PI / 2);
    const perpY = Math.sin(p.a + Math.PI / 2);
    p.fireSide ^= 1;
    const off = triple ? 0 : p.fireSide ? 8 : -8;
    const bx = p.x + c * (PLAYER_R + 2) + perpX * off;
    const by = p.y + s * (PLAYER_R + 2) + perpY * off;
    for (const a of angles) {
      this.bullets.push({
        x: bx,
        y: by,
        vx: Math.cos(a) * BULLET_SPEED,
        vy: Math.sin(a) * BULLET_SPEED,
        life: 1.0,
        r: 4,
        c: p.c,
        owner: p.id,
      });
    }
    p.recoil = 1;
    if (p.id === this.localId) this.muzzle(p, bx, by);
  }

  private muzzle(p: Player, bx: number, by: number): void {
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    const col = p.c === 0 ? "yellow" : PLAYER_PALETTES[p.c].dot;
    this.parts.push(
      { x: bx + c * 8, y: by + s * 8, vx: c * 60, vy: s * 60, life: 0.07, maxLife: 0.07, r: 5, color: col, kind: "dot" },
      { x: bx, y: by, vx: 0, vy: 0, life: 0.09, maxLife: 0.09, r: 3.2, color: "white", kind: "dot" }
    );
    sfx.shoot();
  }

  private nearestEnemy(x: number, y: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private nearestPlayer(x: number, y: number): Player | null {
    let best: Player | null = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private updateSpawns(dt: number): void {
    const n = Math.max(1, this.players.length);
    const crowd = (1 + 0.45 * (n - 1)) * DIFF_SPAWN[this.opts.diff];
    const rush = this.opts.rush;
    const bosses = this.enemies.filter((e) => e.kind === "boss" && !e.dead).length;
    this.spawnAcc += dt;
    let interval = Math.max(0.32, 1.05 - this.elapsed * 0.012) / crowd;
    if (rush) interval *= bosses > 0 ? 2.6 : 1.6;
    else if (bosses > 0) interval *= 1.4;
    let want = 0;
    if (this.spawnAcc >= interval) {
      this.spawnAcc = 0;
      want = 1;
    }
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      this.burstTimer = rush ? 6 : 4.2;
      want += Math.round((2 + Math.floor(Math.random() * 3)) * crowd * (rush ? 0.6 : 1));
    }
    const maxEnemies = Math.min(12 + this.elapsed * 0.55, 46) * (1 + 0.4 * (n - 1));
    while (want-- > 0 && this.enemies.length < maxEnemies) this.spawnEnemy();

    if (bosses === 0 && this.elapsed >= this.nextBoss) {
      // en "jefes sin fin" con equipo, desde la 2ª ronda llegan por parejas
      const pair = rush && n >= 2 && this.bossCount >= 4;
      const types = [this.bossCount % 4];
      if (pair) types.push((this.bossCount + 1) % 4);
      for (const t of types) this.spawnBoss(n, t);
      this.bossCount += types.length;
      this.nextBoss = Infinity; // se reprograma al caer el último jefe
      this.emit([8]);
      const names = types.map((t) => BOSS_DEFS[t].name).join(" + ");
      this.emit([5, "¡¡ALERTA!!", "#f87171", 28, `${names} SE ACERCA${types.length > 1 ? "N" : ""}`]);
    }
  }

  private spawnPoint(margin: number): { x: number; y: number } {
    if (!this.isMP) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) return { x: Math.random() * this.worldW, y: -margin };
      if (side === 1) return { x: this.worldW + margin, y: Math.random() * this.worldH };
      if (side === 2) return { x: Math.random() * this.worldW, y: this.worldH + margin };
      return { x: -margin, y: Math.random() * this.worldH };
    }
    const alive = this.players.filter((p) => p.alive);
    for (let tries = 0; tries < 6; tries++) {
      const anchor = alive[Math.floor(Math.random() * alive.length)] ?? { x: WORLD_W / 2, y: WORLD_H / 2 };
      const a = Math.random() * TAU;
      const d = rand(420, 640);
      const x = clamp(anchor.x + Math.cos(a) * d, 30, this.worldW - 30);
      const y = clamp(anchor.y + Math.sin(a) * d, 30, this.worldH - 30);
      if (alive.every((p) => Math.hypot(p.x - x, p.y - y) > 260)) return { x, y };
    }
    return { x: Math.random() * this.worldW, y: Math.random() < 0.5 ? 30 : this.worldH - 30 };
  }

  private spawnEnemy(kindArg?: EnemyKind, at?: { x: number; y: number }): Enemy {
    const t = this.elapsed;
    const hpScale = (1 + t * 0.016) * DIFF_HP[this.opts.diff];
    let kind: EnemyKind = kindArg ?? "grunt";
    if (!kindArg) {
      const roll = Math.random();
      const tankW = t > 22 ? 0.16 : 0;
      const shooterW = t > 8 ? 0.3 : 0;
      if (roll < tankW) kind = "tank";
      else if (roll < tankW + shooterW) kind = "shooter";
    }
    const pos = at ?? this.spawnPoint(50);
    const def = ENEMY_DEFS[kind];
    const elite = !at && Math.random() < 0.12;
    const hp = Math.max(
      1,
      Math.ceil(def.hp * hpScale * (kind === "grunt" ? rand(0.8, 1.4) : 1) * (elite ? 2 : 1))
    );
    const e = baseEnemy(this.uidSeq++, kind, pos.x, pos.y, hp, elite ? def.r * 1.15 : def.r);
    e.elite = elite;
    e.scoreMul = elite ? 3 : at ? 0.5 : 1;
    e.spawnT = this.isMP ? (at ? 0.35 : 0.7) : at ? 0.25 : 0;
    this.enemies.push(e);
    return e;
  }

  private spawnBoss(n: number, type: number): void {
    const def = BOSS_DEFS[type] ?? BOSS_DEFS[0];
    const cycle = Math.floor(this.bossCount / 4);
    // vida acotada: crece con el tiempo y el equipo, pero sin volverse una esponja
    const hp = Math.ceil(
      def.hp *
        Math.min(1 + this.elapsed * 0.006, 1.8) *
        (1 + 0.55 * (n - 1)) *
        DIFF_HP[this.opts.diff] *
        (1 + 0.3 * cycle)
    );
    const pos = this.isMP
      ? this.spawnPoint(0)
      : { x: this.worldW / 2 + rand(-120, 120), y: -140 };
    const e = baseEnemy(this.uidSeq++, "boss", pos.x, pos.y, hp, def.r);
    e.btype = type;
    e.angle = Math.PI / 2;
    e.t = 0;
    e.fireCd = 1.4;
    e.aux = 2;
    e.stT = 1.5;
    e.spawnT = this.isMP ? 1 : 0;
    this.enemies.push(e);
    this.bossActive = true;
  }

  private updateEnemies(dt: number, passive: boolean): void {
    const sepR = 36;
    const n = this.enemies.length;
    for (let i = 0; i < n; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      e.t += dt;
      e.hitFlash -= dt;
      e.contactCd -= dt;
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        continue;
      }
      const target = passive ? null : this.nearestPlayer(e.x, e.y);
      if (target) {
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d;
        const uy = dy / d;
        const def = ENEMY_DEFS[e.kind];
        const speed = def.speed * Math.min(1 + this.elapsed * 0.004, 1.55);

        if (e.kind === "grunt") {
          e.vx = ux * speed;
          e.vy = uy * speed;
          e.angle = Math.atan2(uy, ux);
        } else if (e.kind === "shooter") {
          let ax = 0;
          let ay = 0;
          if (d > 270) {
            ax = ux;
            ay = uy;
          } else if (d < 210) {
            ax = -ux;
            ay = -uy;
          }
          ax += -uy * 0.75;
          ay += ux * 0.75;
          const al = Math.hypot(ax, ay) || 1;
          e.vx = (ax / al) * speed;
          e.vy = (ay / al) * speed;
          e.angle = Math.atan2(uy, ux);
          e.fireCd -= dt;
          if (e.fireCd <= 0 && d < 560) {
            e.fireCd = rand(1.1, 1.7);
            this.fireEnemyBullet(e, target, 0);
          }
        } else if (e.kind === "tank") {
          e.vx = ux * speed * 0.85;
          e.vy = uy * speed * 0.85;
          e.angle = Math.atan2(uy, ux) + Math.sin(e.t * 1.2 + e.seed) * 0.35;
        } else {
          this.updateBoss(e, d, ux, uy, dt);
        }
      } else {
        const drag = 1 - 0.5 * dt;
        e.vx *= drag;
        e.vy *= drag;
      }

      let sx = 0;
      let sy = 0;
      if (!(e.kind === "boss" && e.st === 2)) {
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const o = this.enemies[j];
          const ddx = e.x - o.x;
          const ddy = e.y - o.y;
          const dd = ddx * ddx + ddy * ddy;
          if (dd < sepR * sepR && dd > 0.01) {
            const dl = Math.sqrt(dd);
            const f = ((sepR - dl) / dl) * 110 * dt;
            sx += ddx * f;
            sy += ddy * f;
          }
        }
      }
      e.x += (e.vx + sx) * dt;
      e.y += (e.vy + sy) * dt;
      if (e.kind === "boss" && (this.isMP || e.t > 3)) {
        e.x = clamp(e.x, e.r, this.worldW - e.r);
        e.y = clamp(e.y, e.r, this.worldH - e.r);
      } else if (this.isMP) {
        e.x = clamp(e.x, -40, this.worldW + 40);
        e.y = clamp(e.y, -40, this.worldH + 40);
      }

      if (!passive) {
        for (const p of this.players) {
          if (!p.alive) continue;
          const cdx = e.x - p.x;
          const cdy = e.y - p.y;
          if (cdx * cdx + cdy * cdy < (e.r + PLAYER_R) * (e.r + PLAYER_R)) {
            if (e.kind === "grunt") {
              this.damagePlayer(p, 1);
              this.killEnemy(e, "");
              break;
            } else if (e.contactCd <= 0) {
              e.contactCd = 0.7;
              this.damagePlayer(p, 1);
            }
          }
        }
      }
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) this.enemies.splice(i, 1);
    }
  }

  /* ---------- IA de jefes ---------- */

  private updateBoss(e: Enemy, d: number, ux: number, uy: number, dt: number): void {
    const def = BOSS_DEFS[e.btype] ?? BOSS_DEFS[0];
    if (!e.enraged && e.hp / e.maxHp <= 0.5) {
      e.enraged = true;
      e.st = 0;
      e.stT = 0.8;
      this.emit([11, r1(e.x), r1(e.y), e.btype]);
    }
    const speed = def.speed * (e.enraged ? 1.3 : 1);
    const bs = EBULLET_SPEED * DIFF_BSPEED[this.opts.diff];
    const aim = Math.atan2(uy, ux);

    switch (e.btype) {
      case 1: {
        // VÓRTICE: orbita a media distancia y dispara espirales
        const want = 300;
        const radial = d > want + 40 ? 1 : d < want - 40 ? -1 : 0;
        const ax = ux * radial - uy * 0.9;
        const ay = uy * radial + ux * 0.9;
        const al = Math.hypot(ax, ay) || 1;
        e.vx = (ax / al) * speed;
        e.vy = (ay / al) * speed;
        e.spin += dt * (e.enraged ? 2.4 : 1.8);
        e.angle = e.spin;
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          e.fireCd = e.enraged ? 0.1 : 0.13;
          const arms = e.enraged ? 4 : 3;
          for (let i = 0; i < arms; i++) this.shootAngle(e, e.spin + (i * TAU) / arms, bs * 0.72, 2.8);
          if (this.throttle("vort", 280)) this.emit([6, r1(e.x), r1(e.y)]);
        }
        if (e.enraged) {
          e.aux -= dt;
          if (e.aux <= 0) {
            e.aux = 2.2;
            for (let i = -1; i <= 1; i++) this.shootAngle(e, aim + i * 0.12, bs * 1.2);
          }
        }
        break;
      }
      case 2: {
        // COLMENA: lenta, invoca esbirros y lanza anillos
        e.vx = ux * speed;
        e.vy = uy * speed;
        if (d < 220) {
          e.vx *= -0.5;
          e.vy *= -0.5;
        }
        e.angle += dt * 0.4;
        e.aux -= dt;
        if (e.aux <= 0) {
          e.aux = e.enraged ? 2.6 : 3.4;
          const count = Math.min(e.enraged ? 4 : 3, 70 - this.enemies.length);
          for (let i = 0; i < count; i++) {
            const a = Math.random() * TAU;
            this.spawnEnemy(e.enraged && i === 0 ? "shooter" : "grunt", {
              x: e.x + Math.cos(a) * (e.r + 22),
              y: e.y + Math.sin(a) * (e.r + 22),
            });
          }
          this.emit([13, r1(e.x), r1(e.y)]);
        }
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          e.fireCd = e.enraged ? 1.5 : 2.1;
          this.ring(e, e.enraged ? 20 : 14, bs * 0.85, e.t * 0.7);
        }
        break;
      }
      case 3: {
        // SEGADOR: se acerca, apunta (telegrafía), embiste y recupera
        e.stT -= dt;
        if (e.st === 0) {
          e.vx = ux * speed;
          e.vy = uy * speed;
          e.angle = aim;
          if (e.stT <= 0 && d < 560) {
            e.st = 1;
            e.stT = e.enraged ? 0.55 : 0.85;
            this.emit([14]);
          }
        } else if (e.st === 1) {
          e.vx *= 0.85;
          e.vy *= 0.85;
          e.angle = angLerp(e.angle, aim, 1 - Math.exp(-6 * dt));
          if (e.stT <= 0) {
            e.st = 2;
            e.stT = 0.6;
            const sp = e.enraged ? 780 : 640;
            e.cvx = Math.cos(e.angle) * sp;
            e.cvy = Math.sin(e.angle) * sp;
          }
        } else if (e.st === 2) {
          e.vx = e.cvx;
          e.vy = e.cvy;
          const wall =
            e.x <= e.r + 1 || e.x >= this.worldW - e.r - 1 || e.y <= e.r + 1 || e.y >= this.worldH - e.r - 1;
          if (e.stT <= 0 || (wall && e.stT < 0.5)) {
            e.st = 3;
            e.stT = e.enraged ? 0.7 : 1.1;
            this.ring(e, e.enraged ? 14 : 10, bs * 0.9, e.angle);
            this.emit([15, r1(e.x), r1(e.y)]);
          }
        } else {
          e.vx *= 0.9;
          e.vy *= 0.9;
          if (e.enraged) {
            e.fireCd -= dt;
            if (e.fireCd <= 0) {
              e.fireCd = 0.3;
              for (let i = -1; i <= 1; i++) this.shootAngle(e, aim + i * 0.2, bs);
            }
          }
          if (e.stT <= 0) {
            e.st = 0;
            e.stT = e.enraged ? 0.6 : 1.2;
          }
        }
        break;
      }
      default: {
        // COLOSO: abanico de balas y, enfurecido, anillos
        if (d > 310) {
          e.vx = ux * speed;
          e.vy = uy * speed;
        } else {
          e.vx = -uy * speed * 0.55;
          e.vy = ux * speed * 0.55;
        }
        e.angle = aim;
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          e.fireCd = e.enraged ? 0.95 : 1.25;
          const k = e.enraged ? 3 : 2;
          for (let i = -k; i <= k; i++) this.shootAngle(e, aim + i * 0.14, bs);
          this.emit([6, r1(e.x + ux * e.r), r1(e.y + uy * e.r)]);
        }
        if (e.enraged) {
          e.aux -= dt;
          if (e.aux <= 0) {
            e.aux = 3.5;
            this.ring(e, 16, bs * 0.8, e.t);
          }
        }
      }
    }
  }

  private shootAngle(e: Enemy, a: number, speed: number, life = 3.4): void {
    if (this.ebullets.length > 260) return;
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.ebullets.push({
      x: e.x + c * e.r * 0.8,
      y: e.y + s * e.r * 0.8,
      vx: c * speed,
      vy: s * speed,
      life,
      r: 4.5,
      c: 0,
      owner: "",
    });
  }

  private ring(e: Enemy, count: number, speed: number, offset: number): void {
    for (let i = 0; i < count; i++) this.shootAngle(e, offset + (i * TAU) / count, speed);
    this.emit([6, r1(e.x), r1(e.y)]);
  }

  private fireEnemyBullet(e: Enemy, target: Player, spread: number): void {
    const a = Math.atan2(target.y - e.y, target.x - e.x) + spread + rand(-0.03, 0.03);
    this.shootAngle(e, a, EBULLET_SPEED * DIFF_BSPEED[this.opts.diff]);
    this.emit([6, r1(e.x + Math.cos(a) * (e.r + 8)), r1(e.y + Math.sin(a) * (e.r + 8))]);
  }

  private updateBullets(dt: number, passive: boolean): void {
    const minX = this.isMP ? -60 : -60;
    const maxX = this.worldW + 60;
    const maxY = this.worldH + 60;

    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (!passive && Math.random() < dt * 26) this.trailDot(b);
    }

    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const b = this.bullets[bi];
      if (b.life <= 0 || b.x < minX || b.x > maxX || b.y < -60 || b.y > maxY) {
        this.bullets.splice(bi, 1);
        continue;
      }
      if (passive) continue;
      for (const e of this.enemies) {
        if (e.dead || e.spawnT > 0) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        if (dx * dx + dy * dy <= (b.r + e.r) * (b.r + e.r)) {
          this.bullets.splice(bi, 1);
          e.hp -= 1;
          e.hitFlash = 0.1;
          this.emit([1, r1(b.x), r1(b.y)]);
          if (e.hp <= 0) this.killEnemy(e, b.owner);
          break;
        }
      }
    }

    for (const b of this.ebullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }
    for (let bi = this.ebullets.length - 1; bi >= 0; bi--) {
      const b = this.ebullets[bi];
      if (b.life <= 0 || b.x < -60 || b.x > maxX || b.y < -60 || b.y > maxY) {
        this.ebullets.splice(bi, 1);
        continue;
      }
      if (passive) continue;
      for (const p of this.players) {
        if (!p.alive) continue;
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const rr = b.r + PLAYER_R - 3;
        if (dx * dx + dy * dy <= rr * rr) {
          this.ebullets.splice(bi, 1);
          this.damagePlayer(p, 1);
          break;
        }
      }
    }
  }

  private trailDot(b: Bullet): void {
    if (this.parts.length >= MAX_PARTICLES) return;
    this.parts.push({
      x: b.x - b.vx * 0.016,
      y: b.y - b.vy * 0.016,
      vx: rand(-24, 24),
      vy: rand(-24, 24),
      life: 0.22,
      maxLife: 0.22,
      r: 1.8,
      color: b.c === 0 ? "yellow" : PLAYER_PALETTES[b.c].dot,
      kind: "dot",
    });
  }

  private damagePlayer(p: Player, n: number): void {
    if (this.phase !== "playing" || p.invuln > 0 || !p.alive) return;
    if (p.shield > 0) {
      p.shield = 0;
      p.invuln = 0.8;
      this.emit([16, r1(p.x), r1(p.y), p.id]);
      return;
    }
    p.hp -= n;
    p.invuln = 1.3;
    if (this.role === "solo" || this.players.length === 1) {
      this.combo = 0;
      this.mult = 1;
    }
    if (this.role === "solo") this.hitStop = 0.14;
    this.emit([2, r1(p.x), r1(p.y), p.id]);
    if (p.hp <= 0) {
      p.alive = false;
      p.revive = 0;
      p.spreadT = 0;
      p.rapidT = 0;
      p.respawnT = this.isMP ? RESPAWN_TIME : 0;
      this.emit([3, r1(p.x), r1(p.y), p.id]);
    }
  }

  private killEnemy(e: Enemy, ownerId: string): void {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    const def = ENEMY_DEFS[e.kind];
    let gain = 0;
    if (this.phase === "playing") {
      const now = this.elapsed;
      if (now - this.lastKill < COMBO_WINDOW) this.combo += 1;
      else this.combo = 1;
      this.lastKill = now;
      this.mult =
        this.combo <= 2 ? 1 : this.combo <= 4 ? 2 : this.combo <= 6 ? 3 : this.combo <= 9 ? 4 : 5;
      const bossBonus = e.kind === "boss" ? 1 + 0.5 * Math.floor(this.bossKills / 4) : 1;
      gain = Math.round(def.score * e.scoreMul * this.mult * DIFF_SCORE[this.opts.diff] * bossBonus);
      this.score += gain;
      const owner = this.players.find((p) => p.id === ownerId);
      if (owner) owner.kills++;
      this.dropLoot(e);
    }
    if (e.kind === "boss") {
      this.bossKills++;
      const left = this.enemies.some((o) => o.kind === "boss" && !o.dead);
      this.bossActive = left;
      if (!left) {
        this.nextBoss = this.elapsed + (this.opts.rush ? 5 : 42);
        this.emit([
          5,
          `${BOSS_DEFS[e.btype]?.name ?? "JEFE"} DERROTADO`,
          "#fde047",
          26,
          this.opts.rush ? `JEFE Nº${this.bossKills + 1} EN 5s` : "¡RECOGED EL BOTÍN!",
        ]);
      }
    }
    this.emit([0, r1(e.x), r1(e.y), KINDS.indexOf(e.kind), e.elite ? 1 : 0, gain, this.mult, r1(e.r)]);
  }

  /* ---------- power-ups ---------- */

  private dropLoot(e: Enemy): void {
    let count = 0;
    if (e.kind === "boss") count = 4;
    else if (e.elite) count = 1;
    else {
      const ch = e.kind === "tank" ? 0.14 : e.kind === "shooter" ? 0.07 : 0.035;
      if (e.scoreMul >= 1 && Math.random() < ch) count = 1;
    }
    if (this.pickups.length > 14) count = Math.min(count, 1);
    const hurt = this.players.some((p) => p.alive && p.hp < MAX_HP);
    for (let i = 0; i < count; i++) {
      let type = Math.random() < (hurt ? 0.3 : 0.12) ? 0 : 1 + Math.floor(Math.random() * 4);
      if (e.kind === "boss" && i === 0) type = 0;
      const a = Math.random() * TAU;
      const sp = count > 1 ? rand(90, 170) : 30;
      this.pickups.push({
        uid: this.uidSeq++,
        type,
        x: e.x,
        y: e.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: PICKUP_LIFE,
      });
    }
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.life -= dt;
      if (k.life <= 0) {
        this.pickups.splice(i, 1);
        continue;
      }
      const p = this.nearestPlayer(k.x, k.y);
      if (p) {
        const dx = p.x - k.x;
        const dy = p.y - k.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 26) {
          this.applyPickup(p, k);
          this.pickups.splice(i, 1);
          continue;
        }
        if (d < 110) {
          const f = (1 - d / 110) * 900 * dt;
          k.vx += (dx / d) * f;
          k.vy += (dy / d) * f;
        }
      }
      k.vx *= 1 - 3 * dt;
      k.vy *= 1 - 3 * dt;
      k.x = clamp(k.x + k.vx * dt, 14, this.worldW - 14);
      k.y = clamp(k.y + k.vy * dt, 14, this.worldH - 14);
    }
  }

  private applyPickup(p: Player, k: Pickup): void {
    switch (k.type) {
      case 0:
        if (p.hp < MAX_HP) p.hp++;
        else this.score += Math.round(50 * DIFF_SCORE[this.opts.diff]);
        break;
      case 1:
        p.spreadT = BUFF_TIME;
        break;
      case 2:
        p.rapidT = BUFF_TIME;
        break;
      case 3:
        p.shield = 1;
        break;
      case 4:
        p.bombCd = 0;
        break;
    }
    this.emit([10, r1(k.x), r1(k.y), k.type, p.id]);
  }

  /* ---------- eventos / efectos ---------- */

  private emit(ev: NetEvent): void {
    this.applyEvent(ev);
    if (this.role === "host") {
      this.netEvents.push(ev);
      if (this.netEvents.length > 160) this.netEvents.splice(0, this.netEvents.length - 160);
    }
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    if ((this.lastSfx[key] || 0) + ms > now) return false;
    this.lastSfx[key] = now;
    return true;
  }

  private applyEvent(ev: NetEvent): void {
    switch (ev[0]) {
      case 0: {
        const [, x, y, k, elite, gain, mult, rr] = ev;
        const kind = KINDS[k] ?? "grunt";
        if (gain > 0) {
          this.popups.push({
            x,
            y: y - rr - 6,
            text: `+${gain}`,
            color: MULT_COLORS[mult - 1] ?? MULT_COLORS[0],
            life: 0.85,
            maxLife: 0.85,
            vy: -48,
            size: kind === "boss" ? 26 : 15,
          });
        }
        const pcol: DotColor = elite
          ? "yellow"
          : kind === "shooter"
            ? "orange"
            : kind === "boss"
              ? "red"
              : "magenta";
        const count = kind === "boss" ? 48 : kind === "tank" ? 24 : 14;
        const scale = kind === "boss" ? 2.4 : kind === "tank" ? 1.5 : 1;
        this.burst(x, y, pcol, count, 60, 300, scale);
        this.burst(x, y, "white", Math.floor(count / 3), 90, 280, scale);
        this.spawnRing(x, y, kind === "boss" ? "red" : "cyan", rr * (kind === "boss" ? 4 : 2.2));
        if (kind === "boss") {
          this.spawnRing(x, y, "magenta", rr * 5.5);
          this.shake = Math.max(this.shake, 24);
          vibrate([40, 30, 60]);
        } else {
          this.shake = Math.max(this.shake, rr * 0.5);
          if (this.role === "solo") vibrate(18);
        }
        if (this.throttle("die", 35)) sfx.enemyDie(kind === "boss" || kind === "tank");
        break;
      }
      case 1: {
        const [, x, y] = ev;
        this.burst(x, y, "white", 3, 60, 200, 0.8);
        if (this.throttle("hit", 30)) sfx.hit();
        break;
      }
      case 2: {
        const [, x, y, pid] = ev;
        this.burst(x, y, "red", 10, 80, 220, 1.1);
        this.burst(x, y, "white", 4, 90, 200, 0.9);
        if (pid === this.localId) {
          this.shake = Math.max(this.shake, 11);
          this.flashRed = 0.55;
          vibrate(60);
          sfx.playerHit();
        } else {
          this.shake = Math.max(this.shake, 3);
          if (this.throttle("ohit", 80)) sfx.hit();
        }
        break;
      }
      case 3: {
        const [, x, y, pid] = ev;
        const p = this.players.find((q) => q.id === pid);
        const col = p ? PLAYER_PALETTES[p.c].dot : "cyan";
        this.burst(x, y, col, 34, 120, 420, 1.8);
        this.burst(x, y, "white", 18, 140, 380, 1.6);
        this.burst(x, y, "magenta", 16, 100, 320, 1.4);
        this.spawnRing(x, y, "cyan", 170);
        this.spawnRing(x, y, "magenta", 240);
        if (pid === this.localId) {
          this.shake = 22;
          this.flashRed = 0.8;
          vibrate([80, 40, 120]);
          sfx.death();
        } else {
          this.shake = Math.max(this.shake, 8);
          sfx.enemyDie(true);
        }
        if (this.isMP) {
          const alive = this.players.filter((q) => q.alive && q.id !== pid).length;
          if (alive > 0) {
            this.addBanner(
              `${this.playerName(pid)} CAÍDO`,
              `REAPARECE EN ${RESPAWN_TIME}s SI ALGUIEN SOBREVIVE`,
              p ? PLAYER_PALETTES[p.c].hex : "#f87171",
              20,
              1.8
            );
          }
        }
        break;
      }
      case 4: {
        const [, x, y] = ev;
        const reach = this.isMP ? 560 : Math.max(this.worldW, this.worldH);
        this.shake = Math.max(this.shake, 15);
        this.flashWhite = 0.18;
        vibrate([60, 30, 90]);
        sfx.bomb();
        this.spawnRing(x, y, "cyan", reach);
        this.spawnRing(x, y, "magenta", reach * 0.68);
        this.burst(x, y, "cyan", 26, 120, 420, 1);
        break;
      }
      case 5: {
        const [, text, color, size, sub] = ev;
        this.addBanner(text, sub || "", color, size, 1.6);
        if (this.throttle("banner", 300)) sfx.combo();
        break;
      }
      case 6: {
        const [, x, y] = ev;
        if (this.parts.length < MAX_PARTICLES) {
          this.parts.push({ x, y, vx: 0, vy: 0, life: 0.08, maxLife: 0.08, r: 4.5, color: "red", kind: "dot" });
        }
        if (this.throttle("eshot", 60)) sfx.enemyShoot();
        break;
      }
      case 7: {
        const [, x, y, pid] = ev;
        const p = this.players.find((q) => q.id === pid);
        const col = p ? PLAYER_PALETTES[p.c].dot : "cyan";
        this.spawnRing(x, y, col, 90);
        this.burst(x, y, col, 18, 60, 220, 1.1);
        sfx.respawn();
        if (pid === this.localId) this.addBanner("¡DE VUELTA!", "", "#67e8f9", 26, 1.2);
        break;
      }
      case 9: {
        const [, pid, idx] = ev;
        this.showEmote(pid, idx);
        break;
      }
      case 10: {
        const [, x, y, type, pid] = ev;
        const def = PICKUP_DEFS[type] ?? PICKUP_DEFS[0];
        this.burst(x, y, def.dot, 14, 60, 200, 0.9);
        this.spawnRing(x, y, def.dot, 50);
        this.popups.push({ x, y: y - 18, text: def.label, color: def.color, life: 1.1, maxLife: 1.1, vy: -40, size: 13 });
        if (pid === this.localId) {
          sfx.pickup();
          vibrate(20);
        } else if (this.throttle("opick", 120)) sfx.pickup();
        break;
      }
      case 11: {
        const [, x, y, bt] = ev;
        const def = BOSS_DEFS[bt] ?? BOSS_DEFS[0];
        this.addBanner(`¡${def.name} ENFURECIDO!`, "FASE 2 · NUEVOS ATAQUES", def.color, 24, 1.6);
        this.spawnRing(x, y, "red", 220);
        this.burst(x, y, "red", 30, 100, 360, 1.6);
        this.shake = Math.max(this.shake, 14);
        vibrate([50, 30, 50]);
        sfx.enrage();
        break;
      }
      case 12: {
        const [, pid, rid] = ev;
        const p = this.players.find((q) => q.id === pid);
        this.addBanner(
          `${this.playerName(rid)} REANIMÓ A ${this.playerName(pid)}`,
          "",
          p ? PLAYER_PALETTES[p.c].hex : "#67e8f9",
          18,
          1.6
        );
        break;
      }
      case 13: {
        const [, x, y] = ev;
        this.spawnRing(x, y, "lime", 120);
        this.burst(x, y, "lime", 16, 60, 200, 1.2);
        if (this.throttle("summon", 200)) sfx.enemyShoot();
        break;
      }
      case 14: {
        if (this.throttle("charge", 150)) sfx.charge();
        break;
      }
      case 15: {
        const [, x, y] = ev;
        this.spawnRing(x, y, "pink", 160);
        this.burst(x, y, "pink", 20, 80, 300, 1.4);
        this.shake = Math.max(this.shake, 9);
        sfx.enemyDie(true);
        break;
      }
      case 16: {
        const [, x, y, pid] = ev;
        this.spawnRing(x, y, "magenta", 70);
        this.burst(x, y, "magenta", 16, 80, 240, 1);
        if (pid === this.localId) {
          this.shake = Math.max(this.shake, 6);
          vibrate(30);
        }
        sfx.shieldBreak();
        break;
      }
      case 8: {
        sfx.boss();
        this.shake = Math.max(this.shake, 6);
        break;
      }
    }
  }

  private addBanner(text: string, sub: string, color: string, size: number, life: number): void {
    this.banners = this.banners.filter((b) => b.text !== text);
    this.banners.push({ text, sub, color, size, life, maxLife: life });
    if (this.banners.length > 3) this.banners.shift();
  }

  private burst(
    x: number,
    y: number,
    color: DotColor,
    count: number,
    minSp: number,
    maxSp: number,
    scale = 1
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.parts.length >= MAX_PARTICLES) return;
      const a = Math.random() * TAU;
      const sp = rand(minSp, maxSp) * scale;
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.25, 0.7),
        maxLife: 0.7,
        r: rand(1.4, 3.2) * scale,
        color,
        kind: "dot",
      });
    }
  }

  private spawnRing(x: number, y: number, color: DotColor, maxR: number): void {
    if (this.parts.length >= MAX_PARTICLES - 2) return;
    const life = 0.5;
    this.parts.push({
      x,
      y,
      vx: (maxR - 12) / life,
      vy: 0,
      life,
      maxLife: life,
      r: 12,
      color,
      kind: "ring",
    });
  }

  private updateParticles(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      if (p.kind === "ring") {
        p.r += p.vx * dt;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const drag = 1 - 2.6 * dt;
        p.vx *= drag;
        p.vy *= drag;
      }
    }
  }

  private updatePopups(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.popups.splice(i, 1);
        continue;
      }
      p.y += p.vy * dt;
      p.vy *= 1 - 0.8 * dt;
    }
  }

  /* ---------- invitado ---------- */

  private updateGuest(dt: number): void {
    const k = 1 - Math.exp(-14 * dt);
    const lp = this.local;
    for (const p of this.players) {
      p.emoteT -= dt;
      p.emoteCd = Math.max(0, p.emoteCd - dt);
    }
    for (const pk of this.pickups) pk.life -= dt;

    if (this.phase === "playing" && lp) {
      lp.dashCd = Math.max(0, lp.dashCd - dt);
      lp.bombCd = Math.max(0, lp.bombCd - dt);
      lp.recoil = Math.max(0, lp.recoil - dt * 7);
      lp.invuln -= dt;
      if (lp.alive) {
        this.moveLocal(lp, dt);
        this.updateTrail(lp, dt);
        lp.fireCd -= dt;
        if (lp.fireCd <= 0) {
          lp.fireCd = lp.rapidT > 0 ? FIRE_INTERVAL * 0.55 : FIRE_INTERVAL;
          lp.recoil = 1;
          lp.fireSide ^= 1;
          const c = Math.cos(lp.a);
          const s = Math.sin(lp.a);
          this.muzzle(lp, lp.x + c * (PLAYER_R + 2), lp.y + s * (PLAYER_R + 2));
        }
      } else {
        lp.trail = [];
      }
    }

    for (const p of this.players) {
      if (p.id === this.localId) continue;
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      p.a = angLerp(p.a, p.ta, k);
      p.recoil = Math.max(0, p.recoil - dt * 7);
      if (p.alive) this.updateTrail(p, dt);
      else p.trail = [];
    }

    for (const e of this.enemies) {
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
      e.angle = angLerp(e.angle, e.ta, k);
      e.t += dt;
      e.hitFlash -= dt;
      if (e.spawnT > 0) e.spawnT -= dt;
    }

    const sdt = this.phase === "dying" ? dt * 0.25 : dt;
    if (this.phase !== "over") {
      for (const b of this.bullets) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        if (Math.random() < dt * 26) this.trailDot(b);
      }
      for (const b of this.ebullets) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
      }
    }

    this.updateParticles(dt);
    this.updatePopups(dt);
    this.decayFx(dt);
  }

  /* ---------- modo demo del menú ---------- */

  private updateAmbient(dt: number): void {
    this.ambientT += dt;
    this.worldW = this.w;
    this.worldH = this.h;
    const p = this.demo;
    const cx = this.w / 2;
    const cy = this.h * 0.52;
    const orbR = Math.min(this.w, this.h) * 0.2;
    const a = this.ambientT * 0.4;
    p.x = cx + Math.cos(a) * orbR;
    p.y = cy + Math.sin(a) * orbR * 0.62;
    p.a = a + Math.PI / 2;
    this.updateTrail(p, dt);
    p.fireCd -= dt;
    if (p.fireCd <= 0) {
      p.fireCd = FIRE_INTERVAL * 1.3;
      p.recoil = 1;
      const nx = p.x + Math.cos(p.a) * 24;
      const ny = p.y + Math.sin(p.a) * 24;
      this.burst(nx, ny, "yellow", 2, 60, 140, 0.8);
      this.burst(nx, ny, "cyan", 1, 40, 90, 0.7);
    }
    p.recoil = Math.max(0, p.recoil - dt * 7);
    if (this.parts.length < 160 && Math.random() < dt * 14) {
      this.parts.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        vx: rand(-8, 8),
        vy: rand(6, 26),
        life: rand(1.5, 3.5),
        maxLife: 3.5,
        r: rand(1, 2.2),
        color: Math.random() < 0.5 ? "cyan" : "magenta",
        kind: "dot",
      });
    }
    this.updateParticles(dt);
    this.updatePopups(dt);
    this.decayFx(dt);
  }

  /* ======================= render ======================= */

  private render(): void {
    const g = this.ctx;
    const d = this.dpr;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = this.bgGrad || "#05060f";
    g.fillRect(0, 0, this.w, this.h);
    this.drawStars(g);

    const s = this.scale;
    g.setTransform(d * s, 0, 0, d * s, d * (-this.camX * s + this.shakeX), d * (-this.camY * s + this.shakeY));
    this.drawGrid(g);

    if (this.phase === "ambient") {
      this.drawPlayer(g, this.demo, false);
      this.drawParticles(g);
    } else {
      this.drawWorld(g);
    }

    g.setTransform(d, 0, 0, d, 0, 0);
    if (this.phase !== "ambient") this.drawScreenUI(g);
    if (this.flashRed > 0) {
      g.fillStyle = `rgba(255,45,85,${this.flashRed * 0.35})`;
      g.fillRect(0, 0, this.w, this.h);
    }
    if (this.flashWhite > 0) {
      g.fillStyle = `rgba(220,255,255,${this.flashWhite})`;
      g.fillRect(0, 0, this.w, this.h);
    }
    g.fillStyle = this.vigGrad || "transparent";
    g.fillRect(0, 0, this.w, this.h);
  }

  private drawStars(g: CanvasRenderingContext2D): void {
    const t = this.ambientT + this.elapsed;
    g.save();
    g.fillStyle = "#bfefff";
    for (const st of this.stars) {
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * st.sp + st.tw));
      g.globalAlpha = 0.22 + 0.5 * tw;
      const px = st.fx * this.w - this.camX * 0.15 * st.sp + this.shakeX * 0.3;
      const py = st.fy * this.h + (this.isMP ? -this.camY * 0.15 * st.sp : t * 6 * st.sp);
      const x = ((px % this.w) + this.w) % this.w;
      const y = ((py % this.h) + this.h) % this.h;
      g.fillRect(x, y, st.s, st.s);
    }
    g.restore();
  }

  private drawGrid(g: CanvasRenderingContext2D): void {
    const gs = 64;
    const vw = this.w / this.scale;
    const vh = this.h / this.scale;
    const x0 = this.camX - gs;
    const y0 = this.camY - gs;
    const x1 = this.camX + vw + gs;
    const y1 = this.camY + vh + gs;
    const off = this.isMP ? 0 : ((this.ambientT + this.elapsed) * 26) % gs;
    const sx = Math.floor((x0 - off) / gs) * gs + off;
    const sy = Math.floor((y0 - off) / gs) * gs + off;

    g.save();
    g.lineWidth = 1 / this.scale;
    g.strokeStyle = "rgba(56,189,248,0.055)";
    g.beginPath();
    for (let x = sx; x < x1; x += gs) {
      g.moveTo(x, y0);
      g.lineTo(x, y1);
    }
    for (let y = sy; y < y1; y += gs) {
      g.moveTo(x0, y);
      g.lineTo(x1, y);
    }
    g.stroke();
    g.strokeStyle = "rgba(103,232,249,0.1)";
    g.beginPath();
    const big = gs * 5;
    const bx = Math.floor((x0 - off) / big) * big + off;
    const by = Math.floor((y0 - off) / big) * big + off;
    for (let x = bx; x < x1; x += big) {
      g.moveTo(x, y0);
      g.lineTo(x, y1);
    }
    for (let y = by; y < y1; y += big) {
      g.moveTo(x0, y);
      g.lineTo(x1, y);
    }
    g.stroke();

    if (this.isMP && this.phase !== "ambient") {
      // borde de la arena
      g.fillStyle = "rgba(2,4,12,.55)";
      g.beginPath();
      g.rect(x0, y0, x1 - x0, y1 - y0);
      g.rect(0, 0, this.worldW, this.worldH);
      g.fill("evenodd");
      g.shadowColor = "rgba(103,232,249,.8)";
      g.shadowBlur = 16;
      g.strokeStyle = "rgba(103,232,249,.55)";
      g.lineWidth = 2;
      g.strokeRect(0, 0, this.worldW, this.worldH);
    }
    g.restore();
  }

  private drawWorld(g: CanvasRenderingContext2D): void {
    for (const b of this.ebullets) {
      const a = Math.atan2(b.vy, b.vx);
      g.strokeStyle = "rgba(248,113,113,.35)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(b.x - Math.cos(a) * 11, b.y - Math.sin(a) * 11);
      g.lineTo(b.x, b.y);
      g.stroke();
      drawSprite(g, "ebullet", b.x, b.y, a + Math.PI / 2, 0.42, 0.95);
    }

    this.drawPickups(g);
    if (this.isMP) for (const p of this.players) if (!p.alive) this.drawWreck(g, p);
    for (const e of this.enemies) this.drawEnemy(g, e);

    for (const b of this.bullets) {
      drawSprite(g, "pbullet" + b.c, b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI / 2, 0.38);
    }

    for (const p of this.players) {
      if (p.id !== this.localId) this.drawPlayer(g, p, true);
    }
    const lp = this.local;
    if (lp) this.drawPlayer(g, lp, this.isMP);

    this.drawParticles(g);
    this.drawPopups(g);
  }

  private drawPlayer(g: CanvasRenderingContext2D, p: Player, label: boolean): void {
    if (!p.alive && this.phase !== "ambient") return;
    const pal = PLAYER_PALETTES[p.c];
    const spr = "player" + p.c;
    const base = (PLAYER_R * 2 * 1.15) / 96;

    if (p.trail.length) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < p.trail.length; i++) {
        const tr = p.trail[i];
        const a = (tr.life / 0.22) * (1 - i / p.trail.length) * 0.45;
        drawSprite(g, spr, tr.x, tr.y, tr.a + Math.PI / 2, base * (0.9 - i * 0.06), a);
      }
      g.restore();
    }

    const t = this.elapsed + this.ambientT;
    const flick = 0.65 + 0.35 * Math.sin(t * 90 + p.c);
    const fl = (PLAYER_R * 1.5 + Math.sin(t * 70) * 3) * (0.8 + 0.4 * flick) * (1 + p.recoil * 0.25);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.a + Math.PI / 2);
    g.globalCompositeOperation = "lighter";
    const fg = g.createLinearGradient(0, 0, 0, fl);
    fg.addColorStop(0, pal.glow);
    fg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fg;
    g.beginPath();
    g.moveTo(-PLAYER_R * 0.55, PLAYER_R * 0.4);
    g.lineTo(0, PLAYER_R * 0.4 + fl);
    g.lineTo(PLAYER_R * 0.55, PLAYER_R * 0.4);
    g.closePath();
    g.fill();
    g.restore();

    const inv = p.invuln > 0 || p.netInvuln;
    const alpha = inv && this.phase === "playing" ? 0.45 + 0.55 * Math.abs(Math.sin(t * 40)) : 1;
    const sc = base * (1 - p.recoil * 0.18);
    drawSprite(g, spr, p.x, p.y, p.a + Math.PI / 2, sc, alpha);
    if (inv && this.phase === "playing") {
      drawSprite(g, spr, p.x, p.y, p.a + Math.PI / 2, sc * 1.5, 0.18);
    }

    if (label && p.name) {
      g.save();
      g.font = "700 11px Orbitron, 'Chakra Petch', monospace";
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.fillStyle = pal.hex;
      g.shadowColor = pal.hex;
      g.shadowBlur = 8;
      g.fillText(p.name, p.x, p.y - PLAYER_R - 10);
      // mini barra de vida
      g.shadowBlur = 0;
      for (let i = 0; i < MAX_HP; i++) {
        g.fillStyle = i < p.hp ? "#fb7185" : "rgba(148,163,184,.35)";
        g.fillRect(p.x - 13 + i * 9, p.y - PLAYER_R - 8, 7, 3);
      }
      g.restore();
    }
    this.drawPlayerExtras(g, p, label);
  }

  private drawEnemy(g: CanvasRenderingContext2D, e: Enemy): void {
    const spr = e.kind === "boss" ? "boss" + e.btype : e.kind;
    if (e.spawnT > 0) {
      // telegrafía de aparición
      const k = 1 - clamp(e.spawnT / 0.7, 0, 1);
      g.save();
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = e.kind === "boss" ? "rgba(248,113,113,.8)" : "rgba(232,121,249,.7)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(e.x, e.y, e.r * (3 - 2 * k), 0, TAU);
      g.stroke();
      g.restore();
      drawSprite(g, spr, e.x, e.y, e.angle + Math.PI / 2, ((e.r * 2.4) / SPRITE_BASE[e.kind]) * k, 0.25 + k * 0.5);
      return;
    }
    if (e.elite) {
      g.save();
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(253,224,71,.55)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(e.x, e.y, e.r + 6 + Math.sin(e.t * 4) * 2, 0, TAU);
      g.stroke();
      g.restore();
    }
    if (e.kind === "boss") this.drawBossFx(g, e);
    const sc = (e.r * 2.4) / SPRITE_BASE[e.kind];
    drawSprite(g, spr, e.x, e.y, e.angle + Math.PI / 2, sc, 1);
    if (e.hitFlash > 0) {
      g.save();
      g.globalAlpha = Math.min(1, e.hitFlash * 10) * 0.85;
      g.globalCompositeOperation = "lighter";
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(e.x, e.y, e.r * 1.15, 0, TAU);
      g.fill();
      g.restore();
    }
    const frac = this.role === "guest" ? e.hpFrac : e.hp / e.maxHp;
    if (frac < 1 && e.kind !== "boss") {
      const bw = e.r * 2;
      const x = e.x - bw / 2;
      const y = e.y - e.r - 8;
      g.fillStyle = "rgba(255,255,255,.18)";
      g.fillRect(x, y, bw, 3);
      g.fillStyle = ENEMY_DEFS[e.kind].color;
      g.fillRect(x, y, bw * clamp(frac, 0, 1), 3);
    }
  }

  private drawParticles(g: CanvasRenderingContext2D): void {
    g.save();
    g.globalCompositeOperation = "lighter";
    for (const p of this.parts) {
      const k = Math.max(0, p.life / p.maxLife);
      const spr = p.kind === "ring" ? RING_SPR[p.color] : DOT_SPR[p.color];
      if (!spr) continue;
      const size = p.r * 2 * (p.kind === "ring" ? 64 / 64 : 1);
      const sc = p.kind === "ring" ? size / 64 : size / 24;
      g.globalAlpha = p.kind === "ring" ? k * 0.9 : k;
      const ww = spr.width * sc;
      g.drawImage(spr, p.x - ww / 2, p.y - ww / 2, ww, ww);
    }
    g.restore();
  }

  private drawPopups(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const p of this.popups) {
      const k = p.life / p.maxLife;
      g.globalAlpha = clamp(k * 1.5, 0, 1);
      g.shadowColor = p.color;
      g.shadowBlur = 14;
      g.fillStyle = p.color;
      g.font = `700 ${p.size}px Orbitron, "Chakra Petch", monospace`;
      g.fillText(p.text, p.x, p.y);
    }
    g.restore();
  }

  /* ---------- capa de pantalla ---------- */

  private toScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.camX) * this.scale, y: (y - this.camY) * this.scale };
  }

  private drawScreenUI(g: CanvasRenderingContext2D): void {
    // indicadores fuera de pantalla (compañeros y jefe)
    if (this.isMP) {
      const pad = 26;
      const targets: { x: number; y: number; color: string; label: string }[] = [];
      for (const p of this.players) {
        if (p.id === this.localId || !p.alive) continue;
        targets.push({ x: p.x, y: p.y, color: PLAYER_PALETTES[p.c].hex, label: p.name.slice(0, 6) });
      }
      for (const e of this.enemies) {
        if (e.kind === "boss") targets.push({ x: e.x, y: e.y, color: "#f87171", label: "JEFE" });
      }
      for (const t of targets) {
        const sp = this.toScreen(t.x, t.y);
        if (sp.x >= 0 && sp.x <= this.w && sp.y >= 0 && sp.y <= this.h) continue;
        const cx = this.w / 2;
        const cy = this.h / 2;
        const a = Math.atan2(sp.y - cy, sp.x - cx);
        const ex = clamp(sp.x, pad, this.w - pad);
        const ey = clamp(sp.y, pad + 40, this.h - pad - 40);
        g.save();
        g.translate(ex, ey);
        g.rotate(a);
        g.fillStyle = t.color;
        g.shadowColor = t.color;
        g.shadowBlur = 10;
        g.beginPath();
        g.moveTo(12, 0);
        g.lineTo(-6, -8);
        g.lineTo(-2, 0);
        g.lineTo(-6, 8);
        g.closePath();
        g.fill();
        g.restore();
        g.save();
        g.font = "700 9px Orbitron, monospace";
        g.textAlign = "center";
        g.fillStyle = t.color;
        g.fillText(t.label, ex - Math.cos(a) * 18, ey - Math.sin(a) * 18 + 3);
        g.restore();
      }
    }

    // mira (escritorio)
    if (!this.touchMode && this.hasAim && this.phase === "playing" && this.local?.alive) {
      g.save();
      g.strokeStyle = "rgba(103,232,249,.6)";
      g.lineWidth = 1.5;
      const x = this.aimSX;
      const y = this.aimSY;
      g.beginPath();
      g.moveTo(x - 10, y);
      g.lineTo(x - 4, y);
      g.moveTo(x + 4, y);
      g.lineTo(x + 10, y);
      g.moveTo(x, y - 10);
      g.lineTo(x, y - 4);
      g.moveTo(x, y + 4);
      g.lineTo(x, y + 10);
      g.stroke();
      g.beginPath();
      g.arc(x, y, 13, 0, TAU);
      g.stroke();
      g.restore();
    }

    if (this.touchMode && this.phase === "playing") this.drawJoystick(g);
    if (this.bossActive) this.drawBossBar(g);
    this.drawBanners(g);
  }

  private drawBanners(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    let y = this.h * 0.3;
    for (const b of this.banners) {
      const age = b.maxLife - b.life;
      const inK = clamp(age / 0.18, 0, 1);
      const outK = clamp(b.life / 0.35, 0, 1);
      const sc = 1 + (1 - inK) * 0.6;
      g.globalAlpha = Math.min(inK, outK);
      g.save();
      g.translate(this.w / 2, y);
      g.scale(sc, sc);
      g.font = `900 ${b.size}px Orbitron, "Chakra Petch", monospace`;
      g.fillStyle = b.color;
      g.shadowColor = b.color;
      g.shadowBlur = 20;
      g.fillText(b.text, 0, 0);
      if (b.sub) {
        g.shadowBlur = 8;
        g.font = `700 11px Orbitron, "Chakra Petch", monospace`;
        g.fillStyle = "rgba(226,247,255,.85)";
        g.fillText(b.sub, 0, b.size * 0.85);
      }
      g.restore();
      y += b.size + (b.sub ? 30 : 16);
    }
    g.restore();
  }

  private drawJoystick(g: CanvasRenderingContext2D): void {
    g.save();
    if (!this.joy.active) {
      const x = 92;
      const y = this.h - 110;
      g.fillStyle = "rgba(103,232,249,.08)";
      g.beginPath();
      g.arc(x, y, 44, 0, TAU);
      g.fill();
      g.strokeStyle = "rgba(103,232,249,.2)";
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = "rgba(190,242,255,.4)";
      g.font = "600 10px Orbitron, monospace";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("MOVER", x, y);
    } else {
      g.strokeStyle = "rgba(103,232,249,.35)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.joy.ox, this.joy.oy, JOY_R, 0, TAU);
      g.stroke();
      g.fillStyle = "rgba(103,232,249,.55)";
      g.beginPath();
      g.arc(this.joy.kx, this.joy.ky, 24, 0, TAU);
      g.fill();
      g.fillStyle = "rgba(224,255,255,.9)";
      g.beginPath();
      g.arc(this.joy.kx, this.joy.ky, 9, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  private drawPickups(g: CanvasRenderingContext2D): void {
    const t = this.elapsed + this.ambientT;
    for (const k of this.pickups) {
      if (k.life < 3 && Math.floor(k.life * 8) % 2 === 0) continue;
      const bob = Math.sin(t * 4 + k.uid) * 3;
      const def = PICKUP_DEFS[k.type];
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.35 + 0.2 * Math.sin(t * 6 + k.uid);
      g.strokeStyle = def?.color ?? "#ffffff";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(k.x, k.y + bob, 17 + Math.sin(t * 5) * 2, 0, TAU);
      g.stroke();
      g.restore();
      drawSprite(g, "pick" + k.type, k.x, k.y + bob, 0, 0.55);
    }
  }

  private drawWreck(g: CanvasRenderingContext2D, p: Player): void {
    const pal = PLAYER_PALETTES[p.c];
    const t = this.elapsed;
    drawSprite(g, "player" + p.c, p.x, p.y, p.a + Math.PI / 2 + 0.6, ((PLAYER_R * 2 * 1.15) / 96) * 0.9, 0.35);
    g.save();
    g.strokeStyle = pal.hex;
    g.setLineDash([6, 6]);
    g.lineDashOffset = -t * 30;
    g.lineWidth = 2;
    g.globalAlpha = 0.45 + 0.3 * Math.sin(t * 5);
    g.beginPath();
    g.arc(p.x, p.y, REVIVE_R, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    if (p.revive > 0) {
      g.globalAlpha = 1;
      g.lineWidth = 5;
      g.shadowColor = pal.hex;
      g.shadowBlur = 12;
      g.beginPath();
      g.arc(p.x, p.y, 26, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p.revive, 0, 1));
      g.stroke();
    }
    g.shadowBlur = 0;
    g.globalAlpha = 0.9;
    g.font = "700 10px Orbitron, 'Chakra Petch', monospace";
    g.textAlign = "center";
    g.fillStyle = pal.hex;
    g.fillText(p.id === this.localId ? "ESPERANDO AYUDA" : `REANIMAR A ${p.name}`, p.x, p.y - 36);
    if (p.respawnT > 0) {
      g.fillStyle = "rgba(226,247,255,.7)";
      g.fillText(`${Math.ceil(p.respawnT)}s`, p.x, p.y + 46);
    }
    g.restore();
    this.drawPlayerExtras(g, p, true);
  }

  private drawPlayerExtras(g: CanvasRenderingContext2D, p: Player, label: boolean): void {
    const t = this.elapsed + this.ambientT;
    const pal = PLAYER_PALETTES[p.c];
    if (p.alive && p.shield > 0) {
      g.save();
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(192,132,252,.85)";
      g.lineWidth = 2.5;
      g.shadowColor = "#c084fc";
      g.shadowBlur = 12;
      g.beginPath();
      g.arc(p.x, p.y, PLAYER_R + 9 + Math.sin(t * 6) * 1.5, 0, TAU);
      g.stroke();
      g.restore();
    }
    if (p.alive && (p.spreadT > 0 || p.rapidT > 0)) {
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.28 + 0.12 * Math.sin(t * 12);
      g.fillStyle = p.rapidT > 0 ? "#fb923c" : "#fde047";
      g.beginPath();
      g.arc(p.x, p.y, PLAYER_R + 5, 0, TAU);
      g.fill();
      g.restore();
    }
    if (p.emoteT > 0 && p.emote) {
      const pop = Math.min(1, (2.2 - p.emoteT) / 0.15);
      const y = p.y - PLAYER_R - (label ? 42 : 30) - (1 - p.emoteT / 2.2) * 8;
      g.save();
      g.globalAlpha = Math.min(1, p.emoteT / 0.3);
      g.translate(p.x, y);
      g.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
      g.fillStyle = "rgba(8,12,30,.88)";
      g.strokeStyle = pal.hex;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 17, 0, TAU);
      g.fill();
      g.stroke();
      g.font = '20px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(p.emote, 0, 1);
      g.restore();
    }
  }

  private drawBossFx(g: CanvasRenderingContext2D, e: Enemy): void {
    const t = this.elapsed;
    const def = BOSS_DEFS[e.btype] ?? BOSS_DEFS[0];
    g.save();
    g.globalCompositeOperation = "lighter";
    if (e.enraged) {
      g.globalAlpha = 0.22 + 0.14 * Math.sin(t * 10);
      g.fillStyle = "#ef4444";
      g.beginPath();
      g.arc(e.x, e.y, e.r * 1.45, 0, TAU);
      g.fill();
    }
    if (e.btype === 3 && e.st === 1) {
      const len = 1200;
      const ex = e.x + Math.cos(e.angle) * len;
      const ey = e.y + Math.sin(e.angle) * len;
      const blink = 0.45 + 0.4 * Math.abs(Math.sin(t * 22));
      g.strokeStyle = "#fb7185";
      g.globalAlpha = blink * 0.16;
      g.lineWidth = e.r * 1.6;
      g.beginPath();
      g.moveTo(e.x, e.y);
      g.lineTo(ex, ey);
      g.stroke();
      g.globalAlpha = blink;
      g.lineWidth = 2;
      g.setLineDash([14, 10]);
      g.lineDashOffset = -t * 120;
      g.beginPath();
      g.moveTo(e.x, e.y);
      g.lineTo(ex, ey);
      g.stroke();
      g.setLineDash([]);
    }
    if (e.btype === 3 && e.st === 2) {
      for (let i = 1; i <= 3; i++) {
        drawSprite(
          g,
          "boss3",
          e.x - Math.cos(e.angle) * i * 22,
          e.y - Math.sin(e.angle) * i * 22,
          e.angle + Math.PI / 2,
          (e.r * 2.4) / 160,
          0.3 / i
        );
      }
    }
    if (e.btype === 1) {
      g.globalAlpha = 0.35;
      g.strokeStyle = def.color;
      g.lineWidth = 2;
      g.setLineDash([10, 14]);
      g.lineDashOffset = -t * 60;
      g.beginPath();
      g.arc(e.x, e.y, e.r * 1.7, 0, TAU);
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
  }

  private drawBossBar(g: CanvasRenderingContext2D): void {
    const bosses = this.enemies.filter((e) => e.kind === "boss" && !e.dead);
    if (!bosses.length) return;
    const bw = Math.min(300, this.w - 140);
    const bh = 10;
    let y = this.w < 640 ? 84 : 22;
    for (const boss of bosses.slice(0, 2)) {
      const def = BOSS_DEFS[boss.btype] ?? BOSS_DEFS[0];
      const frac = this.role === "guest" ? boss.hpFrac : boss.hp / boss.maxHp;
      const x = this.w / 2 - bw / 2;
      g.save();
      g.fillStyle = "rgba(5,8,20,.72)";
      g.fillRect(x - 1, y + 12, bw + 2, bh + 2);
      g.fillStyle = "rgba(255,255,255,.15)";
      g.fillRect(x, y + 13, bw, bh);
      const fg = g.createLinearGradient(x, 0, x + bw, 0);
      fg.addColorStop(0, def.color);
      fg.addColorStop(1, boss.enraged ? "#ef4444" : "#e879f9");
      g.fillStyle = fg;
      g.fillRect(x, y + 13, bw * clamp(frac, 0, 1), bh);
      g.fillStyle = "rgba(255,255,255,.65)";
      g.fillRect(x + bw / 2 - 1, y + 11, 2, bh + 4);
      g.strokeStyle = def.color;
      g.lineWidth = 1;
      g.strokeRect(x - 1, y + 12, bw + 2, bh + 2);
      g.fillStyle = def.color;
      g.font = "700 11px Orbitron, monospace";
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.shadowColor = def.color;
      g.shadowBlur = boss.enraged ? 10 : 0;
      g.fillText(`${def.name}${boss.enraged ? " · FURIA" : ""}`, this.w / 2, y + 10);
      g.restore();
      y += 34;
    }
  }
}

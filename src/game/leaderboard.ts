/**
 * Clasificación GLOBAL online sin servidor propio.
 *
 * Usa la red pública Nostr: cada puntuación es un evento firmado
 * (NIP-78, kind 30078) que se publica en varios relays públicos a la vez
 * para tener redundancia. La lectura consulta todos los relays, une
 * resultados, verifica firmas y aplica filtros de plausibilidad.
 */

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type Event as NostrEvent,
} from "nostr-tools/pure";

export type GameMode = "solo" | "coop";

export interface GlobalEntry {
  id: string;
  pubkey: string;
  name: string;
  score: number;
  mode: GameMode;
  players: number;
  time: number;
  date: number;
  mine: boolean;
  diff: number; // 0 normal · 1 difícil · 2 pesadilla
  rush: boolean; // modo jefes sin fin
  bosses: number;
}

const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.snort.social",
  "wss://offchain.pub",
];

const KIND = 30078;
const TAG = "neonvoidlb1";
const KEY_STORE = "nv:nostr-sk";
const CACHE_STORE = "nv:global-cache:v1";
const MAX_SCORE = 5_000_000;

/* ---------------- helpers ---------------- */

const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const unhex = (s: string) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

function getSecretKey(): Uint8Array {
  try {
    const s = localStorage.getItem(KEY_STORE);
    if (s && /^[0-9a-f]{64}$/.test(s)) return unhex(s);
  } catch {
    /* ignore */
  }
  const sk = generateSecretKey();
  try {
    localStorage.setItem(KEY_STORE, hex(sk));
  } catch {
    /* ignore */
  }
  return sk;
}

let myPubkey: string | null = null;

export function sanitizeName(n: string, max = 12): string {
  return (
    (n || "")
      .toUpperCase()
      .replace(/[^A-Z0-9ÑÁÉÍÓÚÜ _+\-.]/g, "")
      .trim()
      .slice(0, max) || "PILOTO"
  );
}

function plausible(score: number, time: number, players: number): boolean {
  if (!Number.isFinite(score) || score <= 0 || score > MAX_SCORE) return false;
  if (!Number.isFinite(time) || time < 1 || time > 4 * 3600) return false;
  if (!Number.isFinite(players) || players < 1 || players > 4) return false;
  // tope generoso de puntos por segundo para filtrar trampas obvias
  // (incluye multiplicador de dificultad y jefes en cadena)
  return score <= 6000 + time * 1100 * players;
}

/* ---------------- relay I/O ---------------- */

function relayQuery(
  url: string,
  filter: Record<string, unknown>,
  timeoutMs: number
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let done = false;
    let ws: WebSocket | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve(events);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      finish();
      return;
    }
    const subId = "nv" + Math.random().toString(36).slice(2, 8);
    ws.onopen = () => ws?.send(JSON.stringify(["REQ", subId, filter]));
    ws.onmessage = (m) => {
      try {
        const d = JSON.parse(String(m.data));
        if (d[0] === "EVENT" && d[1] === subId && d[2]) events.push(d[2]);
        else if (d[0] === "EOSE" || d[0] === "CLOSED") finish();
      } catch {
        /* ignore malformed */
      }
    };
    ws.onerror = finish;
    ws.onclose = finish;
  });
}

function relayPublish(url: string, ev: NostrEvent, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocket | null = null;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      finish(false);
      return;
    }
    ws.onopen = () => ws?.send(JSON.stringify(["EVENT", ev]));
    ws.onmessage = (m) => {
      try {
        const d = JSON.parse(String(m.data));
        if (d[0] === "OK" && d[1] === ev.id) finish(!!d[2]);
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
}

/* ---------------- parsing ---------------- */

function clampInt(v: unknown, a: number, b: number): number {
  const n = Math.floor(Number(v) || 0);
  return n < a ? a : n > b ? b : n;
}

function parseEvent(ev: NostrEvent): Omit<GlobalEntry, "mine"> | null {
  try {
    if (ev.kind !== KIND) return null;
    if (!ev.tags?.some((t) => t[0] === "t" && t[1] === TAG)) return null;
    const c = JSON.parse(ev.content);
    const score = Math.floor(Number(c.s));
    const time = Number(c.t);
    const players = Math.floor(Number(c.p) || 1);
    const mode: GameMode = c.m === "coop" ? "coop" : "solo";
    if (!plausible(score, time, players)) return null;
    if (mode === "solo" && players !== 1) return null;
    return {
      id: ev.id,
      pubkey: ev.pubkey,
      name: sanitizeName(String(c.n || ""), mode === "coop" ? 40 : 12),
      score,
      mode,
      players,
      time,
      date: ev.created_at * 1000,
      diff: clampInt(c.d, 0, 2),
      rush: c.x === 1,
      bosses: clampInt(c.b, 0, 999),
    };
  } catch {
    return null;
  }
}

/* ---------------- public API ---------------- */

export function getCachedGlobal(): GlobalEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_STORE) || "[]");
    return Array.isArray(raw) ? (raw as GlobalEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Descarga y combina la clasificación de todos los relays.
 * Devuelve las mejores entradas de cada modo, ya verificadas.
 */
export async function fetchGlobal(perMode = 25): Promise<GlobalEntry[]> {
  if (!myPubkey) myPubkey = getPublicKey(getSecretKey());
  const filter = { kinds: [KIND], "#t": [TAG], limit: 400 };
  const results = await Promise.all(RELAYS.map((u) => relayQuery(u, filter, 6000)));

  const byId = new Map<string, NostrEvent>();
  for (const list of results) for (const ev of list) if (ev?.id) byId.set(ev.id, ev);

  const parsed: { e: Omit<GlobalEntry, "mine">; ev: NostrEvent }[] = [];
  for (const ev of byId.values()) {
    const e = parseEvent(ev);
    if (e) parsed.push({ e, ev });
  }
  parsed.sort((a, b) => b.e.score - a.e.score);

  const out: GlobalEntry[] = [];
  const count: Record<GameMode, number> = { solo: 0, coop: 0 };
  const perKey = new Map<string, number>();
  const seen = new Set<string>();
  for (const { e, ev } of parsed) {
    if (count[e.mode] >= perMode) continue;
    const dedupe = `${e.pubkey}|${e.mode}|${e.name}|${e.score}`;
    if (seen.has(dedupe)) continue;
    const pk = `${e.pubkey}|${e.mode}`;
    const n = perKey.get(pk) || 0;
    if (n >= 3) continue; // máx. 3 entradas por jugador y modo (anti-spam)
    // verificar firma solo de lo que realmente vamos a mostrar
    if (!verifyEvent(ev)) continue;
    seen.add(dedupe);
    perKey.set(pk, n + 1);
    count[e.mode]++;
    out.push({ ...e, mine: e.pubkey === myPubkey });
  }

  try {
    localStorage.setItem(CACHE_STORE, JSON.stringify(out));
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Publica una puntuación. Resuelve con el número de relays que la
 * aceptaron (lanza error si ninguno lo hizo).
 */
export async function submitGlobal(entry: {
  name: string;
  score: number;
  mode: GameMode;
  players: number;
  time: number;
  diff?: number;
  rush?: boolean;
  bosses?: number;
}): Promise<{ id: string; relays: number }> {
  const score = Math.floor(entry.score);
  const time = Math.max(1, Math.round(entry.time));
  const players = Math.max(1, Math.min(4, Math.floor(entry.players)));
  if (!plausible(score, time, players)) throw new Error("Puntuación no válida");

  const sk = getSecretKey();
  const ev = finalizeEvent(
    {
      kind: KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", `neonvoid:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`],
        ["t", TAG],
      ],
      content: JSON.stringify({
        v: 1,
        n: sanitizeName(entry.name, entry.mode === "coop" ? 40 : 12),
        s: score,
        m: entry.mode,
        p: players,
        t: time,
        d: clampInt(entry.diff, 0, 2),
        x: entry.rush ? 1 : 0,
        b: clampInt(entry.bosses, 0, 999),
      }),
    },
    sk
  );

  return new Promise((resolve, reject) => {
    let ok = 0;
    let pending = RELAYS.length;
    let resolved = false;
    for (const url of RELAYS) {
      relayPublish(url, ev, 7000).then((good) => {
        pending--;
        if (good) ok++;
        if (good && !resolved) {
          resolved = true;
          // espera un poco para contar más confirmaciones, sin bloquear la UI
          setTimeout(() => resolve({ id: ev.id, relays: ok }), 600);
        }
        if (pending === 0 && !resolved) {
          resolved = true;
          if (ok > 0) resolve({ id: ev.id, relays: ok });
          else reject(new Error("Sin conexión con la red de clasificación"));
        }
      });
    }
  });
}

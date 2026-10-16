/**
 * Multijugador online P2P con WebRTC (PeerJS).
 * - El anfitrión crea una sala con un código corto (ID de peer predecible).
 * - Los invitados se conectan directamente al anfitrión.
 * - El anfitrión es autoritativo: simula la partida y envía snapshots.
 * La señalización usa el servidor público gratuito de PeerJS y su TURN.
 */

import { Peer, type DataConnection } from "peerjs";

export const MAX_PLAYERS = 4;
const PREFIX = "neonvoid-v2-";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface LobbyPlayer {
  id: string;
  name: string;
  c: number; // índice de color 0..3
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NetMsg = { t: string; [k: string]: any };

function makeCode(): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(c: string): string {
  return c.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function errText(type: string | undefined): string {
  switch (type) {
    case "peer-unavailable":
      return "Sala no encontrada. Revisa el código.";
    case "network":
    case "server-error":
    case "socket-error":
    case "socket-closed":
      return "No se pudo conectar con el servidor de salas.";
    case "browser-incompatible":
      return "Tu navegador no soporta WebRTC.";
    case "webrtc":
      return "Fallo de conexión WebRTC.";
    default:
      return "Error de conexión.";
  }
}

/* ======================= HOST ======================= */

export class HostSession {
  readonly role = "host" as const;
  code = "";
  peer!: Peer;
  localId = "host";
  players: LobbyPlayer[] = [];
  private conns = new Map<string, DataConnection>();
  private closed = false;
  acceptJoin: () => boolean = () => true;

  onLobby?: (players: LobbyPlayer[]) => void;
  onMessage?: (id: string, msg: NetMsg) => void;
  onJoin?: (p: LobbyPlayer) => void;
  onLeave?: (p: LobbyPlayer) => void;
  onError?: (msg: string) => void;

  static create(name: string): Promise<HostSession> {
    const s = new HostSession();
    return s.open(name, 0);
  }

  private open(name: string, attempt: number): Promise<HostSession> {
    return new Promise((resolve, reject) => {
      const code = makeCode();
      const peer = new Peer(PREFIX + code, { debug: 0 });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error("Tiempo de espera agotado al crear la sala."));
      }, 15000);

      peer.on("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.peer = peer;
        this.code = code;
        this.players = [{ id: this.localId, name, c: 0 }];
        this.bind();
        resolve(this);
      });
      peer.on("error", (err: { type?: string }) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          peer.destroy();
          if (err.type === "unavailable-id" && attempt < 4) {
            this.open(name, attempt + 1).then(resolve, reject);
          } else {
            reject(new Error(errText(err.type)));
          }
          return;
        }
        if (err.type !== "peer-unavailable") this.onError?.(errText(err.type));
      });
    });
  }

  private bind(): void {
    this.peer.on("connection", (conn) => {
      conn.on("open", () => {
        // espera el saludo con el nombre
      });
      conn.on("data", (raw) => {
        const msg = raw as NetMsg;
        if (!msg || typeof msg !== "object") return;
        if (msg.t === "hello") {
          if (this.players.length >= MAX_PLAYERS) {
            conn.send({ t: "reject", reason: "La sala está llena (máx. 4)." });
            setTimeout(() => conn.close(), 300);
            return;
          }
          if (!this.acceptJoin()) {
            conn.send({ t: "reject", reason: "La sala no acepta jugadores ahora." });
            setTimeout(() => conn.close(), 300);
            return;
          }
          const used = new Set(this.players.map((p) => p.c));
          let c = 1;
          while (used.has(c) && c < MAX_PLAYERS) c++;
          const p: LobbyPlayer = {
            id: conn.peer,
            name: String(msg.name || "PILOTO").slice(0, 12),
            c,
          };
          this.conns.set(conn.peer, conn);
          this.players.push(p);
          conn.send({ t: "welcome", id: p.id, code: this.code, players: this.players });
          this.broadcastLobby();
          this.onJoin?.(p);
          return;
        }
        if (this.conns.has(conn.peer)) this.onMessage?.(conn.peer, msg);
      });
      const drop = () => this.dropConn(conn.peer);
      conn.on("close", drop);
      conn.on("error", drop);
    });
    this.peer.on("disconnected", () => {
      // intenta recuperar la conexión con el servidor de señalización
      if (!this.closed) {
        try {
          this.peer.reconnect();
        } catch {
          /* ignore */
        }
      }
    });
  }

  private dropConn(id: string): void {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    const p = this.players.find((x) => x.id === id);
    this.players = this.players.filter((x) => x.id !== id);
    this.broadcastLobby();
    if (p) this.onLeave?.(p);
  }

  broadcastLobby(): void {
    this.broadcast({ t: "lobby", players: this.players });
    this.onLobby?.([...this.players]);
  }

  broadcast(msg: NetMsg): void {
    for (const c of this.conns.values()) {
      if (c.open) {
        try {
          c.send(msg);
        } catch {
          /* ignore */
        }
      }
    }
  }

  send(id: string, msg: NetMsg): void {
    const c = this.conns.get(id);
    if (c?.open) {
      try {
        c.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  get guestCount(): number {
    return this.conns.size;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.broadcast({ t: "bye" });
    setTimeout(() => {
      for (const c of this.conns.values()) c.close();
      this.peer?.destroy();
    }, 150);
  }
}

/* ======================= GUEST ======================= */

export class GuestSession {
  readonly role = "guest" as const;
  code = "";
  peer!: Peer;
  conn!: DataConnection;
  localId = "";
  players: LobbyPlayer[] = [];
  private closed = false;

  onMessage?: (msg: NetMsg) => void;
  onClose?: (reason: string) => void;

  static join(code: string, name: string): Promise<GuestSession> {
    const s = new GuestSession();
    return s.connect(normalizeCode(code), name);
  }

  private connect(code: string, name: string): Promise<GuestSession> {
    return new Promise((resolve, reject) => {
      if (code.length !== 5) {
        reject(new Error("El código debe tener 5 caracteres."));
        return;
      }
      this.code = code;
      const peer = new Peer({ debug: 0 });
      this.peer = peer;
      let settled = false;
      const fail = (m: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(m));
      };
      const timer = setTimeout(
        () => fail("Tiempo de espera agotado. ¿El anfitrión sigue en la sala?"),
        15000
      );

      peer.on("error", (err: { type?: string }) => {
        if (!settled) fail(errText(err.type));
      });

      peer.on("open", () => {
        const conn = peer.connect(PREFIX + code, {
          reliable: true,
          serialization: "json",
        });
        this.conn = conn;
        conn.on("open", () => conn.send({ t: "hello", name }));
        conn.on("data", (raw) => {
          const msg = raw as NetMsg;
          if (!msg || typeof msg !== "object") return;
          if (!settled) {
            if (msg.t === "welcome") {
              settled = true;
              clearTimeout(timer);
              this.localId = msg.id;
              this.players = msg.players || [];
              resolve(this);
            } else if (msg.t === "reject") {
              fail(String(msg.reason || "Conexión rechazada."));
            }
            return;
          }
          if (msg.t === "lobby") this.players = msg.players || [];
          if (msg.t === "bye") {
            this.shutdown("El anfitrión cerró la sala.");
            return;
          }
          this.onMessage?.(msg);
        });
        conn.on("close", () => {
          if (!settled) fail("Conexión cerrada por el anfitrión.");
          else this.shutdown("Se perdió la conexión con el anfitrión.");
        });
        conn.on("error", () => {
          if (!settled) fail("Fallo de conexión con el anfitrión.");
        });
      });
    });
  }

  private shutdown(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.onClose?.(reason);
  }

  send(msg: NetMsg): void {
    if (this.conn?.open) {
      try {
        this.conn.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn?.close();
    } catch {
      /* ignore */
    }
    setTimeout(() => this.peer?.destroy(), 100);
  }
}

export type NetSession = HostSession | GuestSession;

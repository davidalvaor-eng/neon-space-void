import { useCallback, useEffect, useRef, useState } from "react";
import { ShooterGame, type HudState, type RunInfo } from "./game/game";
import { getScores, saveScore, getPilotName, setPilotName, type ScoreEntry } from "./game/storage";
import { initAudio, isMuted, toggleMuted, sfx } from "./game/audio";
import { HostSession, GuestSession, normalizeCode, MAX_PLAYERS, type LobbyPlayer, type NetMsg } from "./game/net";
import { submitGlobal, fetchGlobal, sanitizeName } from "./game/leaderboard";
import { PLAYER_PALETTES } from "./game/sprites";
import { LeaderboardModal, LocalTable } from "./components/Leaderboard";

type Screen = "menu" | "online" | "lobby" | "playing" | "paused" | "over";
type SubmitState = "idle" | "sending" | "ok" | "error" | "skip";

const BASE_HUD: HudState = {
  score: 0,
  hp: 3,
  maxHp: 3,
  combo: 0,
  multiplier: 1,
  comboTimer: 0,
  elapsed: 0,
  bombCd: 0,
  bombReady: true,
  dashCd: 0,
  dashReady: true,
  bossActive: false,
  bossHp: 0,
  bossMax: 1,
  best: 0,
  role: "solo",
  players: [],
  localAlive: true,
  respawnIn: 0,
};

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

function defaultName(): string {
  const saved = getPilotName();
  if (saved) return saved;
  const n = "PILOTO" + Math.floor(10 + Math.random() * 89);
  setPilotName(n);
  return n;
}

function Cooldown({ frac }: { frac: number }) {
  if (frac <= 0) return null;
  return (
    <span
      className="absolute inset-0 rounded-[0.6rem]"
      style={{ background: `conic-gradient(rgba(2,6,23,.82) ${frac * 360}deg, transparent 0deg)` }}
    />
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<ShooterGame | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const screenRef = useRef<Screen>("menu");
  const sessionRef = useRef<HostSession | GuestSession | null>(null);
  const gameIdRef = useRef(0);
  const lastMult = useRef(1);
  const overHandler = useRef<(info: RunInfo) => void>(() => {});

  const [screen, setScreen] = useState<Screen>("menu");
  const [hud, setHud] = useState<HudState>(BASE_HUD);
  const [localScores, setLocalScores] = useState<ScoreEntry[]>(() => getScores());
  const [muted, setMutedState] = useState<boolean>(() => isMuted());
  const [touchMode, setTouchMode] = useState(false);
  const [name, setName] = useState<string>(() => defaultName());
  const [multKey, setMultKey] = useState(0);

  // online
  const [netRole, setNetRole] = useState<"none" | "host" | "guest">("none");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [lobby, setLobby] = useState<LobbyPlayer[]>([]);
  const [netBusy, setNetBusy] = useState<"" | "create" | "join">("");
  const [netError, setNetError] = useState("");
  const [copied, setCopied] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);

  // fin de partida
  const [run, setRun] = useState<RunInfo | null>(null);
  const [submit, setSubmit] = useState<SubmitState>("idle");
  const [globalRank, setGlobalRank] = useState<number | null>(null);

  // clasificación
  const [lbOpen, setLbOpen] = useState(false);
  const [lbTab, setLbTab] = useState<"solo" | "coop" | "local">("solo");
  const [lbKey, setLbKey] = useState(0);

  const go = useCallback((s: Screen) => {
    screenRef.current = s;
    setScreen(s);
  }, []);

  /* ---------- instancia del juego ---------- */

  useEffect(() => {
    const game = new ShooterGame(canvasRef.current!, {
      onGameOver: (info) => overHandler.current(info),
    });
    gameRef.current = game;
    const params = new URLSearchParams(window.location.search);
    const sala = params.get("sala");
    if (sala) {
      setJoinCode(normalizeCode(sala));
      go("online");
    }
    return () => {
      game.destroy();
      gameRef.current = null;
      sessionRef.current?.close();
    };
  }, [go]);

  /* ---------- polling del HUD ---------- */

  useEffect(() => {
    if (screen !== "playing" && screen !== "paused" && screen !== "over") return;
    const id = window.setInterval(() => {
      const g = gameRef.current;
      if (!g) return;
      const h = g.getHud();
      setHud(h);
      if (h.multiplier !== lastMult.current) {
        lastMult.current = h.multiplier;
        setMultKey((k) => k + 1);
        if (h.multiplier > 1 && screenRef.current === "playing") sfx.combo();
      }
    }, 90);
    return () => clearInterval(id);
  }, [screen]);

  /* ---------- bucles de red ---------- */

  useEffect(() => {
    if (netRole === "none") return;
    const id = window.setInterval(() => {
      const g = gameRef.current;
      const s = sessionRef.current;
      if (!g || !s) return;
      if (s instanceof HostSession) {
        if (g.role === "host" && (g.phase === "playing" || g.phase === "dying") && s.guestCount > 0) {
          s.broadcast(g.getSnapshot());
        }
      } else if (g.role === "guest" && g.phase === "playing") {
        const inp = g.getGuestInput();
        if (inp) s.send(inp);
      }
    }, netRole === "host" ? 50 : 33);
    return () => clearInterval(id);
  }, [netRole]);

  /* ---------- fin de partida ---------- */

  const publish = useCallback(
    async (entry: { name: string; score: number; mode: "solo" | "coop"; players: number; time: number }) => {
      if (entry.score <= 0) {
        setSubmit("skip");
        return;
      }
      setSubmit("sending");
      setGlobalRank(null);
      try {
        const res = await submitGlobal(entry);
        setSubmit("ok");
        setLbKey((k) => k + 1);
        try {
          const list = await fetchGlobal();
          const mine = list.filter((e) => e.mode === entry.mode);
          const idx = mine.findIndex((e) => e.id === res.id);
          if (idx >= 0) setGlobalRank(idx + 1);
          else {
            const better = mine.filter((e) => e.score > entry.score).length;
            setGlobalRank(better < 25 ? better + 1 : null);
          }
        } catch {
          /* ignore */
        }
      } catch {
        setSubmit("error");
      }
    },
    []
  );

  overHandler.current = (info: RunInfo) => {
    setRun(info);
    setSubmit("idle");
    setGlobalRank(null);
    const s = sessionRef.current;
    const coop = !!s;
    const label = coop ? info.names.join(" + ").slice(0, 40) : name;
    if (info.score > 0) setLocalScores(saveScore(label, info.score, coop ? "coop" : "solo"));
    if (s instanceof HostSession) {
      s.broadcast({ t: "over", g: gameIdRef.current, sc: info.score, el: info.time });
      void publish({ name: label, score: info.score, mode: "coop", players: info.players, time: info.time });
    } else if (!coop) {
      void publish({ name, score: info.score, mode: "solo", players: 1, time: info.time });
    } else {
      setSubmit("skip"); // el anfitrión publica la puntuación del equipo
    }
    go("over");
  };

  /* ---------- acciones ---------- */

  const commitName = useCallback((n: string) => {
    const clean = sanitizeName(n);
    setName(clean);
    setPilotName(clean);
    return clean;
  }, []);

  const startSolo = useCallback(() => {
    initAudio();
    (document.activeElement as HTMLElement | null)?.blur();
    setLeaveConfirm(false);
    gameRef.current?.startSolo(commitName(name));
    lastMult.current = 1;
    go("playing");
    sfx.ui();
  }, [go, name, commitName]);

  const startMatch = useCallback(() => {
    const s = sessionRef.current;
    if (!(s instanceof HostSession)) return;
    initAudio();
    (document.activeElement as HTMLElement | null)?.blur();
    gameIdRef.current++;
    const players = s.players.map((p) => ({ ...p }));
    gameRef.current?.startHost(players, s.localId, gameIdRef.current);
    s.broadcast({ t: "start", g: gameIdRef.current, players });
    setLeaveConfirm(false);
    lastMult.current = 1;
    go("playing");
    sfx.ui();
  }, [go]);

  const pauseGame = useCallback(() => {
    if (sessionRef.current) return;
    gameRef.current?.pause();
    go("paused");
  }, [go]);

  const resumeGame = useCallback(() => {
    gameRef.current?.resume();
    go("playing");
  }, [go]);

  const leaveSession = useCallback(
    (msg = "") => {
      sessionRef.current?.close();
      sessionRef.current = null;
      setNetRole("none");
      setLobby([]);
      setRoomCode("");
      setNetError(msg);
      setLeaveConfirm(false);
      gameRef.current?.quit();
      go(msg ? "online" : "menu");
    },
    [go]
  );

  const quitToMenu = useCallback(() => {
    if (sessionRef.current) {
      leaveSession();
      return;
    }
    gameRef.current?.quit();
    go("menu");
  }, [go, leaveSession]);

  const backToLobby = useCallback(() => {
    const s = sessionRef.current;
    if (s instanceof HostSession) s.broadcast({ t: "lobby-return" });
    gameRef.current?.quit();
    go("lobby");
  }, [go]);

  const doBomb = useCallback(() => gameRef.current?.triggerBomb(), []);
  const doDash = useCallback(() => gameRef.current?.triggerDash(), []);

  /* ---------- crear / unirse a sala ---------- */

  const createRoom = useCallback(async () => {
    initAudio();
    setNetError("");
    setNetBusy("create");
    const pilot = commitName(name);
    try {
      const s = await HostSession.create(pilot);
      sessionRef.current = s;
      setNetRole("host");
      setRoomCode(s.code);
      setLobby([...s.players]);
      s.onLobby = (pl) => setLobby(pl);
      s.onJoin = (p) => {
        sfx.join();
        const g = gameRef.current;
        if (g && g.role === "host" && (g.phase === "playing" || g.phase === "dying")) {
          g.addPlayer(p);
          s.send(p.id, { t: "start", g: gameIdRef.current, players: s.players });
        }
      };
      s.onLeave = (p) => {
        sfx.leave();
        gameRef.current?.removePlayer(p.id);
      };
      s.onMessage = (id, msg: NetMsg) => {
        if (msg.t === "i") gameRef.current?.applyRemoteInput(id, msg);
      };
      go("lobby");
      sfx.join();
    } catch (e) {
      setNetError((e as Error).message || "No se pudo crear la sala.");
    } finally {
      setNetBusy("");
    }
  }, [go, name, commitName]);

  const joinRoom = useCallback(
    async (codeArg?: string) => {
      initAudio();
      const code = normalizeCode(codeArg ?? joinCode);
      setNetError("");
      if (code.length !== 5) {
        setNetError("Introduce el código de 5 caracteres de la sala.");
        return;
      }
      setNetBusy("join");
      const pilot = commitName(name);
      try {
        const s = await GuestSession.join(code, pilot);
        sessionRef.current = s;
        setNetRole("guest");
        setRoomCode(code);
        setLobby([...s.players]);
        s.onMessage = (msg: NetMsg) => {
          const g = gameRef.current;
          if (!g) return;
          switch (msg.t) {
            case "lobby":
              setLobby(msg.players || []);
              break;
            case "start":
              gameIdRef.current = msg.g;
              g.startGuest(msg.players || [], s.localId, msg.g);
              setLeaveConfirm(false);
              lastMult.current = 1;
              go("playing");
              sfx.ui();
              break;
            case "s":
              g.applySnapshot(msg);
              break;
            case "over":
              if (msg.g === gameIdRef.current) g.guestOver(msg.sc, msg.el);
              break;
            case "lobby-return":
              g.quit();
              go("lobby");
              break;
          }
        };
        s.onClose = (reason) => leaveSession(reason);
        go("lobby");
        sfx.join();
        // limpia ?sala= de la URL
        if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
      } catch (e) {
        setNetError((e as Error).message || "No se pudo unir a la sala.");
      } finally {
        setNetBusy("");
      }
    },
    [go, joinCode, name, commitName, leaveSession]
  );

  const shareLink = roomCode
    ? `${window.location.origin}${window.location.pathname}?sala=${roomCode}`
    : "";

  const copyInvite = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (touchMode && nav.share) {
        await nav.share({ title: "NEON VOID", text: `¡Únete a mi sala de NEON VOID! Código: ${roomCode}`, url: shareLink });
        return;
      }
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* el usuario canceló o no hay portapapeles */
    }
  }, [roomCode, shareLink, touchMode]);

  /* ---------- teclado ---------- */

  useEffect(() => {
    const computeMove = () => {
      const k = keysRef.current;
      let x = 0;
      let y = 0;
      if (k["a"] || k["arrowleft"]) x -= 1;
      if (k["d"] || k["arrowright"]) x += 1;
      if (k["w"] || k["arrowup"]) y -= 1;
      if (k["s"] || k["arrowdown"]) y += 1;
      gameRef.current?.setMoveInput(x, y);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      initAudio();
      const k = e.key.toLowerCase();
      const sc = screenRef.current;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();

      if (k === "p" || k === "escape") {
        if (sc === "playing" && !sessionRef.current) pauseGame();
        else if (sc === "paused") resumeGame();
        else if (sc === "playing" && sessionRef.current) setLeaveConfirm((v) => !v);
        return;
      }
      if (k === "r") {
        if (!sessionRef.current && (sc === "playing" || sc === "paused" || sc === "over")) startSolo();
        else if (sessionRef.current instanceof HostSession && sc === "over") startMatch();
        return;
      }
      if (k === "e") {
        doBomb();
        return;
      }
      if (k === "m") {
        setMutedState(toggleMuted());
        return;
      }
      if ((k === " " || k === "shift") && sc === "playing") {
        doDash();
        return;
      }
      if (k === "enter" || k === " ") {
        if (tag === "BUTTON") return;
        if (sc === "menu" || (sc === "over" && !sessionRef.current)) startSolo();
        return;
      }
      keysRef.current[k] = true;
      computeMove();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (keysRef.current[k]) {
        keysRef.current[k] = false;
        computeMove();
      }
    };

    const onBlur = () => {
      keysRef.current = {};
      gameRef.current?.setMoveInput(0, 0);
      if (screenRef.current === "playing" && !sessionRef.current) {
        gameRef.current?.pause();
        go("paused");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [startSolo, startMatch, pauseGame, resumeGame, doBomb, doDash, go]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden && screenRef.current === "playing" && !sessionRef.current) {
        gameRef.current?.pause();
        go("paused");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [go]);

  /* ---------- puntero sobre el canvas ---------- */

  const toLocal = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    initAudio();
    const { x, y } = toLocal(e);
    const touch = e.pointerType === "touch";
    if (touch !== touchMode) setTouchMode(touch);
    gameRef.current?.setTouchMode(touch);
    gameRef.current?.pointerDown(x, y, e.pointerId);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && touchMode) {
      setTouchMode(false);
      gameRef.current?.setTouchMode(false);
    }
    const { x, y } = toLocal(e);
    gameRef.current?.pointerMove(x, y, e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    gameRef.current?.pointerUp(e.pointerId);
  };

  const blurButtons = (e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (btn) setTimeout(() => btn.blur(), 0);
  };

  const openLb = (tab: "solo" | "coop" | "local") => {
    setLbTab(tab);
    setLbOpen(true);
    sfx.ui();
  };

  const inMatch = screen === "playing" || screen === "paused" || screen === "over";
  const isMP = netRole !== "none";
  const isHost = netRole === "host";

  /* ======================= render ======================= */

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#04050f]" onClickCapture={blurButtons}>
      <canvas
        ref={canvasRef}
        id="game-canvas"
        className="absolute inset-0 block h-full w-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="scanlines pointer-events-none absolute inset-0 opacity-25" />

      {/* ---------------- HUD ---------------- */}
      {inMatch && (
        <div className="font-display pointer-events-none absolute inset-0">
          <div className="absolute top-0 right-0 left-0 flex items-start justify-between gap-2 p-3 sm:p-4">
            <div className="flex flex-col gap-1">
              <div
                key={hud.score}
                className="nv-pop text-2xl font-black tracking-wider text-cyan-200 sm:text-3xl"
                style={{ textShadow: "0 0 16px rgba(34,211,238,.65)" }}
              >
                {hud.score.toLocaleString()}
              </div>
              <div className="flex items-center gap-2 text-[10px] tracking-widest text-cyan-100/60 sm:text-xs">
                {isMP ? (
                  <span className="text-fuchsia-200/80">CO-OP · SALA {roomCode}</span>
                ) : (
                  <span>MEJOR {hud.best.toLocaleString()}</span>
                )}
                <span>•</span>
                <span>{formatTime(hud.elapsed)}</span>
              </div>
              {hud.combo > 1 && (
                <div className="flex flex-col gap-1 self-start">
                  <div
                    key={multKey}
                    className="nv-pop inline-flex items-center gap-1 self-start rounded border border-amber-300/50 bg-amber-400/10 px-2 py-0.5 text-xs font-bold tracking-widest text-amber-200"
                  >
                    x{hud.multiplier} COMBO · {hud.combo}
                  </div>
                  <div className="h-1 w-28 overflow-hidden rounded-full bg-amber-900/40">
                    <div
                      className="h-full bg-amber-300 transition-[width] duration-100"
                      style={{ width: `${Math.min(100, (hud.comboTimer / 1.6) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              {(screen === "playing" || screen === "paused") &&
                (isMP ? (
                  <button
                    className="nv-btn nv-btn-danger pointer-events-auto !px-3 !py-2 text-xs"
                    onClick={() => setLeaveConfirm((v) => !v)}
                  >
                    ✕ SALIR
                  </button>
                ) : (
                  <button
                    className="nv-btn pointer-events-auto !px-3 !py-2 text-xs"
                    onClick={() => (screen === "playing" ? pauseGame() : resumeGame())}
                    aria-label="Pausar o reanudar"
                  >
                    {screen === "playing" ? "❚❚ PAUSA" : "▶ SEGUIR"}
                  </button>
                ))}
              {isMP && hud.players.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg border border-cyan-300/15 bg-slate-950/55 p-2 backdrop-blur-sm">
                  {hud.players.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-[10px] tracking-wider">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: PLAYER_PALETTES[p.c].hex, boxShadow: `0 0 8px ${PLAYER_PALETTES[p.c].hex}` }}
                      />
                      <span
                        className={`max-w-[84px] truncate ${p.alive ? "" : "line-through opacity-50"}`}
                        style={{ color: PLAYER_PALETTES[p.c].hex }}
                      >
                        {p.name}
                        {p.local ? " (TÚ)" : ""}
                      </span>
                      <span className="ml-auto text-rose-400">
                        {p.alive ? "♥".repeat(p.hp) : p.respawn > 0 ? `↻${Math.ceil(p.respawn)}s` : "✕"}
                      </span>
                      <span className="w-8 text-right text-cyan-100/50">{p.kills}☠</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div
            key={hud.hp}
            className={`nv-pop absolute bottom-4 left-4 flex items-center gap-1.5 text-xl sm:text-2xl ${
              hud.hp === 1 ? "animate-pulse" : ""
            } ${touchMode ? "bottom-[10.5rem]" : ""}`}
          >
            {Array.from({ length: hud.maxHp }).map((_, i) => (
              <span
                key={i}
                className={i < hud.hp ? "text-rose-400" : "text-slate-700"}
                style={i < hud.hp ? { textShadow: "0 0 12px rgba(251,113,133,.8)" } : undefined}
              >
                ♥
              </span>
            ))}
          </div>

          {screen === "playing" && hud.localAlive && (
            <>
              <button
                onClick={doBomb}
                disabled={!hud.bombReady}
                className="nv-btn pointer-events-auto absolute right-4 bottom-4 flex !h-16 !w-16 flex-col items-center justify-center !gap-0 !p-0 text-[10px] tracking-widest"
                style={{ borderColor: hud.bombReady ? "rgba(103,232,249,.6)" : "rgba(148,163,184,.3)" }}
                aria-label="Bomba de onda expansiva"
              >
                <span className="relative z-10 flex flex-col items-center leading-tight">
                  <span className="text-base">💥</span>
                  <span>{touchMode ? "BOMBA" : "E"}</span>
                </span>
                <Cooldown frac={hud.bombReady ? 0 : hud.bombCd} />
              </button>
              <button
                onClick={doDash}
                disabled={!hud.dashReady}
                className="nv-btn pointer-events-auto absolute right-[5.75rem] bottom-4 flex !h-14 !w-14 flex-col items-center justify-center !gap-0 !p-0 text-[9px] tracking-widest"
                style={{ borderColor: hud.dashReady ? "rgba(232,121,249,.6)" : "rgba(148,163,184,.3)" }}
                aria-label="Impulso"
              >
                <span className="relative z-10 flex flex-col items-center leading-tight">
                  <span className="text-base">⚡</span>
                  <span>{touchMode ? "IMPULSO" : "ESPACIO"}</span>
                </span>
                <Cooldown frac={hud.dashReady ? 0 : hud.dashCd} />
              </button>
            </>
          )}

          {screen === "playing" && isMP && !hud.localAlive && (
            <div className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-1 text-center">
              <div className="text-lg font-black tracking-[0.3em] text-rose-300" style={{ textShadow: "0 0 14px rgba(251,113,133,.7)" }}>
                DERRIBADO
              </div>
              <div className="text-[11px] tracking-widest text-cyan-100/70">
                {hud.respawnIn > 0
                  ? `REAPARECES EN ${Math.ceil(hud.respawnIn)}s · ¡AGUANTAD!`
                  : "ESPECTANDO A TU EQUIPO…"}
              </div>
            </div>
          )}

          {touchMode && screen === "playing" && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-[10px] tracking-widest whitespace-nowrap text-cyan-100/40">
              ARRASTRA PARA MOVER · DISPARO AUTOMÁTICO
            </div>
          )}
        </div>
      )}

      {/* confirmación de salida en multijugador (no pausa la partida) */}
      {leaveConfirm && screen === "playing" && isMP && (
        <div className="absolute inset-x-0 top-24 z-30 flex justify-center px-4">
          <div className="nv-panel nv-fade-in flex flex-col items-center gap-3 p-4">
            <div className="text-xs tracking-widest text-cyan-100">
              {isHost ? "¿CERRAR LA SALA PARA TODOS?" : "¿ABANDONAR LA PARTIDA?"}
            </div>
            <div className="flex gap-2">
              <button className="nv-btn nv-btn-danger !py-2" onClick={() => leaveSession()}>
                SÍ, SALIR
              </button>
              <button className="nv-btn !py-2" onClick={() => setLeaveConfirm(false)}>
                SEGUIR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MENÚ ---------------- */}
      {screen === "menu" && (
        <div className="absolute inset-0 flex flex-col items-center justify-start gap-4 overflow-y-auto p-4 py-8 sm:justify-center">
          <div className="nv-float text-center">
            <div className="mb-2 text-[10px] tracking-[0.5em] text-cyan-200/60">SHOOTER DE ARENA NEÓN 2D</div>
            <h1
              className="nv-title-hot font-display text-5xl font-black tracking-wider sm:text-7xl"
              style={{ filter: "drop-shadow(0 0 22px rgba(34,211,238,.45)) drop-shadow(0 0 60px rgba(168,85,247,.3))" }}
            >
              NEON VOID
            </h1>
          </div>

          <label className="flex flex-col items-center gap-1">
            <span className="text-[10px] tracking-[0.3em] text-cyan-200/60">NOMBRE DE PILOTO</span>
            <input
              className="nv-input"
              value={name}
              maxLength={12}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              onBlur={(e) => commitName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              aria-label="Nombre de piloto"
            />
          </label>

          <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
            <button className="nv-btn nv-btn-primary nv-glow-btn flex-1 !py-4 text-base" onClick={startSolo} autoFocus>
              ▶ JUGAR SOLO
            </button>
            <button
              className="nv-btn flex-1 !py-4 text-base"
              style={{ borderColor: "rgba(232,121,249,.6)", color: "#f5d0fe" }}
              onClick={() => {
                sfx.ui();
                setNetError("");
                go("online");
              }}
            >
              🌐 ONLINE CO-OP
            </button>
          </div>
          <button className="nv-btn !py-2.5 text-xs" onClick={() => openLb("solo")}>
            🏆 CLASIFICACIÓN GLOBAL
          </button>
          <div className="hidden text-[10px] tracking-widest text-cyan-100/50 sm:block">
            ENTER PARA JUGAR · R REINICIA · M SILENCIA
          </div>

          <div className="flex w-full max-w-4xl flex-col items-center justify-center gap-4 lg:flex-row lg:items-start">
            <div className="nv-panel w-full max-w-sm p-4">
              <div className="mb-2 text-xs tracking-[0.3em] text-cyan-200/70">CÓMO JUGAR</div>
              <ul className="space-y-1 text-[11px] leading-6 tracking-wide text-cyan-50/80">
                <li>
                  <b className="text-cyan-200">PC</b> — WASD / FLECHAS para moverte · RATÓN apunta · DISPARO AUTO
                </li>
                <li>
                  <b className="text-cyan-200">MÓVIL</b> — ARRASTRA para moverte · AUTO-APUNTADO
                </li>
                <li>
                  <b className="text-cyan-200">ESPACIO / ⚡</b> — IMPULSO invulnerable (6s)
                </li>
                <li>
                  <b className="text-cyan-200">E / 💥</b> — ONDA EXPANSIVA que limpia la zona (16s)
                </li>
                <li>
                  Encadena bajas en 1.6s para <b className="text-amber-300">COMBOS hasta x5</b> · Élites doradas = x3 pts
                </li>
                <li>
                  <b className="text-fuchsia-300">CO-OP</b> — hasta 4 pilotos; los caídos reaparecen si alguien sobrevive
                </li>
              </ul>
            </div>
            <div className="nv-panel w-full max-w-sm p-4">
              <div className="mb-2 flex items-center justify-between text-xs tracking-[0.3em] text-cyan-200/70">
                <span>TUS RÉCORDS</span>
                <button className="text-[10px] text-cyan-300 hover:text-cyan-100" onClick={() => openLb("local")}>
                  VER TODO →
                </button>
              </div>
              <LocalTable scores={localScores} compact />
            </div>
          </div>

          <button className="nv-btn !py-2 text-xs" onClick={() => setMutedState(toggleMuted())}>
            {muted ? "🔇 ACTIVAR SONIDO" : "🔊 SILENCIAR"}
          </button>
        </div>
      )}

      {/* ---------------- ONLINE: crear / unirse ---------------- */}
      {screen === "online" && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-[2px]">
          <div className="nv-panel nv-fade-in flex w-full max-w-md flex-col gap-5 p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-xl font-black tracking-widest text-fuchsia-200">ONLINE CO-OP</div>
                <div className="text-[10px] tracking-widest text-cyan-100/50">HASTA {MAX_PLAYERS} PILOTOS · CONEXIÓN DIRECTA P2P</div>
              </div>
              <button className="nv-btn !px-3 !py-2" onClick={() => go("menu")} aria-label="Volver">
                ←
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] tracking-[0.3em] text-cyan-200/60">TU NOMBRE</span>
              <input
                className="nv-input !w-full"
                value={name}
                maxLength={12}
                onChange={(e) => setName(e.target.value.toUpperCase())}
                onBlur={(e) => commitName(e.target.value)}
              />
            </label>

            <button
              className="nv-btn nv-btn-primary !py-3.5"
              onClick={() => void createRoom()}
              disabled={!!netBusy}
            >
              {netBusy === "create" ? "CREANDO SALA…" : "➕ CREAR SALA"}
            </button>

            <div className="flex items-center gap-3 text-[10px] tracking-widest text-cyan-100/40">
              <span className="h-px flex-1 bg-cyan-300/20" /> O ÚNETE CON UN CÓDIGO <span className="h-px flex-1 bg-cyan-300/20" />
            </div>

            <div className="flex gap-2">
              <input
                className="nv-input !w-full flex-1 text-lg font-bold"
                placeholder="ABCDE"
                value={joinCode}
                maxLength={5}
                onChange={(e) => setJoinCode(normalizeCode(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void joinRoom();
                }}
                aria-label="Código de sala"
              />
              <button className="nv-btn !px-5" onClick={() => void joinRoom()} disabled={!!netBusy}>
                {netBusy === "join" ? "…" : "UNIRSE"}
              </button>
            </div>

            {netError && (
              <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-center text-[11px] tracking-wide text-rose-200">
                {netError}
              </div>
            )}

            <div className="text-center text-[10px] leading-5 tracking-wide text-cyan-100/40">
              El anfitrión simula la partida: mantén su pestaña visible para que todos jueguen fluido.
            </div>
          </div>
        </div>
      )}

      {/* ---------------- LOBBY ---------------- */}
      {screen === "lobby" && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-[2px]">
          <div className="nv-panel nv-fade-in flex w-full max-w-md flex-col gap-4 p-5 sm:p-6">
            <div className="text-center">
              <div className="text-[10px] tracking-[0.4em] text-cyan-200/60">CÓDIGO DE SALA</div>
              <div
                className="font-display text-5xl font-black tracking-[0.25em] text-cyan-100"
                style={{ textShadow: "0 0 24px rgba(34,211,238,.6)" }}
              >
                {roomCode}
              </div>
              {isHost && (
                <button className="nv-btn mt-3 !py-2 text-xs" onClick={() => void copyInvite()}>
                  {copied ? "✓ ENLACE COPIADO" : touchMode ? "📤 INVITAR" : "🔗 COPIAR ENLACE DE INVITACIÓN"}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-[10px] tracking-[0.3em] text-cyan-200/60">
                PILOTOS ({lobby.length}/{MAX_PLAYERS})
              </div>
              {Array.from({ length: MAX_PLAYERS }).map((_, i) => {
                const p = lobby[i];
                const pal = p ? PLAYER_PALETTES[p.c] : null;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm tracking-wider ${
                      p ? "border-cyan-300/25 bg-slate-900/60" : "border-dashed border-cyan-300/10 text-cyan-100/25"
                    }`}
                  >
                    {p && pal ? (
                      <>
                        <span className="h-3 w-3 rounded-full" style={{ background: pal.hex, boxShadow: `0 0 10px ${pal.hex}` }} />
                        <span className="font-bold" style={{ color: pal.hex }}>
                          {p.name}
                        </span>
                        <span className="ml-auto text-[10px] text-cyan-100/50">
                          {i === 0 ? "👑 ANFITRIÓN" : ""}
                          {(isHost && i === 0) || (!isHost && p.id === (sessionRef.current as GuestSession | null)?.localId)
                            ? " (TÚ)"
                            : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px]">ESPERANDO PILOTO…</span>
                    )}
                  </div>
                );
              })}
            </div>

            {isHost ? (
              <button className="nv-btn nv-btn-primary nv-glow-btn !py-3.5 text-base" onClick={startMatch}>
                ▶ EMPEZAR PARTIDA {lobby.length === 1 ? "(SOLO TÚ)" : `(${lobby.length})`}
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 py-2 text-[11px] tracking-widest text-cyan-100/70">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" />
                ESPERANDO A QUE EL ANFITRIÓN EMPIECE…
              </div>
            )}
            <button className="nv-btn nv-btn-danger !py-2 text-xs" onClick={() => leaveSession()}>
              {isHost ? "CERRAR SALA" : "SALIR DE LA SALA"}
            </button>
            {isHost && (
              <div className="text-center text-[10px] tracking-wide text-cyan-100/40">
                Los amigos también pueden unirse en mitad de la partida.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- PAUSA ---------------- */}
      {screen === "paused" && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
          <div className="nv-panel nv-fade-in flex flex-col items-center gap-4 p-8">
            <div className="font-display text-2xl font-black tracking-[0.3em] text-cyan-100" style={{ textShadow: "0 0 18px rgba(34,211,238,.5)" }}>
              PAUSA
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <button className="nv-btn nv-btn-primary" onClick={resumeGame} autoFocus>
                ▶ SEGUIR
              </button>
              <button className="nv-btn" onClick={startSolo}>
                ↻ REINICIAR
              </button>
              <button className="nv-btn nv-btn-danger" onClick={quitToMenu}>
                ✕ MENÚ
              </button>
            </div>
            <div className="text-[10px] tracking-widest text-cyan-100/40">P PARA SEGUIR · R PARA REINICIAR</div>
          </div>
        </div>
      )}

      {/* ---------------- FIN DE PARTIDA ---------------- */}
      {screen === "over" && run && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="nv-panel nv-fade-in flex w-full max-w-lg flex-col items-center gap-4 p-6 sm:p-8">
            <div className="text-xs tracking-[0.5em] text-rose-300/80">{isMP ? "EQUIPO ELIMINADO" : "FIN DE LA PARTIDA"}</div>
            <div
              key={run.score}
              className="nv-pop font-display text-5xl font-black text-cyan-100 sm:text-6xl"
              style={{ textShadow: "0 0 26px rgba(34,211,238,.55)" }}
            >
              {run.score.toLocaleString()}
            </div>
            <div className="text-[10px] tracking-widest text-cyan-100/50">
              SOBREVIVISTE {formatTime(run.time)}
              {!isMP && ` · MEJOR LOCAL ${Math.max(hud.best, run.score).toLocaleString()}`}
            </div>

            {isMP && hud.players.length > 0 && (
              <div className="w-full rounded-lg border border-cyan-300/15 bg-slate-900/50 p-2">
                {[...hud.players]
                  .sort((a, b) => b.kills - a.kills)
                  .map((p, i) => (
                    <div key={p.id} className="flex items-center gap-2 px-2 py-1 text-[11px] tracking-wider">
                      <span className="w-5 text-cyan-100/50">{i === 0 ? "⭐" : i + 1}</span>
                      <span className="font-bold" style={{ color: PLAYER_PALETTES[p.c].hex }}>
                        {p.name}
                        {p.local ? " (TÚ)" : ""}
                      </span>
                      <span className="ml-auto text-cyan-100/70">{p.kills} BAJAS</span>
                    </div>
                  ))}
              </div>
            )}

            <div className="min-h-[1.5rem] text-center text-[11px] tracking-widest">
              {submit === "sending" && (
                <span className="inline-flex items-center gap-2 text-cyan-200/80">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" />
                  PUBLICANDO EN LA CLASIFICACIÓN GLOBAL…
                </span>
              )}
              {submit === "ok" && (
                <span className="text-emerald-300">
                  ✓ PUBLICADO EN LA CLASIFICACIÓN GLOBAL
                  {globalRank !== null && (
                    <span className="ml-1 font-bold text-amber-300">· PUESTO #{globalRank}</span>
                  )}
                </span>
              )}
              {submit === "error" && <span className="text-rose-300">⚠ SIN CONEXIÓN: GUARDADO SOLO EN ESTE DISPOSITIVO</span>}
              {submit === "skip" && isMP && !isHost && (
                <span className="text-cyan-100/60">EL ANFITRIÓN PUBLICA LA PUNTUACIÓN DEL EQUIPO</span>
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              {!isMP && (
                <button className="nv-btn nv-btn-primary nv-glow-btn" onClick={startSolo} autoFocus>
                  ▶ OTRA VEZ
                </button>
              )}
              {isMP && isHost && (
                <>
                  <button className="nv-btn nv-btn-primary nv-glow-btn" onClick={startMatch} autoFocus>
                    ▶ REVANCHA
                  </button>
                  <button className="nv-btn" onClick={backToLobby}>
                    SALA
                  </button>
                </>
              )}
              {isMP && !isHost && (
                <div className="flex items-center gap-2 text-[11px] tracking-widest text-cyan-100/70">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" />
                  ESPERANDO AL ANFITRIÓN…
                </div>
              )}
              <button className="nv-btn" onClick={() => openLb(isMP ? "coop" : "solo")}>
                🏆 RANKING
              </button>
              <button className="nv-btn nv-btn-danger" onClick={quitToMenu}>
                {isMP ? "SALIR" : "MENÚ"}
              </button>
            </div>
            {!isMP && (
              <div className="text-[10px] tracking-widest text-cyan-100/40">PULSA ENTER O R PARA REINICIAR AL INSTANTE</div>
            )}
          </div>
        </div>
      )}

      <LeaderboardModal open={lbOpen} onClose={() => setLbOpen(false)} initialTab={lbTab} refreshKey={lbKey} />
    </div>
  );
}

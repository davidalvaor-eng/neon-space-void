import { useCallback, useEffect, useState } from "react";
import {
  fetchGlobal,
  getCachedGlobal,
  type GlobalEntry,
} from "../game/leaderboard";
import { getScores, type ScoreEntry } from "../game/storage";

type Tab = "solo" | "coop" | "local";

const DIFF_TAG = [
  { t: "NORMAL", c: "#67e8f9" },
  { t: "DIFÍCIL", c: "#fb923c" },
  { t: "PESADILLA", c: "#f43f5e" },
];

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function Medal({ i }: { i: number }) {
  return (
    <span
      className={`w-8 shrink-0 text-center font-bold ${
        i === 0 ? "text-amber-300" : i === 1 ? "text-cyan-200" : i === 2 ? "text-orange-300" : "text-cyan-100/40"
      }`}
    >
      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
    </span>
  );
}

export function LocalTable({ scores, compact = false }: { scores: ScoreEntry[]; compact?: boolean }) {
  if (scores.length === 0) {
    return (
      <div className="py-6 text-center text-[11px] tracking-widest text-cyan-100/40">
        SIN RÉCORDS TODAVÍA — ¡SÉ EL PRIMERO!
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-1">
      {scores.slice(0, compact ? 5 : 10).map((s, i) => (
        <li
          key={`${s.name}-${s.score}-${i}`}
          className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] tracking-wider ${
            i === 0 ? "bg-amber-400/10 text-amber-200" : "text-cyan-50/80"
          }`}
        >
          <Medal i={i} />
          <span className="flex-1 truncate">{s.name}</span>
          {s.mode === "coop" && (
            <span className="rounded bg-fuchsia-500/15 px-1 text-[9px] text-fuchsia-200">CO-OP</span>
          )}
          <span className="font-bold">{s.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

function GlobalTable({ entries, mode }: { entries: GlobalEntry[]; mode: "solo" | "coop" }) {
  const list = entries.filter((e) => e.mode === mode);
  if (list.length === 0) {
    return (
      <div className="py-6 text-center text-[11px] tracking-widest text-cyan-100/40">
        {mode === "solo" ? "AÚN NO HAY PUNTUACIONES GLOBALES EN SOLITARIO" : "AÚN NO HAY PUNTUACIONES DE EQUIPO"}
        <div className="mt-1 text-cyan-100/30">¡JUEGA Y ESTRENA LA TABLA!</div>
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-1">
      {list.map((e, i) => (
        <li
          key={e.id}
          className={`flex items-center gap-2 rounded px-2 py-1.5 text-[11px] tracking-wider ${
            e.mine
              ? "bg-cyan-400/15 text-cyan-50 ring-1 ring-cyan-300/40"
              : i === 0
                ? "bg-amber-400/10 text-amber-200"
                : "text-cyan-50/80"
          }`}
        >
          <Medal i={i} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              {e.name}
              {e.mine && <span className="ml-1 text-[9px] text-cyan-300">(TÚ)</span>}
            </span>
            <span className="flex flex-wrap items-center gap-1 text-[9px] text-cyan-100/40">
              <span>
                {fmtTime(e.time)} · {fmtDate(e.date)}
                {mode === "coop" && ` · ${e.players}P`}
              </span>
              {e.bosses > 0 && <span className="text-amber-300/80">☠{e.bosses}</span>}
              {e.diff > 0 && (
                <span
                  className="rounded px-1"
                  style={{ color: DIFF_TAG[e.diff].c, background: DIFF_TAG[e.diff].c + "22" }}
                >
                  {DIFF_TAG[e.diff].t}
                </span>
              )}
              {e.rush && <span className="rounded bg-rose-500/15 px-1 text-rose-300">JEFES</span>}
            </span>
          </span>
          <span className="font-bold">{e.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

export function LeaderboardModal({
  open,
  onClose,
  initialTab = "solo",
  refreshKey = 0,
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
  refreshKey?: number;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [entries, setEntries] = useState<GlobalEntry[]>(() => getCachedGlobal());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<ScoreEntry[]>(() => getScores());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchGlobal();
      setEntries(list);
    } catch {
      setError("No se pudo conectar. Mostrando la última copia guardada.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setLocal(getScores());
      void load();
    }
  }, [open, initialTab, load, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // con la modal abierta, ninguna tecla llega al juego
      e.stopImmediatePropagation();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: "solo", label: "🌍 SOLO" },
    { id: "coop", label: "🌍 CO-OP" },
    { id: "local", label: "📱 LOCAL" },
  ];

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nv-panel nv-fade-in flex max-h-[92vh] w-full max-w-md flex-col p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-display text-lg font-black tracking-widest text-cyan-100">CLASIFICACIÓN</div>
            <div className="text-[10px] tracking-widest text-cyan-100/50">
              {tab === "local" ? "RÉCORDS DE ESTE DISPOSITIVO" : "MEJORES PILOTOS DEL MUNDO · EN VIVO"}
            </div>
          </div>
          <button className="nv-btn !px-3 !py-2" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-900/60 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2 py-2 text-[10px] font-bold tracking-widest transition ${
                tab === t.id
                  ? "bg-cyan-400/20 text-cyan-50 shadow-[0_0_12px_rgba(34,211,238,.3)]"
                  : "text-cyan-100/50 hover:text-cyan-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto pr-1">
          {tab === "local" ? (
            <LocalTable scores={local} />
          ) : loading && entries.filter((e) => e.mode === tab).length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-[11px] tracking-widest text-cyan-100/60">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" />
              CONECTANDO CON LA RED…
            </div>
          ) : (
            <GlobalTable entries={entries} mode={tab} />
          )}
        </div>

        {tab !== "local" && (
          <div className="mt-3 flex items-center justify-between gap-2 text-[10px] tracking-wider">
            <span className={error ? "text-rose-300" : "text-cyan-100/40"}>
              {error ?? (loading ? "ACTUALIZANDO…" : "DATOS DESCENTRALIZADOS (NOSTR)")}
            </span>
            <button className="nv-btn !px-3 !py-1.5 !text-[10px]" onClick={() => void load()} disabled={loading}>
              {loading ? "…" : "↻ ACTUALIZAR"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

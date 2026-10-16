/** Tabla de récords LOCAL persistida en localStorage (top 10). */

export interface ScoreEntry {
  name: string;
  score: number;
  date: number;
  mode?: "solo" | "coop";
}

const KEY = "nv:scores:v1";
const NAME_KEY = "nv:pilot";
const MAX_ENTRIES = 10;

export function getScores(): ScoreEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (e): e is ScoreEntry =>
          !!e &&
          typeof e === "object" &&
          typeof e.name === "string" &&
          typeof e.score === "number" &&
          Number.isFinite(e.score)
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function saveScore(
  name: string,
  score: number,
  mode: "solo" | "coop" = "solo"
): ScoreEntry[] {
  const clean = (name || "PILOTO").toUpperCase().trim().slice(0, 24) || "PILOTO";
  const list = getScores();
  list.push({ name: clean, score: Math.floor(score), date: Date.now(), mode });
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(top));
  } catch {
    /* sin almacenamiento disponible */
  }
  return top;
}

export function qualifies(score: number): boolean {
  if (!Number.isFinite(score) || score <= 0) return false;
  const list = getScores();
  return list.length < MAX_ENTRIES || score > list[list.length - 1].score;
}

export function getPilotName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}

export function setPilotName(n: string): void {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}

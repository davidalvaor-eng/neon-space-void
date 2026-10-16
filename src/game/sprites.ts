/** Sprites pre-renderizados con brillo neón (se generan una sola vez). */

export type DotColor = "cyan" | "yellow" | "magenta" | "orange" | "red" | "white" | "pink" | "lime" | "amber";

const TAU = Math.PI * 2;

export const DOT_HEX: Record<DotColor, string> = {
  cyan: "#67e8f9",
  yellow: "#fde047",
  magenta: "#e879f9",
  orange: "#fb923c",
  red: "#f87171",
  white: "#ffffff",
  pink: "#f9a8d4",
  lime: "#bef264",
  amber: "#fcd34d",
};

/** Paleta por jugador: [casco claro, casco medio, casco oscuro, brillo, bala] */
export const PLAYER_PALETTES = [
  { light: "#eaffff", mid: "#22d3ee", dark: "#0e7490", glow: "rgba(103,232,249,.9)", bullet: "#fde047", bulletGlow: "rgba(250,204,21,.95)", hex: "#67e8f9", dot: "cyan" as DotColor },
  { light: "#fff0f7", mid: "#f472b6", dark: "#9d174d", glow: "rgba(244,114,182,.9)", bullet: "#f9a8d4", bulletGlow: "rgba(244,114,182,.95)", hex: "#f472b6", dot: "pink" as DotColor },
  { light: "#f7ffe6", mid: "#a3e635", dark: "#3f6212", glow: "rgba(163,230,53,.9)", bullet: "#d9f99d", bulletGlow: "rgba(163,230,53,.95)", hex: "#a3e635", dot: "lime" as DotColor },
  { light: "#fffbeb", mid: "#fbbf24", dark: "#92400e", glow: "rgba(251,191,36,.9)", bullet: "#fde68a", bulletGlow: "rgba(251,191,36,.95)", hex: "#fbbf24", dot: "amber" as DotColor },
];

function canvasSprite(
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  return c;
}

export const SPRITES: Record<string, HTMLCanvasElement> = {};
export const DOT_SPR: Record<string, HTMLCanvasElement> = {};
export const RING_SPR: Record<string, HTMLCanvasElement> = {};

let built = false;
export function buildSprites(): void {
  if (built) return;
  built = true;
  const S = 96;

  PLAYER_PALETTES.forEach((pal, i) => {
    SPRITES["player" + i] = canvasSprite(S, (g, s) => {
      g.translate(s / 2, s / 2);
      g.shadowColor = pal.glow;
      g.shadowBlur = 22;
      const grad = g.createLinearGradient(0, -s * 0.28, 0, s * 0.24);
      grad.addColorStop(0, pal.light);
      grad.addColorStop(0.45, pal.mid);
      grad.addColorStop(1, pal.dark);
      g.beginPath();
      g.moveTo(0, -s * 0.3);
      g.lineTo(s * 0.2, s * 0.24);
      g.lineTo(s * 0.08, s * 0.1);
      g.lineTo(0, s * 0.17);
      g.lineTo(-s * 0.08, s * 0.1);
      g.lineTo(-s * 0.2, s * 0.24);
      g.closePath();
      g.fillStyle = grad;
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = "rgba(255,255,255,.85)";
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.moveTo(0, -s * 0.16);
      g.lineTo(0, s * 0.1);
      g.strokeStyle = "rgba(255,255,255,.55)";
      g.lineWidth = 1.5;
      g.stroke();
      g.beginPath();
      g.arc(0, -s * 0.02, s * 0.045, 0, TAU);
      g.fillStyle = "#ffffff";
      g.shadowColor = "#ffffff";
      g.shadowBlur = 10;
      g.fill();
    });

    SPRITES["pbullet" + i] = canvasSprite(48, (g, s) => {
      g.translate(s / 2, s / 2);
      g.shadowColor = pal.bulletGlow;
      g.shadowBlur = 14;
      g.beginPath();
      g.moveTo(0, -s * 0.5);
      g.lineTo(s * 0.22, -s * 0.1);
      g.lineTo(s * 0.14, s * 0.4);
      g.lineTo(0, s * 0.5);
      g.lineTo(-s * 0.14, s * 0.4);
      g.lineTo(-s * 0.22, -s * 0.1);
      g.closePath();
      g.fillStyle = pal.bullet;
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = "rgba(255,255,255,.85)";
      g.lineWidth = 1.5;
      g.stroke();
    });
  });

  SPRITES.ebullet = canvasSprite(32, (g, s) => {
    g.translate(s / 2, s / 2);
    g.shadowColor = "rgba(248,113,113,.95)";
    g.shadowBlur = 12;
    g.beginPath();
    g.arc(0, 0, s * 0.26, 0, TAU);
    g.fillStyle = "#f87171";
    g.fill();
    g.shadowBlur = 0;
    g.beginPath();
    g.arc(0, 0, s * 0.12, 0, TAU);
    g.fillStyle = "#fff1f2";
    g.fill();
  });

  SPRITES.grunt = canvasSprite(64, (g, s) => {
    g.translate(s / 2, s / 2);
    g.shadowColor = "rgba(232,121,249,.85)";
    g.shadowBlur = 14;
    const grad = g.createLinearGradient(0, -s * 0.45, 0, s * 0.38);
    grad.addColorStop(0, "#f5d0fe");
    grad.addColorStop(0.5, "#e879f9");
    grad.addColorStop(1, "#a21caf");
    g.beginPath();
    g.moveTo(0, -s * 0.45);
    g.lineTo(s * 0.32, s * 0.18);
    g.lineTo(s * 0.12, s * 0.12);
    g.lineTo(0, s * 0.38);
    g.lineTo(-s * 0.12, s * 0.12);
    g.lineTo(-s * 0.32, s * 0.18);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(255,220,255,.8)";
    g.lineWidth = 1.6;
    g.stroke();
    g.beginPath();
    g.arc(0, s * 0.02, s * 0.07, 0, TAU);
    g.fillStyle = "#3b0764";
    g.fill();
  });

  SPRITES.shooter = canvasSprite(64, (g, s) => {
    g.translate(s / 2, s / 2);
    g.shadowColor = "rgba(251,146,60,.85)";
    g.shadowBlur = 14;
    const grad = g.createLinearGradient(0, -s * 0.4, 0, s * 0.35);
    grad.addColorStop(0, "#ffedd5");
    grad.addColorStop(0.5, "#fb923c");
    grad.addColorStop(1, "#c2410c");
    g.beginPath();
    g.moveTo(0, -s * 0.42);
    g.lineTo(s * 0.34, s * 0.26);
    g.lineTo(0, s * 0.08);
    g.lineTo(-s * 0.34, s * 0.26);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(255,240,220,.85)";
    g.lineWidth = 1.6;
    g.stroke();
    g.beginPath();
    g.moveTo(0, -s * 0.2);
    g.lineTo(s * 0.12, s * 0.1);
    g.lineTo(0, s * 0.02);
    g.lineTo(-s * 0.12, s * 0.1);
    g.closePath();
    g.fillStyle = "rgba(124,45,18,.85)";
    g.fill();
  });

  SPRITES.tank = canvasSprite(80, (g, s) => {
    g.translate(s / 2, s / 2);
    g.shadowColor = "rgba(167,139,250,.85)";
    g.shadowBlur = 16;
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.5);
    grad.addColorStop(0, "#ede9fe");
    grad.addColorStop(0.55, "#a78bfa");
    grad.addColorStop(1, "#6d28d9");
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = Math.cos(a) * s * 0.42;
      const y = Math.sin(a) * s * 0.42;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(237,233,254,.8)";
    g.lineWidth = 2;
    g.stroke();
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = Math.cos(a) * s * 0.24;
      const y = Math.sin(a) * s * 0.24;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = "rgba(46,16,101,.9)";
    g.fill();
    g.beginPath();
    g.arc(0, 0, s * 0.09, 0, TAU);
    g.fillStyle = "#f5f3ff";
    g.shadowColor = "#ffffff";
    g.shadowBlur = 8;
    g.fill();
  });

  SPRITES.boss = canvasSprite(160, (g, s) => {
    g.translate(s / 2, s / 2);
    g.shadowColor = "rgba(248,113,113,.9)";
    g.shadowBlur = 22;
    const grad = g.createRadialGradient(0, 0, s * 0.05, 0, 0, s * 0.5);
    grad.addColorStop(0, "#fecaca");
    grad.addColorStop(0.5, "#f87171");
    grad.addColorStop(1, "#991b1b");
    g.beginPath();
    const spikes = 12;
    for (let i = 0; i < spikes * 2; i++) {
      const a = (Math.PI * i) / spikes - Math.PI / 2;
      const r = i % 2 === 0 ? s * 0.48 : s * 0.34;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(254,202,202,.85)";
    g.lineWidth = 2.5;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, s * 0.2, 0, TAU);
    g.fillStyle = "rgba(69,10,10,.9)";
    g.fill();
    g.beginPath();
    g.arc(0, 0, s * 0.1, 0, TAU);
    g.fillStyle = "#fecaca";
    g.shadowColor = "#ffffff";
    g.shadowBlur = 10;
    g.fill();
  });

  // glowing dots (additive particles)
  (Object.keys(DOT_HEX) as DotColor[]).forEach((color) => {
    DOT_SPR[color] = canvasSprite(24, (g, s) => {
      g.shadowColor = DOT_HEX[color];
      g.shadowBlur = 9;
      g.fillStyle = DOT_HEX[color];
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.22, 0, TAU);
      g.fill();
    });
  });

  // expanding shockwave rings
  (["cyan", "magenta", "orange", "red", "yellow", "pink", "lime", "amber"] as DotColor[]).forEach(
    (color) => {
      RING_SPR[color] = canvasSprite(64, (g, s) => {
        g.translate(s / 2, s / 2);
        g.shadowColor = DOT_HEX[color];
        g.shadowBlur = 10;
        g.strokeStyle = DOT_HEX[color];
        g.lineWidth = 4;
        g.beginPath();
        g.arc(0, 0, s * 0.38, 0, TAU);
        g.stroke();
        g.shadowBlur = 0;
        g.strokeStyle = "rgba(255,255,255,.5)";
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, s * 0.38, 0, TAU);
        g.stroke();
      });
    }
  );
}

export function drawSprite(
  g: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  rot: number,
  scale: number,
  alpha = 1
): void {
  const spr = SPRITES[name];
  if (!spr) return;
  const w = spr.width * scale;
  const h = spr.height * scale;
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.globalAlpha = alpha;
  g.drawImage(spr, -w / 2, -h / 2, w, h);
  g.restore();
}

import type { EaseName } from "../tuning";

export const easings: Record<EaseName, (u: number) => number> = {
  outExpo: (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  outQuart: (u) => 1 - Math.pow(1 - u, 4),
  outCubic: (u) => 1 - Math.pow(1 - u, 3),
  inOutCubic: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

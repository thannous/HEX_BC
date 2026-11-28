import type { Json } from "@/types/database";

/** Small helpers shared by the AI draft servers (estimate structure and version zero). */

export function getConfidenceLabel(value: number): "elevee" | "moyenne" | "faible" {
  if (value >= 0.75) return "elevee";
  if (value >= 0.55) return "moyenne";
  return "faible";
}

export function toJson(value: Record<string, unknown> | unknown[]): NonNullable<Json>;
export function toJson(value: unknown): Json;
export function toJson(value: unknown): Json {
  return value as Json;
}

/** The trimmed, non-empty strings of an array; only the first `limit` of them when a limit is given. */
export function pickStringArray(value: unknown, limit?: number) {
  if (!Array.isArray(value)) return [] as string[];
  const entries = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return limit === undefined ? entries : entries.slice(0, limit);
}

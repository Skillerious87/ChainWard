import type { SafeFactionTelemetry } from "./telemetry-types";

/**
 * Torn factions are not required to set a short tag, so `tag` is frequently
 * empty. Falling back to initials from the faction name keeps the monogram
 * legible instead of showing a bare "—" for a faction that does have a name.
 */
export function factionMonogram(faction: Pick<SafeFactionTelemetry, "tag" | "name"> | null | undefined): string {
  const tag = faction?.tag.trim();
  if (tag) return tag.slice(0, 2).toUpperCase();
  const name = faction?.name.trim();
  if (!name) return "—";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("");
  return (initials || name.slice(0, 2)).toUpperCase();
}

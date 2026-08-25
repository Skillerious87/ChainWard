import { describe, expect, it } from "vitest";
import type { DatabaseStatus } from "@/lib/data/database-status";
import { readAppearancePreferences } from "@/lib/appearance-preferences";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import { buildServiceRows } from "./service-state-drawer";

const telemetry: WorkspaceTelemetry = {
  source: "live",
  mode: "torn",
  checkedAt: "2026-08-25T22:43:16.000Z",
  faction: { id: 98_765, name: "Chainward Test Faction", tag: "CW", members: 6 },
  chain: null,
  message: "Verified Torn API data.",
};

const database: DatabaseStatus = {
  configured: true,
  available: true,
  label: "PostgreSQL",
  message: "The configured PostgreSQL service responded successfully.",
  provider: "postgresql",
  filename: null,
};

describe("service state background refresh", () => {
  it("enables automatic refresh for a new workspace by default", () => {
    expect(readAppearancePreferences()).toMatchObject({ autoRefresh: true, refreshIntervalSeconds: 30 });
  });

  it("reports the default in-app scheduler as a healthy active service", () => {
    const rows = buildServiceRows(telemetry, database, {
      autoRefresh: true,
      refreshIntervalSeconds: 30,
      chainRunning: false,
    });

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.tone === "ok")).toBe(true);
    expect(rows.at(-1)).toMatchObject({ name: "Background refresh", state: "Active", tone: "ok" });
    expect(rows.at(-1)?.detail).toContain("every 30 seconds");
  });

  it("does not count a deliberately paused scheduler as healthy", () => {
    const rows = buildServiceRows(telemetry, database, {
      autoRefresh: false,
      refreshIntervalSeconds: 30,
      chainRunning: false,
    });

    expect(rows.at(-1)).toMatchObject({ state: "Paused", tone: "neutral" });
    expect(rows.filter((row) => row.tone === "ok")).toHaveLength(3);
  });
});

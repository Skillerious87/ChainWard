import { describe, expect, it } from "vitest";
import { localBackupCompatibilityIssue, workspaceBackupSchema, type WorkspaceBackup } from "./workspace-backup";

function validBackup(): WorkspaceBackup {
  return {
    format: "chainward-workspace-backup" as const,
    version: 1 as const,
    exportedAt: "2026-09-01T12:00:00.000Z",
    faction: { tornFactionId: 42, name: "Example faction", tag: "TEST" },
    settings: [{ key: "members.activity", value: { thresholdDays: 7 } }],
    rewardSchemes: [{
      name: "Standard",
      description: null,
      version: 1,
      status: "ACTIVE" as const,
      isDefault: true,
      tiers: [{
        label: "Contributor",
        description: null,
        minimumHits: 10,
        maximumHits: null,
        position: 0,
        enabled: true,
        rewards: [{ name: "Xanax", displayUnit: "Xanax", kind: "ITEM" as const, decimals: 0, amount: 1 }],
      }],
    }],
  };
}

describe("workspace backup validation", () => {
  it("accepts the portable format emitted by local storage", () => {
    const parsed = workspaceBackupSchema.safeParse(validBackup());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(localBackupCompatibilityIssue(parsed.data)).toBeNull();
  });

  it("rejects impossible tier bounds, duplicate positions, and unknown fields", () => {
    const backup = validBackup();
    backup.rewardSchemes[0]!.tiers = [
      { ...backup.rewardSchemes[0]!.tiers[0]!, minimumHits: 20, maximumHits: 10 },
      { ...backup.rewardSchemes[0]!.tiers[0]!, label: "Duplicate position" },
    ];
    const withUnknownField = { ...backup, credential: "must-not-be-accepted" };

    expect(workspaceBackupSchema.safeParse(withUnknownField).success).toBe(false);
  });

  it("rejects cross-backend restores that SQLite would truncate", () => {
    const backup = validBackup();
    backup.rewardSchemes[0]!.tiers[0]!.rewards.push({
      name: "Cash",
      displayUnit: "$",
      kind: "CURRENCY",
      decimals: 0,
      amount: 1_000_000,
    });
    const parsed = workspaceBackupSchema.parse(backup);

    expect(localBackupCompatibilityIssue(parsed)).toContain("cannot preserve");
  });

  it("requires named rewards to keep consistent metadata", () => {
    const backup = validBackup();
    backup.rewardSchemes[0]!.tiers.push({
      ...backup.rewardSchemes[0]!.tiers[0]!,
      label: "Second tier",
      position: 1,
      rewards: [{ name: "Xanax", displayUnit: "boxes", kind: "ITEM", decimals: 0, amount: 2 }],
    });

    expect(workspaceBackupSchema.safeParse(backup).success).toBe(false);
  });

  it("keeps reward metadata consistent across scheme versions", () => {
    const backup = validBackup();
    backup.rewardSchemes.push({
      ...structuredClone(backup.rewardSchemes[0]!),
      version: 2,
      isDefault: false,
      tiers: [{
        ...structuredClone(backup.rewardSchemes[0]!.tiers[0]!),
        rewards: [{ name: "Xanax", displayUnit: "boxes", kind: "ITEM", decimals: 0, amount: 1 }],
      }],
    });

    expect(workspaceBackupSchema.safeParse(backup).success).toBe(false);
  });
});

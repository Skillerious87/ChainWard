import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalDatabase } from "@/lib/data/local-database";
import { assignMemberAward, createMemberReport, getMemberProfileWorkspace, revokeMemberAward } from "./member-profile-store";

describe.sequential("member profile store", () => {
  const originalPath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory: string | null = null;

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH; else process.env.CHAINWARD_LOCAL_DB_PATH = originalPath;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = null;
  });

  it("persists source-separated reports, filters leadership entries, and retains revoked awards", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-member-profile-"));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, "member-profile.sqlite");
    delete process.env.DATABASE_URL;
    createLocalDatabase();
    const faction = { id: 51393, name: "Prive Cartel", tag: "PC" };
    const member = { tornUserId: 123, memberName: "Member" };
    const actor = { tornUserId: 3212954, name: "Skillerious", isPlatformAdmin: true };

    await createMemberReport(faction, member, actor, { category: "RECOGNITION", visibility: "FACTION", title: "Reliable coverage", body: "Covered the final chain window without prompting." });
    await createMemberReport(faction, member, actor, { category: "DEVELOPMENT", visibility: "LEADERSHIP", title: "Development follow-up", body: "Review the agreed participation target next week." });
    await assignMemberAward(faction, member, actor, { badgeId: "CHAIN_SENTINEL", citation: "Dependable coverage across two faction chains." });

    const factionView = await getMemberProfileWorkspace(faction.id, member.tornUserId, false);
    expect(factionView.reports).toEqual([expect.objectContaining({ title: "Reliable coverage", visibility: "FACTION" })]);
    expect(factionView.awards).toEqual([expect.objectContaining({ badgeId: "CHAIN_SENTINEL", revokedAt: null })]);

    const leadershipView = await getMemberProfileWorkspace(faction.id, member.tornUserId, true);
    expect(leadershipView.reports).toHaveLength(2);
    const awardId = leadershipView.awards[0]!.id;
    await expect(assignMemberAward(faction, member, actor, { badgeId: "CHAIN_SENTINEL", citation: "Duplicate award." })).rejects.toThrow("already has this active badge");

    await revokeMemberAward(faction, member, actor, awardId, "Award issued against the wrong review period.");
    const afterRevocation = await getMemberProfileWorkspace(faction.id, member.tornUserId, true);
    expect(afterRevocation.awards[0]).toMatchObject({ id: awardId, revokedByName: "Skillerious", revokeReason: "Award issued against the wrong review period." });

    await assignMemberAward(faction, member, actor, { badgeId: "CHAIN_SENTINEL", citation: "Re-earned in the current review period." });
    const finalView = await getMemberProfileWorkspace(faction.id, member.tornUserId, true);
    expect(finalView.awards.filter((award) => !award.revokedAt)).toHaveLength(1);
    expect(finalView.awards.filter((award) => award.revokedAt)).toHaveLength(1);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLATFORM_OWNER } from "@/lib/auth/platform-owner";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { licensePlans } from "./pricing";
import {
  getLocalAccessRequestQueue,
  getLocalFactionAccessSummary,
  reviewLocalAccessRequest,
  submitLocalAccessRequest,
} from "./local-license-store";

describe.sequential("local unlock licensing", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDatabasePath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalLocalTestMode = process.env.CHAINWARD_LOCAL_TEST_MODE;
  let temporaryDirectory = "";

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "chainward-unlock-"));
    delete process.env.DATABASE_URL;
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(temporaryDirectory, "chainward-test.sqlite");
    process.env.CHAINWARD_LOCAL_TEST_MODE = "true";
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalDatabasePath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH;
    else process.env.CHAINWARD_LOCAL_DB_PATH = originalDatabasePath;
    if (originalLocalTestMode === undefined) delete process.env.CHAINWARD_LOCAL_TEST_MODE;
    else process.env.CHAINWARD_LOCAL_TEST_MODE = originalLocalTestMode;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("stores, owner-approves, activates, and faction-binds the purchaser without PostgreSQL", async () => {
    const submittedAt = new Date("2026-08-09T12:00:00.000Z");
    const reference = "CW-51393-TEST1234";
    submitLocalAccessRequest({
      actor: { name: "Faction Member", tornUserId: 123_456, isPlatformAdmin: false },
      faction: { id: 51_393, name: "Prive Cartel", tag: "PRIVE" },
      plan: licensePlans[1],
      reference,
      submittedAt,
    });

    expect(getLocalFactionAccessSummary(51_393)).toMatchObject({ state: "pending", reference, plan: "Quarterly" });
    const pendingQueue = getLocalAccessRequestQueue();
    expect(pendingQueue.databaseConfigured).toBe(true);
    expect(pendingQueue.requests).toEqual([expect.objectContaining({ status: "Pending", reference })]);

    const owner = { name: PLATFORM_OWNER.name, tornUserId: PLATFORM_OWNER.tornUserId, isPlatformAdmin: true };
    reviewLocalAccessRequest({
      actor: owner,
      requestId: pendingQueue.requests[0]!.requestId,
      decision: "Approved",
      note: "Local end-to-end test",
      referenceConfirmation: reference,
      reviewedAt: new Date("2026-08-09T12:05:00.000Z"),
      plans: licensePlans,
    });

    expect(getLocalFactionAccessSummary(51_393)).toMatchObject({ state: "active", reference, label: "Quarterly access" });
    const approvedQueue = getLocalAccessRequestQueue();
    expect(approvedQueue.requests[0]).toMatchObject({ status: "Approved", reviewedBy: { tornUserId: PLATFORM_OWNER.tornUserId } });
    expect(approvedQueue.activeLicenses).toHaveLength(1);
    expect(approvedQueue.auditEvents.map((event) => event.action)).toEqual(["Approved", "Submitted"]);
    await expect(getFactionAccessAssignment(51_393, 123_456)).resolves.toMatchObject({ role: "ADMINISTRATOR", status: "ACTIVE" });
    await expect(getFactionAccessAssignment(99_999, 123_456)).resolves.toBeNull();
  });

  it("opens renewal seven days before expiry and extends after the paid-through date", () => {
    const owner = { name: PLATFORM_OWNER.name, tornUserId: PLATFORM_OWNER.tornUserId, isPlatformAdmin: true };
    const faction = { id: 51_394, name: "Renewal Faction", tag: "RENEW" };
    submitLocalAccessRequest({ actor: { name: "Paying Member", tornUserId: 123_457, isPlatformAdmin: false }, faction, plan: licensePlans[0], reference: "CW-51394-FIRST123", submittedAt: new Date("2026-08-01T00:00:00.000Z") });
    reviewLocalAccessRequest({ actor: owner, requestId: getLocalAccessRequestQueue().requests[0]!.requestId, decision: "Approved", note: "Initial payment", referenceConfirmation: "CW-51394-FIRST123", reviewedAt: new Date("2026-08-01T00:00:00.000Z"), plans: licensePlans });

    submitLocalAccessRequest({ actor: { name: "Paying Member", tornUserId: 123_457, isPlatformAdmin: false }, faction, plan: licensePlans[0], reference: "CW-51394-RENEW123", submittedAt: new Date("2026-08-25T00:00:00.000Z") });
    const renewal = getLocalAccessRequestQueue().requests.find((request) => request.reference === "CW-51394-RENEW123")!;
    reviewLocalAccessRequest({ actor: owner, requestId: renewal.requestId, decision: "Approved", note: "Renewal payment", referenceConfirmation: renewal.reference, reviewedAt: new Date("2026-08-25T00:00:00.000Z"), plans: licensePlans });

    expect(getLocalFactionAccessSummary(faction.id)).toMatchObject({ state: "active", reference: "CW-51394-RENEW123", expiresAt: "2026-09-30T00:00:00.000Z" });
  });

  it("rejects a local approval from anyone except Skillerious", () => {
    const reference = "CW-51393-DENY1234";
    submitLocalAccessRequest({
      actor: { name: "Faction Member", tornUserId: 123_456, isPlatformAdmin: false },
      faction: { id: 51_393, name: "Prive Cartel", tag: "PRIVE" },
      plan: licensePlans[0],
      reference,
      submittedAt: new Date("2026-08-09T12:00:00.000Z"),
    });
    const requestId = getLocalAccessRequestQueue().requests[0]!.requestId;

    expect(() => reviewLocalAccessRequest({
      actor: { name: "Other Admin", tornUserId: 999_999, isPlatformAdmin: true },
      requestId,
      decision: "Approved",
      note: "Should fail",
      referenceConfirmation: reference,
      reviewedAt: new Date("2026-08-09T12:05:00.000Z"),
      plans: licensePlans,
    })).toThrow("restricted to Skillerious");
  });
});

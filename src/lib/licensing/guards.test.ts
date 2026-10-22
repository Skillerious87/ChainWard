import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(), connection: vi.fn(), access: vi.fn(), assignment: vi.fn(), roster: vi.fn(), owner: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/auth/current-actor", () => ({ getCurrentActor: mocks.actor }));
vi.mock("@/lib/auth/faction-access-store", () => ({ getFactionAccessAssignment: mocks.assignment }));
vi.mock("@/lib/auth/platform-owner", () => ({ isPlatformOwner: mocks.owner }));
vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection: mocks.connection }));
vi.mock("@/lib/torn/workspace-data-service", () => ({ getFactionRoster: mocks.roster }));
vi.mock("./faction-access", () => ({ getFactionAccessSummary: mocks.access }));

import { requireLicensedPage } from "./guards";

describe("parallel licensed page checks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.actor.mockResolvedValue({ tornUserId: 42 });
    mocks.connection.mockResolvedValue({ tornUserId: 42, factionId: 51393 });
    mocks.access.mockResolvedValue({ state: "active" });
    mocks.assignment.mockResolvedValue({ role: "MEMBER" });
    mocks.roster.mockResolvedValue({ available: true, data: [{ tornId: 42 }] });
    mocks.owner.mockReturnValue(false);
  });

  it("starts access, assignment and roster reads together and waits for all of them", async () => {
    let finishAccess!: (access: { state: string }) => void;
    mocks.access.mockImplementation(() => new Promise((resolve) => { finishAccess = resolve; }));
    let finished = false;
    const guard = requireLicensedPage().then(() => { finished = true; });
    await vi.waitFor(() => expect(mocks.roster).toHaveBeenCalledOnce());
    expect(mocks.assignment).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    finishAccess({ state: "active" });
    await guard;
    expect(finished).toBe(true);
  });

  it("allows a licensed member in their current faction", async () => {
    await expect(requireLicensedPage()).resolves.toBeUndefined();
  });

  it("rejects a mismatched session before accessing faction data", async () => {
    mocks.connection.mockResolvedValue({ tornUserId: 99, factionId: 51393 });
    await expect(requireLicensedPage()).rejects.toThrow("redirect:/connect");
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.roster).not.toHaveBeenCalled();
  });

  it.each(["inactive", "pending"])("rejects %s access even with a valid roster and assignment", async (state) => {
    mocks.access.mockResolvedValue({ state });
    await expect(requireLicensedPage()).rejects.toThrow("redirect:/unlock");
  });

  it("redirects locked access without waiting for an unrelated slow roster", async () => {
    mocks.access.mockResolvedValue({ state: "inactive" });
    mocks.roster.mockReturnValue(new Promise(() => {}));
    await expect(requireLicensedPage()).rejects.toThrow("redirect:/unlock");
  });

  it("rejects an unassigned member", async () => {
    mocks.assignment.mockResolvedValue(null);
    await expect(requireLicensedPage()).rejects.toThrow("redirect:/unlock");
  });

  it("rejects a member who has left the faction", async () => {
    mocks.roster.mockResolvedValue({ available: true, data: [{ tornId: 99 }] });
    await expect(requireLicensedPage()).rejects.toThrow("redirect:/unlock");
  });

  it("preserves owner access without fetching a roster", async () => {
    mocks.owner.mockReturnValue(true);
    await expect(requireLicensedPage()).resolves.toBeUndefined();
    expect(mocks.roster).not.toHaveBeenCalled();
    expect(mocks.assignment).not.toHaveBeenCalled();
  });
});

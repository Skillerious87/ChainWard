import { describe, expect, it, vi } from "vitest";
import { MissingTornSelectionsError, validateTornConnectionWithClient } from "./connection-service";

function makeClient(accessType: "Custom" | "Limited Access", selections = ["basic", "chain", "chains", "chainreport", "members"], userSelections = ["basic", "profile"]) {
  return {
    getKeyInfo: vi.fn().mockResolvedValue({ info: { selections: { faction: selections, user: userSelections, key: ["info"] }, access: { level: 3, type: accessType, faction: true, company: false }, user: { id: 3_212_954, faction_id: 51_393, company_id: null } } }),
    getMyProfile: vi.fn().mockResolvedValue({ profile: { id: 3_212_954, name: "Skillerious", level: 1, gender: "Male", status: { description: "Okay", details: null, state: "Okay", until: null, color: "green" } } }),
    getMyProfileDetails: vi.fn().mockResolvedValue({ profile: { id: 3_212_954, name: "Skillerious", image: "https://profileimages.torn.com/skillerious.png" } }),
    getFactionBasic: vi.fn().mockResolvedValue({ basic: { id: 51_393, name: "Verified faction", tag: "VF", tag_image: "", banner_image: "", leader_id: 3_212_954, co_leader_id: 0, respect: 1, days_old: 1, capacity: 100, members: 1, is_enlisted: null, rank: {}, best_chain: 1 } }),
    getCurrentChain: vi.fn().mockResolvedValue({ chain: { id: 0, current: 0, max: 0, timeout: 0, modifier: 1, cooldown: 0, start: 0, end: 0 } }),
    getCompletedChains: vi.fn().mockResolvedValue({ chains: [], _metadata: { links: null } }),
    getFactionMembers: vi.fn().mockResolvedValue({ members: [] }),
    getChainReport: vi.fn().mockRejectedValue(new Error("No completed chain to probe")),
  };
}

describe("validateTornConnectionWithClient", () => {
  it("accepts a limited-access key and probes every public workspace capability", async () => {
    const client = makeClient("Limited Access", []);
    const result = await validateTornConnectionWithClient(client);

    expect(result.key.accessType).toBe("Limited Access");
    expect(result.player.imageUrl).toBe("https://profileimages.torn.com/skillerious.png");
    expect(result.capabilities).toMatchObject({ liveChain: "verified", completedChains: "verified", members: "verified", chainReports: "available" });
    expect(client.getCurrentChain).toHaveBeenCalledOnce();
    expect(client.getCompletedChains).toHaveBeenCalledOnce();
    expect(client.getFactionMembers).toHaveBeenCalledOnce();
    expect(client.getMyProfileDetails).toHaveBeenCalledOnce();
  });

  it("rejects a custom key before probing when required faction selections are missing", async () => {
    const client = makeClient("Custom", ["basic", "chain"]);
    await expect(validateTornConnectionWithClient(client)).rejects.toBeInstanceOf(MissingTornSelectionsError);
    expect(client.getMyProfile).not.toHaveBeenCalled();
  });

  it("requires the profile selection for a custom key", async () => {
    const client = makeClient("Custom", undefined, ["basic"]);
    await expect(validateTornConnectionWithClient(client)).rejects.toMatchObject({
      missingSelections: ["user/profile"],
    });
    expect(client.getMyProfileDetails).not.toHaveBeenCalled();
  });
});

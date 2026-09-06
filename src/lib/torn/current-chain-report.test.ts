import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TornClient } from "./client";
import { createOfflineFixtureFetch } from "./offline-fixture";
import { getConfiguredTornClient } from "./server-client";
import { getCurrentChainReportView } from "./workspace-data-service";

vi.mock("./server-client", () => ({ getConfiguredTornClient: vi.fn() }));

describe("current chain contributors", () => {
  let clientId = 0;
  beforeEach(() => {
    vi.stubEnv("CHAINWARD_OFFLINE_TEST_MODE", "true");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  function setup(mode: "active" | "idle" | "cooldown" | "wrong-chain" | "wrong-faction" = "active") {
    const fixture = createOfflineFixtureFetch("chainward-offline-owner");
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const response = await fixture(input, init);
      const payload = await response.json();
      if (url.pathname.endsWith("/chain")) {
        payload.chain.current = mode === "idle" ? 0 : 3;
        payload.chain.timeout = mode === "idle" || mode === "cooldown" ? 0 : 120;
        if (mode === "idle") payload.chain.id = 0;
      }
      if (url.pathname.endsWith("/chainreport")) {
        // Reproduce Torn returning the previous report from the default route.
        if (url.pathname === "/v2/faction/chainreport" || mode === "wrong-chain") payload.chainreport.id = 999;
        if (mode === "wrong-faction") payload.chainreport.faction_id = 123;
      }
      return Response.json(payload);
    });
    const client = new TornClient({ apiKey: `report-regression-${mode}-${++clientId}`, fetchImplementation: fetchMock });
    vi.mocked(getConfiguredTornClient).mockResolvedValue(client);
    return { client, fetchMock };
  }

  it("loads players by active chain ID even before the tenth hit when latest still points to the previous chain", async () => {
    const { fetchMock } = setup();
    const result = await getCurrentChainReportView();
    expect(result.available).toBe(true);
    expect(result.data?.contributions.length).toBeGreaterThan(0);
    expect(result.data?.contributions.some((member) => member.name === "Skillerious")).toBe(true);
    const reportUrl = fetchMock.mock.calls.map(([input]) => new URL(String(input))).find((url) => url.pathname.endsWith("/chainreport"));
    expect(reportUrl?.pathname).toBe(`/v2/faction/${result.data?.id}/chainreport`);
    expect(reportUrl?.searchParams.has("timestamp")).toBe(true);
    expect(result.data?.id).not.toBe(999);
  });

  it("refreshes ongoing reports even if a historical request cached the same ID", async () => {
    const { client, fetchMock } = setup();
    const current = await client.getCurrentChain();
    await client.getChainReport(current.chain.id);
    await getCurrentChainReportView();
    await getCurrentChainReportView();
    expect(fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith("/chainreport"))).toHaveLength(3);
  });

  it.each(["idle", "cooldown"] as const)("shows the last completed report during %s", async (mode) => {
    setup(mode);
    const result = await getCurrentChainReportView();
    expect(result.data?.id).toBe(999);
    expect(result.message).toContain("Last completed");
  });

  it.each(["wrong-chain", "wrong-faction"] as const)("never displays contributors from a %s report", async (mode) => {
    setup(mode);
    const result = await getCurrentChainReportView();
    expect(result.data).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { withDbRetry } from "./with-db-retry";

describe("withDbRetry", () => {
  it("returns on the first success without retrying", async () => {
    let calls = 0;
    const value = await withDbRetry(async () => { calls += 1; return "ok"; });
    expect(value).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries a transient failure and then succeeds", async () => {
    let calls = 0;
    const value = await withDbRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error("Can't reach database server");
      return "recovered";
    });
    expect(value).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("gives up after every attempt fails, surfacing the last error", async () => {
    let calls = 0;
    await expect(withDbRetry(async () => { calls += 1; throw Object.assign(new Error(`fail ${calls}`), { code: "P1001" }); })).rejects.toThrow("fail 3");
    expect(calls).toBe(3);
  });

  it.each(["P2002", "P2025", 5, undefined])("does not retry permanent or application errors (%s)", async (code) => {
    let calls = 0;
    const error = Object.assign(new Error("Operation refused"), { code });
    await expect(withDbRetry(async () => { calls += 1; throw error; })).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it.each(["P2024", "P2034", "ECONNRESET", "40001", "40P01"])("recovers from a transient %s failure", async (code) => {
    let calls = 0;
    const result = await withDbRetry(async () => {
      if (++calls === 1) throw Object.assign(new Error("Transient database failure"), { code });
      return "recovered";
    });
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });
});

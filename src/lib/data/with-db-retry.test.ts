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
    await expect(withDbRetry(async () => { calls += 1; throw new Error(`fail ${calls}`); })).rejects.toThrow("fail 3");
    expect(calls).toBe(3);
  });
});

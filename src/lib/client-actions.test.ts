import { describe, expect, it } from "vitest";
import { csvCell, enqueueToast, toastDurationMs, type ToastQueueItem } from "./client-actions";

describe("CSV export cells", () => {
  it("neutralises formula-like text from external data", () => {
    expect(csvCell("=HYPERLINK(\"https://attacker.example\")")).toBe("\"'=HYPERLINK(\"\"https://attacker.example\"\")\"");
    expect(csvCell("  +SUM(1,2)")).toBe("\"'  +SUM(1,2)\"");
    expect(csvCell("@command")).toBe("'@command");
  });

  it("keeps real numeric values usable", () => {
    expect(csvCell(-12)).toBe("-12");
    expect(csvCell(42)).toBe("42");
  });
});

describe("smart toast queue", () => {
  it("replaces duplicate feedback and counts repetitions", () => {
    const first = enqueueToast([], { title: "Saved", tone: "success" }, "one");
    const second = enqueueToast(first, { title: "Saved", description: "Latest details", tone: "success" }, "two");
    expect(second).toEqual([expect.objectContaining({ id: "two", count: 2, description: "Latest details" })]);
  });

  it("caps visible messages to prevent notification floods", () => {
    let queue: ToastQueueItem[] = [];
    for (let index = 0; index < 6; index += 1) queue = enqueueToast(queue, { title: `Message ${index}` }, String(index));
    expect(queue.map((item) => item.id)).toEqual(["2", "3", "4", "5"]);
  });

  it("keeps dangerous feedback visible longer and accepts a persistent override", () => {
    expect(toastDurationMs({ title: "Failed", tone: "danger" })).toBeGreaterThan(toastDurationMs({ title: "Saved", tone: "success" }));
    expect(toastDurationMs({ title: "Stay", durationMs: 0 })).toBe(0);
  });
});

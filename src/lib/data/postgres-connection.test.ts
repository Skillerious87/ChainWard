import { describe, expect, it } from "vitest";
import { withExplicitPostgresSslMode } from "./postgres-connection";

describe("withExplicitPostgresSslMode", () => {
  it.each(["prefer", "require", "verify-ca"])("upgrades sslmode=%s to verify-full", (mode) => {
    const result = withExplicitPostgresSslMode(`postgresql://owner:secret@example.neon.tech/app?sslmode=${mode}&channel_binding=require`);

    expect(new URL(result).searchParams.get("sslmode")).toBe("verify-full");
    expect(new URL(result).searchParams.get("channel_binding")).toBe("require");
  });

  it("leaves explicit modes and non-Postgres values unchanged", () => {
    expect(withExplicitPostgresSslMode("postgres://owner:secret@localhost/app?sslmode=disable")).toBe("postgres://owner:secret@localhost/app?sslmode=disable");
    expect(withExplicitPostgresSslMode("not-a-url")).toBe("not-a-url");
  });
});

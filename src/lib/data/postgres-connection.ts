const STRICT_SSL_ALIASES = new Set(["prefer", "require", "verify-ca"]);

/**
 * node-postgres currently treats these legacy sslmode values as verify-full,
 * but emits a migration warning because their meaning will change in pg v9.
 * Make the security contract explicit without mutating the saved secret.
 */
export function withExplicitPostgresSslMode(connectionString: string): string {
  const trimmed = connectionString.trim();

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return trimmed;

    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    if (sslMode && STRICT_SSL_ALIASES.has(sslMode)) url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  } catch {
    return trimmed;
  }
}

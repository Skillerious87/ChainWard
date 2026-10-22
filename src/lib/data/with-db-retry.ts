import "server-only";

/**
 * Retries a database operation a couple of times before giving up. A managed
 * Postgres (Neon in particular) briefly refuses connections while it wakes from
 * idle; without this a first request after a lull throws `P1001` straight into
 * a render path and blanks the whole app via `global-error`. Short, bounded
 * backoff — every authenticated render / mutation is worth one or two retries.
 */
export async function withDbRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error)) throw error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  // Connection failures, pool timeouts, and transactions explicitly rolled
  // back by PostgreSQL can recover. Validation/permission failures cannot.
  if (typeof code === "string" && ["P1001", "P1002", "P1008", "P1017", "P2024", "P2034", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "40001", "40P01", "57P01", "57P02", "57P03"].includes(code)) return true;
  return typeof message === "string" && /can't reach database server|connection terminated unexpectedly/i.test(message);
}

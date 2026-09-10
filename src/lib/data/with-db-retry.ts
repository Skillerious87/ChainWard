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
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { ConfiguredTornConnection } from "./server-client";

interface TornRequestScope {
  connection?: Promise<ConfiguredTornConnection | null>;
  identityChecks?: Map<string, Promise<void>>;
}

const requestScope = new AsyncLocalStorage<TornRequestScope>();

/** React.cache covers RSC renders; route handlers need their own async scope. */
export function withTornRequestScope<T>(run: () => T): T {
  return requestScope.run({}, run);
}

export function currentTornRequestScope(): TornRequestScope | undefined {
  return requestScope.getStore();
}

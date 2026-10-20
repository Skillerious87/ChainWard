import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { apiStateStore, type ApiStateStore } from "../src/lib/torn/api-state-store.ts";
import { reserveTornAttempt } from "../src/lib/torn/api-request-budget.ts";
import { readSharedOperation } from "../src/lib/torn/api-pool-broker.ts";
import { TornApiError } from "../src/lib/torn/errors.ts";

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
if (!process.env.DATABASE_URL?.trim()) throw new Error("Configure DATABASE_URL before verifying PostgreSQL coordination.");
const { db } = await import("../src/lib/db.ts");
const prefix = `verify:${randomUUID()}:`;
const store: ApiStateStore = {
  read: (key) => apiStateStore.read(`${prefix}${key}`),
  list: async (key) => (await apiStateStore.list(`${prefix}${key}`)).map((entry) => ({ key: entry.key.slice(prefix.length), value: entry.value })),
  transact: (keys, update) => apiStateStore.transact(keys.map((key) => `${prefix}${key}`), (values) => {
    const updated = update(Object.fromEntries(Object.entries(values).map(([key, value]) => [key.slice(prefix.length), value])));
    return { result: updated.result, changes: Object.fromEntries(Object.entries(updated.changes).map(([key, value]) => [`${prefix}${key}`, value])) };
  }),
};

try {
  const attempts = await Promise.allSettled(Array.from({ length: 40 }, (_, index) => reserveTornAttempt(`credential-${index}`, { ownerId: 777_000_001 }, store)));
  const failures: Record<string, number> = {};
  for (const attempt of attempts) {
    if (attempt.status !== "rejected") continue;
    const reason = attempt.reason as { code?: unknown };
    const code = String(reason?.code ?? "unknown");
    failures[code] = (failures[code] ?? 0) + 1;
  }
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 30, `Exactly 30 concurrent attempts must reserve the player allowance. Rejections: ${JSON.stringify(failures)}`);
  assert(attempts.filter((result) => result.status === "rejected").every((result) => result.status === "rejected" && result.reason instanceof TornApiError && result.reason.code === 5), "Excess attempts must fail with the budget limit, not a database failure.");
  await reserveTornAttempt("other-player", { ownerId: 777_000_002 }, store);
  console.log("PASS: PostgreSQL reservations enforce one allowance across concurrent credentials.");

  let refreshes = 0;
  const request = { path: "/faction/123/chain", query: {}, cacheMs: 60_000, forceRefresh: false };
  const refresh = async () => {
    refreshes += 1;
    return { value: { chain: { id: 1, current: 10, max: 100, timeout: 200, modifier: 1, cooldown: 0, start: 1000, end: 0 } }, fetchedAt: Date.now() };
  };
  await Promise.all(Array.from({ length: 20 }, () => readSharedOperation(123, request, refresh, store)));
  assert.equal(refreshes, 1, "Concurrent PostgreSQL readers must share one refresh.");
  console.log("PASS: PostgreSQL readers share a durable refresh lease and snapshot.");
  console.log("PostgreSQL verification passed. No Torn API requests were made.");
} finally {
  await db.tornApiBrokerState.deleteMany({ where: { key: { startsWith: prefix } } });
  await db.$disconnect();
}

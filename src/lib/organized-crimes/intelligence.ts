import type { TornRosterMember } from "@/lib/torn/workspace-types";
import type {
  CapabilityEntry,
  CprSource,
  CrimeFeed,
  CrimeFill,
  FactionOcHealth,
  MemberIntel,
  MemberOcProfile,
  MemberRoleHistory,
  OrganizedCrime,
  RoleObservation,
  ScenarioStat,
  SlotAssignment,
} from "./types";

/* ============================================================ constants === */

export const STATS_FRESH_MS = 7 * 86_400_000;
/** Evidence is decay-weighted, never hard-discarded. 30-day half-life matches
 *  the community "OC Best-Fit" tooling. */
export const DEFAULT_HALF_LIFE_DAYS = 30;
export const CPR_GREEN = 70;
export const CPR_YELLOW = 50;

/** Torn's own per-difficulty checkpoint-pass-rate baselines (community-derived,
 *  matches the OC Best-Fit `REQ` table). Used as guidance; the review's
 *  `minimumCpr` slider overrides it downward-or-up. */
export const REQ_BY_DIFFICULTY: Readonly<Record<number, number>> = {
  1: 70, 2: 70, 3: 70, 4: 75, 5: 75, 6: 75, 7: 70, 8: 60, 9: 50, 10: 0,
};

/* ============================================================== helpers === */

export function isFresh(at: string | null, now: number, maxAge: number): boolean {
  if (!at) return false;
  const age = now - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
}

/** Lowercase + strip everything but [a-z0-9] — stable across Torn's casing and
 *  punctuation drift ("Cat Burglar" / "cat-burglar" / "CatBurglar"). */
export function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "Robber #2" -> "Robber". Numbered copies of a role share the same CPR
 *  mechanics, so pooling them gives more evidence. */
export function stripPositionNumber(label: string): string {
  return label.replace(/\s*#\s*\d+\s*$/, "").trim();
}

export function positionKeyOf(label: string): string {
  return norm(stripPositionNumber(label));
}

export function roleKeyOf(crimeName: string, difficulty: number, positionLabel: string): string {
  return `${norm(crimeName)}|${Number.isFinite(difficulty) ? difficulty : 0}|${positionKeyOf(positionLabel)}`;
}

export function scenarioKeyOf(crimeName: string, difficulty: number): string {
  return `${Number.isFinite(difficulty) ? difficulty : 0}|${norm(crimeName)}`;
}

export type NormalisedStatus = "recruiting" | "planning" | "successful" | "failure" | "expired" | "other";

export function normStatus(raw: unknown): NormalisedStatus {
  const s = norm(raw);
  if (!s) return "other";
  if (s.startsWith("recruit")) return "recruiting";
  if (s.startsWith("plan")) return "planning";
  if (s.startsWith("success")) return "successful";
  if (s.startsWith("fail")) return "failure";
  if (s.startsWith("expir")) return "expired";
  return "other";
}

export const isActiveStatus = (raw: unknown): boolean => {
  const s = normStatus(raw);
  return s === "recruiting" || s === "planning";
};
export const isCompletedStatus = (raw: unknown): boolean => {
  const s = normStatus(raw);
  return s === "successful" || s === "failure";
};

export function decay(ageDays: number, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  return Math.pow(0.5, Math.max(0, ageDays) / Math.max(1, halfLifeDays));
}

export function clampCpr(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(100, n);
}

/** Recommended minimum CPR for a role: the per-difficulty baseline, floored by
 *  the reviewer's own `minimumCpr` when they've raised it. */
export function roleBaseline(difficulty: number, minimumCpr: number): number {
  const req = REQ_BY_DIFFICULTY[Math.max(1, Math.min(10, Math.round(difficulty || 5)))] ?? 60;
  return Math.max(req, minimumCpr);
}

/** Success rate with a prior — stops a 1/1 or 0/1 sample reading as 100% / 0%. */
export function bayesianRate(wins: number, samples: number, prior: number, k = 6): number | null {
  if (samples <= 0) return prior > 0 ? prior : null;
  return (wins + k * prior) / (samples + k);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/* ================================================ member self-report === */

/** CPR observations from the member's OWN view of joinable crimes
 *  (`/user/organizedcrimes`, or `/faction/crimes?cat=available` pre-June-2026).
 *  Only Recruiting/Planning crimes, only empty slots or the member's own slot,
 *  only a real (>0) checkpoint pass rate. */
export function collectOwnRoles(crimes: OrganizedCrime[], userId: number, observedAt: string): RoleObservation[] {
  return crimes.flatMap((crime) => {
    if (!isActiveStatus(crime.status)) return [];
    return crime.slots.flatMap((slot) => {
      if (slot.user !== null && slot.user.id !== userId) return [];
      const cpr = clampCpr(slot.checkpoint_pass_rate);
      if (cpr === null) return [];
      return [{
        crimeId: crime.id,
        crimeName: crime.name,
        difficulty: crime.difficulty,
        positionId: slot.position_info.id === undefined ? "" : String(slot.position_info.id),
        positionLabel: slot.position_info.label || slot.position,
        passRate: cpr,
        observedAt,
      }];
    });
  });
}

/* ============================================ faction-key OC intelligence === */

export interface RawCprObservation {
  tornUserId: number;
  roleKey: string;
  positionLabel: string;
  crimeName: string;
  difficulty: number;
  cpr: number;
  at: string;
  won: boolean | null;
  source: CprSource;
}

export interface FactionOcIntel {
  /** Recruiting/Planning crimes as returned by `/faction/crimes`. */
  activeCrimes: OrganizedCrime[];
  matrix: Map<number, Map<string, CapabilityEntry>>;
  profiles: Map<number, MemberOcProfile>;
  scenarios: Map<string, ScenarioStat>;
  completedInWindow: number;
  windowDays: number;
}

const HISTORY_WINDOW_DAYS = 45;

/** Pure builder: given the two crime feeds + any member self-reports, produce
 *  the capability matrix, per-member OC profiles and per-scenario stats. */
export function buildFactionOcIntel(
  active: CrimeFeed,
  completed: CrimeFeed,
  selfReports: MemberIntel[],
  now: number,
): FactionOcIntel {
  const activeCrimes = (active.available ? active.crimes : []).filter((c) => isActiveStatus(c.status));
  const observations: RawCprObservation[] = [];

  // 1. Occupied slots in active crimes — current, live CPR.
  for (const crime of activeCrimes) {
    for (const slot of crime.slots) {
      if (!slot.user) continue;
      const cpr = clampCpr(slot.checkpoint_pass_rate);
      if (cpr === null) continue;
      const label = slot.position_info.label || slot.position;
      observations.push({
        tornUserId: slot.user.id,
        roleKey: roleKeyOf(crime.name, crime.difficulty, label),
        positionLabel: stripPositionNumber(label),
        crimeName: crime.name,
        difficulty: crime.difficulty,
        cpr,
        at: new Date(now).toISOString(),
        won: null,
        source: "assigned",
      });
    }
  }

  // 2. Completed crimes — CPR-at-execution + win/fail, decayed by age.
  const completedCrimes = (completed.available ? completed.crimes : []).filter((c) => isCompletedStatus(c.status));
  const windowCutoff = now - HISTORY_WINDOW_DAYS * 86_400_000;
  const scenarioAcc = new Map<string, { name: string; difficulty: number; wins: number; losses: number; money: number[]; respect: number[]; pct: number[]; part: number[] }>();
  const profileAcc = new Map<number, { wins: number; losses: number; lastAt: number; roles: Map<string, { label: string; name: string; difficulty: number; count: number; wins: number; losses: number; cprs: number[]; lastAt: number }> }>();
  let completedInWindow = 0;

  for (const crime of completedCrimes) {
    const at = crime.executed_at ?? crime.ready_at ?? null;
    if (at === null) continue;
    const atMs = at * 1000;
    if (atMs >= windowCutoff) completedInWindow += 1;
    const won = normStatus(crime.status) === "successful";
    const atIso = new Date(atMs).toISOString();

    const sk = scenarioKeyOf(crime.name, crime.difficulty);
    const sAcc = scenarioAcc.get(sk) ?? { name: crime.name, difficulty: crime.difficulty, wins: 0, losses: 0, money: [], respect: [], pct: [], part: [] };
    if (won) sAcc.wins += 1; else sAcc.losses += 1;
    if (crime.rewards?.money != null) sAcc.money.push(crime.rewards.money);
    if (crime.rewards?.respect != null) sAcc.respect.push(crime.rewards.respect);
    if (crime.rewards?.payout?.percentage != null) sAcc.pct.push(crime.rewards.payout.percentage);
    sAcc.part.push(crime.participants ?? crime.slots.length);
    scenarioAcc.set(sk, sAcc);

    for (const slot of crime.slots) {
      if (!slot.user) continue;
      const label = slot.position_info.label || slot.position;
      const roleKey = roleKeyOf(crime.name, crime.difficulty, label);
      const cpr = clampCpr(slot.checkpoint_pass_rate);

      if (cpr !== null) {
        observations.push({
          tornUserId: slot.user.id, roleKey, positionLabel: stripPositionNumber(label),
          crimeName: crime.name, difficulty: crime.difficulty, cpr, at: atIso, won, source: "history",
        });
      }

      const pAcc = profileAcc.get(slot.user.id) ?? { wins: 0, losses: 0, lastAt: 0, roles: new Map() };
      if (won) pAcc.wins += 1; else pAcc.losses += 1;
      pAcc.lastAt = Math.max(pAcc.lastAt, atMs);
      const rAcc = pAcc.roles.get(roleKey) ?? { label: stripPositionNumber(label), name: crime.name, difficulty: crime.difficulty, count: 0, wins: 0, losses: 0, cprs: [], lastAt: 0 };
      rAcc.count += 1;
      if (won) rAcc.wins += 1; else rAcc.losses += 1;
      if (cpr !== null) rAcc.cprs.push(cpr);
      rAcc.lastAt = Math.max(rAcc.lastAt, atMs);
      pAcc.roles.set(roleKey, rAcc);
      profileAcc.set(slot.user.id, pAcc);
    }
  }

  // 3. Member self-reports — the freshest, most trusted CPR for a member.
  for (const record of selfReports) {
    for (const role of record.roles) {
      const cpr = clampCpr(role.passRate);
      if (cpr === null) continue;
      observations.push({
        tornUserId: record.tornUserId,
        roleKey: roleKeyOf(role.crimeName, role.difficulty, role.positionLabel),
        positionLabel: stripPositionNumber(role.positionLabel),
        crimeName: role.crimeName,
        difficulty: role.difficulty,
        cpr,
        at: role.observedAt,
        won: null,
        source: "self-report",
      });
    }
  }

  return {
    activeCrimes,
    matrix: buildCapabilityMatrix(observations, now),
    profiles: buildProfiles(profileAcc, scenarioAcc),
    scenarios: buildScenarios(scenarioAcc),
    completedInWindow,
    windowDays: HISTORY_WINDOW_DAYS,
  };
}

const SOURCE_TRUST: Record<CprSource, number> = { "self-report": 3, assigned: 2, history: 1 };

export function buildCapabilityMatrix(observations: RawCprObservation[], now: number): Map<number, Map<string, CapabilityEntry>> {
  const grouped = new Map<number, Map<string, RawCprObservation[]>>();
  for (const obs of observations) {
    const byRole = grouped.get(obs.tornUserId) ?? new Map<string, RawCprObservation[]>();
    const list = byRole.get(obs.roleKey) ?? [];
    list.push(obs);
    byRole.set(obs.roleKey, list);
    grouped.set(obs.tornUserId, byRole);
  }

  const matrix = new Map<number, Map<string, CapabilityEntry>>();
  for (const [tornUserId, byRole] of grouped) {
    const entries = new Map<string, CapabilityEntry>();
    for (const [roleKey, list] of byRole) {
      let weightSum = 0;
      let weightedCprSum = 0;
      let bestCpr = 0;
      let newest = list[0]!;
      for (const obs of list) {
        const ageDays = Math.max(0, (now - Date.parse(obs.at)) / 86_400_000);
        const w = decay(ageDays) * (0.6 + 0.2 * SOURCE_TRUST[obs.source]);
        weightSum += w;
        weightedCprSum += w * obs.cpr;
        if (obs.cpr > bestCpr) bestCpr = obs.cpr;
        if (Date.parse(obs.at) > Date.parse(newest.at)) newest = obs;
      }
      const weightedCpr = weightSum > 0 ? weightedCprSum / weightSum : bestCpr;
      const newestAgeDays = Math.max(0, (now - Date.parse(newest.at)) / 86_400_000);
      const confidence = Math.min(1, list.length / 3) * decay(newestAgeDays, DEFAULT_HALF_LIFE_DAYS * 2);
      entries.set(roleKey, {
        roleKey,
        positionLabel: newest.positionLabel,
        bestCpr: Math.round(bestCpr),
        weightedCpr: Math.round(weightedCpr),
        source: newest.source,
        observedAt: newest.at,
        samples: list.length,
        confidence: Number(confidence.toFixed(3)),
      });
    }
    matrix.set(tornUserId, entries);
  }
  return matrix;
}

function buildScenarios(
  acc: Map<string, { name: string; difficulty: number; wins: number; losses: number; money: number[]; respect: number[]; pct: number[]; part: number[] }>,
): Map<string, ScenarioStat> {
  const out = new Map<string, ScenarioStat>();
  for (const [key, a] of acc) {
    const samples = a.wins + a.losses;
    const medMoney = median(a.money);
    const medPct = median(a.pct);
    const medPart = median(a.part);
    const perPlayerMoney = medMoney != null && medPct != null && medPart && medPart > 0
      ? Math.round((medMoney * medPct) / 100 / medPart)
      : null;
    out.set(key, {
      key,
      crimeName: a.name,
      difficulty: a.difficulty,
      samples,
      successRate: samples ? a.wins / samples : null,
      medMoney,
      medRespect: median(a.respect),
      medPayoutPct: medPct,
      medParticipants: medPart,
      perPlayerMoney,
    });
  }
  return out;
}

function buildProfiles(
  profileAcc: Map<number, { wins: number; losses: number; lastAt: number; roles: Map<string, { label: string; name: string; difficulty: number; count: number; wins: number; losses: number; cprs: number[]; lastAt: number }> }>,
  scenarioAcc: Map<string, { wins: number; losses: number }>,
): Map<number, MemberOcProfile> {
  let factionWins = 0;
  let factionTotal = 0;
  for (const s of scenarioAcc.values()) { factionWins += s.wins; factionTotal += s.wins + s.losses; }
  const factionPrior = factionTotal ? factionWins / factionTotal : 0.5;

  const out = new Map<number, MemberOcProfile>();
  for (const [tornUserId, p] of profileAcc) {
    const ocCount = p.wins + p.losses;
    const roles: MemberRoleHistory[] = [...p.roles.entries()]
      .map(([roleKey, r]) => ({
        roleKey,
        positionLabel: r.label,
        crimeName: r.name,
        difficulty: r.difficulty,
        count: r.count,
        wins: r.wins,
        losses: r.losses,
        avgCpr: r.cprs.length ? Math.round(r.cprs.reduce((t, v) => t + v, 0) / r.cprs.length) : 0,
        bestCpr: r.cprs.length ? Math.round(Math.max(...r.cprs)) : 0,
        lastAt: new Date(r.lastAt).toISOString(),
      }))
      .sort((a, b) => b.count - a.count || b.bestCpr - a.bestCpr);
    out.set(tornUserId, {
      tornUserId,
      ocCount,
      wins: p.wins,
      losses: p.losses,
      successRate: bayesianRate(p.wins, ocCount, factionPrior),
      lastOcAt: p.lastAt ? new Date(p.lastAt).toISOString() : null,
      roles,
    });
  }
  return out;
}

export function computeFactionHealth(
  intel: FactionOcIntel,
  completed: CrimeFeed,
  now: number,
): FactionOcHealth {
  const windowCutoff = now - intel.windowDays * 86_400_000;
  const inWindow = (completed.available ? completed.crimes : []).filter((c) => {
    if (!isCompletedStatus(c.status)) return false;
    const at = (c.executed_at ?? c.ready_at ?? 0) * 1000;
    return at >= windowCutoff;
  });
  const wins = inWindow.filter((c) => normStatus(c.status) === "successful").length;
  const money: number[] = [];
  const respect: number[] = [];
  const diff = new Map<number, { attempts: number; wins: number }>();
  for (const c of inWindow) {
    const succeeded = normStatus(c.status) === "successful";
    if (succeeded && c.rewards?.money != null) money.push(c.rewards.money);
    if (succeeded && c.rewards?.respect != null) respect.push(c.rewards.respect);
    const d = diff.get(c.difficulty) ?? { attempts: 0, wins: 0 };
    d.attempts += 1;
    if (succeeded) d.wins += 1;
    diff.set(c.difficulty, d);
  }
  const needsFilling = intel.activeCrimes.filter((c) => c.slots.some((s) => !s.user)).length;
  return {
    windowDays: intel.windowDays,
    completedInWindow: inWindow.length,
    successRate: inWindow.length ? wins / inWindow.length : null,
    medRespect: median(respect),
    medMoney: median(money),
    difficultyCoverage: [...diff.entries()].map(([difficulty, v]) => ({ difficulty, ...v })).sort((a, b) => a.difficulty - b.difficulty),
    activeCount: intel.activeCrimes.length,
    needsFillingCount: needsFilling,
  };
}

/* =================================================== success estimate === */

/** Heuristic team success estimate. OC 2.0 is checkpoint-gated so the weakest
 *  slot dominates; this blends the minimum with the geometric mean and, when
 *  available, the faction's track record on the scenario. Deliberately an
 *  estimate — the UI labels it as such. */
export function estimateCrimeSuccess(
  slotCprs: Array<number | null>,
  scenarioSuccessRate?: number | null,
): { estimate: number | null; band: [number, number] | null; weakestIndex: number | null } {
  const present = slotCprs.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => typeof x.v === "number" && x.v > 0);
  if (!present.length || present.length < slotCprs.length) {
    return { estimate: null, band: null, weakestIndex: present.length ? present.reduce((m, x) => (x.v < m.v ? x : m)).i : null };
  }
  const ps = present.map((x) => x.v / 100);
  const min = Math.min(...ps);
  const geo = Math.pow(ps.reduce((t, p) => t * p, 1), 1 / ps.length);
  let team = 0.55 * min + 0.45 * geo;
  if (typeof scenarioSuccessRate === "number" && scenarioSuccessRate >= 0) {
    team = 0.72 * team + 0.28 * scenarioSuccessRate;
  }
  team = Math.max(0, Math.min(1, team));
  const weakestIndex = present.reduce((m, x) => (x.v < m.v ? x : m)).i;
  return {
    estimate: Number(team.toFixed(3)),
    band: [Number(Math.max(0, team - 0.12).toFixed(3)), Number(Math.min(1, team + 0.07).toFixed(3))],
    weakestIndex,
  };
}

/* ================================================= assignment optimiser === */

const NO_FIT = -1e9;

/** Kuhn–Munkres (Hungarian) — minimum-cost perfect assignment on a padded
 *  square matrix. Returns `rowToCol[r] = c`. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) { minv[j] = cur; way[j] = j0; }
        if (minv[j]! < delta) { delta = minv[j]!; j1 = j; }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          const pj = p[j]!;
          u[pj] = u[pj]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j += 1) if (p[j]! >= 1) rowToCol[p[j]! - 1] = j - 1;
  return rowToCol;
}

export interface OptimiseOptions {
  minimumCpr: number;
  scenario: ScenarioStat | null;
  now: number;
}

export function optimiseCrimeAssignment(
  crime: OrganizedCrime,
  candidates: Array<{ tornUserId: number; name: string }>,
  matrix: Map<number, Map<string, CapabilityEntry>>,
  opts: OptimiseOptions,
): CrimeFill {
  const baseline = roleBaseline(crime.difficulty, opts.minimumCpr);
  const scenarioRate = opts.scenario?.successRate ?? null;

  const openSlots = crime.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => !slot.user)
    .map(({ slot }) => {
      const label = slot.position_info.label || slot.position || "Role";
      return {
        positionLabel: stripPositionNumber(label),
        positionKey: roleKeyOf(crime.name, crime.difficulty, label),
        itemRequirementId: slot.item_requirement?.id ?? null,
        itemAvailable: slot.item_requirement ? slot.item_requirement.is_available ?? null : null,
      };
    });

  const scoreFor = (tornUserId: number, positionKey: string): { cpr: number; weightedCpr: number; source: CprSource; score: number } | null => {
    const entry = matrix.get(tornUserId)?.get(positionKey);
    if (!entry) return null;
    // Keep CPR the dominant term; nudge by faction reliability on the scenario.
    const factor = scenarioRate == null ? 1 : 0.6 + 0.4 * scenarioRate;
    return { cpr: entry.bestCpr, weightedCpr: entry.weightedCpr, source: entry.source, score: entry.weightedCpr * factor };
  };

  // Only keep candidates with evidence for at least one open slot.
  const usable = candidates.filter((c) => openSlots.some((s) => scoreFor(c.tornUserId, s.positionKey)));

  const slots: SlotAssignment[] = openSlots.map((s) => ({
    positionLabel: s.positionLabel,
    positionKey: s.positionKey,
    itemRequirementId: s.itemRequirementId,
    itemAvailable: s.itemAvailable,
    assignee: null,
    cpr: null,
    weightedCpr: null,
    source: null,
    meetsBaseline: false,
    alternates: [],
  }));

  if (openSlots.length && usable.length) {
    const size = Math.max(openSlots.length, usable.length);
    const cost: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(-NO_FIT));
    for (let r = 0; r < usable.length; r += 1) {
      for (let c = 0; c < openSlots.length; c += 1) {
        const fit = scoreFor(usable[r]!.tornUserId, openSlots[c]!.positionKey);
        cost[r]![c] = fit ? -fit.score : -NO_FIT;
      }
    }
    const rowToCol = hungarian(cost);
    for (let r = 0; r < usable.length; r += 1) {
      const c = rowToCol[r]!;
      if (c < 0 || c >= openSlots.length) continue;
      const fit = scoreFor(usable[r]!.tornUserId, openSlots[c]!.positionKey);
      if (!fit) continue;
      slots[c]!.assignee = { tornUserId: usable[r]!.tornUserId, name: usable[r]!.name };
      slots[c]!.cpr = fit.cpr;
      slots[c]!.weightedCpr = fit.weightedCpr;
      slots[c]!.source = fit.source;
      slots[c]!.meetsBaseline = fit.weightedCpr >= baseline;
    }
  }

  // Alternates: best remaining candidates per slot, excluding whoever is
  // assigned anywhere in this fill.
  const assignedIds = new Set(slots.map((s) => s.assignee?.tornUserId).filter((v): v is number => v != null));
  for (const s of slots) {
    s.alternates = candidates
      .filter((c) => !assignedIds.has(c.tornUserId))
      .map((c) => ({ c, fit: scoreFor(c.tornUserId, s.positionKey) }))
      .filter((x): x is { c: { tornUserId: number; name: string }; fit: NonNullable<ReturnType<typeof scoreFor>> } => x.fit !== null)
      .sort((a, b) => b.fit.weightedCpr - a.fit.weightedCpr)
      .slice(0, 3)
      .map((x) => ({ tornUserId: x.c.tornUserId, name: x.c.name, cpr: x.fit.weightedCpr, source: x.fit.source }));
  }

  const filledSlotCprs = crime.slots.filter((slot) => slot.user).map((slot) => clampCpr(slot.checkpoint_pass_rate) ?? 0);
  const proposedCprs = slots.map((s) => s.weightedCpr ?? 0);
  const success = estimateCrimeSuccess([...filledSlotCprs, ...proposedCprs], scenarioRate);
  const gaps = slots.filter((s) => !s.assignee).length;

  return {
    crimeId: crime.id,
    crimeName: crime.name,
    difficulty: crime.difficulty,
    status: normStatus(crime.status),
    readyAt: crime.ready_at ? new Date(crime.ready_at * 1000).toISOString() : null,
    expiresAt: crime.expired_at ? new Date(crime.expired_at * 1000).toISOString() : null,
    baseline,
    scenario: opts.scenario,
    slots,
    filled: slots.filter((s) => s.assignee).length,
    open: slots.length,
    gaps,
    estimatedSuccess: success.estimate,
    estimateBand: success.band,
    weakestSlot: success.weakestIndex != null ? (slots[success.weakestIndex - filledSlotCprs.length]?.positionLabel ?? null) : null,
  };
}

/* ======================================================== reviewMembers === */

export interface RoleSuggestion {
  crimeId: number; crimeName: string; difficulty: number; positionLabel: string;
  passRate: number; evidence: CprSource; observedAt: string; itemId: number | null;
  meetsBaseline: boolean;
}
export interface MemberReview {
  member: TornRosterMember; intel: MemberIntel | null; statsFresh: boolean;
  assignment: string | null; suggestions: RoleSuggestion[]; reason: string;
  profile: MemberOcProfile | null;
}

/** Per-member shortlist of open roles they have CPR evidence for. Powered by
 *  the capability matrix, so it works whether that evidence came from a
 *  self-report, a live assignment or completed-crime history. */
export function reviewMembers(
  members: TornRosterMember[],
  intel: MemberIntel[],
  active: CrimeFeed,
  completed: CrimeFeed,
  now: number,
  minimumCpr = 70,
  prebuilt?: FactionOcIntel,
): MemberReview[] {
  if (!Number.isFinite(minimumCpr) || minimumCpr < 0 || minimumCpr > 100) throw new Error("CPR threshold must be between 0 and 100.");
  const oc = prebuilt ?? buildFactionOcIntel(active, completed, intel, now);
  const intelById = new Map(intel.map((record) => [record.tornUserId, record]));
  const activeAvailable = active.available;
  const activeCrimes = oc.activeCrimes;

  const assignmentByMember = new Map<number, OrganizedCrime>();
  for (const crime of activeCrimes) {
    for (const slot of crime.slots) {
      if (slot.user) assignmentByMember.set(slot.user.id, crime);
    }
  }

  return members.map((member) => {
    const record = intelById.get(member.tornId) ?? null;
    const profile = oc.profiles.get(member.tornId) ?? null;
    const assignmentCrime = assignmentByMember.get(member.tornId) ?? null;
    const assignment = assignmentCrime ? `${assignmentCrime.name} #${assignmentCrime.id}` : null;
    const base = { member, intel: record, statsFresh: isFresh(record?.statsAt ?? null, now, STATS_FRESH_MS), assignment, profile };

    if (!activeAvailable) return { ...base, suggestions: [], reason: "The live OC feed is unavailable; refresh before recommending." };
    if (assignment) return { ...base, suggestions: [], reason: "Already assigned to an active OC." };

    const capabilities = oc.matrix.get(member.tornId);
    if (!capabilities || capabilities.size === 0) {
      return { ...base, suggestions: [], reason: "No CPR evidence yet — no shared snapshot, no live assignment and no recent completed-crime record." };
    }

    const suggestions: RoleSuggestion[] = [];
    const seenRole = new Set<string>();
    for (const crime of activeCrimes) {
      if (normStatus(crime.status) === "recruiting" && crime.expired_at && crime.expired_at * 1000 <= now) continue;
      const scenario = oc.scenarios.get(scenarioKeyOf(crime.name, crime.difficulty)) ?? null;
      const baseline = roleBaseline(crime.difficulty, minimumCpr);
      for (const slot of crime.slots) {
        if (slot.user) continue;
        const label = slot.position_info.label || slot.position || "Role";
        const roleKey = roleKeyOf(crime.name, crime.difficulty, label);
        // Numbered copies of a role ("Robber #1/#2") pool to one CPR entry —
        // list the member once per pooled role, not once per empty seat.
        const dedupeKey = `${crime.id}:${roleKey}`;
        if (seenRole.has(dedupeKey)) continue;
        const entry = capabilities.get(roleKey);
        if (!entry || entry.weightedCpr < minimumCpr) continue;
        seenRole.add(dedupeKey);
        suggestions.push({
          crimeId: crime.id, crimeName: crime.name, difficulty: crime.difficulty,
          positionLabel: stripPositionNumber(label),
          passRate: entry.weightedCpr,
          evidence: entry.source,
          observedAt: entry.observedAt,
          itemId: slot.item_requirement?.id ?? null,
          meetsBaseline: entry.weightedCpr >= baseline,
        });
        void scenario;
      }
    }
    suggestions.sort((a, b) =>
      Number(b.meetsBaseline) - Number(a.meetsBaseline)
      || b.passRate - a.passRate
      || b.difficulty - a.difficulty
      || a.crimeId - b.crimeId
      || a.positionLabel.localeCompare(b.positionLabel));

    const reason = suggestions.length
      ? "Ranked by recency-weighted CPR, meeting the per-difficulty baseline first. Confirm in Torn before joining."
      : "CPR evidence exists but none of it meets the current threshold for an open role.";
    return { ...base, suggestions, reason };
  });
}

export function summariseMemberProfile(tornUserId: number, intel: FactionOcIntel): MemberOcProfile | null {
  return intel.profiles.get(tornUserId) ?? null;
}

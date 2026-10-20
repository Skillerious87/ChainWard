export const API_POOL_POLICY_VERSION = 1;
export const API_POOL_MAX_CONTRIBUTION = 10;
export const TORN_PLAYER_REQUEST_LIMIT = 30;
export const API_POOL_PRESENCE_MS = 45_000;

export interface ApiPoolPreferences {
  enabled: boolean;
  limitPerMinute: number;
  allowOffline: boolean;
  allowBackground: boolean;
}

export interface ApiPoolStatus extends ApiPoolPreferences {
  available: boolean;
  lastFour: string | null;
  acceptedAt: string | null;
  requestsLastMinute: number;
  contributionsLastMinute: number;
  lastUsedAt: string | null;
  lastError: string | null;
}

export interface ApiPoolGrant extends ApiPoolPreferences {
  policyVersion: number;
  version: string;
  ownerId: number;
  factionId: number;
  encryptedKey: string;
  encryptionIv: string;
  fingerprint: string;
  lastFour: string;
  acceptedAt: string;
  verifiedAt: number;
  lastUsedAt: string | null;
  lastError: string | null;
  connectionFingerprint?: string;
}

export interface FactionPoolRequest {
  path: string;
  query: Readonly<Record<string, string>>;
  cacheMs: number;
  forceRefresh: boolean;
}

export interface TornResponseSnapshot {
  value: unknown;
  fetchedAt: number;
}

export interface TornCoordinationContext {
  ownerId?: number;
  validation?: boolean;
  verificationRequest?: boolean;
  contribution?: { ownerId: number; factionId: number; version: string; background: boolean };
}

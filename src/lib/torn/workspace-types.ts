export interface TornRosterMember {
  tornId: number;
  name: string;
  position: string;
  level: number;
  daysInFaction: number;
  lastAction: string;
  lastActionAt: number;
  status: string;
  statusDescription: string;
  statusUntil: number | null;
}

export interface TornChainHistoryItem {
  id: number;
  hits: number;
  respect: number;
  startedAt: number;
  endedAt: number;
}

export interface TornContribution {
  rank: number;
  name: string;
  tornId: number;
  hits: number;
  contribution: number;
  respect: number;
  status: string | null;
}

export interface TornChainReportView {
  id: number;
  factionId: number;
  startedAt: number;
  endedAt: number;
  hits: number;
  respect: number;
  contributorCount: number;
  targetCount: number;
  contributions: TornContribution[];
}

export interface TornDataResult<T> {
  available: boolean;
  checkedAt: string;
  data: T;
  message: string;
}

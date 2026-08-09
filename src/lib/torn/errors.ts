export type TornErrorCategory =
  | "INVALID_KEY"
  | "KEY_PAUSED"
  | "INSUFFICIENT_PERMISSION"
  | "RATE_LIMITED"
  | "API_UNAVAILABLE"
  | "FACTION_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "UNEXPECTED_RESPONSE";

const errorCategories: Readonly<Record<number, TornErrorCategory>> = {
  1: "INVALID_KEY",
  2: "INVALID_KEY",
  3: "INVALID_REQUEST",
  4: "INVALID_REQUEST",
  5: "RATE_LIMITED",
  6: "INVALID_REQUEST",
  7: "FACTION_UNAVAILABLE",
  8: "RATE_LIMITED",
  9: "API_UNAVAILABLE",
  13: "KEY_PAUSED",
  14: "RATE_LIMITED",
  16: "INSUFFICIENT_PERMISSION",
  17: "API_UNAVAILABLE",
  18: "KEY_PAUSED",
  22: "INVALID_REQUEST",
  23: "INVALID_REQUEST",
  24: "API_UNAVAILABLE",
};

const retryableCodes = new Set([5, 8, 9, 14, 17, 24]);

export class TornApiError extends Error {
  readonly category: TornErrorCategory;
  readonly retryable: boolean;

  constructor(
    readonly code: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TornApiError";
    this.category = errorCategories[code] ?? "UNEXPECTED_RESPONSE";
    this.retryable = retryableCodes.has(code);
  }
}

export function userFacingTornError(error: TornApiError): string {
  switch (error.category) {
    case "INVALID_KEY":
      return "This Torn API key is invalid. Replace it before trying again.";
    case "KEY_PAUSED":
      return "This Torn API key is paused or temporarily disabled.";
    case "INSUFFICIENT_PERMISSION":
      return "This key does not include the required Torn API selections.";
    case "RATE_LIMITED":
      return "Torn's API request limit has been reached. Sync will retry shortly.";
    case "API_UNAVAILABLE":
      return "Torn's API is temporarily unavailable. Stored data is still safe.";
    case "FACTION_UNAVAILABLE":
      return "Faction information is unavailable for this key.";
    case "INVALID_REQUEST":
      return "Torn rejected the requested API operation.";
    case "UNEXPECTED_RESPONSE":
      return "Torn returned data in an unexpected format.";
  }
}

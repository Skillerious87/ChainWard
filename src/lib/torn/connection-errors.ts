/** A storage outage must not be interpreted as an expired or revoked login. */
export class SavedConnectionUnavailableError extends Error {
  constructor() {
    super("Your saved Torn connection is temporarily unavailable. Try again shortly.");
    this.name = "SavedConnectionUnavailableError";
  }
}

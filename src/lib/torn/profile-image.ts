const TORN_PROFILE_IMAGE_HOST = "profileimages.torn.com";

export function normalizeTornProfileImageUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === TORN_PROFILE_IMAGE_HOST
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

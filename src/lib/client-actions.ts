"use client";

export type ToastTone = "success" | "info" | "warning" | "danger";

export interface ToastDetail {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Stable key used to replace repeated feedback instead of stacking it. */
  dedupeKey?: string;
  /** Override automatic timing. Zero keeps the toast until it is dismissed. */
  durationMs?: number;
}

export interface ToastQueueItem extends ToastDetail {
  id: string;
  key: string;
  count: number;
}

export const MAX_VISIBLE_TOASTS = 4;

export function notify(detail: ToastDetail): void {
  window.dispatchEvent(
    new CustomEvent<ToastDetail>("chainward:toast", { detail }),
  );
}

export function toastKey(detail: ToastDetail): string {
  return detail.dedupeKey?.trim() || `${detail.tone ?? "info"}:${detail.title.trim().toLowerCase()}`;
}

export function toastDurationMs(detail: ToastDetail): number {
  if (detail.durationMs !== undefined) return Math.max(0, Math.min(60_000, detail.durationMs));
  if (detail.tone === "danger") return 10_000;
  if (detail.tone === "warning") return 7_000;
  if (detail.tone === "success") return 4_500;
  return 5_500;
}

export function enqueueToast(current: readonly ToastQueueItem[], detail: ToastDetail, id: string): ToastQueueItem[] {
  const key = toastKey(detail);
  const existing = current.find((toast) => toast.key === key);
  const next: ToastQueueItem = { ...detail, id, key, count: (existing?.count ?? 0) + 1 };
  return [...current.filter((toast) => toast.key !== key), next].slice(-MAX_VISIBLE_TOASTS);
}

export function downloadCsv(
  filename: string,
  rows: readonly Record<string, string | number>[],
): void {
  if (rows.length === 0) {
    notify({
      title: "Nothing to export",
      description: "Adjust the filters and try again.",
      tone: "warning",
    });
    return;
  }

  const columns = Object.keys(rows[0] ?? {});
  const content = [
    columns.map(csvCell).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column] ?? "")).join(","),
    ),
  ].join("\r\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  notify({
    title: "Export ready",
    description: `${rows.length} rows downloaded as ${filename}.`,
    tone: "success",
  });
}

export function csvCell(value: string | number): string {
  let text = String(value);
  // Spreadsheet applications can execute a string cell beginning with one of
  // these operators as a formula. Torn/member labels are untrusted text, so
  // neutralise them while leaving genuine numeric values numeric.
  if (typeof value === "string" && /^[\t\r\n ]*[=+@-]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

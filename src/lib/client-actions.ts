"use client";

export type ToastTone = "success" | "info" | "warning" | "danger";

export interface ToastDetail {
  title: string;
  description?: string;
  tone?: ToastTone;
}

export function notify(detail: ToastDetail): void {
  window.dispatchEvent(
    new CustomEvent<ToastDetail>("chainward:toast", { detail }),
  );
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
    columns.map(escapeCell).join(","),
    ...rows.map((row) =>
      columns.map((column) => escapeCell(row[column] ?? "")).join(","),
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

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

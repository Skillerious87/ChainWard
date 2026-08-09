interface StatusDotProps {
  tone?: "success" | "warning" | "danger" | "muted";
  pulse?: boolean;
}

export function StatusDot({ tone = "success", pulse = false }: StatusDotProps) {
  return (
    <span
      className={`status-dot status-dot--${tone}${pulse ? " status-dot--pulse" : ""}`}
      aria-hidden="true"
    />
  );
}

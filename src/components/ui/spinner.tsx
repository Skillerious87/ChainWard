/** A plain CSS spinner; mounting follows the actual pending operation. */
export function Spinner({ size = 22, label = "Loading", tone = "accent" }: { size?: number; label?: string; tone?: "accent" | "muted" }) {
  return (
    <span className={`cw-spinner cw-spinner--${tone}`} style={{ width: size, height: size }} role="status" aria-label={label} />
  );
}

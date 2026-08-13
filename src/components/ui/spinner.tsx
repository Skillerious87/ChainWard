/**
 * The house loading mark.
 *
 * Two counter-rotating arcs rather than one spinning circle: a single arc at a
 * constant speed reads as a stalled GIF once it has been on screen for a
 * second, whereas opposed rotation keeps reading as work in progress. Drawn in
 * SVG so it stays crisp at any size and needs no images.
 */
export function Spinner({ size = 22, label = "Loading", tone = "accent" }: { size?: number; label?: string; tone?: "accent" | "muted" }) {
  return (
    <span className={`cw-spinner cw-spinner--${tone}`} style={{ width: size, height: size }} role="status" aria-label={label}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="cw-spinner__track" cx="20" cy="20" r="16" />
        <circle className="cw-spinner__arc cw-spinner__arc--outer" cx="20" cy="20" r="16" />
        <circle className="cw-spinner__arc cw-spinner__arc--inner" cx="20" cy="20" r="9" />
      </svg>
    </span>
  );
}

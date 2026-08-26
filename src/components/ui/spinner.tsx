import Image from "next/image";

/** A quiet progress ring around Chainward's transparent brand mark. */
export function Spinner({ size = 22, label = "Loading", tone = "accent" }: { size?: number; label?: string; tone?: "accent" | "muted" }) {
  return (
    <span className={`cw-spinner cw-spinner--${tone}`} style={{ width: size, height: size }} role="status" aria-label={label}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="cw-spinner__track" cx="20" cy="20" r="16" />
        <circle className="cw-spinner__arc" cx="20" cy="20" r="16" pathLength="100" />
      </svg>
      <Image className="cw-spinner__mark" src="/icons/android-chrome-192x192.png" alt="" width={40} height={40} />
    </span>
  );
}

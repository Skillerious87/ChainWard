import Image from "next/image";

interface PageLoadingCoreProps {
  title: string;
  hint: string;
}

/**
 * The full-page loading mark. It is intentionally separate from `Spinner`,
 * which remains small and quiet inside buttons and form controls.
 */
export function PageLoadingCore({ title, hint }: PageLoadingCoreProps) {
  return (
    <div className="page-loading-core" role="status" aria-live="polite" aria-label={`${title}. ${hint}.`}>
      <div className="page-loading-core__visual" aria-hidden="true">
        <span className="page-loading-core__aura" />
        <svg viewBox="0 0 160 160">
          <circle className="page-loading-core__track page-loading-core__track--outer" cx="80" cy="80" r="66" />
          <circle className="page-loading-core__arc page-loading-core__arc--primary" cx="80" cy="80" r="66" pathLength="100" />
          <circle className="page-loading-core__track page-loading-core__track--inner" cx="80" cy="80" r="53" />
          <circle className="page-loading-core__arc page-loading-core__arc--secondary" cx="80" cy="80" r="53" pathLength="100" />
        </svg>
        <span className="page-loading-core__satellite" />
        <span className="page-loading-core__centre">
          <Image src="/icons/android-chrome-192x192.png" alt="" width={64} height={64} priority />
        </span>
      </div>
      <div className="page-loading-core__copy">
        <span className="page-loading-core__eyebrow"><i /> Chainward workspace</span>
        <strong>{title}</strong>
        <small>{hint}</small>
        <span className="page-loading-core__meter" aria-hidden="true"><i /></span>
      </div>
    </div>
  );
}

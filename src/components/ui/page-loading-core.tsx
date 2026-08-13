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
        <svg viewBox="0 0 160 160">
          <circle className="page-loading-core__track" cx="80" cy="80" r="62" />
          <circle className="page-loading-core__arc page-loading-core__arc--primary" cx="80" cy="80" r="62" pathLength="100" />
        </svg>
        <span className="page-loading-core__centre">
          <svg viewBox="0 0 64 64">
            <path d="M24.5 16.5 17.8 23.2a14 14 0 0 0 19.8 19.8l4.4-4.4" />
            <path d="m39.5 47.5 6.7-6.7A14 14 0 0 0 26.4 21l-4.4 4.4" />
            <path d="m25.2 41.4 15.6-15.6" />
          </svg>
        </span>
      </div>
      <div className="page-loading-core__copy">
        <strong>{title}</strong>
      </div>
    </div>
  );
}

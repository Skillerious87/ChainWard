import Image from "next/image";

interface PageLoadingCoreProps {
  title: string;
  hint: string;
}

/**
 * The full-page loading mark: a single spinning ring around the brand chip and
 * a slim indeterminate track. Deliberately restrained — it is separate from
 * `Spinner`, which stays small and quiet inside buttons and form controls.
 */
export function PageLoadingCore({ title, hint }: PageLoadingCoreProps) {
  return (
    <div className="page-loading-core" role="status" aria-live="polite" aria-label={`${title}. ${hint}.`}>
      <div className="page-loading-core__mark" aria-hidden="true">
        <span className="page-loading-core__halo" />
        <span className="page-loading-core__ring" />
        <span className="page-loading-core__chip">
          <Image src="/icons/android-chrome-192x192.png" alt="" width={56} height={56} priority />
        </span>
      </div>
      <div className="page-loading-core__copy">
        <span className="page-loading-core__eyebrow">Chainward</span>
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
      <span className="page-loading-core__bar" aria-hidden="true"><i /></span>
    </div>
  );
}

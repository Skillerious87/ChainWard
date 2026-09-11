import Image from "next/image";

interface PageLoadingCoreProps {
  title: string;
  hint: string;
}

/**
 * The full-page loading mark: one spinning ring around the still brand chip.
 * Deliberately restrained to a single motion cue — it is separate from
 * `Spinner`, which stays small and quiet inside buttons and form controls.
 */
export function PageLoadingCore({ title, hint }: PageLoadingCoreProps) {
  return (
    <div className="page-loading-core" role="status" aria-live="polite" aria-label={`${title}. ${hint}.`}>
      <div className="page-loading-core__mark" aria-hidden="true">
        <span className="page-loading-core__ring" />
        <span className="page-loading-core__chip">
          <Image src="/icons/android-chrome-192x192.png" alt="" width={48} height={48} priority />
        </span>
      </div>
      <div className="page-loading-core__copy">
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );
}
